import { describe, expect, it } from 'vitest';

import { PerfWindow } from '../perf-window';

/** 灌 n 帧稳态 60fps（16.7ms/帧）。 */
function steady(w: PerfWindow, n: number, dtMs = 16.7): void {
  for (let i = 0; i < n; i++) w.frame(dtMs);
}

describe('PerfWindow · 帧统计与分位数', () => {
  it('稳态帧率：分位数落在真实帧耗时上，frames / durationMs 如实累加', () => {
    const w = new PerfWindow();
    steady(w, 100, 16.7);

    const { reports } = w.drain();
    expect(reports).toHaveLength(1);
    const r = reports[0];
    expect(r.frames).toBe(100);
    expect(r.durationMs).toBeCloseTo(1670, 5);
    // 直方图 1ms/桶，16.7 → 17
    expect(r.p50Ms).toBe(17);
    expect(r.p95Ms).toBe(17);
    expect(r.p99Ms).toBe(17);
    expect(r.maxFrameMs).toBeCloseTo(16.7, 5);
  });

  it('⭐ 分位数抓不到卡顿 —— 这是本模块的头号反例，别把 P95 当卡顿指标', () => {
    // 30 秒 60fps 里夹三次卡顿：3/1800 = 0.17%，要 p99.9 才够得着
    const w = new PerfWindow({ stallThresholdsMs: [100, 200] });
    steady(w, 600);
    w.frame(150);
    steady(w, 600);
    w.frame(260);
    steady(w, 597);
    w.frame(120);

    const r = w.drain().reports[0];
    expect(r.frames).toBe(1800);

    // 分位数量的是**稳态帧率**：三次卡顿在它眼里根本不存在
    expect(r.p50Ms).toBe(17);
    expect(r.p95Ms).toBe(17);
    expect(r.p99Ms).toBe(17);

    // 卡顿只在这里：计数 + 累计毫秒
    expect(r.stalls).toEqual([
      { thresholdMs: 100, frames: 3, totalMs: 530 },
      { thresholdMs: 200, frames: 1, totalMs: 260 },
    ]);
    // 而 maxFrameMs 是唯一一个能看出「有过 260ms」的分位类字段
    expect(r.maxFrameMs).toBe(260);
  });

  it('分位数落在溢出桶时返回实测 max，不谎报成 255', () => {
    const w = new PerfWindow();
    // 全部超出直方图上界（>=255ms）
    for (let i = 0; i < 10; i++) w.frame(400 + i);

    const r = w.drain().reports[0];
    expect(r.p50Ms).toBe(409); // = maxFrameMs，而不是 255
    expect(r.p99Ms).toBe(409);
    expect(r.maxFrameMs).toBe(409);
  });

  it('丢掉 NaN / 0 / 负数，别污染直方图', () => {
    const w = new PerfWindow();
    w.frame(Number.NaN);
    w.frame(0);
    w.frame(-5);
    w.frame(16);

    const r = w.drain().reports[0];
    expect(r.frames).toBe(1);
    expect(r.durationMs).toBe(16);
  });
});

describe('PerfWindow · 卡顿阈值', () => {
  it('totalMs 取「卡顿帧的总耗时」而不是「超出部分」—— 超出部分可反推', () => {
    const w = new PerfWindow({ stallThresholdsMs: [100] });
    w.frame(150);
    w.frame(120);

    const [s] = w.drain().reports[0].stalls;
    expect(s).toEqual({ thresholdMs: 100, frames: 2, totalMs: 270 });
    // 超出部分 = totalMs - frames * thresholdMs
    expect(s.totalMs - s.frames * s.thresholdMs).toBe(70);
  });

  it('空数组 = 完全不统计卡顿', () => {
    const w = new PerfWindow({ stallThresholdsMs: [] });
    w.frame(999);

    expect(w.drain().reports[0].stalls).toEqual([]);
  });

  it('阈值乱序传入会被升序排（frame() 里靠升序提前 break）', () => {
    const w = new PerfWindow({ stallThresholdsMs: [200, 50, 100] });
    w.frame(120);

    expect(w.drain().reports[0].stalls.map((s) => s.thresholdMs)).toEqual([50, 100, 200]);
  });

  it('恰好等于阈值不算卡顿（严格大于才算）', () => {
    const w = new PerfWindow({ stallThresholdsMs: [100] });
    w.frame(100);

    expect(w.drain().reports[0].stalls[0].frames).toBe(0);
  });
});

describe('PerfWindow · span / peak / count', () => {
  it('span 累计次数、总耗时与最大值', () => {
    const w = new PerfWindow();
    w.frame(16);
    w.span('loadBundle', 300);
    w.span('loadBundle', 120);

    expect(w.drain().reports[0].spans).toEqual({
      loadBundle: { n: 2, totalMs: 420, maxMs: 300 },
    });
  });

  it('peak 取最大值，count 累加（默认 +1）', () => {
    const w = new PerfWindow();
    w.frame(16);
    w.peak('heapMB', 120);
    w.peak('heapMB', 90); // 更小的不覆盖
    w.peak('heapMB', 210);
    w.count('gc');
    w.count('gc');
    w.count('droppedFrames', 5);

    const r = w.drain().reports[0];
    expect(r.peaks).toEqual({ heapMB: 210 });
    expect(r.counts).toEqual({ gc: 2, droppedFrames: 5 });
  });
});

describe('PerfWindow · 分段', () => {
  it('mark 换段：前一段封上、新段从零开始', () => {
    const w = new PerfWindow();
    w.mark('lobby');
    steady(w, 10);
    w.mark('battle');
    steady(w, 20);

    const { reports } = w.drain();
    expect(reports.map((r) => [r.tag, r.frames])).toEqual([
      ['lobby', 10],
      ['battle', 20],
    ]);
  });

  it('同名 tag 是 no-op —— 否则自转 / pop 回同一态会攒出一串碎报告', () => {
    const w = new PerfWindow();
    w.mark('lobby');
    steady(w, 5);
    w.mark('lobby');
    w.mark('lobby');
    steady(w, 5);

    const { reports } = w.drain();
    expect(reports).toHaveLength(1);
    expect(reports[0].frames).toBe(10);
  });

  it('零帧段的 span / peak / count 不许漂到下一段', () => {
    const w = new PerfWindow();
    w.mark('loading');
    w.span('bootstrap', 800); // 这一段一帧都没渲染
    w.mark('lobby');
    steady(w, 10);

    const { reports } = w.drain();
    expect(reports.map((r) => r.tag)).toEqual(['loading', 'lobby']);
    expect(reports[0].spans).toEqual({ bootstrap: { n: 1, totalMs: 800, maxMs: 800 } });
    expect(reports[0].frames).toBe(0);
    // 关键：它没有跑到 lobby 名下去
    expect(reports[1].spans).toEqual({});
  });

  it('完全没数据的段不产报告', () => {
    const w = new PerfWindow();
    w.mark('a');
    w.mark('b');
    w.mark('c');

    expect(w.drain().reports).toEqual([]);
  });
});

describe('PerfWindow · drain 与缓冲边界', () => {
  it('drain 封上当前段并清空，再 drain 不会重复交出', () => {
    const w = new PerfWindow();
    steady(w, 10);

    expect(w.drain().reports).toHaveLength(1);
    expect(w.drain()).toEqual({ reports: [], dropped: 0 });
  });

  it('攒满 maxPending 丢最老的，并把丢了几份一起交出去', () => {
    const w = new PerfWindow({ maxPending: 2 });
    for (const tag of ['a', 'b', 'c', 'd']) {
      w.mark(tag);
      steady(w, 1);
    }

    const { reports, dropped } = w.drain();
    // 四段：a b c 在 mark 时封，d 在 drain 时封 —— 留下最新两段
    expect(reports.map((r) => r.tag)).toEqual(['c', 'd']);
    expect(dropped).toBe(2);
  });

  it('dropped 计数随 drain 一起清零', () => {
    const w = new PerfWindow({ maxPending: 1 });
    for (const tag of ['a', 'b', 'c']) {
      w.mark(tag);
      steady(w, 1);
    }
    expect(w.drain().dropped).toBe(2);

    steady(w, 1);
    expect(w.drain().dropped).toBe(0);
  });

  it('交出去的报告与内部状态不共享引用', () => {
    const w = new PerfWindow();
    w.frame(16);
    w.span('load', 100);
    const r = w.drain().reports[0];

    w.frame(16);
    w.span('load', 999);
    w.peak('heapMB', 1);

    expect(r.spans).toEqual({ load: { n: 1, totalMs: 100, maxMs: 100 } });
    expect(r.peaks).toEqual({});
  });
});

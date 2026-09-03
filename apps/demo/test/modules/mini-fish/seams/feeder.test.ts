import { describe, expect, it } from 'vitest';
import {
  emptyFeeder,
  randomFeeder,
  scriptedFeeder,
  combineFeeders,
  waveFeeder,
} from '../../../../assets/modules/mini-fish/seams/feeder';
import { FISH_KINDS } from '../../../../assets/modules/mini-fish/content/fish-kinds';
import { PATHS } from '../../../../assets/modules/mini-fish/content/paths';

const spawn = (kind: number) => ({ kind, pathId: 0, speed: 100 });

/** 循环吐出固定值。 */
function scriptedRand(...values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

describe('scriptedFeeder', () => {
  it('到点才放，且按 at 排序（写乱了也照样对）', () => {
    const f = scriptedFeeder([
      { at: 2, spawn: spawn(1) },
      { at: 0, spawn: spawn(0) },
    ]);
    expect(f.next(0.5).map((s) => s.kind)).toEqual([0]);
    expect(f.next(0.5)).toEqual([]);
    expect(f.next(1.0).map((s) => s.kind)).toEqual([1]);
    expect(f.next(10)).toEqual([]);
  });

  it('一步大 dt 一次补齐 —— 单测能直接跳到第 N 秒的局面', () => {
    const f = scriptedFeeder([
      { at: 1, spawn: spawn(0) },
      { at: 2, spawn: spawn(1) },
      { at: 3, spawn: spawn(2) },
    ]);
    expect(f.next(5)).toHaveLength(3);
  });
});

describe('emptyFeeder', () => {
  it('一条也不放', () => {
    expect(emptyFeeder().next(100)).toEqual([]);
  });
});

describe('randomFeeder', () => {
  it('不到间隔不放，到了放一批', () => {
    const f = randomFeeder({ interval: 1, batch: 3, rand: scriptedRand(0.5) });
    expect(f.next(0.9)).toEqual([]);
    expect(f.next(0.2)).toHaveLength(3);
  });

  it('放出来的鱼种 / 路径 / 速度都在表内', () => {
    const f = randomFeeder({ interval: 0.1, batch: 5, minSpeed: 50, maxSpeed: 60 });
    const out = f.next(0.1);
    for (const s of out) {
      expect(s.kind).toBeGreaterThanOrEqual(0);
      expect(s.kind).toBeLessThan(FISH_KINDS.length);
      expect(s.pathId).toBeGreaterThanOrEqual(0);
      expect(s.pathId).toBeLessThan(PATHS.length);
      expect(s.speed).toBeGreaterThanOrEqual(50);
      expect(s.speed).toBeLessThanOrEqual(60);
    }
  });

  it('大鱼罕见：权重 ∝ 1/m —— rand 贴近 0 取到第一种（最便宜），贴近 1 取到最后一种（最贵）', () => {
    const cheap = randomFeeder({ interval: 1, batch: 1, rand: scriptedRand(0) }).next(1);
    const dear = randomFeeder({ interval: 1, batch: 1, rand: scriptedRand(0.999999) }).next(1);
    expect(cheap[0].kind).toBe(0);
    expect(dear[0].kind).toBe(FISH_KINDS.length - 1);
  });

  it('掉帧不许一次性倒进几百条鱼：一帧最多补 4 批，余数清零', () => {
    const f = randomFeeder({ interval: 0.1, batch: 1, rand: scriptedRand(0.5) });
    expect(f.next(100)).toHaveLength(4);
    // 余数被清零，所以下一帧要重新等满一个间隔
    expect(f.next(0.05)).toEqual([]);
    expect(f.next(0.05)).toHaveLength(1);
  });
});

/** 测试自造的一份内容 —— 不依赖仓里那份的具体阵型，改内容不该弄红投喂器的测试。 */
const FIXTURE = {
  rev: 1,
  paths: [
    { id: 'a', p: [-1160, 0, -400, 0, 400, 0, 1160, 0] },
    { id: 'b', p: [1160, 260, 400, 260, -400, 260, -1160, 260] },
  ],
  waves: [
    // 队形三条排成一列（纵深 60 像素 ÷ 120 像素/秒 = 每条晚 0.5 秒进场），外加左右各岔开 40
    {
      id: 'w1',
      groups: [{ at: 0, path: 'a', kind: 'fish_yellow', speed: 120, formation: [0, 0, -60, 40, -120, -40] }],
    },
    { id: 'w2', groups: [{ at: 0, path: 'b', kind: 'fish_red', speed: 90, formation: [0, 0] }] },
  ],
} as const;

describe('waveFeeder', () => {
  it('时刻表：队形的纵深换算成进场延迟（dx ÷ speed），逐字段对得上', () => {
    const f = waveFeeder(FIXTURE, { order: ['w1'] });
    const at = (dt: number) => f.next(dt);
    // fish_yellow 是第 3 种；offset 就是队形的 dy；一群共一个 school id；seed = 群内序号 / 条数
    expect(at(0)).toEqual([{ kind: 2, pathId: 0, speed: 120, offset: 0, school: 1, seed: 0 }]);
    expect(at(0.25)).toEqual([]);
    expect(at(0.25)).toEqual([{ kind: 2, pathId: 0, speed: 120, offset: 40, school: 1, seed: 1 / 3 }]);
    expect(at(0.5)).toEqual([{ kind: 2, pathId: 0, speed: 120, offset: -40, school: 1, seed: 2 / 3 }]);
    expect(at(0.5)).toEqual([]);
  });

  /**
   * `at` 指的是**领队**进场那一刻，领队 = `dx` 最大那条。所以整条队形一起往前挪，
   * 出场时刻不动 —— 编的人拖队形时不会顺手把这一群的入场时间也改了。
   */
  it('at 锚在领队身上：整条队形平移，第一条鱼的出场时刻不变', () => {
    const shifted = {
      ...FIXTURE,
      waves: [
        {
          id: 'w1',
          // 每个 dx 都 +500：还是同一个形状，只是整体往前挪
          groups: [{ at: 0, path: 'a', kind: 'fish_yellow', speed: 120, formation: [500, 0, 440, 40, 380, -40] }],
        },
      ],
    };
    const f = waveFeeder(shifted, { order: ['w1'] });
    expect(f.next(0)).toHaveLength(1);
    expect(f.next(0.5)).toHaveLength(1);
    expect(f.next(0.5)).toHaveLength(1);
  });

  it('同一群共一个 school id，不同群不同 —— 分离力只在群内算', () => {
    const two = {
      ...FIXTURE,
      waves: [
        {
          id: 'w1',
          groups: [
            { at: 0, path: 'a', kind: 'fish_yellow', speed: 120, formation: [0, 0, 0, 60] },
            { at: 0, path: 'b', kind: 'fish_red', speed: 120, formation: [0, 0, 0, 60] },
          ],
        },
      ],
    };
    const out = waveFeeder(two, { order: ['w1'] }).next(0);
    expect(out.map((s) => s.school)).toEqual([1, 1, 2, 2]);
    expect(new Set(out.map((s) => s.school)).size).toBe(2);
  });

  it('坏队形 / 零速度在**载入时**就抛：不许静默变成「这一群一条都不出」', () => {
    const bad = (g: unknown) => ({
      rev: 1,
      paths: [{ id: 'a', p: [0, 0, 1, 0, 2, 0, 3, 0] }],
      waves: [{ id: 'w', groups: [g] }],
    });
    expect(() => waveFeeder(bad({ at: 0, path: 'a', kind: 'fish_red', speed: 1, formation: [0] }) as never))
      .toThrow(/队形/);
    expect(() => waveFeeder(bad({ at: 0, path: 'a', kind: 'fish_red', speed: 1, formation: [] }) as never))
      .toThrow(/队形/);
    // speed 是除数：0 会让延迟变成 Infinity，这一群一条都放不出来，还不报错
    expect(() => waveFeeder(bad({ at: 0, path: 'a', kind: 'fish_red', speed: 0, formation: [0, 0] }) as never))
      .toThrow(/速度/);
  });

  it('大 dt 等价：一步 tick(5) 与 300 步 1/60 吐出同一串', () => {
    const one = waveFeeder(FIXTURE, { order: ['w1', 'w2'], loop: true }).next(5);
    const many: unknown[] = [];
    const f = waveFeeder(FIXTURE, { order: ['w1', 'w2'], loop: true });
    for (let i = 0; i < 300; i++) many.push(...f.next(1 / 60));
    expect(one).toEqual(many);
  });

  it('阵与阵之间按「上一阵投喂完毕 + gap」接续，不等清场', () => {
    const f = waveFeeder(FIXTURE, { order: ['w1', 'w2'], gap: 2 });
    expect(f.next(0)).toHaveLength(1); // w1 第 1 条
    expect(f.next(1)).toHaveLength(2); // w1 第 2、3 条（最后一条在 1.0s 出生）
    expect(f.next(1.9)).toEqual([]); // 还在 gap 里
    expect(f.next(0.2)).toEqual([{ kind: 0, pathId: 1, speed: 90, offset: 0, school: 2, seed: 0 }]); // w2 来了
  });

  it('loop:false 放完就停 —— 编辑器要的是「放一次看看」', () => {
    const f = waveFeeder(FIXTURE, { order: ['w1'], gap: 0 });
    expect(f.next(10)).toHaveLength(3);
    expect(f.next(100)).toEqual([]);
  });

  it('loop:true 播完回到第一阵', () => {
    const f = waveFeeder(FIXTURE, { order: ['w1'], gap: 1, loop: true });
    expect(f.next(1.9)).toHaveLength(3); // 三条都出生了，还没跨过阵长（1.0 + gap 1）
    expect(f.next(0.2)).toHaveLength(1); // 跨过去 → 回到第一阵的第 1 条
  });

  it('order 不给就是表里全部，按表序', () => {
    const f = waveFeeder(FIXTURE, { gap: 0 });
    expect(f.next(10)).toHaveLength(4); // w1 三条 + w2 一条
  });

  it('引用不到的 id 在**载入时**就抛，不是等放到那一条才抛', () => {
    const bad = {
      rev: 1,
      paths: [{ id: 'a', p: [0, 0, 1, 0, 2, 0, 3, 0] }],
      waves: [{ id: 'w', groups: [{ at: 0, path: 'nope', kind: 'fish_red', speed: 1, formation: [0, 0] }] }],
    } as const;
    expect(() => waveFeeder(bad)).toThrow(/未知路径/);
    expect(() => waveFeeder(FIXTURE, { order: ['没这个阵'] })).toThrow(/未知鱼阵/);
  });
});

describe('combineFeeders', () => {
  it('把各家的输出拼起来，顺序 = 参数顺序', () => {
    const a = scriptedFeeder([{ at: 0, spawn: spawn(1) }]);
    const b = scriptedFeeder([{ at: 0, spawn: spawn(2) }]);
    expect(combineFeeders(a, b).next(0).map((s) => s.kind)).toEqual([1, 2]);
  });

  it('每家都收到同一个 dt（合流不改时间）', () => {
    const f = combineFeeders(
      scriptedFeeder([{ at: 1, spawn: spawn(1) }]),
      scriptedFeeder([{ at: 1, spawn: spawn(2) }]),
    );
    expect(f.next(0.5)).toEqual([]);
    expect(f.next(0.5)).toHaveLength(2);
  });
});

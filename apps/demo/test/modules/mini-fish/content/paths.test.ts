import { describe, expect, it } from 'vitest';
import {
  FIELD,
  PATHS,
  angleAt,
  fishPath,
  makeFishPath,
  pointAt,
  segmentCount,
} from '../../../../assets/modules/mini-fish/content/paths';

describe('路径表', () => {
  it('每条都是 6n+2 个控制点、弧长为正', () => {
    for (const p of PATHS) {
      expect((p.p.length - 2) % 6).toBe(0);
      expect(p.p.length).toBeGreaterThanOrEqual(8);
      expect(p.length).toBeGreaterThan(0);
    }
  });

  it('起点与终点都在屏外 —— 鱼不许凭空出现或凭空消失', () => {
    const halfW = FIELD.width / 2;
    const halfH = FIELD.height / 2;
    const outside = (x: number, y: number): boolean => Math.abs(x) > halfW || Math.abs(y) > halfH;
    for (const p of PATHS) {
      const a = pointAt(p, 0);
      const b = pointAt(p, 1);
      expect(outside(a.x, a.y)).toBe(true);
      expect(outside(b.x, b.y)).toBe(true);
    }
  });

  it('越界下标当场抛', () => {
    expect(() => fishPath(PATHS.length)).toThrow(/未知路径/);
  });
});

describe('贝塞尔求值', () => {
  const straight = PATHS[0]; // 左→右平直：(-1160,0) → (1160,0)

  it('s=0/1 落在首尾控制点上', () => {
    expect(pointAt(straight, 0)).toEqual({ x: -1160, y: 0 });
    expect(pointAt(straight, 1)).toEqual({ x: 1160, y: 0 });
  });

  it('共线控制点 = 直线，弧长就是两端距离', () => {
    expect(straight.length).toBeCloseTo(2320, 6);
  });

  it('弧长 ≥ 首尾直线距离（曲线绕远路）', () => {
    for (const p of PATHS) {
      const a = pointAt(p, 0);
      const b = pointAt(p, 1);
      expect(p.length).toBeGreaterThanOrEqual(Math.hypot(b.x - a.x, b.y - a.y) - 1e-6);
    }
  });

  it('朝向：往右游是 0，往左游是 π', () => {
    expect(angleAt(PATHS[0], 0.5)).toBeCloseTo(0, 9);
    expect(Math.abs(angleAt(PATHS[1], 0.5))).toBeCloseTo(Math.PI, 9);
  });

  it('朝向在 s=1 处也算得出来（解析导数，不做会采到定义域外的差分）', () => {
    for (const p of PATHS) expect(Number.isFinite(angleAt(p, 1))).toBe(true);
  });
});

/**
 * `pointAt` / `angleAt` 的入参是**已走弧长比例**，不是贝塞尔参数。
 *
 * 这两个概念长得一模一样（都是 `number`、都在 [0,1]），**编译器分辨不了** ——
 * 改造之前 `pathSystem` 按弧长推、`pointAt` 按参数解，两边都以为自己说的是同一个 t，
 * 结果最弯那条路的鱼快慢比 4.01×。所以这一组是专门钉住语义的。
 */
describe('弧长参数化', () => {
  // 一条长直线接一个小急弯：段长差最悬殊的构造。按参数走会在弯里「甩」过去，按弧长走不会。
  const twoSeg = makeFishPath([
    -1160, 0, -600, 0, 0, 0, 600, 0, /* 接点 (600,0) */ 900, 0, 1000, 300, 900, 500,
  ]);

  it('段数按 6n+2 数出来', () => {
    expect(segmentCount(twoSeg.p)).toBe(2);
    expect(segmentCount(PATHS[0].p)).toBe(1);
  });

  it('首尾仍落在首尾锚点上 —— 跨段不丢精度', () => {
    expect(pointAt(twoSeg, 0)).toEqual({ x: -1160, y: 0 });
    const end = pointAt(twoSeg, 1);
    expect(end.x).toBeCloseTo(900, 6);
    expect(end.y).toBeCloseTo(500, 6);
  });

  it('弧长是两段之和，不是把第二段吞掉', () => {
    const seg0 = makeFishPath(twoSeg.p.slice(0, 8));
    const seg1 = makeFishPath(twoSeg.p.slice(6));
    expect(twoSeg.length).toBeCloseTo(seg0.length + seg1.length, 3);
  });

  it('走过一半弧长时，真的走了一半的路 —— 这是「弧长」和「参数」的分水岭', () => {
    const half = pointAt(twoSeg, 0.5);
    // 沿曲线细分累加，量出 (0 → half) 的实际弧长
    let walked = 0;
    let prev = pointAt(twoSeg, 0);
    for (let i = 1; i <= 2000; i++) {
      const q = pointAt(twoSeg, (i / 2000) * 0.5);
      walked += Math.hypot(q.x - prev.x, q.y - prev.y);
      prev = q;
    }
    expect(walked).toBeCloseTo(twoSeg.length / 2, 0);
    expect(half.x).not.toBeCloseTo(600, 0); // 按参数算的话这里正好是接点，按弧长算不是
  });

  it('多段路径同样恒速（段长悬殊也不许甩）', () => {
    const N = 200;
    const step: number[] = [];
    let prev = pointAt(twoSeg, 0);
    for (let i = 1; i <= N; i++) {
      const q = pointAt(twoSeg, i / N);
      step.push(Math.hypot(q.x - prev.x, q.y - prev.y));
      prev = q;
    }
    expect(Math.max(...step) / Math.min(...step)).toBeLessThanOrEqual(1.05);
  });

  it('折角接点处取**右段**的切线 —— 鱼瞬间转头，那正是折角的定义', () => {
    // 直线向右接一段直角向上
    const corner = makeFishPath([0, 0, 200, 0, 400, 0, 600, 0, 600, 200, 600, 400, 600, 600]);
    const seg0 = makeFishPath(corner.p.slice(0, 8));
    const atJoint = seg0.length / corner.length;
    expect(angleAt(corner, atJoint - 1e-4)).toBeCloseTo(0, 3); // 进：向右
    expect(angleAt(corner, atJoint + 1e-4)).toBeCloseTo(Math.PI / 2, 3); // 出：向上
  });
});

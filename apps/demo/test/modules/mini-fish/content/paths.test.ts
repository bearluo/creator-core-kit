import { describe, expect, it } from 'vitest';
import {
  FIELD,
  PATHS,
  angleAt,
  fishPath,
  pointAt,
} from '../../../../assets/modules/mini-fish/content/paths';

describe('路径表', () => {
  it('每条都是 4 个控制点、弧长为正', () => {
    for (const p of PATHS) {
      expect(p.p).toHaveLength(8);
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

  it('t=0/1 落在首尾控制点上', () => {
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

  it('朝向在 t=1 处也算得出来（解析导数，不做会采到定义域外的差分）', () => {
    for (const p of PATHS) expect(Number.isFinite(angleAt(p, 1))).toBe(true);
  });
});

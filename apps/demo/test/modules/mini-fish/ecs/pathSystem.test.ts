import { describe, expect, it } from 'vitest';
import { createEcsWorld, Position } from '@cck/ecs-bitecs';
import { Angle, PathFollow } from '../../../../assets/modules/mini-fish/ecs/components';
import { spawnFish } from '../../../../assets/modules/mini-fish/ecs/feedSystem';
import { pathSystem } from '../../../../assets/modules/mini-fish/ecs/pathSystem';
import { PATHS, angleAt, pointAt } from '../../../../assets/modules/mini-fish/content/paths';

describe('pathSystem', () => {
  it('按像素速度前进：走 1 秒 = 前进 speed 像素的弧长', () => {
    const w = createEcsWorld();
    const eid = spawnFish(w, { kind: 0, pathId: 0, speed: 232 });
    w.time.delta = 1;
    pathSystem(w);
    // 0 号路径是直线，弧长 2320，走 232 像素 = 进度 0.1
    expect(PathFollow.t[eid]).toBeCloseTo(0.1, 5);
    expect(Position.x[eid]).toBeCloseTo(pointAt(PATHS[0], 0.1).x, 3);
  });

  it('长路径不会自动跑得更快 —— 同样的 speed 在两条路上走出同样的像素距离', () => {
    const w = createEcsWorld();
    const a = spawnFish(w, { kind: 0, pathId: 0, speed: 200 }); // 直线，短
    const b = spawnFish(w, { kind: 0, pathId: 7, speed: 200 }); // 回旋，长
    w.time.delta = 1;
    pathSystem(w);
    expect(PathFollow.t[a] * PATHS[0].length).toBeCloseTo(200, 3);
    expect(PathFollow.t[b] * PATHS[7].length).toBeCloseTo(200, 3);
    expect(PathFollow.t[a]).toBeGreaterThan(PathFollow.t[b]); // 短路走完得更快
  });

  it('进度停在 1，不越过终点 —— 收尸交给 despawnSystem', () => {
    const w = createEcsWorld();
    const eid = spawnFish(w, { kind: 0, pathId: 0, speed: 1000 });
    w.time.delta = 100;
    pathSystem(w);
    expect(PathFollow.t[eid]).toBe(1);
    expect(Position.x[eid]).toBeCloseTo(pointAt(PATHS[0], 1).x, 3);

    pathSystem(w); // 再跑一帧也还是 1
    expect(PathFollow.t[eid]).toBe(1);
  });

  it('朝向跟着路径转', () => {
    const w = createEcsWorld();
    const eid = spawnFish(w, { kind: 0, pathId: 4, speed: 300 }); // 大摆，方向一直在变
    w.time.delta = 1;
    pathSystem(w);
    expect(Angle.v[eid]).toBeCloseTo(angleAt(PATHS[4], PathFollow.t[eid]), 6);
    expect(Angle.v[eid]).not.toBeCloseTo(angleAt(PATHS[4], 0), 3);
  });
});

import { describe, expect, it } from 'vitest';
import { createEcsWorld, Position } from '@cck/ecs-bitecs';
import { Angle, PathFollow } from '../../../../assets/modules/mini-fish/ecs/components';
import { spawnFish } from '../../../../assets/modules/mini-fish/ecs/feedSystem';
import { pathSystem } from '../../../../assets/modules/mini-fish/ecs/pathSystem';
import { PATHS, angleAt, bodyPoseAt, pointAt } from '../../../../assets/modules/mini-fish/content/paths';
import { fishKind } from '../../../../assets/modules/mini-fish/content/fish-kinds';

describe('pathSystem', () => {
  it('按像素速度前进：走 1 秒 = 前进 speed 像素的弧长', () => {
    const w = createEcsWorld();
    const eid = spawnFish(w, { kind: 0, pathId: 0, speed: 232 });
    w.time.delta = 1;
    pathSystem(w);
    // 0 号路径是直线，弧长 2320，走 232 像素 = 进度 0.1
    expect(PathFollow.progress[eid]).toBeCloseTo(0.1, 5);
    expect(Position.x[eid]).toBeCloseTo(pointAt(PATHS[0], 0.1).x, 3);
  });

  it('长路径不会自动跑得更快 —— 同样的 speed 在两条路上走出同样的像素距离', () => {
    const w = createEcsWorld();
    const a = spawnFish(w, { kind: 0, pathId: 0, speed: 200 }); // 直线，短
    const b = spawnFish(w, { kind: 0, pathId: 7, speed: 200 }); // 回旋，长
    w.time.delta = 1;
    pathSystem(w);
    expect(PathFollow.progress[a] * PATHS[0].length).toBeCloseTo(200, 3);
    expect(PathFollow.progress[b] * PATHS[7].length).toBeCloseTo(200, 3);
    expect(PathFollow.progress[a]).toBeGreaterThan(PathFollow.progress[b]); // 短路走完得更快
  });

  it('进度停在 1，不越过终点 —— 收尸交给 despawnSystem', () => {
    const w = createEcsWorld();
    const eid = spawnFish(w, { kind: 0, pathId: 0, speed: 1000 });
    w.time.delta = 100;
    pathSystem(w);
    expect(PathFollow.progress[eid]).toBe(1);
    expect(Position.x[eid]).toBeCloseTo(pointAt(PATHS[0], 1).x, 3);

    pathSystem(w); // 再跑一帧也还是 1
    expect(PathFollow.progress[eid]).toBe(1);
  });

  it('朝向跟着路径转', () => {
    const w = createEcsWorld();
    const eid = spawnFish(w, { kind: 0, pathId: 4, speed: 300 }); // 大摆，方向一直在变
    w.time.delta = 1;
    pathSystem(w);
    const kind = fishKind(0);
    const p = bodyPoseAt(PATHS[4], PathFollow.progress[eid], 0, kind.body);
    expect(Angle.v[eid]).toBeCloseTo(p.angle, 6);
    expect(Angle.v[eid]).not.toBeCloseTo(angleAt(PATHS[4], 0), 3);
  });

  /**
   * 鱼是**一根有长度的棍子**：鼻尖和尾尖各压在路径上一点，朝向取两端连线。所以弯道比身子短时
   * 大鱼直接跨过去、不理会 —— 转弯速率按体长自动低通，不需要第二列参数。
   *
   * 数字是**量出来的**：`loop-left` 上鲨鱼（体长 499）峰值 17.6°/s，黄鱼（体长 52）46.2°/s，
   * 而两条都用切线时分别是 23.9 与 46.5 —— 小鱼几乎不受影响，正是「只治大鱼」该有的样子。
   * 若有人把它改回 `poseAt` 的切线，这条断言立刻红。
   */
  it('大鱼转得比小鱼稳 —— 把鱼钉在一个点上转，鲨鱼就绕着自己肚子旋', () => {
    const peak = (kind: number, speed: number): number => {
      const w = createEcsWorld();
      const e = spawnFish(w, { kind, pathId: 7, speed }); // loop-left：全表最弯
      w.time.delta = 1 / 60;
      let max = 0;
      let prev = Angle.v[e];
      while (PathFollow.progress[e] < 1) {
        pathSystem(w);
        const d = Angle.v[e] - prev;
        max = Math.max(max, Math.abs(Math.atan2(Math.sin(d), Math.cos(d))) * 60);
        prev = Angle.v[e];
      }
      return (max * 180) / Math.PI;
    };
    // 同一条路、同样的角速度上限来自几何而非速度，所以两条鱼给同一个 speed
    const shark = peak(9, 90);
    const small = peak(2, 90);
    expect(shark).toBeLessThan(small * 0.85);
  });
});

/**
 * 流水线第 2 步：推进每条鱼在路径上的进度，写出 `Position` 与 `Angle`。
 *
 * **恒定像素速度**：`progress += speed × dt / length`。这句话现在是真的 —— `progress` 是
 * 已走弧长比例，`pointAt` 也按弧长解释它（`paths.ts` 建表时算好「弧长 → 参数」查找表）。
 * 改造之前这里推的是弧长、那边解的是贝塞尔参数，两者不是一回事，最弯那条路快慢比 4.01×。
 *
 * `progress` 到 1 就停在终点不再前进，由 `despawnSystem` 收走 —— 「走完了」与「被销毁」分开，
 * 于是同一帧里后面的 system 看到的还是一个位置合法的实体。
 */
import { defineQuery, Position, type EcsSystem } from '@cck/ecs-bitecs';
import { Angle, Fish, PathFollow } from './components';
import { angleAt, fishPath, pointAt } from '../content/paths';

const swimmers = defineQuery([Fish, PathFollow, Position, Angle]);

export const pathSystem: EcsSystem = (world) => {
  const dt = world.time.delta;
  const ents = swimmers(world);
  for (let i = 0; i < ents.length; i++) {
    const e = ents[i];
    const path = fishPath(PathFollow.pathId[e]);
    const s = Math.min(1, PathFollow.progress[e] + (PathFollow.speed[e] * dt) / path.length);
    PathFollow.progress[e] = s;
    const p = pointAt(path, s);
    Position.x[e] = p.x;
    Position.y[e] = p.y;
    Angle.v[e] = angleAt(path, s);
  }
  return world;
};

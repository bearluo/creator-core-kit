/**
 * 流水线第 2 步：推进每条鱼在路径上的进度，写出 `Position` 与 `Angle`。
 *
 * **恒定像素速度**：`t += speed × dt / length`（弧长在建表时采样好，见 `paths.ts`），
 * 所以长路径不会自动跑得更快。`t` 到 1 就停在终点不再前进，由 `despawnSystem` 收走 ——
 * 「走完了」与「被销毁」分开，于是同一帧里后面的 system 看到的还是一个位置合法的实体。
 */
import { defineQuery, Position, type EcsSystem } from '@cck/ecs-bitecs';
import { Angle, Fish, PathFollow } from './components';
import { angleAt, fishPath, pointAt } from './paths';

const swimmers = defineQuery([Fish, PathFollow, Position, Angle]);

export const pathSystem: EcsSystem = (world) => {
  const dt = world.time.delta;
  const ents = swimmers(world);
  for (let i = 0; i < ents.length; i++) {
    const e = ents[i];
    const path = fishPath(PathFollow.pathId[e]);
    const t = Math.min(1, PathFollow.t[e] + (PathFollow.speed[e] * dt) / path.length);
    PathFollow.t[e] = t;
    const p = pointAt(path, t);
    Position.x[e] = p.x;
    Position.y[e] = p.y;
    Angle.v[e] = angleAt(path, t);
  }
  return world;
};

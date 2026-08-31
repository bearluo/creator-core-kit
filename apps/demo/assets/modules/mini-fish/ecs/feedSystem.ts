/**
 * 流水线第 1 步：问投喂源要这一帧的鱼，建实体。
 *
 * 建鱼这件事单独抽出 {@link spawnFish}，因为单测常常要**绕开投喂源直接摆一条鱼**
 * （「这条鱼在这个位置，网罩不罩得住」）。
 */
import { addComponent, addEntity, type EcsSystem, type EcsWorld } from '@cck/ecs-bitecs';
import { Circle, Position } from '@cck/ecs-bitecs';
import { Angle, Bomb, Fish, PathFollow } from './components';
import type { FishFeeder, FishSpawn } from '../seams/feeder';
import { fishKind } from '../content/fish-kinds';
import { angleAt, fishPath, pointAt } from '../content/paths';

/** 建一条鱼，返回它的 eid。位置/朝向按路径起点摆好，第一帧就在对的地方。 */
export function spawnFish(world: EcsWorld, spawn: FishSpawn): number {
  const kind = fishKind(spawn.kind);
  const path = fishPath(spawn.pathId);
  const eid = addEntity(world);

  addComponent(world, Fish, eid);
  addComponent(world, PathFollow, eid);
  addComponent(world, Position, eid);
  addComponent(world, Circle, eid);
  addComponent(world, Angle, eid);
  if (kind.bomb) addComponent(world, Bomb, eid);

  Fish.kind[eid] = spawn.kind;
  PathFollow.pathId[eid] = spawn.pathId;
  PathFollow.t[eid] = 0;
  PathFollow.speed[eid] = spawn.speed;
  Circle.r[eid] = kind.r;

  const p = pointAt(path, 0);
  Position.x[eid] = p.x;
  Position.y[eid] = p.y;
  Angle.v[eid] = angleAt(path, 0);
  return eid;
}

export function createFeedSystem(feeder: FishFeeder): EcsSystem {
  return (world) => {
    const spawns = feeder.next(world.time.delta);
    for (let i = 0; i < spawns.length; i++) spawnFish(world, spawns[i]);
    return world;
  };
}

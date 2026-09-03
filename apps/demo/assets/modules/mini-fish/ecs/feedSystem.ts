/**
 * 流水线第 1 步：问投喂源要这一帧的鱼，建实体。
 *
 * 建鱼这件事单独抽出 {@link spawnFish}，因为单测常常要**绕开投喂源直接摆一条鱼**
 * （「这条鱼在这个位置，网罩不罩得住」）。
 */
import { addComponent, addEntity, type EcsSystem, type EcsWorld } from '@cck/ecs-bitecs';
import { Circle, Position } from '@cck/ecs-bitecs';
import { Angle, Bomb, Fish, PathFollow, School } from './components';
import type { FishFeeder, FishSpawn } from '../seams/feeder';
import { fishKind } from '../content/fish-kinds';
import { bodyPoseAt, fishPath } from '../content/paths';

/**
 * 建一条鱼，返回它的 eid。位置/朝向按路径起点**加上它的侧向偏移**摆好，第一帧就在队形里。
 *
 * ⚠️ `School` 那六个字段**每次都写满**：bitECS 的 eid 会回收，SoA 数组里留着的是上一条鱼
 * 摆到一半的位移，不清就是新鱼一出生就歪在旁边、还带着速度。
 */
export function spawnFish(world: EcsWorld, spawn: FishSpawn): number {
  const kind = fishKind(spawn.kind);
  const path = fishPath(spawn.pathId);
  const eid = addEntity(world);

  addComponent(world, Fish, eid);
  addComponent(world, PathFollow, eid);
  addComponent(world, Position, eid);
  addComponent(world, Circle, eid);
  addComponent(world, Angle, eid);
  addComponent(world, School, eid);
  if (kind.bomb) addComponent(world, Bomb, eid);

  Fish.kind[eid] = spawn.kind;
  PathFollow.pathId[eid] = spawn.pathId;
  PathFollow.progress[eid] = 0;
  PathFollow.speed[eid] = spawn.speed;
  PathFollow.offset[eid] = spawn.offset ?? 0;
  Circle.r[eid] = kind.r;

  School.gid[eid] = spawn.school ?? 0;
  School.seed[eid] = spawn.seed ?? 0;
  School.dx[eid] = 0;
  School.dy[eid] = 0;
  School.vx[eid] = 0;
  School.vy[eid] = 0;

  const p = bodyPoseAt(path, 0, PathFollow.offset[eid], kind.body);
  Position.x[eid] = p.x;
  Position.y[eid] = p.y;
  Angle.v[eid] = p.angle;
  return eid;
}

export function createFeedSystem(feeder: FishFeeder): EcsSystem {
  return (world) => {
    const spawns = feeder.next(world.time.delta);
    for (let i = 0; i < spawns.length; i++) spawnFish(world, spawns[i]);
    return world;
  };
}

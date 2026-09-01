/**
 * 流水线第 7 步：游到路径尽头的鱼下场。
 *
 * 跟 `pathSystem` 分开是有意的：那边只管「走到哪」，`t` 到 1 就停住不再前进；这边才动手销毁。
 * 于是同一帧里夹在中间的 `bulletSystem` / `netSystem` 看到的永远是**位置合法的实体**，
 * 不会出现「刚被 remove 掉的 eid 还在网里被判了一次生死」。
 */
import { defineQuery, removeEntity, type EcsSystem } from '@cck/ecs-bitecs';
import { Fish, PathFollow } from './components';

const swimmers = defineQuery([Fish, PathFollow]);

export const despawnSystem: EcsSystem = (world) => {
  const ents = swimmers(world);
  for (let i = 0; i < ents.length; i++) {
    if (PathFollow.progress[ents[i]] >= 1) removeEntity(world, ents[i]);
  }
  return world;
};

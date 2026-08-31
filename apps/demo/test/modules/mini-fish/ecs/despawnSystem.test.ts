import { describe, expect, it } from 'vitest';
import { createEcsWorld, defineQuery } from '@cck/ecs-bitecs';
import { Fish, PathFollow } from '../../../../assets/modules/mini-fish/ecs/components';
import { despawnSystem } from '../../../../assets/modules/mini-fish/ecs/despawnSystem';
import { spawnFish } from '../../../../assets/modules/mini-fish/ecs/feedSystem';

const fish = defineQuery([Fish]);

describe('despawnSystem', () => {
  it('走完全程的鱼下场，还在游的留着', () => {
    const w = createEcsWorld();
    const done = spawnFish(w, { kind: 0, pathId: 0, speed: 100 });
    const swimming = spawnFish(w, { kind: 1, pathId: 1, speed: 100 });
    PathFollow.t[done] = 1;
    PathFollow.t[swimming] = 0.99;

    despawnSystem(w);
    expect(Array.from(fish(w))).toEqual([swimming]);
  });

  it('一条都没走完就一条都不动', () => {
    const w = createEcsWorld();
    spawnFish(w, { kind: 0, pathId: 0, speed: 100 });
    spawnFish(w, { kind: 0, pathId: 1, speed: 100 });
    despawnSystem(w);
    expect(fish(w)).toHaveLength(2);
  });
});

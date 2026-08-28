import { describe, expect, it } from 'vitest';
import { createEcsWorld, defineQuery, hasComponent, Circle, Position } from '@cck/ecs-bitecs';
import {
  Angle,
  Bomb,
  Fish,
  PathFollow,
} from '../../../assets/modules/mini-fish/components';
import { createFeedSystem, spawnFish } from '../../../assets/modules/mini-fish/feedSystem';
import { scriptedFeeder } from '../../../assets/modules/mini-fish/feeder';
import { FISH_KINDS, fishKind } from '../../../assets/modules/mini-fish/fish-kinds';
import { PATHS, angleAt, pointAt } from '../../../assets/modules/mini-fish/paths';

const HETUN = FISH_KINDS.findIndex((k) => k.bomb);

describe('spawnFish', () => {
  it('第一帧就摆在路径起点、朝着路径起点的方向 —— 不许出现「先在原点闪一下」', () => {
    const w = createEcsWorld();
    const eid = spawnFish(w, { kind: 3, pathId: 2, speed: 120 });
    const p0 = pointAt(PATHS[2], 0);
    expect(Position.x[eid]).toBeCloseTo(p0.x, 4);
    expect(Position.y[eid]).toBeCloseTo(p0.y, 4);
    expect(Angle.v[eid]).toBeCloseTo(angleAt(PATHS[2], 0), 6);
  });

  it('判定半径查鱼种表，进度从 0 开始', () => {
    const w = createEcsWorld();
    const eid = spawnFish(w, { kind: 9, pathId: 0, speed: 77 });
    expect(Fish.kind[eid]).toBe(9);
    expect(Circle.r[eid]).toBe(fishKind(9).r);
    expect(PathFollow.pathId[eid]).toBe(0);
    expect(PathFollow.speed[eid]).toBeCloseTo(77, 4);
    expect(PathFollow.t[eid]).toBe(0);
  });

  it('只有炸弹鱼带 Bomb 标记', () => {
    const w = createEcsWorld();
    const bomb = spawnFish(w, { kind: HETUN, pathId: 0, speed: 100 });
    const plain = spawnFish(w, { kind: 0, pathId: 0, speed: 100 });
    expect(hasComponent(w, Bomb, bomb)).toBe(true);
    expect(hasComponent(w, Bomb, plain)).toBe(false);
  });

  it('鱼种 / 路径写错当场抛，不静默造一条坏鱼', () => {
    const w = createEcsWorld();
    expect(() => spawnFish(w, { kind: 99, pathId: 0, speed: 1 })).toThrow(/未知鱼种/);
    expect(() => spawnFish(w, { kind: 0, pathId: 99, speed: 1 })).toThrow(/未知路径/);
  });
});

describe('feedSystem', () => {
  it('投喂源给几条就建几条，一条不多一条不少', () => {
    const w = createEcsWorld();
    const fish = defineQuery([Fish]);
    const feed = createFeedSystem(
      scriptedFeeder([
        { at: 0, spawn: { kind: 0, pathId: 0, speed: 100 } },
        { at: 0, spawn: { kind: 1, pathId: 1, speed: 100 } },
        { at: 5, spawn: { kind: 2, pathId: 2, speed: 100 } },
      ]),
    );

    w.time.delta = 0.1;
    feed(w);
    expect(fish(w)).toHaveLength(2);

    w.time.delta = 0.1;
    feed(w);
    expect(fish(w)).toHaveLength(2); // 还没到第 5 秒

    w.time.delta = 5;
    feed(w);
    expect(fish(w)).toHaveLength(3);
  });

  it('dt 从 world.time.delta 取 —— 不自持时钟（跟 kit 的 runner 一个约定）', () => {
    const w = createEcsWorld();
    const fish = defineQuery([Fish]);
    const feed = createFeedSystem(scriptedFeeder([{ at: 3, spawn: { kind: 0, pathId: 0, speed: 1 } }]));
    w.time.delta = 1;
    feed(w);
    expect(fish(w)).toHaveLength(0);
    w.time.delta = 3;
    feed(w);
    expect(fish(w)).toHaveLength(1);
  });
});

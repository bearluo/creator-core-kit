import { describe, expect, it } from 'vitest';
import { createEcsWorld, defineQuery, hasComponent, Circle, Position } from '@cck/ecs-bitecs';
import {
  Angle,
  Bomb,
  Fish,
  PathFollow,
} from '../../../../assets/modules/mini-fish/ecs/components';
import { createFeedSystem, spawnFish } from '../../../../assets/modules/mini-fish/ecs/feedSystem';
import { scriptedFeeder } from '../../../../assets/modules/mini-fish/seams/feeder';
import { FISH_KINDS, fishKind } from '../../../../assets/modules/mini-fish/content/fish-kinds';
import { PATHS, bodyPoseAt, pointAt } from '../../../../assets/modules/mini-fish/content/paths';

const HETUN = FISH_KINDS.findIndex((k) => k.bomb);

describe('spawnFish', () => {
  /**
   * 位姿走的是**跟 `pathSystem` 同一个** `bodyPoseAt`（鱼是根有长度的棍子，两端压在路径上），
   * 不是路径中线上的点 —— 生鱼时用切线、下一帧换成两端连线，鲨鱼一出生就会「唰」地扭一下。
   * 弯道上两者差得出来，所以这条断言换掉 `bodyPoseAt` 就红。
   */
  it('第一帧就摆在路径起点、朝着路径起点的方向 —— 不许出现「先在原点闪一下」', () => {
    const w = createEcsWorld();
    const eid = spawnFish(w, { kind: 3, pathId: 2, speed: 120 });
    const p0 = bodyPoseAt(PATHS[2], 0, 0, fishKind(3).body);
    expect(Position.x[eid]).toBeCloseTo(p0.x, 3); // f32 存储，1160 量级上只剩这么多位
    expect(Position.y[eid]).toBeCloseTo(p0.y, 3);
    expect(Angle.v[eid]).toBeCloseTo(p0.angle, 6);
    // 仍旧「在路径起点」：偏离不超过半个身子，绝不是原点
    const c = pointAt(PATHS[2], 0);
    expect(Math.hypot(p0.x - c.x, p0.y - c.y)).toBeLessThan(fishKind(3).body / 2);
  });

  it('判定半径查鱼种表，进度从 0 开始', () => {
    const w = createEcsWorld();
    const eid = spawnFish(w, { kind: 9, pathId: 0, speed: 77 });
    expect(Fish.kind[eid]).toBe(9);
    expect(Circle.r[eid]).toBe(fishKind(9).r);
    expect(PathFollow.pathId[eid]).toBe(0);
    expect(PathFollow.speed[eid]).toBeCloseTo(77, 4);
    expect(PathFollow.progress[eid]).toBe(0);
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

import { describe, expect, it } from 'vitest';
import {
  addComponent,
  addEntity,
  createEcsWorld,
  createSpatialHash,
  createSpatialIndexSystem,
  defineQuery,
  Position,
  type EcsWorld,
} from '@cck/ecs-bitecs';
import { Fish, Net } from '../../../assets/modules/mini-fish/components';
import type {
  CaughtFish,
  FireTicket,
  FishArbiter,
  TicketBook,
} from '../../../assets/modules/mini-fish/economy';
import type { CatchEvent, FishEvent } from '../../../assets/modules/mini-fish/events';
import { spawnFish } from '../../../assets/modules/mini-fish/feedSystem';
import { FISH_KINDS, MAX_FISH_R, fishKind } from '../../../assets/modules/mini-fish/fish-kinds';
import { createNetSystem, netRadius } from '../../../assets/modules/mini-fish/netSystem';

const fish = defineQuery([Fish]);
const nets = defineQuery([Net]);

const RED = 0;
const HETUN = FISH_KINDS.findIndex((k) => k.bomb);

/** 裁决替身：谁死由测试说了算，并把每次 `resolve` 的入参录下来。 */
function stubArbiter(dies: (eid: number) => boolean) {
  const calls: { ticket: FireTicket; caught: readonly CaughtFish[] }[] = [];
  const arbiter: FishArbiter = {
    fire: (cannon, level) => ({ cannon, level }),
    resolve: (ticket, caught) => {
      calls.push({ ticket, caught: caught.slice() });
      return caught.map((c) => ({ eid: c.eid, dead: dies(c.eid), payout: dies(c.eid) ? 10 : 0 }));
    },
  };
  return { arbiter, calls };
}

function setup(dies: (eid: number) => boolean = () => false) {
  const world = createEcsWorld();
  const hash = createSpatialHash(MAX_FISH_R * 2);
  const index = createSpatialIndexSystem(hash);
  const tickets: TicketBook = new Map();
  const events: FishEvent[] = [];
  const { arbiter, calls } = stubArbiter(dies);
  const system = createNetSystem(hash, arbiter, tickets, events);
  const step = (): void => {
    index(world);
    system(world);
  };
  return { world, tickets, events, calls, step };
}

/** 摆一条鱼在指定位置。 */
function fishAt(world: EcsWorld, kind: number, x: number, y: number): number {
  const eid = spawnFish(world, { kind, pathId: 0, speed: 0 });
  Position.x[eid] = x;
  Position.y[eid] = y;
  return eid;
}

/** 张一张网（跳过子弹那一步）。 */
function netAt(
  world: EcsWorld,
  tickets: TicketBook,
  x: number,
  y: number,
  level = 1,
  cannon = 0,
  withTicket = true,
): number {
  const eid = addEntity(world);
  addComponent(world, Net, eid);
  addComponent(world, Position, eid);
  Net.cannon[eid] = cannon;
  Net.level[eid] = level;
  Position.x[eid] = x;
  Position.y[eid] = y;
  if (withTicket) tickets.set(eid, { cannon, level });
  return eid;
}

const catches = (events: readonly FishEvent[]): CatchEvent[] =>
  events.filter((e): e is CatchEvent => e.type === 'catch');

describe('netSystem', () => {
  it('罩住的鱼交给裁决：死的发 catch 并下场，活的留在场上', () => {
    const { world, tickets, events, step } = setup((eid) => eid % 2 === 0);
    const a = fishAt(world, RED, 0, 0);
    const b = fishAt(world, RED, 40, 0);
    netAt(world, tickets, 0, 0, 1, 2);
    step();

    const survivors = Array.from(fish(world));
    const dead = a % 2 === 0 ? a : b;
    const alive = dead === a ? b : a;
    expect(survivors).toEqual([alive]);
    expect(catches(events).map((e) => e.eid)).toEqual([dead]);
    expect(catches(events)[0]).toMatchObject({ cannon: 2, payout: 10, kind: RED });
  });

  it('不管罩没罩到，都发一条 hit 让 View 去画张网', () => {
    const { world, tickets, events, calls, step } = setup();
    netAt(world, tickets, 123, -45, 4, 1);
    step();
    expect(events).toEqual([{ type: 'hit', cannon: 1, level: 4, x: 123, y: -45 }]);
    expect(calls).toHaveLength(0); // 空网不劳烦裁决
  });

  it('判完就没：网实体销毁、票撕掉', () => {
    const { world, tickets, step } = setup();
    const net = netAt(world, tickets, 0, 0);
    step();
    expect(nets(world)).toHaveLength(0);
    expect(tickets.has(net)).toBe(false);
  });

  it('罩不到的鱼不进裁决（圆判定，不是方框）', () => {
    const { world, tickets, calls, step } = setup();
    const reach = netRadius(1) + fishKind(RED).r; // 网边 + 鱼身，正好够着
    fishAt(world, RED, reach - 1, 0);
    fishAt(world, RED, reach + 1, 0);
    netAt(world, tickets, 0, 0, 1);
    step();
    expect(calls[0].caught).toHaveLength(1);
  });

  it('炸弹鱼死了再炸一圈：第二次调用裁决，够得着的鱼跟着遭殃', () => {
    const { world, tickets, calls, events, step } = setup(() => true);
    const bomb = fishAt(world, HETUN, 0, 0);
    // 网够不着、炸圈够得着的那一环
    const far = fishAt(world, RED, netRadius(1) + fishKind(RED).r + 10, 0);
    netAt(world, tickets, 0, 0, 1);
    step();

    expect(calls).toHaveLength(2);
    expect(calls[0].caught.map((c) => c.eid)).toEqual([bomb]);
    expect(calls[1].caught.map((c) => c.eid)).toEqual([far]);
    expect(calls[1].ticket).toEqual(calls[0].ticket); // 连锁走的是同一张票
    expect(catches(events).map((e) => e.eid).sort()).toEqual([bomb, far].sort());
    expect(fish(world)).toHaveLength(0);
  });

  it('一网对一条鱼只判一次 —— 从网底下逃掉的鱼，炸圈不许再判它一遍', () => {
    const doomed = new Set<number>();
    const { world, tickets, calls, step } = setup((eid) => doomed.has(eid));
    const bomb = fishAt(world, HETUN, 0, 0);
    const lucky = fishAt(world, RED, netRadius(1) - 10, 0); // 网够得着，炸圈也够得着
    doomed.add(bomb); // 只有炸弹鱼死
    netAt(world, tickets, 0, 0, 1);
    step();

    // 两条都在第一次裁决里判过了；炸圈再查时它们已在 settled 里 → 根本没有第二次调用。
    expect(calls).toHaveLength(1);
    expect(
      calls[0].caught
        .map((c) => c.eid)
        .slice()
        .sort(),
    ).toEqual([bomb, lucky].slice().sort());
    expect(Array.from(fish(world))).toEqual([lucky]); // 逃掉的还在，且只被判过一次
  });

  it('炸弹炸出炸弹：连锁是队列不是一层，且必然收敛', () => {
    const { world, tickets, calls, step } = setup(() => true);
    fishAt(world, HETUN, 0, 0);
    fishAt(world, HETUN, 200, 0); // 一炸圈内
    fishAt(world, RED, 420, 0); // 只有第二颗炸弹够得着
    netAt(world, tickets, 0, 0, 1);
    step();

    expect(fish(world)).toHaveLength(0);
    // 网 → 炸弹A → 炸弹B，三次裁决，一次不多：每条鱼最多进 settled 一次，队列必然排空。
    expect(calls).toHaveLength(3);
  });

  it('同一帧两张网罩同一条鱼：先判死的先得，后一张查不到它', () => {
    const { world, tickets, calls, step } = setup(() => true);
    fishAt(world, RED, 0, 0);
    netAt(world, tickets, 0, 0, 1, 0);
    netAt(world, tickets, 0, 0, 1, 3);
    step();

    // 第一张网判了它，第二张网什么也没罩到
    expect(calls).toHaveLength(1);
    expect(calls[0].ticket.cannon).toBe(0);
  });

  it('没票的网只发 hit，绝不凭空判一次生死', () => {
    const { world, tickets, events, calls, step } = setup(() => true);
    fishAt(world, RED, 0, 0);
    netAt(world, tickets, 0, 0, 1, 0, false);
    step();
    expect(calls).toHaveLength(0);
    expect(fish(world)).toHaveLength(1);
    expect(events.map((e) => e.type)).toEqual(['hit']);
  });

  it('网半径随档位增大', () => {
    expect(netRadius(7)).toBeGreaterThan(netRadius(1));
    expect(netRadius(1)).toBe(108);
    expect(netRadius(7)).toBe(216);
  });
});

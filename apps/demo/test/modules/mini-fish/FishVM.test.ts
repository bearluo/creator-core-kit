import { describe, expect, it } from 'vitest';
import { defineQuery } from '@cck/ecs-bitecs';
import type { CannonAgent } from '../../../assets/modules/mini-fish/seams/agent';
import { Bullet, Fish, PathFollow } from '../../../assets/modules/mini-fish/ecs/components';
import { localArbiter, memoryWallet, MAX_LEVEL } from '../../../assets/modules/mini-fish/seams/economy';
import type { FishEvent } from '../../../assets/modules/mini-fish/events';
import { randomFeeder, scriptedFeeder } from '../../../assets/modules/mini-fish/seams/feeder';
import { fishKind } from '../../../assets/modules/mini-fish/content/fish-kinds';
import { CANNON_SLOTS, FishVM, type FishVMOptions } from '../../../assets/modules/mini-fish/FishVM';

const FRAME = 1 / 60;
const bullets = defineQuery([Bullet]);

/** 只放一条鱼、不动（speed 0），测试自己把它挪到想要的进度上。 */
const oneFish = (kind: number) =>
  scriptedFeeder([{ at: 0, spawn: { kind, pathId: 0, speed: 0 } }]);

/** 默认关掉 AI 与保底 —— 单测要的是「只有玩家这一条路」。 */
function makeVM(options: FishVMOptions = {}): FishVM {
  return new FishVM({ aiAgents: [], bailout: 0, feeder: oneFish(0), ...options });
}

/** 把那条鱼摆到屏心：speed 为 0，所以手写的 t 不会被 pathSystem 推走。 */
function parkFishAtCenter(vm: FishVM): number {
  vm.tick(FRAME); // 投喂建鱼
  const eid = vm.snapshot()[0].eid;
  PathFollow.progress[eid] = 0.5;
  vm.tick(FRAME); // pathSystem 按 t 摆位置
  return eid;
}

describe('FishVM 全流程', () => {
  it('瞄 → 开炮扣钱 → 子弹飞 → 命中张网 → 裁决入账', () => {
    const wallet = memoryWallet(10_000);
    const vm = makeVM({
      wallet,
      arbiter: localArbiter({ wallet, rand: () => 0 }), // 必死
    });
    const eid = parkFishAtCenter(vm);
    expect(vm.snapshot()[0].x).toBeCloseTo(0, 3);

    vm.aim(0, 0);
    const all: FishEvent[] = [];
    for (let i = 0; i < 40; i++) {
      vm.tick(FRAME);
      all.push(...vm.events);
    }

    expect(all.filter((e) => e.type === 'fire')).toHaveLength(1);
    expect(all.filter((e) => e.type === 'hit')).toHaveLength(1);
    const caught = all.filter((e) => e.type === 'catch');
    expect(caught).toHaveLength(1);
    expect(caught[0]).toMatchObject({ eid, cannon: 0, payout: fishKind(0).m });

    // 花掉 1 档，赔回 1×m
    expect(wallet.balance()).toBe(10_000 - 1 + fishKind(0).m);
    expect(vm.balance.value).toBe(wallet.balance());
    expect(vm.snapshot()).toHaveLength(0); // 鱼下场了
  });

  it('打空了钱不退：子弹飞出场地就没，余额停在扣完那一档', () => {
    const wallet = memoryWallet(10_000);
    const vm = makeVM({ wallet, feeder: scriptedFeeder([]) });
    vm.aim(0, 540); // 朝上打，场上没鱼
    for (let i = 0; i < 120; i++) vm.tick(FRAME);
    expect(wallet.balance()).toBe(9_999);
    expect(bullets(vm.world)).toHaveLength(0);
  });

  it('余额不足开不出炮：没有 fire 事件、没有子弹、余额一分不动', () => {
    const wallet = memoryWallet(0);
    const vm = makeVM({ wallet });
    vm.setLevel(5);
    vm.aim(0, 0);
    vm.tick(FRAME);
    expect(vm.events.filter((e) => e.type === 'fire')).toHaveLength(0);
    expect(bullets(vm.world)).toHaveLength(0);
    expect(wallet.balance()).toBe(0);
  });
});

describe('FishVM 的边界', () => {
  it('events 每帧清空 —— 上一帧的金币不会再飞一次', () => {
    const vm = makeVM({ wallet: memoryWallet(100) });
    vm.aim(0, 0);
    vm.tick(FRAME);
    expect(vm.events.filter((e) => e.type === 'fire')).toHaveLength(1);
    vm.tick(FRAME);
    expect(vm.events.filter((e) => e.type === 'fire')).toHaveLength(0);
  });

  it('瞄一次开一发，按住不会连发', () => {
    const wallet = memoryWallet(100);
    const vm = makeVM({ wallet });
    vm.aim(0, 0);
    for (let i = 0; i < 10; i++) vm.tick(FRAME);
    expect(wallet.balance()).toBe(99);
  });

  it('换档夹在 1~7', () => {
    const vm = makeVM();
    vm.setLevel(99);
    expect(vm.level.value).toBe(MAX_LEVEL);
    vm.setLevel(-3);
    expect(vm.level.value).toBe(1);
    vm.setLevel(3.9);
    expect(vm.level.value).toBe(3);
  });

  it('档位就是消耗', () => {
    const wallet = memoryWallet(100);
    const vm = makeVM({ wallet });
    vm.setLevel(7);
    vm.aim(0, 0);
    vm.tick(FRAME);
    expect(wallet.balance()).toBe(93);
  });

  it('破产白送保底；关掉保底就一直是 0', () => {
    const broke = new FishVM({
      aiAgents: [],
      feeder: scriptedFeeder([]),
      wallet: memoryWallet(0),
    });
    broke.tick(FRAME);
    expect(broke.balance.value).toBe(1000);

    const strict = makeVM({ wallet: memoryWallet(0), feeder: scriptedFeeder([]) });
    strict.tick(FRAME);
    expect(strict.balance.value).toBe(0);
  });

  it('AI 陪打不花玩家的钱（它们是本地的假玩家，不是第二个账户）', () => {
    const wallet = memoryWallet(100);
    const alwaysFire: CannonAgent = { update: () => 0 };
    const vm = new FishVM({
      wallet,
      bailout: 0,
      feeder: scriptedFeeder([]),
      aiAgents: [alwaysFire, alwaysFire, alwaysFire],
    });
    for (let i = 0; i < 10; i++) vm.tick(FRAME);
    expect(wallet.balance()).toBe(100);
    expect(bullets(vm.world).length).toBeGreaterThan(0); // 它们真的在开炮
    expect(vm.cannons).toHaveLength(CANNON_SLOTS.length);
  });

  it('不给 aiAgents 就是四门炮，给空数组就是单人练习', () => {
    expect(new FishVM({ feeder: scriptedFeeder([]) }).cannons).toHaveLength(4);
    expect(makeVM().cannons).toHaveLength(1);
  });

  it('游到路径尽头的鱼自己下场', () => {
    const vm = makeVM();
    vm.tick(FRAME);
    const eid = vm.snapshot()[0].eid;
    PathFollow.progress[eid] = 1;
    vm.tick(FRAME);
    expect(vm.snapshot()).toHaveLength(0);
  });
});

/** 确定性 PRNG（mulberry32）—— 稳态断言不能靠 Math.random，否则它会随机红。 */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const fishes = defineQuery([Fish]);

describe('底噪密度', () => {
  it('稳态同屏鱼数落在 12~24 —— 有人改了 interval 把屏幕搞空或搞爆，这里当场红', () => {
    // 只跑底噪（不含鱼阵），判据：投喂率 1 条/秒 × 平均寿命 ≈ 17 秒 ⇒ 稳态 ≈ 17 条。
    const vm = new FishVM({
      aiAgents: [],
      bailout: 0,
      feeder: randomFeeder({ interval: 1.0, batch: 1, rand: seeded(20260831) }),
    });
    for (let i = 0; i < 60 * 60; i++) vm.tick(FRAME);
    const live = fishes(vm.world).length;
    expect(live).toBeGreaterThanOrEqual(12);
    expect(live).toBeLessThanOrEqual(24);
  });
});

/**
 * mini-fish 的全部玩法装配 —— **零 `cc` 依赖**，node 里直跑（`test/modules/mini-fish/FishVM.test.ts`）。
 *
 * 它把四道接缝、七个 system 和四门炮拧成一个 `tick(dt)`：
 *
 * ```
 * tick ─ 清事件 ─ 拍鱼池快照 ─ 逐门炮问指令源 ─ 开票扣钱 ─ 生子弹
 *      └ runner.tick ─ feed → path → movement → spatialIndex → bullet → net → despawn
 *      └ 同步余额 ─ 破产保底
 * ```
 *
 * **炮台与经济不进 ECS**（决策 D5）：一共四门炮，为它们付 SoA 的仪式感，query 开销比对象字段还大。
 * 进 ECS 的只有会上量的那三样 —— 鱼、子弹、网。
 *
 * ⚠️ **玩家和 AI 走同一条路**：玩家点屏幕只是让 {@link manualAgent} 记下一个角度，下一帧跟三个 AI
 * 一起被问、一起扣钱、一起生子弹。一旦给玩家开一条捷径，联网时那条捷径得再写一遍。
 */
import { signal, type Signal } from '@cck/core';
import {
  createEcsRunner,
  createEcsWorld,
  createSpatialHash,
  createSpatialIndexSystem,
  defineQuery,
  movementSystem,
  Position,
  type EcsRunner,
  type EcsWorld,
  type SpatialHash,
} from '@cck/ecs-bitecs';
import { aiAgent, manualAgent, type CannonAgent, type FishView, type ManualAgent } from './seams/agent';
import { createBulletSystem, spawnBullet } from './ecs/bulletSystem';
import { Fish } from './ecs/components';
import { createFeedSystem } from './ecs/feedSystem';
import { createNetSystem } from './ecs/netSystem';
import { despawnSystem } from './ecs/despawnSystem';
import { pathSystem } from './ecs/pathSystem';
import { randomFeeder, type FishFeeder } from './seams/feeder';
import { MAX_FISH_R } from './content/fish-kinds';
import {
  localArbiter,
  memoryWallet,
  MAX_LEVEL,
  MIN_LEVEL,
  type FishArbiter,
  type FishWallet,
  type TicketBook,
} from './seams/economy';
import type { FishEvent } from './events';

/** 一门炮：位置固定，指令从 {@link CannonAgent} 来。 */
export interface Cannon {
  readonly x: number;
  readonly y: number;
  readonly agent: CannonAgent;
}

/**
 * 四个炮位（横屏底边）。**0 号是玩家**，所以数组顺序不是从左到右 —— 让「玩家 = 0」这件事
 * 在任何地方都成立，比让 x 递增有用。
 */
/**
 * 四门炮的机位 —— **上下对坐**，跟四人捕鱼机台一样：玩家在下左，三个 AI 占掉另外三个角。
 * 一排四个的话中间两门会互相挡视线，而且上半场没人打、鱼白游。
 *
 * ⚠️ `|y| = 360` 不是随手取的：场地是 cover 缩放的（`FishGame.layout`），比 16:9 更宽的屏
 * 会把上下裁掉一截 —— 可见半高 ≈ `960 / 宽高比`，21:9 只剩 412。炮台半高 48，所以 360
 * 是「连 21:9 都还完整露着」的上限。**故意不在 View 里做钳制**：那会让画出来的炮口
 * 跟 VM 里子弹的出膛点对不上，超宽屏下子弹就凭空从旁边冒出来。
 */
export const CANNON_SLOTS: readonly { x: number; y: number }[] = [
  { x: -480, y: -360 }, // 0 玩家（下左）
  { x: 480, y: -360 }, // 1 AI（下右）
  { x: -480, y: 360 }, // 2 AI（上左）
  { x: 480, y: 360 }, // 3 AI（上右）
];

/** 初始金币。 */
export const INITIAL_COINS = 10000;
/** 破产白送这么多。⚠️ 白送的钱**会破坏 RTP**，模拟 RTP 时必须设 0（见 `economy.ts`）。 */
export const DEFAULT_BAILOUT = 1000;
/** 三个 AI 固定用这个档位。第三刀压量时再说要不要让它们变档。 */
export const AI_LEVEL = 3;
/** 空间哈希格边长 ≈ 2× 最大鱼半径（均匀分布下每格常数个实体）。 */
const CELL_SIZE = MAX_FISH_R * 2;

export interface FishVMOptions {
  /** 钱包。运行期是账户级落盘那份，单测给 `memoryWallet()`。 */
  wallet?: FishWallet;
  /** 裁决源。不给就用本地概率那份（包住上面的 wallet）。 */
  arbiter?: FishArbiter;
  /** 投喂源。单测给 `scriptedFeeder([...])` 逐条摆鱼。 */
  feeder?: FishFeeder;
  /** 三个 AI 的指令源。不给就现造三个 {@link aiAgent}；给空数组就是单人练习。 */
  aiAgents?: readonly CannonAgent[];
  /** 破产保底。**RTP 模拟必须传 0**。 */
  bailout?: number;
  rand?: () => number;
}

export class FishVM {
  /** ECS world。View 自己 `defineQuery` 去 diff 鱼的生灭（`enterQuery` / `exitQuery`）。 */
  readonly world: EcsWorld;
  /** 玩家余额。 */
  readonly balance: Signal<number>;
  /** 玩家炮台档位 1~7（= 一发的消耗 = 赔付倍数）。 */
  readonly level: Signal<number> = signal(1);
  /** 这一帧的表现事件。**每帧清空**，View 在 `tick` 之后读完即弃。 */
  readonly events: FishEvent[] = [];
  readonly cannons: readonly Cannon[];

  private readonly wallet: FishWallet;
  private readonly arbiter: FishArbiter;
  private readonly runner: EcsRunner;
  private readonly hash: SpatialHash;
  private readonly tickets: TicketBook = new Map();
  private readonly player: ManualAgent;
  private readonly bailout: number;
  private readonly fishQuery = defineQuery([Fish, Position]);

  constructor(options: FishVMOptions = {}) {
    const rand = options.rand ?? Math.random;
    this.wallet = options.wallet ?? memoryWallet(INITIAL_COINS);
    this.arbiter = options.arbiter ?? localArbiter({ wallet: this.wallet, rand });
    this.bailout = options.bailout ?? DEFAULT_BAILOUT;
    this.balance = signal(this.wallet.balance());

    this.player = manualAgent(CANNON_SLOTS[0].x, CANNON_SLOTS[0].y);
    const ai =
      options.aiAgents ?? CANNON_SLOTS.slice(1).map((s) => aiAgent({ x: s.x, y: s.y, rand }));
    this.cannons = CANNON_SLOTS.slice(0, 1 + ai.length).map((slot, i) => ({
      x: slot.x,
      y: slot.y,
      agent: i === 0 ? this.player : ai[i - 1],
    }));

    this.world = createEcsWorld();
    this.hash = createSpatialHash(CELL_SIZE);
    this.runner = createEcsRunner(this.world, [
      createFeedSystem(options.feeder ?? randomFeeder({ rand })),
      pathSystem,
      movementSystem,
      createSpatialIndexSystem(this.hash),
      createBulletSystem(this.hash, this.tickets),
      createNetSystem(this.hash, this.arbiter, this.tickets, this.events),
      despawnSystem,
    ]);
  }

  /** View 把点击换算成世界坐标递进来。同一帧多次点击只算最后一次。 */
  aim(x: number, y: number): void {
    this.player.aim(x, y);
  }

  /** 换档。越界夹住 —— UI 上是个 +/- 按钮，别让它把状态推到表外。 */
  setLevel(level: number): void {
    this.level.value = Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, Math.floor(level)));
  }

  tick(dt: number): void {
    this.events.length = 0;

    // ponytail: 每帧给四门炮拍一份鱼池快照（200 条 = 200 个小对象/帧）。
    //           第三刀真机量下来是热点再换成「按需 + 复用数组」。
    const view = { fish: this.snapshot() };
    for (let i = 0; i < this.cannons.length; i++) {
      const angle = this.cannons[i].agent.update(dt, view);
      if (angle !== null) this.fireFrom(i, angle);
    }

    this.runner.tick(dt);

    if (this.bailout > 0 && this.wallet.balance() < MIN_LEVEL) this.wallet.earn(this.bailout);
    this.balance.value = this.wallet.balance();
  }

  /** 场上的鱼。AI 拿它挑目标，单测拿它断言「还剩几条」。 */
  snapshot(): FishView[] {
    const ents = this.fishQuery(this.world);
    const out: FishView[] = [];
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i];
      out.push({ eid: e, kind: Fish.kind[e], x: Position.x[e], y: Position.y[e] });
    }
    return out;
  }

  /** 开票 → 生子弹。票开不出来（余额不足）就什么也不发生，**连事件都不发**。 */
  private fireFrom(cannon: number, angle: number): void {
    const level = cannon === 0 ? this.level.value : AI_LEVEL;
    const ticket = this.arbiter.fire(cannon, level);
    if (!ticket) return;
    const slot = this.cannons[cannon];
    spawnBullet(this.world, this.tickets, ticket, slot.x, slot.y, angle);
    this.events.push({ type: 'fire', cannon, level, angle });
  }
}

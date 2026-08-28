/**
 * 接缝 ①②：**裁决**与**钱包** —— 这一款唯一知道「钱怎么动」的地方。
 *
 * 单机今天用 {@link localArbiter} + {@link memoryWallet}；接服务端时换成一份下发实现，
 * **system 与单测一行不改**。客户端自己裁决 = 随便刷钱，所以这条缝从第一天就留着（决策 A）。
 *
 * ## RTP 为什么恒等于 0.95
 *
 * 一发炮弹消耗 `level`，一张网罩住 `N` 条鱼，第 i 条的倍率是 `m_i`：
 *
 * ```
 * 击杀概率 p_i      = RTP / (N × m_i)
 * 赔付     payout_i = level × m_i
 * 期望     Σ p_i × payout_i = Σ (RTP / (N × m_i)) × level × m_i = N × RTP × level / N = RTP × level
 * ```
 *
 * 于是**期望赔付 = RTP × 消耗，与网内鱼数、鱼种组合、炮台档位全部无关**。这不只是数学上漂亮 ——
 * 它把「RTP 到底是不是 0.95」变成一个能在 vitest 里跑一万局精确断言的命题，而不是靠调参手感。
 * （`p_i` 恒 < 1：RTP=0.95、最小 m=10、N≥1。）
 *
 * ⚠️ `FishVM` 的**破产保底是白送的钱，会破坏 RTP** —— 它是 demo 的便利不是经济设计的一部分，
 * 模拟 RTP 时必须关掉（`bailout: 0`）。
 */
import { fishKind } from './fish-kinds';

/** 返奖率。见类注释里的推导。 */
export const RTP = 0.95;

/** 炮台档位（= 一发的消耗 = 赔付倍数）。 */
export const MIN_LEVEL = 1;
export const MAX_LEVEL = 7;

/**
 * 接缝 ②：钱包。**零依赖** —— VM 只认这个接口，单测塞 {@link memoryWallet} 就能跑，
 * 不必有 DI 容器、不必有 `IStorage`、不必登录（跟 `foundation/game/scoreboard.ts` 同一个套路）。
 *
 * 钱属于**账户**不属于这一款（决策 B）：打鱼赚的钱将来要能在商城花，所以运行期那份的存储 key
 * 走账户级前缀，实现先住本模块。
 */
export interface FishWallet {
  balance(): number;
  /** 花钱。**余额不足返回 false 且一分不扣** —— 别让「打了半发」这种状态存在。 */
  spend(amount: number): boolean;
  earn(amount: number): void;
}

/**
 * 内存钱包 —— VM 的缺省值，也是单测里的那一份。不落盘：实例一没就清零。
 * 所以它**不是**「忘了接钱包也能用」的兜底，而是「这个 VM 现在没接任何外部世界」的诚实表示。
 */
export function memoryWallet(initial = 0): FishWallet {
  let balance = Math.floor(initial);
  return {
    balance: () => balance,
    spend: (amount) => {
      const v = Math.floor(amount);
      if (v <= 0 || v > balance) return false;
      balance -= v;
      return true;
    },
    earn: (amount) => {
      const v = Math.floor(amount);
      if (v > 0) balance += v;
    },
  };
}

/** 一张开出去的票：这一炮是谁、什么档位打的。联网实现里还会带服务端流水号。 */
export interface FireTicket {
  readonly cannon: number;
  readonly level: number;
}

/** 被一张网罩住的一条鱼。 */
export interface CaughtFish {
  readonly eid: number;
  readonly kind: number;
}

/** 一条鱼的结算结果。 */
export interface Settlement {
  readonly eid: number;
  readonly dead: boolean;
  /** 死了才 > 0。 */
  readonly payout: number;
}

/**
 * 接缝 ①：裁决。**钱的进出都在这里** —— `fire` 扣、`resolve` 入账。
 * 于是 `netSystem` 不必认识钱包，联网时服务端说了算的那一版也不必往 system 里塞钱。
 */
export interface FishArbiter {
  /** 开一炮：扣钱开票。**余额不足返回 null**，这一炮打不出去。 */
  fire(cannon: number, level: number): FireTicket | null;
  /** 一张网罩住这些鱼 → 谁死了、各赔多少。炸弹鱼连锁是**第二次**调用。 */
  resolve(ticket: FireTicket, caught: readonly CaughtFish[]): readonly Settlement[];
}

export interface LocalArbiterOptions {
  readonly wallet: FishWallet;
  /**
   * 哪门炮是玩家的（默认 0）。**只有它花钱、只有它入账** —— 另外三门是本地的假玩家
   * （决策 D1），它们存在的意义是把接缝 ③ 逼出来并且天天在跑，不该动玩家的余额。
   */
  readonly playerCannon?: number;
  /** 注入随机源，单测给固定序列。 */
  readonly rand?: () => number;
}

/** 单机裁决：本地概率。见类注释的 RTP 推导。 */
export function localArbiter(options: LocalArbiterOptions): FishArbiter {
  const { wallet } = options;
  const playerCannon = options.playerCannon ?? 0;
  const rand = options.rand ?? Math.random;

  return {
    fire(cannon, level) {
      if (level < MIN_LEVEL || level > MAX_LEVEL) return null;
      if (cannon !== playerCannon) return { cannon, level };
      return wallet.spend(level) ? { cannon, level } : null;
    },

    resolve(ticket, caught) {
      const n = caught.length;
      if (n === 0) return [];
      const out: Settlement[] = [];
      let earned = 0;
      for (let i = 0; i < n; i++) {
        const { eid, kind } = caught[i];
        const m = fishKind(kind).m;
        const dead = rand() < RTP / (n * m);
        const payout = dead ? ticket.level * m : 0;
        earned += payout;
        out.push({ eid, dead, payout });
      }
      if (earned > 0 && ticket.cannon === playerCannon) wallet.earn(earned);
      return out;
    },
  };
}

/**
 * `eid → 票根`。子弹**带着票飞**，命中时把票转给网，网判完就撕。
 *
 * 为什么不塞进组件：SoA 只装数字，而联网那版的票会带服务端流水号之类的东西。
 * 为什么不在 `netSystem` 里现造一张：那就等于承认票可以由客户端凭空开 —— 正是接缝 ① 要挡的事。
 */
export type TicketBook = Map<number, FireTicket>;

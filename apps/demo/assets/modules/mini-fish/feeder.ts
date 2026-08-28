/**
 * 接缝 ④：**鱼池投喂源** —— 谁决定这一帧放哪些鱼进来。
 *
 * 单机是 {@link randomFeeder}，联网时换成服务端下发的鱼群序列。**外挂防线在这儿**（决策 D2）：
 * 客户端自己随机生成鱼群 = 外挂能提前算出下一波是什么、能自瞄大鱼，真上线守不住。
 *
 * 它还带一条免费的好处：鱼池不自己随机 ⇒ 鱼群**完全由投喂序列决定** ⇒ 单测可以逐条摆鱼
 * （{@link scriptedFeeder}），「这条鱼走到第 3 秒时网罩不罩得住」在 vitest 里问得死
 * —— 跟 `mini-hop` 把关卡烘成 `level.ts` 是同一个路数。
 */
import { FISH_KINDS } from './fish-kinds';
import { PATHS } from './paths';

/** 放一条鱼进来：什么种、走哪条路、多快（像素/秒）。 */
export interface FishSpawn {
  readonly kind: number;
  readonly pathId: number;
  readonly speed: number;
}

export interface FishFeeder {
  /** 这一帧要放哪些鱼进来。没有就返回空数组。 */
  next(dt: number): readonly FishSpawn[];
}

/** 一条也不放。给「只想测别的 system」的单测用。 */
export function emptyFeeder(): FishFeeder {
  return { next: () => [] };
}

/**
 * 照单投喂：`at` 秒时放这条鱼。时间到了就发，**不管晚了多少**（大 dt 一次补齐），
 * 于是单测可以一步 `tick(5)` 直接跳到第 5 秒的局面。
 */
export function scriptedFeeder(script: readonly { at: number; spawn: FishSpawn }[]): FishFeeder {
  const queue = script.slice().sort((a, b) => a.at - b.at);
  let elapsed = 0;
  let i = 0;
  return {
    next(dt) {
      elapsed += dt;
      const out: FishSpawn[] = [];
      while (i < queue.length && queue[i].at <= elapsed) out.push(queue[i++].spawn);
      return out;
    },
  };
}

export interface RandomFeederOptions {
  /** 每隔这么久放一批（秒）。 */
  readonly interval?: number;
  /** 一批几条。调这两个数就能从「几十条」压到「两百条」（决策 G / 第三刀）。 */
  readonly batch?: number;
  /** 游速区间（像素/秒）。 */
  readonly minSpeed?: number;
  readonly maxSpeed?: number;
  readonly rand?: () => number;
}

/**
 * 单机随机投喂。**鱼种权重 ∝ 1/m** —— 大鱼罕见，一行式子而不是又一张手调的权重表；
 * 倍率已经是这条鱼的全部身份（见 `fish-kinds.ts`），罕见度跟着它走是自洽的。
 */
export function randomFeeder(options: RandomFeederOptions = {}): FishFeeder {
  const interval = options.interval ?? 0.6;
  const batch = options.batch ?? 2;
  const minSpeed = options.minSpeed ?? 90;
  const maxSpeed = options.maxSpeed ?? 190;
  const rand = options.rand ?? Math.random;

  const weights = FISH_KINDS.map((k) => 1 / k.m);
  const total = weights.reduce((a, b) => a + b, 0);

  const pickKind = (): number => {
    let r = rand() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i];
      if (r < 0) return i;
    }
    return weights.length - 1; // 浮点残差兜底
  };

  let acc = 0;
  return {
    next(dt) {
      acc += dt;
      const out: FishSpawn[] = [];
      // 大 dt 一次补齐（切后台回来、单测一步跳几秒），但**不无限补**：
      // 掉帧不该变成一次性倒进几百条鱼把这一帧彻底压死。
      let batches = 0;
      while (acc >= interval && batches < 4) {
        acc -= interval;
        batches++;
        for (let i = 0; i < batch; i++) {
          out.push({
            kind: pickKind(),
            pathId: Math.min(PATHS.length - 1, Math.floor(rand() * PATHS.length)),
            speed: minSpeed + rand() * (maxSpeed - minSpeed),
          });
        }
      }
      if (batches >= 4) acc = 0;
      return out;
    },
  };
}

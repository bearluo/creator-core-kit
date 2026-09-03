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
import { FISH_KINDS } from '../content/fish-kinds';
import { PATHS } from '../content/paths';
import type { FishContent } from '../content/content-types';

/**
 * 放一条鱼进来：什么种、走哪条路、多快（像素/秒），以及**它站在群里的哪个位置**。
 *
 * 后三个都可省 —— 省了就是一条散鱼，跟改造之前一模一样。随机底噪、单测逐条摆鱼都不必关心队形。
 */
export interface FishSpawn {
  readonly kind: number;
  readonly pathId: number;
  readonly speed: number;
  /** 侧向偏移（像素，正 = 前进方向左手边）。省略 = 0，正好压在路径中线上。 */
  readonly offset?: number;
  /** 群 id。同一群共享，**0 = 散鱼**（不参与分离、不摆）。 */
  readonly school?: number;
  /** 相位种子 ∈[0,1)。同群的鱼靠它摆得不同步。 */
  readonly seed?: number;
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

/**
 * 把几个投喂源合成一个。**合流发生在装配点**，不在 {@link waveFeeder} 内部 ——
 * 编辑器要的正是「只放鱼阵、不要底噪」，不合流就完事；反过来把随机源塞进鱼阵播放器里面，
 * 编辑器就得多一个「关掉底噪」的开关，而一旦漏关，编的人会以为那些随机鱼是自己摆的。
 *
 * ⚠️ 用 `flatMap` 不用 `[...a, ...b]`：数组字面量展开会被 Cocos 构建降级成 `[].concat(x)`。
 */
export function combineFeeders(...feeders: readonly FishFeeder[]): FishFeeder {
  return { next: (dt) => feeders.flatMap((f) => f.next(dt)) };
}

export interface WaveFeederOptions {
  /** 要播的阵 id 序列。不给就是表里全部，按表序。 */
  readonly order?: readonly string[];
  /** 播完最后一阵回到第一阵。默认 `false`（编辑器要的是「放一次看看」）。 */
  readonly loop?: boolean;
  /** 阵与阵之间的间隔（秒），从上一阵**投喂完毕**算起。见下方注释。 */
  readonly gap?: number;
}

/** 阵长至少一帧，否则一个「所有鱼都在第 0 秒进场」的阵配上 `loop` 会原地空转。 */
const MIN_WAVE_SPAN = 1 / 60;
/** 阵与阵之间的默认间隔。 */
const DEFAULT_WAVE_GAP = 3;

/**
 * 播一份**编好的鱼阵**。它是纯粹的表播放器：没有随机、没有 `rand` 注入，
 * 同一份 `content` + 同一串 `dt` 必吐出同一串 spawn —— 将来这套逻辑要在服务端重写一遍，
 * **确定性是能不能逐行对照的前提**。
 *
 * **id → 下标的转换就发生在这里**（载入的那一刻）：`FishSpawn` 里只装得下数字，而内容表用
 * 稳定字符串 id。**引用不到当场抛**，不许静默跳过 —— 静默跳过就是「这一阵少了两条鱼」，
 * 找起来极贵。
 *
 * **队形也在这里落地**：`dy` 原样传下去当侧向偏移，`dx` 换算成**进场延迟**
 * `(领队的 dx − 自己的 dx) / speed` 秒 —— 路径起点之前没有路可站，纵深只能用时间表达。
 * 于是「谁是领队」是算出来的（`dx` 最大那条），`at` 永远指领队进场那一刻。
 *
 * **接续判据是「上一阵投喂完毕 + `gap`」，不是等清场**：投喂器不动已经在场的鱼，下一阵开始
 * 不截断任何东西；等清场则每阵之间要空出十几秒（一队 8 条 `gap 0.3` 的阵 2.1 秒投完、
 * 却要 19 秒才游干净）。⚠️「清场」那个判据只属**编辑器的预览窗口**，别搬进来。
 */
export function waveFeeder(content: FishContent, options: WaveFeederOptions = {}): FishFeeder {
  const pathIndex = new Map(content.paths.map((p, i) => [p.id, i]));
  const kindIndex = new Map(FISH_KINDS.map((k, i) => [k.id, i]));
  const waveById = new Map(content.waves.map((w) => [w.id, w]));
  const order = options.order ?? content.waves.map((w) => w.id);
  const gap = options.gap ?? DEFAULT_WAVE_GAP;
  const loop = options.loop ?? false;

  // 群 id 在**载入时**发一遍，全表不重号。loop 播到第二遍时同一群会重号 —— 上一遍那群
  // 早游远了，最坏也只是两批同路径的鱼互相让一下位。
  let school = 0;
  // 载入即展开成「第几秒放哪条鱼」。运行期只做比较，不再查表。
  const plan = order.map((id) => {
    const wave = waveById.get(id);
    if (!wave) throw new Error(`[mini-fish] 未知鱼阵 '${id}'`);
    const queue: { at: number; spawn: FishSpawn }[] = [];
    for (const g of wave.groups) {
      const pathId = pathIndex.get(g.path);
      if (pathId === undefined) {
        throw new Error(`[mini-fish] 鱼阵 '${id}' 引用了未知路径 '${g.path}'`);
      }
      const kind = kindIndex.get(g.kind);
      if (kind === undefined) {
        throw new Error(`[mini-fish] 鱼阵 '${id}' 引用了未知鱼种 '${g.kind}'`);
      }
      const n = g.formation.length / 2;
      if (n < 1 || !Number.isInteger(n)) {
        throw new Error(`[mini-fish] 鱼阵 '${id}' 有一群的队形是 ${g.formation.length} 个数，该是 2n（n≥1）`);
      }
      // 速度是除数：0 会让延迟变成 Infinity ⇒ 这一群一条都不出，还不报错
      if (!(g.speed > 0)) throw new Error(`[mini-fish] 鱼阵 '${id}' 有一群的速度是 ${g.speed}`);
      // ui16 装不下就绕回来（跑一整天才可能撞上，撞上也只是两群互相躲一下）
      school = (school % 65535) + 1;
      let lead = -Infinity;
      for (let i = 0; i < n; i++) lead = Math.max(lead, g.formation[i * 2]);
      for (let i = 0; i < n; i++) {
        queue.push({
          at: g.at + (lead - g.formation[i * 2]) / g.speed,
          spawn: {
            kind,
            pathId,
            speed: g.speed,
            offset: g.formation[i * 2 + 1],
            school,
            seed: i / n,
          },
        });
      }
    }
    queue.sort((a, b) => a.at - b.at);
    const feedEnd = queue.length > 0 ? queue[queue.length - 1].at : 0;
    return { queue, span: Math.max(MIN_WAVE_SPAN, feedEnd + gap) };
  });

  let idx = 0;
  let elapsed = 0;
  let emitted = 0;
  let done = plan.length === 0;

  return {
    next(dt) {
      if (done) return [];
      elapsed += dt;
      const out: FishSpawn[] = [];
      // 大 dt 一次补齐（切后台回来、单测一步跳几秒）：不限批数，因为鱼阵是**时刻表**不是速率 ——
      // 少放一条就是这一阵缺了一条鱼。真正的量由内容自己决定，不该被投喂器偷偷截断。
      for (;;) {
        const cur = plan[idx];
        while (emitted < cur.queue.length && cur.queue[emitted].at <= elapsed) {
          out.push(cur.queue[emitted++].spawn);
        }
        if (elapsed < cur.span) break;
        elapsed -= cur.span;
        emitted = 0;
        idx++;
        if (idx < plan.length) continue;
        idx = 0;
        if (!loop) {
          done = true;
          break;
        }
      }
      return out;
    },
  };
}

/**
 * 接缝 ③：**炮台指令源** —— 谁决定这门炮这一帧开不开、朝哪开。
 *
 * 玩家那门是 {@link manualAgent}（View 把点击换算成角度递进来），另外三门是 {@link aiAgent}。
 * 联网时把 AI 换成网络下发即可，**接缝天天在跑**（决策 D1）—— 三个 AI 陪打不是装饰，
 * 它们的存在保证这条缝一直是活的，而不是一个从没被第二种实现验证过的接口。
 */
import { fishKind } from '../content/fish-kinds';

/** 场上一条鱼在 AI 眼里的样子。 */
export interface FishView {
  readonly eid: number;
  readonly kind: number;
  readonly x: number;
  readonly y: number;
}

/** 这一帧的鱼池快照。 */
export interface PoolView {
  readonly fish: readonly FishView[];
}

export interface CannonAgent {
  /** 每帧问一次：朝这个角度（弧度，+x 为 0）开炮，还是这一帧不开（null）。 */
  update(dt: number, view: PoolView): number | null;
}

/**
 * 玩家那门炮：View 调 {@link ManualAgent.aim} 把点击点记下来，下一帧 `update` 取走。
 *
 * 为什么要隔一帧而不是直接开：这样**玩家跟 AI 走的是同一条路** —— 都由 `FishVM.tick` 统一
 * 问指令、统一扣钱、统一生成子弹。一旦玩家有一条自己的捷径，联网时那条捷径就得再写一遍。
 */
export interface ManualAgent extends CannonAgent {
  /** 瞄向这个点（炮台坐标系外的世界坐标）。同一帧多次点击只算最后一次。 */
  aim(x: number, y: number): void;
}

export function manualAgent(cannonX: number, cannonY: number): ManualAgent {
  let pending: number | null = null;
  return {
    aim(x, y) {
      pending = Math.atan2(y - cannonY, x - cannonX);
    },
    update() {
      const angle = pending;
      pending = null;
      return angle;
    },
  };
}

export interface AiAgentOptions {
  readonly x: number;
  readonly y: number;
  /** 平均开火间隔（秒）。实际间隔在 0.5×~1.5× 之间抖动，免得三门 AI 齐射。 */
  readonly interval?: number;
  readonly rand?: () => number;
}

/**
 * AI 陪打：隔一阵子朝**场上倍率最高的那条鱼**开一炮，场上没鱼就不开。
 *
 * 瞄准策略只影响观感、不影响任何接缝（设计文档开放项 2），所以取最简单又确定的那个：
 * 挑最大的。间隔抖动是为了三门 AI 不同步 —— 齐射看着像 bug。
 */
export function aiAgent(options: AiAgentOptions): CannonAgent {
  const rand = options.rand ?? Math.random;
  const interval = options.interval ?? 1.2;
  let wait = interval * (0.5 + rand());

  return {
    update(dt, view) {
      wait -= dt;
      if (wait > 0) return null;
      wait = interval * (0.5 + rand());

      let best: FishView | undefined;
      let bestM = -1;
      for (const f of view.fish) {
        const m = fishKind(f.kind).m;
        if (m > bestM) {
          bestM = m;
          best = f;
        }
      }
      if (!best) return null;
      return Math.atan2(best.y - options.y, best.x - options.x);
    },
  };
}

import { getLogger, type ILogger } from '../logging';

/**
 * 池已达容量上限且无空闲实例可复用时 acquire() 抛出。
 * 仅在创建时设置了 max（>0）才可能发生；默认不限容量永不抛。
 */
export class PoolExhaustedError extends Error {
  constructor(max: number) {
    super(`ObjectPool: 已达容量上限 ${max}，且无空闲实例可复用`);
    this.name = 'PoolExhaustedError';
  }
}

export interface PoolOptions<T> {
  /** 造一个全新实例。空闲队列为空且未达上限时调用。 */
  factory: () => T;
  /** 归还入池时调用（清理本轮使用留下的状态）。默认无。 */
  reset?: (obj: T) => void;
  /** 借出时调用（取出复用或新建后都会调）。默认无。 */
  onAcquire?: (obj: T) => void;
  /** clear() 释放空闲实例时对每个实例调用（释放其占用的资源）。默认无。 */
  dispose?: (obj: T) => void;
  /** 实例总数（in-use + available）上限；>0 生效，0/省略 = 不限。 */
  max?: number;
  /** 注册时预建并入空闲队列的实例数，默认 0。超过 max 会收紧并告警。 */
  prewarm?: number;
  /** 告警日志（prewarm 越界 / 外来或重复 release）。默认 getLogger('ObjectPool')。 */
  logger?: ILogger;
}

export interface Pool<T> {
  /** 借出：优先复用空闲（LIFO），否则 factory() 新建；达上限且无空闲则抛 PoolExhaustedError。 */
  acquire(): T;
  /** 归还：外来对象 / 重复归还 / 已在池内 → 告警 no-op（不抛）。 */
  release(obj: T): void;
  /** 释放全部空闲实例（各调 dispose）并清空空闲队列；在借出的实例不受影响。保留配置，之后仍可 acquire。 */
  clear(): void;
  /** 已创建实例总数（in-use + available）。 */
  readonly size: number;
  /** 空闲队列长度。 */
  readonly available: number;
  /** 当前借出数。 */
  readonly inUse: number;
}

/**
 * 造一个泛型对象池（纯逻辑、零 cc）。复用高频 new/丢弃的对象，削峰实例化开销与 GC 抖动。
 * 归属判定用借出集合（Set），无需在对象上打标记；故 T 应为对象引用类型。
 */
export function createPool<T extends object>(opts: PoolOptions<T>): Pool<T> {
  const { factory, reset, onAcquire, dispose } = opts;
  const max = opts.max && opts.max > 0 ? Math.floor(opts.max) : 0;
  const logger = opts.logger ?? getLogger('ObjectPool');

  const free: T[] = []; // 空闲栈（LIFO）
  const inUse = new Set<T>(); // 借出集合，兼作归属判定

  const total = (): number => free.length + inUse.size;

  // 预热：越界收紧到 max
  let prewarm = opts.prewarm && opts.prewarm > 0 ? Math.floor(opts.prewarm) : 0;
  if (max > 0 && prewarm > max) {
    logger.warn(`createPool: prewarm(${prewarm}) 超过 max(${max})，已收紧到 ${max}`);
    prewarm = max;
  }
  for (let i = 0; i < prewarm; i++) {
    free.push(factory());
  }

  return {
    acquire(): T {
      let obj: T;
      if (free.length > 0) {
        obj = free.pop() as T;
      } else {
        if (max > 0 && total() >= max) {
          throw new PoolExhaustedError(max);
        }
        obj = factory();
      }
      inUse.add(obj);
      onAcquire?.(obj);
      return obj;
    },

    release(obj: T): void {
      if (!inUse.has(obj)) {
        logger.warn('release: 对象不在借出集合中（外来对象 / 重复归还 / 未经 acquire），已忽略');
        return;
      }
      inUse.delete(obj);
      reset?.(obj);
      free.push(obj);
    },

    clear(): void {
      if (dispose) {
        for (const obj of free) dispose(obj);
      }
      free.length = 0;
    },

    get size(): number {
      return total();
    },
    get available(): number {
      return free.length;
    },
    get inUse(): number {
      return inUse.size;
    },
  };
}

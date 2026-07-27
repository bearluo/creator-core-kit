import { createToken, getRootContainer, type Token } from '../di';
import { getLogger } from '../logging';

/**
 * 全局事件表：key = 事件名（'namespace:event' 过去时），value = payload 类型（无载荷用 void）。
 * 默认空 → 项目用 declaration merging 往本接口合并自己的全局事件：
 *   declare module '@cck/core' { interface EventMap { 'player:died': { score: number } } }
 * 不设 index signature——否则 keyof 退化为 string、payload 退化为 unknown，丧失编译期精确校验。
 * 模块私有事件用 createEventBus<具体接口>()，类型闭合不污染全局。
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface EventMap {}

/** 退订句柄：调用即退订对应订阅；幂等（重复调用无副作用，且不误伤后续同 handler 的新订阅）。 */
export type Disposer = () => void;

export interface OnOptions {
  /** true = 触发一次后自动退订（等价 once()）。 */
  once?: boolean;
  /** this 绑定 + 归属标识：handler 以该对象为 this 调用，且可被 offAll(target) 整体退订。 */
  target?: object;
}

export interface IEventBus<E extends EventMap = EventMap> {
  /** 订阅 key。返回 disposer（调用即退订）。同一 (key, handler, target) 重复订阅幂等（去重，不重复触发）。 */
  on<K extends keyof E>(key: K, handler: (payload: E[K]) => void, opts?: OnOptions): Disposer;
  /** 语法糖：on(key, handler, { once: true, ...opts })。触发一次后自动退订。 */
  once<K extends keyof E>(
    key: K,
    handler: (payload: E[K]) => void,
    opts?: Omit<OnOptions, 'once'>,
  ): Disposer;
  /** 退订指定 (key, handler[, target])。未订阅时空操作，不报错。 */
  off<K extends keyof E>(key: K, handler: (payload: E[K]) => void, target?: object): void;
  /** 退订 target（on 时传的对象）在所有事件上的全部订阅。用于组件 onDestroy 一行清理。 */
  offAll(target: object): void;
  /**
   * 同步派发 key：按订阅顺序（FIFO）依次调用当前订阅快照。
   * 派发期间的 on/off 只影响下一次 emit（重入安全）。void 事件可省 payload：emit('ui:ready')。
   * 某 listener 抛异常被隔离（经 onError 上报）并继续派发其余。
   */
  emit<K extends keyof E>(key: K, ...args: E[K] extends void ? [] : [payload: E[K]]): void;
  /** 是否存在至少一个订阅。 */
  has<K extends keyof E>(key: K): boolean;
  /** 指定事件当前订阅数。 */
  listenerCount<K extends keyof E>(key: K): number;
  /** 旁路监听全部事件（调试面板 / 埋点）。常规业务用 on()。返回 disposer。 */
  onAny(handler: (key: keyof E, payload: E[keyof E]) => void): Disposer;
  /** 清空指定事件的全部订阅；不传 key 时清空所有事件 + onAny（测试隔离 / 场景切换重置）。 */
  clear<K extends keyof E>(key?: K): void;
}

/** 内部订阅记录。 */
interface Subscription {
  handler: (payload: unknown) => void;
  once: boolean;
  target: object | undefined;
}

type AnyHandler<E extends EventMap> = (key: keyof E, payload: E[keyof E]) => void;

class EventBusImpl<E extends EventMap> implements IEventBus<E> {
  private readonly _listeners = new Map<keyof E, Subscription[]>();
  private readonly _anyListeners: AnyHandler<E>[] = [];
  private readonly _onError: (err: unknown, key: keyof E) => void;

  constructor(onError: (err: unknown, key: keyof E) => void) {
    this._onError = onError;
  }

  on<K extends keyof E>(key: K, handler: (payload: E[K]) => void, opts?: OnOptions): Disposer {
    const target = opts?.target;
    const once = opts?.once ?? false;
    const h = handler as (payload: unknown) => void;
    let bucket = this._listeners.get(key);
    if (!bucket) {
      bucket = [];
      this._listeners.set(key, bucket);
    }
    // 幂等去重：(key, handler, target) 已存在则复用其订阅，返回退订该订阅的 disposer。
    const existing = bucket.find((s) => s.handler === h && s.target === target);
    const sub: Subscription = existing ?? { handler: h, once, target };
    if (!existing) bucket.push(sub);
    return this._disposerFor(key, sub);
  }

  once<K extends keyof E>(
    key: K,
    handler: (payload: E[K]) => void,
    opts?: Omit<OnOptions, 'once'>,
  ): Disposer {
    return this.on(key, handler, { ...opts, once: true });
  }

  off<K extends keyof E>(key: K, handler: (payload: E[K]) => void, target?: object): void {
    const bucket = this._listeners.get(key);
    if (!bucket) return;
    const h = handler as (payload: unknown) => void;
    const i = bucket.findIndex((s) => s.handler === h && s.target === target);
    if (i >= 0) bucket.splice(i, 1);
    if (bucket.length === 0) this._listeners.delete(key);
  }

  offAll(target: object): void {
    for (const [key, bucket] of this._listeners) {
      for (let i = bucket.length - 1; i >= 0; i--) {
        if (bucket[i].target === target) bucket.splice(i, 1);
      }
      if (bucket.length === 0) this._listeners.delete(key);
    }
  }

  emit<K extends keyof E>(key: K, ...args: E[K] extends void ? [] : [payload: E[K]]): void {
    const payload = (args as unknown as [E[K]])[0];
    const bucket = this._listeners.get(key);
    if (bucket && bucket.length > 0) {
      // 快照：派发期间对本事件的 on/off 只影响下一次 emit（重入安全）。
      const snapshot = bucket.slice();
      for (const sub of snapshot) {
        try {
          if (sub.target) sub.handler.call(sub.target, payload);
          else sub.handler(payload);
        } catch (e) {
          this._onError(e, key); // 错误隔离：一个坏订阅不拖垮整轮广播。
        }
        if (sub.once) this._removeSub(key, sub);
      }
    }
    if (this._anyListeners.length > 0) {
      const anySnapshot = this._anyListeners.slice();
      for (const h of anySnapshot) {
        try {
          h(key, payload as E[keyof E]);
        } catch (e) {
          this._onError(e, key);
        }
      }
    }
  }

  has<K extends keyof E>(key: K): boolean {
    const bucket = this._listeners.get(key);
    return !!bucket && bucket.length > 0;
  }

  listenerCount<K extends keyof E>(key: K): number {
    return this._listeners.get(key)?.length ?? 0;
  }

  onAny(handler: (key: keyof E, payload: E[keyof E]) => void): Disposer {
    this._anyListeners.push(handler);
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      const i = this._anyListeners.indexOf(handler);
      if (i >= 0) this._anyListeners.splice(i, 1);
    };
  }

  clear<K extends keyof E>(key?: K): void {
    if (key === undefined) {
      this._listeners.clear();
      this._anyListeners.length = 0;
    } else {
      this._listeners.delete(key);
    }
  }

  /** 造一个绑定到具体 Subscription 对象的 disposer：按对象身份精确移除 + 幂等（不误伤新订阅）。 */
  private _disposerFor(key: keyof E, sub: Subscription): Disposer {
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      this._removeSub(key, sub);
    };
  }

  private _removeSub(key: keyof E, sub: Subscription): void {
    const bucket = this._listeners.get(key);
    if (!bucket) return;
    const i = bucket.indexOf(sub);
    if (i >= 0) bucket.splice(i, 1);
    if (bucket.length === 0) this._listeners.delete(key);
  }
}

/** 造事件总线。onError 默认经 getLogger('EventBus').error 上报（错误隔离）。 */
export function createEventBus<E extends EventMap = EventMap>(opts?: {
  onError?: (err: unknown, key: keyof E) => void;
}): IEventBus<E> {
  const onError =
    opts?.onError ??
    ((err: unknown, key: keyof E) =>
      getLogger('EventBus').error(`listener error on "${String(key)}":`, err));
  return new EventBusImpl<E>(onError);
}

/** DI token：engine/项目可 register 覆盖全局总线实现（见 di-container）。 */
export const EVENT_BUS: Token<IEventBus> = createToken<IEventBus>('cck.eventbus');

let _default: IEventBus | undefined;
function defaultBus(): IEventBus {
  _default ??= createEventBus();
  return _default;
}

/**
 * 便捷取用全局总线：优先 getRootContainer().tryResolve(EVENT_BUS)；未注册则用进程级默认实例
 * （不自动注册进容器，避免副作用）。泛型 E 仅做类型断言，运行时是同一个全局实例。
 */
export function getEventBus<E extends EventMap = EventMap>(): IEventBus<E> {
  return (getRootContainer().tryResolve(EVENT_BUS) ?? defaultBus()) as IEventBus<E>;
}

/**
 * 响应式原语：signal / computed / effect —— MVVM 数据绑定的 core 地基（纯 TS、零 cc）。
 * 自动 getter 依赖追踪：跑 effect 时读到的 signal 自动成为其依赖，改值 → 依赖它的 effect 重跑。
 * 语义仿 @preact/signals-core，命名对齐 Vue（.value）。设计见 docs/modules/reactive.md。
 *
 * ponytail: 朴素同步 push，无 glitch-free 拓扑调度——菱形依赖至多一次冗余重算（UI 无害）。
 * 升级路径：加 batch() 微任务 flush 去重，或整包 vendor @preact/signals-core（API 同构）。
 */

export type Dispose = () => void;

/** 只读响应式值。读 .value 会在当前 effect 内建立依赖；peek() 读值但不建立依赖。 */
export interface ReadSignal<T> {
  readonly value: T;
  /** 读当前值但不订阅（effect 内只想取值、不想因它重跑时用）。 */
  peek(): T;
}

/** 可写响应式值。setter 用 Object.is 幂等——值未变不通知（天然挡双向绑定回环）。 */
export interface Signal<T> extends ReadSignal<T> {
  value: T;
}

// —— 内部：生产者（可被读/追踪）与订阅者（会因依赖变而重跑）——
interface Producer {
  _subs: Set<Subscriber>;
}
interface Subscriber {
  _deps: Set<Producer>;
  _alive: boolean;
  _notify(): void;
}

/** 当前正在运行的订阅者（effect 或 computed 的重算）。读 signal 时以它登记依赖。 */
let activeSub: Subscriber | undefined;

/** 读时登记：把 activeSub 与 producer 双向挂钩。 */
function track(p: Producer): void {
  if (activeSub) {
    p._subs.add(activeSub);
    activeSub._deps.add(p);
  }
}

/** 写后通知：遍历订阅者快照逐个重跑（快照防重入期间 _subs 变动）。 */
function trigger(p: Producer): void {
  for (const s of [...p._subs]) {
    if (s._alive) s._notify();
  }
}

/** 断开订阅者与其当前全部依赖的双向挂钩（重跑前 / dispose 时调）。 */
function cleanupDeps(sub: Subscriber): void {
  for (const dep of sub._deps) dep._subs.delete(sub);
  sub._deps.clear();
}

/** 以 sub 为当前订阅者跑 fn（sub=undefined 即 untracked）；结束恢复上一个。 */
function runWith<T>(sub: Subscriber | undefined, fn: () => T): T {
  const prev = activeSub;
  activeSub = sub;
  try {
    return fn();
  } finally {
    activeSub = prev;
  }
}

class SignalImpl<T> implements Signal<T>, Producer {
  readonly _subs = new Set<Subscriber>();
  private _v: T;
  constructor(initial: T) {
    this._v = initial;
  }
  get value(): T {
    track(this);
    return this._v;
  }
  set value(next: T) {
    if (Object.is(next, this._v)) return; // 幂等：值未变不通知（挡「值→控件→事件→值」回环）
    this._v = next;
    trigger(this);
  }
  peek(): T {
    return this._v;
  }
}

class EffectImpl implements Subscriber {
  readonly _deps = new Set<Producer>();
  _alive = true;
  private readonly _fn: () => void | Dispose;
  private _cleanup: void | Dispose = undefined;
  constructor(fn: () => void | Dispose) {
    this._fn = fn;
    this._run();
  }
  _notify(): void {
    this._run();
  }
  private _run(): void {
    if (!this._alive) return;
    this._runCleanup();
    cleanupDeps(this);
    this._cleanup = runWith(this, () => this._fn());
  }
  private _runCleanup(): void {
    if (typeof this._cleanup === 'function') {
      const c = this._cleanup;
      this._cleanup = undefined;
      c();
    }
  }
  dispose(): void {
    if (!this._alive) return; // 幂等
    this._alive = false;
    this._runCleanup();
    cleanupDeps(this);
  }
}

class ComputedImpl<T> implements ReadSignal<T>, Producer, Subscriber {
  readonly _subs = new Set<Subscriber>();
  readonly _deps = new Set<Producer>();
  _alive = true;
  private _dirty = true;
  private _v: T | undefined;
  private readonly _getter: () => T;
  constructor(getter: () => T) {
    this._getter = getter;
  }
  /** 依赖变：标脏并向下游传播（惰性——下游重算时才真正取新值）。 */
  _notify(): void {
    if (!this._dirty) {
      this._dirty = true;
      trigger(this);
    }
  }
  get value(): T {
    track(this); // 下游读者订阅本 computed
    if (this._dirty) this._recompute();
    return this._v as T;
  }
  peek(): T {
    if (this._dirty) this._recompute();
    return this._v as T;
  }
  private _recompute(): void {
    cleanupDeps(this);
    this._v = runWith(this, () => this._getter());
    this._dirty = false;
  }
}

/** 造一个可写 signal。 */
export function signal<T>(initial: T): Signal<T> {
  return new SignalImpl(initial);
}

/** 惰性 + 缓存的派生值：只在被读时求值，依赖变才失效重算；无人读则不算。 */
export function computed<T>(getter: () => T): ReadSignal<T> {
  return new ComputedImpl(getter);
}

/**
 * 副作用：立即同步跑一次并收集依赖；此后任一依赖变化即重跑。
 * fn 可返回清理函数，在「下次重跑前」和「dispose 时」被调用（如反注册 cc 事件）。
 * 返回 dispose：退订全部依赖 + 跑最后一次清理（幂等）。
 */
export function effect(fn: () => void | Dispose): Dispose {
  const e = new EffectImpl(fn);
  return () => e.dispose();
}

/** 读值时不建立任何依赖（effect 内「看一眼别的 signal 但不想被它触发」时用）。 */
export function untracked<T>(fn: () => T): T {
  return runWith(undefined, fn);
}

import type { Token } from './token';

/** 服务生命周期。 */
export type Lifetime = 'singleton' | 'transient' | 'containerScoped';

/** 三种注册方式：常量 / 工厂（按生命周期）/ token 重定向（alias）。 */
export type Provider<T> =
  | { useValue: T }
  | { useFactory: (c: Container) => T; lifetime?: Lifetime /* 默认 singleton */ }
  | { useToken: Token<T> };

/** 可选清理协议：dispose 作用域时自动调用本层注册服务的 dispose()。 */
export interface Disposable {
  dispose(): void;
}

/** 层级作用域 DI 容器。 */
export interface Container {
  readonly name: string;
  readonly parent: Container | null;

  /** 注册到本层。默认重复注册抛错；allowOverride 显式覆盖并清旧缓存。 */
  register<T>(token: Token<T>, provider: Provider<T>, opts?: { allowOverride?: boolean }): void;
  /** 解析：本层 → parent 链 → 根；全链 miss 抛错。 */
  resolve<T>(token: Token<T>): T;
  /** 同 resolve，但全链 miss 返回 undefined。 */
  tryResolve<T>(token: Token<T>): T | undefined;
  /** 沿链存在性检查。 */
  has<T>(token: Token<T>): boolean;
  /** 只查本层。 */
  hasLocal<T>(token: Token<T>): boolean;
  /** 注销本层注册（含清缓存）。 */
  unregister<T>(token: Token<T>): void;
  /** 建子作用域（parent=this）。 */
  createScope(name?: string): Container;
  /** 释放本作用域：级联子作用域 → dispose 本层 Disposable → 清表 → 从 parent 摘除。根不可 dispose。 */
  dispose(): void;
}

interface Entry {
  provider: Provider<unknown>;
  singleton: unknown;
  hasSingleton: boolean;
}

/** resolve 未命中的哨兵（区别于合法的 undefined 值）。 */
const MISS: unique symbol = Symbol('cck.di.miss');
/** alias 链最大深度，超出视为成环。 */
const ALIAS_MAX_DEPTH = 32;

function isDisposable(v: unknown): v is Disposable {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as { dispose?: unknown }).dispose === 'function'
  );
}

class ContainerImpl implements Container {
  readonly name: string;
  readonly parent: ContainerImpl | null;
  private readonly _local = new Map<symbol, Entry>();
  private readonly _children = new Set<ContainerImpl>();
  private readonly _scoped = new Map<symbol, unknown>(); // containerScoped：本容器发起的实例缓存
  private readonly _isRoot: boolean;
  private _disposed = false;

  constructor(name: string, parent: ContainerImpl | null, isRoot: boolean) {
    this.name = name;
    this.parent = parent;
    this._isRoot = isRoot;
  }

  register<T>(token: Token<T>, provider: Provider<T>, opts?: { allowOverride?: boolean }): void {
    this._assertLive();
    if (this._local.has(token.key) && !opts?.allowOverride) {
      throw new Error(`DI: token "${token.name}" already registered in scope "${this.name}"`);
    }
    this._local.set(token.key, {
      provider: provider as Provider<unknown>,
      singleton: undefined,
      hasSingleton: false,
    });
    this._scoped.delete(token.key);
  }

  resolve<T>(token: Token<T>): T {
    this._assertLive();
    const r = this._resolve(token, this, 0);
    if (r === MISS) {
      throw new Error(`DI: no provider for token "${token.name}" (scope "${this.name}")`);
    }
    return r;
  }

  tryResolve<T>(token: Token<T>): T | undefined {
    this._assertLive();
    const r = this._resolve(token, this, 0);
    return r === MISS ? undefined : r;
  }

  has<T>(token: Token<T>): boolean {
    if (this._local.has(token.key)) return true;
    return this.parent ? this.parent.has(token) : false;
  }

  hasLocal<T>(token: Token<T>): boolean {
    return this._local.has(token.key);
  }

  unregister<T>(token: Token<T>): void {
    this._assertLive();
    this._local.delete(token.key);
    this._scoped.delete(token.key);
  }

  createScope(name?: string): Container {
    this._assertLive();
    const child = new ContainerImpl(name ?? `${this.name}.scope`, this, false);
    this._children.add(child);
    return child;
  }

  dispose(): void {
    if (this._isRoot) throw new Error('DI: root container cannot be disposed');
    if (this._disposed) return;
    this._disposed = true;
    for (const child of [...this._children]) child.dispose();
    this._children.clear();
    for (const entry of this._local.values()) {
      const p = entry.provider;
      if ('useValue' in p) this._tryDispose(p.useValue);
      else if (entry.hasSingleton) this._tryDispose(entry.singleton);
    }
    for (const v of this._scoped.values()) this._tryDispose(v);
    this._local.clear();
    this._scoped.clear();
    if (this.parent) this.parent._children.delete(this);
  }

  private _resolve<T>(token: Token<T>, origin: ContainerImpl, depth: number): T | typeof MISS {
    const entry = this._local.get(token.key);
    if (entry) return this._instantiate(entry, token, origin, depth) as T;
    if (this.parent) return this.parent._resolve(token, origin, depth);
    return MISS;
  }

  private _instantiate<T>(entry: Entry, token: Token<T>, origin: ContainerImpl, depth: number): unknown {
    const p = entry.provider;
    if ('useValue' in p) return p.useValue;
    if ('useToken' in p) {
      if (depth >= ALIAS_MAX_DEPTH) {
        throw new Error(`DI: alias chain too deep for token "${token.name}" (possible cycle)`);
      }
      const r = origin._resolve(p.useToken, origin, depth + 1);
      if (r === MISS) {
        throw new Error(`DI: alias target "${p.useToken.name}" not registered (from "${token.name}")`);
      }
      return r;
    }
    const lifetime = p.lifetime ?? 'singleton';
    if (lifetime === 'transient') return p.useFactory(origin);
    if (lifetime === 'containerScoped') {
      if (origin._scoped.has(token.key)) return origin._scoped.get(token.key);
      const v = p.useFactory(origin);
      origin._scoped.set(token.key, v);
      return v;
    }
    // singleton：缓存在拥有该注册的这一层（this），依赖从本层链解析
    if (entry.hasSingleton) return entry.singleton;
    const v = p.useFactory(this);
    entry.singleton = v;
    entry.hasSingleton = true;
    return v;
  }

  private _tryDispose(v: unknown): void {
    if (isDisposable(v)) v.dispose();
  }

  private _assertLive(): void {
    if (this._disposed) throw new Error(`DI: scope "${this.name}" already disposed`);
  }
}

const ROOT_KEY = Symbol.for('cck.di.root');

/** 全局根容器（挂 globalThis[Symbol.for('cck.di.root')]，跨 bundle 唯一，首个初始化者胜出）。 */
export function getRootContainer(): Container {
  const store = globalThis as unknown as Record<symbol, unknown>;
  let root = store[ROOT_KEY] as ContainerImpl | undefined;
  if (!root) {
    root = new ContainerImpl('root', null, true);
    store[ROOT_KEY] = root;
  }
  return root;
}

/** 便捷门面（轻）：根容器 resolve/tryResolve 的糖。绝不缓存结果——每次走 resolve，防跨 bundle 分裂。 */
export const cck = {
  resolve<T>(token: Token<T>): T {
    return getRootContainer().resolve(token);
  },
  tryResolve<T>(token: Token<T>): T | undefined {
    return getRootContainer().tryResolve(token);
  },
  get container(): Container {
    return getRootContainer();
  },
};

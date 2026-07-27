import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createToken,
  getRootContainer,
  cck,
  type Container,
  type Disposable,
} from '../index';

describe('createToken', () => {
  it('1. 同名两次 → key 相同（Symbol.for）；异名 → key 不同', () => {
    expect(createToken('a.same').key).toBe(createToken('a.same').key);
    expect(createToken('a.x').key).not.toBe(createToken('a.y').key);
  });
});

describe('Container 基础', () => {
  let scope: Container;
  beforeEach(() => {
    scope = getRootContainer().createScope('t');
  });
  afterEach(() => {
    scope.dispose();
  });

  it('2. useValue register + resolve', () => {
    const T = createToken<number>('v.num');
    scope.register(T, { useValue: 42 });
    expect(scope.resolve(T)).toBe(42);
  });

  it('3. singleton factory：多次 resolve 同一实例、factory 只调一次', () => {
    const T = createToken<object>('v.singleton');
    let calls = 0;
    scope.register(T, {
      useFactory: () => {
        calls++;
        return {};
      },
    });
    const a = scope.resolve(T);
    const b = scope.resolve(T);
    expect(a).toBe(b);
    expect(calls).toBe(1);
  });

  it('3b. transient factory：每次新实例、factory 每次调', () => {
    const T = createToken<object>('v.transient');
    let calls = 0;
    scope.register(T, {
      useFactory: () => {
        calls++;
        return {};
      },
      lifetime: 'transient',
    });
    const a = scope.resolve(T);
    const b = scope.resolve(T);
    expect(a).not.toBe(b);
    expect(calls).toBe(2);
  });

  it('4. resolve 未注册 → 抛错（含 token 名）；tryResolve → undefined', () => {
    const T = createToken('v.missing');
    expect(() => scope.resolve(T)).toThrow(/v\.missing/);
    expect(scope.tryResolve(T)).toBeUndefined();
  });

  it('5. has / hasLocal', () => {
    const T = createToken('v.has');
    expect(scope.has(T)).toBe(false);
    scope.register(T, { useValue: 1 });
    expect(scope.has(T)).toBe(true);
    expect(scope.hasLocal(T)).toBe(true);
  });

  it('6. 重复 register 抛错；allowOverride 覆盖且清旧 singleton', () => {
    const T = createToken<number>('v.dup');
    scope.register(T, { useValue: 1 });
    expect(() => scope.register(T, { useValue: 2 })).toThrow(/already registered/);
    scope.register(T, { useValue: 2 }, { allowOverride: true });
    expect(scope.resolve(T)).toBe(2);

    const S = createToken<{ v: number }>('v.dup.singleton');
    scope.register(S, { useFactory: () => ({ v: 1 }) });
    const first = scope.resolve(S);
    scope.register(S, { useFactory: () => ({ v: 2 }) }, { allowOverride: true });
    const second = scope.resolve(S);
    expect(second).not.toBe(first);
    expect(second.v).toBe(2);
  });

  it('7. unregister → 之后 resolve 抛错、缓存清除', () => {
    const T = createToken<number>('v.unreg');
    scope.register(T, { useValue: 5 });
    scope.unregister(T);
    expect(() => scope.resolve(T)).toThrow();
    expect(scope.has(T)).toBe(false);
  });
});

describe('层级作用域', () => {
  let base: Container;
  beforeEach(() => {
    base = getRootContainer().createScope('base');
  });
  afterEach(() => {
    base.dispose();
  });

  it('8. 子作用域 resolve 命中父层服务（向上回退）', () => {
    const T = createToken<string>('h.up');
    base.register(T, { useValue: 'parent' });
    const child = base.createScope('child');
    expect(child.resolve(T)).toBe('parent');
  });

  it('9. shadow：子层 register 同名 → 子命中子实现，父/兄弟不受影响', () => {
    const T = createToken<string>('h.shadow');
    base.register(T, { useValue: 'parent' });
    const a = base.createScope('a');
    const b = base.createScope('b');
    a.register(T, { useValue: 'childA' });
    expect(a.resolve(T)).toBe('childA');
    expect(b.resolve(T)).toBe('parent');
    expect(base.resolve(T)).toBe('parent');
  });

  it('10. 隔离：子层注册不泄漏到父与兄弟', () => {
    const T = createToken<number>('h.iso');
    const a = base.createScope('a');
    const b = base.createScope('b');
    a.register(T, { useValue: 1 });
    expect(base.has(T)).toBe(false);
    expect(b.has(T)).toBe(false);
  });

  it('11. 父层 singleton 被多个子作用域共享同一实例', () => {
    const T = createToken<object>('h.shared');
    base.register(T, { useFactory: () => ({}) });
    const a = base.createScope('a');
    const b = base.createScope('b');
    expect(a.resolve(T)).toBe(b.resolve(T));
  });

  it('12. dispose 级联 + Disposable + 之后 resolve/建 scope 抛错', () => {
    const T = createToken<Disposable>('h.disp');
    let disposed = 0;
    const parent = base.createScope('p');
    parent.register(T, {
      useFactory: () => ({
        dispose: () => {
          disposed++;
        },
      }),
    });
    const child = parent.createScope('c');
    child.resolve(T); // 触发父层 singleton 实例化（缓存在父层）
    parent.dispose();
    expect(disposed).toBe(1);
    expect(() => parent.resolve(T)).toThrow(/disposed/);
    expect(() => child.createScope('x')).toThrow(/disposed/); // 子作用域被级联 dispose
  });
});

describe('全局根 + 门面', () => {
  it('13. getRootContainer 幂等；根 dispose 抛错', () => {
    expect(getRootContainer()).toBe(getRootContainer());
    expect(() => getRootContainer().dispose()).toThrow(/root/);
  });

  it('17. 门面 cck.resolve === getRootContainer().resolve；container 指向根', () => {
    const T = createToken<number>('f.facade');
    getRootContainer().register(T, { useValue: 7 });
    expect(cck.resolve(T)).toBe(7);
    expect(cck.container).toBe(getRootContainer());
    getRootContainer().unregister(T); // 清理，避免污染全局根
  });

  it('17b. cck.tryResolve 未注册 → undefined', () => {
    expect(cck.tryResolve(createToken('f.none'))).toBeUndefined();
  });
});

describe('跨 bundle 一致性', () => {
  let scope: Container;
  beforeEach(() => {
    scope = getRootContainer().createScope('xb');
  });
  afterEach(() => {
    scope.dispose();
  });

  it('14. 同名不同对象 token（模拟单 bundle 复制）→ 命中同一注册', () => {
    const T1 = createToken<number>('xb.dup');
    const T2 = createToken<number>('xb.dup');
    expect(T1).not.toBe(T2); // 不同对象
    scope.register(T1, { useValue: 99 });
    expect(scope.resolve(T2)).toBe(99); // 但 key 相同 → 命中
  });
});

describe('containerScoped', () => {
  let base: Container;
  beforeEach(() => {
    base = getRootContainer().createScope('cs');
  });
  afterEach(() => {
    base.dispose();
  });

  it('15. 每作用域各一份、作用域内复用', () => {
    const T = createToken<object>('cs.each');
    base.register(T, { useFactory: () => ({}), lifetime: 'containerScoped' });
    const a = base.createScope('a');
    const b = base.createScope('b');
    const a1 = a.resolve(T);
    const a2 = a.resolve(T);
    const b1 = b.resolve(T);
    expect(a1).toBe(a2); // 同作用域复用
    expect(a1).not.toBe(b1); // 不同作用域各一份
  });
});

describe('useToken alias', () => {
  let scope: Container;
  beforeEach(() => {
    scope = getRootContainer().createScope('alias');
  });
  afterEach(() => {
    scope.dispose();
  });

  it('16. alias 指向同一实例；成环超深度 → 抛错', () => {
    const B = createToken<object>('al.b');
    const A = createToken<object>('al.a');
    scope.register(B, { useFactory: () => ({}) });
    scope.register(A, { useToken: B });
    expect(scope.resolve(A)).toBe(scope.resolve(B));

    const X = createToken<object>('al.x');
    const Y = createToken<object>('al.y');
    scope.register(X, { useToken: Y });
    scope.register(Y, { useToken: X });
    expect(() => scope.resolve(X)).toThrow(/deep|cycle/);
  });

  it('16b. alias 目标未注册 → 抛错', () => {
    const A = createToken<object>('al.orphan');
    const B = createToken<object>('al.orphan.target');
    scope.register(A, { useToken: B });
    expect(() => scope.resolve(A)).toThrow(/not registered/);
  });
});

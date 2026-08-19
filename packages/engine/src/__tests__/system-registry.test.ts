import { describe, expect, it } from 'vitest';
import { dropBundleModules } from '../system-registry';
import type { SysLoad, SystemLike } from '../system-registry';

/**
 * 造一个形状对得上 Cocos 3.8.7 web 产物的假 SystemJS：
 * 模块表挂在唯一的 symbol 键上，declare 表是普通属性 `registerRegistry`。
 */
function makeSystem(loads: Record<string, SysLoad>, declares?: Record<string, unknown>): SystemLike {
  const sys = { registerRegistry: declares ?? { ...loads } } as SystemLike;
  sys[Symbol('SystemJS registry')] = loads;
  return sys;
}

/** 一个 bundle 的最小形状：入口 chunk + 它依赖的若干模块。 */
function makeBundle(name: string, deps: SysLoad[]): Record<string, SysLoad> {
  const entryId = `chunks:///_virtual/${name}`;
  const loads: Record<string, SysLoad> = { [entryId]: { id: entryId, d: deps } };
  for (const d of deps) loads[d.id] = d;
  loads[`virtual:///prerequisite-imports/${name}`] = { id: `virtual:///prerequisite-imports/${name}` };
  return loads;
}

describe('dropBundleModules', () => {
  it('清掉入口 chunk / 全部依赖 / prerequisite-imports 三处，两张表都删', () => {
    const loads = makeBundle('shop', [{ id: 'a.ts', n: {} }, { id: 'b.ts', n: {} }]);
    const declares = { ...loads } as Record<string, unknown>;
    const sys = makeSystem(loads, declares);

    expect(dropBundleModules(sys, 'shop')).toEqual([]);
    expect(Object.keys(loads)).toEqual([]);
    expect(Object.keys(declares)).toEqual([]);
  });

  it('返回依赖模块导出的函数 —— 那就是要拿去 unregisterClass 的类', () => {
    class ShopPanel {}
    class ShopItem {}
    const sys = makeSystem(
      makeBundle('shop', [{ id: 'a.ts', n: { ShopPanel, ShopItem } }]),
    );
    expect(dropBundleModules(sys, 'shop')).toEqual([ShopPanel, ShopItem]);
  });

  it('非函数导出不进注销列表（常量 / 配置对象照样导出，注销它们会抛）', () => {
    class Real {}
    const sys = makeSystem(
      makeBundle('shop', [{ id: 'a.ts', n: { Real, TAG: '[SHOP]', CFG: { n: 1 }, nil: null } }]),
    );
    expect(dropBundleModules(sys, 'shop')).toEqual([Real]);
  });

  // —— namespace 挂哪个字段跨版本会变，三条形状断言是这个模块存在的理由 ——

  it('namespace 在 `n` 上时认（3.8.7 web 产物的形状）', () => {
    class A {}
    const sys = makeSystem(makeBundle('shop', [{ id: 'a.ts', n: { A } }]));
    expect(dropBundleModules(sys, 'shop')).toEqual([A]);
  });

  it('namespace 在 `C` 上时也认（另一些 SystemJS 版本）', () => {
    class A {}
    const sys = makeSystem(makeBundle('shop', [{ id: 'a.ts', C: { A } }]));
    expect(dropBundleModules(sys, 'shop')).toEqual([A]);
  });

  it('3.8.7 形状（`n` = namespace，`C` = completion promise）→ 取 `n`', () => {
    class A {}
    const sys = makeSystem(
      makeBundle('shop', [{ id: 'a.ts', n: { A }, C: Promise.resolve('completion') }]),
    );
    expect(dropBundleModules(sys, 'shop')).toEqual([A]);
  });

  it('promise 一律跳过，继续往后找 —— 按形状挑不按字段名赌，否则一个类都注销不到（类换了、界面没换）', () => {
    class A {}
    // 反过来的形状：`n` 是 promise、namespace 在 `C` 上。少了 promise 守卫就会拿走 `n`，
    // `Object.keys(promise)` 为空 → 静默注销 0 个类。
    const sys = makeSystem(makeBundle('shop', [{ id: 'a.ts', n: Promise.resolve('x'), C: { A } }]));
    expect(dropBundleModules(sys, 'shop')).toEqual([A]);
  });

  it('两个字段都是对象时取 `n`（不重复收，也不拿 `C` 兜底）', () => {
    class FromN {}
    class FromC {}
    const sys = makeSystem(makeBundle('shop', [{ id: 'a.ts', n: { FromN }, C: { FromC } }]));
    expect(dropBundleModules(sys, 'shop')).toEqual([FromN]);
  });

  // —— 四条短路：返回 null 表示「什么都没清」，与「清了但没类」（空数组）语义不同 ——

  it('没有 System（native / 编辑器）→ null，不抛', () => {
    expect(dropBundleModules(undefined, 'shop')).toBeNull();
  });

  it('declare 表缺失 → null，且模块表一个都不删（半清比不清更糟）', () => {
    const loads = makeBundle('shop', [{ id: 'a.ts', n: {} }]);
    const sys = { ...makeSystem(loads) } as SystemLike;
    delete sys.registerRegistry;

    expect(dropBundleModules(sys, 'shop')).toBeNull();
    expect(Object.keys(loads)).toHaveLength(3);
  });

  it('入口 chunk 不在表里（该 bundle 从没加载过）→ null，且不误删同表里别的 bundle', () => {
    const loads = makeBundle('lobby', [{ id: 'a.ts', n: {} }]);
    const sys = makeSystem(loads);

    expect(dropBundleModules(sys, 'shop')).toBeNull();
    expect(loads['chunks:///_virtual/lobby']).toBeDefined();
  });

  it('依赖表为 null（入口无依赖）→ 不抛，仍清掉入口与 prerequisite-imports', () => {
    const loads: Record<string, SysLoad> = {
      'chunks:///_virtual/shop': { id: 'chunks:///_virtual/shop', d: null },
      'virtual:///prerequisite-imports/shop': { id: 'virtual:///prerequisite-imports/shop' },
    };
    const sys = makeSystem(loads);

    expect(dropBundleModules(sys, 'shop')).toEqual([]);
    expect(Object.keys(loads)).toEqual([]);
  });

  it('只动目标 bundle：另一个 bundle 的入口与模块原样留着', () => {
    const loads = { ...makeBundle('shop', [{ id: 'shop/a.ts', n: {} }]), ...makeBundle('lobby', [{ id: 'lobby/a.ts', n: {} }]) };
    const sys = makeSystem(loads);

    dropBundleModules(sys, 'shop');
    expect(Object.keys(loads).sort()).toEqual([
      'chunks:///_virtual/lobby',
      'lobby/a.ts',
      'virtual:///prerequisite-imports/lobby',
    ]);
  });
});

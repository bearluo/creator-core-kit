import { describe, expect, it } from 'vitest';
import { createBundleGraph, DEFAULT_ALWAYS_ALLOWED, type BundleSpec } from '../bundle-graph';
import { LogLevel, type ILogger } from '../../logging';

function fakeLogger(): { logger: ILogger; warns: unknown[][] } {
  const warns: unknown[][] = [];
  const logger: ILogger = {
    level: LogLevel.Debug,
    setLevel: () => {},
    debug: () => {},
    info: () => {},
    warn: (...a: unknown[]) => void warns.push(a),
    error: () => {},
    child: () => logger,
  };
  return { logger, warns };
}

/** demo 形状：地基常驻，模块各带一个皮包（皮包名依赖当前马甲 → resolver）。 */
let skin = 'base';
const specs = (): BundleSpec[] => [
  { name: 'foundation' },
  { name: 'lobby', needs: ['foundation', () => `skin-${skin}-lobby`] },
  { name: 'mail', needs: ['foundation', () => `skin-${skin}-mail`] },
  { name: 'skin-base-lobby' },
  { name: 'skin-base-mail' },
  { name: 'skin-vest-lobby' },
  { name: 'skin-vest-mail' },
];

describe('createBundleGraph', () => {
  it('has / names：登记过的才认，名字升序', () => {
    const g = createBundleGraph([{ name: 'b' }, { name: 'a' }]);
    expect(g.names()).toEqual(['a', 'b']);
    expect(g.has('a')).toBe(true);
    expect(g.has('nope')).toBe(false);
  });

  it('重名以最后一条为准，并告警（接入方可覆盖，但不该悄悄覆盖）', () => {
    const { logger, warns } = fakeLogger();
    const g = createBundleGraph([{ name: 'a', needs: ['x'] }, { name: 'a', needs: ['y'] }], { logger });
    expect(g.needsOf('a')).toEqual(['y']);
    expect(warns).toHaveLength(1);
  });

  it('needsOf 求值 resolver —— 换马甲后同一张表解出另一套皮包', () => {
    const g = createBundleGraph(specs());
    skin = 'base';
    expect(g.needsOf('mail')).toEqual(['foundation', 'skin-base-mail']);
    skin = 'vest';
    expect(g.needsOf('mail')).toEqual(['foundation', 'skin-vest-mail']);
    skin = 'base';
  });

  it('needsOf 去重、丢空串；未登记的包返回空表', () => {
    const g = createBundleGraph([{ name: 'a', needs: ['x', 'x', () => 'x', () => ''] }]);
    expect(g.needsOf('a')).toEqual(['x']);
    expect(g.needsOf('未登记')).toEqual([]);
  });

  describe('layersFor', () => {
    it('依赖在前、自己在最后一层', () => {
      expect(createBundleGraph(specs()).layersFor('mail')).toEqual([
        ['foundation', 'skin-base-mail'],
        ['mail'],
      ]);
    });

    it('同层彼此无依赖 → 可并行；链式依赖各占一层', () => {
      const g = createBundleGraph([
        { name: 'a', needs: ['b'] },
        { name: 'b', needs: ['c'] },
        { name: 'c' },
      ]);
      expect(g.layersFor('a')).toEqual([['c'], ['b'], ['a']]);
    });

    it('钻石依赖只出现一次，且排在两个引用者之前', () => {
      const g = createBundleGraph([
        { name: 'top', needs: ['l', 'r'] },
        { name: 'l', needs: ['base'] },
        { name: 'r', needs: ['base'] },
        { name: 'base' },
      ]);
      expect(g.layersFor('top')).toEqual([['base'], ['l', 'r'], ['top']]);
    });

    it('没依赖 → 只有自己那一层', () => {
      expect(createBundleGraph([{ name: 'solo' }]).layersFor('solo')).toEqual([['solo']]);
    });

    it('未登记的包也给一层（strict 与否由 BundleManager 决定，图这里不拦）', () => {
      expect(createBundleGraph([]).layersFor('ghost')).toEqual([['ghost']]);
    });

    it('成环 → 抛，且报出卡住的那几个（表是人写的，环写得出来）', () => {
      const g = createBundleGraph([
        { name: 'a', needs: ['b'] },
        { name: 'b', needs: ['a'] },
      ]);
      expect(() => g.layersFor('a')).toThrow(/成环.*a → b/);
    });

    it('自依赖也算环', () => {
      const g = createBundleGraph([{ name: 'a', needs: ['a'] }]);
      expect(() => g.layersFor('a')).toThrow(/成环/);
    });
  });

  describe('mayUse（资源边界白名单）', () => {
    const g = (): ReturnType<typeof createBundleGraph> => createBundleGraph(specs());

    it('自己、直接依赖、传递依赖都放行', () => {
      const graph = createBundleGraph([
        { name: 'a', needs: ['b'] },
        { name: 'b', needs: ['c'] },
        { name: 'c' },
      ]);
      expect(graph.mayUse('a', 'a')).toBe(true);
      expect(graph.mayUse('a', 'b')).toBe(true);
      expect(graph.mayUse('a', 'c')).toBe(true);
    });

    it('没声明的不放行 —— 两个模块互相碰对方的资源要先在表里写出来', () => {
      expect(g().mayUse('mail', 'lobby')).toBe(false);
      expect(g().mayUse('lobby', 'mail')).toBe(false);
    });

    it('反向不放行（依赖是有方向的）', () => {
      expect(g().mayUse('foundation', 'mail')).toBe(false);
    });

    it('AOT 那几个内置包默认豁免，不用每行都写一遍', () => {
      for (const b of DEFAULT_ALWAYS_ALLOWED) expect(g().mayUse('mail', b)).toBe(true);
    });

    it('豁免名单可换（接入方的共享仓不叫 resources 时）', () => {
      const graph = createBundleGraph([{ name: 'a' }], { alwaysAllowed: ['shared'] });
      expect(graph.mayUse('a', 'shared')).toBe(true);
      expect(graph.mayUse('a', 'resources')).toBe(false);
    });

    it('换马甲后白名单跟着变 —— base 的模块碰不到 vest 的皮包', () => {
      skin = 'base';
      expect(g().mayUse('mail', 'skin-base-mail')).toBe(true);
      expect(g().mayUse('mail', 'skin-vest-mail')).toBe(false);
      skin = 'base';
    });
  });
});

import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createBundleGraph } from '@cck/core';
import { scanCodeEdges } from '../../../../packages/tools/src/bundle-deps';
import { BUNDLE_GRAPH } from '../../assets/foundation/bundles';
import { currentSkinBundle, MODULE_CATALOG } from '../../assets/foundation/catalog';

/**
 * 依赖表的对账 —— 表是人写的，得有东西盯着它跟现实一致。
 *
 * 三条：**声明自洽**（needs 指向的包都登记过、不成环）、**清单齐全**（每个模块与它的皮包都在表里）、
 * **静态边 ⊆ 声明**（源码里的跨包 `import` 必须在表里有对应的 needs）。
 * 动态引用那一半静态查不到，由运行期的 strict 闸兜（表外的包一 load 就抛）。
 */
const ASSETS = fileURLToPath(new URL('../../assets', import.meta.url));
const graph = createBundleGraph(BUNDLE_GRAPH);
const registered = new Set(graph.names());

describe('BUNDLE_GRAPH 自洽', () => {
  it('每条 needs 指向的包都登记过 —— 依赖不许指向空气', () => {
    const dangling: string[] = [];
    for (const name of registered)
      for (const dep of graph.needsOf(name)) if (!registered.has(dep)) dangling.push(`${name} → ${dep}`);
    expect(dangling).toEqual([]);
  });

  it('任何一个包都能算出加载层次 —— 即没有环', () => {
    for (const name of registered) expect(() => graph.layersFor(name)).not.toThrow();
  });

  it('每个模块都登记了，且都依赖地基', () => {
    for (const e of MODULE_CATALOG) {
      expect(registered.has(e.bundle), `模块 '${e.id}' 的包没登记`).toBe(true);
      expect(graph.needsOf(e.bundle)).toContain('foundation');
    }
  });

  it('换皮模块的皮包既登记了、也在模块的 needs 里 —— 一起装一起卸', () => {
    for (const e of MODULE_CATALOG) {
      if (!e.skinned) continue;
      const skin = currentSkinBundle(e.id);
      expect(registered.has(skin), `皮包 '${skin}' 没登记`).toBe(true);
      expect(graph.needsOf(e.bundle)).toContain(skin);
    }
  });

  it('没换皮的模块不该凭空多出皮包依赖', () => {
    for (const e of MODULE_CATALOG) {
      if (e.skinned) continue;
      expect(graph.needsOf(e.bundle).some((d) => d.startsWith('skin-'))).toBe(false);
    }
  });

  it('大厅带着自己的皮包，地基带着地基皮包', () => {
    expect(graph.needsOf('lobby')).toContain(currentSkinBundle('lobby'));
    expect(graph.needsOf('foundation')).toContain(currentSkinBundle('foundation'));
  });
});

describe('声明 vs 现实', () => {
  it('源码里的每条跨包 import 都在表里有对应的 needs', () => {
    const missing = scanCodeEdges(ASSETS)
      // `from` 没登记 = 主包（AOT，不在表里），它的依赖由优先级单调那道闸管
      .filter((e) => registered.has(e.from) && !graph.needsOf(e.from).includes(e.to))
      .map((e) => `${e.from} → ${e.to}（${e.file}）`);
    expect(missing).toEqual([]);
  });

  it('模块之间默认互不可见 —— 例外只有 alsoNeeds 明写过的那几对', () => {
    // 动态取别人包里的资源（`assets.load(path,{bundle})`）静态闸看不见，所以必须在
    // `alsoNeeds` 里声明；声明过的这里才该放行。**当前一对都没有** —— 断言退化成
    // 「任意两个模块互不可见」，等哪天真出现这种引用，忘了声明就会在这儿红。
    const declared = new Set(
      MODULE_CATALOG.flatMap((e) => (e.alsoNeeds ?? []).map((n) => `${e.bundle} → ${n}`)),
    );
    const mods = MODULE_CATALOG.map((e) => e.bundle);
    for (const a of mods) {
      for (const b of mods) {
        if (a === b) continue;
        expect(graph.mayUse(a, b), `${a} → ${b}`).toBe(declared.has(`${a} → ${b}`));
      }
    }
  });

  it('声明过 alsoNeeds 的模块，装它就把被依赖那个也装上（装卸对称由引用计数保证）', () => {
    for (const e of MODULE_CATALOG) {
      for (const n of e.alsoNeeds ?? []) expect(graph.needsOf(e.bundle)).toContain(n);
    }
  });
});

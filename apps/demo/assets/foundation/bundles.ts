import type { BundleSpec } from '@cck/core';
import { currentSkinBundle, MODULE_CATALOG } from './catalog';

/**
 * bundle 依赖表 —— **加载顺序与资源边界的唯一真相源**（`BundleGraph`，[[bundle-manager]]）。
 *
 * ## 为什么要有它
 *
 * 出包期的两道闸只看得见 `import`。而跨包引用里最容易出事的那一半是**动态**的
 * ——`assets.load(path, { bundle })`、`loadScene(scene, { bundle })`、`registerUI` 里那个
 * 运行时才求值的 bundle resolver ——构建期一条记录都不产生。看不见就只能声明。
 *
 * 声明出来之后，`needs` 一表两用：
 *
 * - **装卸跟随**：`load('mail')` 先把 `foundation` 与这个马甲的邮件皮包装上，各加一次引用；
 *   `release('mail')` 各减一次。大厅不必再手写「两个包一起装、一起卸」。
 * - **资源边界**：`mayUse(a, b)` = b 在 a 的依赖闭包里。没声明就是越界。
 *
 * ## 它管的是「地基起来之后」
 *
 * 本表住在地基包里（跨模块契约，要能热更），而**地基自己是被启动序列装上来的** ——
 * `shared` / 地基皮包 / `foundation` 那一段仍归 `APP_CONFIG.shared`。它们照样登记在这里，
 * 因为模块要把它们写进 `needs`，`mayUse` 也要认得。
 *
 * ## 加一个模块要改几处
 *
 * 一处：`catalog.ts` 加一行。本表按 `MODULE_CATALOG` 现推 —— 模块包 + （登记了换皮的话）
 * 它那个皮包，都自动成表。**手写的只有启动段那四行**。
 */

/** 大厅骨架也是一个包。它不在 `MODULE_CATALOG` 里 —— 那张表是大厅的功能入口，不含大厅自己。 */
const LOBBY = 'lobby';

/** 启动段：`APP_CONFIG.shared` 装的那几个 + 大厅。皮包名按**当前马甲**解析。 */
const specs: BundleSpec[] = [
  { name: 'shared' },
  { name: currentSkinBundle('foundation') },
  { name: 'foundation', needs: ['shared', () => currentSkinBundle('foundation')] },
  { name: currentSkinBundle(LOBBY) },
  { name: LOBBY, needs: ['foundation', () => currentSkinBundle(LOBBY)] },
];

// 模块段：一个模块一条；换皮的模块把它那个皮包写进 needs —— 于是「一起装、一起卸」由
// 引用计数保证，不再是大厅里的一段特判。
for (const e of MODULE_CATALOG) {
  if (e.skinned) specs.push({ name: currentSkinBundle(e.id) });
  specs.push({
    name: e.bundle,
    needs: e.skinned ? ['foundation', () => currentSkinBundle(e.id)] : ['foundation'],
  });
}

export const BUNDLE_GRAPH: readonly BundleSpec[] = specs;

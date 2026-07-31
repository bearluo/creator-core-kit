import { registerUI, type UILayer } from '@cck/core';

/**
 * 大厅数据驱动清单（设计 §7）。
 * 加任何功能 = 新建一个 `modules/<id>` bundle + 这里加一行，**大厅代码零改** → 多人协作零冲突。
 */

/** 模块承载类型。panel=注册进 UIManager 的界面；game=全屏自带场景（经 SceneFlow 栈切换）。 */
export type ModuleKind = 'panel' | 'game';

/** 大厅清单一行。 */
export interface CatalogEntry {
  /** 模块 id：panel 类即 UIManager 的 uiId；也作大厅按钮名。 */
  readonly id: string;
  /** 大厅按钮显示名。 */
  readonly title: string;
  /** 模块 Asset Bundle 名（= `modules/<id>` 目录名）。 */
  readonly bundle: string;
  readonly kind: ModuleKind;
  /** kind:'panel' 时 bundle 内的界面 prefab 路径。 */
  readonly prefab?: string;
  /** 横屏专用 prefab（可选）。填了就登记成 resolver：转屏时 UIManager 按需重建换这套布局。 */
  readonly prefabLand?: string;
  /** 界面归属层，默认 'ui'。 */
  readonly layer?: UILayer;
  /** kind:'game' 时 bundle 内自带的场景名（`bundle.loadScene` 用）。 */
  readonly scene?: string;
}

/** 大厅只吃这一张清单。 */
export const MODULE_CATALOG: readonly CatalogEntry[] = [
  { id: 'shop', title: '商城', bundle: 'shop', kind: 'panel', prefab: 'Shop', prefabLand: 'Shop_land' },
  { id: 'mini-clicker', title: '点击计数器', bundle: 'mini-clicker', kind: 'panel', prefab: 'Clicker' },
  { id: 'mini-dodge', title: '躲避小游戏', bundle: 'mini-dodge', kind: 'game', scene: 'Dodge' },
];

/**
 * 把 panel 类清单项登记进 UIManager 注册表 —— 「怎么开」收在这一处：
 * 多个入口打开商城都只写 `open('shop')`；换皮 / 横竖屏换 view 改这张表一行即可。
 */
export function registerCatalogUIs(): void {
  for (const e of MODULE_CATALOG) {
    if (e.kind !== 'panel' || !e.prefab) continue;
    const { prefab, prefabLand } = e;
    registerUI(e.id, {
      layer: e.layer ?? 'ui',
      bundle: e.bundle,
      // 登记了横屏 prefab 的才在转屏时重建；其余界面解析结果不变 → 转屏零成本（Widget 自适应即可）
      prefab: prefabLand ? (v) => (v.orientation === 'landscape' ? prefabLand : prefab) : prefab,
    });
  }
}

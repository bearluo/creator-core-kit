/**
 * 大厅数据驱动清单（设计 §7）。
 * 加任何功能 = 新建一个 `modules/<id>` bundle + 这里加一行，**大厅代码零改** → 多人协作零冲突。
 */

/** 模块承载类型。panel=挂大厅场景内的 UI 面板；game=全屏自带场景（经 SceneFlow 栈切换）。 */
export type ModuleKind = 'panel' | 'game';

/** 大厅清单一行。 */
export interface CatalogEntry {
  /** 模块 id：panel 类即自登记 key；也作大厅按钮 / 挂载节点名。 */
  readonly id: string;
  /** 大厅按钮显示名。 */
  readonly title: string;
  /** 模块 Asset Bundle 名（= `modules/<id>` 目录名）。 */
  readonly bundle: string;
  readonly kind: ModuleKind;
  /** kind:'game' 时 bundle 内自带的场景名（`bundle.loadScene` 用）。 */
  readonly scene?: string;
}

/** 大厅只吃这一张清单。 */
export const MODULE_CATALOG: readonly CatalogEntry[] = [
  { id: 'shop', title: '商城', bundle: 'shop', kind: 'panel' },
  { id: 'mini-clicker', title: '点击计数器', bundle: 'mini-clicker', kind: 'panel' },
  { id: 'mini-dodge', title: '躲避小游戏', bundle: 'mini-dodge', kind: 'game', scene: 'Dodge' },
];

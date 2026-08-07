import { getUIVariant, registerUI, type UILayer, type UIVariant } from '@cck/core';

/**
 * 模块清单 —— 数据驱动的功能入口表（设计 §7）。
 *
 * 加任何功能 = 新建一个 `modules/<id>` bundle + 这里加一行，**大厅代码零改** → 多人协作零冲突。
 * 放地基层而不是大厅 bundle：它是**跨模块契约**（大厅按它画按钮、UIManager 按它解析 prefab），
 * 且随地基热更 —— 上线一个新模块只要热更地基 + 那个模块，不必发新包、不必动大厅。
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
  /**
   * 这个模块换皮 —— 脸不在自己的模块包里，在 `skin-<马甲>-<id>` 包里，**跟模块一起装卸**
   *（见 {@link skinBundle}）。不登记 = 脸留在模块包，所有马甲同一张。
   */
  readonly skinned?: boolean;
}

/** 大厅只吃这一张清单。 */
export const MODULE_CATALOG: readonly CatalogEntry[] = [
  { id: 'shop', title: '商城', bundle: 'shop', kind: 'panel', prefab: 'Shop', prefabLand: 'Shop_land' },
  { id: 'mail', title: '邮件', bundle: 'mail', kind: 'panel', prefab: 'Mail', skinned: true },
  { id: 'mini-clicker', title: '点击计数器', bundle: 'mini-clicker', kind: 'panel', prefab: 'Clicker' },
  { id: 'mini-dodge', title: '躲避小游戏', bundle: 'mini-dodge', kind: 'game', scene: 'Dodge' },
];

/**
 * 登录界面的 uiId。**不在 `MODULE_CATALOG` 里** —— 它不是大厅的功能入口，
 * 而是启动路径上的一道闸门（`net/auth.ts` 的 `pickAccount` 开它）。
 */
export const LOGIN_UI = 'login';

/**
 * 马甲换皮的唯一接缝 —— 「这个界面从哪个包取脸」：**`skin-<马甲>-<跟随者>`**。
 *
 * ## 一个跟随者一个皮包
 *
 * `owner` 是这张脸**跟着谁装卸**：地基层的脸给 `'foundation'`，模块的脸给模块 id。
 * **皮的分包边界 = 跟随者的分包边界**，于是加载时机自动对齐：
 *
 * | 皮包 | 跟着谁 | 什么时候在内存里 |
 * |---|---|---|
 * | `skin-<马甲>-foundation` | 地基层（登录 / 以后的公告、强更提示） | 启动期随 `shared` 装，常驻 |
 * | `skin-<马甲>-lobby` | `modules/lobby` | 进大厅时装，常驻 |
 * | `skin-<马甲>-<模块>` | `modules/<模块>` | 打开该模块时装，关闭时卸 |
 *
 * 反过来说：**不许一个马甲一个大皮包**。那样启动期就得把所有模块的脸一起下下来 ——
 * 玩家永远不点的模块也算钱、也算首包体积，改一个模块的脸还要重下整包。
 *
 * ## 为什么脸不留在地基 / 模块包里
 *
 * 地基是所有马甲共用的那一层，混一张只有某个包会用的脸进去 = 别的马甲白下载它，
 * 改这张脸还要热更整个地基包。全进皮包之后，出一版新马甲 = **只发它自己那几个皮包**。
 * demo 自己也是个马甲，它的地基皮就是 `skin-base-foundation`。
 *
 * **同名 prefab 放不同 bundle 是 Cocos 3.x 唯一干净的整包换皮路径**（引擎没有
 * Prefab Variant / AB Variant）。界面**脚本仍归原层**（地基 6 / 模块 1，都不在皮包里），
 * 皮包里只有 prefab 与图 —— 一套逻辑配任意一张脸。prefab 靠 classId 找类，
 * 所以只要脚本所在的包先加载好即可，皮包不依赖它的脚本资源。
 *
 * 皮肤值从哪来：`boot/app-config.ts` 的 `VEST`（打包期常量，一个马甲一个包）
 * → `Bootstrap` 启动时 `setUIVariant({ skin: VEST })`。
 *
 * ⚠️ 用了本函数的界面，**每个马甲都得有对应皮包和里头的 prefab** —— 缺一个就是加载失败
 *（有日志、界面空）。demo 给登录、大厅骨架、邮件登记了换皮；商城与小游戏没登记，
 * 脸留在自己的模块包里、所有马甲同一张。
 */
export function skinBundle(owner: string): (v: UIVariant) => string {
  return (v) => `skin-${v.skin}-${owner}`;
}

/**
 * 当前马甲下某个跟随者的皮包名。
 *
 * 给**不经 UIManager 挂载**的界面用 —— 大厅骨架就是：它随 `Lobby.scene` 生死、挂在场景自己的
 * 渲染根下，不进层容器、不参与 open/close，塞进 UI 注册表只会让 `listUIDefs()` 里多两个
 * 永远不会被 open 的条目。它换皮要的只是「去哪个包取」这一件事。
 */
export function currentSkinBundle(owner: string): string {
  return skinBundle(owner)(getUIVariant());
}

/**
 * 把 panel 类清单项登记进 UIManager 注册表 —— 「怎么开」收在这一处：
 * 多个入口打开商城都只写 `open('shop')`；换皮 / 横竖屏换 view 改这张表一行即可。
 */
export function registerCatalogUIs(): void {
  // 登录界面挂 `system` 层：它得盖住 `ui` 层的启动界面（那时进度条还在跑）。
  // 脸在地基皮包（`skin-<马甲>-foundation/login/Login.prefab`），逻辑在 `foundation/login/`
  // —— 马甲最该换的就是这一张，而它在启动路径上，所以跟着地基常驻。
  registerUI(LOGIN_UI, { layer: 'system', bundle: skinBundle('foundation'), prefab: 'login/Login' });
  for (const e of MODULE_CATALOG) {
    if (e.kind !== 'panel' || !e.prefab) continue;
    const { prefab, prefabLand } = e;
    registerUI(e.id, {
      layer: e.layer ?? 'ui',
      // 换皮的模块从自己那个皮包取脸；大厅负责在开模块时把它一起装上、关模块时一起卸
      bundle: e.skinned ? skinBundle(e.id) : e.bundle,
      // 登记了横屏 prefab 的才在转屏时重建；其余界面解析结果不变 → 转屏零成本（Widget 自适应即可）
      prefab: prefabLand ? (v) => (v.orientation === 'landscape' ? prefabLand : prefab) : prefab,
    });
  }
}

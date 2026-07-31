import type { BundleScope, Container } from '@cck/core';

/**
 * 大厅框架样例 · 可分包功能模块的运行上下文（type-only，编译期擦除）。
 *
 * 「一切功能皆可分包」：商城/背包/子游戏等各是一个 Asset Bundle，按需 load/open/release。
 * panel 类模块 = 一个注册进 UIManager 的界面（`registerUI(id, { bundle, prefab })`，见 module-catalog）：
 * 界面脚本继承 `CCKUIView` 挂在自己 prefab 根上，**本对象就是 `open(id, args)` 的 args**。
 * game 类（全屏自带场景）不走这里，由 host 直接 loadScene 承载（见 LobbyHost）。
 *
 * 没有「自登记工厂表」了：prefab 里存的就是组件类，bundle 加载执行脚本时 `@ccclass` 已把它注册进
 * cc 类表——引擎原生的跨 bundle 桥接，不必自建 globalThis 注册表。
 */
export interface ModuleContext {
  /** 模块专属 DI 子作用域：隔离模块单例，关闭即 dispose（级联释放本层 Disposable）。 */
  readonly container: Container;
  /** 本模块 bundle 名：模块经 {bundle} 从自己 bundle 加载 i18n/配表（模块作用域资源）。 */
  readonly bundle: string;
  /**
   * kit 的 bundle 作用域（已绑定本模块 bundle）：`onShow` 里 `load*` / `add` 登记，
   * **回收由 host 统一发起**（`closePanel` 一行 `dispose()`）——界面不自己 dispose，
   * 因为 dispose 的第一步就是关掉本 bundle 的界面，所有权在 host 手里才不会打架。
   */
  readonly scope: BundleScope;
  /** 打开传参。 */
  readonly args?: unknown;
  /** 模块请求关闭自己 → host 走 close(uiId) + 释放子作用域与 bundle。 */
  close(): void;
}

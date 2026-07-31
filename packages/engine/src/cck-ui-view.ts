import { _decorator, Component } from 'cc';

const { ccclass } = _decorator;

/**
 * 界面契约（**可选**）—— 挂在 UI prefab 根上，UIManager 打开/关闭/变体重建时回调它。
 * 没挂也能开（只是拿不到 args/state），对齐 godot-core-kit `KitUiScreen.of()` 的可选组件风格。
 *
 * ```ts
 * @ccclass('ShopView')
 * export class ShopView extends CCKUIView {
 *   async onShow(args: unknown, state?: unknown) { ... }   // 可 async：open() 等它完成
 *   saveState() { return { tab: this.tab }; }              // 变体重建时自吐自吃
 * }
 * ```
 */
@ccclass('CCKUIView')
export class CCKUIView extends Component {
  /** 由 UIManager 注入（界面自己要回调 close(uiId) 时用）。 */
  uiId = '';

  /**
   * 界面就绪。`state` 只在**变体重建**（转屏/换皮）时非空，来自上一实例的 {@link saveState}。
   * 返回 Promise 时 `open()` 会等它——「open 完成」= 界面真的可用（如已 await 完 i18n）。
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- 基类是空实现，参数名要留给子类当签名文档
  onShow(_args?: unknown, _state?: unknown): void | Promise<void> {}

  /** 销毁前回调（含变体重建的销毁）。同步——`close()` 不等动画。 */
  onHide(): void {}

  /**
   * 变体重建前自存状态（滚动位置 / 页签 / 输入框…），下一实例经 `onShow(args, state)` 拿回。
   * 对齐 Android `onSaveInstanceState`：框架搬不动这些，只能界面自己吐。不实现 = 重建即重置。
   */
  saveState?(): unknown;
}

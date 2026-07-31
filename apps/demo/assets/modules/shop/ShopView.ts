import { _decorator, Label, Node } from 'cc';
import { getI18n } from '@cck/core';
import { CCKUIView } from '@cck/engine';
import type { ModuleContext } from '../lobby/ModuleContext';

const { ccclass } = _decorator;

/**
 * 商城 · panel 类可分包功能模块样例（kind:'panel'）。
 *
 * 本脚本**挂在自己 bundle 的 Shop.prefab 根上**：UIManager 按注册表加载 prefab → instantiate →
 * 回调 `onShow(args)`。args 就是 host 注入的 {@link ModuleContext}（bundle / 资源作用域 / close）。
 *
 * 演示两件事：
 * 1. **模块作用域资源**：i18n 在自己的 shop bundle 里，随 bundle 加载而来、随 onHide（scope.dispose）撤走
 *    ——大厅未打开商城前 `getI18n().t('shop.title')` 查不到 'shop.*'。
 * 2. **横竖屏换 view**：清单里登记了 `prefabLand: 'Shop_land'`，转屏时 UIManager 自动销毁重建成横屏那套
 *    （同一个脚本、同样的节点名，onShow 再跑一遍即可）。
 */
@ccclass('ShopView')
export class ShopView extends CCKUIView {
  private ctx?: ModuleContext;

  async onShow(args?: unknown): Promise<void> {
    const ctx = args as ModuleContext;
    this.ctx = ctx;
    // 模块 i18n：从 shop bundle 加载（扁平带前缀键 'shop.*'），scope 记账 → onHide 精确撤回
    await ctx.scope.i18n('zh', 'shop-i18n');
    const i18n = getI18n();
    setLabel(this.node, 'Title', i18n.t('shop.title'));
    setLabel(this.node, 'Desc', i18n.t('shop.desc'));
    // 关闭走 host 注入的 ctx.close（不 import 主包）
    this.node.getChildByName('CloseBtn')?.on(Node.EventType.TOUCH_END, ctx.close);
    console.log(`[CCK-LOBBY] ShopView.onShow：t('shop.title')='${i18n.t('shop.title')}'（i18n 随 shop bundle 就绪）`);
  }

  onHide(): void {
    // 只做界面自己的事。scope 的回收由 host 统一发起（closePanel → scope.dispose），
    // 而 dispose 的第一步正是关掉本 bundle 的界面 → 本方法就是被它调起来的，别再反手 dispose。
    console.log(`[CCK-LOBBY] ShopView.onHide（scope 由 host 统一回收）`);
  }
}

function setLabel(root: Node, name: string, text: string): void {
  const l = root.getChildByName(name)?.getComponent(Label);
  if (l) l.string = text;
}

import { instantiate, Label, Node, type Prefab } from 'cc';
import { getI18n } from '@cck/core';
import { registerModule, type FeatureModule, type ModuleContext } from '../../lobby/FeatureModule';

/**
 * 商城 · panel 类可分包功能模块样例（kind:'panel'）。
 * 演示「模块作用域资源」：它的 i18n 与 prefab 都在自己的 shop bundle 里，随 bundle 加载而来、
 * 随 unmount（scope.dispose）撤走——大厅未打开商城前，`getI18n().t('shop.title')` 查不到 'shop.*'。
 * 面板 UI 走**模块自带 prefab**（Shop.prefab，编辑器授权），本脚本按命名节点填 i18n 文本、接关闭按钮到 ctx.close。
 */
class ShopModule implements FeatureModule {
  private ctx?: ModuleContext;

  async mount(ctx: ModuleContext): Promise<void> {
    this.ctx = ctx;
    // 1) 模块 i18n：从 shop bundle 加载（扁平带前缀键 'shop.*'），scope 记账 → unmount 精确撤回
    await ctx.scope.i18n('zh', 'shop-i18n');
    const i18n = getI18n();
    // 2) 模块自带 prefab：从 shop bundle 加载 + 实例化，挂 ctx.root
    const prefab = await ctx.scope.load<Prefab>('Shop', 'prefab');
    const node = instantiate(prefab);
    ctx.root.addChild(node);
    // 3) 填 i18n 文本 + 接关闭（走 host 注入的 ctx.close，不 import 主包）
    setLabel(node, 'Title', i18n.t('shop.title'));
    setLabel(node, 'Desc', i18n.t('shop.desc'));
    node.getChildByName('CloseBtn')?.on(Node.EventType.TOUCH_END, ctx.close);
    console.log(`[CCK-LOBBY] ShopModule.mount：t('shop.title')='${i18n.t('shop.title')}'（i18n 随 shop bundle 就绪）`);
  }

  async unmount(): Promise<void> {
    // 一行对称回收：removeTable('zh', ['shop.*']) + release(Shop.prefab)。UI 节点由 host 销毁 ctx.root。
    this.ctx?.scope.dispose();
    console.log(`[CCK-LOBBY] ShopModule.unmount：scope.dispose → 'shop.*' i18n 已撤`);
  }
}

function setLabel(root: Node, name: string, text: string): void {
  const l = root.getChildByName(name)?.getComponent(Label);
  if (l) l.string = text;
}

// —— 自登记（设计 Q1）：shop bundle 加载执行本脚本 → 工厂写进全局注册表，host 按 id 取 ——
registerModule('shop', () => new ShopModule());

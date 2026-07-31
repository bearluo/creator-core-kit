import { instantiate, Label, Node, type Prefab } from 'cc';
import { bindText, BindingScope } from '@cck/engine';
import { registerModule, type FeatureModule, type ModuleContext } from '../../lobby/FeatureModule';
import { CounterVM } from './CounterVM';

/**
 * 点击计数器 · panel 类轻量子游戏样例（kind:'panel'）。
 * 演示 panel 模块也能承载「子游戏」：纯逻辑 CounterVM（零 cc、可单测）+ 模块自带 Clicker.prefab +
 * bindText 数据绑定（signal 变 → Label 自动刷）。全部随 mini-clicker bundle 加载 / 卸载。
 */
class ClickerModule implements FeatureModule {
  private ctx?: ModuleContext;

  async mount(ctx: ModuleContext): Promise<void> {
    this.ctx = ctx;
    const prefab = await ctx.scope.load<Prefab>('Clicker', 'prefab');
    const node = instantiate(prefab);
    ctx.root.addChild(node);

    const vm = new CounterVM();
    const count = node.getChildByName('Count')?.getComponent(Label);
    const binds = new BindingScope();
    if (count) binds.add(bindText(count, () => vm.display.value)); // 单向：count 变 → 文本自动刷
    ctx.scope.add(() => binds.dispose()); // 绑定随模块 unmount 一并释放

    node.getChildByName('IncBtn')?.on(Node.EventType.TOUCH_END, () => vm.increment());
    node.getChildByName('ResetBtn')?.on(Node.EventType.TOUCH_END, () => vm.reset());
    node.getChildByName('CloseBtn')?.on(Node.EventType.TOUCH_END, ctx.close);
    console.log('[CCK-LOBBY] ClickerModule.mount：复用纯逻辑 CounterVM + bindText（模块自带 Clicker.prefab）');
  }

  async unmount(): Promise<void> {
    this.ctx?.scope.dispose(); // binds.dispose + release(Clicker.prefab)
    console.log('[CCK-LOBBY] ClickerModule.unmount：scope.dispose → 解绑 + release prefab');
  }
}

registerModule('mini-clicker', () => new ClickerModule());

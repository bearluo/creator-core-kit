import { _decorator, Label, Node } from 'cc';
import { bindText, BindingScope, CCKUIView } from '@cck/engine';
import type { ModuleContext } from '../../foundation/ModuleContext';
import { CounterVM } from './CounterVM';
import { clickerPing, registerClickerProto } from './clicker-net';

const { ccclass } = _decorator;

/**
 * 点击计数器 · panel 类轻量子游戏样例（kind:'panel'）。
 *
 * 挂在自己 bundle 的 Clicker.prefab 根上。演示 panel 模块也能承载「子游戏」：
 * 纯逻辑 CounterVM（零 cc、可单测）+ bindText 数据绑定（signal 变 → Label 自动刷）。
 * 顺带演示 **变体重建的状态保持**：`saveState()` 吐出计数，重建后的实例经 `onShow(args, state)` 吃回去
 * ——对齐 Android `onSaveInstanceState`，框架搬不动这些，只能界面自己吐。
 */
@ccclass('ClickerView')
export class ClickerView extends CCKUIView {
  private ctx?: ModuleContext;
  private vm = new CounterVM();
  /** 本实例的绑定（随界面销毁重建而重来，不进 bundle 作用域）。 */
  private binds?: BindingScope;

  onShow(args?: unknown, state?: unknown): void {
    const ctx = args as ModuleContext;
    this.ctx = ctx;
    this.vm.restore(state); // 转屏/换皮重建 → 计数接着走。判类型归 VM，View 不做业务判断

    // 本模块的协议段随 bundle 走（cmd 1000–1999 不在主包里）。注销交 scope 托管：
    // bundle 释放时自动摘掉，界面只是重建（转屏/换皮）时不会重复注册——scope 生命
    // 周期是 bundle 不是界面实例。
    ctx.scope.add(registerClickerProto());
    void clickerPing(this.vm.count.value); // 接入自检：模块段注册后立刻可用

    const count = this.node.getChildByName('Count')?.getComponent(Label);
    // 绑定的生命周期是**界面实例**，不是 bundle：转屏/换皮重建会销毁重建本组件，
    // 挂到 bundle 作用域的话旧绑定不解绑、新绑定再叠一份，往已销毁的 Label 上写。
    this.binds = new BindingScope();
    if (count) this.binds.add(bindText(count, () => this.vm.display.value)); // 单向：count 变 → 文本自动刷

    this.node.getChildByName('IncBtn')?.on(Node.EventType.TOUCH_END, () => this.vm.increment());
    this.node.getChildByName('ResetBtn')?.on(Node.EventType.TOUCH_END, () => this.vm.reset());
    this.node.getChildByName('CloseBtn')?.on(Node.EventType.TOUCH_END, ctx.close);
    console.log('[CCK-LOBBY] ClickerView.onShow：复用纯逻辑 CounterVM + bindText（模块自带 Clicker.prefab）');
  }

  saveState(): unknown {
    return this.vm.count.value;
  }

  onHide(): void {
    this.binds?.dispose(); // 只解本实例的绑定；bundle 作用域的回收由 host 统一发起
    this.binds = undefined;
    console.log('[CCK-LOBBY] ClickerView.onHide：解绑本实例');
  }
}

import { Component } from 'cc';
import type { Node } from 'cc';
import { getRootContainer } from '@cck/core';
import type { Container, Provider, Token } from '@cck/core';

/**
 * DI 容器的「引擎半」—— 把 core 的层级作用域容器绑定到 cc.Node 场景树，
 * 对应 godot-core-kit KitContext 的 of / resolve / provide。
 *
 * 把「带 KitContext 的节点」当作一个作用域根：
 *   - 它的 container 是「最近祖先 KitContext.container」的子作用域（无祖先则挂全局根容器）；
 *   - 子树里任意组件用 `KitContext.resolve(this.node, TOKEN)` 沿场景树祖先解析服务，
 *     命中最近作用域、逐层回退到根（core 容器的 parent 链已实现，这里只桥接「场景树 → 逻辑父链」）；
 *   - 节点/子树销毁时 onDestroy 自动 `container.dispose()`，级联回收该作用域注册的服务
 *     （实现 Disposable 的被调 dispose）——关卡/实体子树卸载即回收，对应 godot「随节点 free 连带释放」。
 *
 * core 铁律边界：层级/回退/dispose 级联全在 core（纯 TS 已测）；本文件只做
 * 「沿 cc.Node.parent 找最近 KitContext」这一点真实引擎行为，故按 ADR-0002 不 mock 单测、
 * 走 apps/demo 真机预览验证。
 *
 * 首版**纯 class、无 @ccclass**：运行期 `node.addComponent(KitContext)` 传类引用即可用，
 * 契合「空引导场景 + 代码加载」。编辑器菜单挂载 / 存进 scene·prefab 序列化需 `@ccclass`，留后续。
 */
export class KitContext extends Component {
  private _scope: Container | null = null;

  /**
   * 本节点的作用域容器（**懒建**，规避 Cocos 组件 onLoad 时序坑）：首次访问时沿场景树父链找
   * 最近祖先 KitContext，从其 container 派生子作用域；无祖先则从全局根容器派生。
   */
  get container(): Container {
    if (!this._scope) {
      const ancestor = KitContext.of(this.node.parent);
      const parent = ancestor ? ancestor.container : getRootContainer();
      this._scope = parent.createScope(this.node.name);
    }
    return this._scope;
  }

  /** provide：把服务注册到本作用域（godot provide 对应物）。子树内 resolve 可见、随本节点 dispose 回收。 */
  provide<T>(token: Token<T>, provider: Provider<T>): void {
    this.container.register(token, provider);
  }

  /** 节点/子树销毁 → 释放作用域（级联子作用域 + dispose 本层 Disposable 服务）。 */
  protected onDestroy(): void {
    this._scope?.dispose();
    this._scope = null;
  }

  /** 沿 cc.Node 父链（含自身）找最近的 KitContext；没有则 null。 */
  static of(node: Node | null): KitContext | null {
    for (let n = node; n; n = n.parent) {
      const ctx = n.getComponent(KitContext);
      if (ctx) return ctx;
    }
    return null;
  }

  /**
   * 从 node 处解析服务：命中最近祖先 KitContext 的作用域（逐层回退到根）；
   * 场景树上无任何 KitContext 时兜底走全局根容器。
   */
  static resolve<T>(node: Node, token: Token<T>): T {
    const ctx = KitContext.of(node);
    return ctx ? ctx.container.resolve(token) : getRootContainer().resolve(token);
  }
}

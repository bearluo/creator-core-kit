---
模块: di-container
所在包: packages/core（层级容器） + packages/engine（cc.Node 绑定适配）
状态: 已实现          # 草案 → 评审中 → 已定稿 → 已实现
摘要: 层级作用域 DI 容器 —— globalThis 全局根 + parent 链子作用域 + Symbol.for token；借鉴 godot-core-kit KitContext，但层级用 core 纯逻辑承载、cc.Node 绑定下沉 engine。
何时读: 注册/解析服务、定义接口 token、做关卡/实体级作用域、写 Bootstrap 装配、排查跨 bundle 单例分裂时。
日期: 2026-07-27
依赖: ADR-0001（跨 bundle 单例）；架构总纲 §3.1 接口清单、§4 DI；参考 godot-core-kit `di/kit_context.gd`、tsyringe；横评见 docs/research/2026-07-27-cc-di-survey.md
---

# DI 容器 设计文档

## TL;DR

core 提供**层级作用域**的 DI 容器（借鉴 godot-core-kit `KitContext`）：全局根容器挂 `globalThis`（跨 bundle 唯一），`createScope()` 建子容器形成 **parent 链**，`resolve` 沿「本层 → 父链 → 根」回退、子层可 **shadow** 父层；作用域 `dispose()` 随关卡/模块整体回收（级联释放 + `Disposable` 清理）。token 用 `Symbol.for` 保证跨 bundle key 一致、`Token<T>` 保证类型安全。**关键：层级用 core 纯逻辑 `parent` 引用承载（零 cc、可 node 单测）**；把"容器绑定到 `cc.Node`、沿场景树祖先解析"（godot 的 `of/resolve/provide_child`）下沉到 **engine 适配层**（`KitContext` 组件），守住核心铁律。是第 1 批地基第一块，EventBus/Logger/Bootstrap 都建其上。

## Purpose（目标与定位）

- **做什么**：模块解耦的唯一装配点 + **作用域服务**（全局 / 关卡级 / 实体级）。Core 定义引擎能力接口（`IAssetLoader / IAudioService / ITimer / INetwork / IStorage / ILogger / IPlatform`）+ token；Engine/平台层注册实现；业务按接口 `resolve`。
- **层级动机（借鉴 godot KitContext）**：关卡级服务随关卡卸载回收；实体级服务（黑板等）子树内可见；子作用域 shadow 父层同名服务。避免"什么都塞全局单例"。
- **铁律约束下的关键映射**：godot `KitContext extends Node` 直接沿场景树；**Cocos 版把层级做成 core 纯逻辑 `parent` 引用链**（可脱 cc 测），"节点绑定 + 沿 `cc.Node` 场景树解析"下沉到 engine 适配组件。core 只认逻辑父子，不知道场景树。
- **与 godot 的有意差异**：① token 用 `Symbol.for` + `Token<T>`（Cocos 单 bundle 出包会复制代码致分裂，需要 key 跨 bundle 一致 + 类型安全；godot 用 string 无此问题）；② 层级承载逻辑化（守铁律）。
- **横评佐证（见 survey）**：层级作用域与微软 **tsyringe `createChildContainer`**（子独立注册 + 父回退 + 子 shadow）几乎一致，方向被成熟库背书；装饰器/reflect-metadata 自动注入在 Cocos 有坑（3.3.x 构造函数 `@` SyntaxError、tree-shake 不友好）→ 坚持显式 `register/resolve`；主流 oops-framework 走全局门面单例（`oops.audio` 无作用域），本设计的「全局根 + 层级」更进一步。
- **YAGNI（首版砍）**：装饰器/`reflect-metadata` 自动装配；循环依赖自动检测；`subscribe` 时序解析（列 Open Question）。只做显式 `register / resolve` + 层级 + dispose。

## Public API（TypeScript 精确签名）

### Core 层（`@cck/core`，纯 TS 零 cc）

```ts
/** 类型安全 token：泛型 T 是 phantom（仅编译期），运行时只有 key/name。 */
export interface Token<T> {
  /** = Symbol.for(`cck.token.${name}`)，跨 bundle 同名共享，是容器 Map 的键。 */
  readonly key: symbol;
  readonly name: string;
}
/** 造 token。同名在任何 bundle 得到 key 相同的 token（Symbol.for 全局注册）。 */
export function createToken<T>(name: string): Token<T>;

export type Lifetime = 'singleton' | 'transient' | 'containerScoped';
export type Provider<T> =
  | { useValue: T }
  | { useFactory: (c: Container) => T; lifetime?: Lifetime /* 默认 singleton */ }
  | { useToken: Token<T> }; // alias：解析时重定向到另一 token（同一实例）

/** 可选清理协议：dispose 作用域时自动调用本层注册服务的 dispose()。 */
export interface Disposable { dispose(): void; }

export interface Container {
  readonly name: string;
  readonly parent: Container | null;

  /** 注册到本层。默认重复注册抛错；allowOverride 显式覆盖并清旧 singleton 缓存。 */
  register<T>(token: Token<T>, provider: Provider<T>, opts?: { allowOverride?: boolean }): void;
  /** 解析：本层 → parent 链 → 根，逐层回退；全链 miss 抛错。singleton 缓存在"拥有该注册的那一层"。 */
  resolve<T>(token: Token<T>): T;
  /** 同 resolve，但全链 miss 返回 undefined。 */
  tryResolve<T>(token: Token<T>): T | undefined;
  /** 沿链存在性检查，不报错。 */
  has<T>(token: Token<T>): boolean;
  /** 只查本层（用于判断是否 shadow）。 */
  hasLocal<T>(token: Token<T>): boolean;
  /** 注销本层注册（含清 singleton 缓存）。 */
  unregister<T>(token: Token<T>): void;

  /** 建子作用域（parent=this）。用于关卡/实体/bundle 级隔离。 */
  createScope(name?: string): Container;
  /**
   * 释放本作用域：① 级联 dispose 所有子作用域 → ② 对本层注册中实现了 Disposable 的实例调 dispose()
   * → ③ 清本层表 → ④ 从 parent 的子列表移除。根容器不可 dispose（抛错）。
   */
  dispose(): void;
}

/** 全局根容器（挂 globalThis[Symbol.for('cck.di.root')]，跨 bundle 唯一，首个初始化者胜出）。 */
export function getRootContainer(): Container;

/** 便捷门面（轻）：根容器 resolve/tryResolve 的糖。绝不缓存结果——每次走 resolve，防跨 bundle 分裂。 */
export const cck: {
  resolve<T>(token: Token<T>): T;
  tryResolve<T>(token: Token<T>): T | undefined;
  readonly container: Container; // === getRootContainer()
};
```

**错误语义**：`register` 重复且未 `allowOverride` → 抛错；`resolve` 全链 miss → 抛错（含 token 名 + 作用域名）；`useFactory` 抛错原样冒泡；根容器 `dispose()` → 抛错。

### Engine 适配层（`@cck/engine`，依赖 cc；`packages/engine/src/kit-context.ts`，已实现）

```ts
// 把 core 逻辑容器绑定到 cc.Node 场景树，对应 godot KitContext.of/resolve/provide。
export class KitContext extends Component {
  get container(): Container;                   // 懒建：首访时 = 最近祖先 KitContext.container.createScope()，否则 getRootContainer().createScope()
  provide<T>(token, provider): void;            // = this.container.register（godot provide 对应物）
  protected onDestroy(): void;                  // container.dispose()（关卡/实体子树卸载即回收，仅当已懒建）
  static of(node: Node | null): KitContext | null;   // 沿 cc.Node 父链（含自身）找最近 KitContext
  static resolve<T>(node: Node, token: Token<T>): T;  // of(node)?.container.resolve ?? 根兜底
}
```

- **container 懒建（关键）**：不在 `onLoad` 建、改首次 `get container` 时建，**规避 Cocos 组件 onLoad 时序坑**（祖先/后代激活顺序）——直接根治 Open Question #1。后代 resolve 触发祖先 `container` 首访，链上作用域按需自底向上建。
- **无 `@ccclass`（首版）**：运行期 `node.addComponent(KitContext)` 传类引用即可用，契合「空引导场景 + 代码加载」。编辑器菜单挂载 / 存进 scene·prefab 序列化需 `@ccclass`，留后续（且 npm-dist Component 能否被 Creator 编辑器识别序列化尚未验证）。
- **Node 型服务（godot `provide_child`）无需专用 API**：把「持 cc.Node 的服务」注册成实现 `Disposable`（`dispose()` 里 `node.destroy()`）即可，`scope.dispose()` 级联时自动回收（core 已测）——解 Open Question #2。

## Behavior & data flow（行为与数据流）

- **每个 Container**：`_local: Map<symbol, Entry>`（`Entry = { provider, instance?, resolved }`）+ `parent` 引用 + `_children: Container[]`。键用 `token.key`（`Symbol.for` 值）。
- **`getRootContainer()`**：读 `globalThis[Symbol.for('cck.di.root')]`；无则建并挂上（首个胜出）→ 即便根容器类被复制进多 bundle，实例仍唯一。
- **`resolve`**：本层命中 → 返回（singleton 首解析缓存**在本层**）；否则 `parent.resolve`；到根仍无 → 抛错。→ 父层 singleton 被多个子作用域共享同一实例。
- **`containerScoped` 生命周期**：实例缓存在**发起 resolve 的容器**（而非拥有注册的父层）→ 每个作用域各持一份、作用域内复用。实现上 resolve 需带"发起容器"上下文；缓存存在发起容器自己的 scoped 表。
- **`useToken` alias**：resolve 命中 alias → 转而 resolve 目标 token（递归、沿链）→ 多个 token 指向同一实例。避免成环：解析深度上限兜底（超限抛错）。
- **门面 `cck`**：`cck.resolve/tryResolve` 直接委托 `getRootContainer()`，**不持有任何实例引用**（每次走 resolve）→ 跨 bundle 安全（ADR-0001）。
- **shadow**：子作用域 `register` 同名 token → 该子链 `resolve` 命中子层，不影响父层与兄弟作用域。
- **`dispose`**：递归先 dispose 子作用域 → 本层实现 `Disposable` 的实例调 `dispose()` → 清 `_local` → 从 `parent._children` 移除。对应 godot 的"随节点 free 连带释放"，但 core 里是**显式调用**（engine 的 KitContext 组件在 `onDestroy` 自动调）。
- **跨 bundle 一致性 = 双保险**：① 根容器实例唯一（globalThis）；② token key 唯一（`Symbol.for(name)`）。子作用域是运行期对象（随关卡/实体生灭），不需全局化。
- **core/engine 边界**：core 100% 纯 TS。engine 的 `KitContext`(cc.Component) 持一个 core `Container`（父节点 KitContext 的 container.createScope()），并负责 **Node 型服务**的生命周期（godot `provide_child` 的对应物：add 到该节点、随 onDestroy 释放）。core 只管值/工厂/Disposable。

## Key design decisions（决策表）

| # | 维度 | 选项 | 推荐默认 | 一句话理由 |
|---|---|---|---|---|
| 1 | 容器存放 | 模块 static / **globalThis+Symbol.for** | **globalThis** | 根跨 bundle 唯一（ADR-0001 实证 static 会分裂） |
| 2 | **层级作用域** | 单容器 / **父子作用域链** | **父子链** | 关卡/实体/bundle 级隔离与回收（借鉴 godot KitContext） |
| 3 | **层级承载** | extends 场景树节点(godot) / **core 逻辑 parent 链 + engine 节点绑定** | **拆分** | 守铁律：core 脱 cc 可测，节点绑定下沉 engine |
| 4 | 作用域释放 | 手动逐个 / **dispose() 级联 + Disposable 协议** | **dispose 级联** | 关卡卸载一键回收，防泄漏 |
| 5 | token key | string(godot) / **Symbol.for + Token\<T\>** | **typed token** | Cocos 跨 bundle 需 key 一致 + 编译期类型安全 |
| 6 | provider | value / factory / **+ useToken(alias)** | **value+factory+alias** | 常量/懒单例/每次新建/token 重定向 |
| 6b | 生命周期 | singleton/transient / **+ containerScoped** | **三种** | 全局共享 / 每次新建 / 每作用域一份 |
| 6c | 便捷访问 | 仅 getRootContainer / **+ 轻门面 cck** | **加轻门面** | 省样板；不缓存实例，跨 bundle 安全 |
| 7 | 重复注册 | 覆盖 / **默认报错 + allowOverride** | **默认报错** | 防意外覆盖；热重载/测试显式覆盖 |
| 8 | 自动注入 | 装饰器/metadata / **显式 factory** | **显式** | 零依赖、tree-shake 友好（YAGNI） |

## Platform considerations（全平台 / 小游戏兼容）

- core 容器纯 TS，全平台一致；`globalThis` 在 Cocos 3.8 各平台 runtime 均可用。engine 的 KitContext 依赖 cc.Node，随工程编译。
- 与三种"热"：
  - **运行时分包**：一个 bundle 一个子作用域，`BundleManager.release(name)` 时 `scope.dispose()` 连带回收该 bundle 注册的服务（防泄漏）。
  - **开发期热重载**：`unregister` / `register(..., {allowOverride:true})` 替换实现。
  - **线上热更**：容器不涉及；被注册实现的**符号**受 AOT 裁剪影响 → 归 HotUpdate 白名单（ADR-0001），不在本模块。

## Testable seams + test plan（可测接缝 + vitest 用例）

- **可测性**：core 容器纯 node 可测、零 cc；每个用例用新根/`dispose` 隔离（或注入独立容器）。engine 的 KitContext 用 cc mock 另测。
- **用例清单（core）**：
  1. `createToken` 同名两次 → `key` 相同（`Symbol.for`）。
  2. `register useValue` + `resolve` → 返回同值。
  3. singleton factory → 多次 resolve 同一实例、factory 只调一次；transient → 每次新实例。
  4. `resolve` 全链 miss → 抛错（含 token 名）；`tryResolve` → undefined。
  5. `has`/`hasLocal` 正确（沿链 vs 仅本层）。
  6. 重复 register 抛错；`allowOverride` 覆盖成功且清旧 singleton。
  7. `unregister` → 之后 resolve 抛错、缓存清除。
  8. **层级**：子作用域 resolve 命中父层服务（向上回退）。
  9. **shadow**：子作用域 register 同名 → 子层命中子实现，父层/兄弟不受影响。
  10. **隔离**：子层注册不泄漏到父层与兄弟作用域。
  11. **父层 singleton 共享**：两个子作用域 resolve 父层 singleton → 同一实例。
  12. **dispose 级联**：dispose 父作用域 → 子作用域一并释放；本层 Disposable 服务的 `dispose()` 被调用；之后该作用域 resolve 抛错。
  13. `getRootContainer` 幂等 → 多次同一实例；根 `dispose()` 抛错。
  14. **跨"模拟 bundle"一致性**：手动构造同名不同对象的 token（模拟单 bundle 复制）→ resolve 仍命中同一注册。
  15. **containerScoped**：根注册 containerScoped，两个子作用域 resolve → 各自一份（不相等）；同一作用域内多次 resolve → 同一份。
  16. **useToken alias**：`register(A, {useToken:B})` + `register(B, useValue)` → `resolve(A)===resolve(B)`；alias 链正常；成环超深度上限 → 抛错。
  17. **门面 cck**：`cck.resolve(token) === getRootContainer().resolve(token)`；`cck` 不持实例引用（每次走 resolve）。

## Open Questions（待用户拍板）

1. ~~**`subscribe` 时序解析**~~ → **已解（2026-07-29）**：engine KitContext 的 `container` 改**懒建 getter**（首访才沿父链建作用域），后代先跑也能触发祖先按需建链，从根上绕开 onLoad 时序坑，无需 `subscribe`。
2. ~~**Node 型服务生命周期（godot `provide_child`）**~~ → **已解**：无需专用 API；持 Node 的服务注册成 `Disposable`（`dispose` 里 `node.destroy()`），`scope.dispose()` 级联自动回收（core 已测）。
3. **token key 前缀**：固定 `cck.token.${name}`（防撞名），不做可配。OK？
4. **根容器多版本共存**：`Symbol.for('cck.di.root')` 固定、首个初始化胜出；多份 core 共存隔离留作 HotUpdate 议题。OK？
5. ~~是否补 `ContainerScoped` scope~~ → **已定：首版纳入**（每作用域一份，缓存在发起 resolve 的容器）。
6. ~~是否补 Token alias / 门面糖~~ → **已定：首版纳入 `useToken` alias + 轻门面 `cck.resolve`**；重门面（`cck.audio` 预置属性）待接口清单稳定后再加。

---

## 实现记录

- **落地文件**：`packages/core/src/di/token.ts`（`createToken` + `Token<T>` phantom）、`container.ts`（`Container` 接口 + `ContainerImpl` + `getRootContainer` + `cck` 门面）、`index.ts`（导出）；由 `packages/core/src/index.ts` re-export。
- **最终 API 与设计偏差（core）**：完全按设计实现，无偏差。三生命周期 singleton（缓存在拥有层）/ transient / containerScoped（缓存在发起 resolve 的容器）；`useToken` alias 带 32 层深度上限防环；`cck` 轻门面每次走 `getRootContainer()` 不缓存实例。
- **测试结果 / 覆盖率（core）**：`vitest run` **22 passed**（DI 20 + 骨架 hello 2）；`tsc -b` 无错；`eslint` 无告警。core 覆盖率 **Stmts/Lines/Funcs 100%、Branch 95.65%**（container.ts 剩 `createScope` 默认 name 等 3 个防御分支未覆盖）。
- **engine 侧 `KitContext`（2026-07-29 落地）**：`packages/engine/src/kit-context.ts`，`extends cc.Component`，`get container`（懒建，见上）/ `provide` / `onDestroy` dispose / `static of` / `static resolve` 根兜底。相比设计的 `readonly container` 字段改为**懒建 getter**（规避 onLoad 时序，解 Open Q1），并加 `provide` 补齐 godot of/resolve/provide 三件套。**四门全绿**：`pnpm -r typecheck` 0、`pnpm lint` 0、`pnpm --filter @cck/engine build` OK（dist 20.37 KB / d.ts 9.64 KB，`cc` external）；测试数不变。**按 ADR-0002 不 mock 单测**（沿 `cc.Node.parent`/`getComponent` 走场景树属真实引擎行为，进 mock 即被禁的 creep）——改走 **apps/demo 真机 gameView 预览验证，2026-07-29 PASS**：`DemoBoot` 代码化搭 root→child 两层 KitContext 节点树（接 `this.node` 活动子树），实测 `🧭 回退='from-root' shadow='from-child' root='from-root' of命中=true 根兜底='from-global-root' → PASS`（跨两层 resolve 回退 + child shadow + root 不受影响 + `of` 命中最近 + 无 context 根兜底），`🧹 子树销毁后 Disposable.dispose 被调=true → PASS`（`node.destroy()` → `onDestroy` → `container.dispose()` 级联到 Disposable）。懒建 container（靠真 `node.parent` 走链按需建作用域）与无 `@ccclass` 的 `addComponent(KitContext)` 均隐式证实。
- **commit / PR**：待授权（core 与骨架同批已提；engine KitContext 本次新增，待提交）。
- **遗留 Minors**：① `@ccclass` 编辑器挂载 + npm-dist Component 序列化识别验证（首版纯 class、代码 addComponent，已真机验证运行期可用）；② `ContainerScoped`/alias 已含，重门面 `cck.audio` 预置属性待接口清单稳定后加；③ core 3 个防御分支未覆盖（默认参数），无功能风险。

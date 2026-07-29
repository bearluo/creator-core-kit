---
状态: 草案
摘要: 横评 MVVM 数据绑定/响应式原语选型（Vue reactivity / Preact signals / Solid / Angular signals / MobX / nanostores / 自写 signal / Cocos 社区 mvvm），为「改 ViewModel 数据 → UI 自动响应」定 core 半响应式原语 + engine 半绑 cc 节点的形状。结论：**core 自写 ~120 行 signal/computed/effect（自动依赖追踪、`.value` API、零依赖）**，engine 出 `bindText/bindProp` + `BindingScope`（onDestroy 一行解绑）。
何时读: 设计 ViewModel/数据驱动 UI、给某界面接数据绑定、做双向绑定（EditBox/Toggle/Slider）、质疑「为何不直接上 Vue reactivity / MobX」，或评估响应式原语对 AOT/包体影响时。
日期: 2026-07-29
依赖: docs/design/2026-07-24-architecture-overview.md（§71/§93「ViewModel 纯逻辑可测、View 薄壳、改数据→UI 响应」）；docs/adr/0001-cross-bundle-singleton-and-aot-hotupdate.md（AOT tree-shake 裁未引用符号 + 强引用白名单）；packages/core/docs/modules/eventbus.md（disposer + offAll(owner) 生命周期范式，本模块解绑照抄）；packages/core/docs/modules/ui-manager.md（View 薄壳边界，onDestroy 天然解绑点）
---

# MVVM 数据绑定 / 响应式原语 横评

## 目的与范围

架构总纲已定 MVVM-lite：**ViewModel 是纯逻辑（放 core、可 node 单测），View 是薄壳（放 engine），改 ViewModel 数据 → UI 自动响应**。本横评只解决「自动响应」那根管子该用什么：

- **core 半（响应式原语）**：`signal / computed / effect` —— 存值、派生、副作用；改值 → 依赖它的 effect 自动重跑。纯 TS 零 cc，vitest 直接测。
- **engine 半（绑 cc 节点）**：把「一个响应式值」接到 `cc.Label.string` / `cc.Sprite.spriteFrame` / `cc.EditBox` / `cc.Toggle` / `cc.ProgressBar`；含**双向绑定**（cc 事件 → 写回 signal）与 **onDestroy 一行解绑**。

> 铁律约束：原语进 `core`（可测、跨 bundle 走 AOT 共享层）；`cc.Label` 等节点操作进 `engine`。与 [[eventbus]]（core 逻辑 / engine 只消费）同构——engine 侧不必另写响应式实现，只写「effect ↔ cc 属性」的胶水 + 生命周期清理。

> 进度看板当前把「MVVM 数据绑定增强」整块记在 engine（`docs/progress.md`）——**本横评纠正：响应式原语归 core，engine 只承接绑定 helper**，与 ViewModel-in-core 的立场一致。

## 一、事实基线：自动依赖追踪 = 现代响应式的分水岭

「改数据 → UI 自动响应」的核心难点是 **effect 怎么知道自己依赖了哪些数据**。两条路线：

- **自动追踪（Vue / Preact / Solid / Angular / MobX）**：跑 effect 前把它设成全局「当前订阅者」；effect 里**读**某 signal 的 getter → 该 signal 把「当前订阅者」记为依赖（双向登记：signal→subs、effect→deps）；**写** signal → 通知它的 subs 重跑。依赖随每次运行动态收集，不用手写依赖数组。分歧只在「getter 拦截点」：Vue/Preact/Solid 是**显式 getter**（`ref.value` / `signal()`），MobX 是 **Proxy 属性陷阱**（读普通属性即追踪，最"魔法"）。
- **手动声明（nanostores）**：`computed([a, b], (a,b)=>…)` —— 依赖当参数显式列出，不追踪。省实现但把「别漏声明依赖」的心智负担丢给调用方，正是 MVVM 想消灭的。

本框架要的正是「改 `vm.hp.value` → 血条 label 自动更新」这种无依赖数组的体验 → **选自动追踪派**。

## 二、横评对比表

| 候选 | 追踪机制 | 零依赖 | 包体(min+gz) | API 风格 | 双向(two-way) | node 可测 | AOT/tree-shake | 生命周期整合 | 判定 |
|---|---|---|---|---|---|---|---|---|---|
| **自写 signal**（推荐） | 自动·getter | ✅ 本仓代码 | ~0.3–0.5KB（自控） | `.value`（仿 Preact/Vue） | ✅ 自定义 setter | ✅ 纯 TS | ✅ 表面自定、白名单可控（[[adr-0001]]） | ✅ effect→dispose，照抄 [[eventbus]] disposer/offAll | **选它** |
| **@preact/signals-core** | 自动·getter(`.value`) | ✅ 0 dep | ~1.3KB | `.value` + `effect()→dispose` | ✅ 手写 setter | ✅ | ⚠️ 引 npm 包进 AOT 共享层 | ✅ `effect` 返回 dispose | 强兜底（自写不够就整包 vendor） |
| **@vue/reactivity** | 自动·getter(`.value`/Proxy) | ✅ 0 dep（单发） | ~6–10KB | `ref().value`/`reactive()`/`effectScope` | ✅ **可写 computed** 原生支持 | ✅ | ⚠️ 体量大、表面广、AOT 裁剪不可控 | ✅ `stop()` + `effectScope`（最成熟） | 备选（要深响应/effectScope 时） |
| **SolidJS signals** | 自动·getter(函数调用) | ❌ 与 solid owner 树耦合 | 需连 solid-js 运行时 | `[get,set]` 元组（非 `.value`） | ✅ setter | ⚠️ 需 `createRoot` 起 owner 才能 dispose | ⚠️ 非独立包、owner 树重 | 靠 owner 树自动清理，脱离组件要手搓 root | 不选（独立用别扭） |
| **Angular signals** | 自动·getter | ❌ 绑 `@angular/core` | 需整个 Angular 运行时 | `sig()` / `computed()` | 只读 signal + `.set/.update` | ❌ effect 要 injection context | ❌ 拖 Angular | 靠 `DestroyRef`/injection context | 不选（强绑 Angular DI） |
| **MobX** | 自动·**Proxy 深响应** + `autorun` | ✅ 0 dep | ~16KB | 属性直读直写（最魔法） | ✅ 直接改属性 | ✅ | ❌ 大、Proxy、装饰器遗产 | `autorun` 返 disposer | 不选（包体/Proxy 兼容） |
| **nanostores** | ❌ **手动声明依赖** | ✅ 0 dep | ~0.3–0.9KB | `atom().get/.set` + `subscribe` | 手动 | ✅ | ✅ 极小 | `subscribe` 返 unbind | 不选（无自动追踪，违背需求） |
| **Cocos 社区**（cocos_creator_mvvm_tools / oops-framework mvvm） | `Object.defineProperty` 观察 + `watchPath` 字符串路径 | 视库 | — | 编辑器挂 VM 组件 + `watchPath='a.b.c'` | 弱/无 | ❌ **强绑 cc、进 prefab** | ❌ 逻辑落 prefab、字符串路径无类型 | 靠 cc.Component | 不选（违铁律，反面教材） |

（包体：Preact 官方演示以 `effect` 返回 dispose 的极小核心著称；nanostores README 自述「340–864 bytes minified+brotli，零依赖」；MobX 依赖 Proxy、体量数量级大于前者。bundlephobia/npm 页抓取被限流，数值取自库自述与公认量级，用于**量级**判断而非精确基准。）

## 三、逐候选要点（一手资料）

- **@preact/signals-core**：`signal(v)`（`.value` 读写）、`computed(fn)`（惰性、只在被读时算）、`effect(fn)` **返回 dispose 函数**（`const d = effect(()=>…); d()` 退订所有依赖）、`batch(fn)`（合并多次写为一次提交）、`untracked(fn)`、`.peek()`（读不订阅）。零依赖、自动 getter 追踪。**这就是我们要抄的语义模型。** 来源：[Preact Signals 指南](https://preactjs.com/guide/v10/signals/)、[signals-core README](https://github.com/preactjs/signals/tree/main/packages/core)。
- **@vue/reactivity**：`ref<T>(v): Ref<T>`（`.value`）、`computed(getter)` 只读 / `computed({get,set})` **可写（原生双向）**、`reactive(obj)`（Proxy 深响应）、`watchEffect(fn): WatchHandle`（`stop()/pause()/resume()`）、`effectScope()`（批量收集/统一 `stop()`——最贴合「一个 View 的所有绑定一起解绑」）。功能最全但体量与表面最大。来源：[Vue Reactivity Core API](https://vuejs.org/api/reactivity-core.html)。
- **SolidJS**：`createSignal` 返 `[get, set]` **元组**（读靠调用 `get()`，非 `.value`）；`createMemo/createEffect`；脱离组件独立使用须 `createRoot(dispose => …)` 建 owner 才能回收（[createRoot 文档](https://docs.solidjs.com/reference/reactive-utilities/create-root)）。fine-grained 思想是我们的灵感源，但作依赖引入 owner 树太重、API 与 `.value` 生态不一致。
- **Angular signals**：`signal()/computed()/effect()/untracked()`，但 **effect 只能在 injection context 内建**、靠 `DestroyRef` 清理——强绑 Angular DI 运行时，脱离 Angular 不可用。直接出局。来源：[Angular Signals](https://angular.dev/guide/signals)。
- **MobX**：Proxy 深响应 + `autorun`（读普通属性即自动追踪，DX 最爽），但 ~16KB、依赖 Proxy、历史装饰器包袱；对「零依赖 + AOT + 小游戏兼容」都不划算。
- **nanostores**：极小（数百字节）、零依赖，但 `computed([deps], fn)` **手动列依赖**、无自动追踪 → 与「改数据自动响应」的目标背道而驰。来源：[nanostores README](https://github.com/nanostores/nanostores)。
- **Cocos 社区现状（反面教材）**：`wsssheep/cocos_creator_mvvm_tools` 及 `oops-framework` 的 mvvm 模块，走**编辑器挂 `VM*` 组件 + `watchPath` 字符串路径**（如 `global.play.hp`），底层 `Object.defineProperty`（`JsonOb`）观察。问题：① 绑定逻辑落 **prefab/组件**（本框架铁律禁止——逻辑不进 prefab、要能脱 cc 测）；② 字符串路径**无编译期类型**（拼错运行时才炸）；③ 与 cc 强耦合，ViewModel 不可 node 单测。**印证**：cc 生态确有 MVVM 需求且方案成熟，但它们的落点与本框架相反——我们把响应式收进 core 纯逻辑，只把「绑 label」留给 engine。来源：[cocos_creator_mvvm_tools](https://github.com/wsssheep/cocos_creator_mvvm_tools)、[oops-framework](https://github.com/dgflash/oops-framework)。

## 四、推荐结论：core 自写 signal（仿 Preact 语义 + `.value` 命名）

**选自写 ~120 行的 `signal/computed/effect`，零第三方依赖**，语义抄 `@preact/signals-core`（最小、自动追踪、`effect()→dispose`），命名用 `.value`（对齐 Preact/Vue 直觉）。理由与本仓一贯选择一致：

1. **零依赖偏好**：EventBus、DI、Timer 都是本仓自写。响应式核心（getter 追踪 + subs 重跑）确是 ~100 行能拿下的东西，加 npm 依赖不划算。
2. **AOT/tree-shake 可控**（[[adr-0001]]）：自写代码的公开表面由我们定，直接进 core 的 AOT 共享层白名单；引入 `@vue/reactivity` 这种大表面 npm 包，AOT 裁哪些符号不可控、热更跨包缺代码风险放大。
3. **node 可测**：纯 TS，`effect` 同步重跑，vitest 断言「写 signal → effect 调用次数/顺序」，无真实时钟、无 cc。
4. **生命周期天然对齐**：`effect` 返回 `dispose`，与 [[eventbus]] 的 `disposer` / `offAll(owner)` 同范式，engine 侧 `onDestroy` 一行清理。
5. **兜底清晰**：若自写在「菱形依赖 glitch / 大规模批量更新调度」上暴露不足，**整包 vendor `@preact/signals-core`（~1.3KB）** 即可，API 已同构、无迁移成本。

> ponytail ceiling：自写首版用**朴素 push（写即同步递归重跑订阅者）**，不做 glitch-free 拓扑调度——菱形依赖会有一次冗余重算，UI 场景无害。升级路径：加 `batch()` 合并写 + 微任务 flush（抄 Preact），或直接换 signals-core。

### API 草图

**core（新模块 `packages/core/src/reactive/`）**：

```ts
export type Dispose = () => void;

export interface ReadSignal<T> { readonly value: T; peek(): T; }   // 读订阅 / peek 读不订阅
export interface Signal<T> extends ReadSignal<T> { value: T; }      // 可写

export function signal<T>(initial: T): Signal<T>;
export function computed<T>(getter: () => T): ReadSignal<T>;        // 惰性 + 缓存，依赖变才重算
export function effect(fn: () => void | (() => void)): Dispose;     // 立即跑一次 + 依赖变重跑；fn 可返回清理函数；返回 dispose 退订全部依赖
export function batch<T>(fn: () => T): T;                           // 可选：合并多次写为一次通知
export function untracked<T>(fn: () => T): T;                       // 可选：读值不建立依赖
```

追踪核心（示意，非最终）：全局 `activeEffect`；`signal.value` 的 getter 把 `activeEffect` 加入自身 `subs`、并登记到 `activeEffect.deps`；setter 变更后遍历 `subs` 重跑；`effect` 运行前清空旧 deps、压栈自身、跑 `fn`、弹栈；`dispose` = 从所有 dep 的 `subs` 摘除自己。

**engine（`packages/engine/src/reactive-bind.ts`）**——只做「effect ↔ cc 属性」胶水：

```ts
// 单向：响应式值 → cc 属性
export function bindText(label: Label, get: () => string): Dispose;               // effect(()=> label.string = get())
export function bindProp<N extends object, K extends keyof N>(node: N, key: K, get: () => N[K]): Dispose;
export function bindSprite(sp: Sprite, get: () => SpriteFrame | null): Dispose;
export function bindProgress(bar: ProgressBar, get: () => number): Dispose;

// 双向：cc 事件 → 写回 signal（见 §五）
export function bindEditBox(box: EditBox, sig: Signal<string>): Dispose;
export function bindToggle(tg: Toggle, sig: Signal<boolean>): Dispose;
export function bindSlider(sl: Slider, sig: Signal<number>): Dispose;

// 生命周期收纳：一个 View 的所有绑定装一处，onDestroy 一次性 dispose
export class BindingScope { add(d: Dispose): Dispose; dispose(): void; }
```

调用侧（薄壳 `cc.Component`）：

```ts
// vm: 纯 core ViewModel —— { name: signal('Jane'), hp: signal(100), ... }
onLoad() {
  const s = this._binds;                          // BindingScope
  s.add(bindText(this.nameLabel, () => this.vm.name.value));
  s.add(bindProgress(this.hpBar, () => this.vm.hp.value / this.vm.hpMax.value));
  s.add(bindEditBox(this.input, this.vm.name));   // 双向
}
onDestroy() { this._binds.dispose(); }             // 一行解绑，照抄 EventBus offAll(this)
```

## 五、engine 半：绑 cc 节点 + 双向 + onDestroy 解绑

- **单向（值 → 节点）**：`bindText` 本体就是 `effect(() => { label.string = get(); })`——首帧同步刷一次，之后依赖变即刷。`bindProp/bindSprite/bindProgress` 同理，只换赋值目标。**engine 无需另写响应式实现**，只把 `effect` 接到属性赋值（与 [[eventbus]] 的 engine 侧「只消费、不重写」一致）。
- **双向（节点 → 值）**：cc 交互控件把用户输入写回 signal —— `EditBox.node.on('text-changed', …→ sig.value = box.string)`、`Toggle` 的 `'toggle'`、`Slider` 的 `'slide'`。配合单向 effect 形成闭环；需防回环（值→控件→事件→值），用 `sig.peek()` 比较或 setter 幂等（值未变不通知）挡掉。这正是 `@vue/reactivity` **可写 computed** 覆盖的场景——自写方案用「单向 effect + 反向事件监听」两段拼出等效双向，够用且更透明。
- **onDestroy 解绑**：每个 `bind*` 返回 `Dispose`（内含 effect 退订 + `node.off(...)` 反注册）。`BindingScope` 收集全部 disposer，`cc.Component.onDestroy` 里 `scope.dispose()` 一次清空——`onDestroy` 是天然解绑点（见 [[ui-manager]]），范式与 [[eventbus]] `offAll(this)` 完全一致。可再出一个 `ReactiveComponent`（内建 `BindingScope` + `onDestroy` 自动 dispose）薄基类免样板，但非必须。

## 六、AOT / tree-shake 与包体取舍

- **自写 = 表面自控**：响应式原语公开符号（`signal/computed/effect/batch/untracked`）由我们定，纳入 [[adr-0001]] 的 core 公共 API 强引用白名单，主包 AOT 恒含全量，热更跨 bundle 不缺代码。引入 `@vue/reactivity`（表面广、~6–10KB）则 AOT 裁哪些符号、热更包引用到被裁符号会否运行时崩，都变得不可控。
- **包体**：自写核心 ~0.3–0.5KB，Preact signals-core ~1.3KB，都可忽略；MobX ~16KB 是数量级劣势，直接排除。
- **Proxy 兼容**：MobX / Vue `reactive()` 依赖 `Proxy`。现代小游戏/原生运行时基本支持 Proxy，但自写方案**只用显式 `.value` getter/setter、完全不碰 Proxy**，把这层平台不确定性一并消除（`ref` 式而非 `reactive` 式，深响应留给「signal 里放整个对象、整体替换」的浅响应模式，YAGNI）。
- **首版砍**：`reactive()` 式深层对象代理（用「值为对象的 signal + 整体 setState」替代）；glitch-free 拓扑调度（朴素 push 够用）；异步/调度 flush（同步够测够用，需要再加 `batch`）；数组/集合的细粒度增量响应（整体替换即可）。

## 七、Open Questions

1. **深响应要不要**：首版只做 `signal<T>`（浅、`.value`）。若 ViewModel 大量嵌套对象需细粒度，是否补 `reactive()`（Proxy）或改用「不可变整体替换」约定？倾向后者（免 Proxy、免深比较）。
2. **批量与调度**：`batch()` 是否首版就上？倾向 YAGNI，等出现「一次交互连写多值触发多次刷新」的实测抖动再加微任务 flush。
3. **`ReactiveComponent` 薄基类** vs **裸 `BindingScope`**：要不要给 engine 一个内建 scope + 自动 `onDestroy` dispose 的基类？倾向先只给 `BindingScope`（组合优于继承，薄壳自己在 onDestroy 调一行），基类等样板确实烦了再加。
4. **与 [[eventbus]] 的边界**：signal 管「状态变化驱动 UI」，EventBus 管「一次性事件广播」。列一句约定防混用（连续量/可观察态用 signal；离散事件用 EventBus）。
5. **兜底触发条件**：明确「自写方案在什么实测症状下切 `@preact/signals-core`」（如菱形依赖冗余重算成为性能热点、或需要成熟 `effectScope`），避免过早或过晚迁移。

> 拍板后出 `packages/core/docs/modules/reactive.md`（原语）定稿 + engine 侧绑定 helper 小节 → TDD。

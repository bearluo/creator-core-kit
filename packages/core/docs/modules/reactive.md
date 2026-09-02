---
模块: reactive（响应式原语 / MVVM 数据绑定地基）
所在包: packages/core（原语）+ packages/engine（绑 cc 节点的薄壳，本文 §engine 半）
状态: 已定稿          # 草案 → 评审中 → 已定稿 → 已实现（2026-07-29 用户 review 通过，5 个 Open Q 全按 YAGNI 建议定稿）
摘要: 自写 ~120 行 signal/computed/effect（自动依赖追踪、`.value`、零依赖），engine 出 bindText/bindProp + BindingScope 把响应式值接到 cc 节点，onDestroy 一行解绑——「改 ViewModel 数据 → UI 自动响应」的那根管子。
何时读: 设计 ViewModel/数据驱动 UI、给某界面接数据绑定、做双向绑定（EditBox/Toggle）、或质疑「为何不直接上 Vue reactivity / MobX」时。
日期: 2026-07-29
依赖: docs/research/2026-07-29-mvvm-databinding-survey.md（选型横评）；docs/design/2026-07-24-architecture-overview.md（ViewModel 纯逻辑可测、View 薄壳）；docs/adr/0001（base tree-shake + 强引用白名单）；eventbus（disposer/offAll(owner) 生命周期范式，本模块照抄）；ui-manager（View 薄壳边界，onDestroy 天然解绑点）
---

# reactive 设计文档（响应式原语 + MVVM 数据绑定）

## TL;DR

`signal(v)` 存值、`computed(fn)` 派生、`effect(fn)` 副作用；改 `sig.value` → 依赖它的 effect 自动重跑。**自写 ~120 行、零第三方依赖、自动 getter 依赖追踪**（语义抄 `@preact/signals-core`，命名对齐 Vue `.value`）。原语进 **core**（纯 TS、vitest 直测、跨 bundle 走 base 共享层）；engine 只出 `bindText/bindProp/bindEditBox` + `BindingScope`，把 effect 接到 `cc.Label.string` 等属性，`cc.Component.onDestroy` 里一行 `scope.dispose()` 解绑（照抄 EventBus `offAll(this)`）。给写界面的人用：ViewModel 是一堆 signal，View 是薄壳，绑一下就自动同步。

## Purpose（目标与定位）

- **做什么**：提供「状态变化 → 视图自动更新」的最小响应式内核 + 把它接到 cc 节点的胶水。让 ViewModel（纯逻辑、可 node 单测）持有状态，View（cc 薄壳）声明式绑定，改数据即刷新，无需手动 `label.string = ...` 散落各处。
- **定位/取舍**：
  - 与 **UIManager** 互补不重叠——UIManager 管「哪个界面开着、窗口栈、生命周期」，reactive 管「界面里的数据怎么自动流到控件」。一个管容器，一个管内容。
  - 与 **EventBus** 分工——signal 管**连续可观察态**（hp、金币、名字，有「当前值」且会变）；EventBus 管**离散一次性事件**（点击、收到推送、关卡通过）。别拿 signal 当事件用、也别拿事件当状态存。
  - **零依赖**：与 DI/EventBus/Timer 一样自写。响应式核心（getter 追踪 + subs 重跑）确是 ~100 行能拿下的东西，不值当引 npm 包（见决策表 #1 及 [[adr-0001]] 的 base 顾虑）。
- **YAGNI（首版故意砍）**：
  - `reactive()` 式深层对象 Proxy 代理 → 用「值为对象的 signal + 整体替换」的浅响应替代（免 Proxy、免深比较、免平台不确定性）。
  - glitch-free 拓扑调度 → 朴素同步 push（菱形依赖至多一次冗余重算，UI 场景无害）。
  - 异步/微任务 flush、`batch()` → 同步够测够用；实测出现「一次交互连写多值 → 多次刷新抖动」再加。
  - 数组/集合细粒度增量响应 → 整体替换即可。
  - engine 侧 `bindSprite/bindProgress/bindSlider` 等专用 helper → 泛型 `bindProp` 已覆盖，专用款按需再加。

## Public API（TypeScript 精确签名）

### core：`packages/core/src/reactive/`

```ts
export type Dispose = () => void;

/** 只读响应式值。读 .value 会在当前 effect 内建立依赖；peek() 读值但不建立依赖。 */
export interface ReadSignal<T> {
  readonly value: T;
  /** 读当前值但不订阅（用于 effect 内部只想取值、不想因它重跑）。 */
  peek(): T;
}

/** 可写响应式值。setter 用 Object.is 幂等——值未变不通知（天然挡双向绑定回环）。 */
export interface Signal<T> extends ReadSignal<T> {
  value: T;
}

/** 造一个可写 signal。 */
export function signal<T>(initial: T): Signal<T>;

/** 惰性 + 缓存的派生值：只在被读时求值，依赖变才失效重算；无人读则不算。 */
export function computed<T>(getter: () => T): ReadSignal<T>;

/**
 * 副作用：立即同步跑一次并收集依赖；此后任一依赖变化即重跑。
 * fn 可返回一个清理函数，在「下次重跑前」和「dispose 时」被调用（如反注册 cc 事件）。
 * 返回 dispose：退订全部依赖 + 跑最后一次清理。
 */
export function effect(fn: () => void | Dispose): Dispose;

/** 读值时不建立任何依赖（effect 内需要「看一眼别的 signal 但不想被它触发」时用）。 */
export function untracked<T>(fn: () => T): T;
```

### engine：`packages/engine/src/reactive-bind.ts`（薄壳，只做 effect ↔ cc 属性胶水）

```ts
import type { Label, EditBox, Toggle } from 'cc';
import type { Dispose, Signal } from '@cck/core';

/** 单向：label.string = String(get())，首帧刷一次，依赖变即刷。 */
export function bindText(label: Label, get: () => unknown): Dispose;

/** 单向泛型：obj[key] = get()。覆盖 Sprite.spriteFrame / ProgressBar.progress / Node.active 等一切属性赋值。 */
export function bindProp<O extends object, K extends keyof O>(obj: O, key: K, get: () => O[K]): Dispose;

/** 双向：sig → box.string（effect）+ box 'text-changed' → sig.value（幂等 setter 挡回环）。 */
export function bindEditBox(box: EditBox, sig: Signal<string>): Dispose;

/** 双向：sig → toggle.isChecked + 'toggle' 事件 → sig.value。 */
export function bindToggle(toggle: Toggle, sig: Signal<boolean>): Dispose;

/** 生命周期收纳：一个 View 的所有绑定装一处，onDestroy 一次性 dispose（照抄 EventBus offAll(owner)）。 */
export class BindingScope {
  /** 收一个 disposer，原样返回便于链式。 */
  add<D extends Dispose>(d: D): D;
  /** 依次跑所有 disposer 并清空（幂等，可重复调）。 */
  dispose(): void;
}
```

调用侧（engine 薄壳 `cc.Component`）：

```ts
// vm: 纯 core ViewModel —— { name: signal('Jane'), hp: signal(100), hpMax: signal(100) }
private _binds = new BindingScope();
onLoad() {
  const s = this._binds;
  s.add(bindText(this.nameLabel, () => this.vm.name.value));
  s.add(bindProp(this.hpBar, 'progress', () => this.vm.hp.value / this.vm.hpMax.value));
  s.add(bindEditBox(this.input, this.vm.name));   // 双向
}
onDestroy() { this._binds.dispose(); }             // 一行解绑
```

## Behavior & data flow（行为与数据流）

**core（纯逻辑，零 cc）——自动依赖追踪三段式**：

1. 模块级 `activeSub`（当前正在跑的订阅者，即某个 effect/computed 的内部节点），初始 `undefined`。
2. **读**：`sig.value` 的 getter — 若 `activeSub` 存在，双向登记（`sig.subs.add(activeSub)`、`activeSub.deps.add(sig)`）后返回值；`peek()` 跳过登记。
3. **写**：`sig.value` 的 setter — `Object.is(新, 旧)` 相等则直接返回（幂等，挡双向回环）；否则更新值并遍历 `sig.subs` 快照逐个 `notify()`（同步重跑 effect / 标记 computed 脏）。
4. **effect(fn)**：建一个订阅者节点 → 运行前先 `cleanup()`（清旧 deps 的反向登记 + 跑上次返回的清理函数）→ 把自己设为 `activeSub`、跑 `fn`、恢复 `activeSub` → 依赖在 fn 里读 signal 时被收集。`dispose` = `cleanup()` 并标记失效。
5. **computed(getter)**：惰性——内部 `dirty` 标记；被读时若 `dirty` 则以自身为 `activeSub` 重算并缓存、清 `dirty`，同时把「读它的外层 sub」登记为它的 subs；其任一 dep 变化时把自己标 `dirty` 并向上 `notify`。无人读则永不求值。

> ponytail ceiling：朴素同步 push，无 glitch-free 拓扑排序。菱形依赖（a→b、a→c、b&c→d）改 a 时 d 可能重算两次——UI 无害。升级路径：加 `batch()`（合并写，微任务 flush 去重）或整包 vendor `@preact/signals-core`（API 同构、~1.3KB、无迁移成本）。切换触发条件见 Open Q5。

**engine（cc 适配壳）**：每个 `bind*` 本体就是一个 `effect(() => { 目标属性 = get(); })`——engine **不另写响应式实现**，只把 effect 接到 cc 属性赋值（与 EventBus 的 engine 侧「只消费、不重写」一致）。双向额外挂一个 cc 事件监听把输入写回 signal，`bind*` 返回的 `Dispose` 内含「effect 退订 + `node.off(...)` 反注册」，被 `BindingScope` 收纳、`onDestroy` 统一清。

**核 / 壳边界**：追踪与重跑全在 core（可脱 cc 测）；只有「读/写某个 `cc.Label.string`」这一步在 engine。engine 半不含任何响应式逻辑。

## Key design decisions（决策表）

| # | 维度 | 选项 | 推荐默认 | 一句话理由 |
|---|---|---|---|---|
| 1 | 响应式原语来源 | 自写 / @preact/signals-core / @vue/reactivity / MobX / nanostores | **自写 ~120 行** | 零依赖惯例 + base 表面自控（[[adr-0001]]）；~100 行搞定，兜底可整包换 signals-core |
| 2 | 依赖追踪 | 自动 getter / 手动依赖数组(nanostores) | **自动 getter** | 「改 vm.hp.value 血条自动更新」正需免依赖数组的体验 |
| 3 | 值读写 API | `.value`(Preact/Vue) / `[get,set]`元组(Solid) / 属性直读(MobX) | **`.value`** | 对齐 Preact/Vue 直觉；不碰 Proxy，消除平台不确定性 |
| 4 | 深响应 | Proxy `reactive()` / 浅 signal + 整体替换 | **浅 + 整体替换** | 免 Proxy/深比较，小游戏兼容稳；深层需求 YAGNI（Open Q1） |
| 5 | 双向绑定回环 | 脏标记比较 / setter 幂等(Object.is) | **setter 幂等** | 值未变不通知，天然挡「值→控件→事件→值」回环，无需额外状态 |
| 6 | 生命周期解绑 | effect→dispose + BindingScope / 继承基类 | **BindingScope（组合）** | 照抄 EventBus offAll(owner)；基类等样板真烦了再加（Open Q3） |
| 7 | 批量/调度 | 首版上 batch / 同步 push | **同步 push** | YAGNI，实测抖动再加微任务 flush |
| 8 | engine 绑定粒度 | 每控件专用 helper / 泛型 bindProp | **bindText + 泛型 bindProp + 双向 2 款** | 一个泛型覆盖 Sprite/Progress/active；专用款按需加 |

## Platform considerations（全平台 / 小游戏兼容）

- core 原语**只用 `.value` getter/setter + 闭包**，不碰 `Proxy`/装饰器/`Symbol` 反射 → 原生 / Web / 微信·抖音小游戏一致，无运行时特性依赖。
- 与三种"热"：原语是 core 公共 API，纳入 [[adr-0001]] 强引用白名单 → 主包 base 恒含全量，热更跨 bundle 引用不缺代码；自写表面可控，避免大 npm 包被 base 不可控裁剪。
- engine 半随 cc 走，无额外平台约束（cc.Label/EditBox/Toggle 全平台一致）。

## Testable seams + test plan（可测接缝 + vitest 用例）

- **core 全量 vitest**（纯 TS 零 cc，effect 同步重跑，断言调用次数/顺序，无真实时钟）：
  1. `signal`：读初值；写→读回新值；`peek()` 读值。
  2. `effect`：建立时立即跑一次；依赖 signal 变→重跑；不依赖的 signal 变→不重跑。
  3. `effect` 动态依赖：分支切换后旧依赖不再触发、新依赖开始触发（重跑前清 deps 生效）。
  4. `effect` 清理函数：重跑前跑上次的 cleanup；`dispose()` 跑最后一次 cleanup 且此后不再重跑。
  5. `signal` 幂等：写入 `Object.is` 相等值→**不**触发 effect（双向回环防护）。
  6. `computed`：惰性（无人读不算）；读触发算并缓存；依赖变→再读重算；依赖没变→再读用缓存（求值次数断言）。
  7. `computed` 链：computed 依赖 computed；底层 signal 变→顶层 effect 重跑。
  8. `untracked`：其内读 signal 不建立依赖（该 signal 变不触发外层 effect）。
  9. 菱形依赖：不崩、最终值正确（冗余重算允许，断言收敛值而非次数）。
  10. `dispose` 幂等：重复调不抛、不重复清理。
- **engine 半**：按 [[adr-0002]] 不用 cc mock 单测薄壳，走 **apps/demo 真机（Creator 3.8.7 gameView 预览）** 验证：`bindText` 改 signal→Label 文字变；`bindEditBox` 输入→signal 变→再驱动别的绑定；`BindingScope.dispose()` 后改 signal 不再动 UI（无泄漏）。与其它 engine 半同套路。

## Open Questions（待用户拍板）

1. **深响应要不要**：首版只 `signal<T>`（浅、`.value`），嵌套对象靠「整体替换」。若实际 ViewModel 大量深层嵌套需细粒度，是否补 `reactive()`（Proxy）？倾向不补（免 Proxy/深比较），用不可变整体替换约定。
2. **`batch()` 首版上不上**：倾向 YAGNI，同步 push 起步，出现连写抖动再加微任务 flush。
3. **`ReactiveComponent` 薄基类** vs 裸 `BindingScope`：要不要给 engine 一个内建 scope + 自动 `onDestroy` dispose 的基类免样板？倾向先只给 `BindingScope`（组合优于继承）。
4. **engine 双向控件覆盖面**：首版 `bindEditBox`/`bindToggle` 两款够不够？`bindSlider`/`bindRichText` 等按需加还是一次给全？倾向按需。
5. **兜底切换触发条件**：明确「什么实测症状下从自写切 `@preact/signals-core`」（菱形冗余重算成性能热点 / 需成熟 effectScope）——避免过早或过晚迁移。

---

## 实现记录（2026-07-29）

- **最终 API 与设计偏差**：与定稿一致，无偏差。
  - core `packages/core/src/reactive/reactive.ts`：`signal/computed/effect/untracked` + 类型 `Signal/ReadSignal/Dispose`。追踪核心即设计 §Behavior 三段式（全局 `activeSub` + 双向 `_subs`/`_deps` 挂钩 + 同步 push）。内部抽 `runWith(sub, fn)` 帮手统一 effect/computed/untracked 的 `activeSub` 进出栈（DRY，顺带绕开 eslint `no-this-alias`）。
  - engine `packages/engine/src/reactive-bind.ts`：`bindText/bindProp/bindEditBox/bindToggle/BindingScope`。`bind*` 本体 = `effect(() => 属性 = get())`，双向再挂 cc 事件写回 signal（cc 类型走 `import type`，运行时只依赖 core 的 `effect`）。
  - 按定稿砍：`batch()`（Open Q2）、`reactive()` 深响应（Q1，用浅 signal + 整体替换）、`ReactiveComponent` 基类（Q3，只给 `BindingScope`）、`bindSlider` 等专用款（Q4，泛型 `bindProp` 覆盖）。
- **测试结果 / 覆盖率**：core 半 **10 vitest 全绿**（signal 读写/peek、幂等 setter 挡回环、effect 立即跑/依赖变重跑/无关不跑/动态依赖切换/清理函数、dispose 幂等、computed 惰性+缓存+重算/链/菱形收敛、untracked 不建依赖）。**四门全绿**：typecheck exit 0 / lint exit 0 / 全仓 vitest **363 passed** / build 成功（core ESM+DTS、engine ESM+DTS）。
- **engine 半真机验证**：按 [[adr-0002]] 薄壳不单测，走 apps/demo 真机 gameView 预览——**PASS**（2026-07-29，DemoBoot 代码化 UI smoke，无 prefab）。日志实证：`🔗 reactive 绑定 smoke: text 'Jane:100'→'Bob:42'→dispose后'Bob:42' | active true→false→dispose后false → PASS`——`bindText` 首帧同步把 `'Jane:100'` 写进真 `cc.Label.string`、改两个 signal 自动刷 `'Bob:42'`；`bindProp` 泛型把 boolean 绑到 `Node.active`（true→false）；`BindingScope.dispose()` 后再改 signal，label/active 冻结不变（effect 已退订、无泄漏）。`bindEditBox`/`bindToggle`（双向）本轮未挂真控件事件验，逻辑同构（单向 effect + 反向 `node.on` 写回幂等 setter），待接真界面时顺带验。
- **commit / PR**：待提交。
- **遗留 Minors**：
  - computed 无显式 dispose——随 ViewModel GC 整体回收（signal 存活即 computed 存活；ViewModel 释放时一起没）。需要长生命周期共享 computed 再补退订。
  - 朴素同步 push，菱形依赖一次冗余重算（设计 §Behavior 的 ponytail ceiling），实测成热点再上 `batch()` 或 vendor `@preact/signals-core`。
  - core 新增公共 API → `coreApiHash` 会变（属预期，reactive 是新增表面）；旧 demo 戳 `fc033ce4c4a7` 已过时，下次出包重新打戳即可。

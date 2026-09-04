---
模块: crash-reporting
所在包: packages/core（收敛逻辑）+ packages/engine（钩子与原生转发）
状态: 已实现（JS 半；Java 半见 hlgit #50）
跟踪: hlgit #42（wayfinder 图）· 接缝定稿见 #47 · 渠道组装见 ADR-0022
摘要: JS 未捕获异常送到崩溃平台。接缝只有两个函数——core 一个纯逻辑收敛器、engine 一个 install；上下文用 getter 现取，不用谁来推。
何时读: 要接一家崩溃上报 SDK，或要改「哪些异常值得上报」的规则时。
日期: 2026-09-04
依赖: logging · di-container
---

# 崩溃上报 设计文档

## TL;DR

- **不用改 C++**。JS 侧的 `globalThis.__errorHandler` 就是出口，在 base 层、**热更可改**。
- **kit 不出接口**。core 出一个零 `cc` 的收敛器，engine 出一个 `installCrashReporter(getContext)`。没有 `ICrashReporter`、没有 DI token、没有 `setUser()` —— 上下文用 **getter 现取**，登录成功 / 切场景 / 热更完谁都不用记得去通知它。
- **必须收敛**。Cocos 的 JS 异常常常每帧重复，不去重的话一秒钟就把 Crashlytics 那 8 个格子刷满，而它保留的是**最近** 8 条 —— 被挤掉的恰恰是根因。
- **往 Java 递结构化原始数据**，各渠道自己决定塞进自家 API —— 两家 SDK 的能力不对称（Bugly 吃任意堆栈文本，Crashlytics 只能造假 `Throwable`）。

## Purpose（目标与定位）

做什么：让 JS 里一个没人接的异常，出现在崩溃平台后台，带够用的定位信息。

不做什么（YAGNI，故意砍掉的）：

| 砍掉的 | 什么时候收回来 | 收回来时的约束 |
|---|---|---|
| `ICrashReporter` 接口 + DI token | 业务侧真的出现「主动上报一个捕获到的错误」的调用点时 | 现在一个都没有。加接口是非破坏性变更 |
| `setUser(id)` / `setCustomKey()` 这类命令式 API | 永不 | 命令式意味着上报层要存状态、还要有人记得在登录后调它 —— 忘了就是**静默**少一块信息。getter 现取没有这个失败模式 |
| 单会话内的重复次数 | 永不（见决策 #5） | 带 `seq` 会污染聚合键，把一个 issue 拆成多个，毁掉「影响用户数」 |
| 致命崩溃（fatal / OOM）的 JS 堆栈 | 有需求时 | `error.stack` 本就不覆盖它们；那条路只剩 C++ 的 `_nativeExceptionCallback`，而它拿到的 `stack` 是 `"(no stack information)"` |
| sourcemap 自动还原 | 需要读线上堆栈时 | 两家平台都不还原 JS，只能自己做。见 `docs/research/2026-09-03-cocos-js-stack-reporting.md` |
| 面包屑 / 自定义日志上报 | 有需求时 | 两家都有 `log()`，但现在没有调用点 |

## Public API（TypeScript 精确签名）

### core：`packages/core/src/crash/`

```ts
/** `__errorHandler` 递过来的四段原始数据，未经处理。 */
export interface RawCrash {
  readonly location: string;   // ⚠️ 可能极长，见「已知行为与坑」
  readonly linenum: number;
  readonly message: string;
  readonly stack: string;
}

/** 收敛并规整之后、可以过河的形状。 */
export interface CrashEvent {
  readonly location: string;   // 已截首行
  readonly linenum: number;
  readonly message: string;
  readonly stack: string;
  /** 指纹，供调试与单测断言；**不参与**上报载荷 */
  readonly fingerprint: string;
}

export interface CrashFilter {
  /** 规整 + 判定。返回 `null` = 这条不报（重复，或已达上限）。 */
  accept(raw: RawCrash): CrashEvent | null;
}

/**
 * @param maxKinds 一次会话最多上报多少**种**不同指纹。默认 8 —— Crashlytics 的硬限
 *                 （一次会话只保留最近 8 条非致命）。
 */
export function createCrashFilter(opts?: { maxKinds?: number }): CrashFilter;

/**
 * 拼成过河的 JSON。`fingerprint` **不进载荷**。
 *
 * @param getContext 上报**这一刻**现取。它自己抛不会打断上报，取不到就是空表——
 *                   少一块上下文远好过整条崩溃报不出去。
 */
export function crashPayload(
  event: CrashEvent,
  getContext: () => Record<string, string>,
): string;
```

**没有单例**。`createCrashFilter()` 每次返回新实例，状态存在闭包里（硬规则二）。

### engine：`packages/engine/src/crash-reporter.ts`

```ts
/**
 * 装上 JS 未捕获异常的钩子，转发给原生上报。**非 native 平台直接 no-op。**
 *
 * @param getContext 上报时**现取**的上下文（玩家 ID / 当前场景 / 产物指纹 …）。
 *                   它自己抛异常不会打断上报 —— 内部 try/catch，取不到就是空表。
 */
export function installCrashReporter(getContext: () => Record<string, string>): void;
```

**Android 以外 no-op** —— 判据是 `sys.os !== sys.OS.ANDROID`，不是 `sys.isNative`：`CckReport`
是个 Java 类，而 iOS 的 `callStaticMethod` 连签名那个参数都不吃，形状根本不同。

这个函数里**没有分支逻辑**：装钩子、拿 `filter.accept` 的结果、非 `null` 就调一次 JNI，
完。判定 / 截断 / 载荷拼装全在 core（见下面决策 #7 与「测试」一节）。

调用点在接入方的启动序列里，一次，之后不用管：

```ts
installCrashReporter(() => ({
  player: currentPlayerId() ?? '-',
  scene: director.getScene()?.name ?? '-',
  base: baseStamp(),
}));
```

## Behavior & data flow（行为与数据流）

```
JS 抛了一个没人接的异常
  → 引擎 ScriptEngine::reportException
      ├─ callExceptionCallback  → C++ 的 CC_LOG_ERROR + 引擎 jsb.onError 里那句 console.error
      └─ globalThis.__errorHandler(location, linenum, message, stack)   ← 我们在这儿
  → filter.accept(raw)          截首行 / 算指纹 / 去重 / 上限     null 就到此为止
  → JSON.stringify({ ...event, ctx: getContext() })
  → native.reflection.callStaticMethod(
       'com/cck/report/CckReport', 'report', '(Ljava/lang/String;)V', json)
  → Java（flavor 决定是哪家）→ Bugly.postException / Crashlytics.recordException
```

### 过河的 JSON

```json
{
  "location": "src/foo/Bar.ts:42",
  "linenum": 42,
  "message": "TypeError: x is undefined",
  "stack": "at Bar.update (bundle.fa0b0.js:1:52341)\nat ...",
  "ctx": { "player": "10086", "scene": "Lobby", "base": "a3f9c1" }
}
```

**结构化，不在 JS 侧拼成某一家的形状** —— 两家 SDK 的能力不对称：

| | 自定义堆栈 | 一次会话的非致命上限 |
|---|---|---|
| Bugly | ✅ `postException(...)` 的 `stack` **吃任意字符串** | 未查到 |
| Crashlytics | ❌ Android 无 API，只能造 `Throwable` + `setStackTrace`（**待实测**） | **最近 8 条** |

各 flavor 的 `CckReport.report(String json)` 自己解、自己决定怎么塞。

### 收敛规则

指纹 = `message` + `stack` 首帧。**同一指纹一次会话只报第一次**，之后静默丢弃；不同指纹最多 `maxKinds`（默认 8）种。

被丢掉的那些**不是消失了** —— 我们没有接管 `jsb.onError`，引擎那句 `console.error` 原样还在，logcat 里每次异常照打、一条不漏。开发期和真机调试期判断「这个错是不是每帧都炸」根本不需要上报层参与。

## Key design decisions（决策表）

| # | 维度 | 选项 | 定稿 | 一句话理由 |
|---|---|---|---|---|
| 1 | 异常出口 | C++ override `handleException` / `jsb.onError` / `__errorHandler` | **`__errorHandler`** | 三者在 `ScriptEngine.cpp:1140-1172` 同一个函数里被调，覆盖面一样。但它**空着**（不必接管引擎那句 `console.error`，少一个「忘了补回去」的坑）、**多给一个行号**、**自带重入保护**（`_isErrorHandleWorking`，上报代码自己抛不会递归炸）。而 C++ 那条在引擎层，改一次发一次 APK，还拿不到业务上下文。 |
| 2 | 上下文怎么进来 | `setUser()` 命令式 / getter 现取 | **getter** | 命令式要上报层存状态，还要有人记得在登录后调 —— 忘了是**静默**少一块信息。getter 的真相源在原处（登录态、bundle 表），上报层去问。 |
| 3 | kit 出不出接口 | `ICrashReporter` + DI / 扩 `ILogger` / 都不出 | **都不出** | 没有任何主动上报的调用点（`ICrashReporter` 会是空壳，同 `IChannelSdk` 砍 `init()` 的教训）。扩 `ILogger` 更糟：`error()` 现在是纯日志，加上报就成了隐式网络行为，而且 `ILogger` 在 core、上报在 engine，方向倒挂。 |
| 4 | 递给 Java 的形状 | JS 侧拼成某家的样子 / 结构化原始数据 | **结构化** | 两家 SDK 能力不对称，谁能吃什么由谁自己决定；JS 侧一行渠道分支都不写。 |
| 5 | 单会话内的重复 | 全发 / 纯去重 / 指数退避带 `seq` | **纯去重** | 全发：`update` 里的错每秒 60 次，8 个格子 0.13 秒被同一个错刷满，而平台保留的是**最近** 8 条 → 根因被挤掉。指数退避带 `seq`：`seq` 进 message 或 stack 会**污染聚合键**（Bugly 按 `errorType+errorMsg+stack` 聚合），一个 issue 被拆成多个，毁掉「影响用户数」这个真正的热度指标；放自定义字段则只在单条详情里可见，收益没了。单会话内的频率去 logcat 看。 |
| 6 | `maxKinds` 默认值 | — | **8** | 对齐 Crashlytics 的硬限。Bugly 未查到上限，取小的那个不会错。 |
| 7 | 收敛逻辑放哪 | engine / core | **core** | 零 `cc`、node 直跑、单测好写（硬规则一）。engine 那半只有装钩子和转发。 |

## Platform considerations

| 环境 | 行为 |
|---|---|
| Android native | 全链路。flavor 决定是 Bugly 还是 Crashlytics（[ADR-0022](../../../../docs/adr/0022-capability-sdk-as-channel-attribute.md)） |
| iOS | **no-op**（判据是 `sys.os === sys.OS.ANDROID`）。`__errorHandler` 本身是跨平台的，但 `CckReport` 是 Java 类、`callStaticMethod` 在 iOS 上连签名参数都不吃 —— 要接得另写 ObjC 那半 |
| Web / 小游戏 | `installCrashReporter` **no-op**。要接的话是另一套 SDK，另说 |
| 编辑器预览 | 同上，no-op。异常照常进 console |

**与三种「热」的关系**：钩子与收敛逻辑都在 **base 层**，改「哪些异常值得上报」「上下文带什么」是热更 + 重启；**Java 那半在引擎层，改它必须发新包**。所以「Java 侧尽量薄」在这里同样是硬约束 —— Java 只负责 `JSON.parse` 加一次 SDK 调用。

## Testable seams + 测试

**逻辑全在 core，所以测试也全在 core** —— `packages/core/src/crash/__tests__/crash.test.ts`，15 条，node 直跑：

- **去重**：同一指纹喂 100 次只过一次；`message` 同而 `stack` 首帧不同算两种；首帧同而后续帧不同算一种；首帧同而 `message` 不同算两种。
- **上限**：默认喂 9 种只过前 8 种；`maxKinds: 2` 只过 2 种；**达到上限后连已报过的那种也不再报**（`size >= maxKinds` 先于 `has` 之后判，两条路都堵死）。
- **无单例**：两次 `createCrashFilter()` 状态不串（硬规则二）。
- **截首行**：喂一个带整行源码回显的 `location`（约 54 KB）只留首行；CRLF 产物的 `
` 与尾随空白一并去掉。
- **载荷**：`fingerprint` 不在 JSON 里（顶层键恰好是 `ctx/linenum/location/message/stack` 五个）；`ctx` 是**上报那一刻**现取而非装钩子那一刻；getter 抛异常 / 返回 `undefined` 都退化成空表且不打断上报。

**engine 那半没有单测，这是刻意的。** `native.reflection.callStaticMethod` 是 JNI 调用，按
[ADR-0002](../../../../docs/adr/0002-engine-test-strategy-capped-cc-mock.md) 属「需要真实引擎行为」那一类，
**禁止进 cc mock**（同仓先例：`hotupdate-backend.ts` 重 cc、无单测）。与其为了凑一条断言把 mock 撑大，
不如让 engine 那半薄到**没有逻辑可测** —— 这正是把判定与载荷拼装下沉 core 的原因。它的验证走真机（#50）。

只能真机验的：那一次 JNI 调用、Java 侧的 SDK 调用、后台真收到。

---

## 已知行为与坑

**`location` 会回显整行源码，release 下单次约 100 KB。** 引擎给的 `location` 不是一个路径，它把出错那一行的源码连同等长空格一起附在后面。release 产物压缩后单行可达 5 万字符 → **必须只取第一行**再上报，否则一条崩溃就能吃掉配额。

**`Error.stackTraceLimit` 默认只有 10 帧**，在 Cocos 的事件派发链里经常还没走到业务代码就用完了。`installCrashReporter` 已把它调到 **30**。它是 V8 独有属性，engine 的 tsconfig 不含 node 类型，所以那行带一次显式收窄（`(Error as { stackTraceLimit?: number })`）。

**`error.stack` 不覆盖 fatal / OOM。** 那两条走 `onFatalErrorCallback`，`stack` 是字面量 `"(no stack information)"`。所以「进程直接没了」这类现场，本模块收不到。

**平台不还原 JS 堆栈。** Crashlytics 只吃 ProGuard/R8 mapping 与 NDK 符号；Bugly 认 JS 这个 category 但只把 `stack` 当字符串存。可读性得自己做 —— 靠 `md5Cache` 的产物指纹（`bundle.fa0b0.js`）**逐帧自证**版本，本地用对应的 sourcemap 还原。**不要发明「一个全局 release 号」**：base 与分包各自独立热更，一个号对不上多个包。

**开 `sourceMaps` 的话，`.map` 绝不能进热更包。** `hot-update-manifest.ts` 的 `walkFiles` 是无差别收集、`ENGINE_BOUND` 里没有 `.map` —— 不拦就是**下发给每个玩家并泄漏源码**。必须在 `cck-manifest` 之前搬走。

**引擎那句 `console.error` 还在。** 因为我们用的是 `__errorHandler` 而不是 `jsb.onError`（后者被 `platforms/native/engine/jsb-game.js:32` 占着）。这是被丢弃的重复异常仍然可见的原因，也是选它的理由之一 —— 别为了「统一」去接管 `jsb.onError`。

**`__errorHandler` 在引擎源码里标着 `// For compatiblity`。** 它可能在未来的引擎版本里被移除。升引擎时这条要重新验一遍；真没了就退回 `jsb.onError`（记得补 `console.error`）或 C++ override。

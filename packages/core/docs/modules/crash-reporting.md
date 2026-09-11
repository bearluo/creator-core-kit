---
模块: crash-reporting
所在包: packages/core（收敛逻辑）+ packages/engine（钩子与原生转发）
状态: 已实现，真机跑通（Bugly 与 Firebase 两家后台都收到了带堆栈的 JS 异常）
跟踪: hlgit #42（wayfinder 图）· 接缝定稿见 #47 · 渠道组装见 ADR-0022 · 不装 plugin 的两个前提见 ADR-0023
摘要: JS 未捕获异常送到崩溃平台。接缝只有两个函数——core 一个纯逻辑收敛器、engine 一个 install；上下文用 getter 现取，不用谁来推。
何时读: 要接一家崩溃上报 SDK，或要改「哪些异常值得上报」的规则时。
日期: 2026-09-07
依赖: logging · di-container
---

# 崩溃上报 设计文档

## TL;DR

- **不用改 C++**。JS 侧的 `globalThis.__errorHandler` 就是出口，在 base 层、**热更可改**。
- **kit 不出接口**。core 出一个零 `cc` 的收敛器，engine 出一个 `installCrashReporter(getContext)`。没有 `ICrashReporter`、没有 DI token、没有 `setUser()` —— 上下文用 **getter 现取**，登录成功 / 切场景 / 热更完谁都不用记得去通知它。
- **必须收敛**。Cocos 的 JS 异常常常每帧重复，不去重的话一秒钟就把 Crashlytics 那 8 个格子刷满，而它保留的是**最近** 8 条 —— 被挤掉的恰恰是根因。
- **往 Java 递结构化原始数据**，各渠道自己决定塞进自家 API —— 两家 SDK 的能力不对称（Bugly 吃任意堆栈文本，Crashlytics 只能造假 `Throwable`，所以载荷里 `stack` 与 `frames` 两份都给）。
- **Java 侧的契约是两个方法**：启动时一次 `init(ctxJson)`、每条异常一次 `report(json)`。Bugly 不 `init` 完全不工作，这个入口不是可选项。

## Purpose（目标与定位）

做什么：让 JS 里一个没人接的异常，出现在崩溃平台后台，带够用的定位信息。

不做什么（YAGNI，故意砍掉的）：

| 砍掉的 | 什么时候收回来 | 收回来时的约束 |
|---|---|---|
| `ICrashReporter` 接口 + DI token | 业务侧真的出现「主动上报一个捕获到的错误」的调用点时 | 现在一个都没有。加接口是非破坏性变更 |
| `setUser(id)` / `setCustomKey()` 这类命令式 API | 永不 | 命令式意味着上报层要存状态、还要有人记得在登录后调它 —— 忘了就是**静默**少一块信息。getter 现取没有这个失败模式 |

> **上下文里的值住在别的 bundle 时也是拉不是推。** 典型是玩家 ID：登录态往往在某个可热更的
> 业务 bundle 里，而装钩子的代码在主包、`import` 不得（那会把那个 bundle 拽进 base）。做法是
> **给那个 bundle 的入口类加一个静态读取器，主包按类名现问**（`js.getClassByName`）——
> 拿不到就是空，**空是正常状态不是故障**：早于登录的崩溃照样要报出去，只是少这一块。
> 反过来「登录成功时推一次」会退回上面那一行否决掉的失败模式。接入方的实例见
> `apps/demo/docs/bundle-layout.md`。
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

/** 一帧 JS 堆栈。Java 侧照着造 `StackTraceElement(fn, file, line)`。 */
export interface JsFrame {
  readonly fn: string;    // 匿名帧记 `<anonymous>`（StackTraceElement 不吃 null）
  readonly file: string;
  readonly line: number;
}

/**
 * 把 V8 的堆栈字符串拆成结构化帧。畸形行（`at [native code]`、空行）安静跳过。
 * 默认最多 30 帧，与 `Error.stackTraceLimit` 对齐。
 *
 * 它**为 Crashlytics 而存在**：那边没有「上报一段自定义堆栈文本」的 API，只能造 `Throwable`
 * 再 `setStackTrace(...)`。Bugly 不需要它。
 */
export function parseJsFrames(stack: string, max?: number): JsFrame[];

/** 现取上下文；getter 自己抛不算错，退化成空表。上报与初始化两处都用它。 */
export function crashContext(getContext: () => Record<string, string>): Record<string, string>;

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
  "frames": [{ "fn": "Bar.update", "file": "bundle.fa0b0.js", "line": 1 }],
  "ctx": { "player": "10086", "scene": "Lobby", "base": "a3f9c1" }
}
```

`stack` 与 `frames` 是**同一份东西的两种形状**，谁也不是冗余：Bugly 只要前者，Crashlytics 只能用后者。

**结构化，不在 JS 侧拼成某一家的形状** —— 两家 SDK 的能力不对称：

| | 自定义堆栈 | 一次会话的非致命上限 |
|---|---|---|
| Bugly | ✅ `postException(8, "JsError", msg, stack, extra)` 的 `stack` **吃任意字符串** | 未查到 |
| Crashlytics | ❌ Android 无此 API，造 `Throwable` + `setStackTrace(frames)`（**已实测可行**） | **最近 8 条** |

各 flavor 的 `CckReport.report(String json)` 自己解、自己决定怎么塞。

### Java 侧的两个入口

```java
package com.cck.report;
public final class CckReport {
    public static void init(String ctxJson);   // 启动时一次，参数是上下文表
    public static void report(String json);    // 每条异常一次，参数是上面那份载荷
}
```

两个都是 `(Ljava/lang/String;)V`。`init` 不是装饰：**Bugly 不 `initCrashReport` 就完全不工作**
（Crashlytics 靠 `FirebaseInitProvider` 自动起，用 `init` 只是设上下文自定义键，顺带把
`FirebaseApp` 拿没拿到打进 logcat）。`installCrashReporter` **先 `init` 再装钩子** ——
钩子一装就可能有异常进来，而没 init 过的 Bugly 会直接把它丢掉。

⚠️ **接不住引擎起来之前的原生崩溃**：`init` 发生在 `Bootstrap.start()` 里。要接得在 Java 的
Application/Activity 里初始化，而那是所有渠道共用的 main 源集，放不下渠道专属代码。

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

**逻辑全在 core，所以测试也全在 core** —— `packages/core/src/crash/__tests__/crash.test.ts`，24 条，node 直跑：

- **去重**：同一指纹喂 100 次只过一次；`message` 同而 `stack` 首帧不同算两种；首帧同而后续帧不同算一种；首帧同而 `message` 不同算两种。
- **上限**：默认喂 9 种只过前 8 种；`maxKinds: 2` 只过 2 种；**达到上限后连已报过的那种也不再报**（`size >= maxKinds` 先于 `has` 之后判，两条路都堵死）。
- **无单例**：两次 `createCrashFilter()` 状态不串（硬规则二）。
- **截首行**：喂一个带整行源码回显的 `location`（约 54 KB）只留首行；CRLF 产物的 `
` 与尾随空白一并去掉。
- **载荷**：`fingerprint` 不在 JSON 里（顶层键恰好是 `ctx/linenum/location/message/stack` 五个）；`ctx` 是**上报那一刻**现取而非装钩子那一刻；getter 抛异常 / 返回 `undefined` 都退化成空表且不打断上报。

- **堆栈解析**：具名帧 / 匿名帧 / 首行的消息 / 多帧保序 / 畸形行跳过 / 空堆栈 / 帧数上限；**文件路径里带冒号**（`file:///D:/proj/main.js:42:7`）时认最后两段数字 —— 非贪婪匹配会把盘符当成行号。

**engine 那半没有单测，这是刻意的。** `native.reflection.callStaticMethod` 是 JNI 调用，按
[ADR-0002](../../../../docs/adr/0002-engine-test-strategy-capped-cc-mock.md) 属「需要真实引擎行为」那一类，
**禁止进 cc mock**（同仓先例：`hotupdate-backend.ts` 重 cc、无单测）。与其为了凑一条断言把 mock 撑大，
不如让 engine 那半薄到**没有逻辑可测** —— 这正是把判定与载荷拼装下沉 core 的原因。它的验证走真机（#50）。

只能真机验的：那两次 JNI 调用、Java 侧的 SDK 调用、后台真收到。**已经验过了**（Android 14 /
x86_64 模拟器，hlgit #50）：

| | 证据 |
|---|---|
| Bugly（`qq` 包） | `CRASH TYPE: H5` · `JsError` · 完整 JS 帧 · `APP VER: 1.3.0`（`setAppVersion` 喂的热更版本）· `[Upload] Success: crash` / HTTP 200 |
| Firebase（`google` 包） | `FirebaseApp 就绪：[DEFAULT] / 1:414118306834:...` · `Initializing Firebase Crashlytics 19.0.3` · 服务端配置 `status: activated` · 重启后 `POST crashlyticsreports-pa.googleapis.com/v1/firelog/legacy/batchlog` |

两家后台的条目长这样。**Bugly 存的是原始 `stack` 文本**，路径、行、列原样保留：

```
#2 JsError
Error: cck-crash-probe: 真机验证用的假异常

at deep (assets/main/index.f8c7f.js:339:21)
```

Crashlytics 后台那条长这样 —— **五帧全是 JS 帧，一条 Java 帧都没混进来**（`fillInStackTrace`
那个空实现的作用），类名就是分组维度：

```
Non-fatal Exception: com.cck.report.CckReport$JsException: Error: cck-crash-probe: 真机验证用的假异常
       at js.deep(index.f8c7f.js:339)
       at js.outer(index.f8c7f.js:341)
       at js.<anonymous>(index.f8c7f.js:342)
       at js.fireTimeout(web-adapter.js:586)
       at js.tick(web-adapter.js:546)
```

`StackTraceElement("js", fn, file, line)` 在后台渲染成 `js.<fn>(<file>:<line>)`，`fn` 缺名时是
`<anonymous>` —— 跟 `parseJsFrames` 的兜底对上了。**每帧自带产物指纹**（`index.f8c7f.js`）也在这里
兑现：不需要「一个全局 release 号」就能知道该拿哪份 sourcemap 还原。末两帧的 `web-adapter.js` 没有
指纹，那是 jsb-adapter，不走热更、也不参与还原。

⚠️ **Crashlytics 这条路会丢列号** —— `StackTraceElement` 的四个字段里根本没有「列」，
所以 `FRAME_RE` 虽认列号，`JsFrame` 也没带它（带过去没处放）。sourcemap 还原要的是 line+column，
所以 Crashlytics **渲染出来的那份堆栈只够定位到行**。补法是 `cap-report-firebase` 在 `recordException`
之前多调一句 `fc.log(stack)` —— 原始文本原样挂在那条记录的 log 面板上（上限 64KB，够装 30 帧），
列号保住了。Bugly 那边不用补，它存的本来就是原文。**还原工具要读的是这一份，不是渲染出来那份。**

从后台那条堆栈回到源码分两段：**「哪一版 / 哪个 commit」已经成立**（产物指纹 → `grep releases/` →
`releases/<v>/source.json`，见 [`hotupdate-pipeline`](../../../../apps/demo/docs/hotupdate-pipeline.md#从崩溃堆栈回到代码)）；
**「行号 → 源码行」还没做** —— 两份 build-config 现在都是 `sourceMaps: false`，产物里一份 `.map` 都没有（hlgit #54）。

验证手法：**往 `Bootstrap` 里临时种一个 `setTimeout` 抛异常，验完删**。没走 V8 inspector 注入 ——
`Game.cpp` 那个 `#if CC_DEBUG` 分支在本工程的构建里没生效，6086 端口不监听。临时改代码的好处是
走的就是引擎真正的 `reportException` 路径，比注入更实。

---

## 已知行为与坑

**`location` 会回显整行源码，release 下单次约 100 KB。** 引擎给的 `location` 不是一个路径，它把出错那一行的源码连同等长空格一起附在后面。release 产物压缩后单行可达 5 万字符 → **必须只取第一行**再上报，否则一条崩溃就能吃掉配额。

**`Error.stackTraceLimit` 默认只有 10 帧**，在 Cocos 的事件派发链里经常还没走到业务代码就用完了。`installCrashReporter` 已把它调到 **30**。它是 V8 独有属性，engine 的 tsconfig 不含 node 类型，所以那行带一次显式收窄（`(Error as { stackTraceLimit?: number })`）。

**`error.stack` 不覆盖 fatal / OOM。** 那两条走 `onFatalErrorCallback`，`stack` 是字面量 `"(no stack information)"`。所以「进程直接没了」这类现场，本模块收不到。

**平台不还原 JS 堆栈。** Crashlytics 只吃 ProGuard/R8 mapping 与 NDK 符号；Bugly 认 JS 这个 category 但只把 `stack` 当字符串存。可读性得自己做 —— 靠 `md5Cache` 的产物指纹（`bundle.fa0b0.js`）**逐帧自证**版本，本地用对应的 sourcemap 还原。**不要发明「一个全局 release 号」**：base 与分包各自独立热更，一个号对不上多个包。

**开 `sourceMaps` 的话，`.map` 绝不能进热更包。** `hot-update-manifest.ts` 的 `walkFiles` 是无差别收集、`ENGINE_BOUND` 里没有 `.map` —— 不拦就是**下发给每个玩家并泄漏源码**。必须在 `cck-manifest` 之前搬走。

**引擎那句 `console.error` 还在。** 因为我们用的是 `__errorHandler` 而不是 `jsb.onError`（后者被 `platforms/native/engine/jsb-game.js:32` 占着）。这是被丢弃的重复异常仍然可见的原因，也是选它的理由之一 —— 别为了「统一」去接管 `jsb.onError`。

**`__errorHandler` 在引擎源码里标着 `// For compatiblity`。** 它可能在未来的引擎版本里被移除。升引擎时这条要重新验一遍；真没了就退回 `jsb.onError`（记得补 `console.error`）或 C++ override。

**上下文里的 `ver` 要喂给 Bugly 的 `setAppVersion`。** 不设的话后台读 APK 的 `versionName`，
热更前后的问题全堆在出包那天的版本号下面，分不开。真机上确认过后台那条记录写的是 `APP VER: 1.3.0`
（`APP_CONFIG.version`），不是 gradle 的 `versionName "1.0"`。

**Crashlytics 那半有两个启动前提，少一个 App 直接打不开**（不是「上报不了」）：`firebase.xml` 里
的 `com.crashlytics.RequireBuildId=false`，以及 Firebase BoM 钉在 33.1.2。两条的判据与代价见
[ADR-0023](../../../../docs/adr/0023-crashlytics-without-gradle-plugin.md)。

**`extraInfo` 的值会被截到 200 字节。** Bugly 官方限制：最多 50 对、key ≤ 50 字节、value ≤ 200 字节，
**超长静默截断**。`cap-report-bugly` 里自己先截了一刀，免得后台看到半截 UTF-8。

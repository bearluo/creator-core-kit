---
模块: channel-sdk
所在包: packages/core（接口与编排）+ packages/engine（cc / jsb 适配）
状态: 草案 v0
跟踪: hlgit #29（wayfinder 图）—— 决策逐票落定于此；下方 Open Questions 已被它部分回答
摘要: 各发行渠道 SDK（登录 / 支付 / 广告 / 分享 / 实名 / 埋点）的统一接缝——core 出接口，渠道实现按打包期常量 `channel` 选一个装进 DI。
何时读: 要接微信 / 抖音小游戏、Android 渠道包（华为 / 小米 / OPPO / vivo / TapTap）、iOS 内购，或要给已接的渠道加一种能力时。
日期: 2026-09-03
依赖: di-container · bootstrap（KitModule）· app（LaunchStep）· network（IHttp）
---

# 渠道 SDK 接入 设计文档

## TL;DR

- **框架不需要新机制**。DI 容器、`KitModule`、可插拔 `LaunchStep`、打包期常量 `channel` 已经齐了，接 SDK 只是往里填三样东西：core 的一个接口 `IChannelSdk`、engine 的一个原生桥 `callNative()`、项目的一张 `channel → 实现` 表。
- **术语先分清**：**平台**（Android / iOS / Web / 小游戏）是运行环境，`cc.sys` 已经能判；**渠道**是发行方（微信 / 华为 / TapTap），决定调谁的 SDK。变的是渠道，不是平台 —— 所以接口按渠道切，不按平台切。
- **一个接口，能力用可选方法表达**（`sdk.pay?.()`）。TS 的可选方法本身就是能力查询，不另造 `has(cap)` 那一套。
- **不拆 bundle**：渠道 JS 胶水只有几 KB（真正的 SDK 是 `wx.*` 全局对象或 APK 里的 Java 类），全打进包里由 `channel` 常量选一个即可。
- **支付的钱不经客户端**：下单和到账判定都在服务端，`pay()` 的返回值只用来关 UI，永远不用来发货。

## Purpose（目标与定位）

做什么：给「同一份游戏代码要在 N 个渠道上跑」提供一条唯一接缝，使业务层写 `getChannelSdk().login()` 而不认识 `wx` / `jsb` / 华为账号 SDK。

不做什么（YAGNI，首版故意砍掉）：

| 砍掉的 | 什么时候收回来 |
|---|---|
| 独立的 `IAdService` | 接第一个**独立于渠道**的广告 SDK（穿山甲 / 优量汇）时。首版广告是渠道 SDK 的一个可选方法（`wx.createRewardedVideoAd` 本来就是渠道自带的）。 |
| 渠道 SDK 拆 bundle | 单渠道 JS 胶水超过 ~50KB，或出现「一个包内切多渠道」的真实需求时。现在一个渠道一个包，`if` 都不用写第二遍。 |
| SDK 能力的运行时注册 / 热插拔 | 永不。渠道在出包时就定死了，运行时换渠道等于换游戏。 |
| 统一的埋点管线（多家统计并行上报） | 接入第二家统计时。首版 `report()` 直通渠道自己的埋点。 |

## Public API（TypeScript 精确签名）

### core：`packages/core/src/channel/`

```ts
/** 渠道用户身份。渠道 SDK 登录只产出**凭据**，换成游戏账号是服务端的事。 */
export interface ChannelIdentity {
  /** 渠道标识，与 `AppConfig.channel` 同值。 */
  readonly channel: string;
  /**
   * 渠道下发的一次性凭据（微信 `code`、华为 `authorizationCode`、TapTap `accessToken`…）。
   * **不解释内容**：服务端按 channel 分派到对应的验签流程
   * （对齐 ADR-0011「协议契约由项目定，kit 不含常量」）。
   */
  readonly credential: string;
  /** 渠道内的稳定用户 id（有就带上，用于风控 / 客服查号）；拿不到时为空串。 */
  readonly openId?: string;
  /** 昵称 / 头像，渠道给就带，UI 可用可不用。 */
  readonly nickname?: string;
  readonly avatarUrl?: string;
}

/** 一次支付请求。**订单必须先由服务端创建**，客户端只负责把它交给渠道收银台。 */
export interface PayOrder {
  /** 服务端订单号 —— 发货以它为准。 */
  readonly orderId: string;
  /** 渠道商品 id（各渠道后台配置的那个）。 */
  readonly productId: string;
  /** 分。仅用于渠道 SDK 要求传金额时；账目以服务端为准。 */
  readonly amountFen: number;
  /** 服务端签名 / 透传串，原样交给渠道。 */
  readonly payload?: string;
}

/**
 * 支付结果。`ok` 只表示**渠道收银台流程走完了**，不表示到账 —— 到账由服务端收渠道回调后落库，
 * 客户端据此只做「关掉支付 UI、去服务端查订单」，绝不据此发货。
 */
export type PayResult =
  | { readonly kind: 'ok'; readonly orderId: string }
  | { readonly kind: 'cancel' }
  | { readonly kind: 'fail'; readonly code: string; readonly message: string };

export interface ShareContent {
  readonly title: string;
  readonly imageUrl?: string;
  /** 渠道自解释的透传参数（微信 `query`、抖音 `extra`）。 */
  readonly query?: string;
}

/** 实名 / 防沉迷结论。大陆 Android 渠道强制，海外渠道无此概念。 */
export interface RealNameStatus {
  readonly verified: boolean;
  /** 年龄段。未成年时长限制由渠道自己弹窗拦，客户端不重复实现。 */
  readonly age: 'adult' | 'minor' | 'unknown';
}

/**
 * 渠道 SDK 接缝。**方法可选 = 能力查询**：`sdk.pay` 存在就说明这个渠道能付，
 * 不另造 `has('pay')`（两套真相必然分叉）。
 *
 * 实现放 engine（通用渠道）或项目（公司自有渠道），运行时由 `channelSdkModule()` 注册进 DI。
 */
export interface IChannelSdk {
  readonly channel: string;
  /**
   * 初始化。**允许失败且必须可重试** —— 渠道 SDK 初始化打网络的多得是，
   * 所以它挂在 `LaunchStep` 上而不是 `KitModule.start`：失败能被分类成 `network`
   * 并复用现成的重试 UI。
   */
  init(): Promise<void>;
  /** 渠道登录，返回待服务端验签的凭据。 */
  login(): Promise<ChannelIdentity>;
  /** 退出渠道账号（切号）。渠道不支持就不实现。 */
  logout?(): Promise<void>;
  pay?(order: PayOrder): Promise<PayResult>;
  share?(content: ShareContent): Promise<void>;
  /** 激励视频。返回 `true` = 看完该发奖（奖励仍应由服务端二次确认）。 */
  showRewardedAd?(placementId: string): Promise<boolean>;
  realName?(): Promise<RealNameStatus>;
  /** 渠道自带埋点。**同步、不抛** —— 埋点失败绝不能影响业务。 */
  report?(event: string, params?: Readonly<Record<string, string | number>>): void;
  /** 退出游戏（Android 渠道包常要求走渠道退出弹窗过审）。 */
  exit?(): void;
}

export const CHANNEL_SDK: Token<IChannelSdk>;
export function getChannelSdk(): IChannelSdk;

/** 什么都不做的实现：编辑器预览、Web、单测的兜底。`login()` 产出 `credential = ''`。 */
export function noopChannelSdk(channel?: string): IChannelSdk;

/**
 * 把 `init()` 包成一个启动步。插在 `platform` 之后、`dispatch` 之前 ——
 * 握手要带渠道身份，而渠道身份要 SDK 初始化完才拿得到。
 */
export function channelSdkStep(): LaunchStep;
```

### engine：`packages/engine/src/channel-sdk.ts`

```ts
/** 注册一个渠道实现进 DI。工厂而非实例：SDK 构造里可能碰 `wx` / `jsb`，要等 engine 就绪。 */
export function channelSdkModule(factory: () => IChannelSdk): KitModule;

/**
 * 原生桥（Android / iOS）。**这是整个模块唯一需要新写的基础设施** ——
 * 有了它，任何 Android 渠道 SDK 的接入都退化成「写一个 Java 静态方法 + 一行 TS」。
 *
 * Java 侧不能直接 return 异步结果，所以约定：JS 生成一个回调 id 一起传过去，
 * Java 在回调里执行 `CocosJavascriptJavaBridge.evalString("window.__cckNative('<id>', <json>)")`。
 * 本函数负责生成 id、挂全局回收表、超时清理。
 *
 * @param sig JNI 方法签名（Android 必填，如 `(Ljava/lang/String;)V`）；iOS 传 `''`。
 */
export function callNative<T>(
  clazz: string,
  method: string,
  sig: string,
  arg?: string,
  opts?: { timeoutMs?: number },
): Promise<T>;

/** 首版随包的渠道实现（其余渠道由项目自己写，形状照抄）。 */
export function wechatChannelSdk(): IChannelSdk;
```

## Behavior & data flow（行为与数据流）

### 启动期

```
platform（读 app 戳）
  → channel-sdk（sdk.init()）        ← 新增，失败可分类可重试
  → dispatch（握手，带 channel）
  → hotupdate → shared → foundation → 登录 → lobby
```

`init()` 之外的调用（login / pay / ad）全部是**业务触发**，不在启动序列里。渠道登录发生在地基层的登录闸门（`foundation/login/`）：登录界面上「渠道登录」这条路是否出现，由 prefab 里有没有那个按钮决定 —— 沿用既有约定「给哪几种登录方式由 prefab 决定」，代码不写渠道分支。

### 登录链路

```
IChannelSdk.login()            → ChannelIdentity{channel, credential}
  → LoginAccount{provider:'channel', credential:`${channel}:${credential}`}
  → POST /api/Login            → 服务端按 channel 找对应渠道的验签接口
  → LoginResult{token, playerId}          （此后与游客 / 自有账号完全同路）
```

`auth.ts` 只加一个 provider 常量与一个拼串函数，`LoginVM` 加一条 `channel()` 分支（与 `guest()` 同形状）。**服务端契约不动** —— `credential` 本来就是 provider 自解释的。

### 支付链路（钱的部分，不许简化）

```
客户端 → 服务端 CreateOrder(productId)   → orderId（+ 渠道要的签名串）
客户端 → IChannelSdk.pay(order)          → 渠道收银台
渠道   → 服务端回调（校验签名、落库、发货）      ← 唯一的到账真相
客户端 ← PayResult{kind:'ok'} 只用来关 UI，随后向服务端查订单状态
```

客户端 `pay()` 拿到 `ok` **不得**发放任何东西：模拟器、改包、重放都能伪造它。

### 原生桥的两侧契约

JS 侧：`callNative('com/x/CckPay', 'pay', '(Ljava/lang/String;)V', JSON.stringify({...}))`

Java 侧：静态方法收一个 JSON 串，其中带 `cbId`；完成时
`CocosJavascriptJavaBridge.evalString("window.__cckNative('" + cbId + "'," + json + ")")`（须 `runOnGLThread`）。

`__cckNative` 由 `callNative` 首次调用时惰性挂上；回调表按 id 一次性回收，超时（默认 30s）以 `fail` 结算，防止 Java 侧不回调导致 Promise 永挂。

## Key design decisions（决策表）

| # | 维度 | 选项 | 推荐默认 | 一句话理由 |
|---|---|---|---|---|
| 1 | 切分维度 | 按平台 / 按渠道 | **按渠道** | 平台差异 `cc.sys` 已覆盖；同一个 Android 上华为和 TapTap 的 SDK 毫无关系。 |
| 2 | 能力表达 | 多接口多 token / 一接口 + 可选方法 | **一个接口，可选方法** | 一个渠道的 SDK 本就是一整块；可选方法自带能力查询，不必维护第二份能力表。 |
| 3 | 渠道实现的分发 | 一渠道一 bundle / 全打进包按常量选 | **全打进包** | 胶水几 KB，真正的 SDK 在 `wx` 全局或 APK 里；拆包是为省体积，这里没体积可省。 |
| 4 | init 的挂载点 | `KitModule.start` / `LaunchStep` | **LaunchStep** | init 会打网络、会失败；LaunchStep 失败能分类成 `network` 并复用现成的重试 UI，start 失败只能整个 boot 炸。 |
| 5 | 渠道登录的落点 | 新登录通道 / 复用 `LoginAccount` | **复用** | `credential` 本就 provider 自解释，加一个 provider 即可，服务端契约与后续链路一字不动。 |
| 6 | 支付到账判定 | 客户端结果 / 服务端回调 | **服务端回调** | 客户端结果可伪造。这条是安全边界，任何「简化」都是漏洞。 |
| 7 | 原生异步回调 | 轮询 / 全局回调函数 | **全局回调 + id 表 + 超时** | jsb 只有 `evalString` 一条回程；超时是为了 Java 不回调时 Promise 不永挂。 |
| 8 | 广告 | 并入渠道接口 / 独立服务 | **并入（首版）** | 首批渠道的广告都是渠道自带的；独立厂商 SDK 进来时再拆，那时才有第二个实现证明抽象是对的。 |

## Platform considerations

| 环境 | 登录 | 支付 | 桥 | 备注 |
|---|---|---|---|---|
| 微信小游戏 | `wx.login` → code | `wx.requestMidasPayment` | 无（全局 `wx`） | iOS 端内购通道受政策限制，多数项目 iOS 不开内购。 |
| 抖音小游戏 | `tt.login` | `tt.requestGamePayment` | 无（全局 `tt`） | 形状与微信同构，实现基本是复制改前缀。 |
| Android 渠道包 | 渠道账号 SDK | 渠道支付 SDK | `jsb.reflection` + Java | 需改 `native/engine/android` 模板加 Java 类与 aar；**属引擎层，只能发 APK**。 |
| iOS | Apple / 渠道 | StoreKit | `jsb.reflection`（OC） | 同上，引擎层。 |
| Web / 编辑器 | `noopChannelSdk` | 无 | 无 | 预览与单测走这条，保证开发期不必装任何 SDK。 |

**与三种「热」的关系**：接口与胶水在 base 层（`@cck/core` / `@cck/engine`），改它要热更 base 并重启；**Java / OC 那半在引擎层，改它必须发新包** —— 所以桥要设计成「Java 侧尽量薄、逻辑尽量留 JS」，否则每次改渠道逻辑都变成发版。这是 `callNative` 只做转发不做业务的原因。

## Testable seams + test plan

core 侧零 `cc`，全部可 node 直跑：

- `noopChannelSdk()`：`init` / `login` 解析、可选方法确实为 `undefined`。
- `channelSdkStep()`：init 成功 → 步骤过；init 抛 → 失败被分类成可重试（喂 fake sdk）。
- 登录拼串：`channel:credential` 的拼接与解析（含 credential 里带冒号的情况 —— 服务端按**第一个**冒号切）。
- `PayResult` 三态在 VM 里的分支（cancel 不报错、fail 出文案、ok 只关 UI 不发货）。

engine 侧（cc mock 封顶，ADR-0002）：

- `callNative`：回调 id 唯一、`__cckNative` 派发到对的 Promise、超时后表被清空且 Promise 以 fail 结算、迟到的回调不炸。
- `channelSdkModule`：`stop()` 注销自己注册的 token（对齐 `appModule` 的既有教训）。
- 真渠道实现只能真机验，不写单测（ADR-0002）。

## Open Questions（待用户拍板）

1. **首批接哪个渠道**？决定第一个真实实现写谁 —— 微信小游戏（免 native，一天能通）还是某个 Android 渠道（要动 native 模板与 aar，链路长得多）。
2. **本期要不要做支付**？支付要服务端配套（下单接口 + 渠道回调验签），不做则 `pay?` 先留空。
3. **广告本期是否要**？若要且是独立厂商 SDK，决策 #8 需要提前反转。

---

## 已知行为与坑（实现后补）

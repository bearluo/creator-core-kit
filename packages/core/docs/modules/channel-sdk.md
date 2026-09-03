---
模块: channel-sdk
所在包: packages/core（接口）+ packages/engine（cc / jsb 适配）
状态: 已定稿
跟踪: hlgit #29（wayfinder 图）· 接口定稿见 #34 · Java 侧组织方式见 ADR-0021
摘要: 渠道登录的统一接缝——core 出一个只有 `login()` 的接口，Java 侧按 gradle flavor 一个渠道一个包，JS 侧零分支。
何时读: 要接一个新渠道的登录，或要给渠道接缝加一种能力（支付 / 广告 / 分享）时。
日期: 2026-09-03
依赖: di-container · bootstrap（KitModule）
---

# 渠道 SDK 接入 设计文档

## TL;DR

- **框架不需要新机制，桥也不用自己写**。引擎两侧都自带按事件名分发的多路复用器（`native.jsbBridgeWrapper` / `JsbBridgeWrapper`），接渠道只填两样：core 的 `IChannelSdk`、engine 里十来行的渠道实现。
- **接口只有一个方法**：`login()`。没有 `init()` —— 首个实现（Google Sign-In）根本没有初始化这一步，为假想的渠道留空壳不如等它来了再加（可选方法是非破坏性变更）。
- **术语**：**平台**（Android / iOS / Web / 小游戏）是运行环境，`cc.sys` 已能判；**渠道**是发行方或身份提供方。变的是渠道，所以接口按渠道切。
- **Java 侧按 gradle productFlavor 分**，一个渠道一个包，同名类各写各的实现，JS 侧调用点固定（[ADR-0021](../../../../docs/adr/0021-channel-sdk-via-gradle-product-flavors.md)）。
- **取消不是失败**：`login()` 返回三态联合类型，用户按返回键走 `cancel` 分支，安静收摊、不进错误路径。

## Purpose（目标与定位）

做什么：让业务层写 `getChannelSdk().login()` 而不认识 `wx` / `jsb` / Credential Manager / 华为账号 SDK。

不做什么（YAGNI，故意砍掉的）：

| 砍掉的 | 什么时候收回来 | 收回来时的约束 |
|---|---|---|
| `init()` | 接一个真需要初始化的渠道（华为 HMS）时，加 `init?()` | 可选方法，非破坏性 |
| 支付 | 有支付需求且服务端配套就绪时 | ⚠️ **到账只认服务端回调**。客户端 `pay()` 返回的成功只用来关 UI，绝不用来发货 —— 模拟器、改包、重放都能伪造它 |
| 广告 / 分享 / 实名防沉迷 | 各自有需求时，加可选方法 | 独立厂商的广告 SDK（穿山甲 / 优量汇）进来时才需要独立的 `IAdService`；渠道自带的广告用可选方法就够 |
| `ChannelIdentity` 的 `openId` / `nickname` / `avatarUrl` | 真有界面要显示昵称头像时 | Google 的这些字段全在 idToken 的 JWT payload 里（`sub` / `name` / `picture`），JS 侧 `split('.')` 就能解，不必让实现方单独填 |
| 渠道 SDK 拆 bundle | 单渠道 JS 胶水超过 ~50KB | 现在胶水只有几 KB，真正的 SDK 在 APK 的 flavor 里 |
| SDK 能力的运行时注册 / 热插拔 | 永不 | 渠道在出包时就定死了，运行时换渠道等于换游戏 |

## Public API（TypeScript 精确签名）

### core：`packages/core/src/channel/`

```ts
/**
 * 渠道用户身份。渠道 SDK 登录只产出**凭据**，换成游戏账号是服务端的事。
 *
 * 只有两个字段：`channel` 已经说明了凭据来自哪儿，所以 `credential` 里
 * **不拼 `google:` 之类的前缀** —— 拼串是接入方把它转成 `LoginAccount` 时的事，
 * 不是这个接口的事。
 */
export interface ChannelIdentity {
  /** 渠道标识，与 `AppConfig.channel` 同值。 */
  readonly channel: string;
  /**
   * 渠道下发的一次性凭据（Google 的 idToken、华为的 authorizationCode…）。
   * **内容不解释** —— 服务端按 `channel` 分派到对应的验签流程（对齐 ADR-0011
   * 「协议契约由项目定，kit 不含常量」）。
   */
  readonly credential: string;
}

/**
 * 失败分类。**按「给用户看的东西完全不同」来分**（判据同 `LaunchFailure`），
 * 各渠道把自己的异常映射过来，调用方不必认识任何渠道的原始错误体系。
 */
export type ChannelFailCode =
  /** 设备上没有可用账号 → 提示玩家去系统设置里登录。**玩家自己能修好**，所以单列一类。 */
  | 'no-account'
  /** 配置错：SHA-1 不匹配 / client id 类型错 / 缺依赖 → 开发期错误，玩家只能看到「登录暂不可用」。 */
  | 'config'
  /** 网络问题 → 可重试。 */
  | 'network'
  | 'unknown';

/**
 * 一次登录的结局。
 *
 * **取消单列一态，不走失败** —— 玩家在账号选择器上按返回是完全正常的行为，
 * 把它抛成错误会污染日志、进错误路径（本仓硬规则四）。Google 恰好也给了独立的
 * `GetCredentialCancellationException`，官方明确「不要自动重试」。
 */
export type LoginOutcome =
  | { readonly kind: 'ok'; readonly identity: ChannelIdentity }
  | { readonly kind: 'cancel' }
  | {
      readonly kind: 'fail';
      readonly code: ChannelFailCode;
      /** 渠道原始错误信息，**给日志排查用，不直接显示给玩家**。 */
      readonly message: string;
    };

/**
 * 渠道接缝。**只有一个方法** —— 首个实现（Google Sign-In）没有初始化这一步，
 * 加 `init?()` 是非破坏性变更，等真需要它的渠道来了再加。
 *
 * 实现放 engine（通用渠道）或项目（自有渠道），运行时由 `channelSdkModule()` 注册进 DI。
 */
export interface IChannelSdk {
  readonly channel: string;
  /** **不抛**：三种结局都在返回值里。真正的异常由实现方兜住并映射成 `fail`。 */
  login(): Promise<LoginOutcome>;
}

export const CHANNEL_SDK: Token<IChannelSdk>;
export function getChannelSdk(): IChannelSdk;

/**
 * 什么都不做的实现：编辑器预览、Web、单测的兜底。
 * `login()` 恒返回 `{kind:'fail', code:'config', message:'no channel sdk'}` ——
 * 不返回假的成功，否则「忘了配渠道」会伪装成「登录成功但凭据是空串」。
 */
export function noopChannelSdk(channel?: string): IChannelSdk;
```

### engine：`packages/engine/src/channel-sdk.ts`

```ts
/** 注册一个渠道实现进 DI。工厂而非实例：构造里可能碰 `jsb`，要等 engine 就绪。 */
export function channelSdkModule(factory: () => IChannelSdk): KitModule;

/**
 * 首个随包的渠道实现（Android + Google）。**没有通用的 `callNative`**——
 * 引擎自带的两侧多路复用器已经把桥该干的都干了，剩下的只是包一层 Promise。
 */
export function googleChannelSdk(webClientId: string): IChannelSdk;
```

**没有通用原生桥**。整个 JS 侧就这十来行，住在 `googleChannelSdk` 的闭包里：

```ts
const EVENT = 'cck:channel-login';

function nativeLogin(clientId: string): Promise<string> {
  return new Promise((resolve) => {
    const w = native.jsbBridgeWrapper;
    const on = (json: string) => { w.removeNativeEventListener(EVENT, on); resolve(json); };
    w.addNativeEventListener(EVENT, on);   // 必须先装监听器，见「已知行为与坑」
    native.reflection.callStaticMethod(
      'com/cck/channel/CckChannel', 'signIn', '(Ljava/lang/String;)V', clientId);
  });
}
```

`native.jsbBridgeWrapper`（引擎 `cocos/native-binding/impl.ts:116`）是**按事件名分发给多个监听器**的包装层，
它自己占掉了 `native.bridge.onNative` 那个单槽。业务侧不许再碰 `onNative`——那是跟引擎抢槽位。

## Behavior & data flow（行为与数据流）

### 登录链路

```
IChannelSdk.login()
  → 装 'cck:channel-login' 监听器（先装，再调）
  → native.reflection.callStaticMethod('com/cck/channel/CckChannel', 'signIn', …)
        类名固定，实现由 flavor 决定；类名或签名错会**同步抛 JS 异常**
  → Java：CredentialManager.getCredentialAsync（弹系统账号选择器）
  → Java：JsbBridge.sendToScript('cck:channel-login', json)   任意线程都行
  → JS：查表把 json 翻成三态
  → LoginOutcome{kind:'ok', identity:{channel:'google', credential:<idToken>}}
```

### 过河的 JSON 只有两种形状

```
成功  {"ok":"<idToken>"}
失败  {"err":"androidx.credentials.exceptions.GetCredentialCancellationException","msg":"…"}
```

**Java 只报事实，不做分类**——异常类名原样过河，JS 侧一张表映射成三态四码：

| Java 异常类 | JS 侧结论 |
|---|---|
| `GetCredentialCancellationException` | `{kind:'cancel'}` |
| `NoCredentialException` | `fail` / `no-account` |
| `GetCredentialProviderConfigurationException`、`GetCredentialUnknownException` | `fail` / `config` |
| 网络类 | `fail` / `network` |
| 表里没有的 | `fail` / `unknown`，原始类名进 `message` |

表在 JS 侧是因为它**最需要迭代**（真机上必然撞到没预料到的异常类型），而 JS 在 base 层热更就能改，
Java 在引擎层改一次发一次 APK。

**没有超时**。等的是一个系统级账号选择器，玩家可能盯着它想半天、可能切出去先登 Google 账号再切回来——
计时器只会在玩家正操作时把 Promise 结掉，然后真回调到了又无人接。挂死的唯一途径是 Java 内部抛了异常且没回调，
对症下药是下面那条 Java 侧硬规则，不是 JS 侧猜一个秒数。

之后接入方把它转成自己的登录凭据。demo 的做法：`LoginAccount{provider:'channel', credential:`${channel}:${credential}`}` → `POST /api/Login` → 服务端按 channel 找对应渠道的验签接口。**服务端契约不动** —— `credential` 本就 provider 自解释。

**没有启动步**。`login()` 是业务触发的（玩家点登录按钮），不在启动序列里。

### 渠道实现在哪

JS 侧胶水在 base 层（`@cck/engine`），**Java 侧按 gradle productFlavor 分**：

```
native/engine/android/app/src/<flavor>/java/com/cck/channel/CckChannel.java
```

同名类各写各的实现，JS 侧的调用点固定、一行分支都不写。**Java 侧三条硬规则**：

1. **方法体整个包在 `try (Throwable)` 里**，catch 里也必须回一条 `{"err":…}` —— 一条路径都不允许不回调，
   因为 JS 侧没有超时兜着。
2. **零状态、零判断**：不解 JWT、不分类异常、不生成 nonce，只把结果塞进 JSON 发回来。
3. **回调不必切线程**：`JsbBridge.sendToScript` 的 JNI 实现已经把 JS 调用包进了
   `performFunctionInCocosThread`（引擎 `JavaScriptJavaBridge.cpp:211`），任意线程调都安全，
   **不要**再套 `CocosHelper.runOnGameThread`。

完整理由与后果见 [ADR-0021](../../../../docs/adr/0021-channel-sdk-via-gradle-product-flavors.md)。

## Key design decisions（决策表）

| # | 维度 | 选项 | 定稿 | 一句话理由 |
|---|---|---|---|---|
| 1 | 切分维度 | 按平台 / 按渠道 | **按渠道** | 平台差异 `cc.sys` 已覆盖；同一个 Android 上华为和 TapTap 的 SDK 毫无关系。 |
| 2 | 接口大小 | 全能力可选方法 / 只 `login()` | **只 `login()`** | 首个实现没有 init、没有支付、没有广告 —— 可选方法表达的是一张空表。加可选方法是非破坏性变更，等第二个实现来了再加，那时抽象才是被验证过的。 |
| 3 | 渠道实现的分发 | 一渠道一 bundle / 全打进包 | **全打进包**（JS 侧） | JS 胶水几 KB；真正的隔离发生在 APK 的 flavor 层。 |
| 4 | Java 侧组织 | 同一份源码运行时分支 / gradle flavor | **flavor** | 包里只有当前渠道的 SDK 与权限 —— **权限取并集会挂审核**。见 ADR-0021。 |
| 5 | 渠道登录的落点 | 新登录通道 / 复用 `LoginAccount` | **复用** | `credential` 本就 provider 自解释，加一个 provider 即可，服务端契约与后续链路一字不动。 |
| 6 | 取消的表达 | 抛异常 / 单列一态 | **单列 `cancel` 态** | 玩家按返回是正常行为，抛成错误会污染日志、进错误路径（硬规则四）。 |
| 7 | 失败的表达 | 抛 / 联合类型 | **联合类型 `fail`** | 与 `cancel` 同构，调用方一次 `switch` 处理完三种结局，不必 try/catch 套一层。 |
| 8 | `code` 取值域 | 透传渠道原始 / 归一枚举 | **四个归一值** | 透传的话调用方要认识每个渠道的错误体系，接第二家时 UI 代码就得跟着改，接口白抽象了。 |
| 9 | `credential` 格式 | 拼 `<channel>:` 前缀 / 原始凭据 | **原始凭据** | `channel` 字段已经说明了来源，前缀是冗余；拼串是接入方转 `LoginAccount` 时的事。 |
| 10 | 桥的粒度 | 通用 `callNative` + id 表 / 只一个 `nativeLogin` | **只一个** | 通用桥的三个卖点（多路复用、事件名路由、跨线程）全被引擎自带的 `jsbBridgeWrapper` 覆盖了，剩下的只有「包一层 Promise」——十来行的事，一个调用点犯不着抽。第二个渠道来了是加一个事件名，不是需要一个分发器。 |
| 11 | 超时 | 30s / 长超时保险 / 不设 | **不设** | 等的是系统账号选择器，玩家慢慢选是正常的；计时器会误伤正常操作，而它防的那个病（Java 不回调）该由 Java 侧 try/catch 治。 |
| 12 | 异常分类放哪 | Java 侧翻译 / JS 侧查表 | **JS 侧** | 分类表最需要迭代（真机上必然撞到没预料到的异常），JS 在 base 层热更就能改，Java 在引擎层改一次发一次 APK。 |
| 13 | 并发在途 | 报错 / 不管 / 复用 | **复用在途 Promise** | 引擎 wrapper 按事件名分发给**所有**监听器，两个在途会被同一条回复一起 resolve。复用同时也是语义上对的：连点两次登录按钮只该弹一次选择器。状态存 `googleChannelSdk()` 的闭包里，不是模块级（硬规则二）。 |
| 14 | `onActivityResult` 通道 | 加 / 不加 | **不加** | Credential Manager 的 `getCredentialAsync` 回调就是终点，androidx 内部自己起隐藏 Activity 收结果。省掉了改 `AppActivity.java`——那是引擎层文件。 |

## Platform considerations

| 环境 | 登录 | 桥 | 备注 |
|---|---|---|---|
| Android + Google | Credential Manager → idToken | `native.reflection` + Java | 需 GMS。国产 ROM 没有 → 用模拟器的 Google APIs 镜像验证 |
| Android 渠道包 | 渠道账号 SDK | 同上，另一个 flavor | **属引擎层，改它必须发新包** |
| iOS | 未做 | `jsb.reflection`（OC） | 同上 |
| Web / 编辑器 | `noopChannelSdk` | 无 | 预览与单测走这条，开发期不必装任何 SDK |
| 小游戏 | 未做 | 无（全局 `wx` / `tt`） | 小游戏平台本身尚未在本仓跑通 |

**与三种「热」的关系**：JS 侧接口与胶水在 base 层，改它要热更 base 并重启；**Java 那半在引擎层，改它必须发新包**。所以「Java 侧尽量薄、逻辑尽量留 JS」是条硬约束 —— 这是 Java 侧只发 JSON 不做判断的原因，也是异常分类表、JWT 解析、nonce 生成全在 TS 侧的原因。

## Testable seams + test plan

core 侧零 `cc`，全部 node 直跑：

- `noopChannelSdk()`：`login()` 返回 `fail/config`，**不返回假的成功**。
- `LoginOutcome` 三态在 VM 里的分支：`cancel` 不出错误文案、`fail` 按 `code` 出不同文案、`ok` 才继续登录流程。
- `code` 映射表：各渠道异常 → 四个归一值的对照（用 fake 实现喂）。

engine 侧（cc mock 封顶，ADR-0002）：

- `googleChannelSdk`：喂一个 fake `jsbBridgeWrapper`，验四件事 ——
  ① 监听器**装在** `callStaticMethod` **之前**（顺序反了真机上会崩，见「已知行为与坑」）；
  ② 回复到了就摘监听器，不留残留；
  ③ 两次 `login()` 在途时只调一次 `callStaticMethod`、两个 Promise 同结果；
  ④ 各种 `err` 类名映射成对的三态四码，没命中的走 `unknown` 且原始类名进 `message`。
- `channelSdkModule`：`stop()` 注销自己注册的 token（对齐 `appModule` 的既有教训）。
- 真渠道实现只能真机验，不写单测（ADR-0002）。

---

## 已知行为与坑

**监听器必须装在调用之前，否则可能是崩溃而不是丢消息。** 引擎的 `ScriptNativeBridge::bridgeCxxInstance`
初值是 `nullptr`，只在 JS 侧首次访问 `native.bridge` / `native.jsbBridgeWrapper` 时才被构造出来
（`JavaScriptJavaBridge.cpp:695`）；而 JNI 侧的 `nativeSendToScript` 是**无条件**解引用它的
（同文件 `:212`）。所以 Java 先发、JS 后装，撞上的是空指针，不是「消息丢了」。我们的顺序天然安全
（登录是 JS 发起的），但**别把 `addNativeEventListener` 挪到 `callStaticMethod` 后面**——
单测里第一条断言就是盯这个的。

**迟到的回调会被引擎打一条 `console.error`。** `impl.ts` 的 `triggerEvent` 在事件名没有监听器时
`console.error('<event> does not exist')`。定了「不设超时」之后正常路径不会走到，但如果将来有人加回超时，
这条日志就是它的副作用——**不需要**自己再写告警。

**`callStaticMethod` 的失败是同步 JS 异常，不是静默。** 类名找不到 / 方法签名不匹配会走
`tryThrowJSException`（`JavaScriptJavaBridge.cpp:596`、`:604`），抛的是 `"class not found"` /
`"invalid signature"`。所以「flavor 没装上」「类名打错」在真机上当场就炸，不会表现成登录按钮永远转圈。

**`sendToScript` 不要求线程。** 见上「Java 侧三条硬规则」第 3 条。这一点跟旧 cocos2d-x 的经验相反，
也跟 #31 调研当时的判断相反 —— 结论以引擎源码为准。

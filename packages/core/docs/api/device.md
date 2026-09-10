[**@cck/core API**](README.md)

***

[@cck/core API](README.md) / device

# device

## Interfaces

### DeviceProfile

Defined in: [packages/core/src/device/device-profile.ts:20](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/device/device-profile.ts#L20)

DeviceProfile —— 设备画像。**启动那一刻的一份不可变快照**，不是永恒真理。

设计见 `docs/design/device-tiering-overview.md` §2。三条要点：

1. **「内存额度」拆成三个自带语义的字段，故意不合并。** Android 的 `Runtime.maxMemory()`
   是稳定常量、iOS 的 `os_proc_available_memory()` 是易变余量、web 的 `navigator.deviceMemory`
   是量化过的设备 RAM —— 四个平台是**四种不同的量**。合并成一个数，打分函数就会拿到一个
   **含义随平台漂移**的数字：同样是 2048，在 Android 上是「进程堆上限」，在 iOS 上是
   「此刻还剩多少」。**名字承担语义。**
2. **「取不到」有三种状态**，靠 `readFailures` 区分（见该字段注释）。这个区分**刻意不写进
   类型**：打分逻辑一行都不关心区别，两种情况它都只能跳过这一项；写进类型 = 让每个读取点
   被迫解一次它不需要的包。
3. **它是快照，不是常量表。** 尤其 **CPU 核数在 Android / iOS 都不是可缓存常量**
   （Android 官方原文「This value may change during a particular invocation of the virtual
   machine」，iOS 侧受热节流影响）。要实时值去问性能采集器，别把这里的值当永恒真理缓存。

#### Properties

##### abis?

> `readonly` `optional` **abis**: `string`

Defined in: [packages/core/src/device/device-profile.ts:53](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/device/device-profile.ts#L53)

支持的 ABI，逗号分隔（桥不支持返回数组，Java 侧拼好）。

##### availableMemoryBytes?

> `readonly` `optional` **availableMemoryBytes**: `number`

Defined in: [packages/core/src/device/device-profile.ts:27](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/device/device-profile.ts#L27)

当前可用余量（**易变**）。Android `mi.availMem` / iOS `os_proc_available_memory()`。

##### brand?

> `readonly` `optional` **brand**: `string`

Defined in: [packages/core/src/device/device-profile.ts:48](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/device/device-profile.ts#L48)

##### cpuCores?

> `readonly` `optional` **cpuCores**: `number`

Defined in: [packages/core/src/device/device-profile.ts:33](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/device/device-profile.ts#L33)

核数（JVM / 进程视角）。⚠️ **不是常量**，见类型头第 3 条。

##### cpuMaxFreqKHz?

> `readonly` `optional` **cpuMaxFreqKHz**: `number`

Defined in: [packages/core/src/device/device-profile.ts:35](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/device/device-profile.ts#L35)

最大主频（kHz），读 `/sys/.../cpufreq/cpuinfo_max_freq`。部分设备内核没这个节点。

##### densityDpi?

> `readonly` `optional` **densityDpi**: `number`

Defined in: [packages/core/src/device/device-profile.ts:45](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/device/device-profile.ts#L45)

像素密度。⚠️ **必须走原生桥拿 `DisplayMetrics.densityDpi`** ——
`screen.devicePixelRatio` 在 Android 原生上**恒为 1**（引擎 `CommonScreen.cpp` 硬编码
`return 1;`），它是引擎的渲染缩放系数，不是 `DisplayMetrics.density`。

##### deviceTotalMemoryBytes?

> `readonly` `optional` **deviceTotalMemoryBytes**: `number`

Defined in: [packages/core/src/device/device-profile.ts:25](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/device/device-profile.ts#L25)

设备总内存。Android `mi.totalMem` / web `navigator.deviceMemory` / 微信 `memorySize`。

##### gpuRenderer?

> `readonly` `optional` **gpuRenderer**: `string`

Defined in: [packages/core/src/device/device-profile.ts:62](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/device/device-profile.ts#L62)

GPU 型号字符串，**原样透出，解析规则归项目**。
⚠️ 它的格式跟**渲染后端**绑定而不是平台：GLES3 给 `glGetString(GL_RENDERER)`，
Vulkan 给 `VkPhysicalDeviceProperties.deviceName`。同一台机换个 build config 就换一套格式。

##### gpuVendor?

> `readonly` `optional` **gpuVendor**: `string`

Defined in: [packages/core/src/device/device-profile.ts:63](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/device/device-profile.ts#L63)

##### lastExitReason?

> `readonly` `optional` **lastExitReason**: `string`

Defined in: [packages/core/src/device/device-profile.ts:73](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/device/device-profile.ts#L73)

上次进程为什么没的。见 [exitReasonName](device.md#exitreasonname) 的取值表；无法识别的码为 `unknown-<码>`。
**Android 11（API 30）以下没有这个能力** —— 那时它缺席且**不在** `readFailures` 里。

##### lowRamDevice?

> `readonly` `optional` **lowRamDevice**: `boolean`

Defined in: [packages/core/src/device/device-profile.ts:29](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/device/device-profile.ts#L29)

系统自己认定的低内存机。Android `ActivityManager.isLowRamDevice()`（API 19）。

##### maxTextureSize?

> `readonly` `optional` **maxTextureSize**: `number`

Defined in: [packages/core/src/device/device-profile.ts:64](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/device/device-profile.ts#L64)

##### model?

> `readonly` `optional` **model**: `string`

Defined in: [packages/core/src/device/device-profile.ts:49](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/device/device-profile.ts#L49)

##### osVersion?

> `readonly` `optional` **osVersion**: `string`

Defined in: [packages/core/src/device/device-profile.ts:54](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/device/device-profile.ts#L54)

##### processMemoryLimitBytes?

> `readonly` `optional` **processMemoryLimitBytes**: `number`

Defined in: [packages/core/src/device/device-profile.ts:23](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/device/device-profile.ts#L23)

单进程堆上限（稳定常量）。Android `Runtime.maxMemory()`。**只有 Android 有。**

##### readFailures

> `readonly` **readFailures**: readonly `string`[]

Defined in: [packages/core/src/device/device-profile.ts:84](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/device/device-profile.ts#L84)

本该读得到、这次却没读到的字段名。**只喂埋点，打分不该读它。**

| 现象 | 含义 |
|---|---|
| 有值 | 读到了 |
| 无值，且**不在**本清单 | **这个平台就没有这个能力**（web 没有进程堆上限；Android < 11 没有退出原因） |
| 无值，且**在**本清单 | **本该有、这次没读到** —— 意味着某批机型上打分静默降级了，而我们不知道 |

##### screenHeightPx?

> `readonly` `optional` **screenHeightPx**: `number`

Defined in: [packages/core/src/device/device-profile.ts:39](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/device/device-profile.ts#L39)

##### screenWidthPx?

> `readonly` `optional` **screenWidthPx**: `number`

Defined in: [packages/core/src/device/device-profile.ts:38](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/device/device-profile.ts#L38)

##### socModel?

> `readonly` `optional` **socModel**: `string`

Defined in: [packages/core/src/device/device-profile.ts:51](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/device/device-profile.ts#L51)

SoC 型号。`Build.SOC_MODEL` 是 **API 31+**，低版本上这一项天然缺席（不是失败）。

##### supportsAstc?

> `readonly` `optional` **supportsAstc**: `boolean`

Defined in: [packages/core/src/device/device-profile.ts:66](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/device/device-profile.ts#L66)

能力位：问「支不支持」而不是「是多少」。**分档不用猜 GPU 型号，直接问它。**

##### supportsEtc2?

> `readonly` `optional` **supportsEtc2**: `boolean`

Defined in: [packages/core/src/device/device-profile.ts:67](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/device/device-profile.ts#L67)

***

### ProfileParts

Defined in: [packages/core/src/device/device-profile.ts:159](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/device/device-profile.ts#L159)

一路来源解析出来的半成品：认下的字段 + 本该读到却没读到的字段名。

#### Properties

##### fields

> `readonly` **fields**: `Partial`\<[`DeviceProfile`](device.md#deviceprofile)\>

Defined in: [packages/core/src/device/device-profile.ts:160](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/device/device-profile.ts#L160)

##### readFailures

> `readonly` **readFailures**: `string`[]

Defined in: [packages/core/src/device/device-profile.ts:161](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/device/device-profile.ts#L161)

***

### WebProfileInput

Defined in: [packages/core/src/device/device-profile.ts:236](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/device/device-profile.ts#L236)

浏览器那边能问到的原始读数。**全声明成 `unknown`** —— 其中两项是非标准 / 条件可用的
API，浏览器给什么都有可能，类型守卫在下面统一做。

#### Properties

##### deviceMemoryGB?

> `readonly` `optional` **deviceMemoryGB**: `unknown`

Defined in: [packages/core/src/device/device-profile.ts:238](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/device/device-profile.ts#L238)

`navigator.deviceMemory`，单位 **GB**。⚠️ 见 [parseWebProfile](device.md#parsewebprofile) 的三条注意。

##### devicePixelRatio?

> `readonly` `optional` **devicePixelRatio**: `unknown`

Defined in: [packages/core/src/device/device-profile.ts:242](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/device/device-profile.ts#L242)

`window.devicePixelRatio`。

##### hardwareConcurrency?

> `readonly` `optional` **hardwareConcurrency**: `unknown`

Defined in: [packages/core/src/device/device-profile.ts:240](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/device/device-profile.ts#L240)

`navigator.hardwareConcurrency`。

## Variables

### BRIDGE\_FAILURE

> `const` **BRIDGE\_FAILURE**: `"bridge"` = `'bridge'`

Defined in: [packages/core/src/device/device-profile.ts:156](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/device/device-profile.ts#L156)

桥整体不可用时记在 `readFailures` 里的名字。

***

### DEVICE\_PROFILE

> `const` **DEVICE\_PROFILE**: [`Token`](di.md#tokent)\<[`DeviceProfile`](device.md#deviceprofile)\>

Defined in: [packages/core/src/device/device-profile.ts:88](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/device/device-profile.ts#L88)

DI token：装一份**启动快照**。由 engine 的 `deviceProfileModule()` 在 `install()` 时注册。

## Functions

### exitReasonName()

> **exitReasonName**(`code`): `string`

Defined in: [packages/core/src/device/device-profile.ts:125](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/device/device-profile.ts#L125)

把 `ApplicationExitInfo.getReason()` 的原始 int 翻成稳定字符串。

未来的新码翻成 `unknown-<码>` 而不是 `'other'` —— `REASON_OTHER`(13) 是一个**有确切含义**的
取值，把不认识的码并进去等于伪造信息。带上码，埋点里一眼能查回官方常量表。

#### Parameters

##### code

`number`

#### Returns

`string`

***

### mergeDeviceProfile()

> **mergeDeviceProfile**(...`parts`): [`DeviceProfile`](device.md#deviceprofile)

Defined in: [packages/core/src/device/device-profile.ts:300](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/device/device-profile.ts#L300)

把几路来源拼成一份画像。**后面的覆盖前面的**（引擎直接问到的比桥更权威 —— 桥那头是反射，
引擎这头是本进程的真值），`readFailures` 则是并集去重。

这一步单独拎出来是因为它是**唯一**决定「谁盖谁」的地方，而那件事只用一句话就能测。

#### Parameters

##### parts

...readonly `object`[]

#### Returns

[`DeviceProfile`](device.md#deviceprofile)

***

### parseBridgeProfile()

> **parseBridgeProfile**(`json`): [`ProfileParts`](device.md#profileparts)

Defined in: [packages/core/src/device/device-profile.ts:176](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/device/device-profile.ts#L176)

解析原生桥返回的 JSON。**桥只调一次、返回一整个 JSON**，所以这一步是纯逻辑、node 全可测。

三种输入分得清清楚楚：
- `undefined`（这个平台没有桥）→ 空结果，**不记失败**。缺席不是故障。
- 非法 JSON / 不是对象（桥在，但坏了）→ 空结果 + 记一条 [BRIDGE\_FAILURE](device.md#bridge_failure)。
- 合法 JSON → 逐字段类型守卫；**类型不对的字段跳过并记名**（桥声称给了却给了垃圾，
  那正是「本该有却没读到」）。Java 侧自己报的 `readFailures` 一并合入。

数字字段要求**有限且非负**：这些量（内存 / 核数 / 频率 / 分辨率 / dpi）没有负数含义，
而 JNI 那头出错时最常见的就是 `-1`，放进来会让打分把故障当成一台极小内存的机器。

#### Parameters

##### json

`undefined` | `null` | `string`

#### Returns

[`ProfileParts`](device.md#profileparts)

***

### parseWebProfile()

> **parseWebProfile**(`input`): [`ProfileParts`](device.md#profileparts)

Defined in: [packages/core/src/device/device-profile.ts:267](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/device/device-profile.ts#L267)

解析浏览器读数。web 上**只有这三项**，其余字段是这个平台真的没有（不记 `readFailures`）。

## 三条必须知道的

1. ⚠️ **`navigator.deviceMemory` 只在安全上下文（HTTPS）里有** —— 实测（2026-09-10,
   Chromium）`http://` 页面上 `isSecureContext === false`，它就是 `undefined`，而同一页
   `hardwareConcurrency` / `devicePixelRatio` 照给。**H5 挂在 http 上就永远没有内存这一项**，
   要它就得上 HTTPS。缺席**不记失败**：浏览器是按规矩不给，不是读坏了。
2. ⚠️ **它被量化过且封顶 8** —— 规范只允许 0.25/0.5/1/2/4/8 这几档，一台 16GB 的机器也报 8。
   这里**原样换算、不去猜真实值**（猜错比缺失更糟），封顶的语义留给打分函数知情。
3. ⚠️ **`densityDpi` 用 `dpr × 160` 而不是 × 96** —— 这个字段的语义是 Android 的
   `DisplayMetrics.densityDpi`，而 Android 的定义就是 `density = densityDpi / 160`，
   Chrome 在 Android 上的 `devicePixelRatio` 正是那个 `density`。用 CSS 的 96 dpi 换算会让
   同一台手机在原生与 H5 上差出 1.67 倍 —— 打分函数拿到的就成了**一把随平台变刻度的尺**，
   正是这个模块拆三个内存字段要避免的那件事。代价是桌面浏览器上算出来的不是显示器真实 DPI，
   但分档要的本来就是「相对 mdpi 有多密」。

**`performance.memory.jsHeapSizeLimit` 刻意不用**：它虽然在 http 下也读得到（实测 ~2GB），
但那是 V8 的 JS 堆上限，跟 `processMemoryLimitBytes`（Android 的 Java 堆上限，实测 192–256MB）
差一个数量级。填进同一个字段，一条按 Android 写的门槛在 web 上就全判成高端机。

#### Parameters

##### input

[`WebProfileInput`](device.md#webprofileinput)

#### Returns

[`ProfileParts`](device.md#profileparts)

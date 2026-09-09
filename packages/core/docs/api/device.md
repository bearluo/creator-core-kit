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

### ParsedBridgeProfile

Defined in: [packages/core/src/device/device-profile.ts:158](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/device/device-profile.ts#L158)

#### Properties

##### fields

> `readonly` **fields**: `Partial`\<[`DeviceProfile`](device.md#deviceprofile)\>

Defined in: [packages/core/src/device/device-profile.ts:159](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/device/device-profile.ts#L159)

##### readFailures

> `readonly` **readFailures**: `string`[]

Defined in: [packages/core/src/device/device-profile.ts:160](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/device/device-profile.ts#L160)

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

Defined in: [packages/core/src/device/device-profile.ts:237](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/device/device-profile.ts#L237)

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

> **parseBridgeProfile**(`json`): [`ParsedBridgeProfile`](device.md#parsedbridgeprofile)

Defined in: [packages/core/src/device/device-profile.ts:175](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/device/device-profile.ts#L175)

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

[`ParsedBridgeProfile`](device.md#parsedbridgeprofile)

---
模块: device-profile
所在包: packages/engine（按平台取值，分量在这半）+ packages/core（类型 · token · 全部判断逻辑）
状态: kit 半已实现（core 27 测试，覆盖 100%；engine 薄壳无测，按 ADR-0002）。**原生桥的 Java 实现与真机验证未做**，见「还没做的」
跟踪: hlgit #21（wayfinder 图）· 参数调研见 #22 · 建模见 #37 · 模块划分见 #27 · 总纲 `docs/design/device-tiering-overview.md` §2
摘要: 启动那一刻的一份设备快照。DI 里装的是**数据不是取数器**；原生桥一次调用返回一整个 JSON，于是所有判断都落在 core 的纯函数里、node 可穷举。
何时读: 要按机器好坏做分档 / 想给崩溃上报或埋点加设备信息 / 要给某个平台补取值路径时。
日期: 2026-09-09
依赖: di-container · device-tiering-overview（总纲）
---

# 设备画像 device-profile

## TL;DR

```ts
// 装：engine 的 KitModule，install() 时读一次
await boot({ modules: [deviceProfileModule(), /* … */] });

// 用：拿到的是一份不可变快照，零成本
const p = getRootContainer().resolve(DEVICE_PROFILE);
if (p.processMemoryLimitBytes !== undefined && p.processMemoryLimitBytes < 256 * 1024 * 1024) { … }
```

**类型与 token 住 `@cck/core`**（`DeviceProfile` / `DEVICE_PROFILE`），因为 `device-tier` 要用它打分而
core 不能反向依赖 engine；**取值实现住 `@cck/engine`**，分量也在那半。

## Purpose

回答「**这台机器是什么样**」，供三类消费者：

1. **分档打分**（`device-tier` 的 `scoreTier` / 服务器的 `fetchTier`）—— 主要消费者
2. **崩溃上报的上下文**（`installCrashReporter(getContext)` 今天只有 `vest`/`channel`/`ver`/`apk`/`scene`）
3. **埋点**（哪批机型上哪几项读不到，见 `readFailures`）

**不在范围内**：打分权重与门槛值（策略归项目）、实测帧率（要跑十几秒，归 `perf-window`）、
运行时内存占用的周期采样（用裸函数 `readDeviceProfile()` 自己定频率）。

## Public API

```ts
// @cck/core —— 类型、token 与全部判断逻辑
export interface DeviceProfile {
  // 内存：三个量，三种语义，故意不合并
  readonly processMemoryLimitBytes?: number;   // 进程堆上限（稳定常量），只有 Android 有
  readonly deviceTotalMemoryBytes?: number;    // 设备总内存
  readonly availableMemoryBytes?: number;      // 当前可用余量（易变）
  readonly lowRamDevice?: boolean;

  readonly cpuCores?: number;                  // ⚠️ 不是常量，见坑 3
  readonly cpuMaxFreqKHz?: number;

  readonly screenWidthPx?: number;
  readonly screenHeightPx?: number;
  readonly densityDpi?: number;                // ⚠️ 必须走桥，见坑 1

  readonly brand?: string;
  readonly model?: string;
  readonly socModel?: string;                  // Build.SOC_MODEL 是 API 31+
  readonly abis?: string;                      // 逗号分隔（桥不支持返回数组）
  readonly osVersion?: string;

  readonly gpuRenderer?: string;               // 原样透出，解析规则归项目
  readonly gpuVendor?: string;
  readonly maxTextureSize?: number;
  readonly supportsAstc?: boolean;             // 能力位：分档不用猜 GPU 型号
  readonly supportsEtc2?: boolean;

  readonly lastExitReason?: string;            // 上次进程为什么没的
  readonly readFailures: readonly string[];    // 只喂埋点，打分不该读
}

export const DEVICE_PROFILE: Token<DeviceProfile>;
export const BRIDGE_FAILURE: 'bridge';

export function exitReasonName(code: number): string;
export function parseBridgeProfile(json: string | undefined | null): ParsedBridgeProfile;
export function mergeDeviceProfile(
  ...parts: readonly { fields?: Partial<DeviceProfile>; readFailures?: readonly string[] }[]
): DeviceProfile;
```

```ts
// @cck/engine —— 取值
export function deviceProfileModule(): KitModule;      // name: 'device-profile'
export function readDeviceProfile(): DeviceProfile;    // 裸函数，见下
```

### `DEVICE_PROFILE`（快照）vs `readDeviceProfile()`（裸函数）

**默认永远用前者。** 后者只留给**真的需要周期重读**的场景 —— 典型是往
`PerfWindow.peak()` 里喂内存峰值：自己定频率、自己承担代价。这样 `perf-window` 就**不必反过来
依赖本模块**（总纲要求两个新模块互不认识）。

⚠️ 裸函数每次调用都走一趟 JNI。**别在每帧、也别在崩溃上报的 `getContext` 里调** ——
那个是每报一次现取的，一次异常风暴就能把桥打满。

## Behavior & data flow

```
     ┌─ 原生桥 CckDevice.readProfile() ──▶ 一整个 JSON ──▶ parseBridgeProfile()  ┐
                                                          （类型守卫 / 记账 /   │
                                                            REASON_* 映射）     ├─▶ mergeDeviceProfile() ─▶ DeviceProfile
     └─ 引擎 API（screen / sys / gfx.Device）─────────────────────────────────┘        后者盖前者
```

**「取不到」的三种状态**（这是本模块最重要的一条语义）：

| 现象 | 含义 | 该不该报警 |
|---|---|---|
| 有值 | 读到了 | — |
| 无值，且**不在** `readFailures` | **这个平台就没有这个能力**（web 没有进程堆上限；Android < 11 没有退出原因；工程没装那份 Java） | 不该 |
| 无值，且**在** `readFailures` | **本该有、这次没读到** | **该** —— 某批机型上打分静默降级了 |

这个区分**刻意不写进类型**：打分逻辑一行都不关心区别（两种它都只能跳过这一项），
写进类型 = 让每个读取点被迫解一次它不需要的包。

**引擎盖桥**：`mergeDeviceProfile` 里引擎那份排在后面。反射是间接来的，引擎这头是本进程的真值。

## 原生桥契约

跟崩溃上报同一套路 —— **契约在 kit，实现在接入方工程的 `native/`**（`packages/engine` 没法往
消费方工程里塞 `.java`）：

```java
package com.cck.device;
public final class CckDevice {
    /** 返回一整个 JSON；每一项自己 try/catch，失败的把字段名放进 readFailures。 */
    public static String readProfile() { … }
}
```

JSON 字段名与 `DeviceProfile` 同名，外加：

- `lastExitReasonCode: int` —— `ApplicationExitInfo.getReason()` 的**原始 int**。
  **映射放 core 不放 Java**：Java 那半没有分支就没有测不到的逻辑，而映射表在 node 里可穷举。
- `readFailures: string[]` —— Java 自己知道哪几项它试过却失败了（`/sys` 节点不存在、
  `SOC_MODEL` 在 API < 31 反射不到…）。

**一次调用返回一整个 JSON**，而不是十几个 getter，换来三件事：
① 十几个字段只走一次 JNI；② 完全绕开「`native.reflection` 的 `J`(long) 返回可不可用」那个
未验证项（返回类型只有 `String`）；③ 解析成了纯逻辑。

**类不存在时 `callStaticMethod` 会同步抛**，被当作「这个工程没装这个能力」——
**不记 `readFailures`**。装了却返回垃圾才算故障。

## Key design decisions

| # | 决策 | 为什么 |
|---|---|---|
| 1 | **DI 里装数据，不装 `read()`** | 业务自己也要读画像；留 `read()` 会诱人反复调，而崩溃上报的 `getContext` 每报一次现取 —— 一次异常风暴打满 JNI 桥。给一份数据，「这是启动那一刻的快照」还能由类型自己说 |
| 2 | **内存拆三个字段，不合并** | 四平台上那不是同一个量（Android 常量 / iOS 余量 / web 量化 RAM / 微信 MB 字符串）。合并会让打分拿到**含义随平台漂移**的数字 |
| 3 | **桥一次调用返回整个 JSON** | 见上三条 |
| 4 | **`REASON_*` 映射放 core，Java 只递 int** | Java 测不了（JNI 禁进 cc mock，ADR-0002）；映射表放 core 就能 node 里穷举。常量值取自 `javap -constants` 读 `android.jar`，不是凭记忆 |
| 5 | **接缝定在「给我一份画像」，不在「封装 callStaticMethod」** | `native.reflection.callStaticMethod` 三平台**同名不同义**（Android 第三参是 Java 签名、iOS 是 OC 方法的第一个参数、HarmonyOS 是全部参数），包一层通用调用形状是假抽象 |
| 6 | **同步，不是 `Promise`** | 各平台取值路径实际都同步。做成异步是给「将来某平台可能要异步」买保险，代价是在启动关键路径上多一处「`await` 回来先确认自己还在」的风险点 |
| 7 | **GPU 型号原样透出** | 那串东西的格式跟**渲染后端**绑定而不是平台（GLES3 是 `glGetString(GL_RENDERER)`，Vulkan 是 `VkPhysicalDeviceProperties.deviceName`），同一台机换个 build config 就换一套格式。解析规则归项目 |
| 8 | **数字字段拒负数** | JNI 那头出错最常见的返回就是 `-1`，放进来会让打分把故障当成一台极小内存的机器 |

## Platform

| 平台 | 拿得到什么 |
|---|---|
| **Android native** | 全部。引擎白送 GPU / 屏幕 / 压缩格式支持 / 系统版本；内存、CPU、densityDpi、机型、退出原因走 `CckDevice` |
| **iOS native** | 只有引擎白送那几项 —— `CckDevice` 是 Java 类，`sys.os !== ANDROID` 直接跳过。iOS provider **不做**（总纲 Out of scope） |
| **web / 小游戏** | 只有引擎白送那几项。`navigator.deviceMemory` 等尚未接（见「还没做的」） |

**整套零权限**：#22 逐项核过官方文档，19 项**没有一行**带 `Requires Manifest.permission.*` 标注，
Cocos 默认模板那三条权限一条都不用加。唯一的雷是 `Build.getSerial()`（第三方应用根本申请不到）
—— 打分不需要设备唯一标识，**别碰它**。

## Testable seams + test plan

**全部判断逻辑在 core，node 全测得到**（27 条，覆盖 **100%**）：

| 组 | 覆盖 |
|---|---|
| `exitReasonName` | 17 个常量逐个映射 · 未知码带上码而**不并进 `other`** |
| 桥不在 vs 桥坏了 | `undefined`/`null`/`''` 不记失败 · 非法 JSON / 顶层非对象记 `bridge` |
| 字段守卫 | 正常载荷 · **缺席不记失败** · **负数被拒**（JNI 的 -1）· 类型不对跳过并记名 · 空串算没读到 · 布尔只认真布尔 · 退出码非整数记名 |
| `readFailures` 合并 | Java 自报的合入 · 非字符串被滤 · 不重复记名 · 不是数组时忽略 |
| `mergeDeviceProfile` | 后者盖前者 · `undefined` 不覆盖 · 并集去重 · 空调用也是合法画像 |

**engine 那半刻意无单测**：`native.reflection` 是 JNI，按 ADR-0002 决策 3 禁止进 cc mock；
凡是能下沉的都已下沉，剩下的只有「按平台挑一条取值路径 + 塞进结构」，没有分支可错。
API 存在性由 `tsc -b` 用 `@cocos/creator-types` 的真类型保证（不是 mock）。

## 还没做的

1. **`CckDevice.java` 没写。** 在此之前，Android 上桥调用会抛（类不存在）→ 被当作「没这能力」，
   只剩引擎白送的 GPU / 屏幕 / 系统版本那几项。这是**设计内的降级**，不是故障。
2. **真机验证一次没做。** 连带 #22 留下的五项待实测：
   ① `native.fileUtils` 读 `/sys` 通不通（**影响面最大** —— 不通则 CPU 核数/主频也得走 Java 桥）；
   ② `Device::getDPI()` 在 Android 上返回什么；③ `J`(long) 返回可不可用（**本模块已绕开**，
   桥只返回 String）；④ 厂商 ROM 对 `/sys/.../cpu/**` 的可读性（**要目标市场真实低端机抽样，
   模拟器测不出来**）；⑤ 字节小游戏字段清单。
3. **web / 小游戏的取值没接**（`navigator.deviceMemory` / `hardwareConcurrency` / `getSystemInfoSync`）。
   接口容得下，实现待补。

## 已知行为与坑

1. **`screen.devicePixelRatio` 在 Android 原生上恒为 1。** 引擎 `CommonScreen.cpp` 硬编码
   `return 1;` —— 它是引擎的渲染缩放系数，**不是** `DisplayMetrics.density`。要像素密度只能走桥拿
   `densityDpi`。反过来说 `screen.windowSize` 在 Android 上**就是物理像素**。
2. **`device.memoryStatus` 跟设备 RAM 无关**，只有 `bufferSize` / `textureSize`，是引擎自己记的
   GFX 分配量。别拿它当内存来源。
3. **CPU 核数不是可缓存常量。** Android 官方原文「This value **may change** during a particular
   invocation of the virtual machine」；iOS `activeProcessorCount` 明说受热节流影响。
   这份画像整体是**启动那一刻的快照** —— 要实时值去问 `perf-window`。
4. **`Build.SOC_MODEL` 是 API 31+**，低版本上它天然缺席（不在 `readFailures` 里）。
5. **`/sys/.../cpufreq/*` 可能根本不存在**：AOSP 默认允许读，但厂商可在自己的 `genfs_contexts` 里
   收紧，且部分设备内核没开 cpufreq CONFIG。Java 侧必须 try/catch 并记进 `readFailures`。
6. **`Debug.getMemoryStat()` / `getRuntimeStat()` 的 key 官方保留增删权**（「may be added or removed
   in a future API level」）→ 取不到要能安静降级。
7. **`director.root.device` 要等渲染设备建好才存在。** `boot()` 跑在 `Bootstrap` 组件的 `start()` 里，
   那时它一定就位；真没有会记一条 `gpu` 到 `readFailures`。
8. **未来的新 `REASON_*` 码翻成 `unknown-<码>` 而不是 `'other'`** —— `REASON_OTHER`(13) 是个**有确切
   含义**的取值，把不认识的码并进去等于伪造信息。

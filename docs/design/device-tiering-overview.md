# 设备分档能力总纲（device tiering）

**状态**：已定稿（2026-09-08）—— 未实现
**摘要**：把「按机器好坏给不同资源与画质」拆成 **三个模块 + 一个字段 + 一个不做**：`device-profile`（设备画像，engine 主场）、`device-tier`（档位状态，core 主场）、`perf-window`（性能采集，纯类不进 DI）、`UIVariant` 加一个 `tier` 字段；**渲染参数降级器不进 kit**。贯穿全篇的一条线是 **kit 给机制、项目给策略** —— 打分权重、门槛值、上报端点一律不进框架。
**何时读**：动手实现上述任一模块之前；或要判断「某个跟设备能力有关的东西该不该进 kit」时。
**依赖**：[ADR-0001](../adr/0001-cross-bundle-singleton-and-aot-hotupdate.md)（DI 与跨 bundle 单例）、[ADR-0002](../adr/0002-engine-test-strategy-capped-cc-mock.md)（core/engine 测试策略）、[ADR-0011](../adr/0011-server-framework-split-and-protocol-contract.md)（服务端协议契约边界）、[ADR-0017](../adr/0017-base-hotupdate-via-fixed-name-pointer.md)（base 层热更边界）

> 本文是 hlgit 地图 [#21](https://hlgit.5518game.com/luohao/creator-core-kit/-/issues/21) 走完之后的产物，八张子票的结论都收在这里。
> **决策的权威出处是各张票**（文末有索引），本文只做拼装与形状定义，不复述论证过程。

---

## 1. 全景

| 能力 | 落法 | core 半 | engine 半 |
|---|---|---|---|
| 设备画像 | 模块 **`device-profile`** | `DeviceProfile` 类型 · `DEVICE_PROFILE` token · 归一化纯函数 | 三平台取值 · `deviceProfileModule()` · 裸 `readDeviceProfile()` |
| 档位状态 | 模块 **`device-tier`** | **全部** | **零** |
| 性能采集 | 模块 **`perf-window`** | `PerfWindow` 类（**无 token 无 KitModule**） | `drivePerfWindow()` 四行 |
| 按档资源解析 | **零新模块** | `UIVariant` 加 `tier: string` | — |
| 渲染参数降级 | **不做**（见 §7.1） | — | — |

依赖方向**只有一条**：

```
device-tier ──需要──▶ device-profile
perf-window                          （谁也不认识，接线全在项目侧）
```

这不是偶然，是设计目标。`perf-window` 唯一可能勾住 `device-profile` 的地方是内存峰值采样（`peak()` 要周期性读），解法见 §3.3。

### 1.1 三条贯穿全篇的边界

1. **kit 给机制，项目给策略。** kit 出的是「能读到设备参数」「能按档解析到资源包」「能采集到帧率分位」；「192MB 是不是低端线」「打分怎么加权」「上报打哪个端点」全部留给接入方。策略进 kit = 把某个项目某个时间点的经验值烧死在框架里。
2. **native Android 全功能，web / 小游戏优雅退化。** 取不到的参数返回 `undefined`，落默认档，整条链照常走完、不抛错。先例：`engineHash()` 判不了返回 `undefined` 让版本闸休眠（`packages/engine/src/hotupdate-paths.ts`）。
3. **「可选」是硬要求。** 不注册模块的项目，整条链**一行都不执行**，`tier` 恒 `'default'`，UI 解析行为跟今天逐字相同、零成本。

---

## 2. `device-profile` —— 设备画像

**逻辑主场 engine**（分量全在平台取值），文档落 `packages/engine/docs/modules/device-profile.md`；类型与 token 住 core（`device-tier` 要用，core 不能反向依赖 engine）。

### 2.1 类型

```ts
// packages/core —— 类型与 token
export interface DeviceProfile {
  // —— 内存：三个自带语义的字段，故意不合并 ——
  /** 进程堆上限（稳定常量）。只有 Android 有。 */
  readonly processMemoryLimitBytes?: number;
  /** 设备总内存。Android / web / 微信小游戏。 */
  readonly deviceTotalMemoryBytes?: number;
  /** 当前可用余量（易变，随生命周期变化）。iOS / Android。 */
  readonly availableMemoryBytes?: number;

  /** 上次进程为什么没的。`'crash' | 'anr' | 'lowMemory' | 'userRequested' | 'other'`，开放 string。 */
  readonly lastExitReason?: string;

  // …GPU 型号 / 屏幕 / CPU / 压缩格式支持等按 #22 的 19 项落，字段名在模块文档定稿

  /** 本该读得到、这次却没读到的字段名。**只喂埋点，打分不该读它**。 */
  readonly readFailures: readonly string[];
}

export const DEVICE_PROFILE: Token<DeviceProfile>;
```

**「内存额度」为什么必须拆成三个。** Android 的 `Runtime.maxMemory()` 是稳定常量、iOS 的 `os_proc_available_memory()` 是易变余量、web 的 `navigator.deviceMemory` 是量化过的设备 RAM、微信的 `memorySize` 只在 Android 给 —— 四个平台是**四种不同的量**，不是同一个量的四种取法。合并成一个 `memoryBudgetBytes`，打分函数就会拿到一个**含义随平台漂移**的数字：同样是 2048，在 Android 上是「进程堆上限」，在 iOS 上是「此刻还剩多少」。**名字承担语义，不留统一字段。**

**「取不到」的三种状态**，靠 `readFailures` 区分：

| 现象 | 含义 | 该不该报警 |
|---|---|---|
| 有值 | 读到了 | — |
| 无值，且**不在** `readFailures` | **这个平台就没有这个能力**（web 上没有进程堆上限；Android < 11 没有退出原因） | 不该 |
| 无值，且**在** `readFailures` | **本该有、这次没读到**（`/sys/.../cpufreq` 被厂商 ROM 收紧、`Build.SOC_MODEL` 在 API < 31、`Debug.getMemoryStat()` 的 key 被改名） | **该** —— 它意味着某批机型上打分静默降级了 |

⚠️ 这个区分**刻意不写进类型**（不做 `number | 'unsupported' | 'failed'` 这类联合）：打分逻辑一行都不关心区别，两种情况它都只能跳过这一项。写进类型 = 让每个读取点被迫解一次它不需要的包。

### 2.2 交付形状：注册**数据**，不是**取数器**

```ts
// packages/engine
export function deviceProfileModule(): KitModule;      // name: 'device-profile'
export function readDeviceProfile(): DeviceProfile;    // 裸函数，见 §3.3
```

`deviceProfileModule().install()` 里按平台读一次 → `register(DEVICE_PROFILE, { useValue })`，跟 `ccStorageModule`（`packages/engine/src/cc-storage.ts`）逐字同构。

**为什么不是 `DeviceProfileProvider.read()`：**

- **性能**：画像不只喂档位，业务自己也要读它。崩溃上报的 `installCrashReporter(getContext)`（`packages/engine/src/crash-reporter.ts`）是**每报一次现取**上下文的 —— 留着 `read()`，一次异常风暴就能把 JNI 桥打满。
- **语义**：这份画像是**启动那一刻的快照**，不是永恒真理（**CPU 核数在 Android / iOS 都不是可缓存常量** —— Android 官方明写会在同一次 VM 运行期间变化，iOS 侧受热节流影响）。留着 `read()` 恰恰**看起来**像每次给新鲜值，诱人反复调；给一份数据，「它就是快照」不用靠文档记住。
- 接缝仍定在**「给我一个 `DeviceProfile`」**这一层，而不是「封装一个 `callStaticMethod`」那一层 —— `native.reflection.callStaticMethod` 三平台**同名不同义**（Android 第三参是 Java 签名、iOS 是 OC 方法的第一个参数、HarmonyOS 是全部参数），包一层通用调用形状是假抽象。

**同步，不是 `Promise`。** 各平台取值路径实际都是同步的（JSB 的 `callStaticMethod` 同步返回、`navigator.deviceMemory` 同步、微信有 `getSystemInfoSync`、GPU 型号是引擎起来后就在的属性）。做成异步是给「将来某平台可能要异步」买保险，代价是在启动关键路径上多一处「`await` 回来先确认自己还在」的风险点（`CLAUDE.md` 硬规则 4）。

### 2.3 两个已知会踩的坑

- **`screen.devicePixelRatio` 在 Android 原生上恒为 1**（引擎 `CommonScreen.cpp` 硬编码 `return 1;`）。它不是 `DisplayMetrics.density`，是引擎的渲染缩放系数。要像素密度只能自己走桥拿 `densityDpi`。
- **`device.memoryStatus` 跟设备 RAM 无关**，只有 `bufferSize` / `textureSize`，是引擎自己记的 GFX 分配量。

一条好消息：**ASTC 分档不用猜 GPU 型号** —— `device.getFormatFeatures(Format.ASTC_RGBA_4X4)` 是引擎现成 API，直接问「这台机器支不支持这个压缩格式」。所以 GPU 型号大概率只当日志 / 修正表主键，不参与打分。

---

## 3. `device-tier` —— 档位状态

**逻辑主场 core，engine 半为零**（全是编排，零 `cc`），文档落 `packages/core/docs/modules/device-tier.md`。

### 3.1 类型

```ts
// packages/core
export interface TierVerdict {
  /** 档位标签。不透明 string，kit 不知道有哪几档。 */
  readonly tier: string;
  /** 来源标记，开放 string（`'server'` / `'cache'` / `'local'` / …）。埋点读它。 */
  readonly source: string;
}

export interface DeviceTier {
  /** 本次会话的档位。判档步跑完之前是 `'default'`。**会话内不变**。 */
  readonly tier: string;
  readonly source: string;
  /**
   * 判档，由启动序列的 `tier` 步调用一次。重复调用直接返回。
   * 编排：读玩家自选 → 读缓存 → 本地打分 → 同时发 `fetchTier` 与短超时赛跑 → 写缓存。
   */
  resolveAtStartup(): Promise<void>;
}

export const DEVICE_TIER: Token<DeviceTier>;
export function getDeviceTier(): DeviceTier;

export function deviceTierModule(opts?: DeviceTierOptions): KitModule;
```

**没有 `setTier()`，这是不变式而不是约定。** 资源档一次会话内定死、运行中不换包（理由见 §7.2），把它做成 API 形状上的缺席，「运行中切档」在类型层面就写不出来。

⚠️ 唯一的门是既有的通用 `setUIVariant({ tier })`（`packages/core/src/ui/ui-manager.ts:221`）—— 项目真要自己调，技术上切得动。**kit 不提供、不背书、也不拦**，重建时机 / 资源就绪 / 内存峰值三条风险由项目自担。留这道门是刻意的。

### 3.2 策略注入

```ts
export interface DeviceTierOptions {
  /**
   * 本地兜底打分。**kit 不出默认实现** —— 见 §7.3。
   * 不传 = 没有服务器结论时落 `'default'`。
   */
  readonly scoreTier?: (p: DeviceProfile) => string;
  /**
   * 服务器权威档位。**由项目实现** —— 端点、协议、字段名 kit 一概不认识。
   * `'none'` = 服务器明说没有；reject = 网络挂了。两者启动路径行为相同，差别只进埋点。
   */
  readonly fetchTier?: (p: DeviceProfile) => Promise<TierVerdict | 'none'>;
  /** 等服务器的预算，默认 1500ms。超时就走，**不重试**。 */
  readonly budgetMs?: number;
}
```

**为什么 `fetchTier` 归项目、而 `dispatcher` 的响应能进 kit。** 同一条判据两个结论：`dispatcher` 的响应**跨框架**（同一套服务端要能接 Godot 客户端，ADR-0011），所以它的形状能进框架；**档位的响应不跨** —— 它里面还带资源清单，是彻头彻尾的项目协议。

三种接入姿态都要走得通：

| 姿态 | 传什么 | 行为 |
|---|---|---|
| 不上分档 | 不注册模块 | `tier` 恒 `'default'`，一行不执行 |
| 上分档、没服务端 | 只传 `scoreTier` | 本地算 + 缓存 |
| 上分档、有服务端 | 两个都传 | 缓存优先 + 服务器权威 |

**档位优先级**（高 → 低）：玩家自选 > 服务器结论 > 上次生效的缓存 > 本地打分 > `'default'`。

> ⚠️ 「玩家自选优先于自动判定」这一条是**本文据 #23 推出的**，不是某张票明写的：#23 定了「玩家手动改画质 = 提示下次启动生效」，那句话只有在下次启动真的honor它时才成立。实施时若发现不该 honor（比如低端机选高清会崩），改这里并回补一条 ADR。

**两个 `SaveManager` key，语义不同不能合并**（key 一律带 `appId` 前缀 —— Web / 小游戏同域名共用 localStorage，不隔离两个马甲会串）：

- 上次生效的档位缓存 —— 「**机器该是哪档**」
- 玩家自选 —— 「**玩家想要哪档**」

### 3.3 与 `device-profile` 的接缝

`deviceTierModule` 声明 `deps: ['device-profile']`，并在 `install()` 里 `ctx.container.resolve(DEVICE_PROFILE)` 把画像捞出来存着。

这**不只是 fail-fast，是排序的正确性前提**：`topoSort`（`packages/core/src/bootstrap/bootstrap.ts:59`）保证画像模块先 `install`。项目漏注册画像模块，`boot()` 当场抛「depends on missing module」，而不是等到判档那一步在 1.5 秒赛跑里静默失败。

> 这一条比 [#27](https://hlgit.5518game.com/luohao/creator-core-kit/-/issues/27) 记的更强 —— 那里写的是「install 时并不 resolve 画像，声明 deps 只为 fail-fast」。写规格时发现 install 期捕获更简单、且没有合理的缺省可退（没有画像就打不了分），故收紧。

### 3.4 启动时序：另起一步，排在 `dispatch` 之后、`shared` 之前

```
platform → dispatch → 【tier】 → hotupdate → shared → lobby → running
```

> ⚠️ 位置在 `hotupdate` 之前还是之后，取决于接入方工程把地基放在哪一段。**硬约束只有两条**：必须在 `dispatch` 之后（要服务器地址），必须在 `shared` 之前（`shared` 那一步要装**按档取的常驻地基皮包**）。demo 的具体排法在 `apps/demo/docs/`。

**为什么排在 `shared` 之前是硬的**：判档跑起来那一刻，能用的只有 **base 层（`main` / `resources`）+ 网络**，业务包一个都没装 ⇒ **「策略表走 `ConfigTable` 从业务包加载」在物理上行不通**，不是取舍问题。

**为什么不塞进现有的 `dispatch` 步**：那个响应体是跨框架契约（ADR-0011），往里加分档字段会污染它；而且判档要把整个设备画像塞进请求体，跟 dispatch「这个版本能不能玩、去哪个部署单元」的职责完全不搭。

**接法**（`packages/core/src/app/app.ts`）：

```ts
export interface AppConfig {
  // …既有字段
  /** 分档。不配则跳过该步 —— 跟 `dispatcher` 逐字同构。 */
  readonly tier?: TierConfig;
}

export type LaunchPhase =
  | 'idle' | 'platform' | 'dispatch'
  | 'tier'                              // ← 新增
  | 'hotupdate' | 'shared' | 'lobby' | 'running' | 'failed';
```

**为什么不让项目自己 splice 一个 `tierStep()` 进去**，两条理由，第二条是硬的：

1. 上面那个顺序是整张 [#25](https://hlgit.5518game.com/luohao/creator-core-kit/-/issues/25) 推出来的结论。交给每个接入方各排一次，**排错了是静默的** —— 排到 `shared` 之后，档位照样判出来、缓存照样写，只是常驻地基皮包已按默认档装好，这一版白判，日志里一个字都不会出现。
2. **`LaunchStep.phase` 的类型是封闭联合 `LaunchPhase`** —— 项目自己插的步骤**没法给自己一个准确的 phase**，只能借用一个不相干的（借 `'dispatch'`，那 1.5 秒会被启动界面显示成「连接服务器」，排查直接指错方向）。外部扩不了这个联合，这条路从类型上就是残的。

加 `'tier'` 成员会让所有 `switch` 在编译期报出来（demo 的 `LaunchOverlay` 会被点名），不会静默漏文案。

### 3.5 不阻塞启动：缓存优先 + 短超时的机会主义等待

顺序是：**读缓存**（没有就本地现算）→ 拿它继续启动 → 同时发出请求、给一个很短的预算 → 赶上了用服务器的，没赶上就走 → **无论如何把结果写缓存给下次用** → **不重试**。

一次解决三个问题：超时不用纠结（有预算、不重试）；接口失败不用特殊处理（跟超时同一条路）；「服务器明说没有」vs「网络挂了」在启动路径上行为相同，差别只体现在**埋点的 `source` 字段**里 —— 那正是该有差别的地方（一个是覆盖率问题，一个是可用性问题）。

⚠️ **这一步撞上 `CLAUDE.md` 硬规则 4**：`await` 回来先确认「自己还在」，且**占坑要占在 `await` 之前**。启动可能已被中止（强更、停服、热更重启进程），回来时必须先判再动。这条链恰好是「网络慢才现形」的典型，本机永远测不出来 —— **它必须有单测**（见 §6）。

---

## 4. `perf-window` —— 性能采集

**core 一个纯类 + engine 一个四行函数，无 DI token、无 `KitModule`。** 文档落 `packages/core/docs/modules/perf-window.md`。

### 4.1 为什么不进 DI

kit 里**没有任何东西需要 `resolve` 它**：档位不读它（闭环是跨启动的，§7.2）、上报不经它（`drain()` 的返回值就是接缝）。项目自己想注册进容器随意，kit 不代劳。

### 4.2 类型（原型已验证，分支 `proto/perf-window`）

```ts
export interface PerfWindowOptions {
  /** 卡顿阈值（ms，升序），可多档。默认 [100, 200]；**空数组 = 不统计卡顿**。 */
  stallThresholdsMs?: number[];
  /** 未被取走的报告上限，默认 8。满了丢最老的并计数。 */
  maxPending?: number;
}

export interface StallBucket {
  thresholdMs: number;
  frames: number;
  /** 这些帧的**总耗时**（不是超出部分）。超出部分可反推：`totalMs - frames * thresholdMs`。 */
  totalMs: number;
}

export interface PerfReport {
  tag: string;                    // 段标签，`mark()` 打；'' = 还没打过
  durationMs: number;             // 各帧 dt 之和，切后台不计
  frames: number;
  p50Ms: number; p95Ms: number; p99Ms: number;
  maxFrameMs: number;             // 分位数落在溢出桶时返回实测 max，不谎报成 255
  stalls: StallBucket[];
  spans: Record<string, { n: number; totalMs: number; maxMs: number }>;
  peaks: Record<string, number>;
  counts: Record<string, number>;
}

export class PerfWindow {
  constructor(opts?: PerfWindowOptions);
  frame(dtMs: number): void;              // 引擎每帧推真实 dt
  span(name: string, ms: number): void;   // 一次性耗时事件：加载、切场景
  peak(name: string, value: number): void;// 取最大值的量：内存峰值
  count(name: string, n?: number): void;  // 取累加的量：GC 次数
  mark(tag: string): void;                // 换段；同名 tag 是 no-op
  drain(): { reports: PerfReport[]; dropped: number };
}
```

**数据只有一个方向：全部 push 进来，一份 `PerfReport[]` 出去。** 这也是它能在 node 里逐帧复现的原因。

- **采样源不做接口**：帧时间天然是 push，只有引擎跑到那一帧才知道 dt；定义 `IFrameSource` 让聚合器去 pull 是给「每帧调一下这个方法」套壳。内存读数看着像 pull 也不 pull —— 让采集器主动读内存，它就得认识「内存」是什么、多久读一次、读不到怎么办，那是 §2 划给 engine 的活。
- **上报通道不做接口**：端点与字段名是项目协议，同 `fetchTier` 判据。

**⭐ 分位数抓不到卡顿，这是原型跑出来的反例，别把 P95 当头号指标。** 30 秒窗口里三次卡顿（150/260/120ms）之后，`p50 = p95 = p99 = 17ms` —— 3 帧 / 1800 帧 = 0.17%，要 p99.9 才够得着。**分位数量的是稳态帧率**（这台机器能不能稳住 60/30），**卡顿靠计数 + 累计毫秒**。两个都要报，但主角不是 P95。

**直方图定长**：`Uint32Array(256)`，1ms/桶，**1KB 定长跟窗口多长无关**；`frame()` 是一次下标自增加几次标量比较，**零分配**（自检：100 万次 `frame()` 堆增长约 17KB，噪声级）。

**报告不落盘。** 注意「被杀时落盘」这个选项**不存在**：Android 杀进程不给可靠收尾时间，`IStorage` 又全是 `Promise`。真实选项只有「每次 drain 预先落盘」= 常态每 30 秒一次磁盘写，而 **IO 抖动自己就会造成卡顿** —— 测卡顿的东西制造卡顿。

### 4.3 engine 半：一个函数，为了堵两个静默的坑

```ts
// packages/engine —— 形状照抄现成的 driveWithDirector
export function drivePerfWindow(perf: Pick<PerfWindow, 'frame'>): Disposer;
```

它必须由 kit 出，理由只有一个但够硬：**两个「挂错时钟」的坑都是静默的**。

- **`frame()` 不能挂 `ITimer.onFrame`** —— 那里拿到的是 `dt × timeScale`，且 `paused` 时**根本不触发**：游戏一暂停性能数据就断，而暂停可能正是卡出来的。真实 dt 只在 `packages/engine/src/bootstrap.ts:26`（`driver.tick(game.deltaTime)`）那一行上。
- **单位**：`game.deltaTime` 是**秒**，`frame(dtMs)` 要**毫秒**。

**`drain()` 的节拍同理不能用 `ITimer.interval`**（暂停时永不触发，攒着的报告发不出去），要用平台真实时钟 —— 但**节拍归项目**，kit 不内置定时器（「攒够 30 秒」是策略）。

### 4.4 场景标签：显式 `mark()`，kit 不挂 `SceneFlow`

接线本来就一行、且写在项目侧：`createSceneFlow({ onChange: (_, to) => perf.mark(to) })`。kit 内部去挂反而更贵（采集器得认识 `SceneFlow`，而它是可选模块），而且**会漏掉最该量的那段** —— demo 里 `game` 类模块走 `SceneFlow` push/pop，但 `panel` 类（邮件、商店）是 `UIManager.open`，**一次转换都不产生**；大厅里翻界面翻到卡恰恰在 panel 那条路上，自动挂等于把大厅整段糊成一个 tag。

### 4.5 不让它勾住 `device-profile`

`peak()` 的典型用途是内存峰值，要**周期性**读，而 `DEVICE_PROFILE` 只是启动快照。差一步就变成「`perf-window` 依赖 `device-profile`」。

解法零成本：**要周期采样的自己调裸 `readDeviceProfile()`**（快照本来就是它产的，只是也让出去），自己定频率、自己承担代价。两个新模块因此互不认识。

---

## 5. 按档资源解析 —— 零新模块

`UIVariant` 加一个字段就够了（`packages/core/src/ui/ui-registry.ts`）：

```ts
export interface UIVariant {
  readonly orientation: Orientation;
  readonly skin: string;
  /** 画质档位。跟 `skin` 完全对称，kit 不知道有哪几档。 */
  readonly tier: string;
}

export const DEFAULT_UI_VARIANT: UIVariant = { orientation: 'portrait', skin: 'default', tier: 'default' };
```

既有的 resolver 机制原样复用 —— `UIDef.bundle` / `UIDef.prefab` 给函数即为变体解析，多一个维度不需要新机制：

```ts
registerUI('Shop', { bundle: (v) => `shop-${v.tier}`, prefab: 'Shop' });
```

**分档是登记制，跟 `skinned` 同构**：登记了才走分档包、且各档必须齐；没登记的走通用包、所有档位共用一份 ⇒ **包数不是「全部 × 档位数」，而是「值得分档的那一小部分 × 档位数」**。

**缺档由构建期保证、运行期不回退。** 运行期回退分不清「包没发布」和「网络挂了」，弱网下会把玩家永久降档。开发期那道闸现有 `BUNDLE_GRAPH` + `strict` 免费给了一半。

---

## 6. 分层 · 文档 · 测试

### 文档四份

| 文档 | 归属 | 为什么 |
|---|---|---|
| `packages/engine/docs/modules/device-profile.md` | **engine** | 分量全在取值那半（三平台 × 十几项 + Java 桥 + 五项待实测 + §2.3 那两个坑）。先例：`camera-rig.md` 也在 engine，且 engine 包本来就放得下纯逻辑（`render-policy.ts`） |
| `packages/core/docs/modules/device-tier.md` | core | 全是编排 |
| `packages/core/docs/modules/perf-window.md` | core | 纯类 |
| `packages/core/docs/modules/ui-manager.md` | core | `UIVariant.tier` 并进既有文档，不另起 |

> `DeviceProfile` 类型会出现在 core 的 typedoc（`packages/core/docs/api/`）而正文在 engine —— 两边各留一句指针。

### 测试

| 目标 | 怎么测 | 门槛 |
|---|---|---|
| `perf-window` | **100% node**，逐帧可复现（原型已用 `node demo.ts` 证明） | core 覆盖率硬门槛 |
| `device-tier` | **100% node** —— 注入假 profile / 假 `scoreTier` / 假 `fetchTier` / `createMemoryStorage` | core 覆盖率硬门槛 |
| `device-profile` 的 core 半 | **100% node** —— 单位换算 / `readFailures` 记账 / `REASON_*` 映射全是纯函数 | core 覆盖率硬门槛 |
| `device-profile` 的 engine 半 | **不测**（`native.reflection` 是 JNI，ADR-0002 决策 3 禁止进 cc mock） | 靠「薄到没有逻辑可测」保证 |
| 平台取值本身 | 真机（见 §8） | — |

**`device-tier` 必测的那一条**：`await` 回来先确认「自己还在」（`CLAUDE.md` 硬规则 4）。它只在弱网现形，本机永远碰不到，所以必须靠测试而不是靠运气。

**`device-profile` 的 engine 半怎么做到「没有逻辑可测」**：照 [#51](https://hlgit.5518game.com/luohao/creator-core-kit/-/issues/51) 那次学到的办法 —— 把单位换算、`readFailures` 记账、`REASON_*` 常量到字符串的映射**全部下沉成 core 的纯函数并全测**，engine 只剩「按平台挑一条取值路径 + 把结果塞进结构」，没有分支可以出错。

**`check:vm-tests` 不扩** —— 它只扫 `apps/` 下的 `assets/` 或 `src/`（`scripts/check-vm-tests.mjs`），`packages/` 不在管辖内。

---

## 7. 明确不做的，与为什么

### 7.1 渲染参数降级器不进 kit

**kit 只给等级，业务层自己转旋钮。**

调研（[#39](https://hlgit.5518game.com/luohao/creator-core-kit/-/issues/39)）给降级器定过五个旋钮，实测之后只剩两行代码：

| 旋钮 | 现状 |
|---|---|
| `shadingScale` | 实测**开箱即坏**：管线一切到 post-process，画面只剩一块 `RGB(28,30,40)` 纯色、2D UI 全部消失 —— 那正是 `packages/engine/src/camera-rig.ts:173` 的 `clearColor`（常驻相机组是一摞相机，post-process 给每台各建离屏 RT 各自 blit 回窗口，后面的覆盖前面的）。**且不可热更**（改引擎指纹，按 ADR-0017 必须发新 APK）＋**固定 +904 KB APK** ⇒ 出局 |
| `game.frameRate` | engine **一行** |
| 主动 GC | engine **一行** |
| 粒子上限 | kit 做不了通用版（「只影响新建的还是要作用到已存在的」没答） |
| 音频实例生命周期 | `AudioServiceOptions` 今天只有 `player` 一个字段，压根没有并发上限。要做是给 AudioService 补旋钮 |

**唯一撑得起一个模块的那个旋钮没了**，剩下的给 `game.frameRate = n` 造一个注册表不值。

> ⚠️ **`shadingScale` 是「有前提的旋钮」**，前提是先解掉「多相机 × post-process」的冲突。真要用它，得先改渲染架构，且**只能出包时定** —— 不存在「线上发现卡了再热更打开」。

### 7.2 运行中不换资源包

资源档**一次会话内定死**。三条理由，任一条单独成立：

1. **低清包大概率不在本地**（安装包里只放主游戏那一套）。降档触发的第一次 `open` 就变成一次下载 —— 而且是在内存吃紧、网络还慢的时候。
2. **重建路径会先冲高峰值**：`destroy 旧 view → load 新 prefab → 建新 view`，中间新旧两份同时在内存里。为了少占几 MB 先多占几 MB，正是在最不该冲高的时候。
3. **降档在弱网下根本降不下去**（它自己要先下载）。

于是这些复杂度**一条都不用做**：重建时机判定、下载编排、切换进度条、失败回滚、并发切换合并、「安全时机」的定义。

**闭环改成跨启动**：本次会话忍住 → 上报真实性能数据 → **下次启动**由服务器（或本地）把这台机器判到更低档。这比「单机当场拍一个档位」更准 —— 服务器攒的是全量真实数据，不是一台机器某个瞬间的观测。

### 7.3 kit 不出默认打分函数

三条已定结论摆在一起，默认打分函数就无路可走了：

- **策略归项目**（§1.1 第 1 条），`192MB 是不是低端线` 明确留给接入方；
- **内存必须拆成三个字段**（§2.1），合并会让打分拿到含义随平台漂移的数字；
- ⇒ kit 的默认打分要跨平台，就**必须**在内部把那三个字段挑一个用（正是上一条禁掉的事）；要不漂移，就只能对 Android 成立、其余平台恒落默认档（那不叫兜底）。

而且它犯的正是 [#25](https://hlgit.5518game.com/luohao/creator-core-kit/-/issues/25) 否决「服务器下发规则让客户端算」时给的毛病：**第二套算法要维护，两边算出不同结果时排查会很痛** —— kit 的默认与服务器的真算法必然不一致，且不一致时没人会发现。

**编排参数照旧烧默认值**（超时预算 1500ms、缓存 key、来源标记）—— 那些是机制不是策略，跨平台没有漂移问题。

### 7.4 「上次是不是非正常退出」不做留痕兜底

留痕这个做法本身在手机上是坏的：手机没有「正常退出」这个时刻（划掉 / home / 来电，`EVENT_HIDE` 只说明切后台）。

- 切后台不清标记 → 几乎每次启动都读到「上次非正常」，**全是假阳性**；
- 切后台就清 → **后台被 OOM 掉的那次读成干净退出**，漏的正是最典型的那种。

**坏信号比没信号更糟** —— 它会同时污染埋点和判档输入。Android 有权威答案（`ActivityManager.getHistoricalProcessExitReasons()`，API 30+，直接返回上次进程**为什么**没的，分得清 OOM 和用户主动划掉）；Android 11 以下就让它是「这个平台没这能力」（§2.1 三态表的第二行）。

---

## 8. 实施期待实测 / 待验证

这些决定的是「要写多少 Java 桥」，属按图施工，**不单独开票**，但实现前必须逐条落实：

| # | 待实测 | 影响 |
|---|---|---|
| ① | `native.fileUtils` 读 `/sys` 到底通不通 | **影响面最大** —— 不通则 CPU 核数 / 主频也得走 Java 桥 |
| ② | `Device::getDPI()` 在 Android 上返回什么 | 决定 `densityDpi` 要不要自己走桥 |
| ③ | `native.reflection` 的 `J`(long) 返回可不可用 | 有绕法：包装方法一律返回 `I`(MB) 或 String |
| ④ | 厂商 ROM 对 `/sys/.../cpu/**` 的实际可读性 | **要目标市场真实低端机抽样，模拟器测不出来** |
| ⑤ | 字节小游戏字段清单 | 该平台的退化程度 |

**已被答掉的一项**：「Android Java 源码往 `build-templates/` 哪一层放」—— 由崩溃上报那张图（[#42](https://hlgit.5518game.com/luohao/creator-core-kit/-/issues/42)）解决了：`apps/demo/native/` 已入库，三份 `CckReport.java` 真落在 `app/src/cap-report-*/java/com/cck/report/`，落点表可直接抄。

**待验证的 API**：`ActivityManager.getHistoricalProcessExitReasons()` 的版本门槛、字段名、`REASON_*` 常量清单 —— 实现第一件事对官方文档，别凭记忆写。常量到字符串的映射由 engine 侧做，不能让每个消费者各背一张 Android 常量表。

---

## 9. 开放项

三条在范围内、但本轮问不清楚的，留给实施期或后续：

- **三档包同优先级时，共用资源的归属会静默漂移。** 分档的 prefab 引用一张**不分档的通用图**（大部分资源都不分档），Creator 会把它判给三个档位包中的某一个，另外两档降级成 `redirect` —— **漂了是静默的**（构建全绿、热更下发成功，运行时才在 `redirect` 指向的包里找不到资源）。本仓实测踩过同型的坑（两个马甲的地基皮包同优先级抢同一张图）。现有的「钉住 + `check:pins`」针对的是**引擎内置资源**，分档场景要钉的是**项目自己的通用图** —— 能不能照搬、钉在哪一层，实施时定。
- **「释放当前未被引用的资源」这个动作的实现形状。** `assetManager.releaseUnusedAssets()` 是 `@engineInternal`、不是公开 API，抓手只能落在 kit 自己的 `BundleScope` / `AssetLoader` 组籍配对上：具体怎么做、什么时候触发、会不会跟正在加载中的资源打架。⚠️ §7.1 把降级器踢出 kit 之后，**它成了运行时唯一还可能归 kit 的动作**，分量反而变重了。
- **demo 侧样板长什么样**：哪个模块承载、要不要新造一个 mini 游戏来演示分档，还是挂在现有模块上。

---

## 10. 决策索引

细节住在票里，本表只给指针。

| 票 | 定了什么 |
|---|---|
| [#22 设备参数取得到哪些、要不要权限](https://hlgit.5518game.com/luohao/creator-core-kit/-/issues/22) | **零权限能做到**（19 项无一需要权限声明）；引擎只白送 GPU 型号 / 分辨率 / 压缩格式支持 / adpf，内存与 CPU 全部要自写 Java 桥；三项在新系统上静默返回空值不抛错 |
| [#23 kit 给数据还是给决策](https://hlgit.5518game.com/luohao/creator-core-kit/-/issues/23) | 资源档会话内定死、运行中不换包；闭环改成跨启动；档位持有者不给 `setTier()` |
| [#24 档位进不进 UIVariant](https://hlgit.5518game.com/luohao/creator-core-kit/-/issues/24) | `UIVariant` 加 `tier`；分档是登记制；缺档由构建期保证、运行期不回退 |
| [#25 策略注入载体](https://hlgit.5518game.com/luohao/creator-core-kit/-/issues/25) | 判档另起一步排在 `dispatch` 后 `shared` 前；缓存优先 + 短超时不重试；`fetchTier` 由项目注入 |
| [#26 性能采集器接口形状](https://hlgit.5518game.com/luohao/creator-core-kit/-/issues/26) | `PerfWindow` 一个类三个接口都不做；P95 抓不到卡顿；两个「挂错时钟」的坑 |
| [#37 DeviceProfile 怎么跨平台建模](https://hlgit.5518game.com/luohao/creator-core-kit/-/issues/37) | 内存拆三个字段；`readFailures` 区分两种「取不到」；接缝定在「给我一份画像」这层 |
| [#39 运行时还能省哪些内存](https://hlgit.5518game.com/luohao/creator-core-kit/-/issues/39) | **纹理内存压不了**（四条独立证据）；降级器旋钮清单；`macro.*` 全家是启动期配置 |
| [#41 实测 shadingScale](https://hlgit.5518game.com/luohao/creator-core-kit/-/issues/41) | 开箱即坏（多相机 × post-process）；不可热更；固定 +904 KB APK |
| [#27 收口：切几个模块](https://hlgit.5518game.com/luohao/creator-core-kit/-/issues/27) | **本文的直接来源** —— 模块划分、分层、依赖方向、token、文档与测试归属 |

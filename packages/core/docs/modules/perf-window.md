---
模块: perf-window
所在包: packages/core（聚合器本体）+ packages/engine（一根接到真实帧时钟的线）
状态: 已实现（core 18 测试，覆盖 100%；engine 3 测试）
跟踪: hlgit #21（wayfinder 图）· 接口形状见 #26 · 模块划分见 #27 · 总纲 `docs/design/device-tiering-overview.md` §4
摘要: 帧耗时 / 卡顿 / 加载耗时 / 内存峰值的会话内聚合器。一个纯类，三个接口一个都不做——数据全 push 进来、一份 `PerfReport[]` 出去，node 里逐帧可复现。
何时读: 要采集或上报运行时性能数据时；或想知道「为什么 P95 不是卡顿指标」时。
日期: 2026-09-09
依赖: 无（零依赖、零 `cc`）
---

# 性能采集器 perf-window

## TL;DR

`new PerfWindow()` → 每帧 `frame(dtMs)`、换场景 `mark(tag)`、要发数据时 `drain()`。
engine 侧 `drivePerfWindow(perf)` 一行接上真实帧时钟。**没有 DI token，没有 `KitModule`** ——
kit 里没有任何东西需要 `resolve` 它。

⭐ **别把 P95 当卡顿指标**（见「已知行为与坑」第 1 条）。

## Purpose（目标与定位）

回答两个不同的问题，别混为一谈：

- **这台机器能不能稳住 60/30？** → 分位数（`p50Ms` / `p95Ms` / `p99Ms`）
- **这一段里卡了几次、一共卡了多久？** → `stalls`（计数 + 累计毫秒）

它是「跨启动降档闭环」的数据源：本次会话把真实性能数据送出去，**下次启动**由服务器（或本地）
把这台机器判到更低档（见 `device-tier`）。所以它**不需要**实时反馈给任何人 —— 采集完 `drain()`
交出去就完了。

**不在范围内**：怎么发（端点与字段名是项目协议）、多久发一次（「攒够 30 秒」是策略）、
数据落盘（见坑 4）。

## Public API（TypeScript 精确签名）

```ts
// @cck/core
export interface PerfWindowOptions {
  /** 卡顿阈值（ms），可多档。默认 `[100, 200]`；空数组 = 完全不统计。传入顺序不限。 */
  readonly stallThresholdsMs?: readonly number[];
  /** 未被取走的报告上限，默认 8。满了丢**最老的**并计数。 */
  readonly maxPending?: number;
}

export interface StallBucket {
  readonly thresholdMs: number;   // 严格大于才算卡顿
  readonly frames: number;
  readonly totalMs: number;       // 卡顿帧的**总耗时**，不是超出部分
}

export interface SpanStat {
  readonly n: number;
  readonly totalMs: number;
  readonly maxMs: number;
}

export interface PerfReport {
  readonly tag: string;           // `mark()` 打的段标签；'' = 还没打过
  readonly durationMs: number;    // 各帧 dt 之和（切后台不计）
  readonly frames: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly maxFrameMs: number;
  readonly stalls: readonly StallBucket[];
  readonly spans: Readonly<Record<string, SpanStat>>;
  readonly peaks: Readonly<Record<string, number>>;
  readonly counts: Readonly<Record<string, number>>;
}

export class PerfWindow {
  constructor(opts?: PerfWindowOptions);
  frame(dtMs: number): void;               // 每帧推真实 dt
  span(name: string, ms: number): void;    // 一次性耗时事件：加载、开界面
  peak(name: string, value: number): void; // 取最大值的量：内存峰值
  count(name: string, n?: number): void;   // 取累加的量：GC 次数（默认 +1）
  mark(tag: string): void;                 // 换段；同名 tag 是 no-op
  drain(): { reports: PerfReport[]; dropped: number };
}
```

```ts
// @cck/engine
export function drivePerfWindow(perf: Pick<PerfWindow, 'frame'>): Disposer;
```

### 接起来长这样

```ts
const perf = new PerfWindow({ stallThresholdsMs: [100, 200] });
const stop = drivePerfWindow(perf);                                  // 帧时钟
createSceneFlow({ onChange: (_, to) => perf.mark(to) });             // 场景标签（项目侧一行）
setInterval(() => {                                                  // 节拍归项目，别用 ITimer
  const { reports, dropped } = perf.drain();
  if (reports.length) void postTelemetry({ reports, dropped });      // 上报也归项目
}, 30_000);
```

## Behavior & data flow（行为与数据流）

**数据只有一个方向**：全部 push 进来 → 攒在「当前段」 → `mark()` / `drain()` 时封成一份
`PerfReport` → `drain()` 一次性交出去。

```
frame/span/peak/count ──▶ 当前段（定长直方图 + 三个 Record）
                              │  mark(新 tag) 或 drain()
                              ▼
                          _pending: PerfReport[]  ──drain()──▶ 项目拿去发
                              │  超过 maxPending
                              ▼  丢最老的，dropped++
```

- **段（segment）** 由 `mark(tag)` 划分。`mark()` 先封上当前段、再换标签。
- **封段的条件是「这一段收到过任何数据」**，不是「有帧」—— 见坑 3。
- **`drain()` 会先封上当前段**，所以调用后当前段一定是空的。

## Key design decisions（决策表）

| # | 决策 | 为什么 |
|---|---|---|
| 1 | **三个接口一个都不做**（采样源 / 上报通道 / 内存读取） | 帧时间天然是 push（只有引擎跑到那一帧才知道 dt），定义 `IFrameSource` 让聚合器 pull 是给「每帧调一下」套壳；上报端点与字段名是项目协议；内存读数看着像 pull 也不 pull —— 一 pull 采集器就得认识「内存」是什么、多久读一次、读不到怎么办，那是 `device-profile` 的活 |
| 2 | **不进 DI，没有 `KitModule`** | kit 里没有任何东西需要 `resolve` 它：档位不读它（闭环是跨启动的）、上报不经它。项目想注册进容器随意，kit 不代劳 |
| 3 | **直方图定长 `Uint32Array(256)`，1ms/桶** | **1KB 定长，跟窗口多长无关**；`frame()` 因此是一次下标自增 + 几次标量比较，**零分配**（原型自检：100 万次 `frame()` 堆增长约 17KB，噪声级）。它每帧在低端机上跑 |
| 4 | **卡顿阈值可配、可多档、可关** | 门槛是策略、归项目（总纲 §1.1 第 1 条）。kit 只给个能跑的默认 `[100, 200]` |
| 5 | **`stalls.totalMs` 取「卡顿帧总耗时」而不是「超出部分」** | 给了 `frames` 两者可互推（`超出 = totalMs - frames × thresholdMs`），是纯呈现选择 ⇒ 取直接可读的那个：「这段里有 530ms 花在卡顿帧上」，配 `durationMs` 就是卡顿时间占比 |
| 6 | **场景标签显式 `mark()`，kit 不挂 `SceneFlow`** | 接线本来就一行且在项目侧；kit 内部挂反而更贵（要认识一个**可选**模块），而且**会漏掉最该量的那段** —— `panel` 类界面走 `UIManager.open`，一次场景转换都不产生 |
| 7 | **同名 tag 是 no-op** | 否则自转 / pop 回同一态会连着触发，攒出一串一两帧的碎报告，上报量炸掉而信息为零。要故意切段有 `drain()` |
| 8 | **`maxPending` 满了丢最老的，并交出 `dropped`** | 上报方挂了不能把内存吃穿；而「丢了几份」要让数据自己说，不能安静地少几份 |
| 9 | **报告不落盘** | 见坑 4 |

## Platform considerations

**零 `cc`、零依赖，四平台行为逐字相同。** 唯一跟平台有关的是 engine 侧那根线
（`drivePerfWindow` 用 `cc.director` / `cc.game`），它在所有 Cocos 目标平台上一致。

`peak()` 喂什么由调用方决定 —— 要周期性读内存，调 engine 的裸函数 `readDeviceProfile()`
自己定频率（**不要**让本模块去依赖 `device-profile`，见总纲 §4.5）。

## Testable seams + test plan

**全部 node 可测，不需要 `cc`**：数据单向 ⇒ 灌帧、看报告，逐帧可复现。

`packages/core/src/perf/__tests__/perf-window.test.ts`（18 条）：

| 组 | 覆盖 |
|---|---|
| 帧统计与分位数 | 稳态帧率 · ⭐ **分位数抓不到卡顿的反例** · 溢出桶返回实测 max · 丢 NaN/0/负 |
| 卡顿阈值 | `totalMs` 口径 · 空数组不统计 · 乱序传入升序存 · 恰好等于阈值不算 |
| span / peak / count | 累计 · 取最大 · 累加与默认 `+1` |
| 分段 | `mark` 换段 · 同名 no-op · **零帧段的数据不许漂到下一段** · 无数据段不产报告 |
| drain 与缓冲 | 封段并清空 · `maxPending` 丢最老 + `dropped` · `dropped` 随 drain 清零 · **交出的报告与内部状态不共享引用** |

`packages/engine/src/__tests__/perf-driver.test.ts`（3 条）：**秒→毫秒换算** · 解绑后不再喂 ·
接到真 `PerfWindow` 上端到端。

> engine 那半虽然只有四行，但**必须有测**：它做的两件事（挑对时钟、换对单位）错了都不报错。

## 已知行为与坑

1. ⭐ **分位数抓不到卡顿 —— 别把 P95 当卡顿指标。** 30 秒 60fps 里夹三次卡顿（150/260/120ms），
   `p50 = p95 = p99 = 17ms`，全部「正常」：3 帧 / 1800 帧 = 0.17%，**要 p99.9 才够得着**。
   **分位数量的是稳态帧率，卡顿只在 `stalls` 里。** 两个都要报，但主角不是 P95。
   这条已固化成回归测试，别「优化」掉 `stalls`。

2. ⚠️ **两个「挂错时钟」的坑，都是静默的。**
   - `frame()` **不能挂 `ITimer.onFrame`** —— 那里拿到的是 `dt × timeScale`，且 `paused` 时
     **根本不触发**：游戏一暂停性能数据就断，而暂停很可能正是卡出来的。用 `drivePerfWindow`。
   - `drain()` 的节拍**同理不能用 `ITimer.interval`**（暂停时永不触发，攒着的报告发不出去），
     要用平台真实时钟。节拍本身归项目。

3. **零帧但有数据的段照样成报告。** 封段判据是「这一段收到过任何数据」而不是「有帧」——
   一段可能一帧都没渲染却有 `span`（加载）。用 `_frames === 0` 当判据会让那份数据**既不产报告、
   状态又不清**，于是在下一次 `mark()` 时**漂到下一个 tag 名下**。这类报告的 `frames` 为 0、
   `durationMs` 为 0、分位数为 0 —— 消费方拿它算 fps 要先判 `frames > 0`。

4. **报告不落盘，而且「被杀时落盘」这个选项不存在。** Android 杀进程不给可靠收尾时间，
   `IStorage` 又全是 `Promise`。真实选项只有「每次 drain 预先落盘」= 常态每 30 秒一次磁盘写，
   而 **IO 抖动自己就会造成卡顿** —— 测卡顿的东西制造卡顿。收益只有「崩溃前最后 30 秒」，
   且那次数据本来就偏。

5. **`durationMs` 是各帧 dt 之和，不是墙钟时长。** 切后台期间不产生帧，所以那段时间不计入。
   要墙钟自己在项目侧记。

6. **分位数精度 1ms**，且 `>=255ms` 进溢出桶。分位数落在溢出桶时返回**实测 max**（不谎报成 255）。
   `Math.round` 的缘故，254.6ms 这样的帧会落进溢出桶 —— 两种取值都 ≥ 它，无实际影响。

7. **`Array.from` 而不是 `[...x]`**（构造函数里那次拷贝）。Cocos 构建的 babel loose spread 会把
   `[...x]` 降级成 `[].concat(x)`，**只在构建产物里炸、预览测不出来**；仓库有 lint 规则挡。

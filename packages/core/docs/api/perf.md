[**@cck/core API**](README.md)

***

[@cck/core API](README.md) / perf

# perf

## Classes

### PerfWindow

Defined in: [packages/core/src/perf/perf-window.ts:84](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/perf/perf-window.ts#L84)

#### Constructors

##### new PerfWindow()

> **new PerfWindow**(`opts`): [`PerfWindow`](perf.md#perfwindow)

Defined in: [packages/core/src/perf/perf-window.ts:108](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/perf/perf-window.ts#L108)

###### Parameters

###### opts

[`PerfWindowOptions`](perf.md#perfwindowoptions) = `{}`

###### Returns

[`PerfWindow`](perf.md#perfwindow)

#### Methods

##### count()

> **count**(`name`, `n`): `void`

Defined in: [packages/core/src/perf/perf-window.ts:153](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/perf/perf-window.ts#L153)

取累加的量：GC 次数、丢帧次数。

###### Parameters

###### name

`string`

###### n

`number` = `1`

###### Returns

`void`

##### drain()

> **drain**(): `object`

Defined in: [packages/core/src/perf/perf-window.ts:172](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/perf/perf-window.ts#L172)

上报方来取：封上当前段，交出全部攒着的报告并清零。

###### Returns

`object`

###### dropped

> **dropped**: `number`

###### reports

> **reports**: [`PerfReport`](perf.md#perfreport)[]

##### frame()

> **frame**(`dtMs`): `void`

Defined in: [packages/core/src/perf/perf-window.ts:121](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/perf/perf-window.ts#L121)

引擎每帧推**真实 dt**（不是 `ITimer` 那个被 `timeScale` 缩过的，见文件头）。

###### Parameters

###### dtMs

`number`

###### Returns

`void`

##### mark()

> **mark**(`tag`): `void`

Defined in: [packages/core/src/perf/perf-window.ts:165](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/perf/perf-window.ts#L165)

换段：封上当前这份、开一份新的。**业务显式调，采集器不认识 `SceneFlow`** ——
挂上去会漏掉最该量的那段（`panel` 类界面一次场景转换都不产生）。

**同名 tag 是 no-op**：否则自转 / pop 回同一态会连着触发，攒出一串一两帧的碎报告，
上报量炸掉而信息为零。要故意切段有 `drain()`。

###### Parameters

###### tag

`string`

###### Returns

`void`

##### peak()

> **peak**(`name`, `value`): `void`

Defined in: [packages/core/src/perf/perf-window.ts:146](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/perf/perf-window.ts#L146)

取最大值的量：内存峰值。**引擎按自己的慢频率喂进来**，采集器不主动读。

###### Parameters

###### name

`string`

###### value

`number`

###### Returns

`void`

##### span()

> **span**(`name`, `ms`): `void`

Defined in: [packages/core/src/perf/perf-window.ts:137](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/perf/perf-window.ts#L137)

一次性耗时事件（加载一个包、开一个界面）。

###### Parameters

###### name

`string`

###### ms

`number`

###### Returns

`void`

## Interfaces

### PerfReport

Defined in: [packages/core/src/perf/perf-window.ts:51](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/perf/perf-window.ts#L51)

一段（一个 tag）的聚合结果。纯数据，可直接 JSON 化发走。

#### Properties

##### counts

> `readonly` **counts**: `Readonly`\<`Record`\<`string`, `number`\>\>

Defined in: [packages/core/src/perf/perf-window.ts:68](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/perf/perf-window.ts#L68)

取累加的量：GC 次数、丢帧次数。

##### durationMs

> `readonly` **durationMs**: `number`

Defined in: [packages/core/src/perf/perf-window.ts:55](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/perf/perf-window.ts#L55)

本段覆盖的渲染时长（= 各帧 dt 之和，切后台不计）。

##### frames

> `readonly` **frames**: `number`

Defined in: [packages/core/src/perf/perf-window.ts:56](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/perf/perf-window.ts#L56)

##### maxFrameMs

> `readonly` **maxFrameMs**: `number`

Defined in: [packages/core/src/perf/perf-window.ts:61](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/perf/perf-window.ts#L61)

##### p50Ms

> `readonly` **p50Ms**: `number`

Defined in: [packages/core/src/perf/perf-window.ts:58](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/perf/perf-window.ts#L58)

分位数，1ms 精度。落在溢出桶时返回实测 max，**不谎报成 255**。

##### p95Ms

> `readonly` **p95Ms**: `number`

Defined in: [packages/core/src/perf/perf-window.ts:59](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/perf/perf-window.ts#L59)

##### p99Ms

> `readonly` **p99Ms**: `number`

Defined in: [packages/core/src/perf/perf-window.ts:60](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/perf/perf-window.ts#L60)

##### peaks

> `readonly` **peaks**: `Readonly`\<`Record`\<`string`, `number`\>\>

Defined in: [packages/core/src/perf/perf-window.ts:66](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/perf/perf-window.ts#L66)

取最大值的量：内存峰值。

##### spans

> `readonly` **spans**: `Readonly`\<`Record`\<`string`, [`SpanStat`](perf.md#spanstat)\>\>

Defined in: [packages/core/src/perf/perf-window.ts:64](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/perf/perf-window.ts#L64)

##### stalls

> `readonly` **stalls**: readonly [`StallBucket`](perf.md#stallbucket)[]

Defined in: [packages/core/src/perf/perf-window.ts:63](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/perf/perf-window.ts#L63)

各档卡顿。**分位数量的是稳态帧率，卡顿只在这里。**

##### tag

> `readonly` **tag**: `string`

Defined in: [packages/core/src/perf/perf-window.ts:53](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/perf/perf-window.ts#L53)

段标签，由 `mark()` 打。`''` = 还没打过标签。

***

### PerfWindowOptions

Defined in: [packages/core/src/perf/perf-window.ts:71](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/perf/perf-window.ts#L71)

#### Properties

##### maxPending?

> `readonly` `optional` **maxPending**: `number`

Defined in: [packages/core/src/perf/perf-window.ts:81](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/perf/perf-window.ts#L81)

未被取走的报告上限，默认 8。满了丢**最老的**并计数 ——
上报方挂了不能把内存吃穿，而丢了几份要让数据自己说（`drain()` 的 `dropped`）。

##### stallThresholdsMs?

> `readonly` `optional` **stallThresholdsMs**: readonly `number`[]

Defined in: [packages/core/src/perf/perf-window.ts:76](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/perf/perf-window.ts#L76)

卡顿阈值（ms），可多档。**门槛是策略、归项目**，kit 只给个能跑的默认 `[100, 200]`。
空数组 = 完全不统计卡顿。传入顺序不限，内部按升序存。

***

### SpanStat

Defined in: [packages/core/src/perf/perf-window.ts:44](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/perf/perf-window.ts#L44)

一次性耗时事件的聚合（加载一个包、开一个界面）。

#### Properties

##### maxMs

> `readonly` **maxMs**: `number`

Defined in: [packages/core/src/perf/perf-window.ts:47](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/perf/perf-window.ts#L47)

##### n

> `readonly` **n**: `number`

Defined in: [packages/core/src/perf/perf-window.ts:45](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/perf/perf-window.ts#L45)

##### totalMs

> `readonly` **totalMs**: `number`

Defined in: [packages/core/src/perf/perf-window.ts:46](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/perf/perf-window.ts#L46)

***

### StallBucket

Defined in: [packages/core/src/perf/perf-window.ts:34](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/perf/perf-window.ts#L34)

一档卡顿阈值的统计。超出部分可精确反推：`totalMs - frames * thresholdMs`。

#### Properties

##### frames

> `readonly` **frames**: `number`

Defined in: [packages/core/src/perf/perf-window.ts:38](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/perf/perf-window.ts#L38)

超过该阈值的帧数。

##### thresholdMs

> `readonly` **thresholdMs**: `number`

Defined in: [packages/core/src/perf/perf-window.ts:36](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/perf/perf-window.ts#L36)

门槛（ms）。**严格大于**才算卡顿。

##### totalMs

> `readonly` **totalMs**: `number`

Defined in: [packages/core/src/perf/perf-window.ts:40](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/perf/perf-window.ts#L40)

这些帧的**总耗时**（不是超出部分）——「这段里有 530ms 花在卡顿帧上」，直接可读。

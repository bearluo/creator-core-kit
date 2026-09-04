[**@cck/core API**](README.md)

***

[@cck/core API](README.md) / crash

# crash

## Interfaces

### CrashEvent

Defined in: packages/core/src/crash/crash.ts:20

收敛并规整之后、可以过河的形状。

#### Properties

##### fingerprint

> `readonly` **fingerprint**: `string`

Defined in: packages/core/src/crash/crash.ts:27

指纹，供调试与单测断言；**不参与**上报载荷。

##### linenum

> `readonly` **linenum**: `number`

Defined in: packages/core/src/crash/crash.ts:23

##### location

> `readonly` **location**: `string`

Defined in: packages/core/src/crash/crash.ts:22

已截首行。

##### message

> `readonly` **message**: `string`

Defined in: packages/core/src/crash/crash.ts:24

##### stack

> `readonly` **stack**: `string`

Defined in: packages/core/src/crash/crash.ts:25

***

### CrashFilter

Defined in: packages/core/src/crash/crash.ts:30

#### Methods

##### accept()

> **accept**(`raw`): `null` \| [`CrashEvent`](crash.md#crashevent)

Defined in: packages/core/src/crash/crash.ts:32

规整 + 判定。返回 `null` = 这条不报（重复，或已达种类上限）。

###### Parameters

###### raw

[`RawCrash`](crash.md#rawcrash)

###### Returns

`null` \| [`CrashEvent`](crash.md#crashevent)

***

### RawCrash

Defined in: packages/core/src/crash/crash.ts:11

`globalThis.__errorHandler` 递过来的四段原始数据，未经处理。

#### Properties

##### linenum

> `readonly` **linenum**: `number`

Defined in: packages/core/src/crash/crash.ts:14

##### location

> `readonly` **location**: `string`

Defined in: packages/core/src/crash/crash.ts:13

⚠️ 引擎会把出错那行的源码连同等长空格附在后面，release 下单次可达约 100 KB。

##### message

> `readonly` **message**: `string`

Defined in: packages/core/src/crash/crash.ts:15

##### stack

> `readonly` **stack**: `string`

Defined in: packages/core/src/crash/crash.ts:16

## Functions

### crashPayload()

> **crashPayload**(`event`, `getContext`): `string`

Defined in: packages/core/src/crash/crash.ts:75

拼成过河的 JSON。各渠道的 `CckReport.report(String json)` 自己解、自己决定塞进哪家 API
——两家 SDK 能力不对称（Bugly 的 `stack` 吃任意字符串，Crashlytics 只能造 `Throwable`）。

#### Parameters

##### event

[`CrashEvent`](crash.md#crashevent)

##### getContext

() => `Record`\<`string`, `string`\>

上报**这一刻**现取的上下文。它自己抛不会打断上报，取不到就是空表——
                  少一块上下文远好过整条崩溃报不出去。

#### Returns

`string`

***

### createCrashFilter()

> **createCrashFilter**(`opts`?): [`CrashFilter`](crash.md#crashfilter)

Defined in: packages/core/src/crash/crash.ts:46

造一个收敛器。`opts.maxKinds` 是一次会话最多上报多少**种**不同指纹，默认 8。

#### Parameters

##### opts?

###### maxKinds?

`number`

#### Returns

[`CrashFilter`](crash.md#crashfilter)

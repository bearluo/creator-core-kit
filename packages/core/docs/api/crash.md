[**@cck/core API**](README.md)

***

[@cck/core API](README.md) / crash

# crash

## Interfaces

### CrashEvent

Defined in: [packages/core/src/crash/crash.ts:20](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/crash/crash.ts#L20)

收敛并规整之后、可以过河的形状。

#### Properties

##### fingerprint

> `readonly` **fingerprint**: `string`

Defined in: [packages/core/src/crash/crash.ts:27](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/crash/crash.ts#L27)

指纹，供调试与单测断言；**不参与**上报载荷。

##### linenum

> `readonly` **linenum**: `number`

Defined in: [packages/core/src/crash/crash.ts:23](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/crash/crash.ts#L23)

##### location

> `readonly` **location**: `string`

Defined in: [packages/core/src/crash/crash.ts:22](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/crash/crash.ts#L22)

已截首行。

##### message

> `readonly` **message**: `string`

Defined in: [packages/core/src/crash/crash.ts:24](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/crash/crash.ts#L24)

##### stack

> `readonly` **stack**: `string`

Defined in: [packages/core/src/crash/crash.ts:25](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/crash/crash.ts#L25)

***

### CrashFilter

Defined in: [packages/core/src/crash/crash.ts:30](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/crash/crash.ts#L30)

#### Methods

##### accept()

> **accept**(`raw`): `null` \| [`CrashEvent`](crash.md#crashevent)

Defined in: [packages/core/src/crash/crash.ts:32](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/crash/crash.ts#L32)

规整 + 判定。返回 `null` = 这条不报（重复，或已达种类上限）。

###### Parameters

###### raw

[`RawCrash`](crash.md#rawcrash)

###### Returns

`null` \| [`CrashEvent`](crash.md#crashevent)

***

### JsFrame

Defined in: [packages/core/src/crash/crash.ts:69](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/crash/crash.ts#L69)

一帧 JS 堆栈。Java 侧照着造 `StackTraceElement(fn, file, line)`。

#### Properties

##### file

> `readonly` **file**: `string`

Defined in: [packages/core/src/crash/crash.ts:72](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/crash/crash.ts#L72)

##### fn

> `readonly` **fn**: `string`

Defined in: [packages/core/src/crash/crash.ts:71](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/crash/crash.ts#L71)

函数名。匿名帧记 `<anonymous>`，因为 `StackTraceElement` 不吃 null。

##### line

> `readonly` **line**: `number`

Defined in: [packages/core/src/crash/crash.ts:73](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/crash/crash.ts#L73)

***

### RawCrash

Defined in: [packages/core/src/crash/crash.ts:11](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/crash/crash.ts#L11)

`globalThis.__errorHandler` 递过来的四段原始数据，未经处理。

#### Properties

##### linenum

> `readonly` **linenum**: `number`

Defined in: [packages/core/src/crash/crash.ts:14](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/crash/crash.ts#L14)

##### location

> `readonly` **location**: `string`

Defined in: [packages/core/src/crash/crash.ts:13](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/crash/crash.ts#L13)

⚠️ 引擎会把出错那行的源码连同等长空格附在后面，release 下单次可达约 100 KB。

##### message

> `readonly` **message**: `string`

Defined in: [packages/core/src/crash/crash.ts:15](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/crash/crash.ts#L15)

##### stack

> `readonly` **stack**: `string`

Defined in: [packages/core/src/crash/crash.ts:16](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/crash/crash.ts#L16)

## Functions

### crashContext()

> **crashContext**(`getContext`): `Record`\<`string`, `string`\>

Defined in: [packages/core/src/crash/crash.ts:112](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/crash/crash.ts#L112)

现取上下文。**它自己抛不算错**，退化成空表 —— 少一块上下文远好过整条崩溃报不出去
（真相源可能是登录态、bundle 表，崩溃发生时它们没就绪恰恰是常态）。

上报和初始化两处都要它，所以这个 try/catch 落在 core：engine 那半按 ADR-0002 薄到
没有分支，一个 `catch` 都不该有。

#### Parameters

##### getContext

() => `Record`\<`string`, `string`\>

#### Returns

`Record`\<`string`, `string`\>

***

### crashPayload()

> **crashPayload**(`event`, `getContext`): `string`

Defined in: [packages/core/src/crash/crash.ts:127](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/crash/crash.ts#L127)

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

Defined in: [packages/core/src/crash/crash.ts:46](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/crash/crash.ts#L46)

造一个收敛器。`opts.maxKinds` 是一次会话最多上报多少**种**不同指纹，默认 8。

#### Parameters

##### opts?

###### maxKinds?

`number`

#### Returns

[`CrashFilter`](crash.md#crashfilter)

***

### parseJsFrames()

> **parseJsFrames**(`stack`, `max`): [`JsFrame`](crash.md#jsframe)[]

Defined in: [packages/core/src/crash/crash.ts:94](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/crash/crash.ts#L94)

把 V8 的堆栈字符串拆成结构化帧。畸形行（`at [native code]`、空行）安静跳过。

它为 **Crashlytics** 而存在：Crashlytics 的 Android SDK **没有**「上报一段自定义堆栈文本」
的 API（iOS 的 `ExceptionModel` 在 Android 上没有对应物），只能造一个 `Throwable` 再
`setStackTrace(...)`。Bugly 那边不需要——它的 `postException` 直接吃字符串。

#### Parameters

##### stack

`string`

##### max

`number` = `DEFAULT_MAX_FRAMES`

#### Returns

[`JsFrame`](crash.md#jsframe)[]

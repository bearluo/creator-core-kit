[**@cck/core API**](README.md)

***

[@cck/core API](README.md) / logging

# logging

## Enumerations

### LogLevel

Defined in: [packages/core/src/logging/logger.ts:3](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/logging/logger.ts#L3)

#### Enumeration Members

##### Debug

> **Debug**: `0`

Defined in: [packages/core/src/logging/logger.ts:4](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/logging/logger.ts#L4)

##### Error

> **Error**: `3`

Defined in: [packages/core/src/logging/logger.ts:7](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/logging/logger.ts#L7)

##### Info

> **Info**: `1`

Defined in: [packages/core/src/logging/logger.ts:5](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/logging/logger.ts#L5)

##### Silent

> **Silent**: `4`

Defined in: [packages/core/src/logging/logger.ts:8](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/logging/logger.ts#L8)

##### Warn

> **Warn**: `2`

Defined in: [packages/core/src/logging/logger.ts:6](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/logging/logger.ts#L6)

## Interfaces

### ILogger

Defined in: [packages/core/src/logging/logger.ts:19](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/logging/logger.ts#L19)

#### Properties

##### level

> `readonly` **level**: [`LogLevel`](logging.md#loglevel)

Defined in: [packages/core/src/logging/logger.ts:21](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/logging/logger.ts#L21)

当前级别（严格低于此级别的调用被丢弃）。

#### Methods

##### child()

> **child**(`tag`): [`ILogger`](logging.md#ilogger)

Defined in: [packages/core/src/logging/logger.ts:29](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/logging/logger.ts#L29)

派生带标签子 logger：输出前缀 [tag]（多级叠加 [a][b]），共享级别与 sink。

###### Parameters

###### tag

`string`

###### Returns

[`ILogger`](logging.md#ilogger)

##### debug()

> **debug**(...`args`): `void`

Defined in: [packages/core/src/logging/logger.ts:24](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/logging/logger.ts#L24)

###### Parameters

###### args

...`unknown`[]

###### Returns

`void`

##### error()

> **error**(...`args`): `void`

Defined in: [packages/core/src/logging/logger.ts:27](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/logging/logger.ts#L27)

###### Parameters

###### args

...`unknown`[]

###### Returns

`void`

##### info()

> **info**(...`args`): `void`

Defined in: [packages/core/src/logging/logger.ts:25](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/logging/logger.ts#L25)

###### Parameters

###### args

...`unknown`[]

###### Returns

`void`

##### setLevel()

> **setLevel**(`level`): `void`

Defined in: [packages/core/src/logging/logger.ts:23](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/logging/logger.ts#L23)

运行时调级别；child 与 root 共享同一级别状态，一处生效。

###### Parameters

###### level

[`LogLevel`](logging.md#loglevel)

###### Returns

`void`

##### warn()

> **warn**(...`args`): `void`

Defined in: [packages/core/src/logging/logger.ts:26](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/logging/logger.ts#L26)

###### Parameters

###### args

...`unknown`[]

###### Returns

`void`

***

### LogSink

Defined in: [packages/core/src/logging/logger.ts:12](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/logging/logger.ts#L12)

输出目标抽象（console-like）。默认 = globalThis.console；测试注入 fake 可断言。

#### Methods

##### debug()

> **debug**(...`args`): `void`

Defined in: [packages/core/src/logging/logger.ts:13](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/logging/logger.ts#L13)

###### Parameters

###### args

...`unknown`[]

###### Returns

`void`

##### error()

> **error**(...`args`): `void`

Defined in: [packages/core/src/logging/logger.ts:16](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/logging/logger.ts#L16)

###### Parameters

###### args

...`unknown`[]

###### Returns

`void`

##### info()

> **info**(...`args`): `void`

Defined in: [packages/core/src/logging/logger.ts:14](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/logging/logger.ts#L14)

###### Parameters

###### args

...`unknown`[]

###### Returns

`void`

##### warn()

> **warn**(...`args`): `void`

Defined in: [packages/core/src/logging/logger.ts:15](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/logging/logger.ts#L15)

###### Parameters

###### args

...`unknown`[]

###### Returns

`void`

## Variables

### LOGGER

> `const` **LOGGER**: [`Token`](di.md#tokent)\<[`ILogger`](logging.md#ilogger)\>

Defined in: [packages/core/src/logging/logger.ts:114](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/logging/logger.ts#L114)

DI token：engine/项目可 register 覆盖默认实现（见 di-container）。

## Functions

### createConsoleLogger()

> **createConsoleLogger**(`opts`?): [`ILogger`](logging.md#ilogger)

Defined in: [packages/core/src/logging/logger.ts:102](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/logging/logger.ts#L102)

造 ConsoleLogger（零 cc）。level 默认 Info；sink 默认 globalThis.console。

#### Parameters

##### opts?

###### level?

[`LogLevel`](logging.md#loglevel)

###### sink?

[`LogSink`](logging.md#logsink)

###### tag?

`string`

#### Returns

[`ILogger`](logging.md#ilogger)

***

### getLogger()

> **getLogger**(`tag`?): [`ILogger`](logging.md#ilogger)

Defined in: [packages/core/src/logging/logger.ts:126](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/logging/logger.ts#L126)

便捷取用：优先 getRootContainer().tryResolve(LOGGER)；未注册则用进程级默认 ConsoleLogger
（不自动注册进容器）。传 tag → 返回其 child(tag)。engine register(LOGGER,…) 覆盖后自动切换。

#### Parameters

##### tag?

`string`

#### Returns

[`ILogger`](logging.md#ilogger)

[**@cck/core API**](README.md)

***

[@cck/core API](README.md) / bootstrap

# bootstrap

## Interfaces

### BootContext

Defined in: [packages/core/src/bootstrap/bootstrap.ts:14](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bootstrap/bootstrap.ts#L14)

传给各模块钩子的上下文：容器 + 一个供打日志的 logger。

#### Properties

##### container

> `readonly` **container**: [`Container`](di.md#container)

Defined in: [packages/core/src/bootstrap/bootstrap.ts:15](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bootstrap/bootstrap.ts#L15)

##### logger

> `readonly` **logger**: [`ILogger`](logging.md#ilogger)

Defined in: [packages/core/src/bootstrap/bootstrap.ts:16](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bootstrap/bootstrap.ts#L16)

***

### BootOptions

Defined in: [packages/core/src/bootstrap/bootstrap.ts:33](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bootstrap/bootstrap.ts#L33)

#### Properties

##### container?

> `optional` **container**: [`Container`](di.md#container)

Defined in: [packages/core/src/bootstrap/bootstrap.ts:35](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bootstrap/bootstrap.ts#L35)

目标容器，默认 getRootContainer()。

##### logger?

> `optional` **logger**: [`ILogger`](logging.md#ilogger)

Defined in: [packages/core/src/bootstrap/bootstrap.ts:39](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bootstrap/bootstrap.ts#L39)

编排期日志，默认 getLogger('Bootstrap')。

##### modules?

> `optional` **modules**: [`KitModule`](bootstrap.md#kitmodule)[]

Defined in: [packages/core/src/bootstrap/bootstrap.ts:37](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bootstrap/bootstrap.ts#L37)

待装配模块，默认 []。

***

### Kit

Defined in: [packages/core/src/bootstrap/bootstrap.ts:43](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bootstrap/bootstrap.ts#L43)

boot 的结果句柄，也注册进容器（KIT token），兼作「已启动」标记。

#### Properties

##### container

> `readonly` **container**: [`Container`](di.md#container)

Defined in: [packages/core/src/bootstrap/bootstrap.ts:44](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bootstrap/bootstrap.ts#L44)

##### modules

> `readonly` **modules**: readonly `string`[]

Defined in: [packages/core/src/bootstrap/bootstrap.ts:46](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bootstrap/bootstrap.ts#L46)

已启动模块名（拓扑序）。

##### started

> `readonly` **started**: `boolean`

Defined in: [packages/core/src/bootstrap/bootstrap.ts:47](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bootstrap/bootstrap.ts#L47)

#### Methods

##### shutdown()

> **shutdown**(): `Promise`\<`void`\>

Defined in: [packages/core/src/bootstrap/bootstrap.ts:49](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bootstrap/bootstrap.ts#L49)

逆序 stop 各模块（best-effort：单个失败仅告警不中断），并注销 KIT。幂等。

###### Returns

`Promise`\<`void`\>

***

### KitModule

Defined in: [packages/core/src/bootstrap/bootstrap.ts:24](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bootstrap/bootstrap.ts#L24)

一个可组合的启动模块（功能单元 / 一个 bundle 一个）。
生命周期：boot 时先对所有模块跑 install（注册服务），全部完成后再依次 start；
shutdown 时逆序跑 stop。三个钩子均可 async、可缺省。

#### Properties

##### deps?

> `readonly` `optional` **deps**: readonly `string`[]

Defined in: [packages/core/src/bootstrap/bootstrap.ts:27](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bootstrap/bootstrap.ts#L27)

依赖的模块名，用于拓扑排序（缺失依赖 / 成环 → 抛错）。

##### name

> `readonly` **name**: `string`

Defined in: [packages/core/src/bootstrap/bootstrap.ts:25](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bootstrap/bootstrap.ts#L25)

#### Methods

##### install()?

> `optional` **install**(`ctx`): `void` \| `Promise`\<`void`\>

Defined in: [packages/core/src/bootstrap/bootstrap.ts:28](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bootstrap/bootstrap.ts#L28)

###### Parameters

###### ctx

[`BootContext`](bootstrap.md#bootcontext)

###### Returns

`void` \| `Promise`\<`void`\>

##### start()?

> `optional` **start**(`ctx`): `void` \| `Promise`\<`void`\>

Defined in: [packages/core/src/bootstrap/bootstrap.ts:29](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bootstrap/bootstrap.ts#L29)

###### Parameters

###### ctx

[`BootContext`](bootstrap.md#bootcontext)

###### Returns

`void` \| `Promise`\<`void`\>

##### stop()?

> `optional` **stop**(`ctx`): `void` \| `Promise`\<`void`\>

Defined in: [packages/core/src/bootstrap/bootstrap.ts:30](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bootstrap/bootstrap.ts#L30)

###### Parameters

###### ctx

[`BootContext`](bootstrap.md#bootcontext)

###### Returns

`void` \| `Promise`\<`void`\>

## Variables

### KIT

> `const` **KIT**: [`Token`](di.md#tokent)\<[`Kit`](bootstrap.md#kit)\>

Defined in: [packages/core/src/bootstrap/bootstrap.ts:53](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bootstrap/bootstrap.ts#L53)

DI token：boot 成功后注册结果 Kit，兼作重复 boot 抛错的依据。

## Functions

### boot()

> **boot**(`opts`?): `Promise`\<[`Kit`](bootstrap.md#kit)\>

Defined in: [packages/core/src/bootstrap/bootstrap.ts:102](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bootstrap/bootstrap.ts#L102)

组合根入口。按拓扑序 install → start 全部模块，注册 KIT，返回句柄。
- 幂等保护：同一 container 已 boot（KIT 已注册）→ 抛错，需先 kit.shutdown()。
- 错误 fail-fast：任一 install/start 抛错 → logger.error 上报后，裹模块名抛出。

#### Parameters

##### opts?

[`BootOptions`](bootstrap.md#bootoptions)

#### Returns

`Promise`\<[`Kit`](bootstrap.md#kit)\>

***

### coreModule()

> **coreModule**(`opts`?): [`KitModule`](bootstrap.md#kitmodule)

Defined in: [packages/core/src/bootstrap/bootstrap.ts:164](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bootstrap/bootstrap.ts#L164)

内置模块：注册 EventBus + Timer 的纯实现（零 cc）。
- eventBus / timer 缺省则内部 createEventBus() / createTimer()；容器本层已注册则跳过（尊重覆盖）。
- timer 实例由**调用方持有**以拿到 driver（ITimerDriver.tick）：engine 接 cc.director，测试手动 tick。

#### Parameters

##### opts?

###### eventBus?

[`IEventBus`](eventbus.md#ieventbuse)\<[`EventMap`](eventbus.md#eventmap)\>

###### timer?

[`ITimer`](timer.md#itimer) & [`ITimerDriver`](timer.md#itimerdriver)

#### Returns

[`KitModule`](bootstrap.md#kitmodule)

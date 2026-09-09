[**@cck/core API**](README.md)

***

[@cck/core API](README.md) / tier

# tier

## Interfaces

### DeviceTier

Defined in: packages/core/src/tier/device-tier.ts:61

#### Extended by

- [`DeviceTierHandle`](tier.md#devicetierhandle)

#### Properties

##### serverOutcome

> `readonly` **serverOutcome**: [`ServerOutcome`](tier.md#serveroutcome-2)

Defined in: packages/core/src/tier/device-tier.ts:67

服务器那一趟的结局，只喂埋点。判档没跑过是 `'skipped'`。

##### source

> `readonly` **source**: `string`

Defined in: packages/core/src/tier/device-tier.ts:65

档位来源。埋点读它。

##### tier

> `readonly` **tier**: `string`

Defined in: packages/core/src/tier/device-tier.ts:63

本次会话的档位。[resolveAtStartup](tier.md#resolveatstartup) 跑完之前是 `'default'`。**会话内不变。**

#### Methods

##### resolveAtStartup()

> **resolveAtStartup**(): `Promise`\<`void`\>

Defined in: packages/core/src/tier/device-tier.ts:74

判档。由启动序列的 `tier` 步调用一次；**并发 / 重复调用返回同一个 promise**，会话内只判一次。

顺序：玩家自选 → 缓存 → 本地打分（先拿一个能立刻用的）→ 同时发 `fetchTier` 与短超时赛跑
→ 赶上了用服务器的、没赶上就走 → **无论如何把结果写缓存给下次用** → 不重试。

###### Returns

`Promise`\<`void`\>

##### setPreferred()

> **setPreferred**(`tier`): `Promise`\<`void`\>

Defined in: packages/core/src/tier/device-tier.ts:81

记下玩家在画质设置里选的档位（`undefined` = 清除，回到自动判定）。

**下次启动生效** —— 它不动本次会话的 tier，那是本模块的不变式。
项目在设置界面里改完画质，要提示用户「下次启动生效」。

###### Parameters

###### tier

`undefined` | `string`

###### Returns

`Promise`\<`void`\>

***

### DeviceTierHandle

Defined in: packages/core/src/tier/device-tier.ts:120

`createDeviceTier` 的返回值。比 [DeviceTier](tier.md#devicetier) 多一个 `dispose` ——
给 `KitModule.stop` 用，**不是公开 API**：容器里注册的 token 类型是 `DeviceTier`，
拿不到它，所以业务代码没法把在途的判档掐掉。

#### Extends

- [`DeviceTier`](tier.md#devicetier)

#### Properties

##### serverOutcome

> `readonly` **serverOutcome**: [`ServerOutcome`](tier.md#serveroutcome-2)

Defined in: packages/core/src/tier/device-tier.ts:67

服务器那一趟的结局，只喂埋点。判档没跑过是 `'skipped'`。

###### Inherited from

[`DeviceTier`](tier.md#devicetier).[`serverOutcome`](tier.md#serveroutcome)

##### source

> `readonly` **source**: `string`

Defined in: packages/core/src/tier/device-tier.ts:65

档位来源。埋点读它。

###### Inherited from

[`DeviceTier`](tier.md#devicetier).[`source`](tier.md#source)

##### tier

> `readonly` **tier**: `string`

Defined in: packages/core/src/tier/device-tier.ts:63

本次会话的档位。[resolveAtStartup](tier.md#resolveatstartup) 跑完之前是 `'default'`。**会话内不变。**

###### Inherited from

[`DeviceTier`](tier.md#devicetier).[`tier`](tier.md#tier)

#### Methods

##### dispose()

> **dispose**(): `void`

Defined in: packages/core/src/tier/device-tier.ts:122

让在途的 `await` 回来后安静收摊（不改状态、不写缓存）。

###### Returns

`void`

##### resolveAtStartup()

> **resolveAtStartup**(): `Promise`\<`void`\>

Defined in: packages/core/src/tier/device-tier.ts:74

判档。由启动序列的 `tier` 步调用一次；**并发 / 重复调用返回同一个 promise**，会话内只判一次。

顺序：玩家自选 → 缓存 → 本地打分（先拿一个能立刻用的）→ 同时发 `fetchTier` 与短超时赛跑
→ 赶上了用服务器的、没赶上就走 → **无论如何把结果写缓存给下次用** → 不重试。

###### Returns

`Promise`\<`void`\>

###### Inherited from

[`DeviceTier`](tier.md#devicetier).[`resolveAtStartup`](tier.md#resolveatstartup)

##### setPreferred()

> **setPreferred**(`tier`): `Promise`\<`void`\>

Defined in: packages/core/src/tier/device-tier.ts:81

记下玩家在画质设置里选的档位（`undefined` = 清除，回到自动判定）。

**下次启动生效** —— 它不动本次会话的 tier，那是本模块的不变式。
项目在设置界面里改完画质，要提示用户「下次启动生效」。

###### Parameters

###### tier

`undefined` | `string`

###### Returns

`Promise`\<`void`\>

###### Inherited from

[`DeviceTier`](tier.md#devicetier).[`setPreferred`](tier.md#setpreferred)

***

### DeviceTierOptions

Defined in: packages/core/src/tier/device-tier.ts:84

#### Properties

##### budgetMs?

> `readonly` `optional` **budgetMs**: `number`

Defined in: packages/core/src/tier/device-tier.ts:90

等服务器的预算（ms），默认 1500。超时就走，**不重试**。

##### fetchTier?

> `readonly` `optional` **fetchTier**: [`FetchTier`](tier.md#fetchtier-1)

Defined in: packages/core/src/tier/device-tier.ts:88

##### logger?

> `readonly` `optional` **logger**: [`ILogger`](logging.md#ilogger)

Defined in: packages/core/src/tier/device-tier.ts:93

##### profile?

> `readonly` `optional` **profile**: [`DeviceProfile`](device.md#deviceprofile)

Defined in: packages/core/src/tier/device-tier.ts:86

设备画像。默认取 DI 的 `DEVICE_PROFILE`（由 engine 的 `deviceProfileModule` 注册）。

##### save?

> `readonly` `optional` **save**: [`SaveManager`](save.md#savemanager)

Defined in: packages/core/src/tier/device-tier.ts:92

档位缓存落在哪。默认 `getSaveManager()`。

##### scoreTier?

> `readonly` `optional` **scoreTier**: [`ScoreTier`](tier.md#scoretier-1)

Defined in: packages/core/src/tier/device-tier.ts:87

***

### TierVerdict

Defined in: packages/core/src/tier/device-tier.ts:25

服务器（或本地）给出的档位结论。

#### Properties

##### source

> `readonly` **source**: `string`

Defined in: packages/core/src/tier/device-tier.ts:29

来源标记，开放 string。埋点读它。

##### tier

> `readonly` **tier**: `string`

Defined in: packages/core/src/tier/device-tier.ts:27

档位标签。**不透明 string**，kit 不知道有哪几档。

## Type Aliases

### FetchTier()

> **FetchTier**: (`profile`) => `Promise`\<[`TierVerdict`](tier.md#tierverdict) \| `"none"`\>

Defined in: packages/core/src/tier/device-tier.ts:42

服务器权威档位。**由项目实现** —— 端点、协议、字段名 kit 一概不认识
（判据：`dispatcher` 的响应能进 kit 是因为它跨框架，档位的不跨，它里面还带资源清单）。

`'none'` = 服务器明说没有结论；reject = 网络挂了 / 接口失败。
两者在启动路径上行为相同，差别只进埋点。

#### Parameters

##### profile

[`DeviceProfile`](device.md#deviceprofile)

#### Returns

`Promise`\<[`TierVerdict`](tier.md#tierverdict) \| `"none"`\>

***

### ScoreTier()

> **ScoreTier**: (`profile`) => `string`

Defined in: packages/core/src/tier/device-tier.ts:33

本地兜底打分。**由项目实现**，kit 不出默认。

#### Parameters

##### profile

[`DeviceProfile`](device.md#deviceprofile)

#### Returns

`string`

***

### ServerOutcome

> **ServerOutcome**: `"ok"` \| `"none"` \| `"timeout"` \| `"error"` \| `"skipped"`

Defined in: packages/core/src/tier/device-tier.ts:45

服务器这一趟的结局。只喂埋点 —— 一个是覆盖率问题，一个是可用性问题。

## Variables

### DEVICE\_TIER

> `const` **DEVICE\_TIER**: [`Token`](di.md#tokent)\<[`DeviceTier`](tier.md#devicetier)\>

Defined in: packages/core/src/tier/device-tier.ts:96

***

### TIER\_DEFAULT

> `const` **TIER\_DEFAULT**: `"default"` = `'default'`

Defined in: packages/core/src/tier/device-tier.ts:47

***

### TIER\_SOURCE

> `const` **TIER\_SOURCE**: `object`

Defined in: packages/core/src/tier/device-tier.ts:50

[DeviceTier.source](tier.md#source) 的几个 kit 自己会产出的值。项目的 `fetchTier` 可以给别的。

#### Type declaration

##### cache

> `readonly` **cache**: `"cache"` = `'cache'`

上次生效的档位缓存。

##### default

> `readonly` **default**: `"default"` = `TIER_DEFAULT`

什么都没有 —— 没注册模块 / 没传任何取值函数。

##### local

> `readonly` **local**: `"local"` = `'local'`

本地打分。

##### player

> `readonly` **player**: `"player"` = `'player'`

玩家在画质设置里自己选的（下次启动生效）。

## Functions

### createDeviceTier()

> **createDeviceTier**(`opts`): [`DeviceTierHandle`](tier.md#devicetierhandle)

Defined in: packages/core/src/tier/device-tier.ts:125

#### Parameters

##### opts

[`DeviceTierOptions`](tier.md#devicetieroptions) = `{}`

#### Returns

[`DeviceTierHandle`](tier.md#devicetierhandle)

***

### deviceTierModule()

> **deviceTierModule**(`opts`): [`KitModule`](bootstrap.md#kitmodule)

Defined in: packages/core/src/tier/device-tier.ts:263

`KitModule`。**声明 `deps: ['device-profile']` 不只是 fail-fast，是排序的正确性前提** ——
`install()` 里就要把画像捞出来（没有画像就打不了分，没有合理的缺省可退），
拓扑排序保证画像模块先装。项目漏注册，`boot()` 当场抛「depends on missing module」，
而不是等到判档那一步在预算赛跑里静默失败。

#### Parameters

##### opts

[`DeviceTierOptions`](tier.md#devicetieroptions) = `{}`

#### Returns

[`KitModule`](bootstrap.md#kitmodule)

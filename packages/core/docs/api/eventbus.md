[**@cck/core API**](README.md)

***

[@cck/core API](README.md) / eventbus

# eventbus

## Interfaces

### EventMap

Defined in: [packages/core/src/eventbus/eventbus.ts:12](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/eventbus/eventbus.ts#L12)

全局事件表：key = 事件名（'namespace:event' 过去时），value = payload 类型（无载荷用 void）。
默认空 → 项目用 declaration merging 往本接口合并自己的全局事件：
  declare module '@cck/core' { interface EventMap { 'player:died': { score: number } } }
不设 index signature——否则 keyof 退化为 string、payload 退化为 unknown，丧失编译期精确校验。
模块私有事件用 createEventBus<具体接口>()，类型闭合不污染全局。

***

### IEventBus\<E\>

Defined in: [packages/core/src/eventbus/eventbus.ts:24](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/eventbus/eventbus.ts#L24)

#### Type Parameters

• **E** *extends* [`EventMap`](eventbus.md#eventmap) = [`EventMap`](eventbus.md#eventmap)

#### Methods

##### clear()

> **clear**\<`K`\>(`key`?): `void`

Defined in: [packages/core/src/eventbus/eventbus.ts:50](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/eventbus/eventbus.ts#L50)

清空指定事件的全部订阅；不传 key 时清空所有事件 + onAny（测试隔离 / 场景切换重置）。

###### Type Parameters

• **K** *extends* `string` \| `number` \| `symbol`

###### Parameters

###### key?

`K`

###### Returns

`void`

##### emit()

> **emit**\<`K`\>(`key`, ...`args`): `void`

Defined in: [packages/core/src/eventbus/eventbus.ts:42](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/eventbus/eventbus.ts#L42)

同步派发 key：按订阅顺序（FIFO）依次调用当前订阅快照。
派发期间的 on/off 只影响下一次 emit（重入安全）。void 事件可省 payload：emit('ui:ready')。
某 listener 抛异常被隔离（经 onError 上报）并继续派发其余。

###### Type Parameters

• **K** *extends* `string` \| `number` \| `symbol`

###### Parameters

###### key

`K`

###### args

...`E`\[`K`\] *extends* `void` ? \[\] : \[`E`\[`K`\]\]

###### Returns

`void`

##### has()

> **has**\<`K`\>(`key`): `boolean`

Defined in: [packages/core/src/eventbus/eventbus.ts:44](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/eventbus/eventbus.ts#L44)

是否存在至少一个订阅。

###### Type Parameters

• **K** *extends* `string` \| `number` \| `symbol`

###### Parameters

###### key

`K`

###### Returns

`boolean`

##### listenerCount()

> **listenerCount**\<`K`\>(`key`): `number`

Defined in: [packages/core/src/eventbus/eventbus.ts:46](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/eventbus/eventbus.ts#L46)

指定事件当前订阅数。

###### Type Parameters

• **K** *extends* `string` \| `number` \| `symbol`

###### Parameters

###### key

`K`

###### Returns

`number`

##### off()

> **off**\<`K`\>(`key`, `handler`, `target`?): `void`

Defined in: [packages/core/src/eventbus/eventbus.ts:34](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/eventbus/eventbus.ts#L34)

退订指定 (key, handler[, target])。未订阅时空操作，不报错。

###### Type Parameters

• **K** *extends* `string` \| `number` \| `symbol`

###### Parameters

###### key

`K`

###### handler

(`payload`) => `void`

###### target?

`object`

###### Returns

`void`

##### offAll()

> **offAll**(`target`): `void`

Defined in: [packages/core/src/eventbus/eventbus.ts:36](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/eventbus/eventbus.ts#L36)

退订 target（on 时传的对象）在所有事件上的全部订阅。用于组件 onDestroy 一行清理。

###### Parameters

###### target

`object`

###### Returns

`void`

##### on()

> **on**\<`K`\>(`key`, `handler`, `opts`?): [`Disposer`](eventbus.md#disposer)

Defined in: [packages/core/src/eventbus/eventbus.ts:26](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/eventbus/eventbus.ts#L26)

订阅 key。返回 disposer（调用即退订）。同一 (key, handler, target) 重复订阅幂等（去重，不重复触发）。

###### Type Parameters

• **K** *extends* `string` \| `number` \| `symbol`

###### Parameters

###### key

`K`

###### handler

(`payload`) => `void`

###### opts?

[`OnOptions`](eventbus.md#onoptions)

###### Returns

[`Disposer`](eventbus.md#disposer)

##### onAny()

> **onAny**(`handler`): [`Disposer`](eventbus.md#disposer)

Defined in: [packages/core/src/eventbus/eventbus.ts:48](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/eventbus/eventbus.ts#L48)

旁路监听全部事件（调试面板 / 埋点）。常规业务用 on()。返回 disposer。

###### Parameters

###### handler

(`key`, `payload`) => `void`

###### Returns

[`Disposer`](eventbus.md#disposer)

##### once()

> **once**\<`K`\>(`key`, `handler`, `opts`?): [`Disposer`](eventbus.md#disposer)

Defined in: [packages/core/src/eventbus/eventbus.ts:28](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/eventbus/eventbus.ts#L28)

语法糖：on(key, handler, { once: true, ...opts })。触发一次后自动退订。

###### Type Parameters

• **K** *extends* `string` \| `number` \| `symbol`

###### Parameters

###### key

`K`

###### handler

(`payload`) => `void`

###### opts?

`Omit`\<[`OnOptions`](eventbus.md#onoptions), `"once"`\>

###### Returns

[`Disposer`](eventbus.md#disposer)

***

### OnOptions

Defined in: [packages/core/src/eventbus/eventbus.ts:17](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/eventbus/eventbus.ts#L17)

#### Properties

##### once?

> `optional` **once**: `boolean`

Defined in: [packages/core/src/eventbus/eventbus.ts:19](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/eventbus/eventbus.ts#L19)

true = 触发一次后自动退订（等价 once()）。

##### target?

> `optional` **target**: `object`

Defined in: [packages/core/src/eventbus/eventbus.ts:21](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/eventbus/eventbus.ts#L21)

this 绑定 + 归属标识：handler 以该对象为 this 调用，且可被 offAll(target) 整体退订。

## Type Aliases

### Disposer()

> **Disposer**: () => `void`

Defined in: [packages/core/src/eventbus/eventbus.ts:15](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/eventbus/eventbus.ts#L15)

退订句柄：调用即退订对应订阅；幂等（重复调用无副作用，且不误伤后续同 handler 的新订阅）。

#### Returns

`void`

## Variables

### EVENT\_BUS

> `const` **EVENT\_BUS**: [`Token`](di.md#tokent)\<[`IEventBus`](eventbus.md#ieventbuse)\>

Defined in: [packages/core/src/eventbus/eventbus.ts:201](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/eventbus/eventbus.ts#L201)

DI token：engine/项目可 register 覆盖全局总线实现（见 di-container）。

## Functions

### createEventBus()

> **createEventBus**\<`E`\>(`opts`?): [`IEventBus`](eventbus.md#ieventbuse)\<`E`\>

Defined in: [packages/core/src/eventbus/eventbus.ts:190](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/eventbus/eventbus.ts#L190)

造事件总线。onError 默认经 getLogger('EventBus').error 上报（错误隔离）。

#### Type Parameters

• **E** *extends* [`EventMap`](eventbus.md#eventmap) = [`EventMap`](eventbus.md#eventmap)

#### Parameters

##### opts?

###### onError?

(`err`, `key`) => `void`

#### Returns

[`IEventBus`](eventbus.md#ieventbuse)\<`E`\>

***

### getEventBus()

> **getEventBus**\<`E`\>(): [`IEventBus`](eventbus.md#ieventbuse)\<`E`\>

Defined in: [packages/core/src/eventbus/eventbus.ts:213](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/eventbus/eventbus.ts#L213)

便捷取用全局总线：优先 getRootContainer().tryResolve(EVENT_BUS)；未注册则用进程级默认实例
（不自动注册进容器，避免副作用）。泛型 E 仅做类型断言，运行时是同一个全局实例。

#### Type Parameters

• **E** *extends* [`EventMap`](eventbus.md#eventmap) = [`EventMap`](eventbus.md#eventmap)

#### Returns

[`IEventBus`](eventbus.md#ieventbuse)\<`E`\>

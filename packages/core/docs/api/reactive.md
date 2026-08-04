[**@cck/core API**](README.md)

***

[@cck/core API](README.md) / reactive

# reactive

## Interfaces

### ReadSignal\<T\>

Defined in: [packages/core/src/reactive/reactive.ts:13](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/reactive/reactive.ts#L13)

只读响应式值。读 .value 会在当前 effect 内建立依赖；peek() 读值但不建立依赖。

#### Extended by

- [`Signal`](reactive.md#signalt)

#### Type Parameters

• **T**

#### Properties

##### value

> `readonly` **value**: `T`

Defined in: [packages/core/src/reactive/reactive.ts:14](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/reactive/reactive.ts#L14)

#### Methods

##### peek()

> **peek**(): `T`

Defined in: [packages/core/src/reactive/reactive.ts:16](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/reactive/reactive.ts#L16)

读当前值但不订阅（effect 内只想取值、不想因它重跑时用）。

###### Returns

`T`

***

### Signal\<T\>

Defined in: [packages/core/src/reactive/reactive.ts:20](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/reactive/reactive.ts#L20)

可写响应式值。setter 用 Object.is 幂等——值未变不通知（天然挡双向绑定回环）。

#### Extends

- [`ReadSignal`](reactive.md#readsignalt)\<`T`\>

#### Type Parameters

• **T**

#### Properties

##### value

> **value**: `T`

Defined in: [packages/core/src/reactive/reactive.ts:21](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/reactive/reactive.ts#L21)

###### Overrides

[`ReadSignal`](reactive.md#readsignalt).[`value`](reactive.md#value)

#### Methods

##### peek()

> **peek**(): `T`

Defined in: [packages/core/src/reactive/reactive.ts:16](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/reactive/reactive.ts#L16)

读当前值但不订阅（effect 内只想取值、不想因它重跑时用）。

###### Returns

`T`

###### Inherited from

[`ReadSignal`](reactive.md#readsignalt).[`peek`](reactive.md#peek)

## Type Aliases

### Dispose()

> **Dispose**: () => `void`

Defined in: [packages/core/src/reactive/reactive.ts:10](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/reactive/reactive.ts#L10)

响应式原语：signal / computed / effect —— MVVM 数据绑定的 core 地基（纯 TS、零 cc）。
自动 getter 依赖追踪：跑 effect 时读到的 signal 自动成为其依赖，改值 → 依赖它的 effect 重跑。
语义仿 @preact/signals-core，命名对齐 Vue（.value）。设计见 docs/modules/reactive.md。

ponytail: 朴素同步 push，无 glitch-free 拓扑调度——菱形依赖至多一次冗余重算（UI 无害）。
升级路径：加 batch() 微任务 flush 去重，或整包 vendor @preact/signals-core（API 同构）。

#### Returns

`void`

## Functions

### computed()

> **computed**\<`T`\>(`getter`): [`ReadSignal`](reactive.md#readsignalt)\<`T`\>

Defined in: [packages/core/src/reactive/reactive.ts:161](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/reactive/reactive.ts#L161)

惰性 + 缓存的派生值：只在被读时求值，依赖变才失效重算；无人读则不算。

#### Type Parameters

• **T**

#### Parameters

##### getter

() => `T`

#### Returns

[`ReadSignal`](reactive.md#readsignalt)\<`T`\>

***

### effect()

> **effect**(`fn`): [`Dispose`](reactive.md#dispose)

Defined in: [packages/core/src/reactive/reactive.ts:170](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/reactive/reactive.ts#L170)

副作用：立即同步跑一次并收集依赖；此后任一依赖变化即重跑。
fn 可返回清理函数，在「下次重跑前」和「dispose 时」被调用（如反注册 cc 事件）。
返回 dispose：退订全部依赖 + 跑最后一次清理（幂等）。

#### Parameters

##### fn

() => `void` \| [`Dispose`](reactive.md#dispose)

#### Returns

[`Dispose`](reactive.md#dispose)

***

### signal()

> **signal**\<`T`\>(`initial`): [`Signal`](reactive.md#signalt)\<`T`\>

Defined in: [packages/core/src/reactive/reactive.ts:156](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/reactive/reactive.ts#L156)

造一个可写 signal。

#### Type Parameters

• **T**

#### Parameters

##### initial

`T`

#### Returns

[`Signal`](reactive.md#signalt)\<`T`\>

***

### untracked()

> **untracked**\<`T`\>(`fn`): `T`

Defined in: [packages/core/src/reactive/reactive.ts:176](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/reactive/reactive.ts#L176)

读值时不建立任何依赖（effect 内「看一眼别的 signal 但不想被它触发」时用）。

#### Type Parameters

• **T**

#### Parameters

##### fn

() => `T`

#### Returns

`T`

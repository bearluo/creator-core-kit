[**@cck/core API**](README.md)

***

[@cck/core API](README.md) / di

# di

## Interfaces

### Container

Defined in: [packages/core/src/di/container.ts:18](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/di/container.ts#L18)

层级作用域 DI 容器。

#### Properties

##### name

> `readonly` **name**: `string`

Defined in: [packages/core/src/di/container.ts:19](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/di/container.ts#L19)

##### parent

> `readonly` **parent**: `null` \| [`Container`](di.md#container)

Defined in: [packages/core/src/di/container.ts:20](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/di/container.ts#L20)

#### Methods

##### createScope()

> **createScope**(`name`?): [`Container`](di.md#container)

Defined in: [packages/core/src/di/container.ts:35](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/di/container.ts#L35)

建子作用域（parent=this）。

###### Parameters

###### name?

`string`

###### Returns

[`Container`](di.md#container)

##### dispose()

> **dispose**(): `void`

Defined in: [packages/core/src/di/container.ts:37](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/di/container.ts#L37)

释放本作用域：级联子作用域 → dispose 本层 Disposable → 清表 → 从 parent 摘除。根不可 dispose。

###### Returns

`void`

##### has()

> **has**\<`T`\>(`token`): `boolean`

Defined in: [packages/core/src/di/container.ts:29](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/di/container.ts#L29)

沿链存在性检查。

###### Type Parameters

• **T**

###### Parameters

###### token

[`Token`](di.md#tokent)\<`T`\>

###### Returns

`boolean`

##### hasLocal()

> **hasLocal**\<`T`\>(`token`): `boolean`

Defined in: [packages/core/src/di/container.ts:31](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/di/container.ts#L31)

只查本层。

###### Type Parameters

• **T**

###### Parameters

###### token

[`Token`](di.md#tokent)\<`T`\>

###### Returns

`boolean`

##### register()

> **register**\<`T`\>(`token`, `provider`, `opts`?): `void`

Defined in: [packages/core/src/di/container.ts:23](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/di/container.ts#L23)

注册到本层。默认重复注册抛错；allowOverride 显式覆盖并清旧缓存。

###### Type Parameters

• **T**

###### Parameters

###### token

[`Token`](di.md#tokent)\<`T`\>

###### provider

[`Provider`](di.md#providert)\<`T`\>

###### opts?

###### allowOverride?

`boolean`

###### Returns

`void`

##### resolve()

> **resolve**\<`T`\>(`token`): `T`

Defined in: [packages/core/src/di/container.ts:25](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/di/container.ts#L25)

解析：本层 → parent 链 → 根；全链 miss 抛错。

###### Type Parameters

• **T**

###### Parameters

###### token

[`Token`](di.md#tokent)\<`T`\>

###### Returns

`T`

##### tryResolve()

> **tryResolve**\<`T`\>(`token`): `undefined` \| `T`

Defined in: [packages/core/src/di/container.ts:27](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/di/container.ts#L27)

同 resolve，但全链 miss 返回 undefined。

###### Type Parameters

• **T**

###### Parameters

###### token

[`Token`](di.md#tokent)\<`T`\>

###### Returns

`undefined` \| `T`

##### unregister()

> **unregister**\<`T`\>(`token`): `void`

Defined in: [packages/core/src/di/container.ts:33](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/di/container.ts#L33)

注销本层注册（含清缓存）。

###### Type Parameters

• **T**

###### Parameters

###### token

[`Token`](di.md#tokent)\<`T`\>

###### Returns

`void`

***

### Disposable

Defined in: [packages/core/src/di/container.ts:13](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/di/container.ts#L13)

可选清理协议：dispose 作用域时自动调用本层注册服务的 dispose()。

#### Methods

##### dispose()

> **dispose**(): `void`

Defined in: [packages/core/src/di/container.ts:14](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/di/container.ts#L14)

###### Returns

`void`

***

### Token\<T\>

Defined in: [packages/core/src/di/token.ts:6](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/di/token.ts#L6)

类型安全 token。泛型 T 是 phantom（仅编译期携带类型），运行时只有 key/name。
key = Symbol.for(...)：同名 token 在任何 bundle 得到同一个 symbol，
即使 token 定义被复制进多个 bundle 也指向容器里同一条注册（见 ADR-0001）。

#### Type Parameters

• **T**

#### Properties

##### \_\_type\_\_?

> `readonly` `optional` **\_\_type\_\_**: `T`

Defined in: [packages/core/src/di/token.ts:10](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/di/token.ts#L10)

phantom：仅用于让 T 参与结构、令 resolve 推断出返回类型；运行时永远是 undefined。

##### key

> `readonly` **key**: `symbol`

Defined in: [packages/core/src/di/token.ts:7](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/di/token.ts#L7)

##### name

> `readonly` **name**: `string`

Defined in: [packages/core/src/di/token.ts:8](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/di/token.ts#L8)

## Type Aliases

### Lifetime

> **Lifetime**: `"singleton"` \| `"transient"` \| `"containerScoped"`

Defined in: [packages/core/src/di/container.ts:4](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/di/container.ts#L4)

服务生命周期。

***

### Provider\<T\>

> **Provider**\<`T`\>: \{ `useValue`: `T`; \} \| \{ `lifetime`: [`Lifetime`](di.md#lifetime); `useFactory`: (`c`) => `T`; \} \| \{ `useToken`: [`Token`](di.md#tokent)\<`T`\>; \}

Defined in: [packages/core/src/di/container.ts:7](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/di/container.ts#L7)

三种注册方式：常量 / 工厂（按生命周期）/ token 重定向（alias）。

#### Type Parameters

• **T**

## Variables

### cck

> `const` **cck**: `object`

Defined in: [packages/core/src/di/container.ts:200](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/di/container.ts#L200)

便捷门面（轻）：根容器 resolve/tryResolve 的糖。绝不缓存结果——每次走 resolve，防跨 bundle 分裂。

#### Type declaration

##### container

###### Get Signature

> **get** **container**(): [`Container`](di.md#container)

###### Returns

[`Container`](di.md#container)

##### resolve()

###### Type Parameters

• **T**

###### Parameters

###### token

[`Token`](di.md#tokent)\<`T`\>

###### Returns

`T`

##### tryResolve()

###### Type Parameters

• **T**

###### Parameters

###### token

[`Token`](di.md#tokent)\<`T`\>

###### Returns

`undefined` \| `T`

## Functions

### createToken()

> **createToken**\<`T`\>(`name`): [`Token`](di.md#tokent)\<`T`\>

Defined in: [packages/core/src/di/token.ts:16](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/di/token.ts#L16)

造 token。同名 name 跨 bundle key 一致（Symbol.for 全局注册表）。

#### Type Parameters

• **T**

#### Parameters

##### name

`string`

#### Returns

[`Token`](di.md#tokent)\<`T`\>

***

### getRootContainer()

> **getRootContainer**(): [`Container`](di.md#container)

Defined in: [packages/core/src/di/container.ts:189](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/di/container.ts#L189)

全局根容器（挂 globalThis[Symbol.for('cck.di.root')]，跨 bundle 唯一，首个初始化者胜出）。

#### Returns

[`Container`](di.md#container)

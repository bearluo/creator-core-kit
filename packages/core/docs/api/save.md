[**@cck/core API**](README.md)

***

[@cck/core API](README.md) / save

# save

## Interfaces

### IStorage

Defined in: [packages/core/src/save/storage.ts:8](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/save/storage.ts#L8)

存储接缝：异步 string→string KV。core 只认本接口（守零 cc 铁律）。
engine 注册 cc.sys.localStorage 适配；微信/抖音小游戏可接其异步 storage；测试/默认用内存实现。
异步是为兼容异步后端（wx 异步存储、IndexedDB、云存档）；同步后端包一层 Promise.resolve 即可。

#### Methods

##### get()

> **get**(`key`): `Promise`\<`null` \| `string`\>

Defined in: [packages/core/src/save/storage.ts:10](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/save/storage.ts#L10)

读取；键不存在返回 null。

###### Parameters

###### key

`string`

###### Returns

`Promise`\<`null` \| `string`\>

##### keys()

> **keys**(): `Promise`\<`string`[]\>

Defined in: [packages/core/src/save/storage.ts:16](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/save/storage.ts#L16)

返回当前全部 key（无序）。SaveManager 用它按命名空间前缀筛存档位。

###### Returns

`Promise`\<`string`[]\>

##### remove()

> **remove**(`key`): `Promise`\<`void`\>

Defined in: [packages/core/src/save/storage.ts:14](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/save/storage.ts#L14)

删除；键不存在为 no-op。

###### Parameters

###### key

`string`

###### Returns

`Promise`\<`void`\>

##### set()

> **set**(`key`, `value`): `Promise`\<`void`\>

Defined in: [packages/core/src/save/storage.ts:12](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/save/storage.ts#L12)

写入（覆盖）。

###### Parameters

###### key

`string`

###### value

`string`

###### Returns

`Promise`\<`void`\>

***

### SaveManager

Defined in: [packages/core/src/save/save-manager.ts:39](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/save/save-manager.ts#L39)

#### Properties

##### version

> `readonly` **version**: `number`

Defined in: [packages/core/src/save/save-manager.ts:41](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/save/save-manager.ts#L41)

当前数据版本。

#### Methods

##### delete()

> **delete**(`slot`): `Promise`\<`boolean`\>

Defined in: [packages/core/src/save/save-manager.ts:51](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/save/save-manager.ts#L51)

删除 slot。删掉 true；不存在 / 非法名 → false。

###### Parameters

###### slot

`string`

###### Returns

`Promise`\<`boolean`\>

##### has()

> **has**(`slot`): `Promise`\<`boolean`\>

Defined in: [packages/core/src/save/save-manager.ts:49](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/save/save-manager.ts#L49)

slot 是否存在。

###### Parameters

###### slot

`string`

###### Returns

`Promise`\<`boolean`\>

##### list()

> **list**(): `Promise`\<`string`[]\>

Defined in: [packages/core/src/save/save-manager.ts:53](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/save/save-manager.ts#L53)

列出全部 slot 名（升序）。

###### Returns

`Promise`\<`string`[]\>

##### load()

> **load**(`slot`): `Promise`\<`null` \| [`SaveData`](save.md#savedata)\>

Defined in: [packages/core/src/save/save-manager.ts:47](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/save/save-manager.ts#L47)

读回 slot。不存在 / 损坏 / 迁移失败 → null；合法地存了 {} → 返回 {}。

###### Parameters

###### slot

`string`

###### Returns

`Promise`\<`null` \| [`SaveData`](save.md#savedata)\>

##### registerMigration()

> **registerMigration**(`fromVersion`, `migrate`): `void`

Defined in: [packages/core/src/save/save-manager.ts:43](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/save/save-manager.ts#L43)

注册一步迁移 v(from)→v(from+1)。from 须 >=1；重复覆盖。

###### Parameters

###### fromVersion

`number`

###### migrate

[`Migration`](save.md#migration)

###### Returns

`void`

##### save()

> **save**(`slot`, `data`): `Promise`\<`boolean`\>

Defined in: [packages/core/src/save/save-manager.ts:45](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/save/save-manager.ts#L45)

写入 slot（覆盖）。成功 true；slot 非法 / 序列化失败 / 写入抛错 → false。

###### Parameters

###### slot

`string`

###### data

[`SaveData`](save.md#savedata)

###### Returns

`Promise`\<`boolean`\>

***

### SaveManagerOptions

Defined in: [packages/core/src/save/save-manager.ts:27](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/save/save-manager.ts#L27)

#### Properties

##### logger?

> `optional` **logger**: [`ILogger`](logging.md#ilogger)

Defined in: [packages/core/src/save/save-manager.ts:36](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/save/save-manager.ts#L36)

##### namespace?

> `optional` **namespace**: `string`

Defined in: [packages/core/src/save/save-manager.ts:33](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/save/save-manager.ts#L33)

key 前缀（命名空间），默认 'save'。存档位落 `<namespace>/<slot>`。

##### serializer?

> `optional` **serializer**: [`SaveSerializer`](save.md#saveserializer)

Defined in: [packages/core/src/save/save-manager.ts:31](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/save/save-manager.ts#L31)

序列化策略。默认 JSON。

##### storage?

> `optional` **storage**: [`IStorage`](save.md#istorage)

Defined in: [packages/core/src/save/save-manager.ts:29](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/save/save-manager.ts#L29)

存储后端。默认：DI STORAGE，未注册则新建进程内存实现。

##### version?

> `optional` **version**: `number`

Defined in: [packages/core/src/save/save-manager.ts:35](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/save/save-manager.ts#L35)

当前数据版本（save 盖此版本；load 时低于它的存档走迁移链）。须 >=1，默认 1。

***

### SaveSerializer

Defined in: [packages/core/src/save/save-manager.ts:9](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/save/save-manager.ts#L9)

序列化策略：对象 <-> 字符串。encode/decode 失败可抛，SaveManager 会捕获并按失败/损坏处理。

#### Properties

##### name

> `readonly` **name**: `string`

Defined in: [packages/core/src/save/save-manager.ts:10](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/save/save-manager.ts#L10)

#### Methods

##### decode()

> **decode**(`text`): `unknown`

Defined in: [packages/core/src/save/save-manager.ts:12](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/save/save-manager.ts#L12)

###### Parameters

###### text

`string`

###### Returns

`unknown`

##### encode()

> **encode**(`value`): `string`

Defined in: [packages/core/src/save/save-manager.ts:11](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/save/save-manager.ts#L11)

###### Parameters

###### value

`unknown`

###### Returns

`string`

## Type Aliases

### Migration()

> **Migration**: (`data`) => [`SaveData`](save.md#savedata)

Defined in: [packages/core/src/save/save-manager.ts:25](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/save/save-manager.ts#L25)

迁移函数：把 fromVersion 的 data 升级为 fromVersion+1 的 data 并返回。

#### Parameters

##### data

[`SaveData`](save.md#savedata)

#### Returns

[`SaveData`](save.md#savedata)

***

### SaveData

> **SaveData**: `Record`\<`string`, `unknown`\>

Defined in: [packages/core/src/save/save-manager.ts:6](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/save/save-manager.ts#L6)

存档数据：JSON 兼容的对象（键 string，值任意可序列化）。

## Variables

### SAVE\_MANAGER

> `const` **SAVE\_MANAGER**: [`Token`](di.md#tokent)\<[`SaveManager`](save.md#savemanager)\>

Defined in: [packages/core/src/save/save-manager.ts:195](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/save/save-manager.ts#L195)

DI token：项目可 register 自己的 SaveManager 覆盖默认（见 di-container）。

***

### STORAGE

> `const` **STORAGE**: [`Token`](di.md#tokent)\<[`IStorage`](save.md#istorage)\>

Defined in: [packages/core/src/save/storage.ts:20](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/save/storage.ts#L20)

DI token：engine Bootstrap register cc.sys.localStorage 适配；未注册时 SaveManager 回退内存实现。

## Functions

### createJsonSerializer()

> **createJsonSerializer**(): [`SaveSerializer`](save.md#saveserializer)

Defined in: [packages/core/src/save/save-manager.ts:16](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/save/save-manager.ts#L16)

默认 JSON 序列化器。

#### Returns

[`SaveSerializer`](save.md#saveserializer)

***

### createMemoryStorage()

> **createMemoryStorage**(`initial`?): [`IStorage`](save.md#istorage)

Defined in: [packages/core/src/save/storage.ts:23](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/save/storage.ts#L23)

进程内存 IStorage（Map 背书）。默认实现 + 测试用；非持久，进程退出即丢。

#### Parameters

##### initial?

`Record`\<`string`, `string`\>

#### Returns

[`IStorage`](save.md#istorage)

***

### createSaveManager()

> **createSaveManager**(`opts`?): [`SaveManager`](save.md#savemanager)

Defined in: [packages/core/src/save/save-manager.ts:74](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/save/save-manager.ts#L74)

造 SaveManager（纯逻辑、零 cc；存储/序列化经接缝注入）。

#### Parameters

##### opts?

[`SaveManagerOptions`](save.md#savemanageroptions)

#### Returns

[`SaveManager`](save.md#savemanager)

***

### getSaveManager()

> **getSaveManager**(): [`SaveManager`](save.md#savemanager)

Defined in: [packages/core/src/save/save-manager.ts:200](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/save/save-manager.ts#L200)

便捷取用：优先 getRootContainer().tryResolve(SAVE_MANAGER)；未注册则用进程级默认（内存/STORAGE 背书）。

#### Returns

[`SaveManager`](save.md#savemanager)

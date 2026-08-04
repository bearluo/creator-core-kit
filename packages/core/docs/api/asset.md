[**@cck/core API**](README.md)

***

[@cck/core API](README.md) / asset

# asset

## Interfaces

### AssetLoadOptions

Defined in: [packages/core/src/asset/asset-loader.ts:15](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/asset/asset-loader.ts#L15)

AssetLoader（IAssetLoader）—— 资源粒度加载/释放。引用计数 + 并发去重 + group 批量释放，
account 全在 core（纯逻辑可测），经异步 IAssetSource 接缝落到引擎。设计见 docs/modules/asset-manager.md。

#### Properties

##### bundle?

> `optional` **bundle**: `string`

Defined in: [packages/core/src/asset/asset-loader.ts:17](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/asset/asset-loader.ts#L17)

bundle name，缺省 'resources'（内置 bundle）。

##### group?

> `optional` **group**: `string`

Defined in: [packages/core/src/asset/asset-loader.ts:21](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/asset/asset-loader.ts#L21)

归组，供 releaseGroup 批量回收（scope 语义：整组强制拆除）。

##### onProgress()?

> `optional` **onProgress**: (`finished`, `total`) => `void`

Defined in: [packages/core/src/asset/asset-loader.ts:22](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/asset/asset-loader.ts#L22)

###### Parameters

###### finished

`number`

###### total

`number`

###### Returns

`void`

##### type?

> `optional` **type**: [`AssetTypeToken`](asset.md#assettypetoken)

Defined in: [packages/core/src/asset/asset-loader.ts:19](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/asset/asset-loader.ts#L19)

资源类型 token，缺省 'asset'（loadAny）。

***

### AssetSourceOptions

Defined in: [packages/core/src/asset/asset-source.ts:23](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/asset/asset-source.ts#L23)

引擎侧加载单个/目录资源的选项。

#### Properties

##### bundle?

> `optional` **bundle**: `string`

Defined in: [packages/core/src/asset/asset-source.ts:24](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/asset/asset-source.ts#L24)

##### onProgress()?

> `optional` **onProgress**: (`finished`, `total`) => `void`

Defined in: [packages/core/src/asset/asset-source.ts:26](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/asset/asset-source.ts#L26)

###### Parameters

###### finished

`number`

###### total

`number`

###### Returns

`void`

##### type?

> `optional` **type**: [`AssetTypeToken`](asset.md#assettypetoken)

Defined in: [packages/core/src/asset/asset-source.ts:25](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/asset/asset-source.ts#L25)

***

### DirAssetItem\<T\>

Defined in: [packages/core/src/asset/asset-source.ts:30](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/asset/asset-source.ts#L30)

loadDir 的一项：路径 + 资源值（core 需要各自 path 做引用计数键）。

#### Type Parameters

• **T** = `unknown`

#### Properties

##### asset

> **asset**: `T`

Defined in: [packages/core/src/asset/asset-source.ts:32](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/asset/asset-source.ts#L32)

##### path

> **path**: `string`

Defined in: [packages/core/src/asset/asset-source.ts:31](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/asset/asset-source.ts#L31)

***

### IAssetLoader

Defined in: [packages/core/src/asset/asset-loader.ts:25](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/asset/asset-loader.ts#L25)

#### Methods

##### get()

> **get**\<`T`\>(`path`, `opts`?): `undefined` \| `T`

Defined in: [packages/core/src/asset/asset-loader.ts:39](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/asset/asset-loader.ts#L39)

取已加载缓存（未加载/加载中→undefined）。

###### Type Parameters

• **T** = `unknown`

###### Parameters

###### path

`string`

###### opts?

###### bundle?

`string`

###### type?

[`AssetTypeToken`](asset.md#assettypetoken)

###### Returns

`undefined` \| `T`

##### load()

> **load**\<`T`\>(`path`, `opts`?): `Promise`\<`T`\>

Defined in: [packages/core/src/asset/asset-loader.ts:27](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/asset/asset-loader.ts#L27)

加载/引用一个资源；计数+1。已加载→命中缓存+计数；并发同键→共享 inflight；失败→reject（回滚）。

###### Type Parameters

• **T** = `unknown`

###### Parameters

###### path

`string`

###### opts?

[`AssetLoadOptions`](asset.md#assetloadoptions)

###### Returns

`Promise`\<`T`\>

##### loadDir()

> **loadDir**\<`T`\>(`dir`, `opts`?): `Promise`\<`T`[]\>

Defined in: [packages/core/src/asset/asset-loader.ts:29](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/asset/asset-loader.ts#L29)

加载一个目录下资源（每个子资源各自建条目、计数、并组）。

###### Type Parameters

• **T** = `unknown`

###### Parameters

###### dir

`string`

###### opts?

[`AssetLoadOptions`](asset.md#assetloadoptions)

###### Returns

`Promise`\<`T`[]\>

##### loadRemote()

> **loadRemote**\<`T`\>(`url`, `opts`?): `Promise`\<`T`\>

Defined in: [packages/core/src/asset/asset-loader.ts:33](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/asset/asset-loader.ts#L33)

远程散图/音/文本（不走 bundle）。

###### Type Parameters

• **T** = `unknown`

###### Parameters

###### url

`string`

###### opts?

`Omit`\<[`AssetLoadOptions`](asset.md#assetloadoptions), `"bundle"`\>

###### Returns

`Promise`\<`T`\>

##### preload()

> **preload**(`path`, `opts`?): `Promise`\<`void`\>

Defined in: [packages/core/src/asset/asset-loader.ts:31](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/asset/asset-loader.ts#L31)

预热（加载进缓存但不计业务引用，弱缓存）；后续 load 命中即转正、不重复加载。忽略 group。

###### Parameters

###### path

`string`

###### opts?

[`AssetLoadOptions`](asset.md#assetloadoptions)

###### Returns

`Promise`\<`void`\>

##### release()

> **release**(`path`, `opts`?): `void`

Defined in: [packages/core/src/asset/asset-loader.ts:35](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/asset/asset-loader.ts#L35)

解引用；计数归零→真释放并从所有 group 移除。未加载键→告警 no-op。

###### Parameters

###### path

`string`

###### opts?

###### bundle?

`string`

###### type?

[`AssetTypeToken`](asset.md#assettypetoken)

###### Returns

`void`

##### releaseGroup()

> **releaseGroup**(`group`): `void`

Defined in: [packages/core/src/asset/asset-loader.ts:37](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/asset/asset-loader.ts#L37)

批量释放：把该组内全部资源强制拆除（scope 语义，忽略各自 refCount）。

###### Parameters

###### group

`string`

###### Returns

`void`

***

### IAssetSource

Defined in: [packages/core/src/asset/asset-source.ts:40](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/asset/asset-source.ts#L40)

AssetLoader 的引擎 IO 接缝：只做原子「真加载一个 / 真加载目录 / 真加载远程 / 真释放一个」，零 cc。
engine 实现走 cc 的 bundle.load / bundle.loadDir / assetManager.loadRemote / addRef·decRef；
测试注入内存 fake。account（引用计数/去重/group）全在 AssetLoader（core），本接缝不管账。

#### Methods

##### loadDir()

> **loadDir**\<`T`\>(`dir`, `opts`?): `Promise`\<[`DirAssetItem`](asset.md#dirassetitemt)\<`T`\>[]\>

Defined in: [packages/core/src/asset/asset-source.ts:42](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/asset/asset-source.ts#L42)

###### Type Parameters

• **T** = `unknown`

###### Parameters

###### dir

`string`

###### opts?

[`AssetSourceOptions`](asset.md#assetsourceoptions)

###### Returns

`Promise`\<[`DirAssetItem`](asset.md#dirassetitemt)\<`T`\>[]\>

##### loadOne()

> **loadOne**\<`T`\>(`path`, `opts`?): `Promise`\<`T`\>

Defined in: [packages/core/src/asset/asset-source.ts:41](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/asset/asset-source.ts#L41)

###### Type Parameters

• **T** = `unknown`

###### Parameters

###### path

`string`

###### opts?

[`AssetSourceOptions`](asset.md#assetsourceoptions)

###### Returns

`Promise`\<`T`\>

##### loadRemote()

> **loadRemote**\<`T`\>(`url`, `opts`?): `Promise`\<`T`\>

Defined in: [packages/core/src/asset/asset-source.ts:43](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/asset/asset-source.ts#L43)

###### Type Parameters

• **T** = `unknown`

###### Parameters

###### url

`string`

###### opts?

###### type?

[`AssetTypeToken`](asset.md#assettypetoken)

###### Returns

`Promise`\<`T`\>

##### releaseOne()

> **releaseOne**(`path`, `opts`?): `void`

Defined in: [packages/core/src/asset/asset-source.ts:44](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/asset/asset-source.ts#L44)

###### Parameters

###### path

`string`

###### opts?

###### bundle?

`string`

###### type?

[`AssetTypeToken`](asset.md#assettypetoken)

###### Returns

`void`

## Type Aliases

### AssetTypeToken

> **AssetTypeToken**: `"asset"` \| `"prefab"` \| `"scene"` \| `"spriteFrame"` \| `"texture"` \| `"imageAsset"` \| `"audioClip"` \| `"json"` \| `"text"` \| `"material"` \| `"font"` \| `"animationClip"` \| `string` & `object`

Defined in: [packages/core/src/asset/asset-source.ts:7](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/asset/asset-source.ts#L7)

资源类型 token（core 零 cc）：engine 侧维护 token → cc Constructor<Asset> 映射。
'asset' = 通配（走 assetManager.loadAny，不指定类型）。字符串联合带逃逸口，engine 可扩展。

## Variables

### ASSET\_LOADER

> `const` **ASSET\_LOADER**: [`Token`](di.md#tokent)\<[`IAssetLoader`](asset.md#iassetloader)\>

Defined in: [packages/core/src/asset/asset-loader.ts:205](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/asset/asset-loader.ts#L205)

DI token：项目可 register 自己的 AssetLoader 覆盖默认。

***

### ASSET\_SOURCE

> `const` **ASSET\_SOURCE**: [`Token`](di.md#tokent)\<[`IAssetSource`](asset.md#iassetsource)\>

Defined in: [packages/core/src/asset/asset-source.ts:48](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/asset/asset-source.ts#L48)

DI token：engine 注册 cc 适配，createAssetLoader() 自动拾取。

## Functions

### createAssetLoader()

> **createAssetLoader**(`opts`?): [`IAssetLoader`](asset.md#iassetloader)

Defined in: [packages/core/src/asset/asset-loader.ts:60](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/asset/asset-loader.ts#L60)

造 AssetLoader（纯逻辑、零 cc；引擎 IO 经接缝注入）。

#### Parameters

##### opts?

###### logger?

[`ILogger`](logging.md#ilogger)

###### source?

[`IAssetSource`](asset.md#iassetsource)

#### Returns

[`IAssetLoader`](asset.md#iassetloader)

***

### createMemoryAssetSource()

> **createMemoryAssetSource**(`preset`?): [`IAssetSource`](asset.md#iassetsource)

Defined in: [packages/core/src/asset/asset-source.ts:54](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/asset/asset-source.ts#L54)

内存 fake（默认 / 测试）：按 path 返回预置资源，缺省合成一个稳定 stub（`{ __asset: path }`）。
releaseOne 无副作用（真释放交给引擎）。不含真 cc。

#### Parameters

##### preset?

###### assets?

`Record`\<`string`, `unknown`\>

#### Returns

[`IAssetSource`](asset.md#iassetsource)

***

### getAssetLoader()

> **getAssetLoader**(): [`IAssetLoader`](asset.md#iassetloader)

Defined in: [packages/core/src/asset/asset-loader.ts:210](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/asset/asset-loader.ts#L210)

便捷取用：优先 tryResolve(ASSET_LOADER)；未注册则进程级默认（ASSET_SOURCE/内存背书）。

#### Returns

[`IAssetLoader`](asset.md#iassetloader)

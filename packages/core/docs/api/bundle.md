[**@cck/core API**](README.md)

***

[@cck/core API](README.md) / bundle

# bundle

## Interfaces

### BundleGraph

Defined in: [packages/core/src/bundle/bundle-graph.ts:39](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bundle/bundle-graph.ts#L39)

#### Methods

##### has()

> **has**(`name`): `boolean`

Defined in: [packages/core/src/bundle/bundle-graph.ts:41](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bundle/bundle-graph.ts#L41)

这个包登记过没有。没登记 = 表外的包，`BundleManager` 按 strict 决定抛还是告警。

###### Parameters

###### name

`string`

###### Returns

`boolean`

##### layersFor()

> **layersFor**(`name`): readonly readonly `string`[][]

Defined in: [packages/core/src/bundle/bundle-graph.ts:50](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bundle/bundle-graph.ts#L50)

装 `name` 要按顺序装的层，**最后一层就是 `name` 自己**，层内彼此无依赖、可并行。
依赖成环（含自依赖）时抛 —— 表是人写的，环写得出来。

###### Parameters

###### name

`string`

###### Returns

readonly readonly `string`[][]

##### mayUse()

> **mayUse**(`user`, `target`): `boolean`

Defined in: [packages/core/src/bundle/bundle-graph.ts:52](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bundle/bundle-graph.ts#L52)

`user` 能不能碰 `target` 的资源：自己、常驻豁免包、或在依赖闭包里。

###### Parameters

###### user

`string`

###### target

`string`

###### Returns

`boolean`

##### names()

> **names**(): readonly `string`[]

Defined in: [packages/core/src/bundle/bundle-graph.ts:43](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bundle/bundle-graph.ts#L43)

登记过的包名（升序）。

###### Returns

readonly `string`[]

##### needsOf()

> **needsOf**(`name`): readonly `string`[]

Defined in: [packages/core/src/bundle/bundle-graph.ts:45](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bundle/bundle-graph.ts#L45)

直接依赖（resolver 已按当前状态求值，去重）。未登记的包返回空表。

###### Parameters

###### name

`string`

###### Returns

readonly `string`[]

***

### BundleGraphOptions

Defined in: [packages/core/src/bundle/bundle-graph.ts:55](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bundle/bundle-graph.ts#L55)

#### Properties

##### alwaysAllowed?

> `optional` **alwaysAllowed**: readonly `string`[]

Defined in: [packages/core/src/bundle/bundle-graph.ts:60](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bundle/bundle-graph.ts#L60)

谁都能碰、不用声明的常驻包。默认是 base 那几个（Creator 内置包）——
它们跟应用同寿命，且共享资源本来就只许经 `resources` 这一个仓。

##### logger?

> `optional` **logger**: [`ILogger`](logging.md#ilogger)

Defined in: [packages/core/src/bundle/bundle-graph.ts:61](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bundle/bundle-graph.ts#L61)

***

### BundleInfo

Defined in: [packages/core/src/bundle/bundle-manager.ts:21](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bundle/bundle-manager.ts#L21)

已加载 bundle 的快照信息。

#### Properties

##### name

> `readonly` **name**: `string`

Defined in: [packages/core/src/bundle/bundle-manager.ts:22](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bundle/bundle-manager.ts#L22)

##### refCount

> `readonly` **refCount**: `number`

Defined in: [packages/core/src/bundle/bundle-manager.ts:24](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bundle/bundle-manager.ts#L24)

##### version?

> `readonly` `optional` **version**: `string`

Defined in: [packages/core/src/bundle/bundle-manager.ts:23](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bundle/bundle-manager.ts#L23)

***

### BundleLoadOptions

Defined in: [packages/core/src/bundle/bundle-source.ts:8](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bundle/bundle-source.ts#L8)

BundleManager 的引擎 IO 接缝：只做「真加载 / 真释放 / 是否就绪」三原子操作，零 cc。
engine 实现走 cc.assetManager（loadBundle/getBundle/removeBundle）；测试注入内存 fake。
名义（name）由 BundleManager 统一决定并传入；url 仅远程加载时作 fetch 提示。

#### Properties

##### onProgress()?

> `optional` **onProgress**: (`finished`, `total`) => `void`

Defined in: [packages/core/src/bundle/bundle-source.ts:12](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bundle/bundle-source.ts#L12)

加载进度回调（finished/total）。

###### Parameters

###### finished

`number`

###### total

`number`

###### Returns

`void`

##### version?

> `optional` **version**: `string`

Defined in: [packages/core/src/bundle/bundle-source.ts:10](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bundle/bundle-source.ts#L10)

远程 bundle 版本（md5 前缀等）。

***

### BundleManager

Defined in: [packages/core/src/bundle/bundle-manager.ts:40](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bundle/bundle-manager.ts#L40)

#### Methods

##### get()

> **get**(`name`): `undefined` \| [`BundleHandle`](bundle.md#bundlehandle)

Defined in: [packages/core/src/bundle/bundle-manager.ts:52](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bundle/bundle-manager.ts#L52)

取已就绪句柄（加载中或未加载 → undefined）。

###### Parameters

###### name

`string`

###### Returns

`undefined` \| [`BundleHandle`](bundle.md#bundlehandle)

##### isLoaded()

> **isLoaded**(`name`): `boolean`

Defined in: [packages/core/src/bundle/bundle-manager.ts:50](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bundle/bundle-manager.ts#L50)

计数>0、非加载中、且引擎侧就绪。

###### Parameters

###### name

`string`

###### Returns

`boolean`

##### list()

> **list**(): [`BundleInfo`](bundle.md#bundleinfo)[]

Defined in: [packages/core/src/bundle/bundle-manager.ts:54](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bundle/bundle-manager.ts#L54)

已跟踪 bundle 快照（name 升序）。

###### Returns

[`BundleInfo`](bundle.md#bundleinfo)[]

##### load()

> **load**(`nameOrUrl`, `opts`?): `Promise`\<[`BundleHandle`](bundle.md#bundlehandle)\>

Defined in: [packages/core/src/bundle/bundle-manager.ts:46](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bundle/bundle-manager.ts#L46)

加载 / 引用一个 bundle。
- nameOrUrl：不带 opts.name 时是本地 bundle 名；带 opts.name 时 nameOrUrl 视为远程 url、以 name 注册。
- 已加载 → 计数+1 立即返回；并发同名 → 共享 inflight；失败 → reject（回滚、不留计数）。

###### Parameters

###### nameOrUrl

`string`

###### opts?

[`BundleLoadOptions`](bundle.md#bundleloadoptions) & `object`

###### Returns

`Promise`\<[`BundleHandle`](bundle.md#bundlehandle)\>

##### release()

> **release**(`name`): `void`

Defined in: [packages/core/src/bundle/bundle-manager.ts:48](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bundle/bundle-manager.ts#L48)

释放 / 解引用。计数−1，归零 → source.releaseBundle。未加载名 → 告警 no-op。

###### Parameters

###### name

`string`

###### Returns

`void`

##### setGraph()

> **setGraph**(`graph`, `opts`?): `void`

Defined in: [packages/core/src/bundle/bundle-manager.ts:74](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bundle/bundle-manager.ts#L74)

装上 bundle 依赖表 —— **依赖从此跟着装卸**：`load(A)` 先按拓扑层把 A 的 `needs` 装上
（层内并行）、每个各加一次引用，`release(A)` 对称地各减一次。复用现成的引用计数，
不引第二套生命周期。

`strict`（默认 true）：表外的包被 `load` 时抛。发布版传 `false` 降级成告警 ——
漏声明一条不该让玩家白屏，但开发期不抛就等于没有门。

表本身住在接入方的**地基包**里（它是跨模块契约、要能热更），而地基自己是被启动序列装上来的
—— 所以启动那一段（`AppConfig.shared`）仍由 App 管，本表接管的是**地基起来之后**的一切。

###### Parameters

###### graph

[`BundleGraph`](bundle.md#bundlegraph)

###### opts?

###### strict?

`boolean`

###### Returns

`void`

##### setVersions()

> **setVersions**(`map`): `void`

Defined in: [packages/core/src/bundle/bundle-manager.ts:62](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bundle/bundle-manager.ts#L62)

设置 bundle → 版本映射（web 出包的 md5）。**整体替换**，不是合并。
load 时 `opts.version` 优先，否则查此表。

放这里而不是上层 App：UIManager 打开界面时也会 load 它所属的 bundle，
版本表放上层就会漏掉那条路径。放这里则所有调用点零改自动带上版本。

###### Parameters

###### map

`Readonly`\<`Record`\<`string`, `string`\>\>

###### Returns

`void`

***

### BundleManagerOptions

Defined in: [packages/core/src/bundle/bundle-manager.ts:27](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bundle/bundle-manager.ts#L27)

#### Properties

##### logger?

> `optional` **logger**: [`ILogger`](logging.md#ilogger)

Defined in: [packages/core/src/bundle/bundle-manager.ts:37](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bundle/bundle-manager.ts#L37)

##### source?

> `optional` **source**: [`IBundleSource`](bundle.md#ibundlesource)

Defined in: [packages/core/src/bundle/bundle-manager.ts:29](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bundle/bundle-manager.ts#L29)

引擎 IO 后端。默认：DI BUNDLE_SOURCE，未注册则内存 fake。

##### updater?

> `optional` **updater**: [`BundleUpdater`](hotupdate.md#bundleupdater)

Defined in: [packages/core/src/bundle/bundle-manager.ts:36](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bundle/bundle-manager.ts#L36)

加载前的分包热更。默认：DI BUNDLE_UPDATER，未注册则不做（直接用包内版本）。

放这里而不是上层 App，理由同 [BundleManager.setVersions](bundle.md#setversions)：UIManager 打开界面时也会
load 它所属的 bundle，挂上层就会漏掉那条路径。

***

### BundleScope

Defined in: [packages/core/src/bundle/bundle-scope.ts:27](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bundle/bundle-scope.ts#L27)

BundleScope —— 一个 bundle 从加载到卸载，它注册的一切都可回收。

「bundle 没加载就不该有它的 i18n/配表；卸载 bundle 就连它们一起下掉。」难点：i18n/config 是把数据
**拷进 core 全局注册表**的，仅 release bundle 的 JSON 资源撤不掉已注册的表——必须显式反注册。
本 scope 让每次 load* 都登记一条对称回收，卸载只需一行 `dispose()`。

**这是免重启换 bundle 代码的正确性基础**：换版本后 cc 的类表被静默替换（同 uuid 后注册者胜出），
旧类的存活实例随即成为孤儿——`getComponent(新类)` 找不到它们，任何按类查找都会漏。所以
`dispose()` 的第一步必须是销毁本 bundle 的界面实例，晚一步就没有可靠手段找回它们了。

不对称之处：**load 由调用方做，release 由本 scope 做**。加载是启动/打开流程的一部分（要报进度、
处理失败、决定时机），回收则是一条不该让调用点复述的固定链路。

#### Properties

##### bundle

> `readonly` **bundle**: `string`

Defined in: [packages/core/src/bundle/bundle-scope.ts:28](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bundle/bundle-scope.ts#L28)

#### Methods

##### add()

> **add**(`teardown`): `void`

Defined in: [packages/core/src/bundle/bundle-scope.ts:39](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bundle/bundle-scope.ts#L39)

登记任意对称回收（DI 子作用域 dispose、事件解绑、BindingScope、定时器…）。

###### Parameters

###### teardown

() => `void` \| `Promise`\<`void`\>

###### Returns

`void`

##### dispose()

> **dispose**(): `Promise`\<`void`\>

Defined in: [packages/core/src/bundle/bundle-scope.ts:41](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bundle/bundle-scope.ts#L41)

回收全部（幂等，单条失败不阻断其余）。顺序见实现注释。

###### Returns

`Promise`\<`void`\>

##### i18n()

> **i18n**(`locale`, `path`): `Promise`\<`void`\>

Defined in: [packages/core/src/bundle/bundle-scope.ts:33](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bundle/bundle-scope.ts#L33)

加载本 bundle 的 i18n 翻译表并 addTable；dispose 时按**精确键** removeTable，
不误伤其它模块同 locale 的键。表须**扁平**且键带模块前缀（如 `{'shop.title':'商城'}`）。

###### Parameters

###### locale

`string`

###### path

`string`

###### Returns

`Promise`\<`void`\>

##### load()

> **load**\<`T`\>(`path`, `type`?): `Promise`\<`T`\>

Defined in: [packages/core/src/bundle/bundle-scope.ts:37](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bundle/bundle-scope.ts#L37)

从本 bundle 加载一个资源；dispose 时按同键 release。

###### Type Parameters

• **T**

###### Parameters

###### path

`string`

###### type?

[`AssetTypeToken`](asset.md#assettypetoken)

###### Returns

`Promise`\<`T`\>

##### table()

> **table**\<`T`\>(`name`, `path`, `tableOpts`?): `Promise`\<[`ConfigTable`](config.md#configtablet)\<`T`\>\>

Defined in: [packages/core/src/bundle/bundle-scope.ts:35](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bundle/bundle-scope.ts#L35)

加载本 bundle 的配表 JSON（行数组）→ register；dispose 时 unregister。

###### Type Parameters

• **T**

###### Parameters

###### name

`string`

###### path

`string`

###### tableOpts?

[`TableOptions`](config.md#tableoptionst)\<`T`\>

###### Returns

`Promise`\<[`ConfigTable`](config.md#configtablet)\<`T`\>\>

***

### BundleScopeDeps

Defined in: [packages/core/src/bundle/bundle-scope.ts:45](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bundle/bundle-scope.ts#L45)

依赖注入口（仅为可测；生产不传，各服务从全局取）。用 Pick 收窄到真正用到的方法。

#### Properties

##### assets?

> `optional` **assets**: `Pick`\<[`IAssetLoader`](asset.md#iassetloader), `"load"` \| `"release"`\>

Defined in: [packages/core/src/bundle/bundle-scope.ts:48](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bundle/bundle-scope.ts#L48)

##### bundles?

> `optional` **bundles**: `Pick`\<[`BundleManager`](bundle.md#bundlemanager), `"release"`\>

Defined in: [packages/core/src/bundle/bundle-scope.ts:47](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bundle/bundle-scope.ts#L47)

##### i18n?

> `optional` **i18n**: `Pick`\<[`I18n`](i18n.md#i18n), `"addTable"` \| `"removeTable"`\>

Defined in: [packages/core/src/bundle/bundle-scope.ts:49](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bundle/bundle-scope.ts#L49)

##### logger?

> `optional` **logger**: [`ILogger`](logging.md#ilogger)

Defined in: [packages/core/src/bundle/bundle-scope.ts:51](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bundle/bundle-scope.ts#L51)

##### tables?

> `optional` **tables**: `Pick`\<[`ConfigTableManager`](config.md#configtablemanager), `"register"` \| `"unregister"`\>

Defined in: [packages/core/src/bundle/bundle-scope.ts:50](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bundle/bundle-scope.ts#L50)

##### ui?

> `optional` **ui**: `Pick`\<[`UIManager`](ui.md#uimanager), `"closeByBundle"`\>

Defined in: [packages/core/src/bundle/bundle-scope.ts:46](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bundle/bundle-scope.ts#L46)

***

### BundleSpec

Defined in: [packages/core/src/bundle/bundle-graph.ts:33](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bundle/bundle-graph.ts#L33)

表里的一行。

#### Properties

##### name

> `readonly` **name**: `string`

Defined in: [packages/core/src/bundle/bundle-graph.ts:34](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bundle/bundle-graph.ts#L34)

##### needs?

> `readonly` `optional` **needs**: readonly [`BundleRef`](bundle.md#bundleref)[]

Defined in: [packages/core/src/bundle/bundle-graph.ts:36](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bundle/bundle-graph.ts#L36)

装它之前必须先装好的包，**也是它能碰的资源边界**。

***

### IBundleReloader

Defined in: [packages/core/src/bundle/bundle-reloader.ts:20](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bundle/bundle-reloader.ts#L20)

让「下一次 loadBundle 真的重新求值该 bundle 的脚本」——免重启换 bundle 代码的平台接缝。

换代码**不是**换资源：`releaseAll + removeBundle` 只把资源（prefab / json / 图集 / i18n）
放干净，脚本模块和已注册的 cc 类都还在缓存里，再进模块跑的仍是旧代码且**没有任何报错**。
让脚本失效必须模块缓存与类注册**一起**清，engine 侧实现负责这件事。

两条路径：
- **web（md5 换版）**：换版本 = 换 `index.<md5>.js` URL，engine 的 `IBundleSource.loadBundle`
  发现版本变了会**自动**清一次，调用方只需 [BundleManager.setVersions](bundle.md#setversions)，无须显式调本接口。
  ⚠️ 没勾 MD5 Cache 则文件名恒为 `index.js`，同 URL 同模块 id → 拿到的还是旧代码且无报错。
- **native（原地覆盖同名文件）**：路径与版本都看不出变化，自动路径识别不到 → 热更落盘后由调用方
  显式调一次 `invalidate(bundle)`。

⚠️ **别在版本没变时调**：web 的引擎按 URL 缓存已下载脚本，清了缓存那段代码就再也执行不到，
下次 load 会直接失败。native 无此限制。

#### Methods

##### invalidate()

> **invalidate**(`bundle`): `boolean`

Defined in: [packages/core/src/bundle/bundle-reloader.ts:22](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bundle/bundle-reloader.ts#L22)

返回是否真的清掉了该 bundle 的脚本缓存；`false` = 本平台/本时机做不到，调用方应转重启路径。

###### Parameters

###### bundle

`string`

###### Returns

`boolean`

***

### IBundleSource

Defined in: [packages/core/src/bundle/bundle-source.ts:15](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bundle/bundle-source.ts#L15)

#### Methods

##### hasBundle()

> **hasBundle**(`name`): `boolean`

Defined in: [packages/core/src/bundle/bundle-source.ts:21](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bundle/bundle-source.ts#L21)

引擎侧该 bundle 是否已就绪。

###### Parameters

###### name

`string`

###### Returns

`boolean`

##### loadBundle()

> **loadBundle**(`name`, `opts`?): `Promise`\<`void`\>

Defined in: [packages/core/src/bundle/bundle-source.ts:17](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bundle/bundle-source.ts#L17)

真加载一个 bundle 到就绪。name=注册名；opts.url 存在则从该远程 url 取，否则按本地 name 取。

###### Parameters

###### name

`string`

###### opts?

[`BundleLoadOptions`](bundle.md#bundleloadoptions) & `object`

###### Returns

`Promise`\<`void`\>

##### releaseBundle()

> **releaseBundle**(`name`): `void`

Defined in: [packages/core/src/bundle/bundle-source.ts:19](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bundle/bundle-source.ts#L19)

真释放整个 bundle。

###### Parameters

###### name

`string`

###### Returns

`void`

## Type Aliases

### BundleHandle

> **BundleHandle**: `object`

Defined in: [packages/core/src/bundle/bundle-manager.ts:18](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bundle/bundle-manager.ts#L18)

不透明句柄：core 不持真 cc.Bundle，只带 name/version 只读元信息；engine 按 name 反解。

#### Type declaration

##### name

> `readonly` **name**: `string`

##### version?

> `readonly` `optional` **version**: `string`

***

### BundleRef

> **BundleRef**: `string` \| () => `string`

Defined in: [packages/core/src/bundle/bundle-graph.ts:30](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bundle/bundle-graph.ts#L30)

依赖项：包名，或运行时才定的解析函数（皮包名依赖当前马甲，启动后才有值）。

## Variables

### BUNDLE\_MANAGER

> `const` **BUNDLE\_MANAGER**: [`Token`](di.md#tokent)\<[`BundleManager`](bundle.md#bundlemanager)\>

Defined in: [packages/core/src/bundle/bundle-manager.ts:230](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bundle/bundle-manager.ts#L230)

DI token：项目可 register 自己的 BundleManager 覆盖默认。

***

### BUNDLE\_RELOADER

> `const` **BUNDLE\_RELOADER**: [`Token`](di.md#tokent)\<[`IBundleReloader`](bundle.md#ibundlereloader)\>

Defined in: [packages/core/src/bundle/bundle-reloader.ts:26](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bundle/bundle-reloader.ts#L26)

DI token：engine 注册平台实现；未注册时调用方按 `false`（需重启）处理。

***

### BUNDLE\_SOURCE

> `const` **BUNDLE\_SOURCE**: [`Token`](di.md#tokent)\<[`IBundleSource`](bundle.md#ibundlesource)\>

Defined in: [packages/core/src/bundle/bundle-source.ts:25](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bundle/bundle-source.ts#L25)

DI token：engine 注册 cc.assetManager 适配，createBundleManager() 自动拾取。

***

### DEFAULT\_ALWAYS\_ALLOWED

> `const` **DEFAULT\_ALWAYS\_ALLOWED**: readonly `string`[]

Defined in: [packages/core/src/bundle/bundle-graph.ts:65](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bundle/bundle-graph.ts#L65)

默认豁免：Creator 的四个内置包，全都在 base 层、常驻。

## Functions

### createBundleGraph()

> **createBundleGraph**(`specs`, `opts`?): [`BundleGraph`](bundle.md#bundlegraph)

Defined in: [packages/core/src/bundle/bundle-graph.ts:73](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bundle/bundle-graph.ts#L73)

从声明表造图。表里重名以**后一条**为准（便于接入方覆盖）。

#### Parameters

##### specs

readonly [`BundleSpec`](bundle.md#bundlespec)[]

##### opts?

[`BundleGraphOptions`](bundle.md#bundlegraphoptions)

#### Returns

[`BundleGraph`](bundle.md#bundlegraph)

***

### createBundleManager()

> **createBundleManager**(`opts`?): [`BundleManager`](bundle.md#bundlemanager)

Defined in: [packages/core/src/bundle/bundle-manager.ts:84](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bundle/bundle-manager.ts#L84)

造 BundleManager（纯逻辑、零 cc；引擎 IO 经接缝注入）。

#### Parameters

##### opts?

[`BundleManagerOptions`](bundle.md#bundlemanageroptions)

#### Returns

[`BundleManager`](bundle.md#bundlemanager)

***

### createBundleScope()

> **createBundleScope**(`bundle`, `deps`?): [`BundleScope`](bundle.md#bundlescope)

Defined in: [packages/core/src/bundle/bundle-scope.ts:59](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bundle/bundle-scope.ts#L59)

#### Parameters

##### bundle

`string`

##### deps?

[`BundleScopeDeps`](bundle.md#bundlescopedeps)

#### Returns

[`BundleScope`](bundle.md#bundlescope)

***

### createMemoryBundleSource()

> **createMemoryBundleSource**(`preset`?): [`IBundleSource`](bundle.md#ibundlesource)

Defined in: [packages/core/src/bundle/bundle-source.ts:31](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bundle/bundle-source.ts#L31)

内存 fake（默认 / 测试）：把「加载」建模为把 name 加入就绪集，「释放」移除。
preset.present 里的名字视为一开始就已就绪（免加载）。不含真 cc。

#### Parameters

##### preset?

###### present?

`string`[]

#### Returns

[`IBundleSource`](bundle.md#ibundlesource)

***

### getBundleManager()

> **getBundleManager**(): [`BundleManager`](bundle.md#bundlemanager)

Defined in: [packages/core/src/bundle/bundle-manager.ts:235](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/bundle/bundle-manager.ts#L235)

便捷取用：优先 tryResolve(BUNDLE_MANAGER)；未注册则进程级默认（BUNDLE_SOURCE/内存背书）。

#### Returns

[`BundleManager`](bundle.md#bundlemanager)

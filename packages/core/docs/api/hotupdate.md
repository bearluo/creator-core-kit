[**@cck/core API**](README.md)

***

[@cck/core API](README.md) / hotupdate

# hotupdate

## Interfaces

### AppInfo

Defined in: [packages/core/src/hotupdate/version-gate.ts:22](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/hotupdate/version-gate.ts#L22)

本地（当前安装的客户端）信息，构建期打戳。

#### Properties

##### appVersion

> **appVersion**: `string`

Defined in: [packages/core/src/hotupdate/version-gate.ts:24](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/hotupdate/version-gate.ts#L24)

当前 app 版本号（点分数字）。

##### coreApiHash?

> `optional` **coreApiHash**: `string`

Defined in: [packages/core/src/hotupdate/version-gate.ts:26](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/hotupdate/version-gate.ts#L26)

当前主包 core API 表面 hash（可选）。

##### engineHash?

> `optional` **engineHash**: `string`

Defined in: [packages/core/src/hotupdate/version-gate.ts:31](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/hotupdate/version-gate.ts#L31)

当前**引擎内容指纹**（可选）。native 由 engine 层运行时取（`cc.<md5>.js` 的那段 md5）——
它属于跟 `libcocos.so` 同源、结构性不可热更的那一层，所以它就是「这个包的引擎身份」。

***

### BundleUpdater

Defined in: [packages/core/src/hotupdate/bundle-updater.ts:23](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/hotupdate/bundle-updater.ts#L23)

BundleUpdater —— 「加载前把这个 bundle 更到最新」。分包热更的编排半，纯逻辑、零 cc。

每个 bundle 一个 [createHotUpdateService](hotupdate.md#createhotupdateservice) 实例（状态机 / 版本闸 / 进度全复用），后端由
[HotUpdateBackendFactory](hotupdate.md#hotupdatebackendfactory) 按名产出。挂在 `BundleManager.load` 之前——UIManager 打开界面时
也会 load 它所属的 bundle，挂上层 App 必漏那条路径。

native 上模块 bundle 更新**不需要重启也不需要启动还原**：`AssetsManagerEx` 在 `create()` 与
`updateSucceed()` 里都会自行 `prependSearchPaths`，而模块 bundle 此刻尚未加载。

#### Methods

##### ensureLatest()

> **ensureLatest**(`bundle`): `Promise`\<`void`\>

Defined in: [packages/core/src/hotupdate/bundle-updater.ts:37](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/hotupdate/bundle-updater.ts#L37)

把该 bundle 更到最新。同名重复调用只跑一次（**失败的那次不留缓存**，重试能真的重跑）。

**更新不成就 reject**，由 `BundleManager.load` 原样抛给上层：启动期 → 启动失败页可重试，
运行期 → 打开模块失败。**不退回包内版本静默继续** —— 那会把「CDN 少传了一个文件」这类发布事故
伪装成「玩家在玩旧版」，线上无人察觉；何况包内那份还可能压根不存在（从没随包发过的新模块 /
新马甲皮走种子 manifest 全量下载），降级只是把失败推迟到 `loadBundle`、报错更难查。

版本闸拒绝会带 `needFullUpdate` 标记（结构标记，见 [LaunchFailure](app.md#launchfailure)）——那是「该发整包了」，
跟网络错不是一回事，UI 得引导去商店而不是让玩家对着「重试」徒劳点。

唯一的 no-op 是**平台没注册热更后端**（web / 编辑器）：那不是失败，是这条路不存在。

###### Parameters

###### bundle

`string`

###### Returns

`Promise`\<`void`\>

##### versionOf()?

> `optional` **versionOf**(`bundle`): `undefined` \| `string`

Defined in: [packages/core/src/hotupdate/bundle-updater.ts:48](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/hotupdate/bundle-updater.ts#L48)

该 bundle 更新完之后**该按哪个版本加载**（native 内容寻址产物 = `index.<md5>.js` 的 md5）。

只有 [ensureLatest](hotupdate.md#ensurelatest) 成功跑完才有值；之前、失败后、以及后端不认 manifest（web / 空后端）
一律 `undefined` —— 调用方回落到别的版本来源。同步取值，因为 `BundleManager` 正是在
`await ensureLatest(...)` 的下一行用它。

可选：项目可以 register 自己的 `BundleUpdater`（见 [BUNDLE\_UPDATER](hotupdate.md#bundle_updater)），别为这个
后加的能力把它们全判成不合法——不实现就等于「我不知道版本」，调用方回落。

###### Parameters

###### bundle

`string`

###### Returns

`undefined` \| `string`

***

### BundleUpdaterOptions

Defined in: [packages/core/src/hotupdate/bundle-updater.ts:51](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/hotupdate/bundle-updater.ts#L51)

#### Properties

##### app?

> `optional` **app**: [`AppInfo`](hotupdate.md#appinfo)

Defined in: [packages/core/src/hotupdate/bundle-updater.ts:57](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/hotupdate/bundle-updater.ts#L57)

本地客户端信息（版本 / coreApiHash），透传给闸。

##### factory?

> `optional` **factory**: [`HotUpdateBackendFactory`](hotupdate.md#hotupdatebackendfactory)

Defined in: [packages/core/src/hotupdate/bundle-updater.ts:53](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/hotupdate/bundle-updater.ts#L53)

按名造后端。默认 DI [HOTUPDATE\_BACKEND\_FACTORY](hotupdate.md#hotupdate_backend_factory)；未注册 → 恒 no-op。

##### gate?

> `optional` **gate**: [`VersionGate`](hotupdate.md#versiongate)

Defined in: [packages/core/src/hotupdate/bundle-updater.ts:55](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/hotupdate/bundle-updater.ts#L55)

版本闸，透传给每个 bundle 的 HotUpdateService。

##### logger?

> `optional` **logger**: [`ILogger`](logging.md#ilogger)

Defined in: [packages/core/src/hotupdate/bundle-updater.ts:60](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/hotupdate/bundle-updater.ts#L60)

##### onProgress()?

> `optional` **onProgress**: (`bundle`, `p`) => `void`

Defined in: [packages/core/src/hotupdate/bundle-updater.ts:59](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/hotupdate/bundle-updater.ts#L59)

下载进度，带上是哪个 bundle。

###### Parameters

###### bundle

`string`

###### p

[`HotUpdateProgress`](hotupdate.md#hotupdateprogress)

###### Returns

`void`

***

### GateResult

Defined in: [packages/core/src/hotupdate/version-gate.ts:35](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/hotupdate/version-gate.ts#L35)

版本闸判定结果。

#### Properties

##### needFullUpdate?

> `optional` **needFullUpdate**: `boolean`

Defined in: [packages/core/src/hotupdate/version-gate.ts:40](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/hotupdate/version-gate.ts#L40)

是否需整包更新（主包裁剪缺代码风险 → 不能只热更）。

##### ok

> **ok**: `boolean`

Defined in: [packages/core/src/hotupdate/version-gate.ts:36](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/hotupdate/version-gate.ts#L36)

##### reason?

> `optional` **reason**: `string`

Defined in: [packages/core/src/hotupdate/version-gate.ts:38](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/hotupdate/version-gate.ts#L38)

不通过原因（面向提示）。

***

### HotUpdateProgress

Defined in: [packages/core/src/hotupdate/hotupdate-backend.ts:10](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/hotupdate/hotupdate-backend.ts#L10)

下载进度（core 只转发/存储，不解释）。

#### Properties

##### bytesDone

> **bytesDone**: `number`

Defined in: [packages/core/src/hotupdate/hotupdate-backend.ts:11](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/hotupdate/hotupdate-backend.ts#L11)

##### bytesTotal

> **bytesTotal**: `number`

Defined in: [packages/core/src/hotupdate/hotupdate-backend.ts:12](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/hotupdate/hotupdate-backend.ts#L12)

##### filesDone

> **filesDone**: `number`

Defined in: [packages/core/src/hotupdate/hotupdate-backend.ts:13](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/hotupdate/hotupdate-backend.ts#L13)

##### filesTotal

> **filesTotal**: `number`

Defined in: [packages/core/src/hotupdate/hotupdate-backend.ts:14](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/hotupdate/hotupdate-backend.ts#L14)

***

### HotUpdateService

Defined in: [packages/core/src/hotupdate/hotupdate-service.ts:41](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/hotupdate/hotupdate-service.ts#L41)

#### Properties

##### info

> `readonly` **info**: `undefined` \| [`UpdateInfo`](hotupdate.md#updateinfo)

Defined in: [packages/core/src/hotupdate/hotupdate-service.ts:45](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/hotupdate/hotupdate-service.ts#L45)

最近一次 check 的远程信息（无则 undefined）。

##### state

> `readonly` **state**: [`HotUpdateState`](hotupdate.md#hotupdatestate)

Defined in: [packages/core/src/hotupdate/hotupdate-service.ts:43](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/hotupdate/hotupdate-service.ts#L43)

当前状态（UI 可读）。

#### Methods

##### check()

> **check**(): `Promise`\<[`CheckOutcome`](hotupdate.md#checkoutcome)\>

Defined in: [packages/core/src/hotupdate/hotupdate-service.ts:47](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/hotupdate/hotupdate-service.ts#L47)

检查更新：拉远程版本头 → 比版本 → 版本闸判定。

###### Returns

`Promise`\<[`CheckOutcome`](hotupdate.md#checkoutcome)\>

##### restart()

> **restart**(): `void`

Defined in: [packages/core/src/hotupdate/hotupdate-service.ts:51](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/hotupdate/hotupdate-service.ts#L51)

重启生效（应在 ready 后调）。

###### Returns

`void`

##### update()

> **update**(`onProgress`?): `Promise`\<[`UpdateOutcome`](hotupdate.md#updateoutcome)\>

Defined in: [packages/core/src/hotupdate/hotupdate-service.ts:49](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/hotupdate/hotupdate-service.ts#L49)

下载 + 应用（须先 check 到 update-available；失败后可再调重试）。

###### Parameters

###### onProgress?

(`p`) => `void`

###### Returns

`Promise`\<[`UpdateOutcome`](hotupdate.md#updateoutcome)\>

***

### HotUpdateServiceOptions

Defined in: [packages/core/src/hotupdate/hotupdate-service.ts:54](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/hotupdate/hotupdate-service.ts#L54)

#### Properties

##### app?

> `optional` **app**: [`AppInfo`](hotupdate.md#appinfo)

Defined in: [packages/core/src/hotupdate/hotupdate-service.ts:60](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/hotupdate/hotupdate-service.ts#L60)

本地客户端信息（版本/hash），构建期打戳。缺省 { appVersion: '0.0.0' }。

##### backend?

> `optional` **backend**: [`IHotUpdateBackend`](hotupdate.md#ihotupdatebackend)

Defined in: [packages/core/src/hotupdate/hotupdate-service.ts:56](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/hotupdate/hotupdate-service.ts#L56)

平台后端。默认：DI HOTUPDATE_BACKEND，未注册则空后端（恒 up-to-date）。

##### gate?

> `optional` **gate**: [`VersionGate`](hotupdate.md#versiongate)

Defined in: [packages/core/src/hotupdate/hotupdate-service.ts:58](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/hotupdate/hotupdate-service.ts#L58)

版本兼容闸。默认 createSemverVersionGate（安全默认，可注入自定义 override）。

##### logger?

> `optional` **logger**: [`ILogger`](logging.md#ilogger)

Defined in: [packages/core/src/hotupdate/hotupdate-service.ts:61](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/hotupdate/hotupdate-service.ts#L61)

***

### IHotUpdateBackend

Defined in: [packages/core/src/hotupdate/hotupdate-backend.ts:22](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/hotupdate/hotupdate-backend.ts#L22)

热更后端接缝：core 只认本接口（守零 cc 铁律）。engine 按平台实现——
native 包 jsb.AssetsManager（checkUpdate/update 事件 + setSearchPaths + game.restart）；
Web/小游戏 包远程 Asset Bundle 版本化加载（assetManager.loadBundle({version})）。

#### Methods

##### apply()

> **apply**(): `Promise`\<`void`\>

Defined in: [packages/core/src/hotupdate/hotupdate-backend.ts:28](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/hotupdate/hotupdate-backend.ts#L28)

生效（native：setSearchPaths 置顶；web：激活新 bundle）。不含 restart。

###### Returns

`Promise`\<`void`\>

##### assetKeys()?

> `optional` **assetKeys**(): readonly `string`[]

Defined in: [packages/core/src/hotupdate/hotupdate-backend.ts:38](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/hotupdate/hotupdate-backend.ts#L38)

本地 manifest（更新成功后 = 远端那份）的 asset key 列表，供反推该 bundle 的内容版本
（见 [bundleVersionFromAssetKeys](hotupdate.md#bundleversionfromassetkeys)）。**只在 check/download 跑完后调用才有意义**。

可选：没有 manifest 概念的后端（web / 空后端）不实现，`BundleUpdater.versionOf` 随之恒
`undefined`，版本回落到别的来源。

###### Returns

readonly `string`[]

##### check()

> **check**(): `Promise`\<[`CheckResult`](hotupdate.md#checkresult)\>

Defined in: [packages/core/src/hotupdate/hotupdate-backend.ts:24](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/hotupdate/hotupdate-backend.ts#L24)

拉远程 version 头、比版本（不下载资源）。

###### Returns

`Promise`\<[`CheckResult`](hotupdate.md#checkresult)\>

##### download()

> **download**(`onProgress`): `Promise`\<`void`\>

Defined in: [packages/core/src/hotupdate/hotupdate-backend.ts:26](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/hotupdate/hotupdate-backend.ts#L26)

下载差量到本地（native：AssetsManager.update；web：loadBundle 到缓存）。

###### Parameters

###### onProgress

(`p`) => `void`

###### Returns

`Promise`\<`void`\>

##### restart()

> **restart**(): `void`

Defined in: [packages/core/src/hotupdate/hotupdate-backend.ts:30](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/hotupdate/hotupdate-backend.ts#L30)

重启生效（native：game.restart；web：location.reload）。

###### Returns

`void`

***

### UpdateInfo

Defined in: [packages/core/src/hotupdate/version-gate.ts:2](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/hotupdate/version-gate.ts#L2)

远程更新声明的信息（来自远程 manifest 的兼容字段 + 版本头）。

#### Properties

##### coreApiHash?

> `optional` **coreApiHash**: `string`

Defined in: [packages/core/src/hotupdate/version-gate.ts:8](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/hotupdate/version-gate.ts#L8)

兼容要求：core 公共 API 表面 hash 须与本地相等（缺省不校验；呼应 ADR-0001 强引用白名单）。

##### engineHash?

> `optional` **engineHash**: `string`

Defined in: [packages/core/src/hotupdate/version-gate.ts:16](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/hotupdate/version-gate.ts#L16)

兼容要求：**引擎内容指纹**须与本地相等（缺省不校验）。出包期从产物的 `cc.<md5>.js` 取。

与 [coreApiHash](hotupdate.md#coreapihash-1) 挡的是两回事，两道闸不可互相替代：前者描述 `@cck/core` 的 API 面，
换 Creator 版本 / 改引擎模块勾选时它**一动不动**；而热更下发的全是 JS，它们是对着**某一个**
`cc.js` 的 API 面编译的，配上另一个引擎就崩在绑定层。

##### minAppVersion?

> `optional` **minAppVersion**: `string`

Defined in: [packages/core/src/hotupdate/version-gate.ts:6](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/hotupdate/version-gate.ts#L6)

兼容要求：本次更新要求 app 版本 >= 此（缺省不校验）。

##### totalBytes?

> `optional` **totalBytes**: `number`

Defined in: [packages/core/src/hotupdate/version-gate.ts:18](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/hotupdate/version-gate.ts#L18)

待下载总字节（进度用，可选）。

##### version

> **version**: `string`

Defined in: [packages/core/src/hotupdate/version-gate.ts:4](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/hotupdate/version-gate.ts#L4)

远程版本号（点分数字，如 "1.4.0"）。

***

### VersionGate

Defined in: [packages/core/src/hotupdate/version-gate.ts:47](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/hotupdate/version-gate.ts#L47)

版本兼容闸：apply 前判定「这个远程更新能否安全应用到当前客户端」。
默认实现见 createSemverVersionGate；项目可注入自定义 gate 做灰度/强更/自定义兼容矩阵（override 即自担责）。

#### Methods

##### canApply()

> **canApply**(`remote`, `local`): [`GateResult`](hotupdate.md#gateresult)

Defined in: [packages/core/src/hotupdate/version-gate.ts:48](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/hotupdate/version-gate.ts#L48)

###### Parameters

###### remote

[`UpdateInfo`](hotupdate.md#updateinfo)

###### local

[`AppInfo`](hotupdate.md#appinfo)

###### Returns

[`GateResult`](hotupdate.md#gateresult)

## Type Aliases

### CheckOutcome

> **CheckOutcome**: \{ `kind`: `"up-to-date"`; \} \| \{ `info`: [`UpdateInfo`](hotupdate.md#updateinfo); `kind`: `"update-available"`; \} \| \{ `kind`: `"rejected"`; `needFullUpdate`: `boolean`; `reason`: `string`; \} \| \{ `error`: `unknown`; `kind`: `"error"`; \}

Defined in: [packages/core/src/hotupdate/hotupdate-service.ts:29](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/hotupdate/hotupdate-service.ts#L29)

check 产出（面向调用方）。

***

### CheckResult

> **CheckResult**: \{ `status`: `"up-to-date"`; \} \| \{ `info`: [`UpdateInfo`](hotupdate.md#updateinfo); `status`: `"new-version"`; \}

Defined in: [packages/core/src/hotupdate/hotupdate-backend.ts:5](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/hotupdate/hotupdate-backend.ts#L5)

check 结果：已最新 / 发现新版本（带远程信息）。

***

### HotUpdateBackendFactory()

> **HotUpdateBackendFactory**: (`bundle`) => [`IHotUpdateBackend`](hotupdate.md#ihotupdatebackend)

Defined in: [packages/core/src/hotupdate/hotupdate-backend.ts:50](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/hotupdate/hotupdate-backend.ts#L50)

按 bundle 名造后端 —— 分包热更的接缝（一 bundle 一份 manifest、一个独立更新目标）。
native 实现给每个 bundle 一份独立 storagePath：`AssetsManagerEx` 的缓存 manifest 路径写死成
`<storagePath>/project.manifest`，共用目录会让各 bundle 互相覆盖。

#### Parameters

##### bundle

`string`

#### Returns

[`IHotUpdateBackend`](hotupdate.md#ihotupdatebackend)

***

### HotUpdateState

> **HotUpdateState**: `"idle"` \| `"checking"` \| `"up-to-date"` \| `"update-available"` \| `"rejected"` \| `"downloading"` \| `"applying"` \| `"ready"` \| `"failed"`

Defined in: [packages/core/src/hotupdate/hotupdate-service.ts:17](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/hotupdate/hotupdate-service.ts#L17)

统一更新状态（供 UI 读取展示）。

***

### UpdateOutcome

> **UpdateOutcome**: \{ `kind`: `"ready"`; \} \| \{ `error`: `unknown`; `kind`: `"failed"`; `retryable`: `boolean`; \} \| \{ `kind`: `"skipped"`; `reason`: `string`; \}

Defined in: [packages/core/src/hotupdate/hotupdate-service.ts:36](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/hotupdate/hotupdate-service.ts#L36)

update 产出。

## Variables

### BUNDLE\_UPDATER

> `const` **BUNDLE\_UPDATER**: [`Token`](di.md#tokent)\<[`BundleUpdater`](hotupdate.md#bundleupdater)\>

Defined in: [packages/core/src/hotupdate/bundle-updater.ts:127](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/hotupdate/bundle-updater.ts#L127)

DI token：项目可 register 自己的 BundleUpdater 覆盖默认；未注册则 BundleManager 不做加载前更新。

***

### HOTUPDATE\_BACKEND

> `const` **HOTUPDATE\_BACKEND**: [`Token`](di.md#tokent)\<[`IHotUpdateBackend`](hotupdate.md#ihotupdatebackend)\>

Defined in: [packages/core/src/hotupdate/hotupdate-backend.ts:42](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/hotupdate/hotupdate-backend.ts#L42)

DI token：engine Bootstrap register 平台适配；未注册时 HotUpdateService 回退空后端（恒 up-to-date）。

***

### HOTUPDATE\_BACKEND\_FACTORY

> `const` **HOTUPDATE\_BACKEND\_FACTORY**: [`Token`](di.md#tokent)\<[`HotUpdateBackendFactory`](hotupdate.md#hotupdatebackendfactory)\>

Defined in: [packages/core/src/hotupdate/hotupdate-backend.ts:53](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/hotupdate/hotupdate-backend.ts#L53)

DI token：engine 仅 native 注册；未注册 → BundleUpdater 恒 no-op（bundle 用包内版本）。

***

### HOTUPDATE\_SERVICE

> `const` **HOTUPDATE\_SERVICE**: [`Token`](di.md#tokent)\<[`HotUpdateService`](hotupdate.md#hotupdateservice)\>

Defined in: [packages/core/src/hotupdate/hotupdate-service.ts:138](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/hotupdate/hotupdate-service.ts#L138)

DI token：项目可 register 自己的 HotUpdateService 覆盖默认。

## Functions

### bundleVersionFromAssetKeys()

> **bundleVersionFromAssetKeys**(`bundle`, `keys`): `undefined` \| `string`

Defined in: [packages/core/src/hotupdate/bundle-version.ts:26](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/hotupdate/bundle-version.ts#L26)

从 asset key 列表里认出该 bundle 的内容版本 = `assets/<bundle>/index.<v>.js` 里的 `<v>`。

认不出就返回 `undefined`（**不是错误**）：产物没开 `md5Cache` 时入口就叫 `index.js`，
此时引擎按不带版本的名字取，正是我们要的行为 —— 调用方回落到下一个版本来源即可。

bundle 名按字面匹配、不当正则用（`mini-clicker`、`skin-default-lobby` 这类名字里的 `-` 无害，
但名字来自配置，别给它解释元字符的机会）。

#### Parameters

##### bundle

`string`

##### keys

readonly `string`[]

#### Returns

`undefined` \| `string`

***

### compareVersion()

> **compareVersion**(`a`, `b`): `number`

Defined in: [packages/core/src/hotupdate/version-gate.ts:56](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/hotupdate/version-gate.ts#L56)

比较点分数字版本号：a<b→-1，a==b→0，a>b→1。
逐段数字比较（"1.10.0" > "1.9.9"），长度不等按缺位补 0（"1.2"=="1.2.0"）。
ponytail: 忽略 pre-release/build 元数据（-rc.1、+build），首版按纯数字段；需要时再引 semver 库。

#### Parameters

##### a

`string`

##### b

`string`

#### Returns

`number`

***

### createBundleUpdater()

> **createBundleUpdater**(`opts`?): [`BundleUpdater`](hotupdate.md#bundleupdater)

Defined in: [packages/core/src/hotupdate/bundle-updater.ts:64](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/hotupdate/bundle-updater.ts#L64)

造 BundleUpdater（纯逻辑、零 cc；平台 IO 经 HotUpdateBackendFactory 注入）。

#### Parameters

##### opts?

[`BundleUpdaterOptions`](hotupdate.md#bundleupdateroptions)

#### Returns

[`BundleUpdater`](hotupdate.md#bundleupdater)

***

### createHotUpdateService()

> **createHotUpdateService**(`opts`?): [`HotUpdateService`](hotupdate.md#hotupdateservice)

Defined in: [packages/core/src/hotupdate/hotupdate-service.ts:65](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/hotupdate/hotupdate-service.ts#L65)

造 HotUpdateService（纯逻辑、零 cc；平台 IO 经 IHotUpdateBackend 注入，兼容策略经 VersionGate 注入）。

#### Parameters

##### opts?

[`HotUpdateServiceOptions`](hotupdate.md#hotupdateserviceoptions)

#### Returns

[`HotUpdateService`](hotupdate.md#hotupdateservice)

***

### createMemoryHotUpdateBackend()

> **createMemoryHotUpdateBackend**(`preset`?): [`IHotUpdateBackend`](hotupdate.md#ihotupdatebackend)

Defined in: [packages/core/src/hotupdate/hotupdate-backend.ts:60](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/hotupdate/hotupdate-backend.ts#L60)

空后端（null object）：恒报「已最新」、下载/应用/重启皆 no-op。
默认实现（非 native 或未接热更时）+ 可预置 check 结果供测试。

#### Parameters

##### preset?

###### check?

[`CheckResult`](hotupdate.md#checkresult)

#### Returns

[`IHotUpdateBackend`](hotupdate.md#ihotupdatebackend)

***

### createSemverVersionGate()

> **createSemverVersionGate**(): [`VersionGate`](hotupdate.md#versiongate)

Defined in: [packages/core/src/hotupdate/version-gate.ts:76](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/hotupdate/version-gate.ts#L76)

默认安全闸（承 ADR-0001）：
- remote.minAppVersion 存在且 local.appVersion 低于它 → 拒，needFullUpdate（防 主包裁剪缺代码崩）。
- remote/local 都声明 coreApiHash 且不等 → 拒，needFullUpdate。
- remote/local 都声明 engineHash 且不等 → 拒，needFullUpdate（热更换不了引擎，只能发包）。
- 否则放行。零配置即享此安全默认；纯比对，可 node 单测。

#### Returns

[`VersionGate`](hotupdate.md#versiongate)

***

### getHotUpdateService()

> **getHotUpdateService**(): [`HotUpdateService`](hotupdate.md#hotupdateservice)

Defined in: [packages/core/src/hotupdate/hotupdate-service.ts:144](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/hotupdate/hotupdate-service.ts#L144)

便捷取用：优先 tryResolve(HOTUPDATE_SERVICE)；未注册则进程级默认（空后端背书）。

#### Returns

[`HotUpdateService`](hotupdate.md#hotupdateservice)

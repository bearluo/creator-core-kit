[**@cck/core API**](README.md)

***

[@cck/core API](README.md) / app

# app

## Interfaces

### App

Defined in: [packages/core/src/app/app.ts:132](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L132)

#### Properties

##### config

> `readonly` **config**: [`AppConfig`](app.md#appconfig)

Defined in: [packages/core/src/app/app.ts:133](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L133)

##### phase

> `readonly` **phase**: [`LaunchPhase`](app.md#launchphase)

Defined in: [packages/core/src/app/app.ts:134](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L134)

#### Methods

##### launch()

> **launch**(): `Promise`\<`void`\>

Defined in: [packages/core/src/app/app.ts:136](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L136)

从当前游标跑到底。重复调用不会重跑已完成的步骤。

###### Returns

`Promise`\<`void`\>

##### onFailure()

> **onFailure**(`cb`): [`Disposer`](eventbus.md#disposer)

Defined in: [packages/core/src/app/app.ts:141](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L141)

###### Parameters

###### cb

(`f`) => `void`

###### Returns

[`Disposer`](eventbus.md#disposer)

##### onProgress()

> **onProgress**(`cb`): [`Disposer`](eventbus.md#disposer)

Defined in: [packages/core/src/app/app.ts:140](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L140)

###### Parameters

###### cb

(`p`) => `void`

###### Returns

[`Disposer`](eventbus.md#disposer)

##### restart()

> **restart**(): `void`

Defined in: [packages/core/src/app/app.ts:139](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L139)

###### Returns

`void`

##### retry()

> **retry**(): `Promise`\<`void`\>

Defined in: [packages/core/src/app/app.ts:138](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L138)

从**失败那一步**继续，前面的不重跑。

###### Returns

`Promise`\<`void`\>

***

### AppConfig

Defined in: [packages/core/src/app/app.ts:34](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L34)

#### Properties

##### appId

> `readonly` **appId**: `string`

Defined in: [packages/core/src/app/app.ts:35](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L35)

##### channel

> `readonly` **channel**: `string`

Defined in: [packages/core/src/app/app.ts:39](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L39)

渠道 / 分发标识。

##### dispatcher?

> `readonly` `optional` **dispatcher**: [`DispatcherConfig`](app.md#dispatcherconfig)

Defined in: [packages/core/src/app/app.ts:59](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L59)

启动握手。不配则跳过该步（单机 / 尚未接服务端）。

##### env

> `readonly` **env**: `"dev"` \| `"staging"` \| `"prod"`

Defined in: [packages/core/src/app/app.ts:41](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L41)

环境：决定版本表 / manifest 地址由项目怎么拼。

##### lobby

> `readonly` **lobby**: `object`

Defined in: [packages/core/src/app/app.ts:44](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L44)

###### bundle

> `readonly` **bundle**: `string`

###### enter()

> `readonly` **enter**: () => `Promise`\<`void`\>

进入大厅。engine 侧通常就是一行 `loadScene(scene, { bundle })`。

###### Returns

`Promise`\<`void`\>

##### shared?

> `readonly` `optional` **shared**: readonly `string`[]

Defined in: [packages/core/src/app/app.ts:43](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L43)

启动期必须加载的共享 bundle（按序），默认 `['shared']`。

##### stampBundle?

> `readonly` `optional` **stampBundle**: `string`

Defined in: [packages/core/src/app/app.ts:55](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L55)

app 戳所在 bundle，默认 `'main'`（Cocos 主包）。

##### stampPath?

> `readonly` `optional` **stampPath**: `string`

Defined in: [packages/core/src/app/app.ts:57](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L57)

app 戳资源路径，默认 `'cck-app-compat'`（tools 的 `cck-manifest stamp` 出包期生成）。

##### version

> `readonly` **version**: `string`

Defined in: [packages/core/src/app/app.ts:37](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L37)

客户端版本；app 戳缺失时作 compat 闸的 appVersion 兜底。

##### versionUrl?

> `readonly` `optional` **versionUrl**: `string`

Defined in: [packages/core/src/app/app.ts:53](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L53)

web：bundle 版本表 JSON 地址（形状见 [RemoteVersions](app.md#remoteversions)）。
不配则跳过该步——native 靠 searchPaths 读新文件，不需要版本表。

***

### AppDeps

Defined in: [packages/core/src/app/app.ts:145](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L145)

依赖注入口（仅为可测；生产不传，各服务从全局取）。

#### Properties

##### assets?

> `optional` **assets**: `Pick`\<[`IAssetLoader`](asset.md#iassetloader), `"release"` \| `"load"` \| `"loadRemote"`\>

Defined in: [packages/core/src/app/app.ts:147](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L147)

##### bundles?

> `optional` **bundles**: `Pick`\<[`BundleManager`](bundle.md#bundlemanager), `"load"` \| `"setVersions"`\>

Defined in: [packages/core/src/app/app.ts:146](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L146)

##### gate?

> `optional` **gate**: [`VersionGate`](hotupdate.md#versiongate)

Defined in: [packages/core/src/app/app.ts:149](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L149)

##### hotUpdate?

> `optional` **hotUpdate**: `Pick`\<[`HotUpdateService`](hotupdate.md#hotupdateservice), `"update"` \| `"check"` \| `"restart"`\>

Defined in: [packages/core/src/app/app.ts:148](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L148)

##### http?

> `optional` **http**: [`IHttp`](network.md#ihttp)

Defined in: [packages/core/src/app/app.ts:150](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L150)

##### logger?

> `optional` **logger**: [`ILogger`](logging.md#ilogger)

Defined in: [packages/core/src/app/app.ts:151](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L151)

##### restart()?

> `optional` **restart**: () => `void`

Defined in: [packages/core/src/app/app.ts:156](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L156)

重启应用。默认走 `HotUpdateService.restart()`（native 的 `game.restart`）。
engine 侧按平台注入——**web 必须 `location.reload()`**：只有整页重来才会重新拉 `index.<md5>.js`。

###### Returns

`void`

***

### DispatcherConfig

Defined in: [packages/core/src/app/app.ts:82](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L82)

#### Properties

##### deviceId?

> `readonly` `optional` **deviceId**: `string`

Defined in: [packages/core/src/app/app.ts:89](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L89)

##### platform

> `readonly` **platform**: `string`

Defined in: [packages/core/src/app/app.ts:88](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L88)

`android` / `ios` / `web` / `wechat` …（engine 侧按 `cc.sys` 填）。

##### protoVersion

> `readonly` **protoVersion**: `number`

Defined in: [packages/core/src/app/app.ts:86](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L86)

协议契约版本。**由项目传入** —— core 不含任何协议常量（ADR-0011）。

##### timeoutSec?

> `readonly` `optional` **timeoutSec**: `number`

Defined in: [packages/core/src/app/app.ts:90](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L90)

##### url

> `readonly` **url**: `string`

Defined in: [packages/core/src/app/app.ts:84](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L84)

完整地址，如 `https://dispatch.example.com/api/Handshake`。

***

### DispatchResult

Defined in: [packages/core/src/app/app.ts:71](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L71)

dispatcher 下发的内容。字段是服务端 `HandshakeResponse` 的归一形状。

`cdnUrl` **就是个 URL** —— 服务端不认识 Cocos 的 manifest 也不认识 Godot 的 pck，
各客户端框架自己解释（ADR-0011）。

#### Properties

##### action

> `readonly` **action**: [`DispatchAction`](app.md#dispatchaction)

Defined in: [packages/core/src/app/app.ts:72](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L72)

##### cdnUrl

> `readonly` **cdnUrl**: `string`

Defined in: [packages/core/src/app/app.ts:75](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L75)

##### notice

> `readonly` **notice**: `string`

Defined in: [packages/core/src/app/app.ts:76](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L76)

##### serverTimeMs

> `readonly` **serverTimeMs**: `number`

Defined in: [packages/core/src/app/app.ts:79](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L79)

服务器权威时间（Unix 毫秒）。本地时钟玩家可改，体力恢复 / 日常重置 / 限时活动一律以此为准。

##### storeUrl

> `readonly` **storeUrl**: `string`

Defined in: [packages/core/src/app/app.ts:77](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L77)

##### wsUrl

> `readonly` **wsUrl**: `string`

Defined in: [packages/core/src/app/app.ts:74](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L74)

`'play'` 时有效：按客户端版本路由到的那个部署单元。

***

### LaunchContext

Defined in: [packages/core/src/app/app.ts:118](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L118)

#### Properties

##### bag

> `readonly` **bag**: `Map`\<`string`, `unknown`\>

Defined in: [packages/core/src/app/app.ts:121](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L121)

步骤间传值（[APP\_INFO](app.md#app_info)、登录态、服务器下发的配置…）。

##### config

> `readonly` **config**: [`AppConfig`](app.md#appconfig)

Defined in: [packages/core/src/app/app.ts:119](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L119)

#### Methods

##### report()

> **report**(`p`): `void`

Defined in: [packages/core/src/app/app.ts:122](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L122)

###### Parameters

###### p

[`LaunchProgress`](app.md#launchprogress)

###### Returns

`void`

***

### LaunchProgress

Defined in: [packages/core/src/app/app.ts:103](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L103)

#### Properties

##### messageKey?

> `readonly` `optional` **messageKey**: `string`

Defined in: [packages/core/src/app/app.ts:108](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L108)

i18n key —— kit 不出面向用户的文案，UI 自己译。

##### phase

> `readonly` **phase**: [`LaunchPhase`](app.md#launchphase)

Defined in: [packages/core/src/app/app.ts:104](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L104)

##### ratio?

> `readonly` `optional` **ratio**: `number`

Defined in: [packages/core/src/app/app.ts:106](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L106)

0..1，仅下载阶段有。

***

### LaunchStep

Defined in: [packages/core/src/app/app.ts:125](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L125)

#### Properties

##### name

> `readonly` **name**: `string`

Defined in: [packages/core/src/app/app.ts:126](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L126)

##### phase

> `readonly` **phase**: [`LaunchPhase`](app.md#launchphase)

Defined in: [packages/core/src/app/app.ts:127](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L127)

#### Methods

##### run()

> **run**(`ctx`): `Promise`\<`void` \| `"halt"`\>

Defined in: [packages/core/src/app/app.ts:129](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L129)

返回 `'halt'` = 到此为止（如 native 热更已 restart，等进程重来）。

###### Parameters

###### ctx

[`LaunchContext`](app.md#launchcontext)

###### Returns

`Promise`\<`void` \| `"halt"`\>

***

### RemoteVersions

Defined in: [packages/core/src/app/app.ts:94](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L94)

远程版本表：web 热更的全部输入。

#### Properties

##### bundles?

> `readonly` `optional` **bundles**: `Readonly`\<`Record`\<`string`, `string`\>\>

Defined in: [packages/core/src/app/app.ts:96](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L96)

bundle 名 → 版本（出包 md5）。

##### coreApiHash?

> `readonly` `optional` **coreApiHash**: `string`

Defined in: [packages/core/src/app/app.ts:100](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L100)

##### minAppVersion?

> `readonly` `optional` **minAppVersion**: `string`

Defined in: [packages/core/src/app/app.ts:99](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L99)

##### version?

> `readonly` `optional` **version**: `string`

Defined in: [packages/core/src/app/app.ts:98](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L98)

本次内容版本号，喂 compat 闸。

## Type Aliases

### DispatchAction

> **DispatchAction**: `"play"` \| `"update"` \| `"maintenance"`

Defined in: [packages/core/src/app/app.ts:63](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L63)

dispatcher 的判定结论。

***

### LaunchFailure

> **LaunchFailure**: \{ `error`: `unknown`; `kind`: `"network"`; `retryable`: `true`; \} \| \{ `kind`: `"needFullUpdate"`; `reason`: `string`; `storeUrl`: `string`; \} \| \{ `kind`: `"maintenance"`; `notice`: `string`; `retryable`: `true`; \} \| \{ `error`: `unknown`; `kind`: `"fatal"`; \}

Defined in: [packages/core/src/app/app.ts:112](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L112)

失败分类：给用户看的东西完全不同（重试 / 去商店 / 等公告 / 兜底），不能糊成一个 Error。

***

### LaunchPhase

> **LaunchPhase**: `"idle"` \| `"platform"` \| `"dispatch"` \| `"hotupdate"` \| `"shared"` \| `"lobby"` \| `"running"` \| `"failed"`

Defined in: [packages/core/src/app/app.ts:24](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L24)

启动阶段，也是进度上报的粒度。

## Variables

### APP

> `const` **APP**: [`Token`](di.md#tokent)\<[`App`](app.md#app)\>

Defined in: [packages/core/src/app/app.ts:442](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L442)

DI token：App 有必需配置、造不出无参默认，所以只有注册后才能 [getApp](app.md#getapp)。

***

### APP\_INFO

> `const` **APP\_INFO**: `"cck.app.info"` = `'cck.app.info'`

Defined in: [packages/core/src/app/app.ts:160](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L160)

`ctx.bag` 里 AppInfo 的键——platform 步写入，compat 闸与项目自定义步骤读取。

***

### DISPATCH

> `const` **DISPATCH**: `"cck.app.dispatch"` = `'cck.app.dispatch'`

Defined in: [packages/core/src/app/app.ts:163](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L163)

`ctx.bag` 里 [DispatchResult](app.md#dispatchresult) 的键——dispatch 步写入，业务读 wsUrl / cdnUrl / 服务器时间。

## Functions

### abortLaunch()

> **abortLaunch**(`failure`): `never`

Defined in: [packages/core/src/app/app.ts:178](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L178)

步骤主动中止启动并指定失败分类。
用**结构标记**而非自定义 Error 子类——跨 bundle `instanceof` 不可靠（ADR-0001）。

#### Parameters

##### failure

[`LaunchFailure`](app.md#launchfailure)

#### Returns

`never`

***

### createApp()

> **createApp**(`config`, `opts`?): [`App`](app.md#app)

Defined in: [packages/core/src/app/app.ts:376](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L376)

#### Parameters

##### config

[`AppConfig`](app.md#appconfig)

##### opts?

###### deps?

[`AppDeps`](app.md#appdeps)

###### steps?

readonly [`LaunchStep`](app.md#launchstep)[]

#### Returns

[`App`](app.md#app)

***

### defaultLaunchSteps()

> **defaultLaunchSteps**(`deps`?): readonly [`LaunchStep`](app.md#launchstep)[]

Defined in: [packages/core/src/app/app.ts:234](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L234)

kit 的默认启动序列。项目可整体替换，或取本函数结果再插队自己的步骤（登录 / SDK / 公告）。

#### Parameters

##### deps?

[`AppDeps`](app.md#appdeps)

#### Returns

readonly [`LaunchStep`](app.md#launchstep)[]

***

### getApp()

> **getApp**(): [`App`](app.md#app)

Defined in: [packages/core/src/app/app.ts:444](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L444)

#### Returns

[`App`](app.md#app)

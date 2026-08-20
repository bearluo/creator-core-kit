[**@cck/core API**](README.md)

***

[@cck/core API](README.md) / app

# app

## Interfaces

### App

Defined in: [packages/core/src/app/app.ts:138](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L138)

#### Properties

##### config

> `readonly` **config**: [`AppConfig`](app.md#appconfig)

Defined in: [packages/core/src/app/app.ts:139](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L139)

##### phase

> `readonly` **phase**: [`LaunchPhase`](app.md#launchphase)

Defined in: [packages/core/src/app/app.ts:140](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L140)

#### Methods

##### launch()

> **launch**(): `Promise`\<`void`\>

Defined in: [packages/core/src/app/app.ts:142](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L142)

从当前游标跑到底。重复调用不会重跑已完成的步骤。

###### Returns

`Promise`\<`void`\>

##### onFailure()

> **onFailure**(`cb`): [`Disposer`](eventbus.md#disposer)

Defined in: [packages/core/src/app/app.ts:147](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L147)

###### Parameters

###### cb

(`f`) => `void`

###### Returns

[`Disposer`](eventbus.md#disposer)

##### onProgress()

> **onProgress**(`cb`): [`Disposer`](eventbus.md#disposer)

Defined in: [packages/core/src/app/app.ts:146](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L146)

###### Parameters

###### cb

(`p`) => `void`

###### Returns

[`Disposer`](eventbus.md#disposer)

##### restart()

> **restart**(): `void`

Defined in: [packages/core/src/app/app.ts:145](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L145)

###### Returns

`void`

##### retry()

> **retry**(): `Promise`\<`void`\>

Defined in: [packages/core/src/app/app.ts:144](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L144)

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

Defined in: [packages/core/src/app/app.ts:65](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L65)

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

Defined in: [packages/core/src/app/app.ts:61](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L61)

app 戳所在 bundle，默认 `'main'`（Cocos 主包）。

##### stampPath?

> `readonly` `optional` **stampPath**: `string`

Defined in: [packages/core/src/app/app.ts:63](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L63)

app 戳资源路径，默认 `'cck-app-compat'`（tools 的 `cck-manifest stamp` 出包期生成）。

##### version

> `readonly` **version**: `string`

Defined in: [packages/core/src/app/app.ts:37](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L37)

客户端版本；app 戳缺失时作 compat 闸的 appVersion 兜底。

##### versionUrl?

> `readonly` `optional` **versionUrl**: `string`

Defined in: [packages/core/src/app/app.ts:59](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L59)

web：bundle 版本表 JSON 地址（形状见 [RemoteVersions](app.md#remoteversions)）。
不配则跳过该步——native 靠 searchPaths 读新文件，不需要版本表。

**推荐写相对文件名**（如 `cck-versions.json`）：按页面 base 解析，跟 bundle 同源，
换部署地址天然生效。资源真放独立 CDN 时才写绝对 URL。

**拉不到 = 启动失败（可重试）**：表与页面同源，拉不到基本等于它没部署上去；退回包内
bundleVers 会把发布事故伪装成「玩家在玩旧版」。native 因此更不该配这一项。

***

### AppDeps

Defined in: [packages/core/src/app/app.ts:151](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L151)

依赖注入口（仅为可测；生产不传，各服务从全局取）。

#### Properties

##### assets?

> `optional` **assets**: `Pick`\<[`IAssetLoader`](asset.md#iassetloader), `"load"` \| `"release"` \| `"loadRemote"`\>

Defined in: [packages/core/src/app/app.ts:153](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L153)

##### bundles?

> `optional` **bundles**: `Pick`\<[`BundleManager`](bundle.md#bundlemanager), `"load"` \| `"setVersions"`\>

Defined in: [packages/core/src/app/app.ts:152](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L152)

##### engineHash()?

> `optional` **engineHash**: () => `undefined` \| `string`

Defined in: [packages/core/src/app/app.ts:168](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L168)

取**引擎内容指纹**，喂 platform 步组装的 [AppInfo](hotupdate.md#appinfo)。core 零 cc，拿不到这个值，
由 engine 的 `appModule` 注入（native 走 `engineHash()`）。返回 `undefined` = 判不了，
闸对单边缺失恒放行。

###### Returns

`undefined` \| `string`

##### gate?

> `optional` **gate**: [`VersionGate`](hotupdate.md#versiongate)

Defined in: [packages/core/src/app/app.ts:155](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L155)

##### hotUpdate?

> `optional` **hotUpdate**: `Pick`\<[`HotUpdateService`](hotupdate.md#hotupdateservice), `"update"` \| `"check"` \| `"restart"`\>

Defined in: [packages/core/src/app/app.ts:154](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L154)

##### http?

> `optional` **http**: [`IHttp`](network.md#ihttp)

Defined in: [packages/core/src/app/app.ts:156](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L156)

##### logger?

> `optional` **logger**: [`ILogger`](logging.md#ilogger)

Defined in: [packages/core/src/app/app.ts:157](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L157)

##### restart()?

> `optional` **restart**: () => `void`

Defined in: [packages/core/src/app/app.ts:162](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L162)

重启应用。默认走 `HotUpdateService.restart()`（native 的 `game.restart`）。
engine 侧按平台注入——**web 必须 `location.reload()`**：只有整页重来才会重新拉 `index.<md5>.js`。

###### Returns

`void`

***

### DispatcherConfig

Defined in: [packages/core/src/app/app.ts:88](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L88)

#### Properties

##### deviceId?

> `readonly` `optional` **deviceId**: `string`

Defined in: [packages/core/src/app/app.ts:95](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L95)

##### platform

> `readonly` **platform**: `string`

Defined in: [packages/core/src/app/app.ts:94](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L94)

`android` / `ios` / `web` / `wechat` …（engine 侧按 `cc.sys` 填）。

##### protoVersion

> `readonly` **protoVersion**: `number`

Defined in: [packages/core/src/app/app.ts:92](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L92)

协议契约版本。**由项目传入** —— core 不含任何协议常量（ADR-0011）。

##### timeoutSec?

> `readonly` `optional` **timeoutSec**: `number`

Defined in: [packages/core/src/app/app.ts:96](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L96)

##### url

> `readonly` **url**: `string`

Defined in: [packages/core/src/app/app.ts:90](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L90)

完整地址，如 `https://dispatch.example.com/api/Handshake`。

***

### DispatchResult

Defined in: [packages/core/src/app/app.ts:77](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L77)

dispatcher 下发的内容。字段是服务端 `HandshakeResponse` 的归一形状。

`cdnUrl` **就是个 URL** —— 服务端不认识 Cocos 的 manifest 也不认识 Godot 的 pck，
各客户端框架自己解释（ADR-0011）。

#### Properties

##### action

> `readonly` **action**: [`DispatchAction`](app.md#dispatchaction)

Defined in: [packages/core/src/app/app.ts:78](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L78)

##### cdnUrl

> `readonly` **cdnUrl**: `string`

Defined in: [packages/core/src/app/app.ts:81](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L81)

##### notice

> `readonly` **notice**: `string`

Defined in: [packages/core/src/app/app.ts:82](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L82)

##### serverTimeMs

> `readonly` **serverTimeMs**: `number`

Defined in: [packages/core/src/app/app.ts:85](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L85)

服务器权威时间（Unix 毫秒）。本地时钟玩家可改，体力恢复 / 日常重置 / 限时活动一律以此为准。

##### storeUrl

> `readonly` **storeUrl**: `string`

Defined in: [packages/core/src/app/app.ts:83](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L83)

##### wsUrl

> `readonly` **wsUrl**: `string`

Defined in: [packages/core/src/app/app.ts:80](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L80)

`'play'` 时有效：按客户端版本路由到的那个部署单元。

***

### LaunchContext

Defined in: [packages/core/src/app/app.ts:124](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L124)

#### Properties

##### bag

> `readonly` **bag**: `Map`\<`string`, `unknown`\>

Defined in: [packages/core/src/app/app.ts:127](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L127)

步骤间传值（[APP\_INFO](app.md#app_info)、登录态、服务器下发的配置…）。

##### config

> `readonly` **config**: [`AppConfig`](app.md#appconfig)

Defined in: [packages/core/src/app/app.ts:125](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L125)

#### Methods

##### report()

> **report**(`p`): `void`

Defined in: [packages/core/src/app/app.ts:128](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L128)

###### Parameters

###### p

[`LaunchProgress`](app.md#launchprogress)

###### Returns

`void`

***

### LaunchProgress

Defined in: [packages/core/src/app/app.ts:109](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L109)

#### Properties

##### messageKey?

> `readonly` `optional` **messageKey**: `string`

Defined in: [packages/core/src/app/app.ts:114](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L114)

i18n key —— kit 不出面向用户的文案，UI 自己译。

##### phase

> `readonly` **phase**: [`LaunchPhase`](app.md#launchphase)

Defined in: [packages/core/src/app/app.ts:110](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L110)

##### ratio?

> `readonly` `optional` **ratio**: `number`

Defined in: [packages/core/src/app/app.ts:112](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L112)

0..1，仅下载阶段有。

***

### LaunchStep

Defined in: [packages/core/src/app/app.ts:131](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L131)

#### Properties

##### name

> `readonly` **name**: `string`

Defined in: [packages/core/src/app/app.ts:132](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L132)

##### phase

> `readonly` **phase**: [`LaunchPhase`](app.md#launchphase)

Defined in: [packages/core/src/app/app.ts:133](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L133)

#### Methods

##### run()

> **run**(`ctx`): `Promise`\<`void` \| `"halt"`\>

Defined in: [packages/core/src/app/app.ts:135](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L135)

返回 `'halt'` = 到此为止（如 native 热更已 restart，等进程重来）。

###### Parameters

###### ctx

[`LaunchContext`](app.md#launchcontext)

###### Returns

`Promise`\<`void` \| `"halt"`\>

***

### RemoteVersions

Defined in: [packages/core/src/app/app.ts:100](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L100)

远程版本表：web 热更的全部输入。

#### Properties

##### bundles?

> `readonly` `optional` **bundles**: `Readonly`\<`Record`\<`string`, `string`\>\>

Defined in: [packages/core/src/app/app.ts:102](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L102)

bundle 名 → 版本（出包 md5）。

##### coreApiHash?

> `readonly` `optional` **coreApiHash**: `string`

Defined in: [packages/core/src/app/app.ts:106](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L106)

##### minAppVersion?

> `readonly` `optional` **minAppVersion**: `string`

Defined in: [packages/core/src/app/app.ts:105](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L105)

##### version?

> `readonly` `optional` **version**: `string`

Defined in: [packages/core/src/app/app.ts:104](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L104)

本次内容版本号，喂 compat 闸。

## Type Aliases

### DispatchAction

> **DispatchAction**: `"play"` \| `"update"` \| `"maintenance"`

Defined in: [packages/core/src/app/app.ts:69](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L69)

dispatcher 的判定结论。

***

### LaunchFailure

> **LaunchFailure**: \{ `error`: `unknown`; `kind`: `"network"`; `retryable`: `true`; \} \| \{ `kind`: `"needFullUpdate"`; `reason`: `string`; `storeUrl`: `string`; \} \| \{ `kind`: `"maintenance"`; `notice`: `string`; `retryable`: `true`; \} \| \{ `error`: `unknown`; `kind`: `"fatal"`; \}

Defined in: [packages/core/src/app/app.ts:118](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L118)

失败分类：给用户看的东西完全不同（重试 / 去商店 / 等公告 / 兜底），不能糊成一个 Error。

***

### LaunchPhase

> **LaunchPhase**: `"idle"` \| `"platform"` \| `"dispatch"` \| `"hotupdate"` \| `"shared"` \| `"lobby"` \| `"running"` \| `"failed"`

Defined in: [packages/core/src/app/app.ts:24](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L24)

启动阶段，也是进度上报的粒度。

## Variables

### APP

> `const` **APP**: [`Token`](di.md#tokent)\<[`App`](app.md#app)\>

Defined in: [packages/core/src/app/app.ts:470](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L470)

DI token：App 有必需配置、造不出无参默认，所以只有注册后才能 [getApp](app.md#getapp)。

***

### APP\_INFO

> `const` **APP\_INFO**: `"cck.app.info"` = `'cck.app.info'`

Defined in: [packages/core/src/app/app.ts:172](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L172)

`ctx.bag` 里 AppInfo 的键——platform 步写入，compat 闸与项目自定义步骤读取。

***

### DISPATCH

> `const` **DISPATCH**: `"cck.app.dispatch"` = `'cck.app.dispatch'`

Defined in: [packages/core/src/app/app.ts:175](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L175)

`ctx.bag` 里 [DispatchResult](app.md#dispatchresult) 的键——dispatch 步写入，业务读 wsUrl / cdnUrl / 服务器时间。

## Functions

### abortLaunch()

> **abortLaunch**(`failure`): `never`

Defined in: [packages/core/src/app/app.ts:190](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L190)

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

Defined in: [packages/core/src/app/app.ts:404](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L404)

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

Defined in: [packages/core/src/app/app.ts:246](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L246)

kit 的默认启动序列。项目可整体替换，或取本函数结果再插队自己的步骤（登录 / SDK / 公告）。

#### Parameters

##### deps?

[`AppDeps`](app.md#appdeps)

#### Returns

readonly [`LaunchStep`](app.md#launchstep)[]

***

### getApp()

> **getApp**(): [`App`](app.md#app)

Defined in: [packages/core/src/app/app.ts:472](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L472)

#### Returns

[`App`](app.md#app)

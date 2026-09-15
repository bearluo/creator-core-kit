[**@cck/core API**](README.md)

***

[@cck/core API](README.md) / app

# app

## Interfaces

### App

Defined in: [packages/core/src/app/app.ts:145](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L145)

#### Properties

##### config

> `readonly` **config**: [`AppConfig`](app.md#appconfig)

Defined in: [packages/core/src/app/app.ts:146](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L146)

##### phase

> `readonly` **phase**: [`LaunchPhase`](app.md#launchphase)

Defined in: [packages/core/src/app/app.ts:147](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L147)

#### Methods

##### launch()

> **launch**(): `Promise`\<`void`\>

Defined in: [packages/core/src/app/app.ts:149](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L149)

从当前游标跑到底。重复调用不会重跑已完成的步骤。

###### Returns

`Promise`\<`void`\>

##### onFailure()

> **onFailure**(`cb`): [`Disposer`](eventbus.md#disposer)

Defined in: [packages/core/src/app/app.ts:154](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L154)

###### Parameters

###### cb

(`f`) => `void`

###### Returns

[`Disposer`](eventbus.md#disposer)

##### onProgress()

> **onProgress**(`cb`): [`Disposer`](eventbus.md#disposer)

Defined in: [packages/core/src/app/app.ts:153](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L153)

###### Parameters

###### cb

(`p`) => `void`

###### Returns

[`Disposer`](eventbus.md#disposer)

##### restart()

> **restart**(): `void`

Defined in: [packages/core/src/app/app.ts:152](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L152)

###### Returns

`void`

##### retry()

> **retry**(): `Promise`\<`void`\>

Defined in: [packages/core/src/app/app.ts:151](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L151)

从**失败那一步**继续，前面的不重跑。

###### Returns

`Promise`\<`void`\>

***

### AppConfig

Defined in: [packages/core/src/app/app.ts:41](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L41)

#### Properties

##### appId

> `readonly` **appId**: `string`

Defined in: [packages/core/src/app/app.ts:42](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L42)

##### channel

> `readonly` **channel**: `string`

Defined in: [packages/core/src/app/app.ts:46](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L46)

渠道 / 分发标识。

##### dispatcher?

> `readonly` `optional` **dispatcher**: [`DispatcherConfig`](app.md#dispatcherconfig)

Defined in: [packages/core/src/app/app.ts:72](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L72)

启动握手。不配则跳过该步（单机 / 尚未接服务端）。

##### env

> `readonly` **env**: `"dev"` \| `"staging"` \| `"prod"`

Defined in: [packages/core/src/app/app.ts:48](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L48)

环境：决定版本表 / manifest 地址由项目怎么拼。

##### lobby

> `readonly` **lobby**: `object`

Defined in: [packages/core/src/app/app.ts:51](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L51)

###### bundle

> `readonly` **bundle**: `string`

###### enter()

> `readonly` **enter**: () => `Promise`\<`void`\>

进入大厅。engine 侧通常就是一行 `loadScene(scene, { bundle })`。

###### Returns

`Promise`\<`void`\>

##### shared?

> `readonly` `optional` **shared**: readonly `string`[]

Defined in: [packages/core/src/app/app.ts:50](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L50)

启动期必须加载的共享 bundle（按序），默认 `['shared']`。

##### stampBundle?

> `readonly` `optional` **stampBundle**: `string`

Defined in: [packages/core/src/app/app.ts:68](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L68)

app 戳所在 bundle，默认 `'main'`（Cocos 主包）。

##### stampPath?

> `readonly` `optional` **stampPath**: `string`

Defined in: [packages/core/src/app/app.ts:70](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L70)

app 戳资源路径，默认 `'cck-app-compat'`（tools 的 `cck-manifest stamp` 出包期生成）。

##### version

> `readonly` **version**: `string`

Defined in: [packages/core/src/app/app.ts:44](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L44)

客户端版本；app 戳缺失时作 compat 闸的 appVersion 兜底。

##### versionUrl?

> `readonly` `optional` **versionUrl**: `string`

Defined in: [packages/core/src/app/app.ts:66](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L66)

web：bundle 版本表 JSON 地址（形状见 [RemoteVersions](app.md#remoteversions)）。
不配则跳过该步——native 靠 searchPaths 读新文件，不需要版本表。

**推荐写相对文件名**（如 `cck-versions.json`）：按页面 base 解析，跟 bundle 同源，
换部署地址天然生效。资源真放独立 CDN 时才写绝对 URL。

**拉不到 = 启动失败（可重试）**：表与页面同源，拉不到基本等于它没部署上去；退回包内
bundleVers 会把发布事故伪装成「玩家在玩旧版」。native 因此更不该配这一项。

***

### AppDeps

Defined in: [packages/core/src/app/app.ts:158](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L158)

依赖注入口（仅为可测；生产不传，各服务从全局取）。

#### Properties

##### assets?

> `optional` **assets**: `Pick`\<[`IAssetLoader`](asset.md#iassetloader), `"load"` \| `"release"` \| `"loadRemote"`\>

Defined in: [packages/core/src/app/app.ts:160](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L160)

##### bundles?

> `optional` **bundles**: `Pick`\<[`BundleManager`](bundle.md#bundlemanager), `"load"` \| `"setVersions"`\>

Defined in: [packages/core/src/app/app.ts:159](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L159)

##### engineHash()?

> `optional` **engineHash**: () => `undefined` \| `string`

Defined in: [packages/core/src/app/app.ts:175](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L175)

取**引擎内容指纹**，喂 platform 步组装的 [AppInfo](hotupdate.md#appinfo)。core 零 cc，拿不到这个值，
由 engine 的 `appModule` 注入（native 走 `engineHash()`）。返回 `undefined` = 判不了，
闸对单边缺失恒放行。

###### Returns

`undefined` \| `string`

##### gate?

> `optional` **gate**: [`VersionGate`](hotupdate.md#versiongate)

Defined in: [packages/core/src/app/app.ts:162](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L162)

##### hotUpdate?

> `optional` **hotUpdate**: `Pick`\<[`HotUpdateService`](hotupdate.md#hotupdateservice), `"update"` \| `"check"` \| `"restart"`\>

Defined in: [packages/core/src/app/app.ts:161](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L161)

##### http?

> `optional` **http**: [`IHttp`](network.md#ihttp)

Defined in: [packages/core/src/app/app.ts:163](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L163)

##### logger?

> `optional` **logger**: [`ILogger`](logging.md#ilogger)

Defined in: [packages/core/src/app/app.ts:164](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L164)

##### restart()?

> `optional` **restart**: () => `void`

Defined in: [packages/core/src/app/app.ts:169](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L169)

重启应用。默认走 `HotUpdateService.restart()`（native 的 `game.restart`）。
engine 侧按平台注入——**web 必须 `location.reload()`**：只有整页重来才会重新拉 `index.<md5>.js`。

###### Returns

`void`

##### tier?

> `optional` **tier**: `Pick`\<[`DeviceTier`](tier.md#devicetier), `"resolveAtStartup"`\>

Defined in: [packages/core/src/app/app.ts:180](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L180)

档位持有者。生产不传 —— `tier` 步自己去容器里问 `DEVICE_TIER`，问不到就跳过整步
（没上分档的项目零成本）。这里只为可测。

***

### DispatcherConfig

Defined in: [packages/core/src/app/app.ts:95](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L95)

#### Properties

##### deviceId?

> `readonly` `optional` **deviceId**: `string`

Defined in: [packages/core/src/app/app.ts:102](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L102)

##### platform

> `readonly` **platform**: `string`

Defined in: [packages/core/src/app/app.ts:101](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L101)

`android` / `ios` / `web` / `wechat` …（engine 侧按 `cc.sys` 填）。

##### protoVersion

> `readonly` **protoVersion**: `number`

Defined in: [packages/core/src/app/app.ts:99](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L99)

协议契约版本。**由项目传入** —— core 不含任何协议常量（ADR-0011）。

##### timeoutSec?

> `readonly` `optional` **timeoutSec**: `number`

Defined in: [packages/core/src/app/app.ts:103](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L103)

##### url

> `readonly` **url**: `string`

Defined in: [packages/core/src/app/app.ts:97](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L97)

完整地址，如 `https://dispatch.example.com/api/Handshake`。

***

### DispatchResult

Defined in: [packages/core/src/app/app.ts:84](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L84)

dispatcher 下发的内容。字段是服务端 `HandshakeResponse` 的归一形状。

`cdnUrl` **就是个 URL** —— 服务端不认识 Cocos 的 manifest 也不认识 Godot 的 pck，
各客户端框架自己解释（ADR-0011）。

#### Properties

##### action

> `readonly` **action**: [`DispatchAction`](app.md#dispatchaction)

Defined in: [packages/core/src/app/app.ts:85](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L85)

##### cdnUrl

> `readonly` **cdnUrl**: `string`

Defined in: [packages/core/src/app/app.ts:88](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L88)

##### notice

> `readonly` **notice**: `string`

Defined in: [packages/core/src/app/app.ts:89](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L89)

##### serverTimeMs

> `readonly` **serverTimeMs**: `number`

Defined in: [packages/core/src/app/app.ts:92](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L92)

服务器权威时间（Unix 毫秒）。本地时钟玩家可改，体力恢复 / 日常重置 / 限时活动一律以此为准。

##### storeUrl

> `readonly` **storeUrl**: `string`

Defined in: [packages/core/src/app/app.ts:90](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L90)

##### wsUrl

> `readonly` **wsUrl**: `string`

Defined in: [packages/core/src/app/app.ts:87](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L87)

`'play'` 时有效：按客户端版本路由到的那个部署单元。

***

### LaunchContext

Defined in: [packages/core/src/app/app.ts:131](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L131)

#### Properties

##### bag

> `readonly` **bag**: `Map`\<`string`, `unknown`\>

Defined in: [packages/core/src/app/app.ts:134](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L134)

步骤间传值（[APP\_INFO](app.md#app_info)、登录态、服务器下发的配置…）。

##### config

> `readonly` **config**: [`AppConfig`](app.md#appconfig)

Defined in: [packages/core/src/app/app.ts:132](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L132)

#### Methods

##### report()

> **report**(`p`): `void`

Defined in: [packages/core/src/app/app.ts:135](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L135)

###### Parameters

###### p

[`LaunchProgress`](app.md#launchprogress)

###### Returns

`void`

***

### LaunchProgress

Defined in: [packages/core/src/app/app.ts:116](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L116)

#### Properties

##### messageKey?

> `readonly` `optional` **messageKey**: `string`

Defined in: [packages/core/src/app/app.ts:121](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L121)

i18n key —— kit 不出面向用户的文案，UI 自己译。

##### phase

> `readonly` **phase**: [`LaunchPhase`](app.md#launchphase)

Defined in: [packages/core/src/app/app.ts:117](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L117)

##### ratio?

> `readonly` `optional` **ratio**: `number`

Defined in: [packages/core/src/app/app.ts:119](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L119)

0..1，仅下载阶段有。

***

### LaunchStep

Defined in: [packages/core/src/app/app.ts:138](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L138)

#### Properties

##### name

> `readonly` **name**: `string`

Defined in: [packages/core/src/app/app.ts:139](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L139)

##### phase

> `readonly` **phase**: [`LaunchPhase`](app.md#launchphase)

Defined in: [packages/core/src/app/app.ts:140](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L140)

#### Methods

##### run()

> **run**(`ctx`): `Promise`\<`void` \| `"halt"`\>

Defined in: [packages/core/src/app/app.ts:142](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L142)

返回 `'halt'` = 到此为止（如 native 热更已 restart，等进程重来）。

###### Parameters

###### ctx

[`LaunchContext`](app.md#launchcontext)

###### Returns

`Promise`\<`void` \| `"halt"`\>

***

### RemoteVersions

Defined in: [packages/core/src/app/app.ts:107](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L107)

远程版本表：web 热更的全部输入。

#### Properties

##### bundles?

> `readonly` `optional` **bundles**: `Readonly`\<`Record`\<`string`, `string`\>\>

Defined in: [packages/core/src/app/app.ts:109](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L109)

bundle 名 → 版本（出包 md5）。

##### coreApiHash?

> `readonly` `optional` **coreApiHash**: `string`

Defined in: [packages/core/src/app/app.ts:113](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L113)

##### minAppVersion?

> `readonly` `optional` **minAppVersion**: `string`

Defined in: [packages/core/src/app/app.ts:112](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L112)

##### version?

> `readonly` `optional` **version**: `string`

Defined in: [packages/core/src/app/app.ts:111](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L111)

本次内容版本号，喂 compat 闸。

## Type Aliases

### DispatchAction

> **DispatchAction**: `"play"` \| `"update"` \| `"maintenance"`

Defined in: [packages/core/src/app/app.ts:76](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L76)

dispatcher 的判定结论。

***

### LaunchFailure

> **LaunchFailure**: \{ `error`: `unknown`; `kind`: `"network"`; `retryable`: `true`; \} \| \{ `kind`: `"needFullUpdate"`; `reason`: `string`; `storeUrl`: `string`; \} \| \{ `kind`: `"maintenance"`; `notice`: `string`; `retryable`: `true`; \} \| \{ `error`: `unknown`; `kind`: `"fatal"`; \}

Defined in: [packages/core/src/app/app.ts:125](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L125)

失败分类：给用户看的东西完全不同（重试 / 去商店 / 等公告 / 兜底），不能糊成一个 Error。

***

### LaunchPhase

> **LaunchPhase**: `"idle"` \| `"platform"` \| `"dispatch"` \| `"hotupdate"` \| `"tier"` \| `"shared"` \| `"lobby"` \| `"running"` \| `"failed"`

Defined in: [packages/core/src/app/app.ts:25](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L25)

启动阶段，也是进度上报的粒度。

## Variables

### APP

> `const` **APP**: [`Token`](di.md#tokent)\<[`App`](app.md#app)\>

Defined in: [packages/core/src/app/app.ts:496](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L496)

DI token：App 有必需配置、造不出无参默认，所以只有注册后才能 [getApp](app.md#getapp)。

***

### APP\_INFO

> `const` **APP\_INFO**: `"cck.app.info"` = `'cck.app.info'`

Defined in: [packages/core/src/app/app.ts:184](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L184)

`ctx.bag` 里 AppInfo 的键——platform 步写入，compat 闸与项目自定义步骤读取。

***

### DISPATCH

> `const` **DISPATCH**: `"cck.app.dispatch"` = `'cck.app.dispatch'`

Defined in: [packages/core/src/app/app.ts:187](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L187)

`ctx.bag` 里 [DispatchResult](app.md#dispatchresult) 的键——dispatch 步写入，业务读 wsUrl / cdnUrl / 服务器时间。

## Functions

### abortLaunch()

> **abortLaunch**(`failure`): `never`

Defined in: [packages/core/src/app/app.ts:202](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L202)

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

Defined in: [packages/core/src/app/app.ts:430](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L430)

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

Defined in: [packages/core/src/app/app.ts:258](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L258)

kit 的默认启动序列。项目可整体替换，或取本函数结果再插队自己的步骤（登录 / SDK / 公告）。

#### Parameters

##### deps?

[`AppDeps`](app.md#appdeps)

#### Returns

readonly [`LaunchStep`](app.md#launchstep)[]

***

### getApp()

> **getApp**(): [`App`](app.md#app)

Defined in: [packages/core/src/app/app.ts:498](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/app/app.ts#L498)

#### Returns

[`App`](app.md#app)

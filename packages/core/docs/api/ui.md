[**@cck/core API**](README.md)

***

[@cck/core API](README.md) / ui

# ui

## Interfaces

### IUIView

Defined in: [packages/core/src/ui/ui-view.ts:25](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/ui/ui-view.ts#L25)

渲染接缝：core 只认本接口（守零 cc 铁律）。engine 用 IAssetLoader 加载 prefab、
instantiate、挂到 layer 容器 Node、调界面钩子，返回不透明正整数 handle(>0)。
去重 / 生命周期 / 变体重建决策全在 core（ui-manager.ts），本接口只做 4 个原子 IO。

#### Methods

##### create()

> **create**(`spec`): `Promise`\<`number`\>

Defined in: [packages/core/src/ui/ui-view.ts:27](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/ui/ui-view.ts#L27)

加载并挂载一个 UI，返回 handle(>0)。失败抛错（UIManager 捕获转 false）。

###### Parameters

###### spec

[`UIViewSpec`](ui.md#uiviewspec)

###### Returns

`Promise`\<`number`\>

##### destroy()

> **destroy**(`handle`): `void`

Defined in: [packages/core/src/ui/ui-view.ts:29](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/ui/ui-view.ts#L29)

销毁指定 UI（未知 handle 为 no-op）。

###### Parameters

###### handle

`number`

###### Returns

`void`

##### restack()

> **restack**(`layer`, `handles`): `void`

Defined in: [packages/core/src/ui/ui-view.ts:33](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/ui/ui-view.ts#L33)

按给定顺序复位某层内的 z 序（部分重建后层内次序会错乱）。

###### Parameters

###### layer

`"back"` | `"hud"` | `"ui"` | `"popup"` | `"dialog"` | `"guide"` | `"loading"` | `"system"` | `"notify"` | `"top"`

###### handles

readonly `number`[]

###### Returns

`void`

##### saveState()

> **saveState**(`handle`): `unknown`

Defined in: [packages/core/src/ui/ui-view.ts:31](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/ui/ui-view.ts#L31)

重建前取界面自存状态（界面没实现则 undefined）。

###### Parameters

###### handle

`number`

###### Returns

`unknown`

***

### ResolvedUI

Defined in: [packages/core/src/ui/ui-registry.ts:81](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/ui/ui-registry.ts#L81)

`UIDef` 按变体解析后的实际资源坐标。

#### Properties

##### bundle?

> `readonly` `optional` **bundle**: `string`

Defined in: [packages/core/src/ui/ui-registry.ts:82](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/ui/ui-registry.ts#L82)

##### prefab

> `readonly` **prefab**: `string`

Defined in: [packages/core/src/ui/ui-registry.ts:83](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/ui/ui-registry.ts#L83)

***

### UIDef

Defined in: [packages/core/src/ui/ui-registry.ts:71](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/ui/ui-registry.ts#L71)

一个界面的登记。`bundle` / `prefab` 给函数即为变体解析：
- `prefab: v => v.orientation === 'landscape' ? 'Shop_land' : 'Shop'` —— 换 view（横竖屏两套布局）
- `bundle: v => v.skin === 'newyear' ? 'shop-newyear' : 'shop'` —— 整包换皮
  （Cocos 3.x 无 Prefab Variant / AB Variant，同名 prefab 放不同 bundle 是唯一干净的整包换皮路径）

#### Properties

##### bundle?

> `readonly` `optional` **bundle**: `string` \| (`v`) => `string`

Defined in: [packages/core/src/ui/ui-registry.ts:75](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/ui/ui-registry.ts#L75)

prefab 所在 Asset Bundle 名（省略 = 主包）。

##### layer?

> `readonly` `optional` **layer**: `"back"` \| `"hud"` \| `"ui"` \| `"popup"` \| `"dialog"` \| `"guide"` \| `"loading"` \| `"system"` \| `"notify"` \| `"top"`

Defined in: [packages/core/src/ui/ui-registry.ts:73](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/ui/ui-registry.ts#L73)

归属层，默认 `'ui'`。

##### prefab

> `readonly` **prefab**: `string` \| (`v`) => `string`

Defined in: [packages/core/src/ui/ui-registry.ts:77](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/ui/ui-registry.ts#L77)

prefab 路径。

***

### UIManager

Defined in: [packages/core/src/ui/ui-manager.ts:14](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/ui/ui-manager.ts#L14)

#### Methods

##### close()

> **close**(`uiId`): `boolean`

Defined in: [packages/core/src/ui/ui-manager.ts:22](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/ui/ui-manager.ts#L22)

关闭 UI（含加载中的：标记取消，create 落地即销毁）。返回是否原本被跟踪。

###### Parameters

###### uiId

`string`

###### Returns

`boolean`

##### closeAll()

> **closeAll**(): `void`

Defined in: [packages/core/src/ui/ui-manager.ts:33](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/ui/ui-manager.ts#L33)

关闭全部 UI。

###### Returns

`void`

##### closeByBundle()

> **closeByBundle**(`bundle`): `void`

Defined in: [packages/core/src/ui/ui-manager.ts:31](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/ui/ui-manager.ts#L31)

关闭所有「按**当前变体**解析后 bundle === 该名」的界面（含加载中的）。
卸载 / 换版本该 bundle 前必须先调：换版本后 cc 类表被静默替换，旧类实例即成孤儿。

###### Parameters

###### bundle

`string`

###### Returns

`void`

##### closeLayer()

> **closeLayer**(`layer`): `void`

Defined in: [packages/core/src/ui/ui-manager.ts:26](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/ui/ui-manager.ts#L26)

关闭某层全部 UI。

###### Parameters

###### layer

`"back"` | `"hud"` | `"ui"` | `"popup"` | `"dialog"` | `"guide"` | `"loading"` | `"system"` | `"notify"` | `"top"`

###### Returns

`void`

##### isOpen()

> **isOpen**(`uiId`): `boolean`

Defined in: [packages/core/src/ui/ui-manager.ts:24](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/ui/ui-manager.ts#L24)

是否被跟踪（含加载中）。

###### Parameters

###### uiId

`string`

###### Returns

`boolean`

##### layerOf()

> **layerOf**(`uiId`): `undefined` \| `"back"` \| `"hud"` \| `"ui"` \| `"popup"` \| `"dialog"` \| `"guide"` \| `"loading"` \| `"system"` \| `"notify"` \| `"top"`

Defined in: [packages/core/src/ui/ui-manager.ts:37](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/ui/ui-manager.ts#L37)

uiId 的归属层；未跟踪返回 undefined。

###### Parameters

###### uiId

`string`

###### Returns

`undefined` \| `"back"` \| `"hud"` \| `"ui"` \| `"popup"` \| `"dialog"` \| `"guide"` \| `"loading"` \| `"system"` \| `"notify"` \| `"top"`

##### list()

> **list**(): `string`[]

Defined in: [packages/core/src/ui/ui-manager.ts:35](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/ui/ui-manager.ts#L35)

当前被跟踪的 uiId（升序）。

###### Returns

`string`[]

##### open()

> **open**(`uiId`, `args`?): `Promise`\<`boolean`\>

Defined in: [packages/core/src/ui/ui-manager.ts:20](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/ui/ui-manager.ts#L20)

打开 UI（层内单实例：同 uiId 已开/加载中则不重复建）。「怎么开」全来自注册表（[registerUI](ui.md#registerui)）。
返回是否处于打开态：true=已打开或已在打开中并成功；false=未注册 / 加载失败。
并发重复 open 同 uiId 复用同一 inflight（对齐 AssetManager 去重）。

###### Parameters

###### uiId

`string`

###### args?

`unknown`

###### Returns

`Promise`\<`boolean`\>

##### setVariant()

> **setVariant**(`patch`): `Promise`\<`void`\>

Defined in: [packages/core/src/ui/ui-manager.ts:41](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/ui/ui-manager.ts#L41)

改变体 → 遍历打开中的界面，**只重建解析结果真的变了的**。同值为完全 no-op。

###### Parameters

###### patch

`Partial`\<[`UIVariant`](ui.md#uivariant)\>

###### Returns

`Promise`\<`void`\>

##### variant()

> **variant**(): [`UIVariant`](ui.md#uivariant)

Defined in: [packages/core/src/ui/ui-manager.ts:39](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/ui/ui-manager.ts#L39)

当前界面变体。

###### Returns

[`UIVariant`](ui.md#uivariant)

***

### UIManagerOptions

Defined in: [packages/core/src/ui/ui-manager.ts:44](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/ui/ui-manager.ts#L44)

#### Properties

##### logger?

> `optional` **logger**: [`ILogger`](logging.md#ilogger)

Defined in: [packages/core/src/ui/ui-manager.ts:47](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/ui/ui-manager.ts#L47)

##### variant?

> `optional` **variant**: [`UIVariant`](ui.md#uivariant)

Defined in: [packages/core/src/ui/ui-manager.ts:49](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/ui/ui-manager.ts#L49)

初始变体，默认竖屏 + `'default'` 皮肤。

##### view?

> `optional` **view**: [`IUIView`](ui.md#iuiview)

Defined in: [packages/core/src/ui/ui-manager.ts:46](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/ui/ui-manager.ts#L46)

渲染后端。默认：DI UI_VIEW，未注册则空实现。

***

### UIVariant

Defined in: [packages/core/src/ui/ui-registry.ts:45](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/ui/ui-registry.ts#L45)

界面变体：决定同一 uiId 实际取哪份资源。engine `resolutionModule` 自动灌 orientation，skin 由业务定。

#### Properties

##### orientation

> `readonly` **orientation**: [`Orientation`](ui.md#orientation-1)

Defined in: [packages/core/src/ui/ui-registry.ts:46](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/ui/ui-registry.ts#L46)

##### skin

> `readonly` **skin**: `string`

Defined in: [packages/core/src/ui/ui-registry.ts:47](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/ui/ui-registry.ts#L47)

##### tier

> `readonly` **tier**: `string`

Defined in: [packages/core/src/ui/ui-registry.ts:56](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/ui/ui-registry.ts#L56)

画质档位。跟 `skin` **完全对称**——不透明 string，kit 不知道有哪几档，
谁该分档由 `UIDef` 的 resolver 自己说（`bundle: v => \`shop-${v.tier}\``）。

由 `device-tier` 在启动期定一次，**会话内不变**；档位持有者刻意不给 `setTier()`。
项目真要运行中切，这道通用门是敞着的——kit 不提供不背书也不拦，重建时机 / 资源就绪 /
内存峰值三条风险自担（见 `docs/design/device-tiering-overview.md` §3.1）。

***

### UIViewSpec

Defined in: [packages/core/src/ui/ui-view.ts:5](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/ui/ui-view.ts#L5)

一个 UI 的实例化规格，交给 engine 渲染层。

#### Properties

##### args?

> `optional` **args**: `unknown`

Defined in: [packages/core/src/ui/ui-view.ts:15](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/ui/ui-view.ts#L15)

打开传参，透传给界面的 `onShow(args, state)`。

##### bundle?

> `optional` **bundle**: `string`

Defined in: [packages/core/src/ui/ui-view.ts:11](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/ui/ui-view.ts#L11)

prefab 所在 Asset Bundle 名（省略 = 内置 resources/主包）。

##### layer

> **layer**: `"back"` \| `"hud"` \| `"ui"` \| `"popup"` \| `"dialog"` \| `"guide"` \| `"loading"` \| `"system"` \| `"notify"` \| `"top"`

Defined in: [packages/core/src/ui/ui-view.ts:13](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/ui/ui-view.ts#L13)

归属层（决定挂到哪个层容器 Node，定 z 序）。

##### prefab

> **prefab**: `string`

Defined in: [packages/core/src/ui/ui-view.ts:9](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/ui/ui-view.ts#L9)

prefab 资源路径（已按变体解析）。

##### state?

> `optional` **state**: `unknown`

Defined in: [packages/core/src/ui/ui-view.ts:17](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/ui/ui-view.ts#L17)

变体重建时回灌的界面自存状态（来自上一实例的 `saveState`）。首次打开为 undefined。

##### uiId

> **uiId**: `string`

Defined in: [packages/core/src/ui/ui-view.ts:7](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/ui/ui-view.ts#L7)

UI 标识（单实例键）。

## Type Aliases

### Orientation

> **Orientation**: `"portrait"` \| `"landscape"`

Defined in: [packages/core/src/ui/ui-registry.ts:42](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/ui/ui-registry.ts#L42)

***

### UILayer

> **UILayer**: *typeof* [`UI_LAYERS`](ui.md#ui_layers)\[`number`\]

Defined in: [packages/core/src/ui/ui-registry.ts:37](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/ui/ui-registry.ts#L37)

## Variables

### DEFAULT\_UI\_LAYER

> `const` **DEFAULT\_UI\_LAYER**: [`UILayer`](ui.md#uilayer) = `'ui'`

Defined in: [packages/core/src/ui/ui-registry.ts:40](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/ui/ui-registry.ts#L40)

主界面层。注册时不写 `layer` 即落这里。

***

### DEFAULT\_UI\_VARIANT

> `const` **DEFAULT\_UI\_VARIANT**: [`UIVariant`](ui.md#uivariant)

Defined in: [packages/core/src/ui/ui-registry.ts:59](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/ui/ui-registry.ts#L59)

***

### UI\_LAYERS

> `const` **UI\_LAYERS**: readonly \[`"back"`, `"hud"`, `"ui"`, `"popup"`, `"dialog"`, `"guide"`, `"loading"`, `"system"`, `"notify"`, `"top"`\]

Defined in: [packages/core/src/ui/ui-registry.ts:14](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/ui/ui-registry.ts#L14)

UI 层：**自下而上，数组顺序即 z 序**。engine 启动时按本数组顺序把层容器一次建全
（懒建会让 z 序退化成「首次 open 的顺序」）。

⚠️ 这是一次性定死的东西：事后往中间插档会改变所有既有界面的相对次序，故一次给全。

***

### UI\_MANAGER

> `const` **UI\_MANAGER**: [`Token`](di.md#tokent)\<[`UIManager`](ui.md#uimanager)\>

Defined in: [packages/core/src/ui/ui-manager.ts:208](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/ui/ui-manager.ts#L208)

DI token：项目可 register 自己的 UIManager 覆盖默认。

***

### UI\_VIEW

> `const` **UI\_VIEW**: [`Token`](di.md#tokent)\<[`IUIView`](ui.md#iuiview)\>

Defined in: [packages/core/src/ui/ui-view.ts:37](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/ui/ui-view.ts#L37)

DI token：engine Bootstrap register cc 渲染适配；未注册时 UIManager 回退空实现（只发号、不出画面）。

## Functions

### clearUIRegistry()

> **clearUIRegistry**(): `void`

Defined in: [packages/core/src/ui/ui-registry.ts:103](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/ui/ui-registry.ts#L103)

清空登记（单测隔离用；正常运行期不需要）。

#### Returns

`void`

***

### createMemoryUIView()

> **createMemoryUIView**(): [`IUIView`](ui.md#iuiview)

Defined in: [packages/core/src/ui/ui-view.ts:43](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/ui/ui-view.ts#L43)

空渲染层（null object）：不建节点，只发号。默认实现（无 engine 时）+ 单测背书。
让 UIManager 的去重/生命周期/重建逻辑在 node 环境可脱引擎跑。

#### Returns

[`IUIView`](ui.md#iuiview)

***

### createUIManager()

> **createUIManager**(`opts`?): [`UIManager`](ui.md#uimanager)

Defined in: [packages/core/src/ui/ui-manager.ts:64](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/ui/ui-manager.ts#L64)

造 UIManager（纯逻辑、零 cc；实例化/销毁经 IUIView 接缝注入）。

#### Parameters

##### opts?

[`UIManagerOptions`](ui.md#uimanageroptions)

#### Returns

[`UIManager`](ui.md#uimanager)

***

### getUIDef()

> **getUIDef**(`uiId`): `undefined` \| [`UIDef`](ui.md#uidef)

Defined in: [packages/core/src/ui/ui-registry.ts:93](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/ui/ui-registry.ts#L93)

#### Parameters

##### uiId

`string`

#### Returns

`undefined` \| [`UIDef`](ui.md#uidef)

***

### getUIManager()

> **getUIManager**(): [`UIManager`](ui.md#uimanager)

Defined in: [packages/core/src/ui/ui-manager.ts:213](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/ui/ui-manager.ts#L213)

便捷取用：优先 tryResolve(UI_MANAGER)；未注册则进程级默认（空渲染层背书）。

#### Returns

[`UIManager`](ui.md#uimanager)

***

### getUIVariant()

> **getUIVariant**(): [`UIVariant`](ui.md#uivariant)

Defined in: [packages/core/src/ui/ui-manager.ts:218](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/ui/ui-manager.ts#L218)

当前界面变体（全局 UIManager 的）。

#### Returns

[`UIVariant`](ui.md#uivariant)

***

### layerOfDef()

> **layerOfDef**(`def`): `"back"` \| `"hud"` \| `"ui"` \| `"popup"` \| `"dialog"` \| `"guide"` \| `"loading"` \| `"system"` \| `"notify"` \| `"top"`

Defined in: [packages/core/src/ui/ui-registry.ts:119](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/ui/ui-registry.ts#L119)

取 def 的归属层（未写 = `'ui'`）。

#### Parameters

##### def

[`UIDef`](ui.md#uidef)

#### Returns

`"back"` \| `"hud"` \| `"ui"` \| `"popup"` \| `"dialog"` \| `"guide"` \| `"loading"` \| `"system"` \| `"notify"` \| `"top"`

***

### listUIDefs()

> **listUIDefs**(): `string`[]

Defined in: [packages/core/src/ui/ui-registry.ts:98](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/ui/ui-registry.ts#L98)

已登记的 uiId（升序）。

#### Returns

`string`[]

***

### registerUI()

> **registerUI**(`uiId`, `def`): `void`

Defined in: [packages/core/src/ui/ui-registry.ts:89](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/ui/ui-registry.ts#L89)

登记一个界面。同 uiId 重复登记后者覆盖（开发期热重载会重跑登记代码）。

#### Parameters

##### uiId

`string`

##### def

[`UIDef`](ui.md#uidef)

#### Returns

`void`

***

### resolveUIDef()

> **resolveUIDef**(`def`, `v`): [`ResolvedUI`](ui.md#resolvedui)

Defined in: [packages/core/src/ui/ui-registry.ts:111](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/ui/ui-registry.ts#L111)

纯函数：把 def 按变体解析成实际资源坐标。
**按需重建判定的唯一依据**——解析结果没变就不重建（转屏对普通界面零成本）。

#### Parameters

##### def

[`UIDef`](ui.md#uidef)

##### v

[`UIVariant`](ui.md#uivariant)

#### Returns

[`ResolvedUI`](ui.md#resolvedui)

***

### setUIVariant()

> **setUIVariant**(`patch`): `Promise`\<`void`\>

Defined in: [packages/core/src/ui/ui-manager.ts:223](https://gitlab.huanchanghuyu.com/luohao/creator-core-kit/-/blob/main/packages/core/src/ui/ui-manager.ts#L223)

改全局变体 → 按需重建受影响的界面。engine `resolutionModule` 在转屏回调里调它。

#### Parameters

##### patch

`Partial`\<[`UIVariant`](ui.md#uivariant)\>

#### Returns

`Promise`\<`void`\>

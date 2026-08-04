[**@cck/core API**](README.md)

***

[@cck/core API](README.md) / sceneflow

# sceneflow

## Interfaces

### FlowState

Defined in: [packages/core/src/sceneflow/sceneflow.ts:10](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/sceneflow/sceneflow.ts#L10)

单个流程状态。全部钩子按需实现；纯数据对象（非 cc.Component），可脱离引擎单测。

#### Properties

##### name

> `readonly` **name**: `string`

Defined in: [packages/core/src/sceneflow/sceneflow.ts:11](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/sceneflow/sceneflow.ts#L11)

#### Methods

##### onEnter()?

> `optional` **onEnter**(`from`, `flow`): `void`

Defined in: [packages/core/src/sceneflow/sceneflow.ts:13](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/sceneflow/sceneflow.ts#L13)

进入本态。from = 上一态名（初始进入为 ''）。flow 便于在钩子里自转 / 派发。

###### Parameters

###### from

`string`

###### flow

[`SceneFlow`](sceneflow.md#sceneflow)

###### Returns

`void`

##### onExit()?

> `optional` **onExit**(`to`): `void`

Defined in: [packages/core/src/sceneflow/sceneflow.ts:15](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/sceneflow/sceneflow.ts#L15)

离开本态。to = 将进入的态名（stop 收尾为 ''）。

###### Parameters

###### to

`string`

###### Returns

`void`

##### onPause()?

> `optional` **onPause**(): `void`

Defined in: [packages/core/src/sceneflow/sceneflow.ts:19](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/sceneflow/sceneflow.ts#L19)

被 push 压栈、让位给新态时（暂停语义，现场保留）。

###### Returns

`void`

##### onResume()?

> `optional` **onResume**(): `void`

Defined in: [packages/core/src/sceneflow/sceneflow.ts:21](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/sceneflow/sceneflow.ts#L21)

经 pop 从栈顶弹回、重新成为活动态时。

###### Returns

`void`

##### onUpdate()?

> `optional` **onUpdate**(`dt`): `void`

Defined in: [packages/core/src/sceneflow/sceneflow.ts:17](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/sceneflow/sceneflow.ts#L17)

每帧驱动（仅当前态收到），dt 秒。由 ITimer.onFrame / engine 每帧转发 update()。

###### Parameters

###### dt

`number`

###### Returns

`void`

***

### SceneFlow

Defined in: [packages/core/src/sceneflow/sceneflow.ts:25](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/sceneflow/sceneflow.ts#L25)

流程状态机（纯逻辑、零 cc）。真实场景 / bundle 加载等副作用由状态自身在钩子里发起。

#### Properties

##### current

> `readonly` **current**: `string`

Defined in: [packages/core/src/sceneflow/sceneflow.ts:27](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/sceneflow/sceneflow.ts#L27)

当前态名；未启动 / 无当前态为 ''。

##### stackDepth

> `readonly` **stackDepth**: `number`

Defined in: [packages/core/src/sceneflow/sceneflow.ts:29](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/sceneflow/sceneflow.ts#L29)

pushdown 栈深。

##### started

> `readonly` **started**: `boolean`

Defined in: [packages/core/src/sceneflow/sceneflow.ts:31](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/sceneflow/sceneflow.ts#L31)

是否已 start。

#### Methods

##### add()

> **add**(`state`): [`SceneFlow`](sceneflow.md#sceneflow)

Defined in: [packages/core/src/sceneflow/sceneflow.ts:34](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/sceneflow/sceneflow.ts#L34)

注册状态。名字重复 / 为通配保留名 → 告警忽略。返回自身便于链式。

###### Parameters

###### state

[`FlowState`](sceneflow.md#flowstate)

###### Returns

[`SceneFlow`](sceneflow.md#sceneflow)

##### addTransition()

> **addTransition**(`from`, `event`, `to`): `void`

Defined in: [packages/core/src/sceneflow/sceneflow.ts:40](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/sceneflow/sceneflow.ts#L40)

登记事件转移 (from,event)→to。from 可为 ANY_STATE。to 未注册 → 告警忽略；重复 → 覆盖 + 告警。

###### Parameters

###### from

`string`

###### event

`string`

###### to

`string`

###### Returns

`void`

##### dispatch()

> **dispatch**(`event`): `boolean`

Defined in: [packages/core/src/sceneflow/sceneflow.ts:42](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/sceneflow/sceneflow.ts#L42)

按当前态派发事件：先查 (cur,event) 再查 (ANY_STATE,event)，命中转移返回 true，无匹配返回 false。

###### Parameters

###### event

`string`

###### Returns

`boolean`

##### has()

> **has**(`name`): `boolean`

Defined in: [packages/core/src/sceneflow/sceneflow.ts:52](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/sceneflow/sceneflow.ts#L52)

name 是否已注册。

###### Parameters

###### name

`string`

###### Returns

`boolean`

##### isIn()

> **isIn**(`name`): `boolean`

Defined in: [packages/core/src/sceneflow/sceneflow.ts:50](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/sceneflow/sceneflow.ts#L50)

当前是否处于 name。

###### Parameters

###### name

`string`

###### Returns

`boolean`

##### pop()

> **pop**(): `void`

Defined in: [packages/core/src/sceneflow/sceneflow.ts:46](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/sceneflow/sceneflow.ts#L46)

弹栈恢复：cur.onExit → 弹栈顶 → 切回 → onResume。栈空 / 转换中 → 告警 no-op。

###### Returns

`void`

##### push()

> **push**(`name`): `void`

Defined in: [packages/core/src/sceneflow/sceneflow.ts:44](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/sceneflow/sceneflow.ts#L44)

压栈进入（暂停语义）：cur.onPause → 入栈 → new.onEnter。未知 / 转换中 / 无当前态 / 栈满 → 告警 no-op。

###### Parameters

###### name

`string`

###### Returns

`void`

##### start()

> **start**(`initial`): `void`

Defined in: [packages/core/src/sceneflow/sceneflow.ts:36](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/sceneflow/sceneflow.ts#L36)

启动：进入 initial 态。未注册名 / 已启动 → 告警 no-op。

###### Parameters

###### initial

`string`

###### Returns

`void`

##### stop()

> **stop**(): `void`

Defined in: [packages/core/src/sceneflow/sceneflow.ts:54](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/sceneflow/sceneflow.ts#L54)

停机：exit 当前态、清空栈与待处理队列（保留状态注册），started 归 false。

###### Returns

`void`

##### transitionTo()

> **transitionTo**(`name`): `void`

Defined in: [packages/core/src/sceneflow/sceneflow.ts:38](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/sceneflow/sceneflow.ts#L38)

转换到 name：exit(cur) → 切 → enter(new)。未知名 → 告警 no-op；转换中调 → 入队，当前转换后按序处理。

###### Parameters

###### name

`string`

###### Returns

`void`

##### update()

> **update**(`dt`): `void`

Defined in: [packages/core/src/sceneflow/sceneflow.ts:48](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/sceneflow/sceneflow.ts#L48)

驱动当前态 onUpdate（每帧转发）。

###### Parameters

###### dt

`number`

###### Returns

`void`

***

### SceneFlowOptions

Defined in: [packages/core/src/sceneflow/sceneflow.ts:57](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/sceneflow/sceneflow.ts#L57)

#### Properties

##### logger?

> `optional` **logger**: [`ILogger`](logging.md#ilogger)

Defined in: [packages/core/src/sceneflow/sceneflow.ts:62](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/sceneflow/sceneflow.ts#L62)

##### onChange()?

> `optional` **onChange**: (`from`, `to`) => `void`

Defined in: [packages/core/src/sceneflow/sceneflow.ts:61](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/sceneflow/sceneflow.ts#L61)

每次完成一次转换后回调 (from, to)（含初始进入，from 为 ''）。

###### Parameters

###### from

`string`

###### to

`string`

###### Returns

`void`

##### states?

> `optional` **states**: [`FlowState`](sceneflow.md#flowstate)[]

Defined in: [packages/core/src/sceneflow/sceneflow.ts:59](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/sceneflow/sceneflow.ts#L59)

初始注册的状态集（等价逐个 add）。

## Variables

### ANY\_STATE

> `const` **ANY\_STATE**: `"*"` = `'*'`

Defined in: [packages/core/src/sceneflow/sceneflow.ts:4](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/sceneflow/sceneflow.ts#L4)

事件转移表的通配 from 状态名（保留名；状态不得取此名）。

## Functions

### createSceneFlow()

> **createSceneFlow**(`opts`?): [`SceneFlow`](sceneflow.md#sceneflow)

Defined in: [packages/core/src/sceneflow/sceneflow.ts:66](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/sceneflow/sceneflow.ts#L66)

造一个流程状态机。

#### Parameters

##### opts?

[`SceneFlowOptions`](sceneflow.md#sceneflowoptions)

#### Returns

[`SceneFlow`](sceneflow.md#sceneflow)

[**@cck/core API**](README.md)

***

[@cck/core API](README.md) / timer

# timer

## Interfaces

### ITimer

Defined in: [packages/core/src/timer/timer.ts:6](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/timer/timer.ts#L6)

消费面：业务代码拿到的定时器视图（看不到 tick，防误调驱动）。

#### Properties

##### now

> `readonly` **now**: `number`

Defined in: [packages/core/src/timer/timer.ts:8](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/timer/timer.ts#L8)

累计逻辑时间（秒）。受 timeScale/pause 影响：暂停时不增长。

##### paused

> **paused**: `boolean`

Defined in: [packages/core/src/timer/timer.ts:12](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/timer/timer.ts#L12)

暂停开关：true 时 effectiveDt=0，所有定时/onFrame 冻结（不推进、不触发）。默认 false。

##### timeScale

> **timeScale**: `number`

Defined in: [packages/core/src/timer/timer.ts:10](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/timer/timer.ts#L10)

时间缩放（>=0，非法值夹到 0）。tick 时 effectiveDt = paused ? 0 : dt * timeScale。默认 1。

#### Methods

##### clear()

> **clear**(): `void`

Defined in: [packages/core/src/timer/timer.ts:22](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/timer/timer.ts#L22)

清空全部定时任务 + 帧回调（不重置 now/timeScale/paused）。场景切换重置用。

###### Returns

`void`

##### delay()

> **delay**(`seconds`, `cb`): [`Disposer`](eventbus.md#disposer)

Defined in: [packages/core/src/timer/timer.ts:15](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/timer/timer.ts#L15)

seconds 后触发一次 cb；seconds<=0 视为下次 tick 触发。返回 disposer（调用即取消，幂等）。

###### Parameters

###### seconds

`number`

###### cb

() => `void`

###### Returns

[`Disposer`](eventbus.md#disposer)

##### interval()

> **interval**(`seconds`, `cb`): [`Disposer`](eventbus.md#disposer)

Defined in: [packages/core/src/timer/timer.ts:17](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/timer/timer.ts#L17)

每 seconds 触发 cb（首触发在 seconds 后）。seconds<=0 抛错（防退化死循环）。返回 disposer。

###### Parameters

###### seconds

`number`

###### cb

() => `void`

###### Returns

[`Disposer`](eventbus.md#disposer)

##### onFrame()

> **onFrame**(`cb`): [`Disposer`](eventbus.md#disposer)

Defined in: [packages/core/src/timer/timer.ts:19](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/timer/timer.ts#L19)

每次 tick 触发 cb，收 effectiveDt（秒）。返回 disposer。冻结帧（effectiveDt<=0）不触发。

###### Parameters

###### cb

(`dt`) => `void`

###### Returns

[`Disposer`](eventbus.md#disposer)

***

### ITimerDriver

Defined in: [packages/core/src/timer/timer.ts:26](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/timer/timer.ts#L26)

驱动面：只有游戏循环 driver（engine）/测试持有，负责推进时间。

#### Methods

##### tick()

> **tick**(`dt`): `void`

Defined in: [packages/core/src/timer/timer.ts:28](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/timer/timer.ts#L28)

推进时间：engine 每帧喂真实 dt（秒）；测试手动调。按 effectiveDt 推进 now、触发到期任务与 onFrame。

###### Parameters

###### dt

`number`

###### Returns

`void`

## Variables

### TIMER

> `const` **TIMER**: [`Token`](di.md#tokent)\<[`ITimer`](timer.md#itimer)\>

Defined in: [packages/core/src/timer/timer.ts:172](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/timer/timer.ts#L172)

DI token：注入的是消费面 ITimer（engine Bootstrap register 一个 TimerService）。

## Functions

### createTimer()

> **createTimer**(`opts`?): [`ITimer`](timer.md#itimer) & [`ITimerDriver`](timer.md#itimerdriver)

Defined in: [packages/core/src/timer/timer.ts:165](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/timer/timer.ts#L165)

造定时器（同时实现消费面 + 驱动面）。onError 默认经 getLogger('Timer').error 上报（错误隔离）。

#### Parameters

##### opts?

###### onError?

(`err`) => `void`

#### Returns

[`ITimer`](timer.md#itimer) & [`ITimerDriver`](timer.md#itimerdriver)

***

### getTimer()

> **getTimer**(): [`ITimer`](timer.md#itimer)

Defined in: [packages/core/src/timer/timer.ts:185](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/timer/timer.ts#L185)

便捷取用：优先 getRootContainer().tryResolve(TIMER)；未注册则用进程级默认 TimerService。
⚠ 与 Logger/EventBus 不同：ITimer **必须有人 tick 才走时**——engine Bootstrap 须 register(TIMER,…)
并把 cc.director 的 dt 接到该实例的 tick()。默认 fallback 实例无人驱动则定时永不触发。

#### Returns

[`ITimer`](timer.md#itimer)

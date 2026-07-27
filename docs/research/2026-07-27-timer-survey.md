---
类型: research（横评快照）
状态: 已定稿
摘要: ITimer（定时器/帧回调抽象）横向调研——对标 godot-core-kit frame_scheduler/game_clock + Cocos scheduler/director + setTimeout + Unity Time + tween.js，沉淀 creator-core-kit ITimer v1 的选型依据（核心：外部 tick(dt) 驱动的纯逻辑 TimerService）。
何时读: 设计 / 评审 ITimer 模块，或想知道"为什么计时器要外部 tick 驱动"时。
日期: 2026-07-27
依赖: 无（为 docs/design/modules/timer.md 提供选型佐证）
---

# ITimer（定时器 / 帧回调）横评（CC/TS）

> 目的：为 creator-core-kit 的 `ITimer` 定选型。遵循「设计前先横向调研」的约定，对标同作者
> [[godot-core-kit-reference]] 的 `frame_scheduler.gd` / `game_clock.gd` + Cocos/市面方案，逐轴对比给 v1 结论。

## 0. 背景约束（creator-core-kit 专属）

- **铁律**：ITimer 落 `packages/core`，**零 `cc`**，且架构总纲 §3.1 明确「Core 不直接用 `cc.director`/`setTimeout`」→ 计时能力必须**接口化 + 外部驱动**。
- **诉求**：core 业务逻辑要能「延迟执行 / 周期执行 / 每帧回调 / 拿 dt & 累计时间」，但**真实时间源**（游戏循环 dt）由 engine 注入。
- **可测**：core 的默认实现必须能脱 Creator 在 node 里确定性单测——即时间推进要能被测试**手动驱动**，不能依赖真实墙钟/rAF。
- 与前序一致：`TIMER` token + DI 注入 + `getTimer()` 便捷（对齐 [[logger]] `LOGGER` / [[eventbus]] `EVENT_BUS` 范式）；回调用 disposer 退订、快照派发、错误隔离（沿用 EventBus 已验证的接缝）。

## 1. 候选横评

| 方案 | 驱动源 | 单位 | 能力 | timeScale/pause | 生命周期清理 | 可测(脱引擎) | 备注 |
|---|---|---|---|---|---|---|---|
| **godot frame_scheduler**（对标） | `_process`（渲染帧） | 帧 | `every_n` 降频错峰 + `queue_task` 每帧预算队列 | ❌（纯帧数） | `Callable.is_valid` 自动剪除 | ✅ 注入 `_ticks_usec_func` 假时钟 | 性能设施（低频 AI 错峰 / 分帧消化），非通用定时 |
| **godot game_clock**（对标） | `_process` + `_accum` | 游戏分钟 | 世界日历(年季日时分)混合推进 | ✅ `time_scale`/`paused` | — | ✅ untyped 脱门面测 | **时间驱动 + accum 累加**模型是 ITimer 的直接参照 |
| **cc `Component.schedule`** | `cc.Scheduler`（director 持有） | 秒 | `schedule(cb,interval,repeat,delay)`/`scheduleOnce`/`unschedule` | ✅ `Scheduler.setTimeScale` | 节点 destroy/disable 自动停 | ❌ 强依赖 director | 属 `cc`，语义最贴游戏；**不能进 core** |
| **cc.director EVENT_*_UPDATE** | 引擎主循环 | 秒(dt) | 每帧回调 + dt 源 | ❌ | 手动 `off` | ❌ 属 cc | **engine 侧 dt 转发点**（喂给 core tick） |
| **setTimeout/setInterval** | 宿主事件循环 | ms | 一次/周期 | ❌（不受游戏暂停） | `clearTimeout` | 部分（假定时器 mock） | 后台节流/不准、小游戏差异；架构总纲明令 core 不用 |
| **Unity Time / Coroutine** | 引擎循环 | 秒 | `deltaTime`/`timeScale`/`InvokeRepeating`/协程 | ✅ 全局 `Time.timeScale` | — | — | 参照：全局 timeScale + unscaledDeltaTime 双轨 |
| **@tweenjs/tween.js** | **外部 `update(time)`** | ms | 缓动 | 靠传入 time | `remove` | ✅ 纯 JS，外部驱动 | **「外部驱动 → 可测」正是我们要的模式** |

## 2. 逐轴结论（v1 取舍）

### 2.1 驱动模型 —— **外部 `tick(dt)` 驱动的纯逻辑 TimerService**（本模块灵魂）
所有引擎内置计时器（cc/unity/godot）本质都是「引擎循环每帧喂 dt → 推进内部任务」。v1 把**驱动源抽象成一个 `tick(dt)` 入口**：
- **core** 的 `TimerService` 只认 `tick(dt)`——内部累加时间、到期触发任务。不碰 `cc.director`/`rAF`/`setTimeout`。
- **engine** 在 `cc.director.on(Director.EVENT_AFTER_UPDATE, ...)`（或一个常驻 Component 的 `update(dt)`）里调 `timer.tick(dt)`，把真实 dt 喂进来。
- **测试**直接 `timer.tick(0.016)` 推进虚拟时间 → 确定性、零 cc、秒级反馈。
这一招同时满足「零 cc 铁律 + 可单测 + 平台无关 + 支持暂停/缩放」，是 tween.js/game_clock 验证过的模式。

### 2.2 时间单位 —— **秒（float）**
对齐引擎惯例（cc dt/schedule、godot delta、Unity 均秒）；`delay(0.2, cb)` 表 200ms。避免 ms/秒混用坑。`now()` 返回累计逻辑秒。

### 2.3 能力集 —— **delay(一次性) / interval(周期) / onFrame(每帧) / now()**
覆盖 90% 游戏定时需求，语义借 cc `scheduleOnce`/`schedule`：
- `delay(sec, cb)`：sec 后触发一次。
- `interval(sec, cb)`：每 sec 触发（首触发在 sec 后）。
- `onFrame(cb)`：每次 tick 回调，收 `dt`（帧率无关逻辑、自定义推进）。
- `now()`：累计逻辑时间（秒），供计算时间差。

### 2.4 timeScale / pause —— **有（对齐 game_clock/Unity）**
`tick(dt)` 内 `effectiveDt = paused ? 0 : dt * timeScale`。定时任务与 onFrame 都按 **effectiveDt** 推进——即游戏暂停/慢放时倒计时同步暂停/变慢（符合游戏内定时直觉）。真实不受缩放的定时（UI 动画）留 **unscaled 选项**给后续（Unity 的 unscaledDeltaTime 双轨），首版砍。

### 2.5 退订 & 派发 & 错误 —— **沿用 EventBus 已验证接缝**
- `delay/interval/onFrame` 返回 **disposer**（调用即取消），对齐 [[eventbus]]；同时 handle 幂等。
- `tick` 内**快照**当前任务再触发：回调里新增/取消只影响下次 tick（重入安全，照抄 frame_scheduler「keys() 本帧快照」）。
- 回调抛异常**隔离** + 经 [[logger]] `getLogger('Timer').error` 上报（一个坏定时不拖垮整轮）。

### 2.6 DI 集成 —— **TIMER token + getTimer()，但强调"必须有人 tick"**
`TIMER` token 注入 + `getTimer()` 便捷（对齐 Logger/EventBus）。**差异点**：ITimer 默认实现**无外部 tick 就不走时**（不像 Logger/EventBus 开箱即用）——engine Bootstrap 必须 `register(TIMER, timerService)` 并接上 `cc.director` 驱动。`getTimer()` 未注册时仍返回进程级默认（可注册任务、可被调用方自行 tick），但文档明示驱动责任。

## 3. 首版 YAGNI（明确砍掉）

- **帧降频 `every_n` 错峰 + 每帧预算任务队列 `budget`**（godot frame_scheduler 的性能设施）→ 独立 **FrameScheduler** 模块后续做，不塞进通用 ITimer。
- **世界日历时钟**（年季日时分，game_clock）→ 属游戏内容层，非地基；需要时按 game_clock 移植为独立模块。
- **unscaled（不受 timeScale）定时**、**真实墙钟时间 `Date.now`**（离线结算归 SaveManager/离线模块）、**缓动 tween**（View 层）、**协程/async 定时**→ 全砍，后续按需。

## 4. 对 creator-core-kit 的最终建议

core 自研 **`ITimer` 接口 + 外部 `tick(dt)` 驱动的 `TimerService` 默认实现**：能力 = `delay/interval/onFrame/now` + `timeScale/pause`，退订 disposer、tick 快照重入安全、错误隔离经 ILogger、`TIMER` token/`getTimer()`。engine 用 `cc.director` EVENT_AFTER_UPDATE 转发 dt。frame_scheduler 的降频/预算队列与 game_clock 的世界日历留独立模块后续。详见 `docs/design/modules/timer.md`。

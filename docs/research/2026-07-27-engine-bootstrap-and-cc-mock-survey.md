---
调研: engine 半 Bootstrap 接线 + cc mock 脚手架
状态: 已定稿
摘要: 横评「vitest 里怎么 mock cc / tsc 怎么拿 cc 类型 / engine 启动链怎么接 cc.director 与日志」，为 Bootstrap engine 半 + cc mock 脚手架定型。
何时读: 实现/修改 engine 侧适配（CcLogger、帧驱动、引导入口）或搭建 cc mock 测试脚手架前。
日期: 2026-07-27
依赖: Bootstrap core 半（boot/coreModule/KIT）、Logger（ILogger/LogSink/createConsoleLogger）、ITimer（ITimerDriver）
---

# engine 半 Bootstrap 接线 + cc mock 脚手架 —— 横向调研

> 目标：engine 是第一个真正 `import 'cc'` 的包。要解决三件事：(1) vitest 单测里 `cc` 怎么替换成可断言的 mock；(2) `tsc -b` 怎么拿到 `cc` 类型（不依赖机器上的 Creator 安装路径）；(3) engine 启动链怎么把 `cc.director` 帧循环、cc 日志接进 core 的 Bootstrap。

## 0. 现状（实证）

- Creator 3.8.7 在每个工程 `temp/declarations/cc.d.ts` 生成的其实只是一行 `/// <reference path="C:\ProgramData\cocos\...\3.8.7\...\bin\.declarations\cc.d.ts"/>` —— **真类型在 Creator 安装目录，路径机器相关、不可提交**。
- 真声明里已核对到本轮要用的 cc API（引自安装目录 `cc.d.ts`）：
  - `export function log/warn/error/debug(...data: unknown[]): void`（**无 `info`**）；`export function assert(...)`。
  - `export const director: Director`、`export const game: Game`；`Director extends EventTarget`。
  - `EventTarget.on(type: string, callback: Function, target?: any): void|null`、`off(type, callback, target?)`。
  - **Director 无 `EVENT_UPDATE`**，只有 `EVENT_BEFORE_UPDATE` / `EVENT_AFTER_UPDATE`（帧逻辑挂 `EVENT_AFTER_UPDATE`——引擎与组件 update 之后）。
  - `game.deltaTime: number`（当前帧 dt，秒）。
- eslint 的 core-no-cc 规则只作用于 `packages/core/**`；**engine 允许 import cc** ✓。

## 1. cc 类型来源（给 tsc）横评

| 方案 | 可提交/可移植 | 精确度 | 成本 | 结论 |
|---|---|---|---|---|
| A. 引用 Creator 安装目录声明（`types`/`reference` 指绝对路径） | ❌ 机器相关 | 满（全量 cc） | 0 | 否：不可提交、换机即碎 |
| B. `@cocos/creator-types` npm 包 | ✅ | 面向扩展开发，非纯运行时 `cc` 模块，版本/表面不完全对齐 | 依赖引入 | 否：表面不匹配、过重 |
| C. 手写 `cc.d.ts`（`declare module 'cc'` ambient stub） | ✅ | 仅覆盖用到的 | 低 | 可，但与 mock 形状重复维护两份 |
| **D. mock.ts 兼作类型（tsconfig `paths: {cc→mock}`）** | ✅ | 仅覆盖用到的、**编译期强制 mock 完整** | 低 | **选它**：一份真源（下节） |

**选 D**：写一个真实的 `mock/cc.ts`（带类型的 TS 文件），engine `tsconfig.json` 用 `paths` 把 `cc` 解析到它 → tsc 拿类型、且 engine 若用到 mock 没有的 cc API 会**编译报错**（反向逼 mock 完整、且逼 engine 只用被 mock 的最小面）。真机上 Creator 编译 engine 源码时 `cc` 是 external（Creator 提供真 cc），我们的 `paths` 不影响它。

## 2. cc 运行时 mock（给 vitest）横评

| 方案 | always-on | 可断言 | 与类型统一 | 结论 |
|---|---|---|---|---|
| **vitest `resolve.alias: {cc→mock}`** | ✅ 全局 | ✅ mock 是真模块，导出 spy 友好的单例 | ✅ 与 D 同一文件 | **选它** |
| `vi.mock('cc', factory)` | ❌ 每文件/每测声明 | ✅ | ✗ 工厂内联、与类型两份 | 否：样板多 |
| jest `moduleNameMapper`（社区常见） | ✅ | ✅ | — | 类比参照（我们用 vitest 的等价物 alias） |

**选 alias**：`resolve.alias` 把 `cc` 指向同一个 `mock/cc.ts`。**类型（tsconfig paths）与运行时（vitest alias）指向同一文件**，单一真源。mock 里 `director`/`game` 是带真 `on/off/emit` 的单例，测试 `afterEach` 复位（`resetCcMock()`），与 core 测试 `afterEach unregister` 同风格。

社区参照：Cocos 社区脱引擎单测普遍走 jest + `moduleNameMapper` 映射到一个手写 cc stub；oops-framework 基本不做脱引擎单测（逻辑与 cc 耦合）。我们用 vitest alias 达到同一效果，且 mock 兼作类型源比社区多一层一致性保证。

## 3. engine 半接线设计（该抄该砍）

- **CcLogger = sink over cc，复用 core 的 ConsoleLogger**：不重写 level/child/prefix 逻辑，只把 `LogSink` 换成 cc 版（`debug→cc.debug`、`info→cc.log`、`warn→cc.warn`、`error→cc.error`），`createCcLogger()` 内部 `createConsoleLogger({ sink: ccSink })`。**这就是理想的「engine 薄壳」**：逻辑全在 core，engine 只路由到 cc。
- **loggerModule(logger?)**：`KitModule`，`hasLocal(LOGGER)` 守卫下注册 `LOGGER→CcLogger`。放模块数组首位 → 后续模块日志走 cc。
- **帧驱动 driveWithDirector(driver)**：订阅 `Director.EVENT_AFTER_UPDATE`，回调里读 `game.deltaTime` 调 `driver.tick(dt)`；返回 `Disposer`（`director.off`）。bootCoreKit 内用一个内联 `KitModule` 承载它，`stop()` 时解绑 → 纳入生命周期。
- **bootCoreKit(opts?)**：造 `timer=createTimer()` → `boot([loggerModule(), coreModule({timer}), driveModule(timer), ...user])` → 返回 `Kit`。一次打通「日志→事件总线/定时器→帧驱动」。
- **每帧逻辑不进 Bootstrap**：模块经 `getTimer().onFrame(cb)` 订阅（与 core 决策一致，不重复 tick 分发）。
- **砍（YAGNI / 待定）**：`CckBootstrap` cc.Component（挂空引导场景）需 `experimentalDecorators` + mock 里补 `Component`/`_decorator` → 显著放大 mock 与 tsconfig；而其逻辑仅 `onLoad(){ bootCoreKit() }`，无实质可测价值。建议本轮**只出 `bootCoreKit()` 函数**，组件留作项目侧 3 行封装 / 下轮随 apps/demo 落。详见设计 Open Questions。

## 4. 结论（供设计采纳）

- **cc mock 单一真源**：`packages/engine/test/mocks/cc.ts`；tsconfig `paths` + vitest `resolve.alias` 双指它。
- **engine 半**：`createCcLogger`（sink over cc，复用 ConsoleLogger）+ `loggerModule` + `driveWithDirector`（`EVENT_AFTER_UPDATE` + `game.deltaTime`，返回 Disposer）+ `bootCoreKit`（组合根一键启动 + 帧驱动纳入生命周期）。
- **coverage**：engine 用 mock 另测，沿用「不计入 core 硬门槛」的既定切分（vitest.config coverage.include 仍仅 core）。
- **CckBootstrap 组件**：本轮建议缓，待拍板。

> 定稿（2026-07-27）：确认 **engine 单测走纯 JS（node）+ 封顶 cc mock，不真起浏览器**；并立**防 mock creep 硬规矩**（mock 只准放常量/无副作用纯函数/事件 on-off，重 cc 走集成）。决策记录见 **ADR-0002**。CckBootstrap 组件缓做。

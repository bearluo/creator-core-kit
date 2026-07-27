---
模块: logger
所在包: packages/core（接口 + 零 cc 的 ConsoleLogger 默认实现） + packages/engine（可选 cc.log 实现）
状态: 已实现          # 草案 → 评审中 → 已定稿 → 已实现
摘要: ILogger 日志接口 + 零 cc 的 ConsoleLogger 默认实现 + DI 注入（LOGGER token），支持级别过滤 / 标签 / 可换 sink。
何时读: 打日志、换日志输出目标、按模块加标签、engine 接入平台日志（cc.log/写文件）时。
日期: 2026-07-27
依赖: di-container（LOGGER 走 DI 注入/覆盖）；架构总纲 §3.1 `ILogger`
---

# Logger 设计文档

## TL;DR

core 定义 `ILogger` 接口 + `LogLevel` + `LogSink`（输出抽象），并自带零 cc 的 `ConsoleLogger` 默认实现（用 `globalThis.console`，全平台可用）。通过 DI 的 `LOGGER` token 注入/覆盖：业务用 `getLogger(tag?)` 取用，engine 可在 Bootstrap `register(LOGGER, ccLogger)` 覆盖成 cc.log（原生写日志文件等）。支持级别过滤（生产降噪）、标签前缀（定位来源）、可注入 fake sink（可测）。是「接口 + DI 注入」的第一个实战示范。

## Purpose（目标与定位）

- **做什么**：统一日志出口。core/业务打日志走 `ILogger`，不直接 `console`/`cc.log`，从而可切换目标、可过滤级别、可测。
- **定位/取舍**：日志是**最基础设施**——core 独立运行/自测时也要能打日志，不能等 engine 注入。故 **core 自带默认 `ConsoleLogger`（零 cc）**；engine 覆盖是可选增强（平台日志文件、发布屏蔽）。这也让它成为「core 定义接口 + DI 注入实现」闭环的最小示范。
- **YAGNI（首版砍）**：时间戳/结构化 JSON 日志/远程上报/落盘——都推到自定义 `LogSink` 或 engine 实现，core 首版只做级别 + 标签 + 转发。

## Public API（TypeScript 精确签名）

```ts
export enum LogLevel { Debug = 0, Info = 1, Warn = 2, Error = 3, Silent = 4 }

/** 输出目标抽象（console-like）。默认 = globalThis.console；测试注入 fake 可断言。 */
export interface LogSink {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export interface ILogger {
  /** 当前级别（严格低于此级别的调用被丢弃）。 */
  readonly level: LogLevel;
  /** 运行时调级别；child 与 root 共享同一级别状态，一处生效。 */
  setLevel(level: LogLevel): void;
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  /** 派生带标签子 logger：输出前缀 [tag]（多级叠加 [a][b]），共享级别与 sink。 */
  child(tag: string): ILogger;
}

/** DI token：engine/项目可 register 覆盖默认实现（见 di-container）。 */
export const LOGGER: Token<ILogger>;

/** 造 ConsoleLogger（零 cc）。level 默认 Info；sink 默认 globalThis.console。 */
export function createConsoleLogger(opts?: {
  level?: LogLevel;
  tag?: string;
  sink?: LogSink;
}): ILogger;

/**
 * 便捷取用：优先 getRootContainer().tryResolve(LOGGER)；未注册则用进程级默认 ConsoleLogger。
 * 传 tag → 返回其 child(tag)。engine register(LOGGER,…) 覆盖后自动改走注入实现。
 */
export function getLogger(tag?: string): ILogger;
```

## Behavior & data flow（行为与数据流）

- **`ConsoleLogger`**：持共享级别状态 `_state = { level }`；`child(tag)` 传同一 `_state` + 叠加 tag → `setLevel` 一处改、root 与所有 child 一起生效。
- **级别过滤**：`debug()` 仅当 `level <= Debug` 才转发；`info/warn/error` 同理；`Silent` 全关。
- **标签**：输出时把 `[tag]`（多级 `[a][b]`）插到 args 最前，转发给 `sink` 对应方法。
- **sink**：默认 `globalThis.console`；注入 fake（如 `{ debug: vi.fn(), … }`）即可断言调用与参数——**核心可测接缝**。
- **`getLogger`**：`getRootContainer().tryResolve(LOGGER)` 命中则用注入实现，否则用一个懒建的进程级默认 `ConsoleLogger`（**不自动注册进容器**，避免副作用）；`tag` 则 `.child(tag)`。→ engine `register(LOGGER, ccLogger)` 之后，`getLogger` 自动切到 cc 实现。
- **与 cc 边界**：`ConsoleLogger` 零 cc（`console` 全平台有）。engine 另实现 `CcLogger`（用 `cc.log/warn/error`，原生可写日志文件/发布屏蔽），Bootstrap 时 `register(LOGGER, new CcLogger())` 覆盖。core 只认 `ILogger` + `LOGGER` token。

## Key design decisions（决策表）

| # | 维度 | 选项 | 推荐默认 | 一句话理由 |
|---|---|---|---|---|
| 1 | 默认实现位置 | 只接口靠 engine 注入 / **core 自带 ConsoleLogger** | **core 自带** | 日志最基础，core 独立运行/自测需能打，零 cc（用 console） |
| 2 | 输出抽象 | 直接 console / **LogSink 接口** | **LogSink** | 可测（注入 fake）、可换目标（文件/远程） |
| 3 | 级别控制 | 无 / **LogLevel + 运行时 setLevel** | **有** | 生产降噪、开发全开；child 共享一处生效 |
| 4 | 标签 | 无 / **child(tag) 前缀** | **child** | 模块前缀定位日志来源 |
| 5 | DI 集成 | 纯全局单例 / **LOGGER token + getLogger 便捷(fallback 默认)** | **token+便捷** | 演示接口+注入闭环，同时保留便利 |
| 6 | sink 形态 | 统一 write(level,args) / **console-like 四方法** | **console-like** | 直接映射 console、fake 简单 |

## Platform considerations（全平台 / 小游戏兼容）

- `console` 在 node/web/多数小游戏可用；个别小游戏 console 受限 → 注入自定义 `LogSink`。
- 原生（iOS/Android/PC）`cc.log` 有额外能力（写日志文件、发布期屏蔽）→ engine 提供 `CcLogger` 覆盖。
- 与三种热：无直接关系；日志实现可随 engine bundle 热更替换（走 DI 覆盖）。

## Testable seams + test plan（可测接缝 + vitest 用例）

- **可测性**：core 全部纯 TS，注入 fake `LogSink` 断言输出，零 cc。
- **用例清单**：
  1. 级别过滤：`level=Warn` → `debug/info` 不调 sink、`warn/error` 调 sink。
  2. `setLevel` 运行时改级别即时生效。
  3. `Silent` → 全部不输出。
  4. tag 前缀：`child('net').info('x')` → sink.info 收到 `['[net]', 'x']`。
  5. 多级 child：`child('a').child('b').info('x')` → `['[a][b]', 'x']`。
  6. child 共享级别：`root.setLevel(Error)` → child.debug 不输出。
  7. `createConsoleLogger` 默认 `level=Info`。
  8. `LOGGER` token：`createToken` 语义、resolve 得注入实现。
  9. `getLogger()` 未注册 → 返回可用默认（打日志不抛）。
  10. `getLogger()` 在 `register(LOGGER, fake)` 后 → 返回注入实现。
  11. `getLogger('tag')` → 带 tag 前缀。
  12. 默认 sink 未注入时指向 `globalThis.console`（spy console 验证或最小断言）。

## Open Questions（待用户拍板）

1. **默认级别**：`Info`（生产友好）还是 `Debug`（开发友好）？倾向 **Info**，开发在 Bootstrap 调 `Debug`。
2. **getLogger 未注册时**：返回进程级默认 ConsoleLogger（**不自动注册进容器**）——OK？还是首次自动 register 默认到根？倾向前者（无副作用）。
3. **标签格式**：`[tag]`、多级 `[a][b]`——OK？
4. **是否首版加时间戳/格式化**？倾向不加（推给 sink / engine），保持薄。

---

## 实现记录

- **落地文件**：`packages/core/src/logging/logger.ts`（`LogLevel`/`LogSink`/`ILogger` + `ConsoleLogger` + `createConsoleLogger` + `LOGGER` token + `getLogger`）、`index.ts`（导出）；由 core `index.ts` re-export。
- **最终 API 与设计偏差**：完全按设计，无偏差。`ConsoleLogger` 用共享 `LevelState`（root/child 一处 `setLevel` 生效）；默认 `consoleSink` 适配 `globalThis.console`（零 cc）；`getLogger` 未注册时 fallback 进程级默认（不注册进容器），engine `register(LOGGER,…)` 后自动切换。
- **测试结果 / 覆盖率**：`vitest` 全绿（core 共 35 测试：DI 20 + Logger 13 + 骨架 2）；`tsc -b`、`eslint` 干净。core 覆盖 **Stmts/Lines/Funcs 100%、Branch 97.16%**（剩 container/logger 各 1–2 个防御分支）。
- **commit / PR**：待提交。
- **遗留 Minors**：engine `CcLogger`（cc.log / 写日志文件，Bootstrap 覆盖）；重门面（`cck.audio` 类预置属性）待接口清单稳定。

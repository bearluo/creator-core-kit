# Cocos Creator 生态调研与选型（面向公共框架）

> 状态：已定稿（调研快照）
> 摘要：Cocos 生态选型调研——AI-MCP 五选一、单测解耦、分包/热更、协作、参考框架。
> 何时读：质疑或回顾某个选型（为什么选 Funplay / vitest / 自研借鉴 oops）时。
> 日期：2026-07-24
> 目的：为 creator-core-kit 公共框架的技术选型提供依据。结论已沉淀进 `docs/design/2026-07-24-architecture-overview.md`。

## 背景

为 Cocos Creator（目标 3.8 LTS）开发通用公共框架，核心诉求：逻辑可脱离引擎测试、UI 与逻辑分离、易接入不同项目、全平台、支持分包/热更/热重载、易多人协作。本文调研生态现状，逐项给出结论。

---

## 1. AI 操作 Creator 的 MCP 插件 — 结论：成熟方案已存在

这类插件装成 Creator 扩展（extension），在编辑器内起 HTTP/JSON-RPC 服务，AI（Claude Code 等）作为 MCP client 连接后可操作场景、节点、组件、prefab、资源、项目设置，用于辅助界面开发。

| 项目 | 协议 | 版本 | 工具 | 传输 | Claude Code | 活跃度 | 特色 |
|---|---|---|---|---|---|---|---|
| **FunplayAI/funplay-cocos-mcp** | **MIT** | 3.8+ | 105（profile 可裁剪） | HTTP:8765 + stdio wrapper | ✅ 一键 | 30 commit / 113★（最活跃） | `execute_javascript`、截图（编辑器/场景/游戏/预览）、依赖校验、输入模拟、安全护栏、SHA256 更新 |
| caravanglory/cocos-mcp-server | MIT | 3.8.x | 130+/14 类 | HTTP:3000 | ✅ | ≈1 commit（存疑） | 工具最全、Vue3 控制面板 |
| DaxianLee/cocos-mcp-server | **非商用** | 3.8.6+ | 50（动画/高级 prefab 要 Pro） | HTTP:3000（Pro 才 Streamable） | ✅ | 活跃（v1.5.4） | 智能路径、自动 UI 检测、场景 builder、参考图叠加；有 Pro 商业版 |
| RomaRogov/cocos-mcp | MIT | 未标 | 16 | Streamable HTTP，无需 bridge | ✖ 泛指 | 已废弃、24★ | execute_scene_code、AI 生图 |
| lightblink/cocos-creator-local-mcp | MIT | 3.8.8 | 24 | stdio + bridge | ✖ 泛指 | 0★、新、需 macOS | local-first 脚手架、微信构建流水线 |

**选型结论**：主力 **FunplayAI/funplay-cocos-mcp**——MIT 可商用、维护最活跃、工具可裁剪、`execute_javascript`+截图形成"AI 摆 UI→自看结果→再调整"的闭环。备选 caravanglory（工具最多，可交叉参考工具划分）。**排除** DaxianLee（非商用协议，公司项目硬伤）、RomaRogov（已废弃）。

**约束**：这些 MCP 都需要一个打开着的 Creator 3.8 项目才能工作，将装在 `apps/demo` 实测；其操作产物是 scene/prefab（协作冲突源），须配合"少场景/代码化 UI"约定。

---

## 2. 逻辑脱离引擎单测 — 结论：可行，但必须靠架构强制

- Cocos 3 可用 `ts-jest`/`vitest` 跑单测；痛点是 `import 'cc'` 报 `Cannot find module 'cc'`（引擎运行时才有）。
- 唯一正确解法是**分层**：纯逻辑层零 `cc` 依赖 → node 里直接测；引擎交互通过接口 + DI 注入，测试注入 mock。
- 这是框架地基，直接决定目标"逻辑可脱离 Creator 测试"能否成立。

## 3. UI 与逻辑分离 — MVVM / 数据驱动

View（prefab + 薄 Component）只做绑定与渲染；ViewModel/逻辑纯 TS 可单测；逻辑改数据 → UI 响应。与第 2 点是同一件事的两面。

## 4. 分包 / 热更 / 热重载

- **分包**：3.x 用 Asset Bundle（不再是 2.x 的 subpackage），支持内置/远程/分模块/小游戏分包。
- **线上热更**：官方 `AssetsManager` + manifest 增量，**仅原生平台**；Web/小游戏靠远程 Asset Bundle 版本化加载。
- **开发期热重载**：Cocos 无成熟脚本 HMR，改脚本一般需重新预览。框架的对策是纯逻辑层用 `vitest --watch` 拿秒级反馈；真·脚本 HMR 列为独立研究项。

## 5. 多人协作 — 靠"少场景 + 代码化 UI"从源头规避

- 痛点：scene/prefab 是难 merge 的资源，git 常冲突。官方直接建议别多人同时改同一 scene/prefab。
- 最佳实践：空场景/极简场景 + 代码化加载；功能拆独立 prefab、专人管理；prefab 模块化嵌套；兜底工具 FireMerge（Big Fish 的 scene/prefab 合并器）。
- 与第 2、3 点一致：代码化、数据驱动 UI 同时解决"可测试"和"好协作"。

## 6. 参考框架

- **oops-framework**（dgflash）：Cocos Creator 3.x，ECS+MVVM，UI 管理/多语言/屏幕适配/Excel→JSON/热更/AB 包，低耦合插件式。最主流开源参考。
- 构建策略：自研为主、借鉴其分层与工具链经验，依赖最小、不强绑 ECS。

---

## 已确认的关键决策（→ 详见架构总纲）

- **平台**：原生 App / PC/桌面 / H5·Web / 微信·抖音小游戏（全平台）。
- **三种热**：线上热更 + 开发期代码热重载 + 运行时按需分包，全部要。
- **构建策略**：自研为主、借鉴 oops。
- **仓库形态**：monorepo（`core` 纯 TS 发 npm + `engine` cc 适配 bundle + `demo` 工程）。
- **架构范式**：分层 + DI + 事件驱动 + 数据驱动 UI；ECS 可选，不进默认地基。
- **测试栈**：vitest。
- **MCP**：主力 Funplay，先深入对比已完成（见 §1）。

## Sources

- MCP：[funplay-cocos-mcp](https://github.com/FunplayAI/funplay-cocos-mcp)、[caravanglory](https://github.com/caravanglory/cocos-mcp-server)、[DaxianLee](https://github.com/DaxianLee/cocos-mcp-server)、[RomaRogov](https://github.com/RomaRogov/cocos-mcp)、[lightblink](https://github.com/lightblink/cocos-creator-local-mcp)
- 参考框架：[oops-framework](https://github.com/dgflash/oops-framework)
- 单测解耦：[Cocos 论坛 Jest 讨论](https://forum.cocosengine.org/t/how-to-run-jest-unit-tests-with-cocos-creator-version-3-8/59632)
- 热更：[官方 AssetsManager 文档](https://docs.cocos.com/creator/3.8/manual/en/advanced-topics/hot-update-manager.html)
- 协作冲突：[Cocos 论坛 scene 冲突讨论](https://forum.cocos.org/t/topic/159042)

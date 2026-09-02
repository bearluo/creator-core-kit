# creator-core-kit 文档地图

> **渐进式披露入口**：先看这张地图，按「何时读」跳到需要的文档，不必全读。
> **AI 友好**：每个文档顶部有 `状态 / 摘要 / 何时读` 头部，扫头部即可判断相关性，再决定是否深入正文——避免一次性把全部文档灌进上下文。

## 要做什么 → 读哪个（快速路由）

| 你的任务 | 打开 |
|---|---|
| 上手项目 / 遵守开发约定 | `CLAUDE.md`（L0 常驻铁律） |
| **做新业务功能 / 写测试** | **`docs/design/testing-strategy-overview.md`（分层测试边界 + 单例禁令 + 动作清单）** |
| 了解架构全貌与关键决策 | `docs/design/2026-07-24-architecture-overview.md` |
| 设计 / 使用某个模块 | `packages/<pkg>/docs/modules/<module>.md`（随包，如 `packages/core/docs/modules/`） |
| **接入方工程怎么装配**（分包 / 马甲 / 热更流水线 / 出包） | **`apps/demo/docs/README.md`**（demo 自己的文档地图） |
| **查 `@cck/core` 某个 API 的精确签名** | `packages/core/docs/api/README.md`（typedoc 生成，一模块一页；**勿手改**，跑 `pnpm docs:api` 重生成） |
| 看整体进度、谁在做什么 | `docs/progress.md` |
| 了解选型依据（MCP / 框架 / 热更调研） | `docs/research/2026-07-24-cocos-ecosystem-survey.md` |
| **接服务端 / 定协议 / 定更新策略** | **`docs/adr/0011-server-framework-split-and-protocol-contract.md`**（决策）→ `docs/research/2026-08-03-game-server-survey.md`（依据） |
| **给玩法接 ECS / 做经济型子游戏** | **`docs/design/2026-08-28-mini-fish-design.md`**（捕鱼设计：四道接缝 + ECS 混合边界）→ `packages/ecs-bitecs/docs/modules/{ecs,spatial}.md`（底座与 system） |
| **做子游戏的内容编辑器 / 接鱼阵投喂** | **`docs/design/2026-08-31-mini-fish-content-editor.md`**（鱼阵编辑器：源码往返 · 与游戏共用哪些逻辑 · 预览复用 FishVM · waveFeeder）；「内部工具为什么用 HTML 不用 Cocos」见 [`ADR-0020`](adr/0020-internal-tools-in-html.md) |
| 判断「这段代码该做 npm 包还是住 assets」 | `docs/adr/0019-npm-package-base-vs-assets-boundary.md`（npm 包 = base 重启生效；assets = bundle 免重启） |
| 追溯某个重大技术决策 | `docs/adr/`（按需建立） |
| 新建模块文档 | 复制 `docs/design/modules/_TEMPLATE.md` |

## 文档层级（渐进式披露）

- **L0 常驻** `CLAUDE.md` — 铁律 + 约定摘要 + 指针。每次会话加载，保持最精炼。
- **L1 入口** 本地图 + `docs/progress.md` — 导航与进度，先读这层再决定深入。
- **L2 主题** 架构总纲 / 各模块设计 / 调研 — 自包含，顶部有摘要头部。**接入方工程的装配文档随工程走**（`apps/<project>/docs/`），与随包的模块文档同理：讲「这个工程怎么组装」，不讲 kit 怎么实现。
- **L3 细节** 主题文档内部的决策表 / 测试计划 / 实现记录 — 需要时才展开。

## 首次阅读顺序（新成员 / AI）

1. `CLAUDE.md` 的「核心铁律」+「仓库结构」
2. 本地图
3. 架构总纲 §1–3（目标 / 主线原则 / 分层）
4. 要动哪个模块，再读对应 `packages/<pkg>/docs/modules/<module>.md`

## 文档头部规范（所有 docs 统一）

每个文档顶部用统一头部，供人和 AI 快速判断相关性：

```
状态: 草案 | 评审中 | 已定稿 | 已实现 | 活文档
摘要: 一句话说清本文是什么（扫这句就能决定要不要读全文）
何时读: 什么任务该打开我
依赖: 相关文档链接
```

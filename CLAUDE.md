# creator-core-kit

Cocos Creator 3.8（LTS）全平台公共框架。目标：**逻辑可脱离引擎测试、UI 与逻辑分离、易接入不同项目、支持分包/热更/热重载、易多人协作**。

> 文档入口见 `docs/README.md`（文档地图，渐进式披露）；权威设计见 `docs/design/2026-07-24-architecture-overview.md`。本文件只给日常开发必须遵守的约定；与 spec 冲突时以 spec 为准。
> 回答用中文（代码、命令、API 名、路径、字段名保持原文）。

---

## 核心铁律（最重要）

> **纯逻辑零 `cc` 依赖；一切引擎交互走接口，由适配层在运行时注入。**

- `packages/core` 内**禁止** `import 'cc'`（及任何引擎子模块）。CI 用依赖检查强制。
- Core 需要引擎能力时，用 Core 定义的接口（`IAssetLoader / IAudioService / ITimer / INetwork / IStorage / ILogger / IPlatform`）+ DI 注入；`engine` 提供 cc 实现，测试注入 fake。

这条铁律同时保证「可单测」和「少协作冲突」——逻辑不落在 prefab/场景里。

---

## 仓库结构（monorepo，搭建中）

```
packages/core     纯 TS，零 cc，发 npm，vitest 在 node 直接测
packages/engine   cc 适配 + UI/资源/热更基建，作为可移植 Asset Bundle 源码
packages/tools    (可选) Excel→JSON、manifest 生成、脚手架
apps/demo         真实 Cocos Creator 3.8 工程，挂 MCP 实测
docs/design       设计文档
```

分层依赖单向向下：**View（prefab+薄 Component）→ Engine（cc 薄壳）→ Core（纯 TS）**；Core 反向只经接口被满足。

---

## 开发约定

- **技术栈**：TypeScript + Cocos Creator 3.8。架构范式：分层 + DI + 事件驱动 + 数据驱动 UI（MVVM-lite）。**ECS 为可选模块，不进默认地基**。
- **加新功能**：业务逻辑写进 `core`（纯 TS、可测）；继承 `cc.Component` 的薄壳放 `engine`，只做渲染与事件转发，不含逻辑；UI 数据驱动。
- **测试**：**vitest**，TDD（先写测试）。`core` 覆盖率是 CI 硬门槛；**`core` 的测试不允许 import `cc`**。`engine` 用 `cc` mock 测薄壳。
- **模块通信**：走类型安全 EventBus / 接口，不做跨模块直接引用。

### 业务开发三条硬规则（做新功能前必读全文：[`docs/design/testing-strategy-overview.md`](docs/design/testing-strategy-overview.md)）

1. **逻辑一律进 VM**（零 `cc`，可 node 直跑）；**View 只许做四件事**——取组件 / 建绑定 / 转发事件 / 转发生命周期钩子。写到第五件就下沉到 VM。单测覆盖到 VM 为止，View + prefab + 装配由启动 smoke 兜底。
2. **禁模块级单例**——`export const x = new Foo()` / `static instance` / `getInstance()` 全禁。bundle 卸载不卸脚本、编辑器 stop→play 保留 JS 上下文、单 bundle 出包依赖内联，三条都让它拿到脏的旧实例。要共享就注册进模块 DI scope（`containerScoped`）。唯一豁免是 `getRootContainer()`（ADR-0001 指定机制）。
3. **测试不进 `assets/`**——Creator 会把 `.test.ts` 当游戏脚本打包并炸构建。放 `apps/<project>/test/`，路径**镜像** `assets/`（`assets/a/B.ts` → `test/a/B.test.ts`）。运行时验证探针另有去处（`assets/probes/`），别和单测混。

> 业务侧 lint 规则要写进 `apps/<project>/eslint.config.mjs`（`pnpm lint:demo`）——根 `eslint.config.js` 把 `apps/**` 整个 ignore 了，加在那里**静默失效**。
> 四道门：`pnpm lint` / `pnpm typecheck` / `pnpm test` / `pnpm check:vm-tests`（每个 `*VM.ts` 必须有镜像路径的测试）。

---

## 多人协作（硬约定）

- **一个空引导场景**，其余全部 prefab + 代码加载 → 从源头消灭 scene 合并冲突。
- **feature-based 目录，一个模块一个 Asset Bundle**，交叉最小化。
- prefab 拆细、专人管理；**UI 一律走 prefab**——工作分配本就保证不会两个人改同一个 prefab，「prefab 冲突」这个前提不成立；代码拼节点是把字号 / 颜色 / 布局锁死在 TS 里，美术策划碰不了，得不偿失。
- **prefab 首次创建用脚本生成**（描述数据 → 编辑器 `create-prefab` 消息从临时节点树产出；**别裸序列化 `Node`**——缺 `PrefabInfo`，运行时能 instantiate 但编辑器一打开就崩）；**改已有 prefab 走 MCP**，不要用脚本重新生成覆盖别人的编辑。
- **线性历史**：rebase-before-merge，fast-forward 合并，禁 merge commit。
- **分支开发一律用 git worktree，一分支一目录**（勿在同一目录反复 checkout 切分支）。
- `.gitignore` 覆盖 `library/ temp/ build/ profiles/ native/` 等生成物；`.meta` 需提交。

---

## 文档维护约定

文档**随代码提交**（doc-as-code），与实现在同一分支/PR 更新。**归属按范围分两层**：跨包 / 跨项目的放顶层 `docs/`；**单模块设计文档随包**放 `packages/<pkg>/docs/modules/<module>.md`（文档跟包走——core 发 npm 时自带文档，对齐姊妹框架 godot-core-kit 把文档放包内的做法）。

```
docs/                                        顶层 = 跨包 / 跨项目
├─ README.md                                 文档地图（渐进式披露入口，先读这个）
├─ research/YYYY-MM-DD-<topic>.md            调研横评（带日期，快照性质）
├─ design/
│  ├─ <topic>-overview.md                    跨模块 / 总纲设计
│  ├─ YYYY-MM-DD-<模块>-v2-proposal.md       改造提案（过程文档，一次性；实施后并入模块文档、标「已实施」封存）
│  └─ modules/{_TEMPLATE,monorepo-scaffold}.md  共享模板 + 跨包骨架（仅跨包留此）
├─ progress.md                               全仓模块状态看板（每次开工/完工更新）
└─ adr/NNNN-<slug>.md                        重大 / 不可逆决策，一条一记、追加不改

packages/<pkg>/docs/modules/<module>.md      单模块**当前功能文档**（随包，单一时态）
                                             core 模块归 core、engine 专属归 engine；
                                             跨 core+engine 的按「逻辑主场」归属（多在 core），适配层作文档内小节
```

> **模块文档 = 现状，不是编年史。** 打开它读到的就是**代码此刻的样子**，不得出现 v1/v2 并列、「推翻了旧决策」这类演进叙事——读者不该在脑子里做版本减法。过程（改造动机、变更清单、迁移步骤、决策沿革）放 `docs/design/…-proposal.md` 与 `docs/adr/`，沿革本身另有 git 历史。踩坑与已知行为**留在模块文档**——它们描述的是当前系统的真实行为，属现状而非过程。

- **渐进式披露 + AI 友好**：入口是 `docs/README.md`（地图）→ 主题文档 → 细节，逐层深入。每个文档顶部用统一头部 `状态 / 摘要 / 何时读 / 依赖`，让人和 AI 扫头部即可判断相关性、按需深入，不必一次性加载全部；`CLAUDE.md` 作为 L0 常驻保持精炼，细节推到 `docs/`。
- **模块文档骨架**见 `docs/design/modules/_TEMPLATE.md`：Purpose / Public API（TS 精确签名）/ Behavior & data flow / Key decisions（决策表）/ Platform / Testable seams + 测试计划 / Open Questions / 已知行为与坑。
- **状态标记**（文档顶部）：`草案 → 评审中 → 已定稿 → 已实现`。
- **新模块流程**：
  1. 动工前先出 `packages/<pkg>/docs/modules/<module>.md` 并评审**定稿**；
  2. 定稿后才 TDD 实现；
  3. 实现完成 → 把模块文档**改写为现状**（最终 API、已知行为与坑）+ 更新 `docs/progress.md`；
  4. 重大 / 不可逆技术决策 → 追加一条 `docs/adr/`。
- **改造已有模块流程**（别往模块文档里追加 v2 节）：
  1. 出 `docs/design/YYYY-MM-DD-<模块>-v2-proposal.md`（动机 / 变更总览 / 目标 API / 决策 / 测试计划 / 实施步骤）并评审**定稿**；模块文档头部加一行 `改造中:` 指针，正文仍描述现状；
  2. 定稿后才 TDD 实施；
  3. 实施完成 → 模块文档**整体重写为新现状**（不留 v1 痕迹）+ 提案标「已实施」封存 + 更新 `docs/progress.md`；
  4. 破坏性 / 不可逆决策 → 追加一条 `docs/adr/`。

---

## 三种"热"

- **线上热更(hotfix)**：`HotUpdateService` 统一入口。原生走官方 `AssetsManager` + manifest；Web/小游戏走远程 Asset Bundle 版本化加载。
- **运行时按需分包**：`BundleManager.load/release(name)`，一模块一 bundle。
- **开发期热重载**：Cocos 无原生脚本 HMR。逻辑层用 `vitest --watch` 秒级反馈（不必开 Creator）；引擎层维持 Creator 预览。

---

## MCP 辅助界面开发

- 主力 **FunplayAI/funplay-cocos-mcp**（MIT、可裁剪、`execute_javascript` + 截图闭环），装在 `apps/demo`。
- MCP 是**改已有** scene/prefab 的手段；**首次创建走脚本生成**（见上「多人协作」）。

---

## 常用命令

骨架搭建后补充（pnpm workspace + vitest + lint 依赖约束）。

---

## Agent skills

### Issue tracker

Issues/PRD 走公司自建 GitLab **hlgit**（`glab` CLI）；本仓当前无 remote，需先建仓/push 才生效。详见 `docs/agents/issue-tracker.md`。

### Domain docs

单上下文布局：root `CONTEXT.md`（由 `/domain-modeling` 懒创建）+ `docs/adr/`；本仓另有渐进式披露文档体系（`docs/README.md` 地图 → design/research/progress + 随包 modules）。详见 `docs/agents/domain.md`。

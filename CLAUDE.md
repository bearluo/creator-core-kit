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

### 接入方工程的目录（`apps/demo/assets/`）：**纵向分层 × 横向马甲，两个维度不许混层**

纵向 = 「改它要付什么代价」：

```
boot/        ① AOT：Boot.scene / Bootstrap / app-config(VEST) / 启动界面 / foundation-api → 发新包、重启
foundation/  ② 地基 bundle：协议 / 连接 / 登录与认证 / 网关搬家 / 模块清单 / 模块契约    → 热更，不重启
             一个功能一个目录（net/ login/ …），**只有逻辑、没有脸**
modules/*/   ③ 功能 bundle：lobby / mail / shop / mini-clicker / mini-dodge            → 按需 load/release
shared/      跨模块共享资源（所有马甲都一样的那些）
```

横向 = 「哪个马甲」，**收在 `skins/<马甲>/` 里**（`skins/` 与 `skins/<马甲>/` 都**不是** bundle，
只做归类——bundle 不能嵌套）。**皮的分包边界 = 它跟随者的分包边界，一个跟随者一个皮包**：

```
skins/base/foundation/ → bundle `skin-base-foundation`  login/Login.prefab   随 shared 装，常驻
skins/base/lobby/      → bundle `skin-base-lobby`       LobbyPanel · LobbyItem   进大厅时装
skins/base/mail/       → bundle `skin-base-mail`        Mail.prefab          开邮件时装、关时卸
skins/vest/…           → `skin-vest-*`（示例马甲）      同名同路径，各画各的
```

**不许一个马甲一个大皮包**：那样启动就得把玩家永远不点的模块的脸一起下下来，改一张脸还要重下整包。
包名靠目录 meta 的 `bundleName` 覆盖（目录不重复 `skin-` 前缀）；跨模块共用的图集 / 字体放
地基皮包（priority 2 高于模块皮包 1），否则各模块皮包各复制一份。

**换皮的界面不许用 `@property(Prefab)`**——那是编辑器期绑定、绑死在自己 bundle 里；经 UIManager
的在 `MODULE_CATALOG` 里写 `skinned: true`（大厅负责把皮包跟模块包一起装卸），不经的（大厅骨架）
用 `currentSkinBundle('lobby')` 自己加载。⚠️ 换皮界面的实例是被**皮包**那条回收链销毁的：
`BundleScope.dispose` 的 `closeByBundle` 按**解析后**的 bundle 比对，对 skinned 模块传模块包名是 no-op。
完整判据与开放项见 [`docs/design/2026-08-07-demo-assets-layout-v2-proposal.md`](docs/design/2026-08-07-demo-assets-layout-v2-proposal.md)。

- 地基**必须在 `hotupdate` 之后加载**（`shared` 阶段），否则更新下来的要等下次启动才生效。长连接与认证跟着后移。
- **主包不得 `import` 地基的任何值**——那段代码会被判给主包 → 地基进 AOT → 热更失效。唯一接缝是 `boot/foundation-api.ts`（`import type` + `js.getClassByName`）。
- 模块**可以**正常 `import` 地基的函数：`foundation` 的 bundle 优先级（6）高于所有业务包，被多包引用的资源归属优先级最高者，同级才各复制一份。**改优先级前先读 [`ADR-0014`](docs/adr/0014-foundation-bundle-and-priority-sharing.md)**。
- **马甲换皮走 UI 变体，不进代码分支**：登记了换皮的界面，prefab **一律**从 `skin-<马甲>-<跟随者>` 包取（`foundation/catalog.ts` 的 `skinBundle(owner)`），**原层里不留脸**——脸留在地基意味着别的马甲白下、改它还要热更整个地基包；脚本仍归原层（地基 6 / 模块 1），一套逻辑配任意一张脸。马甲标识 `VEST` 是打包期常量（`boot/app-config.ts`），demo 自己的地基皮是 `skin-base-foundation`。**给哪几种登录方式也由 prefab 决定**——节点在就接线、不在就没有这条路。存储 key 一律带 `appId` 前缀（Web / 小游戏同域名共用 localStorage，不隔离两个马甲会共用同一个游客号）。

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
> 五道门：`pnpm lint` / `pnpm typecheck` / `pnpm test` / `pnpm check:vm-tests`（每个 `*VM.ts` 必须有镜像路径的测试）/ `pnpm docs:api`（改了 `core` 公开 API 就重新生成并一起提交，CI 会挡不同步）。

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

文档**随代码提交**（doc-as-code），与实现在同一分支/PR 更新。**归属按范围分三层**：跨包 / 跨项目的放顶层 `docs/`；**单模块设计文档随包**放 `packages/<pkg>/docs/modules/<module>.md`（文档跟包走——core 发 npm 时自带文档，对齐姊妹框架 godot-core-kit 把文档放包内的做法）；**接入方工程怎么装配随工程**放 `apps/<project>/docs/`（入口 `README.md`）。

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

apps/<project>/docs/                         **接入方工程的装配文档**（随工程，入口 `README.md`）
                                             分包 / 马甲 / 热更流水线 / 出包——讲「这个工程怎么组装」，
                                             不讲 kit 怎么实现（那在 packages/*/docs）

packages/core/docs/api/                      **typedoc 生成物，勿手改**（`pnpm docs:api`）
                                             精确签名去这里查；模块文档只讲「怎么用、为什么这么设计」
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

Issues/PRD 走公司自建 GitLab **hlgit**（`glab` CLI）；本仓 remote 为 `luohao/creator-core-kit`，`glab` 在仓内直接可用。详见 `docs/agents/issue-tracker.md`。

### Domain docs

单上下文布局：root `CONTEXT.md`（由 `/domain-modeling` 懒创建）+ `docs/adr/`；本仓另有渐进式披露文档体系（`docs/README.md` 地图 → design/research/progress + 随包 modules）。详见 `docs/agents/domain.md`。

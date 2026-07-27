# creator-core-kit 架构设计总纲

> 状态：草案 v0（待评审）
> 摘要：框架顶层架构总纲——分层(Core/Engine/View) + monorepo + 三种热 + 模块地图 + 协作/测试规范。
> 何时读：了解项目全貌、动工任一模块前建立架构心智、拿捏接口边界时。
> 日期：2026-07-24
> 目标引擎：Cocos Creator 3.8（LTS）
> 语言：TypeScript

本文是 creator-core-kit 公共框架的顶层架构总纲。模块级细节由各自的子设计文档展开，本文只锁定骨架、分层、约定与实现路线。

---

## 1. 背景与目标

为 Cocos Creator 开发打好基础的公共框架，需容易接入到不同项目。

### 1.1 核心目标（硬指标）

1. **逻辑可脱离引擎测试**：游戏大部分逻辑可以在不运行 Creator 的情况下做单元测试。
2. **UI 与逻辑分离**：UI 和逻辑能分别测试。
3. **易接入不同项目**：框架是可复用单元，接入新项目成本低。
4. **全平台**：原生 App（iOS/Android）、PC/桌面、H5/Web、微信/抖音等小游戏。
5. **三种"热"**：线上热更新(hotfix)、开发期代码热重载、运行时按需加载分包。
6. **易多人协作**：从源头规避 scene/prefab 的 git 合并冲突。

### 1.2 非目标（当前范围外）

- 不做特定品类的玩法框架（战斗/棋牌等），只做通用地基。
- 不强绑定 ECS（作为可选模块，见 §4）。
- 不自研渲染/物理，沿用 Cocos 引擎能力。

### 1.3 构建策略

自研为主，借鉴 [oops-framework](https://github.com/dgflash/oops-framework) 的分层、资源管理、AB 包与工具链经验，但依赖最小、不强绑其 ECS。

---

## 2. 主线原则

两个核心目标（逻辑可测、易协作）本质是同一诉求：**让业务逻辑不碰 `cc`**。整个框架围绕一条铁律：

> **纯逻辑零 `cc` 依赖；一切引擎交互走接口，由适配层在运行时注入。**

推论：
- 逻辑不写在 `cc.Component`/prefab/场景里 → 天然可在 node 里单测（满足目标 1、2）。
- 逻辑不落在 prefab/场景资源里 → 减少难合并资源的改动 → 少冲突（满足目标 6）。
- 逻辑不依赖 Creator → 可独立打包、版本化、跨项目复用（满足目标 3）。

---

## 3. 分层架构

```
┌─────────────────────────────────────────────────────┐
│  表现层 View   prefab + 薄 Component                  │
│  只做数据绑定与渲染；可由 MCP 辅助搭建                  │
├─────────────────────────────────────────────────────┤
│  适配层 Engine  cc.Component 薄壳 + Core 接口的 cc 实现 │
│  把 Core 的数据渲染到 Node，把引擎事件转发进 Core       │
├─────────────────────────────────────────────────────┤
│  内核层 Core   纯 TS，零 cc                            │
│  状态/规则/数值/协议/状态机/事件总线/DI 容器            │
└─────────────────────────────────────────────────────┘
   依赖方向：View → Engine → Core（单向向下）
   Core 反向仅通过「接口」被满足（依赖倒置 / DI）
```

- **Core（内核层）**：纯 TypeScript，`import` 白名单里没有 `cc`。承载领域逻辑、状态、数值、协议、状态机、事件总线、DI 容器。用 vitest 在 node 环境直接测。
- **Engine（适配层）**：继承 `cc.Component` 的薄壳，只负责"渲染 Core 数据 + 转发引擎事件"；并提供 Core 所定义接口（资源/音频/计时/网络等）的 cc 实现。**不含业务逻辑**。
- **View（表现层）**：prefab + 薄 Component + 数据绑定，数据驱动（改 ViewModel 数据 → UI 响应）。

### 3.1 依赖倒置与接口清单（Core 定义，Engine 实现）

Core 定义引擎能力接口，Engine 提供实现，Bootstrap 时经 DI 容器注入；测试时注入 fake。首批接口（可增补）：

- `IAssetLoader`：资源/bundle 加载、引用计数
- `IAudioService`：音效/音乐播放
- `ITimer`：定时器/帧回调（Core 不直接用 `cc.director`/`setTimeout`）
- `INetwork`：网络请求/长连接
- `IStorage`：本地持久化（存档底层）
- `ILogger`：日志
- `IPlatform`：平台差异查询（原生/Web/小游戏）

---

## 4. 架构范式

**默认轻量**：分层 + 依赖注入 + 事件驱动 + 数据驱动 UI（MVVM-lite）。

- **DI 容器 / ServiceLocator**：装配接口实现、解耦模块。**跨 bundle 铁律（实证，见 [ADR-0001](../adr/0001-cross-bundle-singleton-and-aot-hotupdate.md)）**：容器与全局单例必须挂在 `globalThis` + `Symbol.for()`/字符串 token、经接口交互；禁止依赖 `import` 的 static 单例 / class identity / `instanceof` 做跨 bundle 唯一性判断 —— 单 bundle 出包会把公共代码复制进各 bundle 致静态状态分裂（`spike/bundle-probe` 实测 A 写 B 读到 0）。
- **类型安全 EventBus**：模块间弱耦合通信（发布/订阅），编译期校验事件名与载荷类型。
- **数据驱动 UI**：ViewModel 是纯逻辑（可测），View 是薄壳。
- **ECS 作为可选模块**：需要大量同类实体（弹幕、群体 AI 等）的项目再启用，不进入默认地基。

---

## 5. 仓库形态（monorepo）

```
creator-core-kit/
├─ packages/
│  ├─ core/          纯 TS，零 cc，发 npm（@cck/core，包名待定）
│  │                 node 环境 vitest 直接测；跨项目复用的可测内核
│  ├─ engine/        cc 适配 + UI/资源/热更基建
│  │                 作为可移植的 Asset Bundle 源码，随项目引入
│  └─ tools/         (可选) Excel→JSON、manifest 生成、脚手架 CLI
├─ apps/
│  └─ demo/          真实 Cocos Creator 3.8 工程
│                    引用 core + engine，挂 Funplay MCP 实测
├─ docs/
│  └─ design/        设计文档
└─ .claude/          本地配置（已切换 superpowers → mattpocock）
```

**接入新项目** = 依赖 `@cck/core`（npm）+ 引入 `engine` bundle。`core` 完全不依赖 Creator，可独立版本化、独立测试、跨项目复用。

> 说明：Cocos 的引擎适配层必然依赖 `cc`（`cc` 在构建时为 external），无法纯 npm 化，因此 `engine` 以"Asset Bundle 源码目录"形态在项目间复用（submodule/复制机制见 §10 开放问题）。

---

## 6. 模块地图（分批实现）

### 第 1 批 · 地基
- DI 容器 / ServiceLocator
- 类型安全 EventBus
- Logger（`ILogger`）
- ITimer 抽象
- Bootstrap 启动流程与生命周期
- vitest 测试脚手架 + `cc` mock

### 第 2 批 · 核心设施
- AssetManager（bundle + 引用计数，实现 `IAssetLoader`）
- BundleManager（按需 load/release，运行时分包）
- UIManager（层级/栈/生命周期）
- SceneFlow（场景/流程状态机）
- SaveManager（`IStorage` 之上）
- ObjectPool
- AudioService（`IAudioService`）
- i18n 多语言
- ConfigTable（Excel→JSON + 强类型访问）

### 第 3 批 · 进阶
- HotUpdateService（三种热的统一入口，见 §7）
- Network/协议层（`INetwork`）
- ECS 模块（可选）
- MVVM 数据绑定增强

---

## 7. 三种"热"落地

- **线上热更新(hotfix)**：统一抽象 `HotUpdateService`，对上层一套 API，平台差异藏在适配层。
  - 原生（iOS/Android/PC）：官方 `AssetsManager` + manifest 增量下载。
  - Web / 小游戏：远程 Asset Bundle 版本化加载（无 native AssetsManager）。
  - **防 AOT 缺代码（实证，见 [ADR-0001](../adr/0001-cross-bundle-singleton-and-aot-hotupdate.md)）**：AOT 会裁掉构建时无人引用的 core API，跨版本热更「新 bundle 引用了旧主包已裁的符号」会在**调用点**才崩（符号粒度、加载不报错，`spike/bundle-probe` 已复现 `TypeError`）。对策：core 公共 API 强引用白名单防 tree-shake + 热更包与主包版本绑定校验（不匹配拒载）+ 必要时整包热更含主包/AOT。
- **运行时按需分包**：`BundleManager.load/release(name)`，一个功能模块 = 一个 Asset Bundle，控制首包体积与内存。
- **开发期代码热重载**：Cocos 无原生脚本 HMR，分两半拿——
  - 纯逻辑层：`vitest --watch` 秒级反馈，逻辑改动不必开 Creator。
  - 引擎层：维持 Creator 预览。
  - 真·脚本 HMR：列为**独立研究项**（§10），不阻塞地基。

---

## 8. 多人协作规范（写进框架约定）

- **一个空引导场景**，其余全部 prefab + 代码加载 → 从源头消灭 scene 合并冲突。
- **feature-based 目录**，一个模块一个 bundle，交叉最小化。
- prefab 拆细、专人管理；代码化 UI 优先（减少 prefab 冲突）。
- `.gitignore` 覆盖 `library/ temp/ build/ profiles/ native/` 等生成物；`.meta` 提交规范。
- 线性历史：沿用 fast-forward 合并约定（rebase-before-merge）。
- 兜底：必要时引入 FireMerge 类 scene/prefab 合并工具。

---

## 9. 测试体系

- **vitest**：更快、原生 TS/ESM、`--watch` 体验好。
- `core`：node 环境直接测，覆盖率为 CI 硬门槛。
- `engine`：用 `cc` 的 mock（构建/测试时 alias 指向 mock 实现）测薄壳。
- 分层保证：core 的测试**不允许** import `cc`；用 lint 规则或依赖检查在 CI 中强制。

---

## 10. MCP 辅助（界面开发）

- 选型主力：**FunplayAI/funplay-cocos-mcp**（MIT、最活跃、105 工具可裁剪、`execute_javascript` + 截图闭环、支持 Claude Code）。
- 备选：caravanglory/cocos-mcp-server（工具最多，交叉参考工具划分）。
- 排除：DaxianLee（非商用协议）、RomaRogov（已废弃）。
- 装在 `apps/demo` 工程内实测；MCP 操作产物是 scene/prefab（协作冲突源），须配合 §8 的"少场景/代码化 UI"约定。

---

## 11. 开放问题 / 待研究

1. `engine` bundle 跨项目复用的具体机制：git submodule vs 复制 vs Creator 扩展模板，三选一或组合。
2. 开发期真·脚本 HMR 的可行性（自定义 loader / 模块热替换）。
3. 小游戏平台（微信/抖音）热更与分包的平台限制细节。
4. npm 包 scope 命名（`@cck/*` 暂定）。
5. ConfigTable 的表结构与代码生成方案。

---

## 12. 实现路线

1. 搭 monorepo 骨架（pnpm workspace + core/engine/demo 三包 + vitest + lint 依赖约束）。
2. 第 1 批"地基"：DI + EventBus + Logger + Bootstrap + 测试脚手架（TDD）。
3. demo 工程接入 core/engine，跑通启动流程 + 挂 Funplay MCP 实测。
4. 第 2 批核心设施逐个 TDD。
5. 第 3 批进阶模块。

每批各自出子设计文档与实现计划。

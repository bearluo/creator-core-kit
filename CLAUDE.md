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
apps/fish-editor  鱼阵编辑器（纯 web 内部工具，vite，`pnpm editor`）——**不进任何游戏包**
                  只在浏览器跑的工具用 HTML，会进客户端的界面才用 prefab（ADR-0020）
docs/design       设计文档
```

分层依赖单向向下：**View（prefab+薄 Component）→ Engine（cc 薄壳）→ Core（纯 TS）**；Core 反向只经接口被满足。

### 接入方工程的目录（`apps/demo/assets/`）：**纵向分层 × 横向马甲，两个维度不许混层**

纵向 = 「改它要付什么代价」：

```
boot/        ① base：Boot.scene / Bootstrap / app-config(VEST) / 启动界面 / foundation-api → 热更、重启
foundation/  ② 地基 bundle：协议 / 连接 / 登录与认证 / 网关搬家 / 模块清单 / 模块契约    → 热更，不重启
             一个功能一个目录（net/ login/ …），**只有逻辑、没有脸**
modules/*/   ③ 功能 bundle：lobby / mail / shop / mini-clicker / mini-dodge / mini-plane → 按需 load/release
shared/      跨模块共享资源（所有马甲都一样的那些）
```

横向 = 「哪个马甲」，**收在 `skins/<马甲>/` 里**（`skins/` 与 `skins/<马甲>/` 都**不是** bundle，
只做归类——bundle 不能嵌套）。**皮的分包边界 = 它跟随者的分包边界，一个跟随者一个皮包**：

```
skins/default/foundation/ → bundle `skin-default-foundation`  login/Login.prefab   随 shared 装，常驻
skins/default/lobby/      → bundle `skin-default-lobby`       LobbyPanel · LobbyItem   进大厅时装
skins/default/mail/       → bundle `skin-default-mail`        Mail.prefab          开邮件时装、关时卸
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
- **主包不得 `import` 地基的任何值**——那段代码会被判给主包 → 地基进 base → 热更失效。唯一接缝是 `boot/foundation-api.ts`（`import type` + `js.getClassByName`）。
- 模块**可以**正常 `import` 地基的函数：`foundation` 的 bundle 优先级（6）高于所有业务包，被多包引用的资源归属优先级最高者，同级才各复制一份。**改优先级前先读 [`ADR-0014`](docs/adr/0014-foundation-bundle-and-priority-sharing.md)**。
- **子游戏（`kind:'game'`）跟外面的往来只经 `foundation/game/`**。panel 类的上下文是大厅**递进去**的（`ModuleContext` = `open` 的 args）；game 类是 `loadScene` 切过去的、递不进任何东西，所以它自己去取 `getGameHost()`：玩家是谁 / `exit()` 回大厅 / `best(id)` / `submit(id, score)`。**契约住地基不住大厅** —— 模块 → 大厅（3）虽合法但方向反了，子游戏不该依赖「大厅」这个具体实现。VM 拿到的是更小的 `GameScoreboard`（零依赖，单测塞 `memoryScoreboard()`），因为 VM 零 `cc`、node 直跑，不该认识一条挂到 DI 容器和 `IStorage` 的链子。接一款新游戏 = 建 bundle + `catalog.ts` 加一行 + View 里三句（`scoreboardFor` / `exitButton` / `releaseGameArt`）+ 镜像单测，**大厅代码零改**。完整流程见 [`lobby-modular-framework-overview`](docs/design/lobby-modular-framework-overview.md#3-模块契约--生命周期) 与 [`apps/demo/README.md`](apps/demo/README.md)。
- **跨包资源依赖只许指向声明过的共享仓**（只管**资源**；跨包 `import` 走下一条的拓扑规则）。**能当共享仓的条件是 priority 严格高于所有引用者**（同级会被抢），所以仓可以有多个——跨模块共用的图集 / 字体放地基皮包就是一个；产物闸的白名单默认只有 `resources`，多开要 `--allow-deps` 声明。Creator 把被多包引用的资源判给**优先级最高**的引用者（`resources` 8 > `main` 7 > `foundation` 6 > `shared` 5 > `lobby` 3 > 地基皮包 2 > 其余 1），其余包降级成 `cc.config` 的 `deps` + `redirect`。**归属会漂，且漂了是静默的**——构建全绿、热更下发成功，运行时才在 `redirect` 指向的包里找不到资源。demo 实测出过两种：共用图漂进 `main`（base 层，改它要热更 base 并重启 → 免重启的皮包先到一步，那段窗口里引用的 uuid 在旧 `main` 里不存在就炸，而改的还不是那个包、是 `boot`），以及两个马甲的地基皮包同优先级抢同一张图 → vest 的皮包依赖 default 马甲的包。所以：**① 用到的每个内置资源在 `assets/resources/internal-pin.prefab` 里挂个节点「钉」一次**——`resources` priority 8 是工程内最高的，归属被它吸走后谁也抢不动，而**工程各处照常引用 `db://internal`、一行都不用改**；**② 没有天然归属的外部资源一律经这个仓**；③ 代价是它们跟 base 同寿命，要用钉子里没有的内置图 = 热更整个 base 并重启——这正确，base 什么代价它就什么代价。两道闸：**源码期** `pnpm check:pins`（不用构建，「引用了外部资源却没钉」当场报）＋ **产物期** `cck-manifest --split`（写 manifest 前扫 `deps`/`redirect`）。判据见 [`hotupdate-pipeline`](apps/demo/docs/hotupdate-pipeline.md#资源归属一个共享仓别的都不许借)。
- **加载顺序与资源边界声明在依赖表里**（demo：`assets/foundation/bundles.ts` 的 `BUNDLE_GRAPH`，`Foundation.boot` 第一件事 `setGraph` 装上）。`needs` **一表两用**：① 装它之前先装好这些（`load`/`release` 各加减一次引用，**装卸对称**，共享依赖不误卸）；② 它能碰哪些包的资源（`mayUse`）。**动态引用只能靠它**——`assets.load(path,{bundle})` / `loadScene` / `registerUI` 的 resolver / `js.getClassByName` 在构建期一条记录都不产生，静态闸看不见。表外的包一 `load` 就抛（`env !== 'prod'`）。**启动那一段（`APP_CONFIG.shared`）不归它管**——表住在地基包里，地基自己是被启动序列装上来的。加模块仍只改 `catalog.ts` 一行（模块段按 `MODULE_CATALOG` 现推）。对账在 `apps/demo/test/foundation/bundles.test.ts`（随 `pnpm test`）。
- **跨包 `import` 只许指向优先级更高的包**（`priority(被依赖) > priority(依赖方)`，严格递增 ⇒ 拓扑序天然存在 ⇒ **循环依赖不可能出现**）。排名不另立表，就用上一条那串 Creator 优先级。一条规则同时守住三件事：**倒挂**（`main` 7 → `foundation` 6，即「主包不得 import 地基的值」）、**同级互引**（两个模块 / 两个马甲的皮包彼此拽住，谁都卸不干净）、**成环**。`import type` 不算边（编译期擦除，主包拿地基的唯一合法缝就是它），动态 `bundle.load()` + `js.getClassByName` 也不算（故意绕开静态依赖）。闸是 `pnpm check:graph`；**产物侧那两道对代码边完全瞎** —— Creator 的 `cc.config.deps` 只记资源依赖，脚本 `import` 一条都不写。实况拓扑图（现扫现画）见 [`bundle-layout`](apps/demo/docs/bundle-layout.md#依赖拓扑与防环)。
- **马甲换皮走 UI 变体，不进代码分支**：登记了换皮的界面，prefab **一律**从 `skin-<马甲>-<跟随者>` 包取（`foundation/catalog.ts` 的 `skinBundle(owner)`），**原层里不留脸**——脸留在地基意味着别的马甲白下、改它还要热更整个地基包；脚本仍归原层（地基 6 / 模块 1），一套逻辑配任意一张脸。马甲标识 `VEST` 是打包期常量（`boot/app-config.ts`），demo 自己的地基皮是 `skin-default-foundation`。**给哪几种登录方式也由 prefab 决定**——节点在就接线、不在就没有这条路。存储 key 一律带 `appId` 前缀（Web / 小游戏同域名共用 localStorage，不隔离两个马甲会共用同一个游客号）。

---

## 开发约定

- **技术栈**：TypeScript + Cocos Creator 3.8。架构范式：分层 + DI + 事件驱动 + 数据驱动 UI（MVVM-lite）。**ECS 为可选模块，不进默认地基**。
- **加新功能**：业务逻辑写进 `core`（纯 TS、可测）；继承 `cc.Component` 的薄壳放 `engine`，只做渲染与事件转发，不含逻辑；UI 数据驱动。
- **测试**：**vitest**，TDD（先写测试）。`core` 覆盖率是 CI 硬门槛；**`core` 的测试不允许 import `cc`**。`engine` 用 `cc` mock 测薄壳。
- **模块通信**：走类型安全 EventBus / 接口，不做跨模块直接引用。

### 业务开发四条硬规则（做新功能前必读全文：[`docs/design/testing-strategy-overview.md`](docs/design/testing-strategy-overview.md)）

1. **逻辑一律进 VM**（零 `cc`，可 node 直跑）；**View 只许做四件事**——取组件 / 建绑定 / 转发事件 / 转发生命周期钩子。写到第五件就下沉到 VM。单测覆盖到 VM 为止，View + prefab + 装配由启动 smoke 兜底。
2. **禁模块级单例**——`export const x = new Foo()` / `static instance` / `getInstance()` 全禁。bundle 卸载不卸脚本、编辑器 stop→play 保留 JS 上下文、单 bundle 出包依赖内联，三条都让它拿到脏的旧实例。要共享就注册进模块 DI scope（`containerScoped`）。唯一豁免是 `getRootContainer()`（ADR-0001 指定机制）。
3. **测试不进 `assets/`**——Creator 会把 `.test.ts` 当游戏脚本打包并炸构建。放 `apps/<project>/test/`，路径**镜像** `assets/`（`assets/a/B.ts` → `test/a/B.test.ts`）。
4. **`await` 回来先确认「自己还在」**——组件可能已销毁、scope 可能已关、bundle 可能已卸。回来第一件事是判（`this.node.isValid` / `e.closed` / 条目还在不在表里），再碰任何东西；**占坑要占在 `await` 之前**（守卫读的状态若是 `await` 之后才落的，那道守卫等于不存在）。**取消不是失败**：已经没人要了就安静收摊，别把它抛成错误去污染日志；宿主还活着的失败才该抛。这类 bug 只在**加载慢**的时候现形（首次从 CDN 下包、弱网），本机秒开一辈子测不出来，所以靠规则不靠运气。已修的两处现场（`AssetLoader` 的组籍时机、`LobbyHost.openModule` 的守卫时机）见 [`asset-manager.md`](packages/core/docs/modules/asset-manager.md) 与 `docs/progress.md`。

> 业务侧 lint 规则要写进 `apps/<project>/eslint.config.mjs`（`pnpm lint:demo`）——根 `eslint.config.js` 把 `apps/**` 整个 ignore 了，加在那里**静默失效**。
> 八道门：`pnpm lint` / `pnpm typecheck`（= `typecheck:pkgs` 的 `tsc -b` **加上** `typecheck:demo`——工程自己那份 `tsconfig.json` 继承 Creator 生成的 `temp/tsconfig.cocos.json`（不入库、含本机绝对路径），当不了门，所以 `apps/demo/tsconfig.check.json` 另备一份可移植的：cc 类型走 `@cocos/creator-types`）/ `pnpm test` / `pnpm check:vm-tests`（每个 `*VM.ts` 必须有镜像路径的测试）/ `pnpm check:pins`（工程引用到的 Creator 内置资源必须都被 `resources` 钉住，见下条铁律）/ `pnpm check:graph`（跨包 `import` 只许指向优先级更高的包，见下条铁律）/ `pnpm check:masks`（美术烘出来的纯数据没跟贴图同步就报错，见下条）/ `pnpm docs:api`（改了 `core` 公开 API 就重新生成并一起提交，CI 会挡不同步）。
>
> **要「形状」的逻辑，把美术在源码期烘成纯数据，别在运行时读贴图。** VM 零 `cc` 就拿不到
> `Texture2D` / `readPixels`，node 单测里更没有。`mini-plane` 的像素级碰撞是这么落地的：
> `pnpm gen:masks` 把 `art/*.png` 的 alpha 烘成 `collision-masks.ts`（位图数字数组），VM 与单测读同一份
> → 判定跨平台逐位一致、node 里可逐像素复现。代价是多一份生成物要跟美术同步，靠 `pnpm check:masks` 挡。
> `mini-hop` 的关卡同理（`scripts/gen-hop-level.mjs` → `level.ts`，87 块砖 + 硬币 + 敌人 + 出生点），
> 于是「这级台阶跳不跳得上去」在 vitest 里问得死。**它没有 `--check` 闸**：源 `.capx` 不在本仓、CI
> 比不了，那份生成物一次烘出后当手写文件维护 —— 生成物要不要配闸，看的是「源在不在仓里」。

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

> **三个层名**：**引擎层**（`libcocos.so` · 引擎 JS · `main.js`，发 APK）→ **base 层**（业务代码 · `assets/boot` · `main`/`resources`，热更后重启生效）→ **分包层**（`foundation` · `shared` · `skin-*` · `modules/*`，热更免重启）。
> 代码里的 `cck-base.json` / `baseStamp` / `DEFAULT_BASE_BUNDLES` 都指 base 层。马甲是另一维度：demo 的两个是 `default` 与 `vest`，皮包 `skin-<马甲>-<跟随者>`。

- **线上热更(hotfix)**：`HotUpdateService` 统一入口。原生走官方 `AssetsManager` + manifest；Web/小游戏走远程 Asset Bundle 版本化加载。
  native 的边界：**base 层（boot + 主包 + 业务代码）热更后重启生效，只有引擎指纹（`cc.<md5>.js`）变才必须发 APK**——靠 `main.js` 读固定名入口指针实现，见 [`ADR-0017`](docs/adr/0017-base-hotupdate-via-fixed-name-pointer.md)。
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

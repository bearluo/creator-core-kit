---
状态: 已接受
日期: 2026-08-28
依赖: docs/adr/0003-cocos-consumes-core-via-npm-workspace-package.md, docs/adr/0004-cocos-consumes-engine-via-npm-package-with-cc-external.md, docs/adr/0017-aot-hotupdate-via-fixed-name-pointer.md, docs/design/2026-08-28-mini-fish-design.md
---

# ADR-0019：什么该做成 npm 包（AOT，重启生效），什么该住 assets（bundle，免重启）

## 背景

三条既有事实，第一次在同一个决策上碰头：

1. **归属没得选。** Creator 把**所有 npm 依赖**打进 `src/chunks/bundle.js`，随主包走 AOT 层。
   **谁 import 都一样**——让某个模块 bundle 里的脚本 import 它，代码照样落 AOT chunk
   （2026-08-05 实测）。所以「让 npm 包跟着业务 bundle 走」这条路根本不存在。
2. **AOT 不再是死路。** [[adr-0017]] 之后，AOT 层照样 CDN 下发，**只是重启才生效**；
   只有引擎指纹（`cc.<md5>.js`）变才必须发 APK。「AOT 热更不了」这个说法自 2026-08-20 起作废。
3. **kit 有第三个包要被消费了。** `@cck/ecs-bitecs`（bitECS 运行时 + `spatial` 通用原语 +
   `createEcsRunner` 胶水）此前 node 全测但 `apps/demo` 零引用。`mini-fish` 是它的第一个消费者，
   于是逼出一个此前没人问过的问题：**捕鱼自己的 ECS 组件与 system 该放包里还是放 `assets/`？**

「放包里」有一个很有诱惑力的理由——显得更「框架化」，跟 `spatial` 那套规范组件（`Position` /
`Velocity` / `Circle`）并排。但那意味着调一个鱼的字段要热更 AOT + 重启，**而玩法字段恰恰是
改得最勤的东西**。

## 决策

**判据一句话：跨项目通用、且几乎不改的，才配做 npm 包；具体玩法的代码一律住 `assets/`。**

| | npm 包（`packages/*`） | 工程脚本（`apps/*/assets/`） |
|---|---|---|
| 落在哪 | AOT chunk（`src/chunks/bundle.js`） | 自己那个 Asset Bundle |
| 改它的代价 | 热更 + **重启** | 热更，**免重启** |
| 该放什么 | 跨项目通用的能力、原语、运行时 | 具体项目 / 具体玩法的组件、system、VM、View |
| 例 | `@cck/core`、`@cck/engine`、`@cck/ecs-bitecs`（bitECS + `spatial` 的 `Position`/`SpatialHash`/`movement`） | `assets/modules/mini-fish/` 的 `Fish` / `Net` / `PathFollow` / 各 system / `FishGame.ts` |

推论三条：

1. **`spatial` 那套规范组件留在包里是对的**——它们是通用的群体运动原语（任何 mass-entity 项目都用
   同一份 `Position{x,y}`），且从落地起就没改过。
2. **`Fish{kind}` 放包里就是错的**——它是这一款的玩法。kit 不该认识「鱼」。
3. **判据用「会不会常改」而不是「像不像框架代码」**。一段代码写得再通用，只要它承载的是某个项目
   的玩法数值与规则，它就会跟着策划改；把它钉进 AOT 等于给每次数值微调加一次重启。

**这条判据同样适用于将来任何一个 kit 包**：要新增 `packages/<x>`，先问「它会不会跟着某个项目的
玩法一起改」——会，就不该是包。

## 理由

- **代价不对称，而且是单向的。** 放 `assets/` 的东西**将来可以升进包**（真出现第二个项目用它时，
  那一下是必然发生的、不是可以提前省的）；放进包里的东西要降回 `assets/` 则要拆 import、
  改工程依赖、重跑一遍归属实测——贵得多。所以**默认应当是 `assets/`，进包要有理由**。
- **「显得框架化」不是理由。** 它换来的是一个抽象层次上的整洁感，付出的是每次玩法调参一次重启。
- **不必为体积担心。** `@cck/ecs-bitecs` 的 `dist` 33KB 自包含；第三方运行时留在 AOT chunk
  **共享一份、不会被复制进每个 bundle**（实测 bundle 产物里特征串 0 次）。
  所以「所有玩家都下载了 ECS 运行时哪怕不玩捕鱼」这件事在这个量级上不值得优化掉。

## 后果

**正面**

- 玩法数值与规则改动**免重启**，跟前六款子游戏的节奏一致，不因为用了 ECS 就退化。
- 给「要不要新开一个 `packages/<x>`」一条可执行的判据，不再一事一议。
- `@cck/ecs-bitecs` 的边界因此清晰：它只提供**底座与通用原语**，不认识任何一款游戏。

**负面 / 风险**

- **通用原语与玩法组件被拆在两个地方**（`Position` 在包里、`Fish` 在 `assets/`），
  读代码时要跨层跳。接受——这条缝正是热更边界本身，让它可见比藏起来好。
- **判据里的「几乎不改」是主观的**，会有边界情况（某个原语第一年不改、第二年天天改）。
  没有机械闸能判，靠这条 ADR 提醒 + code review。
- **升级路径有一次性成本**：`assets/` 里的东西升进包时要拆 import 并重跑归属实测。
  这是刻意接受的——把成本推到「真有第二个消费者」那一刻，而不是提前付。

## 备选（未采纳）

- **让 npm 包跟着业务 bundle 走**：机制上不存在（背景 1）。
- **把玩法组件也放进包里**：见「理由」。
- **为 ECS 单开一个「玩法包」`@cck/fish`**：仍然落 AOT，问题原封不动，还多一个包要维护。

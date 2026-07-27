# creator-core-kit 进度看板

> 摘要：全局进度看板（L1 索引）——各模块状态一览 + 指向设计文档。
> 何时读：想知道整体进展、下一步做什么、某模块到哪一步时。
> 状态图例：`未开始` → `设计中` → `评审中` → `已定稿` → `实现中` → `已完成`
> 维护规则见 `CLAUDE.md` 的「文档维护约定」。每次开工 / 完工更新本表。

## 里程碑

- [x] 生态调研 — `docs/research/2026-07-24-cocos-ecosystem-survey.md`（已定稿）
- [x] Bundle/AOT 打包摸底（spike bundle-probe）— `docs/research/2026-07-24-cocos-bundle-aot-probe.md`（Q1–Q4 已实证）
- [x] ADR-0001 跨 bundle 单例走全局注册表 + 热更防 AOT 缺代码 — `docs/adr/0001-cross-bundle-singleton-and-aot-hotupdate.md`（已接受）
- [x] CC/TS DI 方案横评 — `docs/research/2026-07-27-cc-di-survey.md`（已定稿）
- [x] 类型安全 EventBus 横评 — `docs/research/2026-07-27-eventbus-survey.md`（已定稿）
- [x] ITimer 定时器/帧回调横评 — `docs/research/2026-07-27-timer-survey.md`（已定稿）
- [x] Bootstrap 组合根横评 — `docs/research/2026-07-27-bootstrap-survey.md`（已定稿）
- [x] engine 半 Bootstrap + cc mock 横评 — `docs/research/2026-07-27-engine-bootstrap-and-cc-mock-survey.md`（已定稿）
- [x] ADR-0002 engine 测试策略：纯 JS + 封顶 cc mock，禁 mock 引擎行为 — `docs/adr/0002-engine-test-strategy-capped-cc-mock.md`（已接受）
- [x] ADR-0003 Cocos 消费 core 走 workspace npm 包（node_modules 直连，非拷进 assets）— `docs/adr/0003-cocos-consumes-core-via-npm-workspace-package.md`（已接受，真 cc 3.8.7 实证）
- [x] ADR-0004 engine 亦走 workspace npm 包（`cc`/`@cck/core` external），纠正决策 #7 — `docs/adr/0004-cocos-consumes-engine-via-npm-package-with-cc-external.md`（已接受，真 cc 3.8.7 实证）
- [x] 架构总纲 — `docs/design/2026-07-24-architecture-overview.md`（草案，待评审）
- [x] monorepo 骨架 — 根+core+engine、test/typecheck/build/lint 全绿；**demo 消费 core + engine 均已在真 cc 3.8.7 验证**（bare `import '@cck/core'` / `'@cck/engine'` 经 node_modules，engine dist 里 `cc` external 也被 QuickPack 解析，预览 `[CCK-DEMO]`/`[ENGINE]` 全绿）
- [x] 第 1 批 · 地基（DI ✅ Logger ✅ EventBus ✅ ITimer ✅ Bootstrap ✅(core+engine) 测试脚手架+cc mock ✅）
- [ ] 第 2 批 · 核心设施（ObjectPool ✅ SceneFlow ✅ SaveManager+IStorage ✅ i18n ✅ ConfigTable ✅(core 半) · Asset/Bundle/UI/Audio 待做）
- [ ] 第 3 批 · 进阶

## 模块状态

| 批次 | 模块 | 包 | 状态 | 设计文档 | commit |
|---|---|---|---|---|---|
| 骨架 | monorepo（pnpm workspace + vitest + lint 依赖约束） | 根 | 已实现（4/4 验收；demo 消费 core + engine 均在真 cc 3.8.7 验证，见 ADR-0003/0004） | `docs/design/modules/monorepo-scaffold.md` | — |
| 1 地基 | DI 容器 / ServiceLocator | core | 已实现（22 测试, 覆盖 100%/branch 95.6%） | `packages/core/docs/modules/di-container.md` | — |
| 1 地基 | EventBus（类型安全） | core | 已实现（19 测试, 覆盖 100%） | `packages/core/docs/modules/eventbus.md` | — |
| 1 地基 | Logger（`ILogger`） | core | 已实现（13 测试, 覆盖 100%/branch 97%） | `packages/core/docs/modules/logger.md` | — |
| 1 地基 | ITimer 抽象 | core | 已实现（21 测试, 覆盖 100%） | `packages/core/docs/modules/timer.md` | — |
| 1 地基 | Bootstrap 启动流程（组合根 `boot`/`coreModule` + engine `bootCoreKit`/帧驱动） | core/engine | 已实现（core 20 测试覆盖 100% + engine 11 测试；**engine 半 cc-logger/director 帧驱动/组合根已在真 cc 3.8.7 预览验证**） | `packages/core/docs/modules/bootstrap.md` | — |
| 1 地基 | 测试脚手架 + `cc` mock | 根/engine | 已实现（vitest 随骨架；cc mock 单一真源 tsconfig paths + vitest alias，见 ADR-0002） | `docs/adr/0002-engine-test-strategy-capped-cc-mock.md` | — |
| 2 设施 | AssetManager（`IAssetLoader`） | engine | 未开始 | — | — |
| 2 设施 | BundleManager（按需分包） | engine | 未开始 | — | — |
| 2 设施 | UIManager（层级/栈/生命周期） | engine | 未开始 | — | — |
| 2 设施 | SceneFlow（流程状态机） | core/engine | 已实现（core 半，21 测试, 覆盖 100%/branch 95.9%；真实切场景走 engine/apps/demo） | `packages/core/docs/modules/sceneflow.md` | — |
| 2 设施 | SaveManager（`IStorage`） | core/engine | 已实现（core 半，22 测试, 覆盖 100%/branch 98.6%；cc.sys.localStorage 适配走 engine/apps/demo） | `packages/core/docs/modules/save-manager.md` | — |
| 2 设施 | ObjectPool | core | 已实现（11 测试, 覆盖 100%） | `packages/core/docs/modules/object-pool.md` | — |
| 2 设施 | AudioService（`IAudioService`） | engine | 未开始 | — | — |
| 2 设施 | i18n 多语言 | core/engine | 已实现（core 半，18 测试, 覆盖 100%；字体/资源加载/语言持久化走 engine/app） | `packages/core/docs/modules/i18n.md` | — |
| 2 设施 | ConfigTable（Excel→JSON） | core/tools/engine | 已实现（core 半，14 测试, 覆盖 100%；Excel→JSON 走 tools、JSON 加载走 engine） | `packages/core/docs/modules/config-table.md` | — |
| 3 进阶 | HotUpdateService（三种热统一入口） | engine | 未开始 | — | — |
| 3 进阶 | Network / 协议层（`INetwork`） | core/engine | 未开始 | — | — |
| 3 进阶 | ECS 模块（可选） | core | 未开始 | — | — |
| 3 进阶 | MVVM 数据绑定增强 | engine | 未开始 | — | — |

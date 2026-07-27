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
- [x] 架构总纲 — `docs/design/2026-07-24-architecture-overview.md`（草案，待评审）
- [ ] monorepo 骨架 — 根+core+engine、test/typecheck/build/lint 全绿；剩 demo 消费 core 待建 demo 验证
- [ ] 第 1 批 · 地基（DI ✅ Logger ✅ EventBus ✅；ITimer / Bootstrap 待做；测试脚手架 ✅ 随骨架）
- [ ] 第 2 批 · 核心设施
- [ ] 第 3 批 · 进阶

## 模块状态

| 批次 | 模块 | 包 | 状态 | 设计文档 | commit |
|---|---|---|---|---|---|
| 骨架 | monorepo（pnpm workspace + vitest + lint 依赖约束） | 根 | 实现中（demo 消费待验） | `docs/design/modules/monorepo-scaffold.md` | — |
| 1 地基 | DI 容器 / ServiceLocator | core | 已实现（22 测试, 覆盖 100%/branch 95.6%） | `docs/design/modules/di-container.md` | — |
| 1 地基 | EventBus（类型安全） | core | 已实现（18 测试, 覆盖 100%） | `docs/design/modules/eventbus.md` | — |
| 1 地基 | Logger（`ILogger`） | core | 已实现（13 测试, 覆盖 100%/branch 97%） | `docs/design/modules/logger.md` | — |
| 1 地基 | ITimer 抽象 | core | 未开始 | — | — |
| 1 地基 | Bootstrap 启动流程 | core/engine | 未开始 | — | — |
| 1 地基 | 测试脚手架 + `cc` mock | 根/engine | 未开始 | — | — |
| 2 设施 | AssetManager（`IAssetLoader`） | engine | 未开始 | — | — |
| 2 设施 | BundleManager（按需分包） | engine | 未开始 | — | — |
| 2 设施 | UIManager（层级/栈/生命周期） | engine | 未开始 | — | — |
| 2 设施 | SceneFlow（流程状态机） | core/engine | 未开始 | — | — |
| 2 设施 | SaveManager（`IStorage`） | core/engine | 未开始 | — | — |
| 2 设施 | ObjectPool | core | 未开始 | — | — |
| 2 设施 | AudioService（`IAudioService`） | engine | 未开始 | — | — |
| 2 设施 | i18n 多语言 | core/engine | 未开始 | — | — |
| 2 设施 | ConfigTable（Excel→JSON） | core/tools | 未开始 | — | — |
| 3 进阶 | HotUpdateService（三种热统一入口） | engine | 未开始 | — | — |
| 3 进阶 | Network / 协议层（`INetwork`） | core/engine | 未开始 | — | — |
| 3 进阶 | ECS 模块（可选） | core | 未开始 | — | — |
| 3 进阶 | MVVM 数据绑定增强 | engine | 未开始 | — | — |

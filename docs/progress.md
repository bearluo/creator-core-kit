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
- [x] 资源加载 + 分包（IAssetLoader/Bundle）横评 — `docs/research/2026-07-27-asset-and-bundle-survey.md`（草案，评审中）
- [x] UIManager / AudioService 横评 — `docs/research/2026-07-27-ui-and-audio-survey.md`（草案，评审中）
- [x] HotUpdateService（线上热更）横评 — `docs/research/2026-07-28-hotupdate-survey.md`（草案，评审中；含出包期打戳/校验契约）
- [x] Network / 协议层（INetwork）横评 — `docs/research/2026-07-28-network-survey.md`（草案，评审中；seq 经 codec 桥接）
- [x] ADR-0002 engine 测试策略：纯 JS + 封顶 cc mock，禁 mock 引擎行为 — `docs/adr/0002-engine-test-strategy-capped-cc-mock.md`（已接受）
- [x] ADR-0003 Cocos 消费 core 走 workspace npm 包（node_modules 直连，非拷进 assets）— `docs/adr/0003-cocos-consumes-core-via-npm-workspace-package.md`（已接受，真 cc 3.8.7 实证）
- [x] ADR-0004 engine 亦走 workspace npm 包（`cc`/`@cck/core` external），纠正决策 #7 — `docs/adr/0004-cocos-consumes-engine-via-npm-package-with-cc-external.md`（已接受，真 cc 3.8.7 实证）
- [x] ADR-0005 engine cc 类型源改用官方 `@cocos/creator-types`（cc mock 降为纯运行时替身）— `docs/adr/0005-engine-cc-types-via-official-creator-types.md`（已接受，四门全绿实证）
- [x] engine 适配层启动 · AssetManager engine 半（`IAssetSource` cc 实现 + `ccAssetModule` 接入）— typecheck/build/test(326)/lint 四门全绿；**真机（Creator 3.8.7 gameView 预览）已验证**：`ASSET_SOURCE (cc) registered = true` + `✅ 真加载 resources/test-config.json` 读出 JsonAsset 全字段（经 funplay MCP 自动起停预览）
- [x] engine 适配层 · BundleManager engine 半（`IBundleSource` cc 实现 + `ccBundleModule` 接入）— typecheck/build/test(326)/lint 四门全绿；**真机 gameView 预览已验证**端到端全生命周期：`load('probe-bundle')`→`isLoaded=true`→具名 bundle 内加载资源（首验 AssetSource 具名分支）→`release`→`isLoaded=false`（造真 bundle `assets/bundles/probe-bundle`）
- [x] engine 适配层 · 第 2 批设施 engine 半批量（SaveManager/AudioService/UIManager/SceneFlow/i18n/ConfigTable）— `cc-storage`/`cc-audio`/`cc-ui`/`scene-loader`/`i18n-loader`/`config-loader`，typecheck/build/test(326)/lint 四门全绿；**真机 gameView 预览已验证**：3 个 cc 接缝（STORAGE/AUDIO_PLAYER/UI_VIEW）registered=true；SaveManager 全生命周期 / i18n 真加载翻译表 / ConfigTable 真加载配表 端到端；AudioService(真出声待 audioClip)、UIManager(真渲染待 prefab)、SceneFlow(真切场景待第二场景) 已验 DI 接入 + 错误路径
- [x] engine 适配层 · 第 3 批进阶 engine 半（HotUpdateService native 后端 + Network WebSocket 适配）— `hotupdate-backend`（`native.AssetsManager` 包装 + `sys.isNative` 守门 `ccHotUpdateModule`）/`net-socket`（`createWebSocketSocket` + `ccNetworkModule`），typecheck/build/test(326)/lint 四门全绿；**真机 gameView 预览已验证**：`NETWORK_SOCKET (WebSocket) registered=true` + `WebSocket 全局可用` + Network 初始 state=closed；HotUpdate web 守门 no-op（`sys.isNative=false → HOTUPDATE_BACKEND 未注册`）+ `check()=up-to-date`（空后端回退，触碰 native.AssetsManager 不崩）；Network 真 echo 待 ws 服务器、HotUpdate native 真更新待原生构建+manifest 服务器
- [x] tools 包起步 · hot-update-manifest（热更清单生成/校验，对齐 Cocos 官方 `version_generator.js`）— `buildManifest`/`writeManifests`/`verifyManifest` + CLI `cck-manifest`，纯 node stdlib 零 cc，8 测试 + bin 冒烟，四门全绿（全仓 334 passed）；解锁 HotUpdate native 的 manifest 输入，remote-assets 本地托管走本机 filebrowser CDN（skill `filebrowser-cdn`，见文档决策表 #8）
- [x] tools 包 · config-excel（Excel→JSON 配表转换，喂 ConfigTable）— `rowsToTable`(纯)/`parseWorkbook`(exceljs)/`excelToJson` + CLI `cck-excel`，4 行表头约定（用户选定）、exceljs（本仓首个第三方依赖，build-time、tsup external 未打进 bundle）；9 测试 + bin 冒烟（真 xlsx 端到端、`#`sheet/空行跳过），四门全绿（全仓 343 passed）
- [x] 架构总纲 — `docs/design/2026-07-24-architecture-overview.md`（草案，待评审）
- [x] monorepo 骨架 — 根+core+engine、test/typecheck/build/lint 全绿；**demo 消费 core + engine 均已在真 cc 3.8.7 验证**（bare `import '@cck/core'` / `'@cck/engine'` 经 node_modules，engine dist 里 `cc` external 也被 QuickPack 解析，预览 `[CCK-DEMO]`/`[ENGINE]` 全绿）
- [x] 第 1 批 · 地基（DI ✅ Logger ✅ EventBus ✅ ITimer ✅ Bootstrap ✅(core+engine) 测试脚手架+cc mock ✅）
- [x] 第 2 批 · 核心设施（ObjectPool ✅ SceneFlow ✅ SaveManager+IStorage ✅ i18n ✅ ConfigTable ✅ BundleManager ✅ AssetManager ✅ UIManager ✅ AudioService ✅）：**core 半 + engine 半均已落地**（除纯 core 的 ObjectPool 外，各模块 engine 半见其文档「engine 半适配」小节，四门全绿 + 真机预览验证）
- [ ] 第 3 批 · 进阶（HotUpdateService ✅ Network ✅(core 半 + engine 半均已落地) · ECS 扩展选型定案 bitECS[性能优先，独立包 `@cck/ecs-bitecs` 不进 core]，实现暂缓 · MVVM 数据绑定增强未开始 · tools 包：hot-update-manifest ✅ config-excel ✅）

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
| 2 设施 | AssetManager（`IAssetLoader`） | core/engine | 已实现（core 半 24 测试 100%；**engine 半 `IAssetSource` cc 实现 + `ccAssetModule` 接入，四门全绿，真机 gameView 预览已验证：registered=true + 真加载 JsonAsset 全字段**） | `packages/core/docs/modules/asset-manager.md` | — |
| 2 设施 | BundleManager（按需分包） | core/engine | 已实现（core 半，16 测试, 覆盖 100%；引用计数+inflight 去重+版本/远程入口；**engine 半 `IBundleSource` cc 实现 + `ccBundleModule`，四门全绿，真机 gameView 预览已验证：load/release 全生命周期 + 具名 bundle 内加载资源**） | `packages/core/docs/modules/bundle-manager.md` | — |
| 2 设施 | UIManager（层级/栈/生命周期） | core/engine | 已实现（core 半，15 测试, 覆盖 100%；层内单实例+并发去重+加载中 close 防泄漏；**engine 半 `IUIView` cc 实现 + `ccUIModule`，四门全绿，真机验证 DI 接入（`UI_VIEW registered`+缺 prefab 优雅失败），真渲染待 prefab 资产**） | `packages/core/docs/modules/ui-manager.md` | — |
| 2 设施 | SceneFlow（流程状态机） | core/engine | 已实现（core 半，21 测试, 覆盖 100%/branch 95.9%；**engine 半 `loadScene`/`preloadScene`（director promisify），四门全绿，真机验证错误路径（未知场景优雅 reject），真切场景待第二场景**） | `packages/core/docs/modules/sceneflow.md` | — |
| 2 设施 | SaveManager（`IStorage`） | core/engine | 已实现（core 半，22 测试, 覆盖 100%/branch 98.6%；**engine 半 `IStorage` cc.sys.localStorage 实现 + `ccStorageModule`，四门全绿，真机预览验证全生命周期（存/取/列/删）**） | `packages/core/docs/modules/save-manager.md` | — |
| 2 设施 | ObjectPool | core | 已实现（11 测试, 覆盖 100%） | `packages/core/docs/modules/object-pool.md` | — |
| 2 设施 | AudioService（`IAudioService`） | core/engine | 已实现（core 半，24 测试, 覆盖 100%；BGM 单轨+双音效路径+三档音量/静音实时下发；**engine 半 `IAudioPlayer` cc.AudioSource 实现 + `ccAudioModule`，四门全绿，真机验证 DI 接入（`AUDIO_PLAYER registered`+playOneShot 不抛），真出声待 audioClip 资产**） | `packages/core/docs/modules/audio-service.md` | — |
| 2 设施 | i18n 多语言 | core/engine | 已实现（core 半，18 测试, 覆盖 100%；**engine 半 `loadLocaleTable`+`setupLocalePersistence`，四门全绿，真机验证真加载翻译表 JSON（拍平+插值）**；字体切换随项目 onChange） | `packages/core/docs/modules/i18n.md` | — |
| 2 设施 | ConfigTable（Excel→JSON） | core/tools/engine | 已实现（core 半，14 测试, 覆盖 100%；**engine 半 `loadTable`（JSON 经 AssetLoader 加载 → register），四门全绿，真机验证真加载配表数组**；Excel→JSON 走 tools） | `packages/core/docs/modules/config-table.md` | — |
| 3 进阶 | HotUpdateService（线上热更统一入口） | core/engine | 已实现（core 半，25 测试, 覆盖 100%；统一状态机 + 版本兼容闸[钩子+安全默认] + 进度/重试；**engine 半 `native.AssetsManager` 后端 + `sys.isNative` 守门 `ccHotUpdateModule`，四门全绿，真机验证 web 守门 no-op + `check()=up-to-date`；native 真更新待原生构建+manifest 服务器**；出包期 manifest 生成/校验已由 tools `hot-update-manifest` 提供） | `packages/core/docs/modules/hotupdate-service.md` | — |
| 3 进阶 | Network / 协议层（`INetwork`） | core/engine | 已实现（core 半，28 测试, 覆盖 100%；连接状态机+请求关联[seq 经 codec]+自动重连[退避]+心跳+推送路由，调度注入 ITimer；**engine 半 `createWebSocketSocket` + `ccNetworkModule`（Web/native WebSocket，重连 identity 卫），四门全绿，真机 gameView 验证 `NETWORK_SOCKET registered=true` + 真 echo 端到端往返 OK（连 jmalloc/echo-server，request/seq 回显闭环）**） | `packages/core/docs/modules/network.md` | — |
| 3 进阶 | ECS 扩展（bitECS 接入范例，不进 core） | ecs-bitecs | 选型定案（bitECS v0.3）· 设计文档草案（评审中）· **实现暂缓（待 kit 完善）** | `packages/ecs-bitecs/docs/modules/ecs.md` | — |
| 3 进阶 | MVVM 数据绑定增强 | engine | 未开始 | — | — |
| 工具 | hot-update-manifest（热更清单生成/校验） | tools | 已实现（8 测试 + bin 冒烟；`buildManifest`/`toVersionManifest`/`writeManifests`/`verifyManifest` + CLI `cck-manifest`，格式对齐 Cocos 官方 `version_generator.js`，纯 node 零 cc，四门全绿；remote-assets 本地托管走 filebrowser CDN） | `packages/tools/docs/modules/hot-update-manifest.md` | — |
| 工具 | config-excel（Excel→JSON 配表转换） | tools | 已实现（9 测试 + bin 冒烟；`rowsToTable`(纯)/`parseWorkbook`/`excelToJson` + CLI `cck-excel`，4 行表头约定[名/类型/注释/数据]，exceljs 读[本仓首个依赖，tsup external]，输出裸行数组对齐 config-loader；四门全绿） | `packages/tools/docs/modules/config-excel.md` | — |

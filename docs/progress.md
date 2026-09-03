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
- [x] 层级管理 / UI 管理横评（对标 oops-framework · TEngine · godot-core-kit · 社区单场景）— `docs/research/2026-07-31-ui-layer-management-survey.md`（草案，评审中；结论：v1 存在「两套层未接通」+ 层序由打开顺序决定 → 已由 UIManager v2 修掉）
- [x] ADR-0008 UI 层改为 10 档固定枚举、一次定死 — `docs/adr/0008-fixed-ui-layer-enum.md`（已接受）
- [x] HotUpdateService（线上热更）横评 — `docs/research/2026-07-28-hotupdate-survey.md`（草案，评审中；含出包期打戳/校验契约）
- [x] Network / 协议层（INetwork）横评 — `docs/research/2026-07-28-network-survey.md`（草案，评审中；seq 经 codec 桥接）
- [x] ADR-0002 engine 测试策略：纯 JS + 封顶 cc mock，禁 mock 引擎行为 — `docs/adr/0002-engine-test-strategy-capped-cc-mock.md`（已接受）
- [x] ADR-0003 Cocos 消费 core 走 workspace npm 包（node_modules 直连，非拷进 assets）— `docs/adr/0003-cocos-consumes-core-via-npm-workspace-package.md`（已接受，真 cc 3.8.7 实证）
- [x] ADR-0004 engine 亦走 workspace npm 包（`cc`/`@cck/core` external），纠正决策 #7 — `docs/adr/0004-cocos-consumes-engine-via-npm-package-with-cc-external.md`（已接受，真 cc 3.8.7 实证）
- [x] ADR-0005 engine cc 类型源改用官方 `@cocos/creator-types`（cc mock 降为纯运行时替身）— `docs/adr/0005-engine-cc-types-via-official-creator-types.md`（已接受，四门全绿实证）
- [x] ADR-0006 原生 Android 构建 + 热更真机 e2e 验证机制（程序化 add-task 构建 / x86_64 / 裸 manifestUrl / 10.0.2.2 托管）— `docs/adr/0006-native-android-build-and-hotupdate-e2e.md`（已接受，真机 PASS 实证）
- [x] engine 适配层启动 · AssetManager engine 半（`IAssetSource` cc 实现 + `ccAssetModule` 接入）— typecheck/build/test(326)/lint 四门全绿；**真机（Creator 3.8.7 gameView 预览）已验证**：`ASSET_SOURCE (cc) registered = true` + `✅ 真加载 resources/test-config.json` 读出 JsonAsset 全字段（经 funplay MCP 自动起停预览）
- [x] engine 适配层 · BundleManager engine 半（`IBundleSource` cc 实现 + `ccBundleModule` 接入）— typecheck/build/test(326)/lint 四门全绿；**真机 gameView 预览已验证**端到端全生命周期：`load('probe-bundle')`→`isLoaded=true`→具名 bundle 内加载资源（首验 AssetSource 具名分支）→`release`→`isLoaded=false`（造真 bundle `assets/bundles/probe-bundle`）
- [x] engine 适配层 · 第 2 批设施 engine 半批量（SaveManager/AudioService/UIManager/SceneFlow/i18n/ConfigTable）— `cc-storage`/`cc-audio`/`cc-ui`/`scene-loader`/`i18n-loader`/`config-loader`，typecheck/build/test(326)/lint 四门全绿；**真机 gameView 预览已验证**：3 个 cc 接缝（STORAGE/AUDIO_PLAYER/UI_VIEW）registered=true；SaveManager 全生命周期 / i18n 真加载翻译表 / ConfigTable 真加载配表 端到端；AudioService(真出声待 audioClip)、SceneFlow(真切场景待第二场景) 已验 DI 接入 + 错误路径；**UIManager happy path 已端到端验证**（真 prefab open→instantiate→挂层→close 回收，🖼️/🧹 两条 PASS）
- [x] engine 适配层 · 第 3 批进阶 engine 半（HotUpdateService native 后端 + Network WebSocket 适配）— `hotupdate-backend`（`native.AssetsManager` 包装 + `sys.isNative` 守门 `ccHotUpdateModule`）/`net-socket`（`createWebSocketSocket` + `ccNetworkModule`），typecheck/build/test(326)/lint 四门全绿；**真机 gameView 预览已验证**：`NETWORK_SOCKET (WebSocket) registered=true` + `WebSocket 全局可用` + Network 初始 state=closed；HotUpdate web 守门 no-op（`sys.isNative=false → HOTUPDATE_BACKEND 未注册`）+ `check()=up-to-date`（空后端回退，触碰 native.AssetsManager 不崩）；Network 真 echo 已验证（连 jmalloc/echo-server 往返 OK）、**HotUpdate native 真更新全流程已真机 e2e 验证**（真 x86_64 Android APK，`BUILD_TAG` v1→v2 跃迁，见 ADR-0006）
- [x] tools 包起步 · hot-update-manifest（热更清单生成/校验，对齐 Cocos 官方 `version_generator.js`）— `buildManifest`/`writeManifests`/`verifyManifest` + CLI `cck-manifest`，纯 node stdlib 零 cc，8 测试 + bin 冒烟，四门全绿（全仓 334 passed）；解锁 HotUpdate native 的 manifest 输入，remote-assets 本地托管走本机 filebrowser CDN（skill `filebrowser-cdn`，见文档决策表 #8）
- [x] tools 包 · config-excel（Excel→JSON 配表转换，喂 ConfigTable）— `rowsToTable`(纯)/`parseWorkbook`(exceljs)/`excelToJson` + CLI `cck-excel`，4 行表头约定（用户选定）、exceljs（本仓首个第三方依赖，build-time、tsup external 未打进 bundle）；9 测试 + bin 冒烟（真 xlsx 端到端、`#`sheet/空行跳过），四门全绿（全仓 343 passed）
- [x] tools 包 · compat-stamp（出包期打戳/校验 — 热更版本兼容的另一半）— `computeCoreApiHash`（读 core rolled-up d.ts、剥注释+去空白算 API 表面 hash）/`writeStamp`(造 app 戳/更新戳)/`verifyCompat`（出包期主动校验，同 core gate 语义 shift-left CI）+ CLI `cck-manifest stamp`/`verify-compat`，纯 node 零 cc；10 测试 + 真 bin 冒烟（真 core dist 打戳 `fc033ce4c4a7`、改签名 hash 变→verify-compat exit 1），四门全绿（全仓 353 passed）；补齐 [[adr-0001]] 的 `coreApiHash`/`minAppVersion` 产生侧，把「AOT 缺代码跑一半才崩」提前到构建期 fail（首版 hash 级；符号级深校验为后续）
- [x] **coreApiHash 版本闸激活 · 戳的运行时读入 + filebrowser 托管**（2026-07-29 · 真机双向 e2e PASS）— app 侧读 `resources/cck-app-compat.json`→`AppInfo`、engine native backend 拉更新戳 sidecar `cck-update-compat.json`→并进 `UpdateInfo`（`compatFilename` opt-in，绕开 AssetsManager 不透传自定义字段）；同一 v1 APK 二分：远端戳 hash=app→update-available 下 v2 restart 现 v2 / 改成 `deadbeefcafe`→`rejected(needFullUpdate)` 不下载不重启；远端经 filebrowser 固定分享 `shCo8WNE`（`172.25.50.135:8081`）托管，取代 ADR-0006#6 的 http.server；闸从休眠激活，见 `docs/adr/0007-compat-stamp-runtime-readin-and-filebrowser-hosting.md`
- [x] **reactive（MVVM 数据绑定：响应式原语 + 绑 cc 节点）** — core 自写 `signal`/`computed`/`effect`/`untracked`（自动 getter 依赖追踪、`.value`、幂等 setter 挡双向回环，零依赖，语义仿 @preact/signals-core），engine 出 `bindText`/`bindProp`/`bindEditBox`/`bindToggle` + `BindingScope`（把 effect 接到 cc 属性，`onDestroy` 一行解绑，照抄 EventBus `offAll`）；核 / 壳边界：追踪与重跑全在 core（可脱 cc 测），只有「读写某 `cc.Label.string`」在 engine；**core 半 10 测试全绿**（幂等/动态依赖/清理/菱形收敛/惰性缓存），四门全绿（全仓 363）；选型横评见 `docs/research/2026-07-29-mvvm-databinding-survey.md`、设计见 `packages/core/docs/modules/reactive.md`；**engine 半真机 gameView 预览验证 PASS**（2026-07-29，代码化 UI smoke 无 prefab：`bindText`/`bindProp` 首帧刷 `'Jane:100'`/`active=true` → 改 signal 自动刷 `'Bob:42'`/`active=false` → `BindingScope.dispose()` 后冻结不再刷）
- [x] **ECS 扩展（bitECS 接入范例 · @cck/ecs-bitecs）** — 可选高性能 ECS 扩展包落地：pin `bitecs@0.3.40`（最后稳定 0.3.x，取「稳定+第三方寻路/碰撞示例好照抄」），`export * from 'bitecs'` re-export 全套 + 一层极薄 kit 接入胶水 `createEcsWorld`（`createWorld` + 秒制 `world.time`）/ `createEcsRunner(world, systems)`（`tick(dt)` 每帧驱动接缝，宿主喂时间步——不自持时钟）；**不进 core**（平级扩展包、纯 TS/纯数据、可 node 直测），示范「第三方高性能能力如何接入 kit」；6 vitest 用例全绿（含 **ITimer.onFrame 驱动 runner + dispose 冻结**，等同 engine `driveWithDirector`），四门全绿（全仓 369），`dist` 33KB 自包含（tsup `noExternal:['bitecs']` 打进运行时）；选型见 `docs/research/2026-07-28-ecs-survey.md`、设计+实现记录见 `packages/ecs-bitecs/docs/modules/ecs.md`；**demo 的 cc 渲染场景（大量 agent 移动、`Position`→`cc.Node`）留后续**（需玩法 + 真机验证，本包纯逻辑不阻塞）
- [x] **ECS spatial 高性能 system 组（寻路/碰撞/群体避让 · @cck/ecs-bitecs）** — 面向「大量圆形实体涌向玩家」(肉鸽/幸存者) 的 5 system + 4 规范组件：`SpatialHash`(均匀网格 broad-phase 基座)/`FlowField`(BFS 洪泛向量场·有墙寻路)/`seek`/`flowFollow`/`separation`(boids 分离)/`collision`(圆-圆硬推开)/`movement`(秒制积分)/`spatialIndex`；全 **hand-roll 零第三方**(不上物理引擎/navmesh/ORCA/yuka)、纯 TS·SoA·node 可测·无 WASM/SAB,横评见 `docs/research/2026-07-29-pathfinding-collision-crowd-survey.md`(**ORCA 明确不做**：单向 swarm 无对穿礼让需求)；10 vitest 全绿(结构单测 + 各 system 主路径/边界 + 集成 pipeline 群体聚拢不重合),四门全绿(全仓 379),设计+实现记录见 `packages/ecs-bitecs/docs/modules/spatial.md`；**独立 Cocos Creator 工程渲染验证留下一步**(决议 #4,本包纯逻辑已 node 全测不阻塞)
- [x] **native 热更 e2e 真机验证**（首次真原生 Android 构建 · PASS）— HotUpdateService + `ccHotUpdateModule`（`native.AssetsManager`）+ `cck-manifest` + main.js searchPaths 还原 端到端闭环，在真 x86_64 模拟器 `fortune_test` 跑通：同一 APK `BUILD_TAG` `v1`→`v2`（`game.restart()` 同进程 PID 不变），`check()=update-available(1.0.1)`→下载差量(仅 `assets/main/index.js` 17474B)→`apply`→`restart`→v2 代码接管，7 项信号全命中无崩溃；机制/runbook 见 `docs/adr/0006-native-android-build-and-hotupdate-e2e.md` + hotupdate 模块文档「native 真机 e2e 验证」节
- [x] 架构总纲 — `docs/design/2026-07-24-architecture-overview.md`（草案，待评审）
- [x] monorepo 骨架 — 根+core+engine、test/typecheck/build/lint 全绿；**demo 消费 core + engine 均已在真 cc 3.8.7 验证**（bare `import '@cck/core'` / `'@cck/engine'` 经 node_modules，engine dist 里 `cc` external 也被 QuickPack 解析，预览 `[CCK-DEMO]`/`[ENGINE]` 全绿）
- [x] **新项目接入样例 · `apps/demo`**（面向使用者的最小起步范例，区别于 DemoBoot 逐模块验证探针）— 全代码化 UI 把 kit 招牌骨架跑通：`bootCoreKit(modules)` 组合根 → 纯逻辑 ViewModel（零 cc、可单测）→ `bindText` 数据绑定（signal 变→Label 自动刷新）；**真机 gameView 预览已验证**（完整响应式链自增自动刷新，temp 自增验毕即删）；坑记：代码建 UI 节点须置 `Layers.Enum.UI_2D` 否则 UI 相机 visibility 不含它。文档见 `apps/demo/README.md`。**已于 2026-07-30 重构为「场景三分职责 + kit 常驻相机组」**（见下条）
- [x] **场景与相机架构落地（kit 常驻相机组 + 横竖屏适配 + demo 场景三分）** — 场景职责三分：`Boot.scene`（一次性启动，`Bootstrap.ts` 装配 kit → `loadScene(firstScene)`，除 app 重启不二次进入）/ `Lobby.scene`（主场兼子游戏返回目标，每次返回重载）/ 子游戏 bundle 自带场景；**三个场景一律不含相机、不含 Canvas**——相机由 kit 的 `cameraRigModule` 建成常驻 `CCKRig`（背景 `SOLID_COLOR` prio 0 层 `BG` + UI `DEPTH_ONLY` prio 200 层 `UI_2D`，priority 阶梯留 1..99 给 3D world 相机、100/300 给 UI 后景/前景），层级 root 用 `RenderRoot2D`+`Widget` 而非 Canvas-per-camera（源码级清算见 `docs/research/2026-07-30-cc-canvas-vs-renderroot2d.md`）；配 `resolutionModule` 锁短边转屏适配（竖 1080×1920/FIXED_WIDTH ↔ 横 1920×1080/FIXED_HEIGHT，引擎自己**不会**换设计分辨率）；纯决策逻辑抽成零 cc 的 `render-policy.ts`（20 单测）绕开 ADR-0002 对 mock 的限制；**Game View 预览实测全流程 0 error**（Boot→kit→Lobby→panel 模块 mount/unmount/release→game 模块切场景→`lobby:back` 回 Lobby+release）；踩坑：相机 XY 须落**可视矩形中心**而非世界原点（`view.ts` 硬置 `vb.x=0`，UI 原点在左下）、Creator packer **不监视 `node_modules/`** 改完 engine dist 要切 browser 预览强制重打包。文档见 `packages/engine/docs/modules/camera-rig.md` + `apps/demo/docs/scene-and-camera-architecture.md`
- [x] **UIManager v2 落地（注册表 + 固定层枚举 + 变体换 view）** — `registerUI(uiId, {layer?, bundle?, prefab})` 把「怎么开」收进注册表，`open(uiId, args)` 只给 id；层收敛为 10 档固定枚举（`back…top`，数组顺序即 z 序，engine 启动时一次建全 → 修掉「层序 = 首次 open 顺序」的真 bug，见 ADR-0008），层→相机层映射带回退（相机组默认只建 `bg/ui`，其余落回 `ui` root，业务零改）；`bundle`/`prefab` 写成 resolver 即支持**整包换皮**与**横竖屏换 view**，`setUIVariant` 时**只重建解析结果真的变了的**界面（普通界面转屏零成本）、重建前后经 `saveState`/`onShow(args,state)` 保状态；界面契约 `CCKUIView`（可选组件，`onShow` 可 async）；demo 大厅面板改走 UIManager，**删掉整套 globalThis 自登记注册表**（prefab 里存的就是组件类，`@ccclass` 已是引擎原生的跨 bundle 桥接）。core 31 测试、四门全绿；**浏览器预览端到端 0 error**：10 层容器按序建全 / 注册表驱动 open / 转屏 `Shop→Shop_land` 真换 view（design `1920×1080→1080×1920`）/ 未登记变体的 clicker 转屏 `sameInstance=true` 零重建 / close 回收 + 大厅恢复。踩坑：渲染后端须**延迟解析** `UI_VIEW`（构造期解析会被永久固化成空实现，症状是「open 返 true 却没画面」且无日志）；挂 `uiBack/uiFront` 的界面须做**子树 layer 归一**否则整屏不可见；手工往 prefab 加脚本组件要用 uuid 的 **compressUuid** 作 `__type__` 并补 `cc.CompPrefabInfo`。文档见 `packages/core/docs/modules/ui-manager.md`
- [x] ADR-0009 包分层判据是「启动期加载且被跨模块持有引用」，不是「哪个包」 — `docs/adr/0009-bundle-layering-criterion.md`（已接受）
- [x] ADR-0010 免重启换 bundle 代码：清模块缓存 + 注销类，且只在版本真的变了时清 — `docs/adr/0010-no-restart-bundle-code-swap.md`（已接受，web-mobile 真构建实证）
- [x] **App 层 + bundle 生命周期落地**（2026-07-31 · web 真构建 e2e PASS）— 补上「零件齐了但没有装配层」的那一层：`createApp(config,{steps})` 把 `platform`（读 app 戳→AppInfo）→`hotupdate`（native check/update/restart；web 拉版本表→**compat 闸**→`setVersions`）→`shared`→`lobby` 串成可插拔（`LaunchStep`）/ 可上报（`onProgress`）/ 三分类失败（network·needFullUpdate·fatal）/ 从失败步续跑（`retry`）的序列，切场景经 `config.lobby.enter` 回调交还 engine（core 仍零 cc）；配套 **`BundleScope`**（demo 的 `ModuleResourceScope` 上升进 core，回收顺序 `closeByBundle`→逆序 teardown→`release`）、**`BundleManager.setVersions`**（放这层而非 App——UIManager 内部也 load bundle）、**`UIManager.closeByBundle`**、**`IBundleReloader`**；compat 闸从「apply 之前」挪到「加载第一个业务 bundle 之前」（ADR-0001 的真实暴雷点，web 路径没有 apply）；demo 侧 main 包瘦身到只剩 `Boot.scene`+`Bootstrap.ts`+`AppConfig`，大厅降为 `lobby` bundle、公共资源进新建 `shared` bundle（判据见 ADR-0009）。core 24 新测试（App 14 + BundleScope 10）、四门全绿（全仓 455）；**web-mobile 真构建 + 本机静态托管 + Playwright e2e PASS**：完整启动序列 0 error、`scope.dispose` 卸载链在构建产物里成立、**运行期免重启换代码成立**（只调 `setVersions({shop:'<新md5>'})` 再进模块 → 新代码生效、`classSwapped:true`、0 报错、整页未重载）、版本不变连续进出两轮不误清缓存。顺带炸出全仓 24 处 **babel loose spread 坑**（`[...set]`→`[].concat(set)`，预览走原生 ESM 测不出、只有真构建能发现）已全改 `Array.from` + lint 硬规则挡回归。提案封存于 `docs/design/2026-07-31-app-layer-and-bundle-lifecycle-proposal.md`
- [x] **约定纠正：「代码化 UI 优先」作废，UI 一律走 prefab**（2026-07-31）— 原约定的理由是「减少 prefab 冲突」，但**工作分配本就保证不会两人同改一个 prefab**，前提不成立；代价却是把字号 / 颜色 / 布局锁死在 TS 里，美术策划碰不了。`CLAUDE.md` §多人协作 与 `docs/design/2026-07-24-architecture-overview.md` §8/§10 已改写为：**UI 一律 prefab**；**首次创建用脚本生成**（描述 JSON → 编辑器 `create-prefab`），**改已有 prefab 走 MCP**。配套落地 `apps/demo/scripts/prefab-gen/`（`build-prefab.js` 通用建树器 + `*.prefab.json` 描述，在 scene 进程里跑）——**不能自己把 JSON 写成 `.prefab` 文件**：裸序列化 `Node` 缺 `PrefabInfo`，运行时能 `instantiate` 但编辑器一打开就崩，必须借编辑器原生 `create-prefab` 落盘（实测产出 27 处 `PrefabInfo`/`CompPrefabInfo`）。据此把 demo 里仅剩的两处代码拼 UI 全部 prefab 化：`LaunchOverlay.prefab`（启动界面）、`LobbyPanel.prefab` + `LobbyItem.prefab`（大厅布局 + 入口按钮模板），脚本退化成填数据 / 绑事件的薄壳，`makeLabel`/`makeButton` 那套私货删除；进度条从 `Graphics` 手绘改为 `Sprite` FILLED（编辑器里可调）。三处 scene 进程坑记录在生成器注释里：**顶层变量必须加前缀**（`director`/`scene`/`Node` 都是进程全局，重名直接抛）、**生成后别 save 当前场景**（`create-prefab` 会把临时节点转成 prefab 实例，`destroy` 下一帧才生效，此时保存会连同 `PropertyOverrideInfo` 写进场景文件）、**资源引用必须写 `{__uuid__,__expectedType__}`**（MCP `set_component_property` 写出来的 `{uuid}` 是普通对象，运行时 `instantiate` 拿到它 → `addChild` 报 `setParent is not a function`）
- [x] **启动 / 热更界面落地（demo 侧样例）**（2026-07-31）— `LaunchOverlay.prefab` + 同名薄壳脚本：订阅 `App.onProgress/onFailure`，填文案 / 推进度 / 切失败按钮，样式全在 prefab；prefab 随 Boot.scene 的 `@property` 序列化进 **main 包**，启动第一帧就在手上（受限的只是 `shared`/`lobby` 这些还没加载的 bundle），挂常驻相机组 `ui` 层 root 跨场景存活、跑到 `running` 自毁；下载比例细分在 0.30→0.60 段内使进度条**全程单调前进**。失败按分类给不同出路：`network`→「重试」(`app.retry()` 从失败步续跑)、`needFullUpdate`→引导商店（热更换不动引擎/AOT chunks/主包，重试无意义）、`fatal`→「重启应用」。**界面留在 demo 不进 kit**（app.md 决策 #7：kit 只出事件，样式是项目的事）。目视验证顺带炸出 kit 真 bug：`appModule` 少了 `stop` → `shutdown()` 后重新 `bootCoreKit` 撞 `token "cck.app" already registered`，开发期 Game View 重播（不重载 JS，走 shutdown→reboot）每次必踩、真机进程全新看不出来；已补 `stop` 注销 `APP`/自己注册的 `BUNDLE_RELOADER` + engine 回归用例（全仓 456）。gameView 连播两轮 0 error、browser 预览 0 error
- [x] **业务侧测试与可测性规则落地**（2026-08-03）— 把 ADR-0001/0002 延伸到业务代码（`apps/*`），目标是「单测覆盖到 VM 为止，View + prefab + 装配由启动 smoke 兜底」。三条规则：**逻辑一律进 VM**（零 cc）/ **View 只做四件事**（取组件·建绑定·转发事件·转发生命周期钩子）/ **禁模块级单例**（`export const x = new`、`static instance`、`getInstance`）。落地物：`apps/demo/eslint.config.mjs`（业务契约，**必须单独一份**——根 `eslint.config.js` ignore 了 `apps/**`，规则加根配置会静默失效；扩展名必须 `.mjs`，Cocos 工程清单不能加 `"type":"module"`）+ `pnpm lint:demo`；vitest include 扩到 `apps/*/test/**`；`scripts/check-vm-tests.mjs` 存在性门槛（每个 `*VM.ts` 必须有镜像路径测试，用存在性而非覆盖率百分比——后者高分不代表有断言）；`apps/demo/test/` 目录**镜像 `assets/`**（放哪零决策、门槛脚本退化成纯路径变换、删模块连测试一起删）+ 样板 `CounterVM.test.ts`（10 用例，含「实例互不影响」的单例回归闸）。配套改动：`assets/test/` **改名 `assets/probes/`**（里面是运行时探针不是测试，与新单测目录撞名；走 asset-db 移动，uuid 与 `fixtures-bundle` 的 bundle 名均不变）、`CounterVM.restore()` 把 `ClickerView` 里滞留的类型判断下沉、`Bootstrap.ts` 的 `[...defaultLaunchSteps()]` 改 `Array.from`。**规则 B 明确不做 lint**（试过 View import 白名单，会误伤 `ShopView` 用 `getI18n().t()` 填 Label 这种合法绑值——为抓不准的规则改写合规代码是让 lint 指挥架构），保留为审查条款 + 自检清单。已知债：`LobbyHost.ts` 的 `LobbyNav` 是 module-level 单例（其 `navKit` 字段正是「预览重播 kit 换了、单例还活着」的手工补丁，是本规则的实况样本），已 `eslint-disable-next-line` 显式标注，改造需真机复验、另开一单。四门全绿（lint / typecheck / test 466 / check:vm-tests）。规则全文见 `docs/design/testing-strategy-overview.md`
- [x] **`coreModule` 补 `stop`：EVENT_BUS / TIMER 不再活过 `shutdown()`**（2026-08-03）— 之前 `coreModule` 只 `install` 不 `stop`，而 `install` 有 `hasLocal` 守卫 → `shutdown()` 后重新 boot **复用旧总线**，上一轮的订阅还挂在上面 → **新一轮 emit 双份触发**（开发期 Game View 重播 shutdown→reboot 每次都踩，真机进程全新反而看不出来）。修法照 `appModule.stop` 的惯例：`owns*` 标记只注销自己注册的那份，项目预注册的实现不动。单测复现并锁死（bootstrap 3 例：注销后重新 boot 拿到新实例 / 上一轮订阅不再触发 / 预注册的保留），全仓 469。连带 `apps/demo` 的 `LobbyNav` 由 module-level 单例（`static instance()`）改为 **DI 容器按 kit 归属**（`resolveNav()`，见 `testing-strategy-overview.md` §4 规则 C），`eslint-disable` 移除；kit 比对保留但语义变了——不是「单例的税」，而是「新 kit = 新总线，必须重新订阅」。**gameView 预览已验证**：启动全流程 0 error ×4 轮、panel 模块 open/close 往返（shop：i18n 随 bundle 就绪 → `scope.dispose` 一行全撤 → `isLoaded=false`）、game 往返（mini-dodge：`loadScene` → `emit 'lobby:back'` → 回大厅 + `release`，「返回大厅」只打一次即无双份触发）、跨场景后 `resolveNav()` 走缓存分支打「Lobby.scene 重新加载」（证明实例挪进 DI 后跨场景常驻仍成立）。**未验证**：`resolveNav()` 的 kit 变更分支——它要求预览 stop→play 时 JS 上下文存活，而当前 Creator 每次重播都打印「预览环境初始化完毕」重建 webview（`Bootstrap.ts` 的 `EDITOR` 守卫日志同样从未出现，可作探针）
- [x] **ADR-0011 服务端不进本仓 · 客户端侧 pb 接入**（2026-08-03）— 起点是「网络交互无法验证」：`INetwork` 只被单测里的假 socket 驱动过。横评产出 `docs/research/2026-08-03-game-server-survey.md`，决策落 `docs/adr/0011-server-framework-split-and-protocol-contract.md`。**本仓的决定**：服务端**不进本仓**（本仓是 Cocos 客户端框架，焊进来 `godot-core-kit` 就永远接不上）→ 独立 `server-core-kit`（Go）+ 独立 `kit-proto` 作三方共用的冻结契约；本仓只消费契约，**不定义协议**。pb 的 JS 运行时选 **protobufjs `--target static-module` 而非 protobuf-es**（后者包体小一半但编码慢约 5.1x、解码慢约 14.8x，长连接高频收包每帧都在付税）——这条是 JS 侧的实现选择，留在本仓。**已落地**：✅ `binaryType='arraybuffer'`（原缺，默认 `'blob'` → `ev.data` 是 Blob，而 `ICodec.decode` 是同步签名，接口形状直接不兼容；JSON codec 走 string 所以一直没暴露）+ 6 个薄壳用例；✅ `createProtobufCodec(schema)` + `createPbSchema`（帧头拆装在框架、cmd 映射与 body 编解码全在注入的 `PbSchema`；seq 0 保留给非请求，core 的 `nextSeq` 从 1 起不冲突；13 用例、100% 覆盖，全仓 488）。余下两条（`IHttp` 接缝 + dispatcher 启动步）见下一条。协议本身与服务端的进度看各自仓的看板
- [x] **`core` API 参考文档自动化（typedoc → 入库 md + CI 漂移闸）**（2026-08-04）— `pnpm docs:api` 以 `packages/core/src/*/index.ts` 为入口生成 `packages/core/docs/api/`（18 模块一模块一页 + `README.md` 索引，签名 + TSDoc 注释 + 源码行链接）。**入库而不是发站点**：hlgit 实例的 Pages 域名还停在默认的 `example.com`（未配置），artifact 里的 HTML 也因此无法在线渲染 —— 只有入库的 md 能在 GitLab 上直接翻；`.gitattributes` 标 `gitlab-generated` 让 MR diff 折叠。CI **不推回仓库**（免 token 与提交回环），只在 `verify` 末尾加第五门：重新生成后 `git status --porcelain` 非空即失败，提示本地 `pnpm docs:api` 后一起提交。两个坑：源码链接必须 `sourceLinkTemplate` 固定指向 `main`，否则默认嵌当前 commit sha → 每次提交全量 diff、漂移闸永远红；`typedoc-plugin-markdown` 最新版（4.12）要求 typedoc ≥0.28，与本仓的 0.27 不兼容（加载即 `does not provide an export named 'CategoryRouter'`），已 pin `4.4.2`
- [x] **服务端接入闭环（`IHttp` + dispatch 启动步 + 真服务器 e2e）**（2026-08-04 · 本机 docker PASS）— 补齐 ADR-0011 后果里剩下的两条，客户端首次与真实服务端跑通。**`IHttp` 接缝**（`network.md` 决策 #2 当初 YAGNI 掉的短请求收回来）：core 出 `IHttp`/`HTTP`/`getHttp`/`postJson`，engine 出 `createXhrHttp` + `ccHttpModule`；**用 XHR 不用 fetch**——Web / native jsb / 小游戏三边都提供 XHR（Cocos 自己的下载器就走它），fetch 在 jsb 上不保证有。返回 `{status,text}` 原始文本而非解析好的对象：解析留在 core（可 node 单测），适配层只搬字节。**`dispatch` 启动步**（排 `platform` 与 `hotupdate` 之间）：握手包里的 `capabilityStamp` 就是 `platform` 步读出的 `coreApiHash`，服务端不解释它怎么算出来的、只做等值比对（引擎中立的关键）；判定落 `bag[DISPATCH]`（`wsUrl`/`cdnUrl`/`serverTimeMs`），`update`→`needFullUpdate`(带 storeUrl)、`maintenance`→**新增的第四类失败**（停服可重试但必须先显示公告，否则玩家只会连点重试）。信封 `{code,msg,data}` 判定**看 code 不看 HTTP 状态码**（业务错误一律 200，CDN / 渠道代理会吞 4xx/5xx），枚举名与枚举号、snake_case 与 camelCase 四种组合都认。**真服务器 e2e**：`e2e-server.test.ts` 打本机 docker（dispatcher :9100 + gateway :9101 + demo lobby）——握手拿 `ACTION_PLAY` → 按下发的 `wsUrl` 连网关 → `request('Ping')` 收到 seq 对得上的 `Pong`，证的是单测证不了的帧头字节序与「seq 被服务端原样回传」；**服务器没起就整体跳过**（探 `/healthz`，不看环境变量 → CI 恒跳过、本机起了就自动生效）。demo 侧接上：`ccHttpModule()` 进模块数组、`APP_CONFIG.dispatcher` 指向局域网 IP（**不是 127.0.0.1**——真机 / 模拟器上 localhost 指它自己）、版本升到 1.3.0（本机 dispatcher 的放行线，调回 1.2.0 即可看版本闸生效）。core 覆盖：`http.ts` 100%，dispatch 步 16 用例，全仓 **519 全绿**，五门齐过。**浏览器预览验证顺带炸出服务端缺口并已闭环**：demo 侧接线全对，但 dispatcher 当时**没有 CORS 头且 `PostOnly` 把预检 `OPTIONS` 直接 405**，浏览器一律拦截 → web-mobile 构建与浏览器预览连不上（native / 小游戏无 CORS 概念，不受影响）。这是 `server-core-kit` 的事、本仓补不了（XHR 只拿到一个不说原因的 `onerror`，看着像服务器挂了），已经 Orca 派给该仓窗口修复（CORS 中间件包在 `PostOnly` 外层、来源可配默认 `*`、镜像重建重启）。**复验通过**：预检 204 带全套 `Access-Control-*`、真实 POST 200 带 `ACAO`；浏览器预览完整启动链路 0 error 跑到 `running` 进大厅（`platform → dispatch`（拿到 ws/cdn/权威时间）`→ hotupdate → shared → lobby`）。**未做**：Cocos 工程侧消费 `kit-proto` 生成产物（业务 socket 往返还差这一步，要先解决 Creator 怎么打包 npm 包）→ 见下一条，已打通
- [x] **协议接入打通（`@kit/proto` 进 Cocos → 真网关 Ping/Pong）**（2026-08-04 · 浏览器预览 PASS）— 上一条剩的那个「未做」：契约的生成产物第一次进到 Cocos 运行时。**契约怎么进来**：`@kit/proto` 作 **git 依赖**（`git+https://…/kit-proto.git#v0.1.0`，lockfile 锁到 commit `c28af29`）挂在 `apps/demo` 上——契约仓把 `gen/` 提交进仓正是为了「消费方直接拿、不装 protoc/pbjs 工具链」，Go 侧也是 git 消费，TS 侧对齐。**胶水归项目不归 kit**（ADR-0011：kit 源码里不出现任何 cmd 号或消息定义）：`apps/demo/assets/scenes/kit-net.ts` 一个文件——`createKitSchema()` 把 `CMD`（消息名→cmd 号）与 `kit.v1.*`（pb 消息类）拼成 core 认的 `PbSchema`，`netConnectStep()` 作 `dispatch` 阶段的启动步，按 dispatcher 下发的 `wsUrl` 连网关、打一次 `Ping` 自检（连上 ≠ 协议对得上；帧头字节序 / cmd 表 / pb 编码任一错都在这现形）、把实例注册进 DI 供业务 `getNetwork()`。心跳类型改成契约的 `Ping`——core 默认的 `'__ping'` 不在 schema 里，编码当场抛。**预览 + 真构建双实测**：浏览器预览 `[CCK-NET] 长连接就绪 … RTT 90ms`；**web-mobile 真构建产物**（本机静态托管 + Playwright 打开）同样 `长连接就绪 … RTT 13ms`，两边都是全链 0 error 跑到 `running`。构建这一遍是必要的而不是补刀——预览走原生 ESM，只有真构建才过 babel/terser（本仓的 loose spread 坑就是这么漏过预览的）；顺带查了 `kit.js` 与 protobufjs 源码**零数组展开**（`...` 只出现在 JSDoc 里），这个坑对契约层不成立。这一条同时回答了悬着的「Creator 怎么打包 npm 包」：**认 package `exports`（含 `./cmd` 子路径）、吃得下 protobufjs static-module**（CJS + `inquire()` 那个专门用来骗打包器的动态 require），预览与构建两条路径都认。**顺带炸出三个真问题**：① `.npmrc` 里的 `node-linker=hoisted` **自 pnpm 10 起就不生效了**（配置迁到 `pnpm-workspace.yaml`），一直静默失效——`@cck/*` 是工作区直连 symlink 所以照常工作，直到 `@kit/proto` 带进第三方传递依赖才暴露；已把 `nodeLinker: hoisted` 移进 `pnpm-workspace.yaml`、删掉 `.npmrc`（扁平 node_modules 是当初为 Cocos 解析器定的，见 scaffold 决策表 #2）。② demo 从来没装 `ccNetworkModule()` → `createNetwork` **静默回退到 core 的空 socket**（`connect` 是 no-op、回调永不触发）→ 启动**永远停在进度条上且不报任何错**；补模块之外还给 `waitOpen` 加了 10s 超时——`connecting` 可以永远不结束（被防火墙黑洞掉的 SYN 不回 RST），启动期不能无限等。③ Creator 基配的 `moduleResolution: "node"` 是 node10、不读 `exports`，tsc 报 `Cannot find module '@kit/proto'`；`apps/demo/tsconfig.json` 覆盖成 `bundler` 对齐运行期实际行为。**CI 侧补两处**（契约仓私有 + runner 无公网）：镜像换 `match/node:22-slim-git`（`node:*-slim` 不带 git，pnpm 拉不了 git 依赖），拉取授权走**本次 job 的 `CI_JOB_TOKEN`** + `git config insteadOf` 改写——读权限由 kit-proto 侧的 job-token inbound allowlist 授予，**本仓不留任何长期凭据**，撤销就是删那边白名单一行。新增 `apps/demo/test/scenes/kit-net.test.ts` 4 例契约守卫（CMD 每项都有对应 pb 类 / 双向表一致 / `Ping` 帧头大端 + body 原样解回 / 空 body 心跳可编码），全仓 **523 全绿**，五门齐过
- [x] **协议按功能模块分包（模块段随 Asset Bundle 热更）**（2026-08-05 · 预览 + web-mobile 真构建双 PASS · ADR-0012）— 上一条把契约接进来了，但接的方式和分包更新是冲突的：**Cocos 把所有 npm 依赖统一打进 `src/chunks/bundle.js`**，那是随主包走的 AOT 层，谁 import 都一样（实测让模块 bundle 里的脚本 import 契约包，代码照样落 AOT）。后果是**加一个子游戏的协议 = 发新包**——子游戏的代码/prefab/配表都能随 bundle 热更，唯独协议不能。**先否掉了看起来更优雅的那条路**：pbjs 产 json descriptor、运行时 `Root.fromJSON` 反射建类型，协议就成了 bundle 里的一个资源，热更天然成立、连拷文件都省。实测反射版与静态生成代码**编出的字节完全一致、可互相解码**，但它靠 `Function.apply(null, source)` 动态生成 codec 且**没有 fallback**（`@protobufjs/codegen`），微信/抖音小游戏禁 `new Function` → 对「全平台」直接出局。**最终形态**：基础段（握手/心跳/错误/分配器，cmd 1–999）留 AOT 走 npm `exports`，它本来就不该常变；模块段（第 N 个模块占 `1000*N ..+999`，号段由契约仓统一分配、**一经发布不许改不许复用**）由 kit-proto 额外产**单文件 `.ts`**，`pnpm proto:sync` 拷进 `assets/modules/<模块>/` 随 bundle 打包热更。**核心侧只多一个机制**：`createPbSchemaRegistry()` 让 codec 拿一张可增量的表——AOT 装基础段并注册进 `PB_SCHEMA` token，模块加载时 `add` 自己那段、注销函数交 `BundleScope.add()` 托管，全程 `INetwork` 与 codec 实例不换、连接不断；type 重名/cmd 撞号在 `add` 当场抛且校验全过才落库（撞号只在两模块同时在线时才复现，症状是 A 模块的包被发给 B 模块，必须挡在加载期），注销按**引用比对**所以模块热更重载后旧注销函数不会误删新段。core 仍不含任何 cmd 号（ADR-0011 不变）。**分包实测**（web-mobile 产物）：`assets/mini-clicker/index.js` 里 `ClickRequest` ×70、`HandshakeRequest` ×0、protobufjs 运行时 ×0；`src/chunks/bundle.js`（AOT）里 `ClickRequest` **×0**、基础段 ×87、protobufjs ×2 —— 模块协议一个字节没进 AOT，运行时也没被复制进 bundle。**端到端**（预览 RTT 98ms / 真构建 RTT 2ms，两边 0 error 跑到 `running` 并打开模块）：模块段 cmd 1000 编码发出 → 网关按 cmd 路由 → 回**基础段**的 `Error{NOT_HANDSHAKED}`（服务端没有 clicker 玩法，它是号段样板）→ 用基础段解回来。两段在同一张注册表里各司其职，正是分包要证的。**踩了三个坑**：① **`assets/` 下的 `.js` 被 Creator 一律当 CommonJS**（内部重写成 `xxx.mjs?cjs=&original=.js`），喂 pbjs 的 ESM 产物直接 `Unexpected import statement in CJS module` 炸构建 → 模块段产物必须是 `.ts`。② **`temp/programming/` 删不得**：里面的 `preview/systemjs/system.js` 与 `packer-driver/` 是 Creator **启动时**铺的，运行中不重建 → 预览 500、构建把**所有**自定义组件当 missing 剔掉（连一直正常的 `Bootstrap` 都报），只能重启编辑器。要清缓存请重启 Creator，别手删。③ `Clicker.prefab` 根节点挂的唯一组件是**已删除的 `ClickerModule`**，`ClickerView` 根本没挂上去 → 这个模块从来没真正跑过；根因是改名时 uuid 被复用，Creator 的「已删除脚本」记录仍占着它，构建期据此剔组件、`_components` 留 null 洞、运行时 `addChild` 直接炸。给脚本换了干净 uuid 并同步 prefab 的 class id（压缩算法拿 ShopView 自校验过）。新增 demo 侧 5 例（CMD 每项都有 pb 类 / **号段边界与不撞基础段** / 注册前后同一 codec 的行为 / 注销后本段消失而基础段照常 / 重复注册幂等——界面转屏重建会再调一次 `onShow`），全仓 **536 全绿**，五门齐过。契约仓侧（`kit-proto` v0.3.0：proto 按模块分目录 + 号段分配表 + `.ts` 模块段产物 + clicker 样板）经 Orca 派给该仓窗口完成。**环境备注**：验证期间 dispatcher 被重启成了下发 `127.0.0.1` 的那份配置（`configs/dispatcher.json` 而非 `deploy/dispatcher.local.json`），容器里的浏览器够不着 → 真构建那一遍用客户端侧地址改写绕过，不涉及游戏代码；那是 `server-core-kit` 的配置，本仓改不了
- [x] **native 分包热更（一 bundle 一 manifest，加载前按需更新）**（2026-08-05 · 真机 e2e PASS · ADR-0013）— 上一条查清了三层边界，但 L2 那层当时只有「能不重启换代码」，**下载仍是全局一次性**：一张 `project.manifest` 覆盖 `src/`+`jsb-adapter/`+所有 bundle（demo 实测 47 条里 6 个模块包全挤在一起、共用版本号），`update()` 一调把玩家永远不会点开的子游戏也下了。**动工前先读了 `AssetsManagerEx.cpp`/`Manifest.cpp`，改掉两条原本要写进设计的假设**：① C++ 在 `create()`（`prepareLocalManifest→prependSearchPaths`）和 `updateSucceed()` 第 4–5 步都**自行** `setSearchPaths`，而 `UPDATE_FINISHED` 是第 7 步才派发——**我们 `apply()` 里那句 `unshift` 是纯重复劳动**，真机 localStorage 里抓到了实证（同一路径两份，每更新一轮多一条），已改成「归一化 + setSearchPaths + 仅 base 持久化」；那次 `setSearchPaths` 不能省，它顺带清 `_fullPathCache`，而 `prependSearchPaths` 在路径已存在时不调它 → 同一 bundle 二次更新若删了某文件，旧解析会一直缓存着（C++ 的 `purgeCachedEntries()` **无 JS 绑定**，`setSearchPaths` 是其超集，不必改引擎）。② `_cacheManifestPath = _storagePath + MANIFEST_FILENAME` 而 `MANIFEST_FILENAME` **硬编码** `"project.manifest"` → 一 bundle 一 storagePath 从「不敢赌」变成「必然冲突」，且必须与 base 的 **并列不嵌套**（`loadLocalManifest` 在包内比缓存新时会 `removeDirectory(_storagePath)`）。**最有价值的推论：模块 bundle 根本不需要 `main.js` 的启动还原**——`create()` 时 C++ 就把它的 storagePath 前插了，而模块此刻尚未加载，于是分包更新完全不用碰 `index.ejs`。**落地三层**：tools `cck-manifest --split` 切成 base + 各 bundle（key 一律相对 data 根，bundle manifest 只是全表子集，否则引擎按 `assets/shop/index.js` 查必 miss）；core 新增 `HOTUPDATE_BACKEND_FACTORY` + `BundleUpdater`（一 bundle 一个 `HotUpdateService` 实例，状态机/闸/进度全复用，公开签名一字未改）挂进 `BundleManager.load` 之前——位置同 `setVersions`（UIManager 开界面也会 load bundle，挂上层必漏），但**解析时机不同**：`updater` 每次 load 现取而非建时定死，因为它要带的 app 戳是启动后才读到的，定死就永远拿不到；engine 加 `createCcBundleBackendFactory`。`ensureLatest` **永不 reject**——离线/CDN 挂/闸拒一律退回包内版本，热更失败让玩家进不去游戏严重得多。**真机 e2e**（干净安装，base 与包内 manifest md5 完全一致、只有 `shop.manifest` 提到 1.0.1）：`BUILD_TAG` 全程 v1（没重启）、base `check()=up-to-date`、`load('shop')` 前自动更新**只下 271 字节**那一个变更文件 → `SHOP_TAG=v2`；`am force-stop` 冷启动仍 v2；**断开托管**冷启动仍 v2 且 localStorage 里确无 `HotUpdateSearchPaths`——只可能来自 `create()` 时的 `prependSearchPaths`。**否掉了 native 也开 md5**（对齐 web）：实测 `main.js` 本身**不**带 md5（`handleTemplateMd5Link` 改的是模板里的引用，C++ 硬编码的 `main.js`/`web-adapter.js` 恰好都在排除名单），但引用链 `main.js → application.<md5>.js → settings.<md5>.json → bundleVers` 会把「改一个模块」传导成「必须发整包」，因为 `main.js` 属 L0；不开 md5 时 `bundleVers` 是 `{}`，链根本不存在。**另修一个可复现性坑**：`add-task` 的 `packages.android.apiLevel` 必须是**数字 34**，传 `'android-34'` 时 Creator 照样「构建成功」但 `gradle.properties` 写出 `PROP_COMPILE_SDK_VERSION=NaN`，gradle 在 `app/build.gradle:10` 炸 `For input string: "NaN"`——报错点离病根很远（已补进 ADR-0006）。**遗留已清**（见下一条）
- [x] **native 启动还原迁进 `build-templates` + 更新边界查证**（2026-08-05 · android 构建 + **APK 冷启动 e2e** 双 PASS）— 热更的冷启动还原此前是**直接改构建产物** `build/android/data/main.js`（ADR-0006 决策 5 的待办，当时猜的持久化路径是 `build-templates/android/data/main.js`）。查证：原生 `main.js` 由 Creator 内置 `templates/native/index.ejs` 渲染，**官方支持的覆盖点是 `build-templates/native/index.ejs`** —— 平台目录是 `native`（三平台共用一份）、不带 `data/` 那层、覆盖的是 **ejs 模板**而非渲染结果（Creator 升级时内置模板变更会同步过来，不用捧一份越来越旧的 fork）。落 `apps/demo/build-templates/native/index.ejs`（还原逻辑照抄官方 hot-update 教程那段：搜索路径 + `_temp/` 断点修复，多包一层 try/catch 免得存档坏了卡启动黑屏），跑 android 构建实测：产物 4112 字节（默认模板 840）、注入块在最顶、占位符正常渲染、`build success in 12 s`。**并补跑了 2026-07-28 那次没做的一步——杀进程冷启动 e2e**（该模板打出的 24.9MB debug APK，真 x86_64 模拟器）：PID 6157 `BUILD_TAG=v1` → check `update-available` 1.0.1（`coreApiHash` 闸放行）→ 下 53898 字节 → `ready` → `game.restart()` → v2；`am force-stop` 后 **PID 6321 冷启动仍 v2**、`check()=up-to-date`（读的是可写路径那份 1.0.1 manifest）；再断掉远端托管 **PID 6551 冷启动仍 v2**、check 优雅 error 不崩，排除「其实是又下了一遍」。PID 变化是判据——`game.restart()` 同进程重启靠内存里已生效的 `setSearchPaths`，验不到还原逻辑，只有全新进程里仍是 v2 才证明 `index.ejs` 那段在引擎起来之前真跑了。全程无 FATAL / native signal。**顺带修掉一个静默陷阱**：`apps/demo/.gitignore` 的裸 `native` 与根 `.gitignore` 的 `**/native/`（本意是忽略 Creator 生成的原生工程目录）会把 `build-templates/native/` 一并吞掉，已分别锚成 `/native/`、`/apps/*/native/`。**同时查清了 native 的更新边界**（读 `BaseGame.cpp` + 构建产物）：C++ 依次 `runScript("jsb-adapter/web-adapter.js")` → `runScript("main.js")`，两者都用**默认搜索路径**解析，而还原逻辑就在 `main.js` 里 → 热更范围被切成三段：**L0 不可热更**（native `.so`、`web-adapter.js`、**`main.js` 自身**）/ **L1 可热更需重启**（`src/**` 含 `cocos-js/cc.js`、`assets/main`、`assets/res`、`jsb-adapter/engine-adapter.js`）/ **L2 模块 bundle 可免重启**。落到实处：`localStorage` 实现在 L0 而 `apply()` 靠它存搜索路径（**存档机制自己不可热更**）；`jsb.WebSocket`/定时器/Promise polyfill/音频/输入出问题只能发版；`cck-manifest` 收 `jsb-adapter` 整目录，其中 `web-adapter.js`（~170KB）属 L0，**下了也不会被用，是死重量**；`cc.js` 属 L1 能换但与 L0 的 `.so` 配套，**热更包必须由与线上包同一 Creator 版本 + 同一引擎裁剪配置产出**，跨版本换 `cc.js` 崩在绑定层——这比 `coreApiHash` 闸挡的更底层，闸目前不覆盖。分析写进 `hotupdate-service.md` §Platform，ADR-0006 文末追加决策 5 的路径修正
- [x] **分包热更收尾：逐包版本节奏（`--prev`）+ 已下线 bundle 目录回收**（2026-08-05 · 真机 e2e PASS）— 上一条留的两个口子。**版本节奏**：`cck-manifest --split --prev <上次发布目录>` 逐份与上一版比对（资产表 + `packageUrl` + `searchPaths`，即 version 之外的一切），内容全等就沿用旧 `version`，只有真改了的包才用新号 → 没动的包客户端直接 `ALREADY_UP_TO_DATE`，不再空跑「NEW_VERSION_FOUND → 下载 0 个文件」。**调研否掉了原提案倾向的「直接拿内容 hash 当版本号」**：`Manifest::versionGreater` 无自定义 handle 时走 `cmpVersion`（`Manifest.cpp:57`），它先 `sscanf("%d.%d.%d.%d")`、**任一侧解析不出数字才退化成 `strcmp`** —— 纯 hash 以数字开头（`03cb…`）会被吃成 `3`、与 `03aa…` 判等 → 永不更新；加前缀强制走 `strcmp` 则字典序不单调，而 `loadRemoteManifest` 是 `local >= remote → UP_TO_DATE`，约一半发版被静默判成已最新。沿用旧号则版本仍单调递增，绕开这颗雷。文档里标死 **`--prev` 必须是紧邻的上一版**（比对只看一版；指向两版之前会发出比客户端更旧的号）。**目录回收**：`pruneCcBundleStorage(keep)` 启动时对账一次删掉不在名单里的目录；名单由 app 给——native 侧查不到「远端还发不发」，包内 `assets/` 有哪些目录跟这是两回事，删错了下次 `load` 只能退回包内旧版本。**真机先查后写救回一个 bug**：存储根里除 `<bundle>/` 还并排躺着 `<bundle>_temp/`（`_tempStoragePath` = storagePath 去尾斜杠 + `TEMP_PACKAGE_SUFFIX`），那是断点续传状态，按名单直删会把在用 bundle 的续传一起清掉；另 `listFiles` 返回**完整路径**、目录带尾 `/`、且含 tinydir 给的 `.` 与 `..`（不滤就是删存储根自己和它爹）。**e2e**：设备上手植 `arena/`+`arena_temp/`，远端用 `--prev`（基线 = 从已装 APK 里解出来的包内 manifest）重算 → base 涨 1.0.1、5/6 个模块包**与包内逐字节一致**沿用 1.0.0（顺带证明 Creator 构建对未改内容可复现，是 `--prev` 成立的前提）、只有 shop 涨；设备 base 只下 2/22 个文件后 `restart` → 新 JS 报 `回收已下线 bundle 目录 2 个`（arena + arena_temp），`shop/`/`shop_temp/` 未误删、`SHOP_TAG=v2` 照读；再 force-stop 冷启动回收 0 个、幂等。新增 15 用例（tools 8 + engine 7），全仓 **580 全绿**，五门齐过
- [x] **接 `GatewayRetiring`（cmd 16）—— 网关优雅退休**（2026-08-05 · 单测 + **真服务器 e2e 双 PASS**）— 契约仓 v0.4.0 加的一条**推送**，服务端已实现；缺客户端这半边它就是被静默丢掉的一帧。以前网关更新只有一条路：服务端把所有连接 `Kick` 掉、几千人同时重连，正在战斗/结算的最难受。现在服务端**只通知不断连**——「什么时候适合搬家」只有客户端知道，择机权交给客户端。**落点在 `apps/demo/assets/scenes/kit-net.ts`**（ADR-0011：kit 里不出现 cmd 号），新增 `createGatewayMigration(net, rehandshake)`：收到就置一个 `pending` 标志（**不断连、不弹倒计时**），`atSafePoint()` 由业务在自己认为合适的时机调——demo 取「回到大厅」（`LobbyHost.enterLobby` 一行，没在退休时是 no-op）。新地址**只从握手拿**：契约不带 `ws_url`，dispatcher 才是唯一路由真相，猜地址/复用旧地址会绕过维护模式与版本退休；重新握手直接复用 kit 默认序列里的 `dispatch` 步（同一段请求体与解析，不另写会漂移的副本），并把启动时读到的 `APP_INFO` 一起带上——版本/`capabilityStamp` 决定被路由到哪个部署单元，丢了它重连可能落到另一组机器。**`deadline_at_ms` 不做本地计时器**：0 是常态（不会被踢），非 0 到点服务端会 `Kick` 并断开，而「退休期间掉线就先握手换地址、别按老地址退避重连」这条 `onState` 兜底把那条路径一并覆盖了——省掉一整套倒计时逻辑，也顺手修掉「退休中掉线会一直往正在下线的网关上撞」。**握手失败不升级成故障**（老网关还活着，下个时机再试）。**契约不变量已验**：未注册的 cmd 走 `decode` 抛 → core 吞成一条 warn 并丢帧，连接照常 `open`，不会因为服务端加了条新推送就把存量客户端全踢一遍。**真服务器 e2e 实测坐实了一条设计缺口并已加防护**：连上真网关 → 内网 `POST /admin/retire`（网关容器内 9200，不对外）→ 客户端**确实收到 cmd 16 且连接未断**，随后重新握手连上网关并 Ping/Pong 通 —— 但**握手把我又派回了同一台正在退休的网关**，新连接一上来又收到 cmd 16。dispatcher 没把退休网关摘出路由池（单网关部署下也摘不了），于是「搬家」是空转：择机点每次白断一次重连，掉线那条路径更会变成**没有退避的自旋**（握手 → 连 → 断 → 握手 …）。客户端侧加一道判断——**握手回来的地址与当前所在的相同就不搬，同时把待搬家标志撤掉**。撤掉而不是挂着，是因为**握手没有缓存**：它返回的就是 dispatcher 此刻的路由真相，还往这台派人就说明这台现在可用（退休撤销了，或路由尚未摘除；契约没有「取消退休」这种消息，只能这么推断，而这两者从客户端看不可区分也不必区分）。挂着标志只会让此后每个时机、每次断线都白打一次握手且永远清不掉。撤掉是安全的，服务端有两条路会再叫醒客户端：真还在退休的话**连接一断重连上去立刻又收到一条 `GatewayRetiring`**（就是本次实测那条证据），或 deadline 到点 `Kick` + 断连走掉线路径。根因仍留给服务端（该在 retire 前先摘路由）。新增 8 例（收到不是被踢 / 重新握手连到下发的网关 / 未退休时 no-op / 后一条覆盖前一条不叠加 / 退休期掉线先换地址 / 握手拿不到地址留原网关 / **握手仍指向原网关时不搬也不永久挂着** / 未注册 cmd 丢弃不断连，推送帧走**真 codec 真契约**编出来）。**服务端地址迁到局域网测试机 dev139**（`172.25.50.139`，原为开发本机 `.135`）：`Bootstrap.ts` 的 `dispatcher.url` 与 `e2e-server.test.ts` 的基址一并改（后者原写 `127.0.0.1`，服务搬走后恒跳过，看着像"跑过了"）；dispatcher 下发的 `ws_url` 是局域网 IP，真机 / 模拟器可直连。全仓 **590 全绿**（e2e-server 2 例这次真跑了不再 skip），五门齐过。**顺带清掉一个静默陷阱**：`apps/demo/node_modules/` 是切 `nodeLinker: hoisted` 之前的残留，里面躺着一份 **`@kit/proto` 0.1.0**，Node 与 Creator 的解析都会先命中它而不是根上的新版——升级契约后 `pnpm install` 看着成功、代码里却拿不到新 cmd。已删除该目录（hoisted 下本就不该存在），依赖统一从根 `node_modules` 解析
- [x] **demo 补上「地基层」：AOT 与功能模块之间的第二层**（2026-08-07 · **真实构建产物验证** · ADR-0014）— 上一条把登录/认证接进来时放在了 `assets/scenes/`，也就是 **main 包**。这暴露出分层的一个真空：[[adr-0009]] 定的三层里，`assets/` 目录只体现了「AOT」和「按需模块」两层，而**协议接线、登录认证、模块清单、模块契约**这些「所有模块都要用、但自己不是玩法」的东西无处可放，只能往 main 包或 `lobby` bundle 里塞。代价很具体：**服务端契约升个版本、加个 cmd、换种登录方式、上线个新模块，客户端都要发新包**——而这层恰恰比玩法模块变得勤得多。现在补上 `assets/foundation/`（bundle，**启动期加载、常驻不卸、可热更不重启**），目录即分层：`boot/`（AOT：`Boot.scene` / `Bootstrap.ts` / `app-config.ts` / 启动界面 / `foundation-api.ts`）→ `foundation/`（协议 `net/schema.ts`、连接 `net/connect.ts`、认证 `net/auth.ts`、网关搬家 `net/migration.ts`、模块清单 `catalog.ts`、模块契约 `ModuleContext.ts`、跨模块事件 `events.ts`、服务端地址 `server.ts`）→ `modules/*`（按需 load/release）。**加载时机必须在 `hotupdate` 之后**（`shared` 阶段）：地基本身就是热更内容，先更新再加载拿到的才是新版本——长连接与认证跟着一起后移，这是排序的直接后果。留在 AOT 的只剩「热更自己要用的」：dispatcher 地址（鸡生蛋，要先握手才知道 `cdnUrl`）、`protoVersion`、版本号、渠道、启动界面；其余服务端地址进 `foundation/server.ts`，换环境热更即可。**跨 bundle 共享靠优先级不靠 DI**：`foundation` priority **6** 高于所有业务包（`shared` 5 / `lobby` 3 / 模块 1），普通出包下被多包引用的资源归属优先级最高者、同级才各复制一份——所以模块可以正常 `import` 地基的函数，拿到的是同一份，热更地基对已装模块立即生效。（[[adr-0001]] 实测的「依赖全内联」只发生在**单 bundle 出包**，别推广成「跨 bundle import 值一定复制」，那会逼出「地基只准暴露 type、有行为的一律走 DI」这种过度设计。）低于内置 `main`(7)/`resources`(8) 则保证不会反向把 AOT 框架代码吸进热更包。**主包 ↔ 地基只有一处接缝**：`boot/foundation-api.ts` = 一个 `interface`（`import type`，编译期擦除）+ 两个主包自己的字符串常量；运行时 `js.getClassByName('DemoFoundation')` 取类（`@ccclass` 用在**非 Component** 类上同样注册进 cc 类表，已实测，所以不必为承载入口另造 prefab）。主包一旦 `import` 地基的值，那段代码就被判给主包 → 地基进 AOT → 热更失效。**证据是真实构建产物不是推断**：web-mobile 构建后 grep，地基 8 个模块的 `System.register` **只出现在 `foundation/index.js` 一处**，`mail`/`lobby`/`mini-dodge` 零副本；`mail` 里 `MailVM.ts` 的依赖数组是 `[…,'./schema.ts']`、`codeName` 只有调用点没有函数体；`main` 里与地基相关的只剩两个字符串。顺带修掉一处反向依赖：模块过去都要 `import '../lobby/ModuleContext'`，契约现已归地基。**610 全绿**，五门齐过
- [x] **接邮件模块（cmd 100-110）+ 登录认证**（2026-08-07 · 真服务器登录/认证/拉列表 PASS）— 服务端 `server-core-kit` 上了邮件（`modules/mail`，跑在 `core` 容器）。契约在 **kit-proto v0.4.0 就已经有了**（`mail.proto`，cmd 100-199 属**框架段**），所以不用升依赖、不用 `proto:sync`——`createKitSchema()` 一次装齐框架段，邮件的编解码当场就能用。真正缺的是**认证**：网关在认证前只放行 `AuthRequest`/`Ping`，别的 cmd 一律回 `Error{NOT_HANDSHAKED}`，而 demo 此前从没登录过（mini-clicker 那条「模块段往返」实测回的就是 `NOT_HANDSHAKED`）。补两步：`POST /api/Login`（账号服 9103，唯一免认证接口，走 HTTP 因为「能不能连网关」本身要先有身份）拿 token → 连上后首帧 `AuthRequest{token}`。**认证是连接级动作**：重连、网关搬家之后拿到的都是全新连接，网关只认这条连接上发过的 `AuthRequest`，所以 `createAuthSession` 订 `onState`，每次 `open` 自动重认；并发 `ready()` 合并成一次（认两次会让服务端把第一条连接当顶号踢掉）。**token 不缓存**——每条新连接重登一次，一次 HTTP 换掉「缓存 → 用旧 token 认证失败 → 判断该不该重登」这整条会写错的分支。设备号落 `IStorage` 持久化，不然每次启动都是新玩家。邮件本体是 `modules/mail/`（新 bundle）：`MailVM.ts` 零 `cc`、可 node 直跑，**三条契约规矩写进代码**——① 推送是提醒不是传输（`MailArrived` 是空消息，收到只表示「去拉」，代码里没有任何从推送 body 取数据的地方）；② 去抖 200ms（运营群发 3 封会推 3 条，不去抖就是 3 次全量拉取）；③ **能不能领看 `attachments` 非空、不看 `claimed`**（没附件的纯通知邮件 `claimed` 恒 false，照它判会给通知邮件画一个永远点不亮的领取按钮）。领取用响应里的**实发物品**播动画而不是 `attachments`（背包满会截断、道具下架会换），失败则以服务端为准重拉。**单测抓出两个真 bug**：`claim` 失败后的重拉被自己的 `loading` 防重入锁挡掉（`finally` 还没跑）→ 「以服务端为准」静默失效；修好后重拉又把刚设的「已领过」提示抹掉 → `error` 的清空时机不该是「任何一次 pull」而是「用户主动发起的操作」，修复性重拉走 `silent`。界面 `Mail.prefab` 由 `scripts/prefab-gen/mail.prefab.json` 描述生成（首次创建走脚本，改已有走 MCP）。真服务器实测（dev139）：登录拿到 token/player_id → 认证前发 `MailListRequest` 回 `Error{NOT_HANDSHAKED}`（证明网关的门是真的）→ `AuthRequest` 回 `AuthResponse{playerId, serverTimeMs}` → 再拉列表回 `MailListResponse{code:OK}`。**未覆盖**：收发一封真邮件的端到端（服务端刻意不提供对外发信接口——「能给任意玩家发任意道具的接口是这套系统里最值钱的攻击目标」，发信是同进程调用或将来的运营后台）
- [x] **登录界面：启动路径上的第一道闸门**（2026-08-07 · 浏览器预览 + 真服务器 e2e PASS）— 上一条把登录接进来时是**闷头登的**：拿设备号直接换 token，玩家看不见、也换不了账号。补上界面之后，`assets/foundation/ui/` 是地基里的第一份 prefab（`Login.prefab` 由 `scripts/prefab-gen/login.prefab.json` 生成），uiId `login` 挂 **`system` 层**——它得盖住 `ui` 层还在跑进度条的启动界面。**每次启动都问**，不做「记住了就自动登录」：那条路要配套「怎么退出登录」和「退出后怎么重新认证已经建好的连接」，而认证是**连接级**的，换账号等于把连接拆了重连；每次问一遍则一个状态都不用维护，游客一键就进。两条路：游客（设备号，落 `IStorage`）与自有账号（`custom`，credential 是 **`账号:密码`**，服务端按第一个冒号切、首登自动建号、密码下限 6 位）。**只记账号名不记密码**（密码明文落本地存储等于送到玩家手上），下次启动预填。**界面这一下也真打一次 HTTP 登录**：不然密码错就变成一次启动失败（LaunchOverlay 上一句「网络异常」），玩家不知道是自己打错了字——多的那次往返只在登录这一下，换来的是错误落在该落的地方。`LoginVM` 零 `cc`、10 用例：空账号 / 密码不够 6 位 / **账号里带冒号**（不拦的话服务端按第一个冒号切，表现成「明明打对了却说密码不对」）三条本地拦掉，登录中连点只算一次。**真服务器实测（dev139）**：游客登录 → `player=aaa10f89…` → 地基就绪 → 大厅；换 `tester-a` + 错密码 → 界面上显示「账号或密码不对」、闸门不放行、启动不继续；改对密码 → `player=d609582a…`（与 curl 直连拿到的同一个 player_id，证明换账号真的换了身份）→ 大厅。**顺带**：prefab 生成器加 `editBox` / `comp` 两种描述；EditBox 的标签锚点必须掰成 `(0,1)`（`addComponent` 建出来是 `(0.5,0.5)`，与引擎 `_resizeChildNodes` 的摆放算法对不上 → 文字整个跑到输入框外，已在生成器里修掉并注释），另记下 `create-prefab` 的两处**静默失败**（编辑器预览播放中、同名资源已存在，都是返回 null 不抛错不落盘）
- [x] **马甲换皮：脸全在皮肤包，地基只留逻辑**（2026-08-07 · 两套皮浏览器预览 PASS）— 上一条的登录界面把 prefab 路径写死在注册表里，马甲一来就得改代码。改成走**已有的 UI 变体机制**：`foundation/catalog.ts` 出 `skinBundle()`，界面的脸**一律**在 `skin-<马甲>` 包里——**没有「原皮留在地基」这一档**：地基是所有马甲共用的那一层，混一张只有某个包会用的脸进去，别的马甲白下载它，改这张脸还要热更整个地基包；全进皮肤包之后，出一版新马甲 = 只发它自己的皮肤包，地基一个字节不动（demo 自己的那份就是 `skin-base`，它也只是一个马甲，不享受特殊待遇）。**同名 prefab 放不同 bundle 是 Cocos 3.x 唯一干净的整包换皮路径**（引擎没有 Prefab Variant / AB Variant）；界面**脚本仍归 `foundation`**（优先级 6 > 皮肤包 1），皮肤包里只有 prefab 与图 —— 一套 `LoginView` / `LoginVM` 配任意一张脸。皮从哪来：`boot/app-config.ts` 的 `VEST`（打包期常量，一个马甲一个包）→ `Bootstrap` 在 `launch()` **之前** `setUIVariant({skin})`（第一个界面就是登录闸门，晚了来不及），皮肤包跟着进 `APP_CONFIG.shared` 预加载。三处配套：① **给哪几种登录方式由 prefab 决定**——`LoginView` 节点在就接线、不在就没有这条路，审核期只放一个 `GuestBtn` 的马甲代码零改，一条路都没有会响亮报错（否则启动永远卡在登录页）；② **存储按马甲隔离**——`deviceId` / 上次账号名的 key 加 `appId` 前缀，Android 各马甲独立包名本来就隔离，但 **Web / 小游戏同域名共用一份 localStorage**，不加前缀两个马甲会读到同一个游客玩家（还可能各自连着不同的服，于是「同一个号在 A 里有邮件、在 B 里是新号」）；③ **换服**没做，在 `foundation/server.ts` 记下两条路（各马甲发各自的地基包 / 由 dispatcher 握手下发），只换皮不换服的马甲不受影响。两套皮实测：`skin-base`（原样式，游客 + 自有账号）与 `skin-vest`（红金、文案「开始游戏 / 一键开始」、**只给游客登录**）各跑一次启动 → 整张脸换掉、日志 `等玩家选账号（游客）` vs `（自有账号 / 游客）`、点一下都认证进大厅，`LoginView` / `LoginVM` 一个字没改。**⚠️ 用了 `skinBundle()` 的界面，每套皮都得有它的 prefab**，缺一个就是 `open` 失败、界面空白——所以 demo 只给登录界面登记换皮，模块界面要换皮照样用它、代价是每套皮都得补齐
- [x] **`apps/demo/assets/` 目录重整：分层 × 马甲两个维度分开，皮按跟随者拆包**（2026-08-07 · 两套皮预览 PASS · [proposal](design/2026-08-07-demo-assets-layout-v2-proposal.md)）— 皮肤加进来之后，`skin-base/` `skin-vest/` 和 `boot/ foundation/ modules/` 平铺在同一层，把**「改它要付什么代价」**（纵向分层，ADR-0009）和**「哪个马甲」**（横向）压成了一维：真实马甲是 5~20 个量级，根目录会被 `skin-*` 淹掉；「一个界面的脸在哪」变成看情况（mail/shop 在模块里、login 在皮肤包里），只有先例没有判据；**而且一个马甲一个大皮包，等于把按需分包退回全量下载**——皮包随 `shared` 在启动期装，里头却装着所有模块的脸，玩家永远不点的商城 / 小游戏也算进首包体积，改一张脸要重下整包。改动四件：① **马甲收进 `skins/<马甲>/`**（`skins/` 与 `skins/<马甲>/` 都**不是** bundle——bundle 不能嵌套），包名靠目录 meta 的 `userData.bundleName` 覆盖（**已实测生效**），目录里不用重复 `skin-` 前缀；② **皮按跟随者拆包，一个跟随者一个皮包**——`skins/<马甲>/foundation/`（priority 2，随 `shared` 常驻）+ `lobby/` + `mail/`（priority 1，跟模块装卸）；判据不是「长得像一类」，是**「同时进内存、同时出内存」**。接缝从 `skinBundle()` 变成 `skinBundle(owner)`，`APP_CONFIG.shared` 只留 `skin-<马甲>-foundation`；跨模块共用的图集 / 字体放地基皮包（优先级高的那个），否则各模块皮包各复制一份。③ **模块换皮登记在 `MODULE_CATALOG` 的 `skinned: true`**——`registerCatalogUIs` 据此把 bundle 解析到皮包，`LobbyNav.openModule` 并行装模块包 + 皮包、关闭时一起卸；邮件拿来做实证（`base`「关闭 / 加载更多」vs `vest`「信 箱 / 收起 / 再翻几封」），shop / mini-* 不登记、脸留模块包所有马甲同一张。④ **大厅也能换皮**——`LobbyHost` 原本用 `@property(Prefab)` 绑 `LobbyPanel` / `LobbyItem`，那是编辑器期绑定、绑死在 lobby bundle 里；改由 `LobbyNav` 自己 `load(currentSkinBundle('lobby'))` 再按路径取，**组件现在一个可配属性都没有**，`Lobby.scene` 里那两个失效引用一并清掉。大厅骨架**故意不进 UI 注册表**：它随 `Lobby.scene` 生死、挂场景自己的渲染根、不 open/close 也不分层，塞进去只会让 `listUIDefs()` 多两个永不被 open 的条目。**四条归位判据**写进 `CLAUDE.md`：纵向按代价、横向按马甲（两维不许混层）、皮按跟随者拆包、各套皮同名同路径。踩到三个坑，都写进 proposal：**换皮界面的实例是被皮包那条回收链销毁的**（`BundleScope.dispose` 的 `closeByBundle` 按**解析后**的 bundle 比对，传模块包名对 skinned 模块是 no-op → 必须给皮包另建一个 scope 挂进模块的回收链，且要在 DI 子作用域之后 `add`，teardown 逆序执行才轮得到界面先销毁）；**模块皮包必须和模块包一起 load**（`IAssetSource` 不自动装 bundle，直接抛）；**prefab 生成描述漏 `comp` 不报错**——界面照样显示，但没有任何行为（vest 的邮件皮踩过）。搬目录时 **meta 必须一起搬**：脚本 uuid 一变，两套皮的 prefab 组件引用全断。**两套皮各跑一次完整启动 + 开关邮件**（0 error）：启动只装 `skin-<马甲>-foundation` → 进大厅多出 `skin-<马甲>-lobby` → 开邮件多出 `mail` + `skin-<马甲>-mail`（`MailView` 挂上、VM 跑起来）→ 关邮件两个包**都卸**、节点销毁。**留了四条未做**（proposal 里）：启动界面只能发新包换（它在 ① 层，符合定位）、马甲文案（皮包带同名 i18n 表覆盖，待确认 `addTable` 合并语义）、马甲换服、shop / mini-* 还没换皮（机制已通，剩美术工作量）
- [x] 第 1 批 · 地基（DI ✅ Logger ✅ EventBus ✅ ITimer ✅ Bootstrap ✅(core+engine) 测试脚手架+cc mock ✅）
- [x] 第 2 批 · 核心设施（ObjectPool ✅ SceneFlow ✅ SaveManager+IStorage ✅ i18n ✅ ConfigTable ✅ BundleManager ✅ AssetManager ✅ UIManager ✅ AudioService ✅）：**core 半 + engine 半均已落地**（除纯 core 的 ObjectPool 外，各模块 engine 半见其文档「engine 半适配」小节，四门全绿 + 真机预览验证）
- [x] 第 3 批 · 进阶（HotUpdateService ✅ Network ✅(core 半 + engine 半均已落地) · ECS 扩展 ✅(bitECS v0.3.40 接入范例：独立包 `@cck/ecs-bitecs` 不进 core，re-export 全套 + 薄 kit 胶水，6 测试；**demo cc 渲染场景留后续**) · spatial 高性能 system 组 ✅(寻路/碰撞/群体避让,10 测试,全仓 379,独立 Creator 工程渲染验证留后续) · MVVM 数据绑定增强 ✅(core 响应式原语 + engine 绑定 helper；engine 半真机 gameView 预览验证 PASS) · tools 包：hot-update-manifest ✅ config-excel ✅ compat-stamp ✅）
- [x] demo 出包参数注入（`extensions/cck-build` 构建插件）— 六个「一个包一个值」的常量（`VEST`/`appId`/`version`/`channel`/`env`/`dispatcherUrl`）从源码解出来：构建面板填或命令行 `packages={...}` 传 → `onBeforeCompressSettings` 写进 `settings.json` 的 `cck` 段 → 运行时 `buildValue()` 读，**面板留空 = 跟随源码默认值**（默认值只有一处真相，面板不抄第二遍）；5 测试 + 四门全绿（全仓 641），**真实产物端到端 PASS**：命令行传 `vest`/`cli-test:9100`/`staging` 构建 web-mobile → 产物 `settings.json` 带 `cck` 段 → 浏览器起真产物，日志 `马甲皮 → skin='vest'` + 握手打到 `http://cli-test:9100`（源码默认是 `base` 与 dev139，证明注入生效），失败被正确分类成可重试的 `network`；**构建面板 UI 未验**（Creator 未开，只走了命令行路径）；用法见 `apps/demo/docs/build-plugin.md`，五条通道横评见 `docs/research/2026-08-17-creator-build-custom-options.md`
- [x] demo 正式启动路径接上热更 + 「配置能否热更」真机实证 — `Bootstrap.ts` 补 `ccHotUpdateModule`（此前只有 `probes/DemoBoot.ts` 装了，`Boot.scene` 那条路的 `hotupdate` 步一直走空后端）；**Android 真机 e2e PASS**：全新装 v1（`settings.json` 无 `cck` 段）→ `skin='base'` → 握手 → 下载 CDN 上的 v2（15 个包只有 `project.manifest` 涨 1.0.0→1.0.1）→ 自动 restart → `skin='vest'` → 强杀冷启动仍是 `'vest'`。结论：**`settings.json` 在 base manifest 里，配置能热更但会重启**；`dispatcherUrl` 例外（`dispatch` 在 `hotupdate` 之前，握手失败就走不到热更 = 死循环），`appId` 例外（换它等于换玩家）。⚠️ 装了热更后端后 **native 上「热更服务器不可达」= 启动失败**（可重试），离线要能进游戏得改 core 启动序列的语义
- [x] 修 dev139 过期 IP — 那台测试机的 IP 从 `.139` 改到了 `.20`，`app-config.ts`(dispatcher) / `foundation/server.ts`(登录) / `e2e-server.test.ts` 三处全是旧地址。**`e2e-server.test.ts` 因此静默跳过了很久**（`/healthz` 连不上与「服务器没起」是同一个表现）；改完它真跑起来，握手用例 PASS、**连网关用例 FAIL —— 服务端下发的 `ws_url` 仍是 `ws://172.25.50.139:9101/ws`**，那是 server-core-kit 仓的配置，本仓改不了（跨仓库禁令）。**服务端已于当天重部署 v0.7.0 修好**（`dispatcher.json` 的 `wsUrl` → `ws://172.25.50.20:9101/ws`），复验：握手 `ACTION_PLAY`、网关 `/ws` 升级 101、账号服 `/api/Login` 两种 provider 都拿到 token，**全仓 641 全绿、无跳过**。⚠️ 复验时踩到一处：手敲 curl 用 `version` 字段会被判成 `app=""` → 恒 `ACTION_UPDATE`，握手请求体里的字段名是 **`appVersion`**（客户端一直是对的，别照着服务端日志误判成版本闸坏了）

- [x] **热更翻马甲后新皮包自愈：种子 manifest + 正式路径补注册 `BUNDLE_UPDATER`**（2026-08-17 · 真机 e2e PASS · [ADR-0013 补充](adr/0013-native-per-bundle-hotupdate-layout.md)）— 上一条实证「配置能热更」之后暴露出来的场景：base 热更把 `settings.cck.vest` 翻成另一个马甲、重启回来，而**新马甲的皮包玩家本地根本没有**（它是发版之后才加的）。`skin-<马甲>-foundation` 在 `APP_CONFIG.shared` 里、`shared` 步没有 try/catch → 直接启动失败，且**重试与重装都好不了**（base 已 apply 并落盘，重装还会再更新成同一个坏状态），只有回滚 CDN 能救。查下来是**两个独立的洞**：① **正式启动路径从来没注册过 `BUNDLE_UPDATER`** —— 它只在 `probes/DemoBoot.ts` 里注册过，于是 `Bootstrap.ts` 那条路上**加载前更新整条链是关的**，任何 bundle 都不会更新（和上一条修的 `ccHotUpdateModule` 是同一类漏装）；现在挂在 `dispatch` 阶段的项目步骤里——那里 `APP_INFO`（版本闸要的 app 戳）已由 `platform` 步备好，且早于最早的 `load()`。② 补上注册也还差一口气：**`<bundle>.manifest` 躺在构建产物 `data/` 根，而 manifest 只遍历 `src|assets|jsb-adapter`** → **它自己不进任何 asset 表、永远不会被热更下发**，一个从没随包发过的 bundle 包内没有它的 manifest、base 热更也带不来，`AssetsManagerEx` 连去哪查更新都不知道（`ERROR_NO_LOCAL_MANIFEST`）。补法是**内存造种子 local manifest**（不落盘：`new native.Manifest(content, root)` 与 `am.loadLocalManifest(obj, storagePath)` 两个重载 SWIG 都绑了；配套 `create('', storagePath)` 跳过文件加载让状态停在 `UNINITED`，正好过对象重载那道门），`packageUrl` **取 dispatcher 握手下发的 `cdn_url`**（2026-08-18 定：内容托管在哪是**运营期决定**，换 CDN / 灰度 / 挪域名只该改服务端配置；包里烘的 `packageUrl` 是出包那刻的快照，内容挪了就得发新包，正是热更要消灭的事——`cdn_url` 本就是握手协议为此留的字段，此前一直只打日志没人消费），**服务端没下发才回落 base local manifest 的 `packageUrl`**（分包与 base 同根，地址对得上；兜底而非「配错也能跑」）。**`version` 恒 `0.0.0` 是硬约束不是随手取的**：`loadLocalManifest` 拿 local 与缓存 manifest 比版本，local 更新时会 `removeDirectory(storagePath)` 整个清掉 → 种子恒最旧，缓存那份才能接管、第二次起自动变增量。**随包发过的 bundle 仍用包内那份**（增量基准），别为省几 KB 把 manifest 排除出包。**真机 e2e**（真 x86_64 模拟器，干净安装，**APK 里不含 `skin-vest-*`**，CDN 上 base 1.0.1 只改了 `settings.json`）：`skin='base'` → 热更 25→100% → restart → `skin='vest'` → `shared` 步 `load('skin-vest-foundation')` → 包内无 manifest → 种子 → **3/3 文件下载完成**；`force-stop` 冷启动**只发 4 个 `*.version.manifest` 探测、一个资源文件都没重下**（正是 `0.0.0` 那条约束的判据）。顺带两处：启动界面的下载进度条从「只认 `hotupdate` 阶段」改成**任何带 ratio 的阶段都在本段内插值**（分包下载不再表现为静止的「加载公共资源…」）；`Bootstrap` 的失败日志摊平成一行字符串——Cocos native 转发 JS console 到 logcat 时对象参数一律打成 `[object Object]`，真机上唯一的失败信息不能是这个（正是靠它才定位到下面那条）。**⚠️ 这一程没跑到大厅**：`demo-foundation` 步长连接 `10s 未就绪（停在 reconnecting）：ws://172.25.50.20:9101/ws`；同一失败在 `skin='base'` 下同样复现（与皮包、与本次改动无关），网关从宿主机 `/healthz` 200、WS 升级 101 都正常，模拟器到 9101 的 TCP 也通 —— **模拟器侧 WS 握手/重连的独立问题，另查**。全仓 **645 全绿**（新增 4 例），五门齐过。**⚠️ 遗留：`cdn_url` 链路已接通、服务端配置未就位**——客户端实测日志 `种子 manifest 基址：http://172.25.50.135:8081/cdn/（服务端下发）`，消费侧没问题；但 dispatcher 配的那个值**不是可下载的基址**：filebrowser 只在 `/api/public/dl/<hash>/` 下发文件，`/cdn/` 是它自己的 SPA 路由、**任何路径都回 200 + `text/html`** → 「下载成功」拿到一坨 HTML → 炸在 `readFile failed!`。**配 CDN 基址时 200 不等于拿到文件，要看 `Content-Type`**。热更内容已按 skill `filebrowser-cdn` 的规矩传到固定分享 `http://172.25.50.135:8081/api/public/dl/shCo8WNE/`（`/creator-core-kit/cdn`，104 个文件 2.7 MB；base 热更用同一基址已在模拟器上跑通），**待 server-core-kit 把 `dispatcher.json` 的 `cdnUrl` 改成这个值后复验**——改那个文件属别的仓，本仓不动

- [x] **bundle 依赖表：加载编排 + 资源边界**（2026-08-21 · 已实施 · 822 全绿 · [proposal](design/2026-08-21-bundle-dependency-table-proposal.md)）— `check:graph` 的优先级单调只答「谁能依赖谁」（合法 + 防环），不答「什么时候装、按什么序、谁跟着谁装卸」，更管不到**动态加载**（`assets.load(path,{bundle})` / `loadScene` / `registerUI` 的 resolver / `js.getClassByName` —— 构建期一条记录都不产生）。今天加载顺序散在四处（`AppConfig.shared` 串行数组、`lobby.bundle`、`MODULE_CATALOG[].bundle`、`LobbyHost` 里 `skinned` 的硬编码特例），包一多就压不住。提案立**一张业务层的依赖表**，`needs` 一表两用（加载跟随 + 资源白名单）。**落地**：core 新增 `BundleGraph`（`layersFor` 按拓扑分层、成环即抛；`mayUse` 判边界）+ `BundleManager.setGraph` —— `load(A)` 先按层把 A 的 needs 装上并各加一次引用，`release(A)` 各减一次，**装卸对称白送**（共享依赖不误卸、开两次不少减）；表外的包 `strict`（默认）直接抛，发布版降级告警。demo 的表在 `foundation/bundles.ts`，**模块段按 `MODULE_CATALOG` 现推**，`LobbyHost` 里 `packs=[bundle, skin]` 的并行装 + 两次 `release` + 那个只为 `closeByBundle` 存在的第二个 `BundleScope` 一并删掉（皮包的引用现在由依赖表加、由模块包的 release 对称减，再 release 一次就是负债）。**与提案的偏差**：`AppConfig.shared` **不被取代** —— 表住在地基包里，而地基自己是被启动序列装上来的，取代不了；`stage:'boot'`/`bootLayers()` 因此砍掉。对账落在 `apps/demo/test/foundation/bundles.test.ts`（8 条，随 `pnpm test` 跑）而不是 CLI：kit 的 CLI 拿不到工程那张 TS 表。core 覆盖率 99.46/97.41/98.68/99.46（门 99/97/98/99）。**web 真产物运行期 e2e 已过**（启动 → 大厅 → 邮件/商城/小游戏各一轮装卸，包集合逐轮回到启动态，见下文详细条目）
- [x] **mini-plane：第一个真能玩的功能模块**（2026-08-24 · web 真产物 e2e PASS · 838 全绿）— 此前两个「小游戏」样例都只演示装配：`mini-clicker` 是个计数器，`mini-dodge` 的场景里只有一行标题和返回按钮，**demo 里一张图片资源都没有**（所有界面都是 Label 和纯色）。于是「模块 bundle 自带美术资源」这条路一直没走过：贴图归属会不会漂、按路径 `assets.load` 从自己包里取 SpriteFrame 通不通、`releaseGroup` 回收干不干净、往返进出会不会拿到已释放的 SpriteFrame ——全是空白。补上一个**真游戏**：Kenney 的 Construct 2 模板 `tappyplane.capx`（CC0，www.kenney.nl）移植成 `modules/mini-plane`（`kind:'game'`，自带 `Plane.scene` + 9 张贴图）。玩法参数**照抄原版事件表**（重力 0.3/帧、点一下 -7、岩石 -8/帧、每 2 秒一对、缝 141px），只做坐标系（C2 左上原点 +Y 向下 → Cocos 中心原点 +Y 向上）与时间基（每 tick → 每秒，`step(dt)` 与帧率无关）两处换算。**分工是这条铁律的样板**：玩法全在 `PlaneVM`（零 `cc`、16 例 node 直跑），`PlaneGame` 一条规则都没有，只加载贴图建节点 + 每帧把 VM 的数摆成位置 + 转发点击与生命周期。**踩到一处真问题**：竖屏铺满整屏后场地变成 800×1638，而缝仍是 141px —— 缝只占场高 8.6%（原版 33%），**比原版难四倍**，画面也空。修法不是调数值，而是把 VM 的场地参数化：View 按**高**定尺（900 设计单位）、可见宽由屏幕宽高比反推，缝宽 / 抖动 / 出岩石间隔 / 机身 x / 出生 x **全按原版比例推导**，默认参数代回 (400, 240) 必须一比一还原原版那组数（有测试锁死）。**资源侧三条实测**：产物里 `mini-plane` 的 `deps`/`redirect` 都是空（贴图有自己的 `.meta`、天然归属自己那个包，不需要钉进 `resources` —— 钉子只治没有工程 `.meta` 的 `db://internal`）；`check:pins` / `check:graph` 照过；**贴图的 `.meta` 是本仓自己写的**（uuid 自选、`imported:false` 让 Creator 补裁剪与顶点几何），于是场景能在 Creator 没跑过之前就引用脚本的 cid —— cid 由 `compressUuid` 从脚本 uuid 现算，算法拿仓里现成的两对（`DodgeGame` / `ClickerView`）自检过。**web 真产物 e2e**（`build/web-mobile` → 8082 静态口 → 无头浏览器）：登录 → 大厅第 5 个入口「🎮 飞机穿岩」 → 切进 `Plane.scene`（场 440×900、缝 282、机身 x -149）→ 自动驾驶飞过 3 对岩石且仍在飞 → 「返回大厅」`emit 'lobby:back'` → 回大厅且 `assetManager.bundles.get('mini-plane')` 为空（**包连同贴图整个卸干净**）→ **再进一次，8 个节点的 SpriteFrame 全部重新绑上**（释放后重入没有拿到脏引用）。⚠️ **只验过 web**：native / 小游戏没跑，热更下发这个新包也没试
- [x] **像素级碰撞 + 第八道门 `check:masks`**（2026-08-24 · 842 全绿 · web 真产物 e2e PASS）— 起因是玩的时候「死在离岩石一个身位的空气上」。解出三张贴图的 alpha 轮廓一看，**岩石是根锥子**：尖端只有 8px 宽（离缝越远越粗，根部才 105），而判定按 108 全宽的矩形柱算 —— 飞机半宽 30.8，贴着缝边擦过去时**整个机身宽度都落在假判定里**。反过来机身那侧本来就宽容（实心占比 69%，盒子 0.7 收紧后只占 49%），所以"改严"的方向根本不是问题所在。**难点是这条铁律**：VM 零 `cc` ⇒ 拿不到 `Texture2D` / `readPixels`，node 单测里更没有引擎。解法是把"形状"挪到**源码期** —— `apps/demo/scripts/gen-collision-mask.mjs`（自带 PNG 解码，只认 8bit RGBA 非隔行）把 alpha 烘成 `collision-masks.ts` 的位图数字数组（24K，行序对齐好 diff），VM 与单测读**同一份数据** ⇒ 判定跨平台逐位一致、node 里可逐像素复现。**判定分三层**：宽相（机身四角按角度旋转后的世界包围盒）→ 每世界行折算一次贴图行（岩石是**纵向拉伸**的，倍率随缝高变，这步把世界行折回贴图行）→ 逐像素（先查岩石[轴对齐、一次位测试]，命中了再把该点**逆旋转**进机身局部查机身）。**没用行对齐 32 位 `AND`**：机身会转（±75°），转过之后两张图的像素栅格不再平行，整字 `AND` 不成立；逆变换采样换来任意角度都精确、且不必按角度预烘多份掩码。**螺旋桨三帧只烘 plane0** —— 实测 plane1/plane2 的实心像素是 plane0 的真子集（并集 = plane0 的 4456 像素），换帧不会让判定抖。实心门槛取 `alpha >= 128`：边缘那圈抗锯齿像素不要人命，且它让飞机和岩石**同时**变小一圈，两个方向都偏向玩家。**效果实测**：致命窗口从对称的 ±85 收成 `dx ∈ [-55, +23]` —— **不对称**是因为锥尖在贴图里偏右 11px（x∈[59,71] 而图心 54），这种事只有逐像素看得见。地面判定也跟着变真：同一高度平飞过得去、俯冲 -75° 就啃地。**开销**：每帧最坏 4.5µs / 缝中 0.5µs / 岩石不在射程 0.05µs，一帧预算的 0.03%。代价是多一份要跟美术同步的生成物，`pnpm check:masks`（**第八道门**）挡住"改了图没重烘"。尺寸的唯一出处收进 VM（`PLANE_ART` / `ROCK_HALF_WIDTH` / `ROCK_ART_HEIGHT` / `vm.rockEdge`），View 从那里取 —— 画大画小就会跟掩码脱节。测试从 16 加到 20，新增的四条全是**旧矩形模型分不出来**的判据（锥尖旁的空气 / 窗口不对称 / 拉伸折算 / 机头姿态进判定）；关键工具是 `step(0)`：增量全为 0、只剩 `crashed()`，于是能把飞机和岩石摆到精确坐标上单问「这样算不算撞」。⚠️ 精度是 **1 像素**不是无限精度（采样落在整数世界坐标上，1 设计单位 = 1 贴图像素），亚像素擦碰可能判过；帧间仍是离散的，掉帧照样可能穿。⚠️ 同 mini-plane：**只验过 web**
- [x] **子游戏契约 `GameHost` + 四款新子游戏**（2026-08-25 · 892 全绿 · web 真产物 e2e PASS）— 两件事一起做的：把 Kenney 模板包剩下的几款移植进来，以及补上「子游戏怎么跟大厅打交道」那条一直缺的缝。**缝在哪**：panel 类模块打开时由大厅递一份 `ModuleContext` 进去（就是 `open(id, args)` 的 args），要什么有什么；game 类是 `loadScene` 切过去的，场景里的组件由引擎 `new` 出来，**递不进任何东西** —— 于是在这之前，子游戏想跟外面说句话只有一条路：自己 `getEventBus().emit('lobby:back')`，每个游戏各抄一遍，而且除了「我要出去」以外什么都做不到（`PlaneVM.best` 因此只活在内存里，bundle 一卸就清零）。补的是 `foundation/game/`：`GameHost`（`player` / `exit()` / `best(id)` / `submit(id, score)`）+ 零依赖的 `GameScoreboard`（VM 只认这两个方法，单测塞 `memoryScoreboard()`）+ `stage.ts`（六个 game 模块共用的建场十几行，不含任何美术资产）。**契约住地基（6）不住大厅（3）**：模块 → 大厅虽然合法但方向反了 —— 子游戏不该依赖「大厅」这个具体实现，换一个大厅或深链直接进某个游戏就全断。**成绩同步读**：`IStorage` 是异步的而游戏第一帧就要画「最好 12」，所以地基 boot 末尾（排认证之后，`playerId` 才有）一次性读进内存，`submit` 同步更新 + 异步写回；丢一次写盘最多丢这一局，换游戏侧一个 `await` 都不用写。**回路闭在大厅按钮上**：结算 `submit` → 回大厅重建 UI → 按钮多出「最好 N」，而大厅只按 id 读一个数、**不认识任何一个游戏**。**四款新游戏**（全是 VM 零 `cc` + 薄壳 View + 自带 `.scene` + 镜像单测）：`mini-brick`（paddleball）—— 原版是纯镜面反弹配平板，球只会在一条竖直线上来回，那是模板不是游戏，改成出射角挂击球点偏移（±60°）；开球方向也从原版的「向下」翻成向上（原版球生在半空、这里贴在板上）；场地**按宽定尺**（8×64 的砖墙横向摆死，按高定尺竖屏只剩 270 宽根本放不下）。`mini-shooter`（spaceshooter）—— 速度定义成「穿过整个场要 3.4 秒」（原版 (480+50+84)/180），激光按原版 600:180 跟着走，于是换屏幕不改手感；判定是收紧的矩形不是像素级（飞船和陨石都近似实心矩形，掩码那套换不来手感差别）。`mini-hop`（platformer）—— C2 的 `Platform` 行为按参数重写成三十来行分轴推进（330/1500/1500/650/1500/1000 一个没改），**关卡那 108 个手摆实例烘成 `level.ts`**（`scripts/gen-hop-level.mjs`，87 块实心砖 + 12 装饰 + 6 硬币 + 2 藤壶 + 出生点 + 终点），VM 与单测读同一份 —— 「这级 70 高的台阶跳不跳得上去」「头顶那块砖挡不挡人」在 vitest 里问得死。跟 `collision-masks` 那条流水线的区别是**没有 `--check` 闸**：源 `.capx` 不在本仓、CI 比不了，那份生成物一次烘出后当手写文件维护（**生成物要不要配闸，看的是源在不在仓里**）。原版那面旗插在出生点旁边、没绑任何事件（它是**起点**标记），所以终点改取关卡尽头那堵通天墙前一个身位 —— 巧的是它紧挨着第二只藤壶，**走过去必死、跳过去才算赢**，白捡一个收尾挑战。手机没有方向键，控制收成 `setDir` / `jump` 两个纯输入口，虚拟按键在 View 里。`mini-cards`（dicecards）—— 原版每次 `random(51)` 独立取（会发出重复的牌，上界还漏了最后一张），改成洗一副 52 张无放回地发、发完自动重洗；它**没有 `update()`**（桌上的东西只在点了之后才变）也**没有记分板**（没有可比的成绩，硬塞一个「最好」只会是假的），演示的是 `GameHost` 的另外两件事：桌上写 `player.name`、右上角 `exit()`。**`rpg.capx` 没做**：事件表是空的，布局里只有三层瓦片、零个对象、零个行为 —— 它是一张静态图不是游戏，照搬只会多一个「打开看一眼就返回」的入口。**顺手改造了已有的两个**：`mini-plane` 的 `best` 接上记分板（从此落盘、按 appId 隔离）并加了「新纪录！」，`mini-dodge` 与 `mini-plane` 都改用 `exitButton` —— 两个文件**不再认识 EventBus**。**两处真 bug 被测试抓到**：① `CardsVM.diceTotal` 是 `computed` 却读裸数组 `dice[0]`，`computed` 只跟踪 signal 的读写 —— 界面上的点数和会永远停在开局那一次（改成两个 signal）；② 打砖块的子步测试一开始挑了最上面那行砖，而球从下往上打会先撞到最下面那行（是测试摆错了，不是 VM 错）。**web 真产物 e2e**：登录 → 大厅十个入口 → 打砖块自动跟球 15 秒打掉 8 块 → 逼掉球结算「新纪录！」→ 回大厅按钮变成「🎮 打砖块  最好 8」→ 太空射击自动瞄最低那颗打 15 秒得 4 分（`enemySpeed=182` 恰好是 `(450+168)/3.4`）→ 平台跳跃自动驾驶**跑完整关**（跳过两只藤壶和所有台阶，4/6 硬币，`phase=won`、90 分）→ 骰子卡牌连发 5 张不重复、掷骰点数和跟着变、桌上写着「游客 的牌桌」→ `localStorage` 里 `cck-demo.cck.gameBest={"mini-brick":8,"mini-shooter":4,"mini-hop":90,"mini-plane":1}`（**带 appId 前缀**，两个马甲不串）。控制台除 favicon 404 外零错误。⚠️ 同前：**只验过 web**，native / 小游戏没跑；四个新包的热更下发也没试
- [x] **AssetLoader：加载途中关掉 scope 不再漏账**（2026-08-25 · 895 全绿 · `asset-loader.ts` 100% 覆盖）— 起因是审 `loadGameArt`：子游戏在贴图还没落地时被切走，会怎样。答案是漏，而且漏只是第一层。`acquire` 原本**先建条目、后并组**（`addToGroup` 在 `await` 之后），于是有一段窗口**加载中的资源不属于任何 scope**：`onDestroy` 里那句 `releaseGameArt` 扑空（组还没建，只打一句「组不存在」告警），等 load 落地又把组**重新建起来** —— 从此没人还它。第二层更难查：大厅随后 `getBundleManager().release()` → engine 侧 `bundle.releaseAll()` **不看引用计数直接销毁**，而 core 的表里还留着那些句柄，于是**下次进同一个游戏会命中这条脏缓存拿到已销毁的 `SpriteFrame`**（白图，且要到第三次进入才自愈 —— 第二局的 `onDestroy` 这回拆得到，才把脏条目清掉）。**修在 loader 不修在调用方**：这不是子游戏专有的，`releaseGroup` 是 core 的公开 API，任何「资源还在加载、scope 就被关掉」的地方都踩得到（UI 打开动画没走完就被关、远程 bundle 走 CDN 慢那几秒）。改动三处：① 并组提到 `await` 之前，加载中的条目也归 scope 管；② `await` 回来先看条目还在不在表里，不在就说明途中被整组拆了 → 迟到的这份当场 `source.releaseOne` 还掉、**不重新入表复活**；命中共享 inflight 的等待方同理 → 自己重来一次真加载，绝不把已还掉的值发出去；③ `finalize` 拆成 `detach`（只销账：摘组 + 删表）与 `finalize`（`detach` + `releaseOne`），失败回滚和拆 inflight 条目都只走 `detach` —— 那份资源还没到手，`releaseOne` 无从谈起。**调用方一行没改**：`stage.ts` 的 `releaseGameArt` 留在 `onDestroy` 里就够了，五个子游戏的 `if (!this.node.isValid) return;` 保持原样、只管别建节点。三条新用例钉住时序（拆得到 inflight / 拆后再 load 是真加载 / 共享 inflight 的等待方重来），**在旧代码上三条全红**。⚠️ 这条只在 vitest 里验（`createMemoryAssetSource` 的可控 promise），**没在真机复现过那个白图**
- [x] **「`await` 回来世界已经变了」这一类错误：堵住 + 立规矩 + 扫现场**（2026-08-26 · 898 全绿 · `asset-loader.ts` 100% 覆盖）— 接着上一条往下追：既然迟到的资源要还，那**大厅在这中间已经把 bundle 卸了**呢？查下来 `removeBundle` 只是把包从注册表里摘掉、不取消已经在跑的 load task（官方注释：「移除此包，注意：这个包内的资源不会自动释放」），所以回调照常来 —— 但 engine 侧 `releaseOne` 第一件事是 `assetManager.getBundle(name)`，此刻已经是 `null` → `if (!bundle) return` **静默 no-op**：账销干净了，引擎那份迟到的资源没人还。**① 给 `IAssetSource` 加可选的 `releaseValue(asset)`**（engine → `assetManager.releaseAsset`，不查 bundle 表；与 `bundle.release(path)` 同语义 —— 官方文档里 `Bundle.release` 就写着「详细信息请参考 `AssetManager.releaseAsset`」），core 手里有资源就按值还、否则退回按 path，老实现不受影响；顺带把挂了很久的遗留（remote 资源没有 bundle、按 path 永远还不掉）一起解决。**② `loadGameArt` 改签名**：第一个参数收宿主节点，返回 `Record | undefined`。它同时办三件事 —— 加载期间被切走返回 `undefined`（**忘了判类型当场红**，见下）；bundle 已卸导致的 reject 被识别成**取消**而不是失败（宿主已死就安静收摊，否则 `async start()` 没人 catch，控制台多一条查起来很误导的 Uncaught in promise）；**宿主还活着的失败照抛**，别把真 bug 咽下去。配套把五个游戏的 `frames` 字段从 `?:` 改成 `!:`，于是「忘了判」是一条 `Type 'X | undefined' is not assignable to 'X'` 而不是一句注释 —— 故意漏掉那行验证过，红。**③ 但那道类型闸原本拦不住任何东西**：`pnpm typecheck` 是 `tsc -b`，root `tsconfig.json` 只 reference 四个 packages，**`apps/demo/assets` 一行都没在检**（工程自己那份 `tsconfig.json` 继承 Creator 生成的 `temp/tsconfig.cocos.json`，不入库、还写死本机绝对路径，CI 上根本用不了，所以历来没人拿它当门）。补了一份可移植的 `apps/demo/tsconfig.check.json`：cc 类型走 `@cocos/creator-types`（与 packages/engine 同一套，ADR-0005），`@cck/*` 指向源码，`pnpm typecheck` 现在 = `typecheck:pkgs` + `typecheck:demo`。首次开门只报出三处，全是真问题：`cc/env` 官方类型包里没有（Creator 现生成在 `temp/`）→ 自备一份 `types/cc-env.d.ts`；`clicker-net.ts` 把 `kit.v1.ErrorCode` 当类型用，而 `clicker-proto.ts` 是 protobufjs 生成的 JS（顶上 `@ts-nocheck`）、`kit` 是个普通对象不是 TS 命名空间 → 改回 `number`；一处测试用了 cc mock 独有的 `settings.__clear()` → 显式 cast 说明它是替身的东西。**④ 扫了一遍同类现场**，找到一处真的：`LobbyHost.openModule` 的重入守卫读 `openPanel`/`pendingGame`，而这两个字段是 `await load(bundle)` **回来之后**才落的 —— 包还在下的那几秒里第二次点击照样进得来，两个模块都装上，后一个把前一个的记录覆盖掉，前一个的 `scope` 从此没人 dispose（bundle 引用 + DI 子作用域 + 界面实例一起漏，界面还赖在屏幕上）。首次从 CDN 下包时这窗口有好几秒，双击就能踩到。修法是**占坑占在 `await` 之前**（`opening` 字段 + `try/finally`）。同时查过的没问题：`UIManager.spawn` 早就判了 `e.closed`（加载期间被 close 就销毁刚建好的节点、不回填）；`Bootstrap.start` 在启动期、切走等于应用结束；`LobbyHost.buildLobbyUI` 有窗口但没有触发路径（UI 还没建出来，玩家点不了）。**⑤ 立成规矩**：`CLAUDE.md` 的业务开发硬规则从三条变四条 —— 「`await` 回来先确认自己还在；占坑要占在 `await` 之前；取消不是失败」。这类 bug 只在**加载慢**的时候现形（首次下包、弱网），本机秒开一辈子测不出来，所以靠规则不靠运气。⚠️ 大厅那处改动**只过了静态门**（`LobbyHost` import `cc`、进不了 vitest），双击竞态没在真机复现过也没在 e2e 里复跑
- [x] **mini-fish 第一刀「能打死鱼」：ECS 第一个真消费者 + 四道联网接缝**（2026-08-28 · 978 全绿 · 零美术零 `cc` 零场景，整刀跑在 vitest 里）— `@cck/ecs-bitecs` 落地一个月、node 全测，但 `apps/demo` **一行没用过**（本表两处挂着「demo 的 cc 渲染场景留后续」「独立 Creator 工程渲染验证留下一步」）。捕鱼是它的第一个消费者，也是 demo 第一款**经济型**游戏 —— 「成绩」是持久余额而不是最高分，`GameHost.submit(score)` 装不下（这条暴露出来的问题**本刀不解决**，留作后续议题）。**四道接缝一开始就留**（决策 A/B/D1/D2）：裁决 `FishArbiter`（客户端自裁 = 随便刷钱）· 钱包 `FishWallet`（钱属于账户不属于这一款）· 炮台指令源 `CannonAgent`（三个 AI 陪打**不是装饰** —— 它们让这条缝天天在跑，而不是一个从没被第二种实现验证过的接口）· 鱼池投喂源 `FishFeeder`（**外挂防线**：客户端自己生成鱼群 = 能预知下一波、能自瞄大鱼）。单机今天写左边那列，联网时只换右边那列，**system 与单测一行不改**。**RTP 恒 0.95 是可断言的命题而不是手感**：`p_i = RTP/(N × m_i)`、`payout_i = level × m_i` ⇒ 期望赔付 `= Σ p_i·payout_i = RTP × level`，**与网内鱼数、鱼种组合、炮台档位全无关**（一网罩 N 条各判一次，天真的「每条鱼固定概率」会让 RTP 变成 N 倍，N=5 时 475%）。30 万局模拟实测落在带内，容差 0.03 ≈ 3.2σ 是**算出来的不是试出来的**（单局赔付方差 ≈ RTP·level²·m̄ ≈ 26.6）；另有一条阈值用例把 `p` 卡在两侧精确钉死。**ECS 只吃会上量的那三样**（决策 D5）：鱼 / 子弹 / 网走 bitECS SoA，复用包里的 `Position`/`Velocity`/`Circle`/`SpatialHash`/`movementSystem`/`spatialIndexSystem`；炮台（4 个）与经济走**普通对象** —— 为 4 个实体付 SoA 的仪式感，query 开销比对象字段还大。⚠️ **`spatial` 那五个 system 只用得上两个**：`FlowField`/`seek`/`separation`/`collision` 全是给「涌向玩家的群体」设计的，而鱼**不涌向任何人**、走投喂进来的预设路径，鱼之间也不需要推开（互相穿过是这个品类的正常观感）—— 别指望整套复用。**三处设计上的硬判据**：① **钱的进出全在裁决里**（`fire` 扣、`resolve` 入账），system 不认识钱包，否则联网那版「服务端说了算」的钱得在 system 里再走一遍；票根走一张 `eid → FireTicket` 的表（子弹带着票飞、命中转给网、判完就撕），**不塞进组件**因为 SoA 只装数字而联网那版的票会带流水号，**也不在 `netSystem` 里现造** —— 那等于承认票可以由客户端凭空开，正是接缝 ① 要挡的事。② **一网对一条鱼只判一次**：被罩住就进 `settled`，不管死没死 —— 否则炸弹连锁会把刚从网底下逃掉的鱼再判一遍，一发子弹买了两次机会，RTP 立刻不成立。连锁是**队列不是递归**，天然收敛（每条鱼最多进 `settled` 一次）。③ **玩家和 AI 走同一条路**：点屏幕只是让 `manualAgent` 记下一个角度，下一帧跟三个 AI 一起被问、一起扣钱、一起生子弹 —— 一旦给玩家开一条捷径，联网时那条捷径得再写一遍。**玩法代码住 `assets/` 不住 npm 包**（[[adr-0019]]）：npm 依赖统统落 AOT chunk（改它要热更 + **重启**），而玩法字段恰恰改得最勤；`spatial` 那套通用原语留在包里相反是对的。⚠️ 顺带纠正一条流传的错话 —— 「AOT 从此不能热更、要发 APK」自 [[adr-0017]]（2026-08-20）起**作废**，AOT 照样 CDN 下发，只是重启才生效。**第八道门扩了口**（决策 D6）：`check-vm-tests.mjs` 从只认 `*VM.ts` 扩成也认 `*System.ts` —— ECS 把玩法拆成一串 system，逻辑不再收在一个 VM 里，只认 VM 的话「一个装配用的门面 VM 有测试就全绿、真正干活的七个 system 一个没测」，闸绿了实际没测到比没有闸更坏（扩完当场验红：六个文件全报缺测）。落地 12 个源文件 + 10 份镜像测试（78 例），八道门全绿。⚠️ **此刻还没有 bundle meta**，Creator 会把这些脚本编进主包 —— 第二刀建 bundle 时归位；美术、场景、横屏、真机帧率全在二三刀。设计见 `docs/design/2026-08-28-mini-fish-design.md`
- [x] **mini-fish 第二刀「能看见」：图集进 bundle + 横屏 + ECS→节点那座桥**（2026-08-28 · 990 全绿 · web 真产物 e2e PASS）— 第一刀是纯逻辑，这一刀把它接上引擎。**四块空白一次填掉**：① **图集第一次打进 bundle** —— 2MB / 167 帧的 `textures.plist` + `.png`（cocos2d/TexturePacker 格式），实测 **Creator 3.8 直接认**：生成 `importer: "sprite-atlas"` 的 meta + 167 个 `sprite-frame` subMeta，帧名**不带 `.png` 后缀**（`atlas.getSpriteFrame('fish_red_run_0')`）；本仓只需把两个文件丢进 `art/`，meta 由首次构建现生成，不用手写。**归属没漂**（这是动工前最担心的那条）：产物里 `mini-fish` 的 `deps` / `redirect` 都是空，整包 2.2M 自给自足 —— 判据跟 `mini-plane` 那批散图一样，**资源在模块目录下、有自己的 `.meta` 就天然归这个包**，钉子治的是没有工程 `.meta` 的 `db://internal`，跟图集是两回事。② **`ECS → cc.Node` 那座桥第一次真架**：鱼和子弹的**生灭不走事件**，走 bitECS 的 `enterQuery` / `exitQuery` 自己 diff（进查询建节点、出查询销毁），View 不必知道它是被打死的还是游出界的；事件只播 query 看不出来的那部分 —— 开炮火光、张网、以及「这条鱼是**死**了」（退出查询分不出死和游走，而这两件事该放的动画完全不同）。实测 60+ 条鱼 **draw call = 9**（一张图集一次提交）。③ **第一款横屏**：kit 的 `resolution` 负责「转过来之后正确适配」、**不负责强制旋转**（那是平台工程配置），所以竖屏盖一张「请把手机横过来」并**停止 tick** —— 别让玩家在看不见的场上把钱打光。场地用 **cover 缩放**（宽高比取较大者），满屏背景的玩法留黑边比裁掉一点边难看得多。④ **接缝 ② 的单机实现落地**：`persistentWallet` 走 `IStorage` + `scopedKey`（`cck-demo.cck.fishCoins`，带 `appId` 前缀，两个马甲不串），**钱属于账户不属于这一款**（决策 B）。写它的测试当场逮到一个真 bug：`Number('') === 0`，空存档会被读成「余额 0」—— 玩家一进游戏钱就没了，而这条只在存储写了空值时出现，肉眼极难发现。**加一个模块真的只改 `catalog.ts` 一行**：`BUNDLE_GRAPH` 按 `MODULE_CATALOG` 现推，而 `@cck/ecs-bitecs` 是 npm 依赖（落 AOT chunk）不是 bundle，所以连 `needs` 都不用加。kit 侧只多一行：`AssetTypeToken` / engine `TYPE_MAP` 补上 `spriteAtlas`（标准资源类型，那张表本就该是全的）。**web 真产物 e2e**（`build/web-mobile` → 8082 静态口 → 无头浏览器）：竖屏登录 → 大厅第 10 个入口「🎮 捕鱼」→ 切进 `Fish.scene`（`mini-fish` bundle 装上、HUD「金币 10000 / 炮 1 级」、**竖屏提示挡着、鱼数 0**）→ **转横屏**：提示消失、鱼开始游、背景与炮台就位 → 升到 7 级炮连开 70 炮：余额 9998→10348（花 490 收 840），**6 种鱼的死亡动画都出现过**（含炸弹鱼河豚与金鲨），`localStorage` 同步跟着变 → 「返回大厅」后 `assetManager.getBundle('mini-fish')` 为空（**图集连同包整个卸干净**）→ **再进一次 12 条鱼没有一条丢贴图**（释放后重入没拿到脏引用），余额接着上次。⚠️ **撞出一个既有 UI 问题**：横屏大厅那一列纵向按钮没有滚动，第 10 个入口掉到屏外 —— **不是捕鱼的问题**（第 9 个时就已贴边），e2e 因此走「竖屏点进去 → 转横屏玩」这条真实路径。要么给大厅加滚动、要么横屏改多列，留作下一个加模块的人的账。⚠️ 素材取自 GitHub `fylz1125/CCFish`，该仓**无 LICENSE**、README 自述「仿照官方在线游戏」，`apps/demo/README.md` 的授权表如实标成**原始版权归属不明、不标 CC0** —— 一张表里混进一条按 CC0 处理的来路不明素材，其余五款的 CC0 声明就都不可信了。⚠️ 同前：**只验过 web**，native / 小游戏没跑；第三刀（三个 AI 陪打压到 200 条鱼 + Android 真机量帧率）未做
- [x] **大厅入口列表：横竖屏网格 + 滚动兜底**（2026-08-28 · 1001 全绿 · web 真产物 e2e PASS）— 还上一刀留的账：横屏大厅那一列纵向按钮没有滚动，第 10 个入口掉到屏外（第 9 个时就已贴边）。**改的是排布不是样式**：`Items` 在 prefab 里本来就是个空容器（条目一个都没有，位置就是设计者指定的「第一个条目中心」，它自己的尺寸从没被用过），运行时就地装成 `Mask` + `ScrollView`，内容节点由代码建 —— **两份 prefab 一个字节没动**，也就没有「改已有 prefab 走 MCP」那道要开编辑器的坎，两套皮同时生效。**竖屏先填满一行再往下、上下滚；横屏先填满一列再往右、左右滚**，行列数按可用区现算：十个入口竖屏 2 列 5 行、横屏 2 列 7 行，**两个方向都放得下** —— 所以滚动是加到第十几个模块才用得上的兜底，而不是每天都在滚的东西（视口贴着内容收窄，装得下就不留空白）。**算式抽成 `modules/lobby/grid.ts`（零 `cc`、11 例单测）而不是用 `cc.Layout` 的 GRID 模式**：条目位置本来就是清单驱动算出来的，而 `Layout` 的 `startAxis` / `constraint` / `constraintNum` 得在编辑器里配、还得两个马甲各配一遍，配错了只有真机上看得出来；挪进纯函数之后，「30 个模块横屏排几列」「条目会不会排到 content 外面去」在 vitest 里问得死。**两套皮的坐标体系根本不同**（base 是 600×520 的面板、`Items` 在 y=60；vest 是 1080×1920 满屏、`Items` 在 y=520），所以列表区上沿**读 prefab 里 `Items` 的位置**、不硬编码；同时夹在屏内（`min(itemsTop, halfH - 40)`）—— 否则 vest 那套竖屏坐标在横屏 1080 高的屏上是屏外，列表整个看不见。条目尺寸同理读 `LobbyItem.prefab` 实例的 `UITransform`，马甲把按钮画多大就按多大排。转屏走 `view.on('canvas-resize')` 实时重排（跟 `FishGame` 同一个套路），**不必重进大厅**。**web 真产物 e2e**：竖屏 1080×1954 → 2 列 5 行 `vertical` 滚；转横屏 2025×1080 实时重排成 2 列 7 行 `horizontal` 滚；**横屏下第 10 个入口「🎮 捕鱼」落在屏内 (535, 291) 并点进 `Fish.scene`**（改之前它在屏外）；返回大厅后网格按横屏重建、10 个入口全在；把 `content` 临时撑高后拖动真滚起来（`content.y` 207 → 516）**且拖完大厅还在** —— `ScrollView.cancelInnerEvents` 默认 `true`，滚起来就把子节点的触摸取消掉，条目用的是裸 `node.on(TOUCH_END)`（不是 `Button`）这条同样成立。本次 navigation 控制台 0 error。⚠️ **vest 马甲只算过没跑过**：默认构建是 base，vest 那套的数值（竖屏列表 y ∈ [139, 553]、横屏 [-314, 500]）是按同一套公式手推的；横屏下它的 `Title`（y=720）仍在屏外 —— 那是既有问题，本次没解决也没恶化。⚠️ 同前：**只验过 web**
- [x] **mini-fish 补刀：目录分层 + 三处现场反馈**（2026-08-28 · 1007 全绿 · web 真产物 e2e PASS）— 第二刀跑起来之后玩出来的三个问题，外加一次目录重构。**① `ECS → 节点` 那座桥有个真 bug**：连打一分钟，`Bullets` 层下攒出十来个**停在屏幕正中央不动的子弹**（现场数据：`atOrigin` 3 → 10 → 12，只增不减）。根因是 `enterQuery` / `exitQuery` 是**两个独立数组、读不出交错顺序**，而同一个 eid 一帧内可以同时出现在两边 —— 子弹在炮口出生的那一帧就命中了正巧游过炮口的鱼（AI 炮就架在鱼道上），于是「先跑 exit（表里还没有，空转）再跑 enter」建出一个**实体已经不存在**的节点：它不在 query 里、位置永远不刷新，就停在 `gameNode` 的默认位置 `(0,0)`，也永远不会再 exit（它已经 exit 过了）。反向交错（`removeEntity` 把 eid 还进池子、同帧 `addEntity` 又取出来）会把新租客的节点拆掉或让旧节点变孤儿。判据只有一条：**这一帧结束时它还在不在 `query(world)` 里** —— 收进 `ecs/reconcile.ts`（零 `cc`、6 例单测，四种交错各一条）。**鱼也有同一个 bug**，只是鱼不会出生即死（`feedSystem` 生出来 `t=0`，`despawnSystem` 要 `t>=1`）所以一直没现形，一并修了。⚠️ 这条是**所有 ECS→节点桥的通病**，不是捕鱼特有的，已写进设计文档开放项 9 供下一个消费者复用。**② 子弹不会转**：`syncBullets` 只 `setPosition` 没 `setRotation`，所有子弹一律头朝上飞。补上 `atan2(Velocity.y, Velocity.x) - 90°`（子弹贴图跟炮台一样头朝 +y）。**③ 四门炮改成上下对坐**：原来一排四个在底部（`y` 全是 -450），中间两门互相挡视线、上半场没人打鱼白游；改成下左（玩家）/ 下右 / 上左 / 上右四个角，上半场那两门待机时先转 180° 朝下。`|y|` 同时从 450 收到 **360**：场地是 cover 缩放的，比 16:9 更宽的屏会把上下裁掉一截（可见半高 ≈ `960 / 宽高比`，21:9 只剩 412，炮台半高 48），而**故意不在 View 里做钳制** —— 那会让画出来的炮口跟 VM 里子弹的出膛点对不上，超宽屏下子弹就凭空从旁边冒出来。**④ 目录从 16 个文件平铺分成四层**：`content/`（鱼种表 + 泳道，改它不动结构）· `ecs/`（组件 + 六个 system + reconcile）· `seams/`（**四道接缝**，设计里最重要的一件事，原先在平铺目录里根本看不出来）· `art/`，根上只留 `Fish.scene` / `FishGame.ts`（唯一带 `cc` 的文件）/ `FishVM.ts` / `events.ts`。测试目录**镜像**同一棵树（`check:vm-tests` 就是按镜像路径找的）；搬文件时 `.meta` 必须跟着走 —— `Fish.scene` 是按 `compressUuid(FishGame.ts 的 uuid)` 引用组件的，uuid 换了场景当场找不到脚本。**web 真产物 e2e**：四门炮落在 25%/75% × 17%/83%（**上二下二**），上排 `rotZ ≈ -182` / `-251`（真朝下打）；连打 70 炮 + 三个 AI 打 30 秒后 `atOrigin` **恒为 0**（改之前同样操作攒到 12 个），子弹 `rotZ` 各不相同且与飞行方向吻合。八道门全绿（1007 例，+6）。⚠️ 同前：**只验过 web**
- [x] **mini-fish 水下氛围：水面后处理 + 受击闪白 + 死亡朝向**（2026-08-28 · 1009 全绿 · web 真产物 e2e PASS）— **① 死亡动画不接朝向**：活鱼是「转到路径切线 + 朝左时 `scale.y=-1` 上下翻」，一断气两样全丢 —— 一条朝左游的鱼瞬间变成头朝右还镜像了一次，看着像**换了条鱼**（用户就是这么报的）。排查过「是不是播错鱼种」：图集里 11 种鱼各 4 帧 `_dead_`、帧名与 `FishKind.id` 一一对应、`dead_0` 与 `run_0` 的贴图尺寸也对得上，而 `e.kind` 是发事件时的值拷贝、`arbiter.resolve` 返回的 eid 一一对应 —— **不是换鱼，就是朝向**。修法：`CatchEvent` 带上 `angle`（`netSystem` 在 `removeEntity` 之前读 `Angle.v[eid]`），死亡帧沿用活鱼那一套。**② 水波纹改成真·后处理**：原先只给海底贴图拧 UV，只能让背景自己晃、鱼纹丝不动，像「水在背景里」。改成**整个水下画面先进 RenderTexture** —— 新开一个 `WATER` 层（bit 1，bit 0 被 kit 的 `BG` 占着），一台只看这层的相机（priority 100 < kit ui 相机的 200）把海底 / 鱼画进 RT，再由一张全屏 quad 采样输出，于是折射拧的是「隔着水面看到的一切」；**子弹 / 渔网 / 炮台 / HUD 留在 `UI_2D` 不进 RT，一点都不扭**（玩家射出去的东西跟着水晃会让人以为自己瞄歪了）。子弹一开始沉进了水里，用户报「轨迹有问题」—— **折射是个空间上变化的位移场**（每个像素按所在位置的噪声被拧走十几像素，噪声还在滚），**一条直线穿过位移场就不再是直线**：鱼大且慢只表现为微微变形，子弹细长又每帧走很远，整条轨迹被拧成抖动的波浪，还跟不扭的炮口衔接不上。⚠️ `node.layer` 不继承，每帧新生的鱼都要逐个置层。一个 pass 干三件事所以水面只占一个 draw call：**折射**用两层反向滚动的噪声取不同通道当 x/y 偏移（同向滚 = 整幅画在平移；同通道 = 只沿对角线抖）；**焦散**只在两层等值线相交处才亮，相交带天然是网状的，正是阳光透过水面那种游动光网；**气泡**一列一个、每像素只查相邻三列（开销与气泡数无关），画的是**环**不是实心圆（实心的看着像光球，气泡是薄壳）。噪声图 `art/noise.png` 由 `pnpm gen:noise` 烘：64×64（**POT 才能开 REPEAT**，波纹靠 UV 一直往外滚，clamp 会把整幅图糊成边缘那一行），R/G/B 三通道装三层频率，一次采样拿三层；生成物**不配 `--check` 闸**（源就是那个脚本，没有仓外美术要同步，判据同 `mini-hop` 的 `level.ts`）。**③ 受击闪白**：挨了一网没死的鱼白闪 0.12 秒（`netSystem` 新发 `hurt` 事件）。非要一个 effect 是因为 `Sprite.color` 是**乘算**的 —— 只能把鱼调暗，白色乘上去等于没变；全场受击的鱼共用同一个 Material，闪完换回内置材质。**web 真产物 e2e**：极端折射参数（0.06）下鱼和海底一起被拧变形而 HUD / 炮台纹丝不动（截图为证），证明分层正确；打 100 炮后死亡动画节点的 `rotZ` 分别是 180（`scaleY=-1`）/ 22 / -9 —— 各带各的朝向，不再清一色 0；受击闪白采样命中 26 次。八道门全绿（1009 例，+2）。⚠️ **采 RT 必须翻 y，这活得自己干**（用户报「是不是 y 颠倒了」，是的）：GL 系后端往 framebuffer 写的第 0 行是屏幕**底**边，采样时 `uv.y=0` 拿的就是第 0 行 → 整幅水下画面上下颠倒。引擎备了这条路但只走内置材质 —— `Sprite._updateBuiltinMaterial` 发现贴图是 `RenderTexture` 时复制一份打了 `SAMPLE_FROM_RT` define 的材质，`builtin-sprite.effect` 里的 `CC_HANDLE_RT_SAMPLE_FLIP(uv0)` 才生效；**用 `customMaterial` 就够不着那段**。修法是在 fs 里自己调一次宏（宏读 `cc_cameraPos.w`，自带后端判断，一行同时管住 WebGL 与 Metal / Vulkan），且**只翻取 RT 颜色那一次** —— 噪声 / 焦散 / 气泡是屏幕空间效果，照旧吃没翻过的 `uv0`。同前：**只验过 web**
- [x] **鱼阵内容与 waveFeeder：捕鱼从「随机投喂」进到「有编排的内容」**（2026-09-01 · 1024 全绿 · 八道门全绿）— 配套设计见 [`2026-08-31-mini-fish-content-editor.md`](design/2026-08-31-mini-fish-content-editor.md)（wayfinder 八票的结论）。新增 `content/content.ts`（`rev` + 8 条路径 + 4 个起手阵），`content/paths.ts` 的硬编码表改为从它派生 —— **存档格式从「下标」换成「稳定字符串 id」**：删掉第 3 条路径时，下标方案会让鱼阵指向另一条**完全合法**的路径，不抛异常、只是这队鱼走错了路；id 方案引用不到会**当场抛**。下标只留给运行期（`PathFollow.pathId` 只装数字），转换发生在 `waveFeeder` 载入内容那一刻。新增 `waveFeeder`（纯表播放器：无随机、无 `rand` 注入，同一份 content + 同一串 dt 必吐同一串 spawn —— 将来服务端要重写一遍，确定性是能逐行对照的前提）与 `combineFeeders`（⚠️ 用 `flatMap` 不用 `[...a,...b]`，后者会被 Cocos 构建降级成 `[].concat`）。`FishVM` 的默认投喂改成 **鱼阵 + 压低的随机底噪**：底噪从 `0.6s/2 批` 压到 `1.0s/1 批`，这两个数是**算出来的** —— 稳态同屏数 = 投喂率 × 平均寿命（8 条路径平均弧长 2387 ÷ 平均速度 140 ≈ 17s），1 条/秒 × 17s ≈ 17 条，约为原先 57 条的三分之一，**总量守恒**、其余让给鱼阵。阵与阵**按「上一阵投喂完毕 + 间隔」接续，不等清场**（一队 8 条 `gap 0.3` 的阵 2.1 秒投完却要 19 秒才游干净，等清场每阵之间会白空十几秒）；⚠️ 「等清场」那个判据只属**编辑器预览窗口**，两者别混。闸：`content.ts` **不配 `--check` 生成物闸**（源与产物是同一个文件，闸挡的是不会发生的事，判据同 `mini-hop` 的 `level.ts`），改配 `content.test.ts` **内容自检**（跨表引用 + 数值范围，正是 `as const` 与 `typecheck` 挡不住的两样）+ `feeder.test.ts` 的时刻表与大 dt 等价 + `FishVM.test.ts` 的**稳态带 12~24**（有人改 `interval` 把屏幕搞空或搞爆当场红，用 mulberry32 播种，不许靠 `Math.random` 随机红）。**只验到 node 单测层**：web 真产物 e2e 与真机帧率还没跑
- [x] **鱼阵编辑器 —— 路径 + 鱼阵**（2026-09-02 · 1082 全绿 · 八道门全绿）— 现状见 [`2026-08-31-mini-fish-content-editor.md`](design/2026-08-31-mini-fish-content-editor.md)，宿主判据见 [`ADR-0020`](adr/0020-internal-tools-in-html.md)。**它是纯 web 内部工具**（`apps/fish-editor/`，vite，`pnpm editor`），**不进任何游戏包** —— 先按 Cocos 模块做了一版（一个 bundle、五张 prefab、约 700 行 View、自烘的九宫格底图），做完重新问「它为什么得在 Cocos 里」，发现**要复用的那部分本来就零 `cc`**（整棵 mini-fish 树里 `import 'cc'` 的只有 `FishGame.ts` 一个），留在引擎里换来的只有「一个没有 CSS 的 UI 工具箱」和「一个只有策划用的工具跟着产品下发给玩家」，于是整个搬走、Cocos 那套全删。**逻辑全在一个 `EditorVM`**（零 `cc`，32 条镜像测试）：增删改复制 · 控制点命中判定与拖拽落点 · 分段贝塞尔接续与折角 · `rev` 只在导出时 +1 · 草稿基线比对；**删掉被引用的路径 ⇒ 那个 group 进未解析态**（换成下标会静默改指另一条完全合法的路径）。预览**直接跑 `FishVM`**（`aiAgents: []` ⇒ 无炮无子弹无结算）。⚠️ 搬家时逮到**编辑器跟游戏早就不一致**：帧号（游戏播 12fps 序列帧、编辑器永远 `_run_0`）、朝向、场地缩放（cover vs contain）、鱼的尺寸（美术原尺寸 vs 按判定半径算的框）四处各写一份 —— **不一致的来源是「两个 View 各写一份映射」，跟宿主无关**，所以抽出零 `cc` 的 `mini-fish/render-map.ts`，游戏 View 与编辑器读同一份（11 条测试，四种变异全咬住）。顺带白拿一件只有 DOM 才顺手的：游戏 cover 缩放**窄屏会裁掉 `FIELD` 上下**，旧编辑器画完整场地框等于骗人，现在叠一圈可见区虚线（1440×864，4:3 ~ 20:9 都看得见）。⚠️ DOM 侧唯一要补的是 `textures.plist` 解析（约 40 行）：167 帧里 **65 帧是转着存的**（鱼占 39 帧），不处理 `textureRotated` 会看到一堆侧躺的鱼；**TRIMMED 尺寸还逐帧变**（同一条黄鱼 `_run_3` 52×31、`_run_0` 52×34）。⚠️ 另一条**跟宿主无关**的 Cocos 通性坑（在 Cocos 版上踩到的，规则留在 `ui-style-guide.md` + 全工程闸 `test/prefab-alpha.test.ts`）：`Batcher2D.walk` 把节点自身 `UIRenderer.color.a` 乘进**整棵子树**，所以「半透明底 + 子节点放文字」会把文字一起调暗，alpha 归零则文字**彻底消失**，而 `active`/`enabled`/`color` 在检查器里全是对的 —— 一个能查的地方都不异常，只是不画
- [x] **内容重编：14 条路径 · 9 个鱼阵 · 11 种鱼全上场**（2026-09-02 · 1125 全绿 · 八道门全绿 · 编辑器真渲染逐阵看过）— 旧内容表是队形能力做出来之前的：4 个阵、6 种鱼、8 条**全是单段**的路径，一轮 23 秒就重播。重编成 **14 条路径 / 9 个阵 / 96 条鱼 / 一轮约 59 秒**，节奏排成「小鱼群 → 雁阵 → 水母喘息 → 河豚护卫 → 箱鲀滑翔 → 灯笼鱼长蛇 → 海龟追猎 → 双鲨巡场 → 金鲨压轴」。新路径补的是**缺的形状**：低位直穿、俯冲、上拱 / 下凹大弧、右场回旋，外加两条**多段**的 —— `wave-lr` / `wave-rl` 换成真正的两段 S（接点处切线共线 ⇒ C1 连续），`sweep-in` 是条折返钩子（右上进、扫到左场、拐回右下出）。多段贝塞尔是编辑器 v2 就做出来的能力，内容里此前一条没用上。路径表 0~7 的**下标次序不动** —— 五个测试按下标取路径（`PATHS[0]` 左→右平直、`PATHS[1]` 右→左、`PATHS[4]` 大摆、`PATHS[6]` 竖直、`PATHS[7]` 长回旋），新的一律往后加。**两道新闸**：① 每条路径两端在屏外、中段进屏（端点跑进屏里 = 鱼**凭空出现**，不报错不崩，只有盯着看才发现）；② 11 种鱼都得排进鱼阵（图集是**整包**下的，没排进去的鱼种就是白下载的字节）。⚠️ **三处只有看图才发现的，闸全放行**：`fish_gui`「鬼鱼」的美术其实是**海龟**，我按名字给了「飘忽」（`sway 1.2 / hold 0.7`）正好填反 —— 海龟是全表最该稳的之一，改成 `0.5 / 1.3`；两条鲨鱼隔 230 过得了「同群槽位不重叠」（判定半径和 204），但**贴图长 500**，两条糊成一条 —— 改成前后 480 + 上下错开 310；河豚的小弟原本比它快（105 对 88），会**反超并盖住**它，而河豚是炸弹鱼 —— 改成同速 + 两侧张开的 V 形侧翼，侧向 95 躲开河豚半径 44。**判定圈不是贴图**：内容摆不摆得开，闸只答得了前半句，后半句得把图调出来看。`sway` / `hold` 那两列同理，别照名字填（教训写进了设计文档 §7）。性格那条镜像断言的对照组跟着换成**水母对河豚**（r41 对 r44，半径只差 3 像素、性格相反），比原来的鬼鱼对蝠鲼更咬得住；六个变异仍全咬住。
- [x] **鱼群：一群 1~n 条鱼 + 队形 + 不呆板的游法**（2026-09-02 · 1123 全绿 · 八道门全绿 · web 真鼠标 e2e PASS）— 一群鱼从「同一条路径上按秒数串成的一列」变成「**每条鱼各有相对位置**的队形」，并且游起来不再严丝合缝。**数据格式换了**：`FishGroup` 的 `count` + `gap` 秒 → `formation`（`2n` 个数的槽位表，路径局部坐标，`dx` 沿路径、`dy` 垂直）。**存距离不存秒数**，因为队形是**空间**上的形状：存秒数则 speed 一调、一列鱼的疏密跟着变，那是「流」不是「队」。**存槽位不存生成器**（形状 + 条数 + 间距能省一半字节，但那样就没法单独拖一条鱼，而「这一条往外挪一点」正是编队形的人真正在做的事）—— 模板（一列 / 横排 / 雁阵 / 一簇）只是编辑器的起手按钮，数据里永远只有槽位，没有第二种表示可漂。两维落地的路不一样：`dy` 是真侧向偏移（新增 `paths.poseAt` + `PathFollow.offset`），`dx` 在 `waveFeeder` 载入时换算成**进场延迟** `(领队dx − 自己dx)/speed` 秒 —— 路径起点之前没有路可站，纵深只能用时间表达；于是 `at` 恒指**领队**进场那一刻，整条队形平移不改出场时间。**新增 `ecs/schoolSystem.ts`（夹在 `pathSystem` 与 `spatialIndex` 之间）**：它改 `Position`，排在建索引之后就等于拿旧位置建的索引去判网，网边上那条鱼会时中时不中。只写了 boids 的**一条半** —— 对齐由路径本身给（整群同速同切线）、聚合换成**槽位弹簧**（目标是编好的队形，比「群心」更听话：形状归内容说了算）、**分离**真的按 O(n²) 算但只在同 `school` 内、判定圈叠上了才互推；外加一条 boids 没有的**漫游**（两条不同频的正弦）。相位与频率来自 `seed = 群内序号 / 条数`，**不是随机数** —— 编辑器走带是「从 0 重放到第 N 秒」，不确定就意味着拖一下走带鱼群就换个样，将来跟服务端逐行对照也靠这条。三处刻意的「不」：**不动朝向**（`fishFacing` 在 |角度| = 90° 处翻上下，`rise` 那种竖直路径正压在这条线上，摆一下翻一次鱼会疯狂抽搐）· **位移封顶**（该鱼种摆幅的 2.6 倍，再自然也不许游出队形之外，否则编好的形状不作数）· **散鱼（`school = 0`）一概不管**（随机底噪照旧沿中线走，一群在摆、背景不摆反倒把「这是一群」凸出来）。**运动参数按鱼种走，不是一套常数管全表**：摆幅要是个绝对像素，鲨鱼（判定半径 102）和黄鱼（17）就摆一样多 —— 小鱼快活、大鱼看着仍旧钉在轨道上滑过去，「不呆板」在大鱼身上根本没兑现。拆成两份：**体型那份自动给**（摆幅按 `r / R0` 放大、弹簧按 `R0 / r` 软化，`R0 = 24` ⇒ 大鱼摆得远而缓，各体型「快慢感」一致，不会大幅高频地抽）；**性格那份写进 `FishKind`** 的 `sway`（摆幅倍率）+ `hold`（守位倍率）两列，1 = 按体型该有的样子，水母飘 `1.1/0.6`、鲨鱼稳 `0.5/1.4`。`hold` 同时决定摆动快慢（弹簧硬则频率高），所以两列够用，不必再开一列调频率。摆幅是**反解**的：受迫振子稳态幅度 `A = F/√((k−ω²)²+(cω)²)`，由目标 `A` 求 `F` ⇒ `sway` 说的就是真的像素摆幅，改弹簧不会把幅度一起带跑；封顶也绑在摆幅上（2.6 倍）而不是绝对值 —— 安静的鱼该连封顶也小。**只有分离全表一个值**：两条鱼叠在一起就是不行，那是物理不是性格，而它的半径本来就随鱼走（判定圈之和），早就是按鱼种来的。两条镜像断言各挑一对鱼咬住一件事 —— 鲨鱼对黄鱼（体型接上了）、鬼鱼对蝠鲼（体型几乎一样、性格相反 ⇒ 差别只可能来自那两列），六个变异全咬住（含「`hold` 不参与」，靠 60 秒里 dx 变号 12 比 18 分辨，砍掉就是 15 比 15）。⚠️ **重叠的槽位不报任何错，只会让那一群在原地哆嗦**（弹簧把它们拽到一起、分离力再推开），所以同一条判据钉在三处：编辑器拖拽落点被推开、模板间距夹紧、`content.test.ts` 一道闸 —— 三处用的都是「判定半径和」这同一个数。编辑器侧：队形在画布上直接拖（选中那群画成半透明的鱼 + 虚线判定圈），条数是**算出来的**（槽位数）不再另存一份会漂的 `count`。顺带修一个下拉的真 bug：`addEventListener('scroll', closePop, true)` 是**捕获阶段**监听，`.pop` 自己滚动时事件从 window 往下捕获先撞上它 —— **一滚就自己关**，看起来像「下拉不能滚、点一下就没」；同时给路径 / 鱼种下拉加了**模糊筛选**（子序列命中，敲 `crh` 中 `cross-rl-high`，`src/fuzzy.ts` + 8 条测试）。内容表四个阵重编成真的鱼群（一簇黄鱼横穿 · 雁阵红鱼配一列大红鱼 · 河豚带一簇小弟 · 鲨鱼回旋配一列灯笼鱼）。**验到 web 真鼠标 e2e**：拖第 8 条鱼 → 导出文本里只有那一对数变了（`-56,-108` → `134,22`）· 雁阵重排 → `[0,0,-114,142,-114,-142,-227,284]`（间距被夹到 142 ≥ 判定半径和 122）· 播到 8s / 9.2s 两帧对比，八条鱼在场上的相对位置在变（不是整体平移）· 0 error。⚠️ **只验过 web 与 node**；Cocos 侧 View 一行没改（它只读 `Position` / `Angle`），但 Creator 预览与真机帧率没跑 —— 200 条鱼时同群 O(n²) 的分离是不是热点，留给第三刀量。
- [x] **大鱼转弯不再僵硬：鱼是一根有长度的棍子，不是一个点**（2026-09-02 · 1127 全绿 · 八道门全绿 · 编辑器真渲染逐帧看过）— 用户报「鲨鱼这种超大的鱼转向非常僵硬」，并给出了对的直觉：**路径点落在鱼身体中间**，能不能让鱼去追一个隐藏的点、像舞龙那样。诊断确认前半句就是根因，而且**跟帧动画无关**（序列帧只管摆尾，不管转身）：`pathSystem` 取「路径上 `s` 处的点 + 那儿的切线」，等于把整条鱼**钉在肚脐上原地转** —— 路径一弯，499 像素长的鲨鱼绕着自己中间旋，尾巴往前甩、头往后扫。舞龙那个直觉的**刚体极限**就是：鼻尖压在 `s + 半身`、尾尖压在 `s − 半身`，位置取两端中点、朝向取**两端连线**（`content/paths.ts` 新增 `bodyPoseAt`，`pathSystem` 与 `spawnFish` 同用一份，免得生鱼时用切线、下一帧换成连线，鲨鱼一出生「唰」地扭一下）。追点模型要存状态、走带拖一下就重放不出同一画面；棍子模型**仍是 `s` 的纯函数**，确定性一分没丢，而效果一样。一句话换来三件事：**① 转弯速率按体长自动低通** —— `loop-left` 上鲨鱼峰值角速度 23.9 → **17.6°/s**、`sweep-in` 41.0 → **21.5°/s**，而黄鱼 46.5 → 46.2 **几乎没动**：「大鱼转得稳、小鱼灵活」是几何给的，不是又开一列参数（对比 `sway`/`hold` 那次，那次是真需要一列性格）。**② 位置被拉向弯道内侧**（矢高 ≈ `体长²/8R`，鲨鱼在 `loop-left` 上峰值 133px）—— 这是对的：一根刚性的棍子过弯，中点本来就不可能还在弧上。**③ 队形没被破坏**：两端各按各的法线加 `offset`，同心弧上两点转过同样的角度 ⇒ 连线方向跟中线那条一致，「偏在旁边那条鱼跟领队平行」照旧成立。鱼种表加一列 `body`（体长）= 图集 `<id>_run_0` 那帧的**宽**（鱼头一律朝 +x）；它跟 `r`（短边的一半）抄自同一帧，所以 `body >= 2r` 是恒等式 —— **单配一条闸断言这个量纲关系**，因为「大鱼转得稳」那条比的是相对快慢，鲨鱼体长抄成 49 照样过，没有第二个地方会红。端点之外**沿切线外推、不夹紧**：夹紧会把尾巴按在路径起点上，鱼一进场先被压扁再「长」出来。⚠️ **顺带量出第二个毛病，本刀没治**：朝向过 ±90° 时 `render-map.fishFacing` 让整条鱼**在一帧内镜像翻转**（为的是不让鱼肚皮朝天），`loop-left` / `loop-right` / `sweep-in` 这三条要掉头的路各翻一次 —— 掉头在 2D 里必然扫过竖直，躲不掉。小鱼看不出来，500 像素的鲨鱼是一记很明显的「啪」（编辑器 20.30s 与 20.50s 两帧：背鳍从右边瞬间跳到左边）。**它和转向僵硬是两个各自独立的毛病**，棍子模型治不了。想治得让鱼**翻身**（`scaleY` 从 1 经 0 到 −1 滚过去），代价是要在 View 里存每条鱼的翻身进度、游戏与编辑器两处都得有，而 `render-map` 至今是纯函数、没有状态；**纯按角度做无状态的缓冲不行** —— `rise` / `dive` 是竖直路径，整条路角度恰好压在 ±90° 上，会被压成一条线看不见。⚠️ 同前：**只验到 node 单测 + 编辑器渲染**，Cocos 预览与真机没跑（View 一行没改，它只读 `Position` / `Angle`）。
- [x] **还债：七个子游戏的界面补成 prefab**（2026-09-03 · 1135 全绿 · 八道门全绿 · 七款逐个真预览看过 · 关 [#10](https://hlgit.5518game.com/luohao/creator-core-kit/-/issues/10)）— `kind:'game'` 那七款（`mini-dodge` / `mini-plane` / `mini-brick` / `mini-shooter` / `mini-hop` / `mini-cards` / `mini-fish`）**界面全是代码拼的、prefab 数为 0**，而 `kind:'panel'` 的模块和 `skins/` 下那 8 张早就照仓规「UI 一律走 prefab」做了 —— 只有子游戏这一层没做。现在一款一张 `Hud.prefab`，住自己 bundle 的根上，描述在 `scripts/prefab-gen/<id>-hud.prefab.json`（版本化、可重放），生成走既有的 `build-prefab.js`（编辑器 `create-prefab` 消息，**不裸序列化 `Node`**）。**分界判据一句话**：**这个节点的数量和位置是不是由 VM 每帧算出来的** —— 是就是世界（鱼 / 砖 / 岩石 / 敌机 / 牌 / 骰子 / 关卡砖 / 炮台 / 背景瓦片 / 水面 RT），归 View 按 VM 建；否就是界面（读数 / 提示 / 返回 / 加减档 / 三个虚拟按键 / 竖屏提示），归那张 prefab。两个边界上的判断都按这条落的：**炮台**数量固定但**角度每帧由 VM 给** ⇒ 世界；**虚拟按键**位置固定、不随场地缩放 ⇒ 界面。**贴屏幕边改用 `Widget`**：子游戏场景根本来就自带 `align=45` 的 Widget 拉满屏，所以 HUD 挂进来就有一个跟屏幕同大的父节点，`halfScreenHeight` 那种布局算式从七个 View 里全部消失（`mini-fish` 的 `layout()` 连转屏时逐个 `setPosition` 那五行也一起没了，只剩「开关提示 + 缩放场地 + 调 RT 尺寸」）。地基那层跟着换血：`gameLabel` / `exitButton`（建节点的）删掉，换成 `loadHud` / `hudNode` / `hudLabel` / `wireHud`（接线的）—— **地基从此一行 UI 都不拼**。⚠️ **`wireHud` 干的是两件事，第二件是踩出来的**：`loadHud` 跟美术并行 `await`，回来时世界还没建，随后 `buildField` 建的背景是**后来的兄弟节点**，而 2D 渲染顺序就是子节点顺序 ⇒ 满屏的天空 / 星空 / 海底把整张 HUD 盖掉。表现是「世界一切正常、读数和返回键全没了」，不报错不崩，八道门全绿，**只有把游戏点开才看得见**（在 `mini-plane` 上实测到），所以把「提到最上层」焊进每款都要调的那一句里，忘不掉。**闸**：新增 `test/foundation/game/hud.test.ts` —— 把 View 源码里 `hudLabel/hudNode/wireHud(hud, 'X')` 的名字跟 prefab 里真实的节点路径对账（prefab 改个名字就静默少一个绑定，而 View 层没有单测能碰到），外加「七个 `kind:game` 模块一个不少」和「每个 View 至少有一处 `hud*` 调用」两条 —— 后者挡的是「又改回代码建 UI」。两个变异都咬住（prefab 里 `Balance` 改名 / 把 `HopGame` 的 `hud*` 全拆掉）。运行时那道守卫在 `hudNode`：**取不到当场抛**，不返回 `undefined`。⚠️ **`build-prefab.js` 加了 `label.overflow`**：它原本给了 `size` 就锁 `CLAMP`，而 `gameLabel` 一直是 `NONE`（文字反过来撑节点）—— 直接照搬会把「本局 999 · 最好 9999 · 新纪录！」那种长提示裁掉。**但有 Widget 的节点必须 CLAMP**：`NONE` 让文字定尺寸、而 Widget 的偏移是按尺寸算的，两者一起用，出的 prefab 里偏移被**补偿成另一个数**（空串的 `Balance` 被撑成 0 宽，`left` 从 20 变成 230）。所以规则是：**贴边的用 CLAMP（盒子是布局契约）、自由生长的读数与提示用 NONE**，可点的一律 CLAMP（`NONE` 会把触摸盒缩到字面大小）。顺带一处改善：`mini-fish` 的竖屏提示原来是「一个 Sprite + `UIOpacity 235` + 子节点 Tip」，`UIOpacity` 会连字一起调暗（正是 `test/prefab-alpha.test.ts` 那道闸管的事）；拆成 `RotateHint`（空节点）+ `Cover`（半透明底，无子节点）+ `Tip`（字），提示文字从此满亮。**验法**：八道门之外，七款**逐个在真预览里点开看过**（浏览器预览 + 真鼠标事件 + 逐张截图比对改造前的位置）—— `mini-plane` 的 Score 落在 `(0,380)`、Hint `(0,-180)`、Back `(-330,450)`，跟改造前那三句 `setPosition` 逐像素一致；`mini-fish` 四个角（余额左上 / 返回右上 / 加减档右下）与竖屏提示各验一次。⚠️ 这类改动**闸是看不见的**：位置错、被盖住、触摸盒缩水，八道门一条都不会红。同前：**只验到 web 预览**，web 真产物 e2e 与真机没跑。

### 2026-08-18 · 热更内容基址一律听服务端（base 与分包统一）

上一轮只让「没随包发过的 bundle」用服务端下发的 `cdn_url`，并断言 base 做不到 —— 那个断言错了，
起因是只查了 `loadLocalManifest` 一条注入路。参考实现（bl-framework 的 `FWHotUpdate`）提示了
`loadRemoteManifest`，核实后补齐：

- **机制**：`check()` 自取 remote manifest → 改掉三个地址字段（`rebaseManifest`，纯函数、有单测）
  → `loadRemoteManifest()` 灌回引擎。下载基址只认 remote（`AssetsManagerEx.cpp:738` 全文件唯一一处
  `getPackageUrl`），local 那份只提供 diff 用的 asset 表、一字节不动。改 local 走不通（与缓存比版本，
  比输了被顶掉、比赢了清库且再不更新，版本号既要高又要低）。
- **base 与所有分包统一**；选项 `bundleCdnUrl` 改名 `cdnUrl`。任一步不成都退回 `checkUpdate()` 老路并打 warn。
- **e2e PASS**（真 x86_64 模拟器）：判据做成二值 —— APK 与 CDN 上所有 manifest 的 `packageUrl` 全烘死地址
  `http://127.0.0.1:9/dead/`，唯一活地址是握手下发的。结果：base 37%→100% → restart → `skin='vest'`
  → shared 阶段四个包全走注入路 → force-stop 冷启动零重下。对照组（改动前 engine，同一份死地址内容）
  失败在 `Failed to connect to /127.0.0.1:9`。
- 门：lint / typecheck / test（46 文件 649 用例）/ check:vm-tests 全绿。

**至此整条链路只剩 `dispatcherUrl` 一个烘死的地址**（链条起点，结构性救不了）。

当日两项遗留**已全部消解**（2026-08-18 复验）：

1. ✅ dispatcher 曾配成 `http://172.25.50.135:8081/cdn/`（filebrowser 的 SPA 路由，任何路径都回
   200 + HTML）。[server-core-kit#1](https://hlgit.5518game.com/luohao/server-core-kit/-/issues/1)
   服务端已修，现下发固定分享 `…/api/public/dl/shCo8WNE/`，`Content-Type: application/octet-stream`
   判据通过。**真下载也已在真链路上补验**（见下「真 dispatcher + 真下载」）。
2. ✅ 长连接 10s 未就绪查明是两个独立的坑，与热更无关：引擎功能裁剪关掉了 native-only 的
   `websocket` 模块（`typeof WebSocket === 'undefined'`，连 SYN 都发不出去，网关侧零日志），
   以及心跳间隔吃 core 默认值 15s 恰好撞上网关 15s 空闲超时（连上 → 15s 被回收 → 重连，死循环）。

### 2026-08-18 · 长连接修复 + 出包流程固化 + demo 装配文档

- **长连接跑通**：勾上 `websocket` 引擎模块（⚠️ 它改 `cfg.cmake` 的 `USE_SOCKET` 编译宏，
  Creator 的「构建」只生成工程不编 native，**必须再跑 gradle 全量重编 `libcocos.so`**，否则装上去
  还是旧 so、勾了也不生效）+ 心跳间隔 15s → 5s。模拟器实测：干净安装后连接建立，此后 2 分钟
  网关零条「连接关闭」（改前应有 8 次）。
- **出包流程固化**：`apps/demo/build-configs/`（构建意图进 git · 本机路径 gitignore）+
  `scripts/build.mjs`（Creator → manifest → gradle 一条龙）+ skill `/demo-build`。踩出三个坑：
  命令行构建不读 Creator 偏好设置、**失败时退出码仍是 0**、`startScene` 只认 uuid 填 url 会静默
  回退到项目默认场景。
- **demo 装配文档**：文档归属从两层扩到三层，新增 `apps/demo/docs/`（README 地图 + bundle-layout
  + vest-and-skin + hotupdate-pipeline，七张 mermaid 图）—— 此前「加个模块 / 加个马甲 / 发个版
  怎么做」没有一处以现状形态回答。

- **真 dispatcher + 真下载 e2e（补上最后一个缺口）**：让装着 1.0.0 的包去撞 1.0.1 的 CDN。
  判据二值化——往 `foundation` 埋一句包内不存在的日志：`⏳ bundle 'foundation' 更新 0/1 → 1/1`
  → `[CCK-NET] 长连接就绪【热更到 1.0.1】`；反证 `unzip -p …apk assets/assets/foundation/index.js`
  grep 该串 = 0 处，设备上下载落地那份 = 1 处；`force-stop` 冷启动零重下、标记仍在。
- **⚠️ 换来这一程的是一次 native 崩溃，值得记住**：首跑给 15 个包**无差别**盖了 1.0.1，而 base 的
  资产表其实没变 → `AssetsManagerEx` 在 `AsyncTaskPool` 的 worker 线程算 diff，遇
  `diffMap.empty()` 就地 `updateSucceed()` → `dispatchUpdateEvent(UPDATE_FINISHED)` 绕开了本该把
  回调弹回主线程的 `prepareFinished` → JS 回调在非主线程进 VM，`se::AutoHandleScope` 构造即
  `SIGSEGV`（启动后 ~90ms，栈顶 `updateSucceed()`）。**结论：`--prev`（内容没变的包沿用旧版本号）
  是防崩必需项，不是整洁优化**——`packages/tools` 早就实现且有单测，是 `build.mjs` 生成 manifest
  时漏传。补上后 15 个包只有 `foundation` 涨到 1.0.1，其余 14 个沿用 1.0.0，全程零 `F/libc`。
  **同一颗雷的另一个引信一并拆了**：`sameContent` 原本把 `packageUrl` / `searchPaths` 也算改动，
  于是「只换 CDN 域名、内容没动」照样让所有包涨版本而资产表不变 → 同一条近路。已改成**只比资产表，
  口径与引擎 `genDiff` 对齐**——凡是我们判"改了"而引擎判"没改"的字段都是崩溃态的原料。原先那条理由
  （旧 URL 会留在客户端缓存里）也不成立：客户端查更新用的是本地 manifest 里烘的地址
  （`AssetsManagerEx.cpp:580/623`），且本框架的客户端一律经 dispatcher 下发的 `cdn_url` 自取并改写
  基址，那个烘进去的地址没人读。换址只改服务端配置。

### 2026-08-19 · web 热更接通（版本表 + 旧页面换代码 · 浏览器双向 e2e PASS）

core 侧那条 web 路径 2026-07-31 就写好了（拉版本表 → compat 闸 → `setVersions`），但**外围三样一直没有**，
和 native 这几天补的三样一一对应：没有版本表生成器、没有 web 构建配置/流水线、`versionUrl` 从没接过线。

**新增 `cck-manifest web-versions`**（[[web-versions]]）：从产物的 `src/settings.<md5>.json` 抽
`assets.bundleVers`，剔掉 AOT 三件套，盖上 `version` / `coreApiHash` / `minAppVersion`，落成一张表。
native 的 manifest 要带每个文件的 md5+size 是因为**它要自己下载**；web 什么都不用下，引擎按
`assets/<bundle>/index.<md5>.js` 取、浏览器自己拉，所以整条流水线只剩这一张「谁是哪一版」的表。
四道守卫都对着真实的坑：settings 文件名**自己也带 md5**（盯死 `settings.json` 会永远找不到）、
残留多份就报错（挑第一个 = 生成一张指向旧 md5 的表，客户端加载即 404）、`bundleVers` 为空**点名
`md5Cache`**（换文件名就是 web 的版本机制，关了热更无从谈起）、AOT 包不进表（版本由页面自己的
settings 说了算，客户端换了只会去拉不存在的文件名）。

**`build.mjs` 长出 web 平台**：新增 `build-configs/web-mobile-boot.json`（`md5Cache: true`），
配置名不再写死 `android-` 前缀，`--manifest` 在 web 下改出版本表并把产物**叠加**到 `webDir`。
⚠️ **叠加、绝不清空**——老页面还引用着上一版的 `index.<旧md5>.js`，删了等于打断线上会话；
这条和 native 相反（那边只留最新一版）。

**改掉一个我自己引进的错误设计**：先写成「相对文件名 → 拼 dispatcher 下发的 `cdnUrl`」，
理由是"烘死地址会失效"。**那是 native 的病**：APK 里的地址改不了，只能运行时注入；web 上页面自己
就是从某地址加载的，相对路径永远跟着页面走。实测直接照出来了——8082 的页面去拉 8081 的版本表，
CORS 当场拦掉。已删掉那一档：绝对 URL 原样用，相对文件名交给引擎按页面 base 解析。
配套两条：`versionUrl` **native 明确不配**（那条压根没有 bundleVers 这回事，配了只会每次启动白拉一个
不存在的文件），以及**拉不到版本表 = 启动失败·可重试**（表与页面同源，缺它基本等于没部署上去；退回包内
`bundleVers` 会把发布事故伪装成「玩家在玩旧版」。对齐 native base check 失败，而非分包 `BundleUpdater`
那条「失败就用包内」——单包增量可有可无，这张表是整版权威）。

**热更检查失败一律中止**（2026-08-19 追补，[[adr-0015]]）：web 版本表拉不到会中止启动，而 native 分包
`BundleUpdater.ensureLatest` 原本「永不 reject」（ADR-0013 决策 6）—— 两边不一致。审下来发现降级救不了
任何场景：CDN 挂了的话 base check 早就把玩家挡住了，分包再降级只是把「CDN 少传了文件」的发布事故
伪装成「玩家在玩旧版」；而从没随包发过的新模块 / 新马甲皮本地压根没有旧版可退，降级只是把失败推迟到
`loadBundle`、报错更难查。已统一为「失败即 reject」，闸拒带 `needFullUpdate` 标记与网络错分开，
`ensureLatest` 失败不留缓存（否则重试拿到同一个已 reject 的 promise，永远重试不动）。

**浏览器双向 e2e**（真构建产物 + 8082 静态托管 + Playwright，单变量）：
- **旧页面加载新 bundle 代码** —— 留一份 A 版页面（入口 `index.a05b3.js`、自带 settings 说 `shop=50149`），
  只改 shop 一行后发 B 版（`shop=ee5da`，lobby 仍 `ef2c3` 未动）。用**旧页面**启动 → 拉到 1.0.1 版本表 →
  游客登录 → 进大厅 → 开商城，加载的是 `assets/shop/index.ee5da.js`、打出改动后的日志。
  全程 **0 error / 0 warning，整页未重载**。
- **闸拒那一程** —— 版本表 `coreApiHash` 改成 `deadbeef0000`，同一个旧页面启动停在
  `需要刷新页面 / core API 不兼容，需整包更新`，**lobby 与 shop 一个都没加载**（闸摆在"加载第一个
  业务 bundle 之前"的意义正在此）；恢复 hash 即放行。

**顺带修掉三个真问题**：① `build.mjs` 的构建成功判据盯死 `settings.json`，而 `md5Cache` 一开它就叫
`settings.<md5>.json` → **每次 web 构建都被判成失败**（产物其实是好的），改成认前缀取最新 mtime；
② 出包吃的是 `@cck/*` 的 **dist** 不是 src，dist 陈旧不会有任何报错、**两枚戳还照样一致**（同一份陈旧
dist 算的，闸完全无感）——一轮白跑的构建 + 白跑的 e2e 就是这么来的，现在出包前直接挡下并给出
`pnpm -F @cck/core build`；③ web 上 `needFullUpdate` 原样照抄 native 的"前往应用商店"，而 web 的整包
就是那张页面，改成"刷新"（`app.restart()` 在 web 上正是 `location.reload()`）。

core +3 测试、tools +7，全仓 **662 全绿**，五门齐过。
**未做**：小游戏（微信/抖音）未验；运行中定期拉版本表（现在只在启动时拉一次）；
dispatcher 尚未按渠道下发（web 与 android 该是两个渠道，web 拿到的仍是 native 的 `cdnUrl` ——
不影响版本表寻址，但 `wsUrl` / 版本闸 / 公告都该分渠道，需求已提给服务端）。

### 2026-08-20 · native 内容寻址热更（md5）· 真机 e2e 四条全过

native 一直不开 `md5Cache`，所有文件同名不同内容。三个后果都不是理论推演：CDN 只能 no-store
（热更恰是「一批文件被大量设备同时拉」的场景，命中率结构性为 0）；发布是覆盖式的，上一版的字节
在 CDN 上已不存在，**回滚必须重新出包**；即使重传上去也不生效——引擎默认 `cmpVersion` 把「远端号
更小」判成本地已最新，**静默跳过**。

ADR-0013 当初否决 native 开 md5，理由是引用链会把「改一个模块」传导成「必须发整包」。实测推翻了
这个前提的关键一环：**只要客户端不吃 `settings.bundleVers`、改吃显式版本，模块改动就不再传导**——
客户端手上那套 `main.js`/`application.js`/`settings.json` 保持自洽即可，它们描述的是包内那份 AOT，
本来就该跟 APK 走。

**版本从 bundle 自己的 manifest 反推，不引入第二张表**（[[bundle-version]]）：`<bundle>.manifest` 的
asset key 里就写着 `assets/<b>/index.<md5>.js`，而 `AssetsManagerEx` 更新成功后
`_localManifest = _remoteManifest`——更新刚跑完，manifest 就是这个 bundle 内容的权威描述，与刚落盘的
字节严格同步。于是 native 不必配 `versionUrl`、不必拼 dispatcher 的 `cdnUrl`、不必防版本表被缓存。
`BundleManager` 的版本解析随之挪到 `ensureLatest` **之后**：
`opts.version ?? updater.versionOf?.(name) ?? versions[name]`——一行覆盖 native 与 web 两条路。

**这两件事必须一次做完**。改造前跑过一次「只开 md5 不改客户端」，真机拿到了活样本：日志报
`bundle 'foundation' 更新 2/2 文件`、设备上确实躺着 54KB 真代码，**而那 54KB 从头到尾没被执行过**
——包内 `bundleVers.foundation` 写死的是出包那天的 md5，引擎按它去取，名字对不上就静默回落包内那份，
不报错。「热更报成功、代码不生效、不报错」比现在更糟。

**base manifest 丢掉 `src/**` 与 AOT 包**（`cck-manifest --md5`）：它们的引用者
`main.js`/`application.<md5>.js` 在产物根、结构性不可热更，下发也没人读，只会白下几 MB 并让
**每次发布 base 版本号必涨**。代价是 **AOT 层只能整包更新**——这与 `boot/` = AOT 的分层定义一致，
要能热修的逻辑本就该放 `foundation`。两个正向副作用：app 戳落在 AOT 包里因此**不可能被热更改动**，
版本闸的这一端不可伪造；`cc.<md5>.js` 不再进 base manifest，「热更换了 cc.js、与包内 `.so` 绑定
签名不匹配」这条老风险随之消失。

**CDN 改叠加式 + 每版归档 `releases/<version>/`**，回滚 = `cck-manifest rollback` 把归档那版的
manifest 配一个**更大**的号发回根，内容文件一个都不重传。两条守卫都是真机换来的：

- **别去注入 `setVersionCompareHandle`**。看起来「不等即更新」能修回滚——实则同一个 handle 还服务
  `loadLocalManifest` 的 `versionGreater`（包内 manifest 比缓存新 → 清旧热更缓存），改了会让
  **新装的 APK 永远被上一版缓存盖住**。查 C++ 时才发现，已在代码里留注释挡住。
- **回滚只能动内容真变了的包**。第一版实现给归档里全部 28 份 manifest 无脑涨号，真机当场 SIGSEGV
  （`AsyncTaskPool` worker → `updateSucceed` → `dispatchUpdateEvent` → JS）：没变的包被判
  NEW_VERSION 而 `genDiff` 是空表。与 `--prev` 同一条不变式——**「版本号变了」必须蕴含「内容真变了」**。

**APK 覆盖安装 / 降级安装**另起一道冷启动对账（`resetCcHotUpdateOnAppChange()`，须早于 kit 装配）：
主包 md5 变了就把 `cck-remote-asset/` + `cck-bundle-asset/` + `<base>_temp/` 整个删掉。引擎自带的
`versionGreater` 只在版本号纪律成立时有效——装了**更旧**的包时包内号更小、缓存反而接管，而
`coreApiHash` 闸此时不会跑（缓存 = 远端 → check 判 up-to-date → 不拉 sidecar）。少了这段，表现就是
「装完新包启动报错，清数据才好」。判据用主包 md5 而非 `coreApiHash`：前者同步可取（app 戳要异步
load，那时还没到），口径也更保守（`coreApiHash` 只描述 core 的 API 面，AOT 业务代码改了它不变）。

**真机 e2e 四条全过**（Android 模拟器）：① md5 包冷启动到 `LoginView` + 长连接；② 改一行 foundation
代码、**只传 CDN 不出 APK** → 重启后新代码真的生效（整条改造的判据），且只有 `foundation.manifest`
涨到 1.0.1、`project.manifest` 原地不动（`--prev` 真正生效）；③ `rollback` 后回到旧代码、旧 md5
文件被 `genDiff` 删掉；④ 覆盖安装 AOT 不同的 APK → 缓存被作废，第二次冷启动**不**误清。
五道门全绿（全仓 708 passed）。决策见 [[adr-0016]]，提案封存于
`docs/design/2026-08-20-native-md5-content-addressing-proposal.md`。
**收尾两件（同日，未真机复验）**：① **base manifest 的 asset 表改为恒空** —— 先前 `--md5` 只滤
`src/**` 与 AOT 包，剩下 `jsb-adapter/{engine,web}-adapter.js` 两条。实测确认它俩与 `libcocos.so`
是同一次引擎构建的两半（`cc.25e81.js` 08-18 11:45 生成、`.so` 11:50，其后三次业务重建 md5 纹丝不动；
`jsb-adapter/*` 停在 07-24 至今没变），机制上 `main.js` 里是裸名、热更目录盖得住，但换它不换 `.so`
就崩在绑定层——「能更但绝不该更」，一并排除。② **引擎指纹闸**（`UpdateInfo.engineHash` /
`AppInfo.engineHash`）：`coreApiHash` 只 hash `packages/core` 的 d.ts，换 Creator 版本或改引擎模块
勾选时**一动不动**，于是老包会照单全收为新引擎编的 JS。判据取 `cc.<md5>.js` 的那段 md5——热更只
下发 JS，要挡的正是「热更来的 JS 用了这个引擎没有的 API」，对应的就是 `cc.js` 的接口面；hash `.so`
反而既要挑 ABI 又要分 debug/release、还读不出 JS API 面变没变。两端各自不可伪造：app 一端由 engine
`engineHash()` 运行时从 SystemJS import map 取（那份 map 属结构性不可热更的一层），更新一端由 tools
`readEngineHash(dataRoot)` 出包期从产物读、写进更新戳；**app 戳文件里没有这个字段**——它生成于
Creator 构建之前，那时产物还不存在。经 `appModule` 的 `deps.engineHash` 注入，接入方零配置。
真实产物验证 `engineHash=25e81`；全仓 **729 passed**（+21），五门全绿。
**收尾第三件：资源归属漂移（同日，未真机复验）**——查 A/B 分层时顺手翻 `cc.config`，发现 6 个皮包
早就是 `deps:["main"]` + `redirect`。根因是 Creator 把**被多包引用的资源判给优先级最高的引用者**
（`resources` 8 > `main` 7 > `foundation` 6 > `shared` 5 > 皮包 1–2），其余包降级成「去那个包拿」。
**归属会漂，而且漂了是静默的**：构建全绿、manifest 正常、热更下发成功，运行时才在 `redirect` 指向
的包里找不到资源。产物里实测到两种漂法：① `boot`（→`main`）与 6 个皮包共用 `default_btn_normal`
→ 图归 `main`。`main` 只随 APK 换，热更下去的皮包引用旧 APK 的 `main` 里没有的 uuid 就炸，**而改的
还不是那个皮包、是 boot**；② 把 boot 的引用挪走后重建，两个马甲的地基皮包同为 priority 2 抢同一张图，
Creator 挑了 `skin-base-foundation` → `skin-vest-lobby`/`skin-vest-mail` 依赖 **base 马甲**的包，
马甲隔离直接破掉（这条推翻了「可热更包之间怎么漂都无所谓」的中途判断）。**修法**（先试了「把内置图
复制进 `resources` + 全工程改引用副本」，被否——多出副本字节、要改 8 个 prefab 的 29 处引用）：
**钉子 prefab** `assets/resources/internal-pin.prefab`，用到的每个内置资源在里面挂一个节点引用一次。
`resources` priority 8 是工程内最高的，归属被它吸走后**谁也抢不动**，而**工程各处照常引用
`db://internal`、一行都不用改**，也不产生副本字节。prefab 是手写的（照 `LaunchOverlay.prefab` 的
`cc.PrefabInfo`/`cc.CompPrefabInfo` schema 逐字段对齐 —— 裸序列化 Node 缺 PrefabInfo 会让编辑器一打开
就崩，见记忆 `cocos-prefab-authoring`），生成脚本带自检：`__id__` 越界、节点缺 `_prefab`、组件缺
`__prefab`、`fileId` 重复各查一遍。重建后 `resources` 自有 7 项、`native/` 下是**原 internal uuid**
的两张 png，`main` 从 8 项降到 3 项，**所有跨包依赖统一指向 `resources`**，跨马甲依赖清零。**两道闸**（tools 新增 `bundle-deps.ts` + 模块文档）：**产物期** `collectBundleDeps` /
`findDepViolations`，`cck-manifest --split` 写 manifest **之前**扫 `deps`/`redirect`，指向共享仓以外
的任何包一律 `exit 1`（`--allow-deps` 供接入方改仓名）；**源码期** `scanAssetRefs` /
`findUnpinnedRefs` + 新子命令 `cck-manifest check-pins --assets <目录>`（本仓第六道门
`pnpm check:pins`，**不用构建**）——`assets/` 下任何资产引用的 uuid 只要不属于本工程（没有对应
`.meta`）就必须也被 `resources/` 引用一次。**两道缺一不可**：产物期漏「外部资源只被一个包引用」
那一类（不产生 `deps`，当场看不出，等第二个包也用它才漂），源码期漏「工程自有资源在多个可热更包
之间共用」那一类（uuid 不算外部）。「外部」用**「工程里没有对应 `.meta`」**判定而不是硬编码
`db://internal`——uuid 里看不出来源，按归属反推既准又自动覆盖别的内置库。四面都验过：真产物 /
真工程通过，造 `deps:["main"]` 的产物被拒，把钉子 prefab 挪走后 `check:pins` 报出 2 个 uuid + 8 处
引用。规则写进 `CLAUDE.md`（① 内置资源在钉子 prefab 里钉一次 ② 共用资源只经 `resources` 这一个仓），
门数从五道改成六道。全仓 **750 passed**（+21），六门全绿。


### 2026-08-18 · coreApiHash 版本闸在正式路径上真正激活

戳的机制 2026-07-29 就落地了，但只在 **probes** 路径上通电；正式启动路径（`boot/Bootstrap.ts`）
一直缺三样，缺哪一样闸都是**静悄悄地放行**——`coreApiHash` 单边缺失恒放行是设计上的容错，
正好把漏装伪装成"通过"：

1. **app 戳没进包**：`stampBundle` 默认 `'main'`，而 `main` 只收「被场景引用到」的资源，
   散落的 JSON 会被丢掉 → 每次启动都打 `[App] app 戳未读到（main/cck-app-compat）→ 闸休眠`。
   现在放 `assets/resources/`（Cocos 内建包、整目录必打进包，且在 tools 的 `DEFAULT_AOT_BUNDLES`
   里 → 归 base manifest，跟 AOT 一起被 base 热更替换，戳因此永远描述"当前生效的那份 AOT"）。
   **不能放 `shared` / `foundation`**：那是热更包，模块级热更就能改掉 app 自称的 hash，闸自己就废了。
2. **更新戳没人生成**：`ccHotUpdateModule` 早就配了 `compatFilename: 'cck-update-compat.json'`，
   但 CDN 上从来没有这个文件 → 拉不到就用裸 `UpdateInfo`（无 hash）→ 又是单边缺失放行。
   现在 `build.mjs` 跟 manifest 一起打，落 `data/` 根同步到 CDN 根，base 与所有分包共用一份。
3. **base 那条路没喂 `AppInfo`**：正式路径只给分包那条注册了 `BUNDLE_UPDATER`（带 `app`），
   base 从没注册过 `HOTUPDATE_SERVICE` → `getHotUpdateService()` 兜底成无参构造 → 闸拿到
   `{ appVersion: '0.0.0' }` 且无 hash。两处注册现在挨在一起。

两枚戳由同一份 `packages/core/dist/index.d.ts` 算出，`build.mjs` 里比一道不等就抛。app 戳的
`version` 会**覆盖** `AppConfig.version`（core 是 `j.version ?? ctx.config.version`），所以取
`build-configs` 里 `packages['cck-build'].version`，空着报错而不是猜——两边必须同源。

**真机双向 e2e PASS**（真 x86_64 模拟器，正式启动路径，单变量只有戳里那串 hash）：

```
装机 1.0.0，app 戳 coreApiHash=45057af6b2af，「app 戳未读到」那行 warn 归零
CDN base 1.0.1，更新戳 hash 改 deadbeef0000 → 启动失败：needFullUpdate —— core API 不兼容，需整包更新
                                              ← 不下载、不重启
恢复 hash                                   → 下载 → restart → 新代码生效
再发 base 1.0.2，重复一遍拒/放行            ← 干净复验（前一轮两个后台任务的 logcat -c 撞了缓冲区）
```

另：ADR-0006 决策 6（`python -m http.server` + `10.0.2.2` 托管）已标作废并补写「修正」节 —— 它被
ADR-0007 取代却一直以「已接受决策」形态躺着，被当可用配方翻出来过不止一次。

### 2026-08-20 · 解开 AOT 热更（L1-A）· 真机 e2e 五条全过

**AOT 层从「只能发 APK」变成「热更下发、重启生效」**，边界落到用户定的那条线上：**AOT 改动重启就
生效，只有引擎指纹变才必须发 APK**。ADR-0016 决策 4 与它「AOT 只能整包更新」那条后果就此被
[[adr-0017]] 取代，其余决策全部有效。

起因是复查 0016 的理由：「下发了也没人读——引用 AOT 的 `main.js` 里写死的永远是出包那天的 md5 名」。
这只对了一半。`main.js` 确实不可热更（它跑在搜索路径还原之前，还原本身就是它干的），但**它是我们
自己的模板**（`build-templates/native/index.ejs`，Creator 3.8 官方覆盖点），那句
`System.import('<%= applicationJs %>')` 是构建期插值、不是引擎硬编码，**而它执行时搜索路径已经还原
完了**。名字写死是我们自己接受下来的，不是结构性的。

**改法四处**。① `index.ejs` 改成读固定名指针 `src/cck-aot.json` 的 `application` 字段；读不到 / 不是
合法 JSON / 指向的文件不存在（半更新）**一律退回包内烘的名字**，不抛——黑屏是最坏结果，退回还能
起来、下一轮 check 会重下。指针**不复用 `project.manifest` 反推**：manifest 说「有哪些文件」、指针说
「从哪进」，是两件事，且 `manifestFilename` 是可配项，接入方改了名启动就断。② `build.mjs` 在 Creator
构建之后、gradle 之前写指针，并把产物**根上**的入口用新增的 `--files` 喂给 manifest（`dirs` 只遍历
`src|assets|jsb-adapter`，够不着根）。③ `contentHashed` 语义翻转：base 从「恒空」变成「只丢
`isEngineBound` 那几类」——`src/cocos-js/**`、`src/effect.bin`、`jsb-adapter/**`（与 `.so` 同一次引擎
构建的两半）与 `src/system.bundle.*.js`、`src/polyfills.*.js`、`src/import-map*.json`（名字写死在
`main.js` 里；`import-map` 还兼任引擎身份凭据，能热更就等于版本闸可伪造，**故意不解**）。
④ 出包侧硬闸：`project.manifest` 里没有入口或没有指针 → 构建失败，否则就是「AOT 热更静默失效」
（构建全绿、下发成功、玩家跑的还是旧代码）。

**一处不改就会自噬**：「APK 换没换」的判据原先取运行时 `settings.bundleVers.main`。AOT 解锁后
`settings` 自己也随热更走了，判据答的就从「APK 换没换」变成「跑的是哪一版 AOT」——每成功热更一次
就翻一次，把刚下好的缓存当成「上一版 APK 攒的」整个删掉，下轮重下再删，**死循环**。改成读 `main.js`
挂的 `window.__cckAotEntry`（构建期插值、属 L0、热更够不着），`packagedAotEntry()` → `aotStamp()`。

**两处语义随之变**，都记进 ADR-0017：① **app 戳 `cck-app-compat.json` 从此可被热更改动**，它描述的是
「当前跑的这套代码的身份」而非「这个 APK 的身份」——这是**必须**的，热更换掉 `chunks/bundle.js` 就是
换掉了 core，戳若冻住，`coreApiHash` 闸会开始拒绝本来正确的模块更新；真正不可伪造的那一端是引擎
指纹（运行时取自 SystemJS import map）。② `assets/{resources,internal}` 都留在 base：resources 是钉子仓
（加一张内置图从此不用发 APK），internal 成本为零（引擎没变时逐字节相同、不产生 diff；引擎变了整个
更新早被指纹闸拒成发 APK），留着只为让 `settings.bundleVers` 指向的目录一定在本地。

**产物**：`project.manifest` 21 项（入口 + 指针 + settings + chunks + `assets/{main,resources,internal}`），
`cocos-js|effect.bin|jsb-adapter|system.bundle|import-map|main.js` 泄漏 0 条。

**真机 e2e 五条全过**（Android x86_64 模拟器，com.cck.demo）：① 干净装 v1 APK → `BUILD_TAG=v1`、
LoginView + 长连接；② **改 boot 层一行、只传 CDN 不出 APK**（1.0.0→1.0.1）→ 下载 →
`AOT 入口取热更版本: ./application.b827c.js` → 重启 → `BUILD_TAG=v2`，**这就是整条改造的判据**；
③ 强杀后冷启动新 PID 仍 v2，且**没有**「热更缓存作废」——换源后的 `aotStamp` 不自噬（不改这条的话
这一步就会把刚下好的缓存删掉）；④ 覆盖装 v2 APK → 作废一次（`AOT b827c`，两个存储根都删），第二次
冷启动**不**再作废；⑤ 连续第二轮 AOT 热更（1.0.1→1.0.2，把标记那行删掉）→ 重启后 `BUILD_TAG` 不再
打印，热更能删代码不只是加。全程无 FATAL / native signal。

六门全绿（全仓 **762 passed**，+12）。提案 `docs/design/2026-08-20-aot-hotupdate-unlock-proposal.md`
标已实施封存，决策见 [[adr-0017]]。

### 2026-08-20 · AOT 启动看门狗（补 L1-A 的洞）· 真机 e2e 两轮十三条全过

复查 [[adr-0017]] 时发现的、**唯一一种玩家自己救不回来**的失败，并当场测实：热更下发的 AOT
起不来（引用了这个引擎没有的符号、文件半损、某类机型上崩），`System.import` 抛在 `main.js` 的
catch 里 —— 而作废缓存的 `resetCcHotUpdateOnAppChange()` 在 Bootstrap 里，**永远轮不到**。

模拟器实测（把缓存里 `application.<md5>.js` 引用的一个引擎成员改成不存在的名字）：进程活着、
JS 侧什么都没起来（黑屏）；连续 3 次冷启动逐字相同；**覆盖装另一个 APK 也救不了**（坏文件在
应用数据里，不随 APK 走）；只有清应用数据才恢复。触发条件比「降级安装」宽得多 —— **APK 一行
没换**，CDN 发了个在某类机型上起不来的 AOT，同样是永久黑屏。0016 时代 AOT 不可热更，这个失败
模式不存在，它是解锁 L1-A 引进来的。

**同一轮还测清了另一场**（原以为是洞，实为自愈）：降级安装两个都带指针的包，缓存里更新的 AOT
会接管第一次启动（`AOT 入口取热更版本` + 跑的是缓存那版），但 Bootstrap 起得来 → reset 用包内
入口名识破 → 删两个缓存根 → **同一次启动里**又重新收敛到 CDN 最新版。代价是一次全量 base 重下，
结果正确。

**改法**（[[adr-0018]]）：`main.js` 加计数器。每次「决定用热更 AOT」就把 `cck.aotTry` +1，
**落盘在 `System.import` 之前**；`resetCcHotUpdateOnAppChange()` 跑到就清 0 —— 那是「这套 AOT
确实起得来」的握手（加载成功 + cc 初始化完 + 场景在跑；再往后的失败不算 AOT 的账，放得更晚会
让一次断网变成「回滚 AOT」）。连续 2 次没清就**隔离**：不还原搜索路径、不认指针、跑包内 AOT，
缓存由 reset 真删（`AssetsManagerEx.create()` 会把 storagePath 前插回来，不删就是包内 AOT 配
缓存里的新模块），并在**删之前**把那份缓存 manifest 的版本号记进 `cck.aotBadVersion`。之后 **base 的 `check()` 见到同号直接当 up-to-date** —— 不记这
一笔就会「隔离 → 重下同一版 → 又隔离」三步一轮地振荡，玩家每三次启动只能玩一次；见到别的号则
说明发布方已翻篇，顺手清掉标记。发布方发个新号即自动恢复。

**首版实现有三处经审查改掉，都属「全绿但真机上几个版本后才发作」那一类**：
① 「是不是 base」原先判 `seed === undefined` —— **随包发 `<bundle>.manifest` 的分包同样没有
seed，那是常态**。而 base 与分包共用同一个 `--version`，于是隔离一次 base 会把**同号的分包一起
永久钉死**在包内版本，`coreApiHash` 闸还救不了（它在这个分支之前就 return 了）。判据改成
`persistKey !== undefined`（只有 base 要把搜索路径写进 localStorage），判定抽成纯函数
`aotQuarantineVerdict` 单测 —— 这条判据搞错本来就该被这种抽法挡下来。
② 版本号原先在 `main.js` 里读，路径硬编码 `HotUpdateSearchPaths` + `project.manifest`；而
`storagePath` 是可配项，接入方改过就读空 → 记不下 → 拦不住重下 → 照样振荡，日志只说一句
「版本号读不到」。挪进 `resetCcHotUpdateOnAppChange()`（它拿的是配置好的 `storagePath`），
`main.js` 因此少一个重复的键。
③ `applicationJs = name` 原先写在计数落盘**之前**，setItem 一抛就成了「用了热更 AOT 却没记上」，
看门狗对这台机器彻底失效而日志说的是「已回退包内」。顺序调过来。
另加：计数读取 `|| 0` 兜 NaN（脏值不再当场误隔离）、模板不再往全局漏 4 个名字、`build.mjs` 出包时
对一次 `cck.aotTry` 两侧字面量（漏改一处 = 握手永不成立 = 每套热更 AOT 跑两次就被隔离，而六门全绿）。

**e2e 两轮**（Android x86_64 模拟器，com.cck.demo）。第一轮验首版六条；改完之后**整条重跑**，
并补了一条专门打 ① 的：

| # | 场景 | 结果 |
|---|---|---|
| ① | 干净装 APK P（包内 1.0.0）→ 热更到 1.3.1（H） | `AOT 入口取热更版本: ./application.eea95.js` → `BUILD_TAG=H` → 进登录页 |
| ② | 弄坏缓存 AOT → 冷启动 1/2 | 两次都 `TypeError … reading 'add'`，黑屏（计数累加） |
| ③ | 冷启动 3 | `热更 AOT 连续 2 次没能起来 → 这次跑包内版本` + `BUILD_TAG=P` + `AOT 被看门狗隔离 → 热更缓存作废：…cck-remote-asset/ …cck-bundle-asset/` + `1.3.1 起不来被隔离过 → 跳过这一版` + 进登录页 |
| ④ | 发布 1.3.2（H2，**同时改了 foundation**）→ 冷启动 | 标记 1.3.1 与新号不符 → 清掉 → 下载 → `BUILD_TAG=H2`。自动恢复 |
| ⑤ | **弄坏 1.3.2 的 AOT → 隔离**（此时 `base` 与 `foundation` 的 manifest **同为 1.3.2**） | **「起不来被隔离过」只出现 1 次**（只有 base）；`foundation` 照常 check 并重下 —— 这正是 ① 那个 bug 的现场，改前会是 2 次、且 foundation 被永久钉死 |
| ⑥ | 冷启动 4 | 稳态：不重下、不振荡、无作废日志，1 秒进登录页 |
| ⑦ | 发布干净的 1.3.3 → 冷启动 | `AOT 入口取热更版本: ./application.7033d.js`，跳过警告 0 次，长连接就绪 + 进登录页 |

全程 FATAL / native signal 0 次。

单测 +10（`aotQuarantined` 逐条边界含「truthy 字符串不算」、`aotQuarantineVerdict` 的
skip/clear/proceed 含**分包一律 proceed**、`manifestVersion` 的坏输入）；
`resetCcHotUpdateOnAppChange` 与 backend 的 `check()` 本体依赖 `native.fileUtils` /
`sys.localStorage`，按 [[adr-0002]] 不进 cc mock，由真机 e2e 兜底。六门全绿（全仓 **772 passed**）。

### 2026-08-21 · 跨包**代码**边的拓扑闸（循环依赖从此不可能出现）

已有的两道闸只看**资源**。Creator 的 `cc.config.deps` **不记脚本依赖** —— demo 实测：
`modules/lobby` 有 4 处 `import '../../foundation/…'`，产物里 `lobby` 的 `deps` 是 `[]`。
于是「地基反过来 import 某个模块」「主包 import 地基的值」这类倒挂、以及任意长的环，
在产物侧那道闸下面**完全隐形**：构建全绿、manifest 正常，等模块被 `release` 掉才炸。
[[adr-0014]] 那条「主包不得 import 地基的任何值」此前也**没有任何门在守**，只靠人记。

**规则：边 `A → B` 合法 ⟺ `priority(B) > priority(A)`。** 排名不另立表，直接用 Creator 的
bundle 优先级（目录 `.meta` 的 `userData.priority`）—— 那个数字本来就在裁决资源归属，
语义就是「谁更底层」，两件事本来就该是同一个旋钮。严格递增 ⇒ 拓扑序天然存在 ⇒
**环不可能出现**，不需要另跑环检测；顺带把「同级互引」（两个模块 / 两个马甲的皮包彼此拽住）
一起拦了 —— 那正是跨马甲资源漂的代码版。

- **新闸 `pnpm check:graph`**（`cck-manifest check-graph --assets`，不用构建）。加 `--mermaid`
  现扫现画拓扑图，图由源码生成、不手工维护，也就不会过期。
- **只认相对 `import`**：`cc` / `@cck/*` / npm 都在 AOT 里，不构成包间边。
  **`import type` 不算边**（编译期擦除）—— 主包拿地基的唯一合法缝 `boot/foundation-api.ts`
  正是靠它，写成值 `import` 当场被拦。动态 `bundle.load()` + `js.getClassByName` 同样不算边，
  它本来就是**故意**绕开静态依赖的。
- **demo 实况**：15 个包、7 条跨包代码边（去重 4 条），全是 `modules/* → foundation`，全绿。
- **二值验证**：往 `assets/` 扔一个 `import { MODULE_CATALOG } from './foundation/catalog'` 的文件
  → `✗ main(7) → foundation(6)` + 退出码 1；删掉 → `✅ 15 个包、7 条跨包代码边`。
- 单测 `bundle-deps.test.ts` 21 → **35 条**（新增拓扑侧 14：`bundleName` 覆盖目录名、最长前缀归属、
  同名前缀不误伤、多行 `import`、`import type` 不算边、倒挂 / 同级 / 未知包、`toMermaid` 去重）。

顺带修掉两处文档失真：**①** `CLAUDE.md` 的「跨包依赖不许指向别处」本意只管**资源**边，
字面上却把合法的 `modules → foundation` 代码边也一起禁了（那条是 [[adr-0014]] 明确允许的）——
已改成「跨包资源依赖」，代码边另立一条拓扑规则；**②** 「钉住的资源随 APK 走、要发版」在
[[adr-0017]] 解开 AOT 热更之后已不成立，改为「跟 AOT 同寿命 = 热更整个 base 并重启」。

### 2026-08-21 · bundle 依赖表 · web 真产物运行期 e2e 全过

单测只证得了 `BundleGraph` 自己；**「地基 boot 装表 → 大厅按表装卸」这条真路子第一次跑起来**：
`build.mjs web-mobile-boot --manifest` 出真产物 → 8082 起页面 → 浏览器逐步驱动（点节点发
`TOUCH_END`，不是调内部函数），每步读 `cc.assetManager.bundles` 对账。

| 步 | 期望 | 实测 |
|---|---|---|
| 启动到登录页 | `APP_CONFIG.shared` 那几个 | `shared · skin-base-foundation · foundation` ✅ |
| 游客登录进大厅 | 表把 `lobby.needs` 一起装上 | 多出 `lobby · skin-base-lobby` ✅ |
| 开邮件（skinned） | 一次 `load('mail')` 连皮包一起 | 多出 `mail · skin-base-mail` ✅ |
| 关邮件 | 两个一起走，`foundation` 不误卸 | 两个都没了、其余原样 ✅ |
| 再开再关一轮 | 引用计数不欠账 | 与第一轮逐字相同 ✅ |
| 开关商城（不换皮） | 只装卸 `shop` | ✅ |
| 进出躲避小游戏（切场景） | `mini-dodge` 装 → 返回时卸 | ✅ |

七轮下来回到启动那五个包，**一个都不多、一个都不少**；全程除 favicon 404 与 WebGL 性能告警外
0 error。关键点是 `skin-base-lobby` / `skin-base-mail` —— `LobbyHost` 里手写装皮包的代码这次
已经删了，它们是**依赖表自己装上来的**。

**未验**：`strict` 抛错那条（表外的包一 `load` 就抛）在真产物里没触发到 —— `getBundleManager()`
是模块内符号，产物里够不着，构造不出「表外的包」的调用点。单测有覆盖。

### 2026-08-31 · 层名统一：AOT 退休，那一层改叫 base 层

**起因**：Unity/HybridCLR 里 AOT dll 指的是**包内不可更新**的那半，而本仓的 `AOT` 自 [[adr-0017]]
起指的恰恰是**能热更**的那层 —— 词义相反，读文档的人一律把它当最底层。

**三个层名定死**：**引擎层**（`libcocos.so` · 引擎 JS · `main.js`，发 APK）→ **base 层**
（业务代码 · `assets/boot` · `main`/`resources`，热更后重启生效）→ **分包层**
（`foundation` · `shared` · `skin-*` · `modules/*`，热更免重启）。

- **代码改名（14 个文件）**：`src/cck-aot.json`→`src/cck-base.json`、`window.__cckAotEntry`→
  `__cckBaseEntry`、`cck.aotTry`/`cck.aotBadVersion`/`cck.aotStamp`→`cck.base*`、
  `aotStamp()`/`packagedAotEntry()`/`aotQuarantined*()`→`base*`、`DEFAULT_AOT_BUNDLES`/
  `--aot-bundles`→`base` 版。
- **ADR 0017/0018/0019 连文件名一起改**，全部路径引用同步修好；**0001 不改** —— 它的 AOT 指
  编译期 tree-shake 裁剪，那是这个词的正确用法。
- **顺带修掉 [[adr-0017]] 之后没跟上的过期陈述**：`bundle-layout` 里 boot「发新包 + 玩家重装」、
  归位判据表整体错位一档、`needFullUpdate` 的括号写着「换不动 AOT chunks / 主包」、协议
  「加一个子游戏要用户重装」、「`main` 只随 APK 换」×3（真实后果是**皮包免重启先到、`main` 要等
  重启**，中间有错配窗口）、ADR-0014 的 ① 行。
- **闸**：`typecheck` / `test`（1009）/ `lint` / `lint:demo` / `check:graph` 全绿，`docs:api` 已重生成。
- **未决**：base 更新与分包共用同一道 `coreApiHash` 闸（`hotupdate-service.ts` / `bundle-updater.ts`），
  于是 **core API 面一变的 base 热更会被自己的闸拒成 `needFullUpdate`**。业务改动不受影响，升 kit 才撞。
  要不要给 base 只留 `engineHash` 闸，待定。
- **顺手改掉撞名**：demo 默认马甲原来也叫 `base`，与新层名撞车 → 马甲改名 **`default`**：
  `skins/base/` → `skins/default/`、三个皮包 `skin-base-*` → `skin-default-*`（目录 `.meta` 的 `bundleName`）、
  `build-configs/*.json` 与 `app-config.ts` 的 `vest` 默认值、`scripts/prefab-gen/skin-base-*.prefab.json` 文件名、
  以及 core/tools 里拿它当例子的注释与单测。demo 现在两个马甲：`default` 与 `vest`。
  ⚠️ 改了目录名与 `bundleName`，**Creator 下次打开要重建 `library/`**，`build/` 里的旧产物作废。

**真机 e2e PASS**（2026-08-31，x86_64 模拟器 `fortune_test`，干净装机，正式启动路径）：

```
装 1.3.4（包内 BUILD_TAG=v1）
  [cck] APK 换了（base ccd65） → 热更缓存作废          ← packagedBaseEntry/baseStamp 新名字生效
  [CCK-BOOT] BUILD_TAG=v1 · skin='default'
  skin-default-foundation.manifest 基址取服务端下发     ← 马甲改名后皮包真按新名取到
  长连接就绪 · 0 崩溃
CDN 发 1.3.5（只有 project.manifest 涨号，其余 15 个包沿用旧号 ← --prev 生效）
  hotupdate 0→100% → [cck] base 入口取热更版本: ./application.3acdc.js   ← 固定名指针 src/cck-base.json 从热更目录读到
  → BUILD_TAG=v2
force-stop 冷启动
  仍走 application.3acdc.js → BUILD_TAG=v2 · 无「隔离」「缓存作废」  ← 搜索路径还原 + 看门狗握手都成立
撤掉标记发 1.3.6 → 再更新一次 → application.bcede.js → 长连接就绪，全程 0 FATAL
```

判据说明：**改名这件事只有真机能证**——`cck.baseTry` 的两处字面量由 `build.mjs` 对账，但
「`main.js` 那半还念不念得对 `src/cck-base.json`」只有装到机器上才知道。上面第二段的
「base 入口取热更版本」就是它，第三段的冷启动排除了「靠内存里的 setSearchPaths 蒙对」。

⚠️ CDN 上留着一批 `skin-base-*.manifest`（改名前的皮包）—— 客户端不再问它们，按「只叠加绝不清空」
的规矩不删（删了会打断回滚到旧 release）。


## 模块状态

| 批次 | 模块 | 包 | 状态 | 设计文档 | commit |
|---|---|---|---|---|---|
| 骨架 | monorepo（pnpm workspace + vitest + lint 依赖约束） | 根 | 已实现（4/4 验收；demo 消费 core + engine 均在真 cc 3.8.7 验证，见 ADR-0003/0004） | `docs/design/modules/monorepo-scaffold.md` | — |
| 1 地基 | DI 容器 / ServiceLocator | core/engine | 已实现（core 半 22 测试, 覆盖 100%/branch 95.6%；**engine 半 `KitContext`（cc.Node 场景树绑定：懒建作用域 + `of`/`resolve` 根兜底 + `provide` + `onDestroy` dispose 级联）已落地，静态四门全绿；真机 gameView 预览验证 PASS**（回退/shadow/of/根兜底 + onDestroy→dispose 级联双 smoke 全绿），按 ADR-0002 不 mock 单测走真机） | `packages/core/docs/modules/di-container.md` | — |
| 1 地基 | EventBus（类型安全） | core | 已实现（19 测试, 覆盖 100%） | `packages/core/docs/modules/eventbus.md` | — |
| 1 地基 | Logger（`ILogger`） | core | 已实现（13 测试, 覆盖 100%/branch 97%） | `packages/core/docs/modules/logger.md` | — |
| 1 地基 | ITimer 抽象 | core | 已实现（21 测试, 覆盖 100%） | `packages/core/docs/modules/timer.md` | — |
| 1 地基 | Bootstrap 启动流程（组合根 `boot`/`coreModule` + engine `bootCoreKit`/帧驱动） | core/engine | 已实现（core 20 测试覆盖 100% + engine 11 测试；**engine 半 cc-logger/director 帧驱动/组合根已在真 cc 3.8.7 预览验证**） | `packages/core/docs/modules/bootstrap.md` | — |
| 启动 | App（启动序列编排 + 热更闸 + 失败分类） | core/engine | 已实现（core 14 测试：默认序列按 phase 执行 / 失败三分类 / `retry` 从失败步续跑 / 闸拒不加载 lobby / 自定义 steps 插队 / native `ready`→restart+`halt` / web 版本表→`setVersions`；engine 半 `appModule`（平台 `restart`：native `game.restart` / **web 必须 `location.reload()`** + 注册 `BUNDLE_RELOADER`），只造不跑、`launch()` 由调用方在订阅挂上后发起，`stop` 注销 `APP`+自己注册的 `BUNDLE_RELOADER` 好让 `shutdown()` 后能重新 boot）；启动界面样例见 demo `LaunchOverlay.ts`（kit 只出事件）；四门全绿；**web-mobile 真构建 + 浏览器 e2e PASS**：`platform→hotupdate→shared→demo-i18n→lobby→running` 全程 0 error）；**未做** `pendingRestart`（无真实消费方，见模块文档「与提案的偏差」） | `packages/core/docs/modules/app.md` · `docs/adr/0009-bundle-layering-criterion.md` | — |
| 1 地基 | 测试脚手架 + `cc` mock | 根/engine | 已实现（vitest 随骨架；cc mock 单一真源 tsconfig paths + vitest alias，见 ADR-0002） | `docs/adr/0002-engine-test-strategy-capped-cc-mock.md` | — |
| 2 设施 | AssetManager（`IAssetLoader`） | core/engine | 已实现（core 半 30 测试 100%[含加载途中拆 scope 三条 + 按值释放三条]；**engine 半 `IAssetSource` cc 实现 + `ccAssetModule` 接入，四门全绿，真机 gameView 预览已验证：registered=true + 真加载 JsonAsset 全字段**） | `packages/core/docs/modules/asset-manager.md` | — |
| 2 设施 | BundleManager（按需分包 + 回收契约 + 脚本失效） | core/engine | 已实现（core 29 测试：BundleManager 19[引用计数+inflight 去重+失败回滚+**`setVersions` 版本表**] + **`BundleScope` 10**[回收顺序 `closeByBundle`→逆序 teardown→`release`、幂等、单条失败不阻断、i18n 按精确键];**`IBundleReloader`** 接缝；**engine 半 `createCcBundleSource`+`ccBundleModule` + `invalidateBundleScripts`**（清 `System[REGISTRY]`+`registerRegistry` 两张表 + `js.unregisterClass`，**仅版本变化时清**），四门全绿；真机 gameView 已验 load/release 全生命周期 + 具名 bundle 内加载资源；**web-mobile 真构建 e2e 已验免重启换代码**（`classSwapped:true`、0 报错、整页未重载）与版本不变不误清缓存） | `packages/core/docs/modules/bundle-manager.md` · `docs/adr/0010-no-restart-bundle-code-swap.md` | — |
| 2 设施 | UIManager（层级/注册表/变体） | core/engine | **v2 已实现**（core 34 测试；10 档固定层枚举定 z 序[ADR-0008]、`registerUI` 注册表 + 变体 resolver（整包换皮 / 横竖屏换 view）、按需重建 + `saveState` 状态保持、`CCKUIView` 界面契约、层→相机层映射带回退 + 子树 layer 归一、**`closeByBundle`**（按当前变体解析，`BundleScope.dispose` 的第一步，免重启换 bundle 的正确性前提）；四门全绿；**浏览器预览端到端实测 0 error**：10 层容器按序建全 / 注册表驱动 open / 转屏真换 `Shop→Shop_land` / 未登记变体的界面转屏零重建 / close 回收）| `packages/core/docs/modules/ui-manager.md`（现状）· `docs/adr/0008-fixed-ui-layer-enum.md` · 提案封存于 `docs/design/2026-07-31-ui-manager-v2-proposal.md` | — |
| 2 设施 | SceneFlow（流程状态机） | core/engine | 已实现（core 半，21 测试, 覆盖 100%/branch 95.9%；**engine 半 `loadScene`/`preloadScene`（director promisify），四门全绿，真机验证错误路径（未知场景优雅 reject），真切场景待第二场景**） | `packages/core/docs/modules/sceneflow.md` | — |
| 2 设施 | SaveManager（`IStorage`） | core/engine | 已实现（core 半，22 测试, 覆盖 100%/branch 98.6%；**engine 半 `IStorage` cc.sys.localStorage 实现 + `ccStorageModule`，四门全绿，真机预览验证全生命周期（存/取/列/删）**） | `packages/core/docs/modules/save-manager.md` | — |
| 2 设施 | ObjectPool | core | 已实现（11 测试, 覆盖 100%） | `packages/core/docs/modules/object-pool.md` | — |
| 2 设施 | AudioService（`IAudioService`） | core/engine | 已实现（core 半，24 测试, 覆盖 100%；BGM 单轨+双音效路径+三档音量/静音实时下发；**engine 半 `IAudioPlayer` cc.AudioSource 实现 + `ccAudioModule`，四门全绿，真机验证 DI 接入（`AUDIO_PLAYER registered`+playOneShot 不抛），真出声待 audioClip 资产**） | `packages/core/docs/modules/audio-service.md` | — |
| 2 设施 | i18n 多语言 | core/engine | 已实现（core 半，18 测试, 覆盖 100%；**engine 半 `loadLocaleTable`+`setupLocalePersistence`，四门全绿，真机验证真加载翻译表 JSON（拍平+插值）**；字体切换随项目 onChange） | `packages/core/docs/modules/i18n.md` | — |
| 2 设施 | ConfigTable（Excel→JSON） | core/tools/engine | 已实现（core 半，14 测试, 覆盖 100%；**engine 半 `loadTable`（JSON 经 AssetLoader 加载 → register），四门全绿，真机验证真加载配表数组**；Excel→JSON 走 tools） | `packages/core/docs/modules/config-table.md` | — |
| 3 进阶 | HotUpdateService（线上热更统一入口） | core/engine | 已实现（**native 走内容寻址**：`md5Cache` + 版本从 bundle 自己的 manifest 反推 + CDN 叠加式发布/归档回滚 + APK 覆盖安装作废旧缓存，见 [[adr-0016]]；**base 层经固定名指针 `src/cck-base.json` 可热更、重启生效，只有引擎指纹变才发 APK，见 [[adr-0017]]；起不来的 base 由启动看门狗退回包内并隔离那一版，见 [[adr-0018]]，三轮真机 e2e 十八条全过**；core 半，25 测试, 覆盖 100%；统一状态机 + 版本兼容闸[钩子+安全默认] + 进度/重试；**engine 半 `native.AssetsManager` 后端 + `sys.isNative` 守门 `ccHotUpdateModule`，四门全绿，真机验证 web 守门 no-op + `check()=up-to-date`；**native 真更新全流程已真机 e2e 验证（真 Android APK：check→download→apply→restart，`BUILD_TAG` v1→v2，见 ADR-0006）**；出包期 manifest 生成/校验已由 tools `hot-update-manifest` 提供） | `packages/core/docs/modules/hotupdate-service.md` | — |
| 3 进阶 | Network / 协议层（`INetwork`） | core/engine | 已实现（core 半，28 测试, 覆盖 100%；连接状态机+请求关联[seq 经 codec]+自动重连[退避]+心跳+推送路由，调度注入 ITimer；**engine 半 `createWebSocketSocket` + `ccNetworkModule`（Web/native WebSocket，重连 identity 卫），四门全绿，真机 gameView 验证 `NETWORK_SOCKET registered=true` + 真 echo 端到端往返 OK（连 jmalloc/echo-server，request/seq 回显闭环）**） | `packages/core/docs/modules/network.md` | — |
| 3 进阶 | ECS 扩展（bitECS 接入范例，不进 core） | ecs-bitecs | 已实现（pin `bitecs@0.3.40`；`export * from 'bitecs'` 全套 + 薄 kit 胶水 `createEcsWorld`/`createEcsRunner`[秒制 `world.time` + `tick(dt)` 每帧驱动接缝]；6 测试全绿含**ITimer.onFrame 驱动 runner** 的 kit 接入证明；四门全绿[全仓 369]、`dist` 33KB 自包含[tsup noExternal 打进 bitecs]；**demo cc 渲染场景[大量 agent 移动]留后续**——需玩法 + 真机验证，本包纯逻辑已 node 全测不阻塞） | `packages/ecs-bitecs/docs/modules/ecs.md` | — |
| 3 进阶 | ECS spatial（寻路/碰撞/群体避让 高性能 system 组） | ecs-bitecs | 已实现（5 system + 4 规范组件：`SpatialHash`/`FlowField`/`seek`/`flowFollow`/`separation`/`collision`/`movement`/`spatialIndex`；全 hand-roll 零第三方[不上物理引擎/navmesh/ORCA/yuka]，纯 SoA·node 可测；**ORCA 不做**[单向 swarm 无对穿礼让]；10 测试全绿[结构+系统+集成 pipeline]，四门全绿[全仓 379]；**独立 Cocos Creator 工程渲染验证留下一步**） | `packages/ecs-bitecs/docs/modules/spatial.md` | — |
| 3 进阶 | reactive（MVVM 数据绑定：响应式原语 + 绑 cc 节点） | core/engine | 已实现（core 半 10 测试全绿[signal/computed/effect/untracked，自动依赖追踪+幂等 setter+动态依赖+清理+菱形收敛]；engine 半 `bindText`/`bindProp`/`bindEditBox`/`bindToggle`+`BindingScope`，四门全绿[全仓 363]；**engine 半真机 gameView 预览验证 PASS**[代码化 UI smoke：改 signal→Label/active 自动刷，dispose 后冻结]） | `packages/core/docs/modules/reactive.md` | — |
| 渲染骨架 | camera-rig（kit 常驻相机组）+ resolution（横竖屏锁短边适配） | engine | 已实现（纯决策逻辑 `render-policy.ts` **零 cc**、20 测试全绿[含 `computeCameraCenter` 3 条回归]；cc 薄壳 `camera-rig.ts`/`resolution.ts` 按 ADR-0002 决策 3 不进 mock，靠 `tsc -b` 官方真类型 + demo 预览验证；四门全绿[全仓 410]；**apps/demo Game View 预览实测 0 error**：跨 `loadScene` 常驻渲染 / 场景内 `RenderRoot2D` 被常驻相机按 layer 渲染 / `Widget` 满屏锚定 三项 PASS，**转屏与 `claimClear` 两项待真机**） | `packages/engine/docs/modules/camera-rig.md` | — |
| 工具 | hot-update-manifest（热更清单生成/校验） | tools | 已实现（`buildManifest`/`toVersionManifest`/`writeManifests`/`verifyManifest`/**`buildSplitManifests`（`--split`/`--prev`/`--md5`）**/**`archiveManifests`+`rollbackManifests`（`archive`/`rollback` 子命令，回滚只动内容真变了的包）** + CLI `cck-manifest`，格式对齐 Cocos 官方 `version_generator.js`，纯 node 零 cc，四门全绿；remote-assets 本地托管走 filebrowser CDN） | `packages/tools/docs/modules/hot-update-manifest.md` | — |
| 工具 | config-excel（Excel→JSON 配表转换） | tools | 已实现（9 测试 + bin 冒烟；`rowsToTable`(纯)/`parseWorkbook`/`excelToJson` + CLI `cck-excel`，4 行表头约定[名/类型/注释/数据]，exceljs 读[本仓首个依赖，tsup external]，输出裸行数组对齐 config-loader；四门全绿） | `packages/tools/docs/modules/config-excel.md` | — |
| 工具 | compat-stamp（出包期打戳/校验） | tools | 已实现（10 测试 + 真 bin 冒烟；`computeCoreApiHash`(剥注释 d.ts 表面 hash)/`writeStamp`/`verifyCompat` + CLI `cck-manifest stamp`/`verify-compat`，纯 node 零 cc，四门全绿；首版 hash 级）；**运行时读入已闭环**（app 戳→AppInfo、更新戳 sidecar→UpdateInfo，真机 e2e 兼容放行+不兼容拦截双向 PASS，闸激活，ADR-0007） | `packages/tools/docs/modules/compat-stamp.md` | — |

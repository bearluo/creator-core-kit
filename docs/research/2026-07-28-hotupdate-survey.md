---
状态: 草案（评审中）
摘要: 横评 Cocos 3.8 线上热更（native jsb.AssetsManager + manifest / Web·小游戏远程 bundle 版本化），为 HotUpdateService 定统一入口形状、core↔engine 拆分、版本绑定安全策略（承 ADR-0001）与可测接缝。
何时读: 设计线上热更/补丁下载/版本校验/断点续传/失败回滚，或质疑相关选型时。
日期: 2026-07-28
依赖: docs/adr/0001-cross-bundle-singleton-and-aot-hotupdate.md（AOT 缺代码 + 版本绑定）, docs/research/2026-07-24-cocos-bundle-aot-probe.md（实证）, packages/core/docs/modules/bundle-manager.md（运行时分包）, packages/core/docs/modules/sceneflow.md（状态机同构参照）
---

# HotUpdateService（线上热更统一入口）横评

## 目的与范围

CLAUDE.md「三种热」里，**线上热更(hotfix)** 由 `HotUpdateService` 统一入口：原生走官方 `jsb.AssetsManager` + manifest；Web/小游戏走远程 Asset Bundle 版本化加载。（另两热——运行时按需分包已由 [[bundle-manager]] 落地；开发期热重载走 vitest watch，非本模块。）本横评产出：

- Cocos 3.8 原生 `jsb.AssetsManager` 热更机制**事实基线**（manifest 格式、状态事件、restart）；
- 三平台差异（native / Web / 小游戏）与统一入口的抽象边界；
- **承 ADR-0001 的安全策略**：AOT 缺代码危险 → 版本绑定校验必须进热更流程；
- 设计候选 + 倾向建议，并列出待拍板分歧。

> 铁律约束：统一编排/状态机/版本策略进 `core`（可 node 单测）；`jsb.AssetsManager`、文件 IO、`game.restart()`、bundle 版本加载等一切平台行为经 `IHotUpdateBackend` 接缝下沉 `engine`。

## 一、Cocos 3.8 原生事实基线（native）

- **`jsb.AssetsManager`**（仅原生 jsb 环境有）：给定 `manifestUrl` + 本地缓存路径构造，`checkUpdate()` 比对本地/远程 manifest → 事件回调状态：`NEW_VERSION_FOUND` / `ALREADY_UP_TO_DATE` / `ERROR_*`；`update()` 下载差量文件 → 事件 `UPDATE_PROGRESSION`（byte/文件进度）/ `UPDATE_FINISHED` / `UPDATE_FAILED` / `ERROR_DECOMPRESS` 等；失败可 `downloadFailedAssets()` 重试仅失败项。
- **manifest**：`project.manifest`（全量：version + packageUrl + remoteManifestUrl + remoteVersionUrl + `assets:{path:{md5,size,compressed?}}`）+ `version.manifest`（仅版本头，先拉它比版本，省流量）。**diff 由 AssetsManager 内部算**（按 md5），业务不手动 diff。
- **应用更新**：下载完写入可写目录（`writablePath`）→ 需 **`game.restart()`** 或重启 App 让新脚本/资源生效；并把新版本搜索路径 `setSearchPaths` 置顶（引擎示例模板 `assets/scripts/HotUpdate` 有标准写法）。
- **断点/失败**：AssetsManager 自带缓存与 `downloadFailedAssets` 重试；并发下载数 `setMaxConcurrentTask`。

## 二、三平台差异与统一边界

| 平台 | 机制 | 能力 |
|---|---|---|
| **native**（Android/iOS/Windows） | `jsb.AssetsManager` + manifest | 差量下载脚本+资源、写可写目录、`game.restart` 生效 |
| **Web**（含 web-mobile） | 无 jsb；靠**远程 Asset Bundle 版本化**（`assetManager.loadBundle(url, {version})`）+ CDN 缓存刷新 | 换 bundle 版本即“热更”；主包/AOT 不可换（刷页面加载新 index） |
| **小游戏**（微信/抖音等） | 各家有**分包/远程包**机制，主包受平台管控走平台发版；资源/子包可远程版本化 | 类 Web：远程 bundle 版本化；主包更新走平台审核 |

**统一入口的现实**：native 是“真差量脚本热更”，Web/小游戏多是“远程 bundle 版本切换”。`HotUpdateService` 统一 **check → download(progress) → apply → (restart | reload)** 语义，平台差异塞进 `IHotUpdateBackend` 实现。

## 三、承 ADR-0001：AOT 缺代码 → 版本绑定校验

`bundle-aot-probe` 实证（Q4）：把引用了「已被旧主包 AOT tree-shake 裁掉的 API」的新 bundle 挪到旧主包上 → **跑到调用点才 `TypeError` 崩**，隐蔽。ADR-0001 对策之一是**热更包与主包版本绑定校验**：core API 版本号/hash 不匹配则**拒绝加载**该更新，宁可提示“请更新客户端”也不让它跑到一半崩。

⇒ **HotUpdateService 必须内建版本兼容闸**：apply 前校验远程 manifest 声明的 `minAppVersion`/`coreApiHash` 与当前一致，不匹配 → 拒绝、报“需整包更新”。这是本模块**最有价值的可测 core 逻辑**之一（纯比对，脱引擎单测）。

## 四、姊妹/开源框架

- **oops-framework / 官方 tutorial-hot-update**：都直接包 `jsb.AssetsManager` + 标准 manifest 流程 + `game.restart`；进度/状态转 UI。**印证**统一状态机 + 事件转 UI 是标配；差异在有无跨平台统一与版本校验。
- **godot-core-kit**：Godot 用 PCK/ZIP `ProjectSettings.load_resource_pack` 挂载补丁包；对标点=“下载补丁→挂载→生效”的统一编排（我们的状态机）。

## 五、设计候选 + 建议

- **候选 A（瘦 core 半 + engine backend）**：core 持**统一更新状态机 + 版本校验策略 + 重试/进度归一**，经 `IHotUpdateBackend` 下沉平台实现（native 包 AssetsManager、web 包 bundle 版本加载）。优点：编排/策略脱引擎可测、三平台一个 API；缺点：native AssetsManager 自身已有状态，core 状态机是其上的编排层（薄）。**倾向此**（与 [[sceneflow]] 同构）。
- **候选 B（纯 engine）**：整个塞 engine 直接驱 AssetsManager。放弃跨平台统一与可测版本策略。表格现状标 engine，但与铁律「逻辑可测」相悖，尤其版本校验值得可测。

> 倾向 **候选 A 瘦 core 半**：状态机 + 版本闸 + 重试策略在 core（可测），`IHotUpdateBackend` 做平台 IO。

## 五·补：版本兼容的「出包期 ↔ 运行时」两半契约（2026-07-28 补，用户提出）

版本闸只是**运行时执行**；兼容性真正**在出包期被决定**，需 `packages/tools`（`manifest 生成`）配套一个构建脚本，两半互补：

- **打戳（必需）**：出**整包/app** → 算 `coreApiHash`＝core 公共 API 表面 hash（即 ADR-0001「强引用白名单」符号表），写进 app（运行时 `local.coreApiHash`）；出**热更包** → 把「针对哪个 core API 表面构建」写进远程 manifest（`remote.coreApiHash`）+ 声明 `minAppVersion`。**无打戳则运行时闸无值可比。**
- **出包期主动校验（可选但强）**：出热更包时 diff「本包引用的 core API 集合」vs「线上主包 AOT 实际保留集合」，引用被裁符号 → **build fail**（把 Q4 的线上隐蔽崩溃提前到 CI），ADR-0001「强引用白名单」由被动转主动。

⇒ 运行时 core 半（本次实现）的 `coreApiHash` / `minAppVersion` 字段就是这份契约的**对接点**，设计不变。构建脚本是 **tools 层独立交付物**（待 tools 包搭建，第 3 批后或随热更接入），本模块运行时半不含它。归入下方待办。

## 六、待拍板分歧

| 编号 | 分歧 | 选项（含倾向） |
|---|---|---|
| Q-H1 | core/engine 拆分 | 瘦 core 半（状态机+版本闸，候选 A，推荐）／纯 engine（表格现状） |
| Q-H2 | 版本绑定校验（ADR-0001） | 内建强制版本闸，apply 前不匹配即拒（推荐，安全）／只暴露钩子交上层决定 |
| Q-H3 | 首版平台范围 | 抽象覆盖三平台、先只实 native backend（推荐，Web/小游戏 backend 随需）／只做 native 不抽象 |

拍板后出 `packages/core/docs/modules/hotupdate-service.md` 定稿 → TDD。

---
状态: 已接受
日期: 2026-07-29
依赖: docs/adr/0001-cross-bundle-singleton-and-aot-hotupdate.md, docs/adr/0006-native-android-build-and-hotupdate-e2e.md, packages/tools/docs/modules/compat-stamp.md, packages/core/docs/modules/hotupdate-service.md
---

# ADR-0007：coreApiHash 版本闸激活（兼容戳运行时读入）+ filebrowser 固定链接托管

## 背景

ADR-0001 定「AOT 缺代码 → 版本绑定」；hotupdate 版本闸（`createSemverVersionGate`）据 `coreApiHash`/`minAppVersion` 判热更能否安全应用。但此前这俩字段**只有产生侧没有消费侧**：tools 的 [[compat-stamp]] 能出戳（`computeCoreApiHash` + 兼容戳），可运行时 `AppInfo.coreApiHash` 恒缺省（`0.0.0`、无 hash）、engine native 后端的 `UpdateInfo` 也不带 `coreApiHash`——闸对 coreApiHash **单边缺失恒放行 = 休眠**。要让闸真正生效，必须把戳**读进运行时**。

另，ADR-0006 决策 #6 当时为省事用「宿主 `python -m http.server` + 模拟器 `10.0.2.2`」托管远端资源；但这不是真 CDN 路径（临时进程、无固定 URL、真机够不到），[[hot-update-manifest]] 决策 #8 早已提名本机常驻 filebrowser（固定分享链接）为正选。本 ADR 一并把托管切到 filebrowser 并实证。

## 决策

1. **app 侧戳读入 → `AppInfo`**：app 戳（`cck-manifest stamp` 出的 `{version, coreApiHash}`）作为 **`resources/` 资产**随包（`apps/demo/assets/resources/cck-app-compat.json`）；运行时经 `AssetLoader` 加载 → 构造 `AppInfo{appVersion, coreApiHash}` → `container.register(HOTUPDATE_SERVICE, createHotUpdateService({app}))` 覆盖默认。缺戳则退回默认 `AppInfo{appVersion:'0.0.0'}`（闸休眠、不阻断）。属 app 集成层（demo 落地），与 main.js 搜索路径还原同类。
2. **update 侧戳读入 → `UpdateInfo`**：engine native 后端 `check()` 在 `NEW_VERSION_FOUND` 时，用 `am.getRemoteManifest().getPackageUrl() + compatFilename` 拉**更新戳 sidecar**（`cck-update-compat.json`，XMLHttpRequest），把 `coreApiHash`/`minAppVersion` **并进 `UpdateInfo`**；拉不到就用裸 `UpdateInfo`（闸放行，不因 sidecar 缺失阻断正常热更）。经 `CcHotUpdateOptions.compatFilename` **opt-in**（不设不拉，无谓 404）。
3. **sidecar 独立文件、不塞进 manifest**：`native.AssetsManager` 的 `Manifest` JS 绑定只暴露 `getVersion`/`getPackageUrl`/`getSearchPaths` 等固定方法，**读不到 manifest 里的自定义字段**；故 `coreApiHash` 走**旁挂 JSON**（backend 自己 XHR 拉），不硬塞进 project/version.manifest。
4. **远端托管切 filebrowser 固定分享链接**（**取代 ADR-0006 #6 的 http.server**）：`E:\fileserve\creator-core-kit\cdn` 建一次分享（hash `shCo8WNE` 永久固定），`packageUrl` = `http://<host>:8081/api/public/dl/shCo8WNE/`；manifest / 更新戳 / assets 全托管其下，覆盖即发布、URL 不变。见 skill `filebrowser-cdn`（本次补了「热更 CDN 实操」节）。

## 理由

- **实证 PASS**（2026-07-29，真 x86_64 模拟器，同一 v1 APK 二分）：
  - **兼容案**：`app 戳读入 coreApiHash=fc033ce4c4a7` → `check()=update-available, info.coreApiHash=fc033ce4c4a7`（sidecar 已并入）→ 从 filebrowser 下 19021B 差量 → `ready` → restart → `BUILD_TAG=v2`；重启后 check 收敛 `up-to-date`。
  - **不兼容案**：远端更新戳 hash 改 `deadbeefcafe`（≠app），**同一 app/APK** → `check()={"kind":"rejected","reason":"core API 不兼容，需整包更新","needFullUpdate":true}`，**不下载、不重启、停 v1**。
  - 二分只由远端戳的 coreApiHash 决定 → 闸从休眠**真正激活**、行为正确。
- **app 戳走 resources 资产 > 原生文件读**：跨平台（web/native 一致 `AssetLoader`）、随 Creator 构建自动纳入、免碰原生工程；appVersion/coreApiHash 出包期由 tools 产、运行时只读。
- **update 戳走 sidecar XHR > 塞 manifest**：绕开 AssetsManager 不透传自定义字段的硬限制；opt-in + 拉不到降级，零侵入正常热更。
- **filebrowser > http.server**：固定 hash 链接（真 CDN 语义）、绑 `0.0.0.0` 局域网/Tailscale/真机全通（模拟器实测直达 `172.25.50.135:8081`）、常驻免起进程；对齐姊妹项目 [[godot-core-kit-reference]] 既有实践。

## 后果

- **正面**：ADR-0001 的 coreApiHash 安全闸**首次端到端生效**（放行 + 拦截双向实证）；「三种热」之线上热更的版本兼容闭环补齐产生→读入→判定全链；filebrowser 热更托管路径首次被真实跑过并登记（registry `shCo8WNE`）。
- **代价 / 约束**：
  - app 侧戳读入落在 **demo 集成层**（`DemoBoot`），非 engine 通用原语——生产项目须自行在启动流程读戳并注册 service（同 main.js 还原属 app 集成约定）。需要时可上提为 engine helper。
  - update 侧每次 check 多一次 sidecar HTTP 往返（仅 `compatFilename` 设时）；拉取失败静默降级为放行（**故意**：不因兼容元数据缺失阻断正常热更）。
  - **hash 级**兼容：只判 API 表面变没变；符号级「引用了哪个被裁符号」仍未做（[[compat-stamp]] Open Q1，运行时闸兜底）。
  - filebrowser host 段（`172.25.50.135`）随 DHCP 变，hash 段永久固定；烘进 APK 的 `packageUrl` 跨网络/真机宜用 Tailscale IP。
- **落地锚点**：app 戳 `apps/demo/assets/resources/cck-app-compat.json`（`{1.0.0, fc033ce4c4a7}`）/ 更新戳 sidecar `cck-update-compat.json` / engine 选项 `CcHotUpdateOptions.compatFilename='cck-update-compat.json'` / filebrowser 分享 `shCo8WNE` → `http://172.25.50.135:8081/api/public/dl/shCo8WNE/` / 里程碑行 `🏷️ app 戳读入`、`check()=update-available|rejected`。

---
状态: 已接受
日期: 2026-07-28
依赖: docs/adr/0002-engine-test-strategy-capped-cc-mock.md, packages/core/docs/modules/hotupdate-service.md, packages/tools/docs/modules/hot-update-manifest.md
---

# ADR-0006：原生 Android 构建 + 热更（hot-update）真机 e2e 验证机制

## 背景

HotUpdateService（core 半）+ `ccHotUpdateModule`（engine 半 `native.AssetsManager` 后端）+ `cck-manifest`（tools 半 manifest 生成）三块都已落地，但**最后一环——native 真更新全流程（下载 → setSearchPaths → restart → 加载新代码）——编辑器 gameView 预览跑不到**（`sys.isNative=false`，触不到 `native.AssetsManager`）。ADR-0002/0005 与 hotupdate 模块文档都把它挂在「待原生构建 + manifest 服务器端到端」。

要验证就得**首次真出一个原生 Android APK**：本机此前从未跑过 Cocos 原生构建（无 `native/`、无 NDK 工具链），且 Cocos Creator 3.8 的**原生构建触发 API 无公开文档**（builder 消息名靠探测）。这条 ADR 固化探明的可复现机制，省未来维护者重蹈。

## 决策

1. **原生构建程序化触发，复用运行中的编辑器**：走 builder 的 `add-task` 消息（`Editor.Message.request('builder', 'add-task', options)` → 返回 taskId，`query-tasks-info` 轮询状态）。**不用 CLI `--build`**——编辑器已开着同项目，CLI 另起实例会撞单实例锁。经 funplay MCP `execute_editor_script` 调，天然复用当前编辑器进程、无锁冲突。（探明：3.8.7 builder 只暴露 `add-task`/`query-task`/`query-tasks-info`/`remove-task`/`open`，无 `build`/`query-*-options`。）
2. **NDK/SDK/JDK 路径直填任务 options，绕开全局偏好设置**：android 平台 hook `generateOptions` 找不到路径会早失败（`找不到 Android NDK/SDK 路径`）。任务 options 的 `packages.android.{sdkPath, ndkPath, javaHome}` 直填绝对路径即越过，不必去「偏好设置 → 外部程序」配全局。
3. **ABI = x86_64**：目标模拟器 `fortune_test` 是 x86_64（Windows 主机上 x86_64 镜像原生跑最快）。Cocos 3.8 模板 `gradle.properties` 明列 `x86_64` 为可用 ABI，故 `appABIs: ['x86_64']` 直接原生编译，**不靠 ARM 转译**。（真机 arm64 需另打 `arm64-v8a`。）
4. **热更 `manifestUrl` 用裸文件名 `'project.manifest'`**：把 `project.manifest`/`version.manifest` 放构建产物 `data/` 根（= APK 内 `assets/` 根 = fileUtils 默认搜索路径），`native.AssetsManager.create('project.manifest', …)` 直接解析到。**不走官方「导入 `.manifest` 资产取 `nativeUrl`」**——data 根本就是搜索路径，裸名更省一层。
5. **main.js 启动还原手动注入**：原生 `data/main.js` 顶部（引擎/资源加载前）加读 `localStorage['HotUpdateSearchPaths']` → `jsb.fileUtils.setSearchPaths(...)`。**冷启动（进程被杀重开）必需**；`game.restart()` 同进程热重启因 apply() 已在内存 setSearchPaths，即便不还原也能加载新版本。demo 为验证便宜**直接改生成物**；**生产应放 `build-templates/android/data/main.js`** 使其存活于每次 Creator 构建。
6. **远端资源托管走宿主 http server + 模拟器 `10.0.2.2`**：模拟器 user-net 网关 `10.0.2.2` 映射宿主 loopback，起个 `python -m http.server` 绑 `0.0.0.0:<port>` 即被模拟器直连，**免 CDN / 免鉴权**（比 filebrowser 更轻，验证够用）。Cocos 3.8 android 模板 `AndroidManifest.xml` 默认 `android:usesCleartextTraffic="true"`，HTTP 明文开箱可用，无需改网络安全配置。

## 理由

- **实证 PASS**（2026-07-28，真 x86_64 模拟器）：同一 APK 内 `BUILD_TAG` `v1`→`v2` 跃迁（`game.restart()` 同进程 PID 不变）——check `update-available` 1.0.1 → 下载 1 文件（`assets/main/index.js`，md5 差量）→ apply → restart → v2 代码接管，7 项判定信号全按时序命中、无崩溃。
- **程序化 add-task > CLI**：复用运行中的编辑器，规避二实例锁；且 funplay MCP 已在链路里，一次调用即触发 + 轮询，无需另起进程。
- **路径填 options > 配全局**：可复现、无副作用、不污染机器全局设置；CI/换机照跑。
- **x86_64 原生 > arm 转译**：模拟器上原生指令集，稳定不依赖转译层。
- **裸 manifestUrl > nativeUrl 导入**：少一步资产导入 ceremony，且 kit 的 `ccHotUpdateModule({ manifestUrl })` 契约本就吃字符串路径，裸名直接兑现。

## 后果

- **正面**：native 热更端到端闭环验证建立，「三种热」之线上热更在真机跑通；本 ADR + hotupdate 模块文档「native 真机 e2e 验证」节构成可复现 runbook；证明 `cck-manifest` 的 manifest 格式与 `native.AssetsManager` 差量下载兼容。
- **代价 / 约束**：
  - demo 的 main.js 还原改在**生成物**（`build/android/data/main.js`），Creator 重构建会覆盖——验证便宜但非持久；生产迁 `build-templates`（本 ADR 决策 5 已注明）。
  - 出的是 **x86_64 debug APK，只对模拟器**；上真机（arm64）须 `appABIs` 加 `arm64-v8a` 重打。
  - 构建产物 `build/`、`native/` 走 `.gitignore`（生成物，不入库）；可复现靠本 ADR 的步骤，不靠留存二进制。
  - 首次构建工具链（JDK17 + NDK r23c + build-tools 34 + cmake 3.22.1）为一次性机器准备，非仓库资产。
- **落地锚点**：包名 `com.cck.demo` / 主 Activity `com.cocos.game.AppActivity` / APK `apps/demo/build/android/proj/build/demo/outputs/apk/debug/demo-debug.apk` / 验证信号 = logcat `[CCK-DEMO]` 前缀（Cocos native 转发 JS console 到 logcat）/ 热更锚点 `BUILD_TAG = vN`。

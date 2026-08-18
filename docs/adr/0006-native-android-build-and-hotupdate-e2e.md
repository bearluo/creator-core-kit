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
6. ⚠️ **~~远端资源托管走宿主 http server + 模拟器 `10.0.2.2`~~ —— 已作废，见文末「修正（2026-08-18）」，托管一律走 filebrowser（ADR-0007）**：~~模拟器 user-net 网关 `10.0.2.2` 映射宿主 loopback，起个 `python -m http.server` 绑 `0.0.0.0:<port>` 即被模拟器直连，**免 CDN / 免鉴权**（比 filebrowser 更轻，验证够用）。~~Cocos 3.8 android 模板 `AndroidManifest.xml` 默认 `android:usesCleartextTraffic="true"`，HTTP 明文开箱可用，无需改网络安全配置（**这半句仍有效**）。

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

## 补充（2026-08-05）：决策 2 的 options 形状——`apiLevel` 必须是数字

`packages.android.apiLevel` 传 **`34`（数字）**，不是 `'android-34'`（字符串）。传字符串时 Creator 照样"构建成功"，但生成的 `proj/gradle.properties` 里 `PROP_COMPILE_SDK_VERSION=NaN` / `PROP_MIN_SDK_VERSION=NaN`，随后 gradle 在 `app/build.gradle:10` 的 `PROP_COMPILE_SDK_VERSION.toInteger()` 上炸 `For input string: "NaN"`——**报错点离病根很远**，且 data 产物是好的、只有原生工程坏，容易误判成工具链问题。

一次可用的完整 options（从 `apps/demo/profiles/v2/packages/android.json` 的 `builder.taskOptionsMap` 里取历史成功那条最省事，编辑器每次构建都会把实际用的 options 存在那儿）：

```json
{"packageName":"com.cck.demo","apiLevel":34,"appABIs":["x86_64"],
 "orientation":{"portrait":true,"upsideDown":false,"landscapeRight":false,"landscapeLeft":false},
 "useDebugKeystore":true,"appBundle":false,"androidInstant":false,
 "sdkPath":"…","ndkPath":"…","javaHome":"…",
 "resizeableActivity":true,"maxAspectRatio":"2.4",
 "renderBackEnd":{"vulkan":false,"gles3":true,"gles2":true},"swappy":false,
 "keystorePath":"","keystorePassword":"","keystoreAlias":"","keystoreAliasPassword":"",
 "inputSDK":false,"remoteUrl":"","javaPath":""}
```

## 修正（2026-08-05）：决策 5 的持久化路径

决策 5 当时留的待办写「生产应放 `build-templates/android/data/main.js`」——**路径不对**，实测的正确落点是：

```
apps/<项目>/build-templates/native/index.ejs
```

平台目录是 **`native`**（原生三平台共用一份，不是按 `android`/`ios` 分），且**不带 `data/` 那层**；覆盖的是**渲染 `main.js` 的 ejs 模板**而不是渲染结果 —— Creator 内置模板在 `<Creator>/resources/resources/3d/engine/templates/native/index.ejs`，官方文档也只把 `index.ejs` 列进 native 的可覆盖模板。用 ejs 而非直接丢一份成品 `main.js` 的好处：Creator 升级时内置模板的变更会同步过来，不至于捧着一份越来越旧的 fork。

实测（2026-08-05，同一套 add-task 机制）：产物 `build/android/data/main.js` 4112 字节（默认模板 840 字节），注入块在最顶、`<%= systemJsBundleFile %>` 等占位符正常渲染，`build success in 12 s`。

**并补跑了 2026-07-28 那次没做的一步——杀进程冷启动**（由该模板打出的 24.9 MB debug APK，真 x86_64 模拟器）：

```
PID 6157  BUILD_TAG=v1 → check update-available 1.0.1 → 下 53898 字节 → ready → game.restart() → BUILD_TAG=v2
PID 6321  am force-stop 后冷启动          → BUILD_TAG=v2，check()=up-to-date（读的是可写路径那份 1.0.1 manifest）
PID 6551  再断掉远端托管冷启动            → BUILD_TAG=v2，check() 优雅 error 不崩
```

PID 变化是判据：`game.restart()` 同进程重启靠的是内存里已生效的 `setSearchPaths`，验不到还原逻辑；只有全新进程里仍是 v2，才证明 `index.ejs` 那段在引擎起来之前真的跑了。第三次断网冷启动排除「其实是又下了一遍」。全程无 FATAL / native signal。

顺带修掉一个静默陷阱：`apps/demo/.gitignore` 的裸 `native` 与根 `.gitignore` 的 `**/native/` 会把 `build-templates/native/` 一并吞掉（本该只忽略 Creator 生成的原生工程目录），已分别锚成 `/native/` 和 `/apps/*/native/`。

决策 5 的其余部分（还原逻辑的作用、冷启动才必需、`game.restart()` 不依赖它）不变。

## 修正（2026-08-18）：决策 6 作废——托管一律走 filebrowser，别再起 `10.0.2.2` 那套

决策 6 当时图轻，用「宿主 `python -m http.server` + 模拟器 `10.0.2.2`」托管热更内容。**这条路已被 [ADR-0007](0007-compat-stamp-runtime-readin-and-filebrowser-hosting.md) 取代**，那次只在自己的正文里写了切换，没回头把这里标掉——结果它继续以「已接受的决策」形态躺着，被当成可用配方翻出来过不止一次。这一节把它钉死。

**为什么不能再用**（不是「有更好的」，是这四条各自都会让验证结果失真）：

| 症状 | 后果 |
|---|---|
| `python -m http.server` 默认绑 `127.0.0.1` | **只有模拟器够得着**（靠 `10.0.2.2` 网关映射）；真机、Tailscale 一律拉不到，验的不是真实链路 |
| 临时进程、端口随手挑 | 每次验证重起、URL 每次都变；而 `packageUrl` 是**烘进 APK** 的，URL 一变整个包作废 |
| `10.0.2.2` 只在模拟器 user-net 里有意义 | 烘进 APK 的地址换到真机就是死地址，且**没有任何报错**，表现为「热更静默不生效」 |
| 本机 `python` 是 Windows Store 存根 | 直接 exit 49、零输出，排查成本远超它省下的那点事 |

**正确做法**：本机常驻 filebrowser（`172.25.50.135:8081`，见 skill `filebrowser-cdn`），对内容目录建**固定分享**，base URL 形如：

```
http://172.25.50.135:8081/api/public/dl/<hash>/
```

hash 永久不变 → 可以放心烘进 APK；绑 `0.0.0.0` → 模拟器 / 真机 / Tailscale 全通；服务随 Docker Desktop 自启 → 不用起进程。本仓的分享是 `/creator-core-kit/cdn`，hash `shCo8WNE`。

⚠️ **URL 形态错了会 `200` + HTML，不是 404。** filebrowser 只在 `/api/public/dl/<hash>/` 下发文件，其它任意路径（`/cdn/`、`/share/<hash>`…）都回 SPA 首页，**状态码照样 200**。客户端「下载成功」，写下一个 HTML，直到解析才炸 `readFile failed!` —— 探活只看 status code 会一路绿灯。**判据是 `Content-Type: application/octet-stream`，不是 200。** 2026-08-18 服务端下发的 `cdn_url` 正是踩这个（[server-core-kit#1](https://hlgit.5518game.com/luohao/server-core-kit/-/issues/1)）。

**另：`10.0.2.2` 的其它出现处也多半是同期遗留。** 比如 `http://10.0.2.2:9200/` —— `9200` 是 server-core-kit **gateway 的 admin 面**，跟热更托管无关；而且 gateway 早已迁到 dev139、admin 面**设计上只在容器内监听**，所以那个地址两头皆空。要调 admin 面走
`ssh dev139 "docker exec server-core-kit-gateway-1 wget -qO- --post-data='{}' http://127.0.0.1:9200/admin/retire"`（镜像无 curl）。

决策 6 里唯一仍然有效的是最后半句：Cocos 3.8 android 模板默认 `usesCleartextTraffic="true"`，HTTP 明文开箱可用，不必改网络安全配置。

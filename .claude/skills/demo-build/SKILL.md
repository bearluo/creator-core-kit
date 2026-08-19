---
name: demo-build
description: Use when building the demo app for Android or web — producing build/android/data, an APK, a web-mobile bundle with its hot-update version table, or switching the launch scene or vest. Runs Cocos Creator headlessly from a checked-in config instead of clicking through the build panel.
---

# 出 demo 的包（Android / web）

```bash
cd apps/demo
node scripts/build.mjs boot                     # Creator 构建，起始场景 Boot（正常启动链路）
node scripts/build.mjs boot --manifest --apk    # 完整一条龙：构建 → 热更 manifest + 同步 CDN → APK
node scripts/build.mjs boot --vest vest --apk   # 换马甲
node scripts/build.mjs web-mobile-boot --manifest  # web：构建 → 版本表 → 叠加部署到 webDir
```

**配置名就是参数**（`build-configs/<name>.json`）；`boot` 另有一条兼容回退，仍找得到
`android-<name>.json`。`--apk` 只对 native 平台有意义，对 web 直接报错。

每次构建都会先打 **app 兼容戳**（`assets/resources/cck-app-compat.json`，版本闸的本地一端），
`--manifest` 时再打一枚**更新戳**（`cck-update-compat.json`，随内容同步到 CDN）。两枚 hash 同源，
不等就当场抛。`--min-app-version <v>` 给更新戳加一道「要求 app 版本 ≥ 此」。
app 戳里的 `version` 取 `build-configs` 里 `packages['cck-build'].version`，**空着直接报错**——
它会覆盖运行时的 `AppConfig.version`，两边必须同源。

`--manifest` 夹在 Creator 构建和 gradle **之间**，基址与同步目录取 `local.json` 的
`cdnUrl` / `cdnDir`；版本号默认 `1.0.0`，`--manifest-version 1.0.1` 可改（做增量热更测试时用）。

**web 平台下 `--manifest` 换成另一套**：出 `cck-versions.json`（bundle → md5 的版本表）并把产物
**叠加**到 `local.json` 的 `webDir`。⚠️ **叠加、不清空**——老页面还引用着上一版的
`index.<旧md5>.js`，删了就把线上会话打断了（native 那边相反，是清空重拷）。
web 配置必须 `md5Cache: true`，关着 `bundleVers` 是空的、生成版本表会当场报错。

**出包前会挡一道 `@cck/*` dist 陈旧**：出包吃的是 dist 不是 src，dist 旧了只会打出一个「改的代码
没生效」的包，而且两枚戳都从同一份陈旧 dist 算、闸完全无感。报错会直接给出
`pnpm -F @cck/core build`。

配置在 `apps/demo/build-configs/`（见那儿的 `README.md`）：`android-<name>.json` 存**构建意图**、进 git，
叠加 `local.json` 存**本机路径**、gitignore。第一次在一台新机器上跑要
`cp build-configs/local.example.json build-configs/local.json` 再改里面的路径。

`packages['cck-build']` 那段是自家构建插件注入 `settings.json` 的打包期常量
（`vest` / `appId` / `version` / `channel` / `env` / `dispatcherUrl`），字段清单与运行时怎么读
见 [`apps/demo/docs/build-plugin.md`](../../../apps/demo/docs/build-plugin.md)，选型经过见
[`docs/research/2026-08-17-creator-build-custom-options.md`](../../../docs/research/2026-08-17-creator-build-custom-options.md)。

**别再走构建面板**：面板里的任务是按时间戳堆积的历史记录（`profiles/v2/packages/builder.json`），
`profiles/` 又进不了 git，所以每次都得手改一遍起始场景——固化配置就是为了消掉这件事。

## 装机验证

```bash
adb uninstall com.cck.demo                # 验热更/启动链路要干净装，别 install -r
adb install -t build/android/proj/build/demo/outputs/apk/debug/demo-debug.apk
adb logcat -c && adb shell monkey -p com.cck.demo -c android.intent.category.LAUNCHER 1
adb shell sleep 30 && adb logcat -d -v brief | grep -E "CCK-BOOT|CCK-NET|\[cck\]"
```

启动链路正常应依次出现：`platform → dispatch → hotupdate → shared → [CCK-NET] 长连接就绪`。
网关侧对照 `ssh dev139 "docker logs --since 2m server-core-kit-gateway-1"`。

热更内容由 `--manifest` 一并出（底层是 `packages/tools` 的 CLI，基址取 filebrowser 的固定分享，
见 skill `filebrowser-cdn`）。要造「包内一版、CDN 另一版」的增量热更场景，就分两次跑：
先 `--manifest --apk` 出包，再改内容后 `--manifest --manifest-version 1.0.1` 只更新 CDN。
第二次跑时 `--prev` 会自动指向同步目录（也就是刚出包那一版），**只有真改了的包涨版本号**——
所以看到 15 个包里只有一两个变成 1.0.1 是对的，全变才是错的（见下「坑」）。

## 坑（都是实测踩出来的，别重蹈）

- **命令行构建不读 Creator 的偏好设置。** SDK/NDK/JDK 路径在 GUI 下来自「偏好设置 → 外部程序」，
  命令行模式下拿不到，缺了就在 `android:onAfterInit` 报「找不到 Android NDK/SDK 路径」。所以
  `local.json` 是必需的，不是可选优化。
- **构建失败时退出码仍是 0**，日志里成功和失败也都只打一行 `Finished in (…)`。脚本的判据是
  `data/src/settings.json` 的 mtime 有没有变——别改成 grep 日志措辞。
- **Creator 开着也能跑**（会另起一个独立实例，只在 `temp/logs/project.log` 上报个无害的 EPERM）。
  但两个实例共用 `library/`、`temp/`，构建时别同时在编辑器里改资源。
- **`startScene` 只认 uuid，填 url 会静默回退。** 传 `db://assets/boot/Boot.scene` 这种 url
  既不报错也不生效，Creator 直接用**项目当前的默认起始场景**——配置写着一个场景、出来的包却从
  另一个启动，而且日志里那行 `"startScene":"<uuid>"` 看着一切正常。配置文件里仍写 url（可读、可 review），
  由 `scripts/build.mjs` 查 `<场景>.meta` 换成 uuid 再交给 Creator。
- **起始场景路径以 `assets/main/cc.config.json` 的 `scenes` 为准。** Boot 在 `db://assets/boot/Boot.scene`；
  构建配置里可能还留着早期的 `db://assets/scenes/Boot.scene`，填错的表现是运行时
  `Can not load the scene … because it was not in the build settings before playing`。
- **改了 native-only 的引擎模块要重编 `libcocos.so`。** `websocket`/`video`/`webview` 这类在
  项目设置→功能裁剪里勾选后，会改 `proj/cfg.cmake` 的 `USE_SOCKET` 等编译宏，gradle 那步要全量
  重编引擎（十几分钟、`libcocos.so` 400MB 级）。**Creator 的「构建」只生成工程，不编 native**——
  只点构建不跑 gradle 的话，装上去的还是旧 so，症状是勾了模块却依然不生效
  （踩过一次：`typeof WebSocket === 'undefined'`，长连接连 SYN 都发不出去）。
- **内容没变的包不许涨版本号，涨了客户端 SIGSEGV。** `AssetsManagerEx` 在 worker 线程算 diff，
  遇`diffMap.empty()`（资产表一致、只有版本号不同）就地 `updateSucceed()` → `UPDATE_FINISHED`
  在非主线程进 JS VM → `se::AutoHandleScope` 崩。所以生成 manifest **必须**带 `--prev`（已做进
  `build.mjs`，指向 `local.json` 的 `cdnDir`）。别手工绕开 `build.mjs` 直接敲 CLI 而漏掉它。
  症状：日志停在「基址取服务端下发」后 ~90ms 就 `Fatal signal 11`，栈顶是
  `AssetsManagerEx::updateSucceed()` → `dispatchUpdateEvent` → `se::AutoHandleScope`。
- gradle 那步用 `shell: true`：Node 20 起（CVE-2024-27980）不再直接 exec `.bat`，少了它抛 EINVAL
  且 stdout 为空，看着像「gradle 没输出」。

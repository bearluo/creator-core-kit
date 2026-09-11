# 固化的构建配置

一份配置 = 一种**构建意图**（主要是起始场景）。放在这里是为了不再每构建一次就在 Creator 面板里
新堆一个任务、手改一遍起始场景——面板里的任务列表（`profiles/v2/packages/builder.json` 的
`BuildTaskManager.taskMap`）是按时间戳堆积的**历史记录**，不是可复用预设，而且 `profiles/` 进不了 git。

| 文件 | 起始场景 | 用途 |
|---|---|---|
| `android-boot.json` | `db://assets/boot/Boot.scene` | 正常启动链路：dispatch → hotupdate → shared → 登录（**`md5Cache: true`**，见下） |
| `web-mobile-boot.json` | `db://assets/boot/Boot.scene` | 同上，出 web 产物（**`md5Cache: true`** —— web 的热更靠 `index.<md5>.js` 换文件名，关了就没有版本可言） |

## 两个平台都开 `md5Cache`

内容寻址（`index.<md5>.js`）是热更的地基，不是可选优化：**同名不同内容**意味着 CDN 只能 no-store、
回滚要重新出包、老客户端正在拉的文件会被新版本抽走。开了之后新旧天然共存，CDN 可以 immutable 缓存，
回滚只需把旧 manifest 重新发一遍。

native 侧多两件配套事，`scripts/build.mjs` 已经做进流程，改配置前先知道：

- **客户端加载 bundle 时必须显式传 version**，且这个 version 从**刚更新完的那份 manifest** 反推
  （core 的 `bundleVersionFromAssetKeys`）。包内 `settings.bundleVers` 写死的是出包那天的 md5，
  热更后拿它去取会 404 后**静默回落包内旧代码**——热更报成功、代码没生效、还不报错。
- **base manifest 只丢引擎绑定的那几类**（`cck-manifest --md5`）：`src/cocos-js/**`、
  `src/effect.bin`、`jsb-adapter/**`（与 `libcocos.so` 是同一次引擎构建的两半）与
  `src/system.bundle.*` / `src/polyfills.*` / `src/import-map*`（名字写死在 `main.js` 里）。
  **base 整条链照发**，`main.js` 改读固定名指针 `src/cck-base.json` 拿入口名（ADR-0017），
  所以改 `assets/boot` 只要热更 + 重启，不必发 APK。

怎么用见 skill `/demo-build`（两条路：Creator 面板导入，或关掉编辑器走命令行）。

## 改了 `appABIs` 记得同步 `gradle.properties`

`appABIs` 只在 Creator **生成**原生工程时写进 `build/android/proj/gradle.properties` 的
`PROP_APP_ABI`。工程目录已经存在时，后续构建**不再回写**——配置里写着 `x86_64`、实际出的却是
上一次留下的 `arm64-v8a`，而且**构建全绿、装也装得上**，只在启动那一刻死：

```
nativeloader: ... library_path=.../lib/arm64:.../base.apk!/lib/arm64-v8a
com.cck.demo: Unexpected CPU variant for x86: x86_64
（进程随即消失，logcat 里没有 FATAL）
```

换 ABI 时**两处一起改**：`build-configs/<名字>.json` 的 `appABIs`，加上
`build/android/proj/gradle.properties` 的 `PROP_APP_ABI`（后者在 `build/` 下、不进 git，改它没有副作用）。
彻底一点就删掉 `build/android/proj` 让 Creator 重新生成。

本机模拟器是 **x86_64**、真机（含云真机）是 **arm64-v8a**，所以这个坑在「本机测完拿去真机跑」
和「真机跑完回来测本机」两个方向上都会踩到。

⚠️ 另一条相邻的坑：**只跑 `./gradlew assembleDevDebug` 不重跑 Creator 构建是不行的**。
少了 Creator 那一步，APK 里的 `assets/` 是旧的甚至不完整，运行时报
`Failed to require file 'main.js', not found!`。要重出包就整条 `build.mjs ... --apk` 走一遍。

## 两个平台都开 `sourceMaps`，`.map` 出包时立刻搬走

开它是为了让**线上**那条崩溃能还原回源码行（只给 debug 包开等于白开——后台收到的是 release 的堆栈）。
代价是 `.map` 会躺在产物里，而产物同时走**三条**路出去：热更包、**APK**（gradle 把 `data/` 整个塞进
assets）、**web 目录**（`cpSync` 全量拷）。所以 `build.mjs` 在「Creator 构建完成」之后**第一件事**就是
`cck-manifest stash-maps`，把 `.map` 全搬到 `local.json` 的 **`mapsDir`**，搬完原地复扫、还剩就抛。

> ⚠️ **`mapsDir` 必须在对外服务的目录之外**，别放 `cdnDir` / `webDir` 底下——那两个是公开的
> （实测 CDN 那条分享链翻得到 `releases/`）。开了 `sourceMaps` 却没配 `mapsDir` 会**直接报错**，
> 不静默把源码留在产物里。归档布局是产物相对路径原样镜像，还原用
> `cck-manifest symbolicate --maps <mapsDir> < 堆栈原文`（决策见 hlgit #54）。

留在下发 js 末尾的那行 `//# sourceMappingURL=…` **故意不动**：抹它要重写每个 js，而产物名是 Creator
按内容算出来的，改了字节文件名就跟自己的内容对不上。玩家照那个名字去 CDN 拿只会得到 404。

## 只写构建意图，不写本机路径

`sdkPath` / `ndkPath` / `javaHome` / `keystorePath` **一律不写进这些文件**——它们来自 Creator 的
全局偏好设置（项目里的 `profiles/v2/packages/android.json` 存的就是空串），写死会让别人的机器构建失败。
Creator 会用偏好设置里的值补齐缺的字段。

同理不写 `logDest`、`buildEngineParam`、`cocosParams` 这类编辑器内部字段——面板「导出配置」吐出来的
那一大坨里绝大多数是构建期算出来的，存下来只会过期。

**服务端地址同理，也只住 `local.json`。** 入库的那几份配置里 `packages.cck-build` 的
`dispatcherUrl` / `accountLoginUrl` 一律留空（= 跟随源码默认值，而源码默认值一律 `127.0.0.1`）；
本机连哪台服务器写进 `local.json`：

```jsonc
"packages": {
  "cck-build": {
    "dispatcherUrl": "http://<你的服务器>:9100/api/Handshake",
    "accountLoginUrl": "http://<你的服务器>:9103/api/Login"
  }
}
```

`build.mjs` 把 `local.json` **深合并**进构建配置，所以这两个键会盖掉入库配置里的空串。
⚠️ **真机 / 模拟器上 `127.0.0.1` 指的是设备自己**——连本机服务必须填局域网 IP。
字段全表见 [`docs/build-plugin.md`](../docs/build-plugin.md#字段)。

### 预览怎么连远端服务器：转发端口，别改源码

**编辑器预览不走构建流程**（见 `assets/boot/build-config.ts`），`local.json` 那条链对它无效，
跑的就是源码里的 `127.0.0.1`。服务在别的机器上时，**在本机把那几个端口转过去**：

```bash
pnpm tunnel             # 前台起隧道，Ctrl+C 停
pnpm tunnel --dry-run   # 只打印将要执行的 ssh 命令，不连
```

要多配的只有一个字段 —— `local.json` 顶层的 **`tunnelHost`**（`~/.ssh/config` 里的别名，或
`user@host`；要免密先 `ssh-copy-id`）。**端口不用另配**：脚本从同一份文件里已有的
`dispatcherUrl` / `accountLoginUrl` 现解析，加服务端地址时只改那一行，转发自动跟上，
不会出现「加了服务忘了加转发」。地址已经指向 `127.0.0.1` 时它会说「不需要隧道」直接退出。

隧道在的时候 `127.0.0.1` **就是**那台服务器，编辑器预览 / 浏览器预览 / `pnpm test` 的
`e2e-server.test.ts` 一起生效，源码一个字都不用改（实测：`/healthz` 200，全量测试从
`1288 passed | 2 skipped` 变成 `1290 passed`）。Windows 上想免掉常驻窗口可以改用
`netsh interface portproxy add v4tov4 …`，**那条要管理员**，换来的是一次配置永久有效。

> ⚠️ `tunnelHost` 必须在 `scripts/build.mjs` 的解构里被吃掉 —— `local.json` 剩下的顶层键是
> **整个**塞进 Creator 构建配置的，漏了它就会跟着进构建配置。

**不要为此改源码默认值**——改了迟早误提交，而它同时是开源用户 clone 下来的默认值。
**也不要走 Creator 的项目设置 / 自定义宏（`cc/userland/macro`）**：那些存在
`settings/v2/packages/*.json`，是**入库**的，地址照样被提交上去；只有 `profiles/` 不入库，
而它是编辑器个人偏好、运行时读不到。五条通道横评见
[`docs/research/2026-08-17-creator-build-custom-options.md`](../../../docs/research/2026-08-17-creator-build-custom-options.md)。

## 加一份新配置

文件名**就是** `build.mjs` 的参数（`node scripts/build.mjs web-mobile-boot`）；`android-` 前缀的那两份
另有一条兼容回退，`build.mjs boot` 仍然找得到 `android-boot.json`。

复制一份改 `platform` / `startScene` / `taskName` 即可，并在上面的表里补一行。**起始场景路径以
`assets/main/cc.config.json` 的 `scenes` 为准**（Boot 场景在 `assets/boot/` 下，不是 `assets/scenes/`——
后者是早期路径，构建配置里可能还留着旧值，填错运行时会报
`Can not load the scene ... because it was not in the build settings before playing`）。

`startScene` 这里写 `db://` 开头的 url，`scripts/build.mjs` 会查 `<场景>.meta` 换成 uuid 再交给
Creator——**Creator 自己只认 uuid，直接喂 url 不报错但也不生效**，会悄悄用项目当前的默认起始场景。

马甲（`packages.cck-build.vest`）不另存一份配置：它是正交维度，配置数量会翻倍。
换马甲走 `/demo-build` 的参数覆盖。

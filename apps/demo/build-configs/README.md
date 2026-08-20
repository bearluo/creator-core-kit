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
  **AOT 整条链照发**，`main.js` 改读固定名指针 `src/cck-aot.json` 拿入口名（ADR-0017），
  所以改 `assets/boot` 只要热更 + 重启，不必发 APK。

怎么用见 skill `/demo-build`（两条路：Creator 面板导入，或关掉编辑器走命令行）。

## 只写构建意图，不写本机路径

`sdkPath` / `ndkPath` / `javaHome` / `keystorePath` **一律不写进这些文件**——它们来自 Creator 的
全局偏好设置（项目里的 `profiles/v2/packages/android.json` 存的就是空串），写死会让别人的机器构建失败。
Creator 会用偏好设置里的值补齐缺的字段。

同理不写 `logDest`、`buildEngineParam`、`cocosParams` 这类编辑器内部字段——面板「导出配置」吐出来的
那一大坨里绝大多数是构建期算出来的，存下来只会过期。

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

# 固化的构建配置

一份配置 = 一种**构建意图**（主要是起始场景）。放在这里是为了不再每构建一次就在 Creator 面板里
新堆一个任务、手改一遍起始场景——面板里的任务列表（`profiles/v2/packages/builder.json` 的
`BuildTaskManager.taskMap`）是按时间戳堆积的**历史记录**，不是可复用预设，而且 `profiles/` 进不了 git。

| 文件 | 起始场景 | 用途 |
|---|---|---|
| `android-boot.json` | `db://assets/boot/Boot.scene` | 正常启动链路：dispatch → hotupdate → shared → 登录 |
| `android-probes.json` | `db://assets/probes/Demo.scene` | 引擎适配层验证探针（不走 App 启动编排） |

怎么用见 skill `/demo-build`（两条路：Creator 面板导入，或关掉编辑器走命令行）。

## 只写构建意图，不写本机路径

`sdkPath` / `ndkPath` / `javaHome` / `keystorePath` **一律不写进这些文件**——它们来自 Creator 的
全局偏好设置（项目里的 `profiles/v2/packages/android.json` 存的就是空串），写死会让别人的机器构建失败。
Creator 会用偏好设置里的值补齐缺的字段。

同理不写 `logDest`、`buildEngineParam`、`cocosParams` 这类编辑器内部字段——面板「导出配置」吐出来的
那一大坨里绝大多数是构建期算出来的，存下来只会过期。

## 加一份新配置

复制一份改 `startScene` 和 `taskName` 即可，并在上面的表里补一行。**起始场景路径以
`assets/main/cc.config.json` 的 `scenes` 为准**（Boot 场景在 `assets/boot/` 下，不是 `assets/scenes/`——
后者是早期路径，构建配置里可能还留着旧值，填错运行时会报
`Can not load the scene ... because it was not in the build settings before playing`）。

`startScene` 这里写 `db://` 开头的 url，`scripts/build.mjs` 会查 `<场景>.meta` 换成 uuid 再交给
Creator——**Creator 自己只认 uuid，直接喂 url 不报错但也不生效**，会悄悄用项目当前的默认起始场景。

马甲（`packages.cck-build.vest`）不另存一份配置：它是正交维度，配置数量会翻倍。
换马甲走 `/demo-build` 的参数覆盖。

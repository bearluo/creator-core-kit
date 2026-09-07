---
状态: 活文档
摘要: demo 的 Android 原生侧怎么按渠道组装 —— 一张 `channels.json` 表驱动 gradle productFlavor 与能力目录，`--channel` 一个参数同时喂 JS 常量和 gradle 任务名。含出包命令、加渠道 / 加能力的步骤、以及哪些闸挡得住哪些错。
何时读: 要接一家原生 SDK、加一个渠道、加一种能力（支付 / 广告），或看到「某个渠道的 SDK 没生效」时。
依赖: [[adr-0021]] 渠道 SDK 走 productFlavor · [[adr-0022]] 能力是渠道的属性 · [[adr-0023]] 不装 Crashlytics plugin 的两个前提 · [`crash-reporting.md`](../../../packages/core/docs/modules/crash-reporting.md)
---

# 渠道与原生 SDK 组装

## TL;DR

**两个正交维度，别混**：

| | 换它改什么 | 归谁 | 出包参数 |
|---|---|---|---|
| **马甲 `vest`** | 只换脸（prefab / 图集 / appId） | Cocos 构建配置 | `--vest <马甲>` |
| **渠道 `channel`** | 换 SDK（aar / 权限 / Java 胶水） | gradle productFlavor | `--channel <渠道>` |

```bash
node scripts/build.mjs boot --vest vest --channel qq --apk
#                            └ 脸               └ 既写进 cck-build.channel，又拼成 assembleQqDebug
```

## 一张表驱动三处

`native/engine/android/channels.json` 是**唯一真源**：

```json
{
  "channels": {
    "dev":    { "report": "logcat" },
    "qq":     { "report": "bugly" },
    "google": { "report": "firebase" }
  }
}
```

读它的三处：

1. **`app/build.gradle`** —— `JsonSlurper` 读回来，按表建 flavor、按表把能力目录 `+=` 进各 flavor 的 `srcDirs`。
2. **`scripts/build.mjs`** —— 校验 `--channel` 是不是表里的值（拼错当场报，而不是等 gradle 抛「task not found」），并把它写进 `cck-build.channel`。
3. **`pnpm check:channels`** —— 比对表与目录，见下面「闸」。

表**不写在 groovy 里**就是为了让后两处读得到；给三处各存一份必然漂。

## 目录长什么样

```
native/engine/android/
├─ channels.json                        ← 表
└─ app/src/
   ├─ com/cocos/game/AppActivity.java   ← main，所有 flavor 都有
   ├─ dev/     qq/                      ← 各渠道**独有**的东西（这两个现在是空的）
   ├─ google/res/values/firebase.xml    ← Firebase 的配置，手写、不用 plugin（ADR-0022/0023）
   └─ cap-report-{logcat,bugly,firebase}/java/   ← 能力实现，一家一份，按表进对应 flavor
      └─ com/cck/report/CckReport.java
```

**能力代码不按渠道抄。** 五个国内渠道都用 Bugly 时，`cap-report-bugly/` 只有一份，五个 flavor 共享它——改一次五个渠道一起生效。

⚠️ **同一个类名只能有一个来源**：不能同时出现在 `src/<flavor>/` 和某个 `src/cap-*/` 里，那是重复类，gradle 直接报错。

⚠️ **`app/src` 本身是 main 的 java 源根**（模板写死的 `java.srcDirs "../src", "src"`），而源根是
**递归**收 `.java` 的 —— 目录名跟 package 对不对得上它不管。所以 `src/cap-*/` 与 `src/<渠道>/`
里的东西会被一起编进**每个** flavor，表整个失效。`app/build.gradle` 因此对 main 做了两条排除：

```gradle
java.exclude "cap-*/**"
CHANNELS.keySet().each { java.exclude "${it}/**" }
```

这个坑**在只有一份能力实现时是隐形的**：那一份经 main 也能到达所有 flavor，「三个 flavor 里都有
`CckReport.class`」照样成立。抓到它的是 ADR-0021 要求的全 flavor 编译 —— 加到第二、第三份能力实现
时撞了「类重复」才暴露。

## 加东西的步骤

**加一个渠道** = 表里加一行 + （需要的话）建 `src/<渠道>/`。

**加一种能力**（支付 / 广告）= 表里给每个渠道加一列 + 建 `src/cap-<能力>-<厂商>/java/`。gradle 那段循环是按表的键遍历的，**不用改 groovy**。

**换某个渠道用哪家 SDK** = 改表里那一个值。

## JS 侧怎么调过去

JS 一行渠道分支都没有 —— 类名 / 方法名 / 签名固定，**哪一份实现由 flavor 决定**：

```ts
native.reflection.callStaticMethod(
  'com/cck/report/CckReport', 'report', '(Ljava/lang/String;)V', json);
```

⚠️ 反射调用点 **R8 看不见**，`proguard-rules.pro` 里必须有对应的 `-keep`。不加是 debug 全对、**release 才炸**，而且症状是「上报静静地没了」。

## 两道闸

**① `pnpm check:channels`** —— 每次 push 都跑，秒级。挡两类**静默**错：

- 表里写了 `report: 'bugly'` 却没建 `src/cap-report-bugly/` —— **gradle 对不存在的 srcDir 不报错**，照编照出包，那个渠道的实现就这么消失了，直到真机上崩溃一条也报不出来才发现。
- 建了 `cap-*` 目录却没有任何渠道引用 —— 那份代码不进任何 flavor，改了也编不到，正在悄悄腐烂。

它挡不住依赖版本冲突、aar 缺失、manifest 合并失败 —— 那些只有真编一遍才知道，归下面这道。

**② `android-flavors`（[[adr-0021]] 决策 2）** —— MR 与主干上跑，一次编全部三个 flavor：

```yaml
tags: [cocos-mac]
script:
  - pnpm build
  - node apps/demo/scripts/build.mjs boot
  - cd apps/demo/build/android/proj && ./gradlew assembleDebug --console=plain
```

有 productFlavors 之后 `assembleDebug` 的语义正是「编**所有** flavor 的 debug」—— 出包时这是坑
（分不清出来的是哪个包，所以 `build.mjs` 总拼明确的 `assemble<Channel>Debug`），**当闸时它恰好就是要的那件事**。
产物是三个 APK，`CckReport.class` 在 `intermediates/javac/{dev,qq,google}Debug/` 三份里各有一份。

**③ `node apps/demo/scripts/check-flavor-classes.mjs`** —— 跟在 gradle 之后，读每个 flavor 的
`intermediates/javac/<渠道>Debug/.../CckReport.class`，确认**编出来了**，而且**是那一家的**
（.class 的常量池是明文 ASCII，找 `com/tencent/bugly/...` 或 `com/google/firebase/...` 即可，
不用反编译）。

它挡的是**编译产物**这一环的静默错，前两道都看不见：能力目录被 main 的源根吞掉（上一节那个坑），
以及 **AGP 增量陈旧** —— 任务报 `UP-TO-DATE`、构建全绿，产物里却一个 `CckReport.class` 都没有
（源文件 `touch` 都唤不醒它，只有删掉 `intermediates/javac` 才恢复）。后者正是
`GIT_CLEAN_FLAGS: -ffd` 换来的速度所附带的风险，所以这道闸不是可选项。

**跑在 mac 上，不是容器里**：Cocos Creator **没有 Linux 版编辑器**，而 gradle 要的
`build/android/proj/` 是 Creator 的构建产物、不入库，其中 `settings.gradle` 还把 `:libcocos`
指向 Creator 安装目录 —— 没有 Creator，gradle 连 configure 都过不去。跟有没有 Android SDK、
通不通网都无关。宿主与 runner 的搭建记在 hlgit #53。

耗时（Intel i5-8500B，单 ABI `x86_64`）：

| | 冷 | 热 |
|---|---|---|
| Creator 构建 | 首次全量导入资源，分钟级 | 65 s |
| `assembleDebug` | 7 min（NDK 从零编 704 个目标文件） | 4 s（151 个任务里 149 个 up-to-date） |

三个 flavor **共用一份原生构建**（`build/Debug/<hash>/x86_64` 全程只有一个目录 —— cmake 参数不随
flavor 变），所以不是编三遍。

⚠️ **热态成立的前提是 job 里写了 `GIT_CLEAN_FLAGS: -ffd`（不加 `-x`）。** 默认的 `-ffdx` 连
gitignore 的文件一起清，`apps/demo/{library,build}/` 首当其冲，于是每次 CI 都从零重导资源 +
重编引擎，7 分钟变成常态而不是首次代价。

## 已知行为与坑

**`assembleDebug` 的语义变了。** 有了 productFlavors 之后它是「编**所有** flavor 的 debug」。`build.mjs` 因此总是拼明确的 `assemble<Channel>Debug`；手敲 gradle 时也别再用裸 `assembleDebug`。

**APK 路径多一层。** `build/demo/outputs/apk/<渠道>/debug/demo-<渠道>-debug.apk` —— 好处是三个渠道的包同时躺着不会互相覆盖。

**`--channel` 传错不会静默。** 它在 `build.mjs` 里当场对表校验。这是刻意的：这套方案最大的风险面就是「JS 以为自己是 qq 包、APK 里装的却是别家」，而一个参数喂两处把错配面缩到了零。

**`--channel` 不传 = `dev`。** 与 `APP_CONFIG.channel` 的默认值 (`buildValue('channel', 'dev')`) 对齐。

**`channels.json` 在 `native/engine/android/` 下，是源不是产物**（`native/` 已入库，见 [[adr-0021]]）。别往 `build/android/proj/` 里改任何东西，那整个目录每次构建重生成。

**gradle 发行版得预先塞进 `~/.gradle`。** `services.gradle.org` 在国内会握手失败
（`SSLHandshakeException: Remote host terminated the handshake`），而 wrapper 的 `distributionUrl`
写在 `build/android/proj/gradle/wrapper/gradle-wrapper.properties` 里 —— 那是 **Creator 每次重新
生成的产物**，在那儿改镜像下次构建就没了。做法是从国内镜像下好放进 wrapper 的缓存目录
`~/.gradle/wrapper/dists/gradle-<版本>-bin/<hash>/`（`<hash>` 不用自己算，wrapper 第一次下载失败
时已经把目录建好了），`~/.gradle` 在 HOME 下，Creator 冲不掉、CI job 之间还能复用。
Maven 依赖（AGP / androidx / Maven Central）不需要镜像，直连就通。

**接一家 SDK 要动的四处**（以本次两家为例）：

| 落点 | Bugly（`qq`） | Firebase（`google`） |
|---|---|---|
| `channels.json` | `report: "bugly"` | `report: "firebase"` |
| `app/build.gradle` 的能力依赖 | `com.tencent.bugly:crashreport:4.1.9.3`（**必须钉死版本**，官方教的 `latest.release` 会解析到更旧的 4.1.9） | `platform('...firebase-bom:33.1.2')` + `firebase-crashlytics`（**版本被 AGP 锁住，见 [[adr-0023]]**） |
| `src/cap-report-<厂商>/java/` | 一份 `CckReport` | 一份 `CckReport` |
| 资源 / 配置 | 无 | `src/google/res/values/firebase.xml`（六条 string + **一条 bool**） |

**`minSdk` 被 Firebase 顶到 23**（模板是 21），全渠道统一，落点 `app/build.gradle` 的 `defaultConfig`。
Bugly 自己只要 15。不改的话 manifest merger 构建期直接报错 —— 好在是硬失败，不会拖到运行时。

⚠️ **改 `minSdk` 会让 NDK 缓存整个失效**：它进了 clang 的 target 三元组
（`--target=x86_64-none-linux-android21` → `...23`），cmake 换一个构建目录 hash，704 个目标文件从头编。
一次性代价，但别在赶时间的时候动它。

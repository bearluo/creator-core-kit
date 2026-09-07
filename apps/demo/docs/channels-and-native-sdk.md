---
状态: 活文档
摘要: demo 的 Android 原生侧怎么按渠道组装 —— 一张 `channels.json` 表驱动 gradle productFlavor 与能力目录，`--channel` 一个参数同时喂 JS 常量和 gradle 任务名。含出包命令、加渠道 / 加能力的步骤、以及哪些闸挡得住哪些错。
何时读: 要接一家原生 SDK、加一个渠道、加一种能力（支付 / 广告），或看到「某个渠道的 SDK 没生效」时。
依赖: [[adr-0021]] 渠道 SDK 走 productFlavor · [[adr-0022]] 能力是渠道的属性 · [`crash-reporting.md`](../../../packages/core/docs/modules/crash-reporting.md)
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
    "qq":     { "report": "logcat" },
    "google": { "report": "logcat" }
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
   ├─ dev/     qq/     google/          ← 各渠道**独有**的东西（现在都是空的）
   └─ cap-report-logcat/java/           ← 能力实现，**一份**，按表进多个 flavor
      └─ com/cck/report/CckReport.java
```

**能力代码不按渠道抄。** 五个国内渠道都用 Bugly 时，`cap-report-bugly/` 只有一份，五个 flavor 共享它——改一次五个渠道一起生效。

⚠️ **同一个类名只能有一个来源**：不能同时出现在 `src/<flavor>/` 和某个 `src/cap-*/` 里，那是重复类，gradle 直接报错。

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

## 闸挡得住什么、挡不住什么

**`pnpm check:channels`（在 CI 里）** 挡两类静默错：

- 表里写了 `report: 'bugly'` 却没建 `src/cap-report-bugly/` —— **gradle 对不存在的 srcDir 不报错**，照编照出包，那个渠道的实现就这么消失了，直到真机上崩溃一条也报不出来才发现。
- 建了 `cap-*` 目录却没有任何渠道引用 —— 那份代码不进任何 flavor，改了也编不到，正在悄悄腐烂。

**挡不住的**：某个渠道的 SDK 依赖版本冲突、aar 缺失、manifest 合并失败——这些只有真编一遍才知道。

⚠️ **ADR-0021 要求「CI 跑全 flavor 的 assemble」，本仓 CI 现在做不到**：runner 是 `node:22-slim-git` 容器且**没有公网**，既没有 Android SDK/NDK 也拉不到 Maven 依赖。等有 Android 镜像时补上，在那之前全 flavor 编译只能本地跑：

```bash
cd apps/demo/build/android/proj
./gradlew :demo:compileDevDebugJavaWithJavac :demo:compileQqDebugJavaWithJavac :demo:compileGoogleDebugJavaWithJavac
```

## 已知行为与坑

**`assembleDebug` 的语义变了。** 有了 productFlavors 之后它是「编**所有** flavor 的 debug」。`build.mjs` 因此总是拼明确的 `assemble<Channel>Debug`；手敲 gradle 时也别再用裸 `assembleDebug`。

**APK 路径多一层。** `build/demo/outputs/apk/<渠道>/debug/demo-<渠道>-debug.apk` —— 好处是三个渠道的包同时躺着不会互相覆盖。

**`--channel` 传错不会静默。** 它在 `build.mjs` 里当场对表校验。这是刻意的：这套方案最大的风险面就是「JS 以为自己是 qq 包、APK 里装的却是别家」，而一个参数喂两处把错配面缩到了零。

**`--channel` 不传 = `dev`。** 与 `APP_CONFIG.channel` 的默认值 (`buildValue('channel', 'dev')`) 对齐。

**`channels.json` 在 `native/engine/android/` 下，是源不是产物**（`native/` 已入库，见 [[adr-0021]]）。别往 `build/android/proj/` 里改任何东西，那整个目录每次构建重生成。

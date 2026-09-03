---
状态: 已接受
日期: 2026-09-03
依赖: docs/adr/0021-channel-sdk-via-gradle-product-flavors.md, docs/research/2026-09-03-bugly-android.md, docs/research/2026-09-03-firebase-crashlytics-cocos.md
---

# ADR-0022：能力 SDK 是渠道的属性，不是新的 flavor 维度

## 背景

[ADR-0021](0021-channel-sdk-via-gradle-product-flavors.md) 定了「一个渠道一个 gradle productFlavor」。接崩溃上报时暴露出它没回答的下一个问题：**同一种能力，多个渠道用的是同一家 SDK**。

五个国内渠道（QQ / 小米 / OPPO / vivo / 应用宝）共用 Bugly，海外渠道用 Firebase Crashlytics。将来支付、广告是同样的形状。如果照 ADR-0021 的字面做法，Bugly 的接入代码要在五个 `src/<flavor>/` 里各抄一份。

同时还有一个已存在的维度容易被混进来：本仓的 `VEST`（马甲）也是打包期常量。它跟渠道正交。

## 决策

**三条。**

### 1. flavor 这一维只对应「渠道」，马甲不进 gradle

判据是**「换它要不要重新编 Java」**：

| | 换它改什么 | 归谁 |
|---|---|---|
| **马甲 `vest`** | 只换脸（prefab / 图集 / appId / packageName） | **Cocos 构建配置**（`build-configs/*.json` 的 `cck-build.vest`） |
| **渠道 `channel`** | 换 SDK（aar / 权限 / Java 胶水 / manifest） | **gradle productFlavor** |

马甲一行 Java 都不改，把它塞进 flavor 只会让 variant 数白白乘一遍，而且 `packageName` 已经由 Cocos 构建配置单点给出——gradle 里再设一次 `applicationId` 就是两个真相源。

出包时两个参数正交：

```
node scripts/build.mjs boot --vest vest --channel qq --apk
                             │                │
                             │                └─ gradle assembleQqDebug
                             └─ Cocos 构建配置（脸 / appId / packageName）
```

⚠️ `--channel` **一个参数喂两处**：既写进 `cck-build.channel`（JS 侧 `buildValue('channel')` 读它），又拼成 gradle 的 assemble 任务名。这是刻意的——两处若能各填各的，就一定会出现「JS 以为自己是 qq 包、APK 里装的是 Firebase」这种静默错配。

### 2. 能力代码单独成目录，按一张表 `+=` 进各 flavor 的 srcDirs

```gradle
def CHANNELS = [
  dev:    [report: 'none',     login: 'none'  ],
  qq:     [report: 'bugly',    login: 'qq'    ],
  google: [report: 'firebase', login: 'google'],
]

android.productFlavors { CHANNELS.each { name, cfg -> create(name) { dimension 'channel' } } }

CHANNELS.each { name, cfg ->
  ['report', 'login'].each { cap ->
    if (cfg[cap] != 'none') android.sourceSets[name].java.srcDirs += "src/cap-${cap}-${cfg[cap]}/java"
  }
}
```

于是 `src/cap-report-bugly/java/com/cck/report/CckReport.java` **只有一份**，五个国内渠道共享它。

**约定**：同一个类名只能有一个来源——不能同时出现在 `src/<flavor>/` 和某个 `src/cap-*/` 里，那是重复类，gradle 直接报错。

被否决的两个替代：

- **二维 flavor（`flavorDimensions "channel", "report"`）**：variant 数再乘一遍，而且 `qq + firebase` 这种没意义的组合也占一个 variant、还能编过——「哪个渠道配哪家」本该是**代码里的声明**，不该降级成命令行的约定。
- **每个能力做成一个 gradle library module**：`settings.gradle` **只存在于构建产物** `build/android/proj/` 里（`native/engine/android/` 下根本没有这个文件），每次构建重生成。加模块要改一个会被覆盖的文件，路直接堵死。

### 3. 不用 `google-services` / `firebase-crashlytics` 这两个 gradle plugin

Firebase 的 plugin 是**模块级**的，对所有 variant 生效——`qq` 那个包没有 `google-services.json`，构建会被它拖下水。

而 `google-services` plugin 干的事就是把 json 里的值展开成几个 string 资源。**直接手写到 `src/google/res/values/firebase.xml` 即可**，plugin 整个不要：

- ✅ **天然按 flavor 隔离**——`res/` 本来就是按 flavor 合并的，不用 Firebase 的渠道压根看不到这些资源。
- ✅ **顺带绕开 AGP 撞墙**：Crashlytics plugin v3 要 AGP 8.1.0+，而 Cocos 3.8.7 模板是 8.0.2，且 AGP 版本声明在**不入库的构建产物** `build/android/proj/build.gradle` 里，删 `build/` 就重生成——没有 plugin 就没有这个问题。
- ✅ `firebase-crashlytics` plugin 的作用是上传 ProGuard mapping / NDK 符号表，而本仓关心的是 **JS 堆栈**（两家平台都不还原 JS，见 `docs/research/2026-09-03-cocos-js-stack-reporting.md`），用不上。

代价：新建 Firebase 应用时要手工把 `google-services.json` 译成 xml。⚠️ 这条路 `#44` 的调研没覆盖，**实施时要实测**（`docs/research/2026-09-03-firebase-crashlytics-cocos.md` 的待实测清单）。

## 后果

- **加一个渠道** = 给 `CHANNELS` 表加一行 + 建 `src/<flavor>/`（只放这个渠道独有的东西）。
- **加一种能力**（支付 / 广告）= 给表加一列 + 建 `src/cap-<能力>-<厂商>/`。
- **改一家 SDK 的接入代码**只改一处，五个渠道一起生效。
- **IDE 索引比抄五份好**：共享目录在任一引用它的 flavor 下都是正经 source root，选任何一个国内渠道都能编辑那份 Bugly 代码；抄五份的话另外四份在任何时刻都不在被索引的 variant 里。ADR-0021 已接受的「只索引当前 variant」那个代价是方案无关的，这条没让它变差。
- **CI 必须跑全 flavor 的 assemble**（ADR-0021 已定的纪律）在这里更划算：五个国内渠道共用一份代码，编一遍 `qq` 就验了那份 Bugly。
- ⚠️ **一旦有了 productFlavors，`assembleDebug` 就变成「所有 flavor 的 debug」**。`build.mjs` 必须总是拼出明确的 flavor 任务名，不能再裸调 `assembleDebug`（现状是 `build.mjs:310` 写死的那句）。
- ⚠️ **`--channel` 传错不会报错，只会静默少接一块**。这是这套方案的主要风险面，靠「一个参数喂两处」把错配面缩到最小，剩下的靠 CI 全 flavor 编译兜。

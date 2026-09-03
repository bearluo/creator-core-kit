---
状态: 已接受
日期: 2026-09-03
依赖: docs/research/2026-09-03-cocos-native-android-template.md, docs/research/2026-09-03-android-credential-manager-google-signin.md, packages/core/docs/modules/channel-sdk.md
---

# ADR-0021：渠道 SDK 的 Java 侧按 gradle productFlavor 分，一个渠道一个包

## 背景

同一份 Cocos 工程要出 N 个渠道包（华为 / 小米 / TapTap / Google …），而**每个渠道的 Android SDK 都不一样**：不同的 aar、不同的 manifest 声明、不同的权限、不同的 Activity、不同的 Java 胶水类。这些东西放哪，是接渠道 SDK 绕不过去的第一个结构问题。

Cocos 这边的约束是硬的（规则从 Creator 3.8.7 自带的 `native-pack-tool` 明文 TS 源码读出，非推测）：

- `native/engine/android/` **只有一份**。Creator 只在目录不存在时从模板拷一次（`base/default.ts:357` 判的是**目录存在性**，之后 `validateNativeDir()` 只校验、**不补文件**）。
- gradle 真正编译的 `:app` 模块**不在构建产物里** —— `build/android/proj/` 只是一层外壳，其 `settings.gradle` 把 `:app` 的 `projectDir` 指回 `native/engine/android/app`。
- `:app` 的 `sourceSets.main` 是 `java.srcDirs "../src", "src"`，manifest 固定 `AndroidManifest.xml`。

要避免的后果很具体：**所有渠道的 SDK 都进同一个包**。体积翻倍还是小事，**权限取并集会挂审核**（华为要的权限出现在 Google 包里，审核方会问为什么），不同渠道的 SDK 之间还会有依赖冲突。

## 决策

**一个渠道一个 gradle productFlavor，同名类各写各的实现。**

```
native/engine/android/app/
├── build.gradle                                    flavorDimensions "channel"
└── src/
    ├── noop/java/com/cck/channel/CckChannel.java   兜底空实现
    ├── google/java/com/cck/channel/CckChannel.java Google Sign-In
    ├── google/AndroidManifest.xml                  各自的声明，gradle 自动 merge
    ├── huawei/java/com/cck/channel/CckChannel.java 华为（同名类）
    └── huawei/AndroidManifest.xml
```

```groovy
flavorDimensions "channel"
productFlavors {
    noop   { dimension "channel" }
    google { dimension "channel" }
    huawei { dimension "channel"; applicationId "com.x.huawei" }
}
dependencies {
    googleImplementation 'androidx.credentials:credentials:1.6.0'
    huaweiImplementation 'com.huawei.hms:hwid:...'
}
```

**JS 侧一行分支都不写**：调用点固定为 `native.reflection.callStaticMethod('com/cck/channel/CckChannel', 'signIn', …)`，哪个实现进包由 flavor 决定。Java 侧也没有 `if`。

出包：`gradlew assemble<Channel><Debug|Release>`。

### 为什么这条路走得通

关键是 **`apps/demo/scripts/build.mjs:310` 自己调 `gradlew.bat assembleDebug`，不走 Creator 的构建 APK 按钮**。Creator 内部那条 `${projectName}:assemble${outputMode}`（`native-pack-tool/platforms/android.ts:113`）恰恰是 flavor 的麻烦所在 —— `assembleDebug` 会把**所有** flavor 都构建一遍。我们不经过它，所以改成 `assembleGoogleDebug` 只是改一个字符串。

另外两条支撑：`sourceSets.main` 已有的 `"../src", "src"` 与 flavor 源码集是 gradle 原生的叠加关系，不冲突；`dependencies` 里 Cocos 自己就用 `if (Boolean.parseBoolean(PROP_ENABLE_INPUTSDK))` 加过第三方依赖 —— 按条件加依赖是这个文件本来就在做的事。

## 后果

### 1. `native/` 必须进版本管理（本 ADR 直接改了 `.gitignore`）

`app/src/google/`、`app/src/huawei/` 里装的是**我们自己写的源码**，不是 Creator 模板。忽略 `native/` 等于渠道桥只活在一台机器的一个目录里 —— 换台机器、开个 worktree、跑一遍 CI 全都编不出来，而且是「本地明明好好的」那种失败。

这与 Creator 官方的做法一致：自带项目模板的 `.gitignore`（`resources/templates/{empty,empty-2d,empty-quality}/.gitignore`）**不忽略 `native/`**，只忽略 `/native/engine/android/**/*/assets`。本仓原先那条 `/apps/*/native/` 的注释写着「只忽略 Creator **生成的**原生工程目录」，而上面的源码证据表明它是**源**不是生成物 —— 那条规则是理解偏差，不是踩过坑（查过加它的提交 `385c288`）。

不需要 `.cxx/` 之类的例外：`app/build.gradle` 把 `buildDir` 和 CMake 的 `buildStagingDirectory` 都重定向到了 `${RES_PATH}/proj/build`，`native/` 下一个字节产物都不落。

⚠️ **规则有两份**：根 `.gitignore` 和 `apps/demo/.gitignore` 里各有一条，改一处不生效（实施本 ADR 时就被这个咬了一次）。

### 2. CI 必须跑全 flavor 的 `assemble`

否则改了公共代码把某个 flavor 编坏了，本地选着 `google` 一无所知，直到出那个渠道包的当天才发现。**这是本方案唯一需要额外付出的纪律**，不做的话它会在最不该出问题的时候出问题。

### 3. `channel` 是两处真相

JS 侧的 `buildValue('channel')` 与 gradle 的 flavor 名。对不上就是「JS 以为自己是华为包、里头装的是 Google SDK」，**且不会有任何报错**。要让 `build.mjs` 从一处读，同时喂给 Creator 的 `packages={channel}` 与 `assemble<Channel>Debug`。

### 4. IDE 只索引当前选中的 build variant

Android Studio 对没选中的 flavor 源码目录不索引：写代码没补全、写错不报错，切换要一次 gradle sync。

**这是本质权衡，不是 flavor 的缺陷。** 试着绕开就知道：把所有渠道的 Java 都放 `main/`、用不同类名、按 flavor `exclude`，IDE 确实全索引了，但 `CckChannelHuawei.java` 引用的 HMS 类在 google variant 的 classpath 里根本不存在，照样满屏红。**只要不同渠道用不同的第三方 SDK 依赖，classpath 就不同，没有任何方案能让 IDE 同时对所有渠道给出正确提示。**

在本项目这个代价小，因为 Java 侧薄：nonce 生成、异常分流、JWT 解析、token 校验全留在 TS 侧，一个渠道的 Java 大约 50–100 行；且它属引擎层，改一次发一次 APK，改动频率极低；开发主战场是 TS + vitest。

### 5. 与马甲（VEST）正交

马甲是「一个包一张脸」，走 Cocos 的 bundle 与 `skin-<马甲>-<跟随者>` 机制；渠道是「一个包一套 SDK」，走 gradle flavor。两个维度互不干涉，`flavorDimensions` 里只有 `channel` 一个维度。

## 备选方案

| 方案 | 否掉的理由 |
|---|---|
| 一个渠道一个 gradle library module | 隔离更彻底，且所有 module 都被 IDE 索引（**有提示**，这是它相对 flavor 的真实优势）。但 `include ':channel-xxx'` 只能写在 `settings.gradle`，而那个文件在 `build/android/proj/` 下、**每次构建被 Creator 重写**（`android.ts:324`）→ 需要额外手段注入，代价大于收益 |
| 不分渠道，所有 SDK 进一个包，运行时按 `channel` 分支 | 权限取并集（审核风险）、包体膨胀、SDK 依赖冲突。唯一的好处是 IDE 提示完整 |
| 一个渠道一个 Cocos 工程（`apps/demo-huawei/`） | 整个工程复制，资源和代码全要同步，最重 |
| Java 侧只留一个通用反射转发器，渠道 SDK 全从 JS 侧用反射驱动 | Credential Manager 这类 SDK 要构造复杂对象、注册回调、拿 Activity 上下文，纯反射驱动是噩梦。简单的静态方法调用型 SDK 可以，但不能作为通用方案 |

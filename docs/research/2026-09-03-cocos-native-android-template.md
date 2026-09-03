---
状态: 已定稿（纯调研，未改任何代码）
摘要: 查清 Cocos Creator 3.8 的 Android 原生工程「哪个是源、哪个是生成物、构建到底会重写哪几个文件」，给出加自己的 Java 类 / 加 maven 依赖 / 改 AndroidManifest / 配 ProGuard 的**文件级**落点，以及 `jsb.reflection` 与 `JsbBridge` 两代互调机制的确切签名与线程要求。
何时读: 要给 Android 端接原生 SDK（Google Sign-In、支付、推送、渠道 SDK）、要写 JS↔Java 桥、或怀疑「改的原生工程被下次构建吃掉了」时。
日期: 2026-09-03
依赖: docs/adr/0006-native-android-build-and-hotupdate-e2e.md（原生构建触发机制与 apiLevel 坑）、apps/demo/build-configs/README.md（固化构建配置）、apps/demo/docs/hotupdate-pipeline.md
---

# Cocos 3.8 native Android 模板：加 Java 类与 maven 依赖改哪里不会被吃掉

## 结论先行

| 你要干的事 | 改这个文件 | 会不会被下次构建吃掉 |
|---|---|---|
| 加自己的 Java 类 | `apps/demo/native/engine/android/app/src/<包名路径>/Xxx.java` | **不会**。Creator 的原生工程生成代码里没有任何一条会碰 `app/src/` |
| 改主 Activity（转发 `onActivityResult` 等） | `apps/demo/native/engine/android/app/src/com/cocos/game/AppActivity.java` | **不会** |
| 加 maven 依赖 | `apps/demo/native/engine/android/app/build.gradle` 的 `dependencies { }` | **不会**（每次构建只对这个文件做一次定点字符串替换：`com.cocos.helloworld` → 真包名） |
| 加 maven 仓库源 | `apps/demo/native/engine/android/build.gradle` 的 `allprojects { repositories { } }`（`google()` / `mavenCentral()` 已在） | **不会** |
| 丢 `.aar` / `.jar` 进去 | `apps/demo/native/engine/android/app/libs/`（或 `native/engine/android/libs/`） | **不会**，且**一行 gradle 都不用改**（`fileTree` 已声明） |
| 改 `AndroidManifest.xml`（`queries` / `intent-filter` / 新 Activity / 权限） | `apps/demo/native/engine/android/app/AndroidManifest.xml` | **节点不会丢，注释和格式会丢**——删掉 `build/android/` 或换一个 `outputName` 出包时，Creator 会把它 xml2js 往返重写一遍（详见第三节） |
| 加 ProGuard 规则 | `apps/demo/native/engine/android/app/proguard-rules.pro` | **不会** |
| 改 `minSdkVersion` / `PROP_*` | ❌ 别改 `build/android/proj/gradle.properties`（每次构建 regex 重写）；在 `native/.../app/build.gradle` 的 `defaultConfig` 里覆盖 | 改 proj 的必被覆盖 |
| 改 `SDKWrapper.java` | ❌ 它在 `build/android/proj/libservice/src/`，是**产物**，删 `build/` 就没了 | 必丢 |

一句话记法：**`apps/demo/native/` 是源，`apps/demo/build/` 是产物；产物随时可以删，源不能。** 反直觉的是——
**gradle 编译的 `:app` 模块根本不在产物目录里，就是 `native/engine/android/app` 那一份**（见第一节）。

> ⚠️ **本仓有一处与官方约定冲突，动手前必须先拍板**：官方明确「所有定制化工作放 `native` 目录，`build` 可以随时删、
> 不进版本管理」，而本仓根 `.gitignore` 的 `/apps/*/native/` 把 `native/` **整个忽略掉了**（当时的理由是「Creator 生成物」）。
> 一旦我们往 `native/` 放自己的 Java 桥，这条规则就必须改，否则那个类只活在一台机器的一个目录里——
> 而且 `git worktree` 一分支一目录，别的 worktree 连编都编不过（`native/` 不跟着分支走）。
> 代价评估：`native/` 共 25 个文件、140 KB，**不含任何本机绝对路径**（SDK/NDK/JDK 路径全在产物侧的
> `build/android/proj/gradle.properties`），入库干净。详见第七节「待办 A」。

---

## 零、这次的证据等级

标注沿用：**官方文档明确** / **引擎源码实证** / **仓内实测** / **文档推断** / **待实测**。

其中最硬的一档是「引擎源码实证」——**Creator 3.8.7 把生成原生工程的那段代码以明文 TypeScript 装在本机**：

```
<Creator>/resources/resources/3d/engine/scripts/native-pack-tool/source/base/default.ts
<Creator>/resources/resources/3d/engine/scripts/native-pack-tool/source/platforms/android.ts
<Creator>/resources/resources/3d/engine/templates/cocos-project-template.json     ← 每次构建的定点替换清单
<Creator>/resources/resources/3d/engine/templates/android/template/               → 拷进 native/engine/android
<Creator>/resources/resources/3d/engine/templates/android/build/                  → 拷进 build/<out>/proj
```

（本机 `<Creator>` = `C:/ProgramData/cocos/editors/Creator/3.8.7/resources`。编辑器主体 `app.asar` 里的 builder 插件是
加密的 `.ccc`，读不了；但**原生工程生成这一段不在里面**，是明文的，所以覆盖规则不用猜。）

---

## 一、源与产物：`native/engine/android` ↔ `build/android/proj`

### 1.1 谁是源

**引擎源码实证**（`platforms/android.ts` `copyPlatformTemplate()`）——两个方向都是「**只在不存在时拷一次**」：

```ts
protected async copyPlatformTemplate() {
    // 原生工程不重复拷贝
    if (!fs.existsSync(this.paths.nativePrjDir)) {              // build/<out>/proj
        await fs.copy(.../android/build, this.paths.nativePrjDir, { overwrite: false });
        this.firstTimeBuild = true;
    } else {
        this.firstTimeBuild = false;
    }
    if (!fs.existsSync(this.paths.platformTemplateDirInPrj)) {  // native/engine/android
        await fs.copy(.../android/template, this.paths.platformTemplateDirInPrj, { overwrite: false });
        this.writeEngineVersion();
    } else {
        this.validateNativeDir();                               // 只做校验，不写
    }
}
```

`native/engine/android` 存在之后，Creator **再也不会拿模板覆盖它**，只跑 `validateNativeDir()`：
比对 `native/engine/common/cocos-version.json`（本仓是 `{"version":"3.8.7","skipCheck":false}`）与
`templates/compatibility-info.json`（`native.default: ">=3.6.0"`），再检查**有没有文件被删掉**（少文件只打 warning）。
**多出来的文件它不管**——所以新增 Java 类、新增 gradle 片段都不会触发任何抱怨。**官方文档明确**同一件事：
「所有的项目定制化工作都应该尽量放到 native 目录，这样 build 目录就可以随时被删除，它不需要加入到源代码版本管理。」

### 1.2 反直觉：gradle 编的 `:app` 不在产物目录里

**仓内实测**，`apps/demo/build/android/proj/settings.gradle`：

```groovy
include ':libcocos',':libservice',':app'
project(':libcocos').projectDir = new File(COCOS_ENGINE_PATH,'cocos/platform/android/libcocos2dx')
project(':app').projectDir      = new File(NATIVE_DIR, 'app')      // ← 指回 native/engine/android/app
project(':app').name = "demo"
```

`apps/demo/build/android/proj/build.gradle`（产物那份）总共只有两段：AGP 的
`buildscript { classpath 'com.android.tools.build:gradle:8.0.2' }`，外加一行
`apply from: NATIVE_DIR + "/build.gradle"`。也就是说：

- **`:app` 模块的 `build.gradle` / `AndroidManifest.xml` / `src/` / `libs/` / `proguard-rules.pro` 全都住在 `native/`**，
  产物目录里连副本都没有；
- 产物 `proj/` 只是个 gradle 外壳：`gradlew` + `settings.gradle` + `gradle.properties` + `local.properties` +
  `cfg.cmake` + `res/values/strings.xml` + `libservice/`（`SDKWrapper.java` 在这里，**是产物**）+ `build/`（编译中间物）。

这条一旦记住，「改哪里」的焦虑就消了一大半：**你要改的 app 模块，本来就在源目录里。**

### 1.3 每次构建实际会写哪些文件

**引擎源码实证**（`android.ts` 的 `create()`，每次构建都跑）：

| 被写的文件 | 由谁写 | 写法 | 你的手改保不保得住 |
|---|---|---|---|
| `native/engine/android/CMakeLists.txt` | `excuteCocosTemplateTask` | 定点替换 `CocosGame` → 项目名 | **保得住**（读→替换→写回，只动那个词） |
| `native/engine/android/app/build.gradle` | 同上 | 定点替换 `com.cocos.helloworld` → 包名 | **保得住** |
| `native/engine/android/instantapp/build.gradle` | 同上 | 同上 | **保得住** |
| `native/engine/android/app/AndroidManifest.xml` | `updateManifest()` | **仅 `firstTimeBuild`**，xml2js 解析 → 改属性 → 重新序列化 | 节点保得住，**注释和格式保不住**（见三节） |
| `build/android/proj/settings.gradle` | `excuteCocosTemplateTask` | 定点替换项目名 | 产物，别改 |
| `build/android/proj/gradle.properties` | `updateAndroidGradleValues()` | 逐条 regex 替换 `PROP_*` | **改了必被覆盖** |
| `build/android/proj/local.properties` | 同上 | 全量重写 `sdk.dir` | 产物 |
| `build/android/proj/cfg.cmake` | `generateCMakeConfig()` | 全量重写 | 产物 |
| `build/android/proj/res/values/strings.xml` | `generateAppNameValues()` | 仅当 `native/.../res/values/strings.xml` **没有** `app_name` 时才生成 | 见 3.4 |

清单里**没有** `app/src/**`、`app/proguard-rules.pro`、`app/libs/**`、`res/mipmap-*`、`native/engine/android/build.gradle`
（项目级那份）、`native/engine/common/**`。**Creator 一次都不碰它们。**

**仓内实测佐证**（`apps/demo/native/` 各文件 mtime 对上了构建时刻，精确到秒）：

```
2026-07-24 13:25:35  app/proguard-rules.pro, app/src/.../AppActivity.java, build.gradle, res/**
                     ← 首次构建拷进来后再没动过
2026-08-19 17:47:44  app/AndroidManifest.xml
                     ← 与 build/android-md5b/proj 的生成同秒（新 outputName ⇒ firstTimeBuild=true）
2026-08-31 16:17:55  CMakeLists.txt, app/build.gradle, instantapp/build.gradle
                     ← 与最后一次构建同秒（每次都做定点替换，内容没变、mtime 变了）
```

替换清单本身是明文的，`<Creator>/resources/resources/3d/engine/templates/cocos-project-template.json`：

```json
{ "doAddNativeSupport": {
    "projectReplaceProjectName":      { "srcProjectName": "CocosGame",            "files": ["proj/main.cpp", "proj/main.m", "${NATIVE_DIR}/CMakeLists.txt"] },
    "projectReplaceProjectNameASCII": { "srcProjectName": "CocosGame",            "files": ["proj/settings.gradle"] },
    "projectReplacePackageName":      { "srcPackageName": "com.cocos.helloworld", "files": ["${NATIVE_DIR}/app/build.gradle", "${NATIVE_DIR}/instantapp/build.gradle"] }
} }
```

### 1.4 什么操作会「重来一次」

- **删 `apps/demo/build/android/`**（或换一个 `outputName` 出包，例如 `android-md5`）→ `proj/` 重新从模板拷 →
  `firstTimeBuild = true` → **`updateManifest()` 会再跑一遍**，把 `native/.../app/AndroidManifest.xml` xml2js 往返重写。
  这是**唯一**会动你手改过的 manifest 的场景。
- **删 `apps/demo/native/engine/android/`** → 整个模板重拷，**你的 Java 类、gradle 改动、manifest 全没**。
  这一步只有升级 Creator 大版本时官方才建议做（且前提是「没有自定义原生改动」）。
- **升级 Creator** → `validateTemplateVersion()` 拿 `cocos-version.json` 比 `compatibility-info.json`（当前 `>=3.6.0`）；
  不兼容会报 `ErrorCodeIncompatible` 并要求手工迁移（3.7→3.8 的迁移步骤官方逐条列在
  [v3.8 Android 工程升级](https://docs.cocos.com/creator/3.8/manual/zh/release-notes/upgrade-3.8-android.html)——
  注意它要求你**手改** `native/engine/android/build.gradle` 与 `app/build.gradle`，这本身就反证了这些文件不会被覆盖）。

---

## 二、自己的 Java 类放哪

**仓内实测**，`native/engine/android/app/build.gradle` 的 `sourceSets`（**这就是判据**，别看文档转述）：

```groovy
sourceSets.main {
    java.srcDirs    "../src", "src"                       // 相对 :app 的 projectDir = native/engine/android/app
    res.srcDirs     "../res", 'res', "${RES_PATH}/proj/res"
    jniLibs.srcDirs "../libs", 'libs'
    manifest.srcFile "AndroidManifest.xml"
    assets.srcDir   "${RES_PATH}/data"                    // = build/android/data，游戏资源整包塞进 APK 的 assets/
}
```

于是**两个目录都会被编进 APK**：

```
apps/demo/native/engine/android/src/…      ← 官方说法：多平台共用的 Java
apps/demo/native/engine/android/app/src/…  ← 官方说法：本平台独有的 Java
```

**推荐**：`apps/demo/native/engine/android/app/src/com/cck/bridge/GoogleSignInBridge.java`
（目录必须与 `package` 一致；包名不必是 `com.cocos.game`，也不必等于 `APPLICATION_ID`——
`namespace APPLICATION_ID` 只决定 `R` 类与 manifest 里相对类名的解析基点）。

配套事实：

- **主 Activity 是 `com.cocos.game.AppActivity`**（`native/engine/android/app/src/com/cocos/game/AppActivity.java`，
  继承 `com.cocos.lib.CocosActivity`），已经把 `onCreate/onResume/onActivityResult/onNewIntent/...` 全量转发给
  `SDKWrapper.shared()`。Google Sign-In 的 `startActivityForResult` 结果会落到这里 → **要么在 AppActivity 里加转发**
  （安全，它在 `native/` 且 Creator 不碰），**要么别用 `onActivityResult`**（新版 Credential Manager / GIS 走回调）。
- ❌ **`SDKWrapper.java` 在 `build/android/proj/libservice/src/com/cocos/service/`，是产物**
  （模板源在 `<Creator>/…/templates/android/build/libservice/`）。删 `build/` 就没了。别在那里写代码。
- 拿 Activity 实例：引擎提供 `com.cocos.lib.GlobalObject.getActivity()`（**引擎源码实证**，
  `<Creator>/…/engine/native/cocos/platform/android/java/src/com/cocos/lib/GlobalObject.java`）。

---

## 三、AndroidManifest.xml

### 3.1 唯一一份，就在源目录

`apps/demo/native/engine/android/app/AndroidManifest.xml`（`manifest.srcFile "AndroidManifest.xml"`，相对 `:app`）。
`queries` / 新 `<activity>` / 新权限 / `<meta-data>` 全加在这里。

### 3.2 Creator 什么时候会重写它、重写成什么样

**引擎源码实证**（`android.ts` `updateManifest()`）：

```ts
protected async updateManifest() {
    if (!this.firstTimeBuild) { console.log(`AndroidManifest.xml has already been updated!`); return; }
    ...
    const data = await xml2js.parseStringPromise(xmlData);   // 解析成对象
    fnUpdateOrientation(data);          // data.manifest.application[0].activity[0].$['android:screenOrientation']
    fnUpdateResizeableActivity(data);   // data.manifest.application[0].$['android:resizeableActivity']
    fnUpdateMaxAspectRation(data);      // resizeableActivity=true 时跳过；否则给**所有** activity 加 maxAspectRatio
    await fs.writeFile(xmlFile, new xml2js.Builder().buildObject(data), 'utf8');
}
```

三条结论：

1. **只在 `firstTimeBuild` 跑**，而 `firstTimeBuild` 由「**`build/<out>/proj` 存不存在**」决定，不是由 `native/` 决定。
   日常重复构建同一个 `outputName` **完全不碰 manifest**；删掉 `build/android/` 或新开一个 `outputName` 就会再跑一次。
2. 重写是**解析→改属性→重新序列化**，不是拿模板覆盖。**你加的节点（`queries`、`activity`、`meta-data`、权限）全都在
   解析出来的对象里，会被原样写回去。** 丢的是**注释、缩进、属性顺序**（xml2js Builder 输出
   `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` + 2 空格缩进 + 无尾换行——本仓当前那份就是这个样子，**仓内实测**）。
3. ⚠️ **`activity[0]` 是「第一个 activity」，不是「AppActivity」。** 你要是把自己的 Activity 写在 `AppActivity` **前面**，
   下次 `firstTimeBuild` 时 `android:screenOrientation` 会被写到**你的** Activity 上，而 AppActivity 的方向没人管了。
   **规矩：自定义 `<activity>` 一律加在 `com.cocos.game.AppActivity` 之后。**

### 3.3 被 Creator 强占的属性（别手改，改了下次可能被覆盖）

| 属性 | 位置 | 来源 |
|---|---|---|
| `android:screenOrientation` | 第一个 `<activity>` | 构建选项 `orientation`（`portrait/landscape/sensorPortrait/...` 的映射表在 `mapOrientationValue()`） |
| `android:resizeableActivity` | `<application>` | 构建选项 `resizeableActivity` |
| `android:maxAspectRatio` | 所有 `<activity>`（apiLevel≥26）或 `<meta-data android.max_aspect>` | 构建选项 `maxAspectRatio`；`resizeableActivity=true` 时**整段跳过**（本仓正是这种，所以 manifest 里看不到它） |

其余（权限、`usesCleartextTraffic`、`queries`、图标、label…）Creator 不管，随你改。
另：**3.8 起 manifest 里不能有 `package` 属性**，包名由 `app/build.gradle` 的 `namespace APPLICATION_ID` 提供（官方文档明确）。
顺带（ADR-0006 已记）：模板默认 `android:usesCleartextTraffic="true"`，HTTP 明文开箱可用。

### 3.4 app 名字

`generateAppNameValues()`：读 `native/engine/android/res/values/strings.xml`，**只有当里面没有 `app_name` 时**，
才把 `<string name="app_name">demo</string>` 生成到 `build/android/proj/res/values/strings.xml`（产物）。
本仓 `native/…/res/values/strings.xml` 目前是空的 `<resources></resources>`，所以名字由产物那份提供。
**想固定 app 名字 → 写进 `native/…/res/values/strings.xml`，Creator 就不再生成产物那份**（写两份会 duplicate resource 报错）。

---

## 四、maven 依赖与 `gradle.properties`

### 4.1 依赖加在 app 级

`apps/demo/native/engine/android/app/build.gradle` 末尾（**仓内实测**，当前内容）：

```groovy
dependencies {
    implementation fileTree(dir: '../libs', include: ['*.jar','*.aar'])
    implementation fileTree(dir: 'libs',    include: ['*.jar','*.aar'])
    implementation fileTree(dir: "${COCOS_ENGINE_PATH}/cocos/platform/android/java/libs", include: ['*.jar'])
    implementation project(':libservice')
    implementation project(':libcocos')
    if (Boolean.parseBoolean(PROP_ENABLE_INPUTSDK)) {
        implementation 'com.google.android.libraries.play.games:inputmapping:1.1.0-beta'   // ← Cocos 自己就是这么加 maven 依赖的
        implementation "org.jetbrains.kotlin:kotlin-stdlib:1.4.10"
    }
}
```

加一行 `implementation 'com.google.android.gms:play-services-auth:<版本>'` 即可。**这一行不会被吃掉**——
这个文件每次构建只被做一次 `com.cocos.helloworld` → `com.cck.demo` 的定点替换（而且早就替换过了，是个 no-op）。

**仓库源**在项目级 `apps/demo/native/engine/android/build.gradle`，已经有 `google()` 和 `mavenCentral()`：

```groovy
allprojects { repositories { google(); mavenCentral() } }
```

产物那份 `proj/build.gradle` 用 `apply from: NATIVE_DIR + "/build.gradle"` 把它拉进来。要加私有 maven 仓就加在源这份里。
（⚠️ AGP 本身的 `classpath 'com.android.tools.build:gradle:8.0.2'` 在**产物** `proj/build.gradle` 的 `buildscript` 块里，
改不了也别改——`apply from` 进来的脚本里的 `buildscript` 对根工程 classpath 无效，这是 Gradle 的语义限制。**文档推断**。）

**最省事的替代**：只要依赖没有传递依赖，直接把 `.aar`/`.jar` 丢进
`apps/demo/native/engine/android/app/libs/`（目录不存在就新建），`fileTree` 已经声明，**一行 gradle 都不用改**。
Google Sign-In 有一串传递依赖，还是走 maven。

### 4.2 `gradle.properties` 的 `PROP_*` 各是什么

文件在 **`apps/demo/build/android/proj/gradle.properties`（产物，每次构建 regex 重写，改了必丢）**。
值的来源是 `templates/android/build/gradle.properties` 这份模板 + `updateAndroidGradleValues()` 的逐条替换
（**引擎源码实证**，`android.ts` L326-377）：

| 变量 | 被谁消费 | 值从哪来 |
|---|---|---|
| `PROP_COMPILE_SDK_VERSION` | `app/build.gradle` 的 `compileSdkVersion .toInteger()` | `Math.max(apiLevel, compileSDKVersion, 27)` |
| `PROP_TARGET_SDK_VERSION` | `targetSdkVersion` | 构建选项 `apiLevel` |
| `PROP_MIN_SDK_VERSION` | `minSdkVersion` | `Math.min(apiLevel, minimalSDKVersion)`；**模板默认 21，构建面板没有这一项** |
| `PROP_BUILD_TOOLS_VERSION` | `buildToolsVersion` | **模板写死 34.0.0**，无人替换 |
| `PROP_NDK_PATH` | `ndkPath` | 构建选项 `ndkPath`（Windows 下反斜杠会被转义成 `\\`） |
| `PROP_APP_ABI` | `ndk { abiFilters PROP_APP_ABI.split(':') }` | 构建选项 `appABIs`，多个用 `:` 连 |
| `PROP_APP_NAME` | `buildDir = "${RES_PATH}/proj/build/<name>"` | 项目名（本仓 `demo`） |
| `PROP_IS_DEBUG` | `release { getIsDefault().set(true) }` 的条件 | 构建选项 `debug` |
| `PROP_ENABLE_INSTANT_APP` | `settings.gradle` 是否 `include ':instantapp'` | 构建选项 `androidInstant` |
| `PROP_ENABLE_INPUTSDK` | app 依赖里那两条 Google Play inputmapping | 构建选项 `inputSDK` |
| `COCOS_ENGINE_PATH` | `settings.gradle` 定位 `:libcocos`；app 依赖引擎 jar | 引擎 native 根目录 |
| `RES_PATH` | `assets.srcDir "${RES_PATH}/data"`、`buildDir`、cmake `-DRES_DIR` | `build/android`（**构建输出目录**） |
| `NATIVE_DIR` | `settings.gradle` 定位 `:app`；`proj/build.gradle` 的 `apply from` | `apps/demo/native/engine/android`（**源目录**） |
| `APPLICATION_ID` | `namespace` + `applicationId` | 构建选项 `packageName`（本仓 `com.cck.demo`） |
| `RELEASE_STORE_FILE` / `_PASSWORD` / `RELEASE_KEY_ALIAS` / `_PASSWORD` | `signingConfigs.release` | keystore 构建选项；不用 keystore 时这四行会被注释掉 |
| `android.useAndroidX=true`、`org.gradle.jvmargs`、`android.native.buildOutput=verbose` | gradle 自身 | 模板固定 |

**要改 `minSdkVersion`（比如某 SDK 要 23）**：不能改产物里的 `PROP_MIN_SDK_VERSION`，
在 `native/…/app/build.gradle` 的 `defaultConfig { minSdkVersion 23 }` 直接覆盖即可（Groovy 后写的赢）。

**回填一个老坑**：ADR-0006 记的「`apiLevel` 传字符串 → `PROP_COMPILE_SDK_VERSION=NaN`，gradle 在
`app/build.gradle:10` 炸 `For input string: "NaN"`」——病根现在看得见了，就是那行
`content.replace(/PROP_COMPILE_SDK_VERSION=.*/, "PROP_COMPILE_SDK_VERSION=" + Math.max(apiLevel, compileSDKVersion, 27))`：
`Math.max('android-34', …)` = `NaN`，直接写进产物。**apiLevel 必须是数字。**

### 4.3 工具链事实（仓内实测）

AGP 8.0.2 / Gradle wrapper 8.0.2 / JDK 17 / `compileSdk` 34 / `buildTools` 34.0.0 / NDK r23c / cmake 3.22.1 /
`sourceCompatibility = targetCompatibility = 1.8`。出包命令见 `apps/demo/scripts/build.mjs`：
`node scripts/build.mjs boot --apk` → 内部跑 `build/android/proj/gradlew.bat assembleDebug`，
APK 落 `build/android/proj/build/demo/outputs/apk/debug/demo-debug.apk`。

---

## 五、ProGuard / R8

- 文件：**`apps/demo/native/engine/android/app/proguard-rules.pro`**（Creator 不碰，**引擎源码实证**：不在任何写清单里）。
- 生效条件（**仓内实测**，`app/build.gradle`）：**只有 release**——
  `release { minifyEnabled true; shrinkResources true; proguardFiles getDefaultProguardFile('proguard-android.txt'), 'proguard-rules.pro' }`；
  `debug { }` 不混淆。`:libservice` 与 `:libcocos` 两个 library 模块都是 `minifyEnabled false`。
- 模板自带的规则里已经有 `-keep public class com.cocos.** { *; }`、`-keep class okhttp3/okio.**`、
  以及 `-keep public class com.google.** { *; }`（Google 家的类已被保住）。
- ⚠️ **自己的桥类必须显式 `-keep`**。`jsb.reflection` 走的是 JNI `FindClass` + `GetStaticMethodID`，
  **R8 看不见任何调用点**，release 包里会被删掉或改名，表现是运行时 `ClassNotFoundException` / `NoSuchMethodError`。
  **而 debug 包一切正常** —— 这个 bug 只在出正式包时现形。

```proguard
# 被 jsb.reflection / JsbBridge 反射调用的桥，R8 看不见调用点，必须钉住
-keep class com.cck.bridge.** { *; }
-keepclassmembers class com.cck.bridge.** { public static *; }
```

---

## 六、JS ↔ Java：三条路，怎么选

### 6.1 反射（`jsb.reflection` / `native.reflection`）——JS 主动调 Java

**官方文档明确**（[JS 与 Java 通信（反射）](https://docs.cocos.com/creator/3.8/manual/zh/advanced-topics/java-reflection.html)）：

```ts
import { native } from 'cc';
const ret = native.reflection.callStaticMethod(className, methodName, methodSignature, ...parameters);
```

- `className`：**斜杠分隔**的全限定名，如 `"com/cck/bridge/GoogleSignInBridge"`（不是点分）。
- `methodSignature`：JNI 签名串 `(参数类型…)返回类型`。
- 只能调 **`public static`** 方法；**JS 侧只支持 `number` / `boolean` / `string` 三种参数**（官方文档明确）。
- 3.8 的正名是 `native.reflection`（`import { native } from 'cc'`）；全局 `jsb.reflection` 在原生平台仍可用，是同一个东西。
  **Web / 小游戏上 `native.reflection` 不存在**——按本仓铁律，这类调用必须封在 `engine` 适配层里，
  `core` 只认接口（用 `sys.isNative` / `NATIVE` 宏分平台，非原生给 no-op 或 web OAuth 实现）。

JNI 签名对照（前 5 行是官方文档给的，其余是 JNI 规范，**文档推断**但无争议）：

| Java 类型 | 签名 |
|---|---|
| `void` | `V` |
| `int` | `I` |
| `float` | `F` |
| `boolean` | `Z` |
| `String` | `Ljava/lang/String;` |
| `byte` / `char` / `short` / `long` / `double` | `B` / `C` / `S` / `J` / `D` |
| 任意对象 | `L<斜杠全限定名>;`，如 `Landroid/app/Activity;` |
| 数组 | 前面加 `[`，如 `[Ljava/lang/String;` |

例：

```
()V                                        无参、无返回
(I)I                                       一个 int，返回 int
(Ljava/lang/String;)V                      一个 String，无返回
(ILjava/lang/String;F)Ljava/lang/String;   int + String + float，返回 String
```

### 6.2 Java 回 JS：`evalString` 必须在游戏线程

**官方文档明确 + 引擎源码实证**（`com/cocos/lib/CocosHelper.java:160` `public static void runOnGameThread(final Runnable)`；
`CocosJavascriptJavaBridge.java:27` `public static native int evalString(String value)`）：

```java
CocosHelper.runOnGameThread(new Runnable() {
    @Override public void run() {
        CocosJavascriptJavaBridge.evalString("cc.log('Hello')");
    }
});
```

- 线程：**`com.cocos.lib.CocosHelper.runOnGameThread(Runnable)`**。
  ⚠️ **不是 `runOnGLThread`**——那是 Cocos2d-x v3 的名字，Creator 3.x 的 Android 层没有这个方法（**引擎源码实证**：
  `CocosHelper` 只有 `runOnGameThread` 与 `runOnGameThreadAtForeground`）。
- 在别的线程（网络回调、Google API 的 `OnCompleteListener`、`onActivityResult` 所在的 UI 线程）**直接调 `evalString`
  会炸或行为未定义**。Google Sign-In 的结果**一定**是异步回来的，所以这条是必踩的。

### 6.3 更新的机制：`JsbBridge` 与 `JsbBridgeWrapper`

**官方文档明确**（[JsbBridge](https://docs.cocos.com/creator/3.8/manual/zh/advanced-topics/js-java-bridge.html)、
[JsbBridgeWrapper](https://docs.cocos.com/creator/3.8/manual/zh/advanced-topics/jsb-bridge-wrapper.html)），
**引擎源码实证** `com/cocos/lib/JsbBridge.java` / `JsbBridgeWrapper.java` 确实随引擎发布：

```ts
// JS
native.bridge.sendToNative('open_ad', payloadJson);
native.bridge.onNative = (arg0: string, arg1: string) => { /* … */ };
// 事件式封装
native.jsbBridgeWrapper.addNativeEventListener('signInResult', (arg: string) => { /* … */ });
native.jsbBridgeWrapper.dispatchEventToNative('signIn');
```

```java
// Java
JsbBridge.setCallback((arg0, arg1) -> { /* … */ });
JsbBridge.sendToScript("ad_close", "finished");
// 事件式封装
JsbBridgeWrapper jbw = JsbBridgeWrapper.getInstance();
jbw.addScriptEventListener("signIn", arg -> jbw.dispatchEventToScript("signInResult", json));
```

- **只吃 `string`**（两个参数：一个事件名 + 一个负载）；复杂数据自己 JSON 序列化。
- 官方对 `JsbBridgeWrapper` 的原话是「**不具备多线程稳定性，也不是 100% 安全**」，复杂场景建议自己实现事件机制。
- **待实测**：`JsbBridge.sendToScript` 内部是否已经帮你切到游戏线程（`nativeSendToScript` 是 native 方法，
  C++ 侧是否 post 到游戏线程本次没查）。**在确认之前，从非游戏线程调 `sendToScript` 也一律用
  `CocosHelper.runOnGameThread` 包一层**——包了没坏处。

### 6.4 给 Google Sign-In 的选型建议

**JS 发起用反射，Java 回调用 JsbBridge/Wrapper。** 理由：

- 发起是同步的一次调用、要传 `serverClientId` 之类参数 → 反射直给，不用编事件名；
- 结果是异步的（`Task<...>` 回调 / `onActivityResult`）→ `JsbBridge`/`JsbBridgeWrapper` 天然是事件模型，
  比自己拼一串 `evalString("window.__cb('...')")` 干净（拼字符串还有注入和转义问题）。
- 两者都要求游戏线程，写法见 6.2。

**另有一条捷径值得先评估**（**引擎源码实证**）：Cocos 3.8.7 的引擎里**自带 Google Play Games 与 Google Billing 的 Java 实现**：

```
<Creator>/…/engine/native/cocos/platform/android/java/vendor/play/google/play/{GamesSignInClientHelper,PlayGamesSdkHelper,TaskManager,…}.java
<Creator>/…/engine/native/cocos/platform/android/java/vendor/billing/google/billing/GoogleBilling.java
```

由 `libcocos2dx/build.gradle` 里的 gradle 属性开关控制：

```groovy
if (project.hasProperty("PROP_ENABLE_GOOGLE_PLAY_GAMES") && project.PROP_ENABLE_GOOGLE_PLAY_GAMES.toBoolean()) {
    sourceSets.main.java.srcDirs += ["../java/vendor/play"]
    implementation "com.google.android.gms:play-services-games-v2:+"
}
```

`GamesSignInClientHelper` 已经封好 `signIn()` / `isAuthenticated()` /
`requestServerSideAccess(serverClientId, forceRefreshToken)`——最后这个正是服务端要的 server auth code。

⚠️ 但**这是 Play Games 登录，不等于 Google 账号登录（GIS / OAuth）**，产品上要先确认是不是同一个东西；
而且 `PROP_ENABLE_GOOGLE_PLAY_GAMES` **不在** Creator 为标准 `android` 平台生成的 `gradle.properties` 里
（只有 `google-play` 那个平台模板有），要用它得自己想办法把属性喂进去。**待实测**，见第七节。

---

## 七、待实测 / 待拍板清单

**待办 A（必须先拍板）：`native/` 到底进不进 git。**
官方要求进；本仓 `.gitignore` 的 `/apps/*/native/`（以及 `apps/demo/.gitignore` 的 `/native/`）把它忽略了。
不改这条，写的 Java 类不跟分支走、别的 worktree 编不过、CI 更不用谈。
两个选项：① 整个 un-ignore（25 文件 / 140 KB，无本机绝对路径，代价是 `CMakeLists.txt`/`app/build.gradle` 的
mtime 每次构建变但内容不变 → git 无 diff，噪音为零；`AndroidManifest.xml` 只在删 `build/` 后才会有格式 diff）；
② 只反向 un-ignore 我们新增的文件。**倾向 ①**——理由是官方语义就是「native 是源」，选择性入库等于把「哪些是源」
这件事变成一条要记住的规矩。

**待实测 B**：删掉 `apps/demo/build/android/` 再构建一次，确认手改过的 `AndroidManifest.xml`（含 `<queries>` 与自定义
`<activity>`）在 xml2js 往返后**节点确实全在**、只掉注释和格式。源码读下来是这个结论，但值一次实验。
配方：加一段 `<queries>` + 一个注释 → 删 `apps/demo/build/android` → `node scripts/build.mjs boot` → diff 那份 manifest。

**待实测 C**：`PROP_ENABLE_GOOGLE_PLAY_GAMES` 能不能在标准 `android` 平台上打开
（试 `native/engine/android/build.gradle` 里 `allprojects { ext.PROP_ENABLE_GOOGLE_PLAY_GAMES = 'true' }`），
以及打开后 JS 侧怎么调（3.8.7 的 `cc` 里没搜到 `requestServerSideAccess` 的 TS 绑定，可能要 `USE_VENDOR` + 手动绑定）。

**待实测 D**：`JsbBridge.sendToScript` 是否内部切游戏线程（见 6.3）。

**待实测 E**：release 包（`assembleRelease`，`minifyEnabled true`）下反射桥是否真的需要 `-keep`。
按 R8 语义是必然要，但本仓至今只出过 debug 包，没被这条咬过。

---

## 八、动手清单（文件级）

接一个 Google Sign-In 桥，要碰的文件（全部在 `apps/demo/native/engine/android/`，全部不会被构建吃掉）：

```
app/src/com/cck/bridge/GoogleSignInBridge.java   新建：public static 方法 + JsbBridge 回调
app/src/com/cocos/game/AppActivity.java          改：onActivityResult 转发给桥（若走 startActivityForResult）
app/build.gradle                                 改：dependencies 加 implementation 'com.google.android.gms:play-services-auth:…'
                                                    （如需）defaultConfig 覆盖 minSdkVersion
app/AndroidManifest.xml                          改：queries / 权限（自定义 activity 必须加在 AppActivity 之后）
app/proguard-rules.pro                           改：-keep com.cck.bridge.**
build.gradle（项目级）                             （仅在需要私有 maven 仓时）改 allprojects.repositories
```

TS 侧按本仓铁律分层：接口在 `packages/core`（零 `cc`），`native.reflection` / `native.bridge` 的调用封在
`packages/engine` 的适配实现里，Web / 小游戏给另一套实现，`core` 与单测只见接口。

**别碰**：`apps/demo/build/**` 下的任何东西（`proj/gradle.properties`、`proj/libservice/src/…/SDKWrapper.java`、
`proj/build.gradle`、`proj/settings.gradle`、`proj/res/values/strings.xml`）——它们是产物，改了要么下次构建被覆盖，
要么删 `build/` 就没了。

---

## 参考

- [原生平台二次开发指南](https://docs.cocos.com/creator/3.8/manual/zh/advanced-topics/native-secondary-development.html)
- [打包发布到原生平台](https://docs.cocos.com/creator/3.8/manual/zh/editor/publish/native-options.html)
- [Android 构建选项](https://docs.cocos.com/creator/3.8/manual/zh/editor/publish/android/build-options-android.html)
- [v3.8 Android 工程升级](https://docs.cocos.com/creator/3.8/manual/zh/release-notes/upgrade-3.8-android.html)
- [JS 与 Java 反射通信](https://docs.cocos.com/creator/3.8/manual/zh/advanced-topics/java-reflection.html)
- [JsbBridge](https://docs.cocos.com/creator/3.8/manual/zh/advanced-topics/js-java-bridge.html) ·
  [JsbBridgeWrapper](https://docs.cocos.com/creator/3.8/manual/zh/advanced-topics/jsb-bridge-wrapper.html)
- 本机明文源（比文档权威）：`<Creator>/resources/resources/3d/engine/scripts/native-pack-tool/source/{base/default.ts,platforms/android.ts}`、
  `<Creator>/resources/resources/3d/engine/templates/cocos-project-template.json`
- 仓内：`docs/adr/0006-native-android-build-and-hotupdate-e2e.md`、`apps/demo/build-configs/README.md`、`apps/demo/scripts/build.mjs`

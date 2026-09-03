---
状态: 已定稿（纯调研，未改任何代码）
摘要: 补上 `2026-09-03-cocos-native-android-template.md` 没覆盖的那半边——**gradle plugin 与配置文件**。查清 `com.google.gms.google-services` / `com.google.firebase.crashlytics` 两个插件的落点与版本要求，并与 Cocos 3.8.7 模板实际的 AGP 8.0.2 / Gradle 8.0.2 对了一遍账（**结论：Crashlytics 插件 v3 要 AGP 8.1+，对不上，只能走 v2**）；`google-services.json` 的完整搜索顺序（源码实证）与 productFlavor 分包含义；Firebase 建项目的成本与门槛；非致命异常 API 的精确签名与上限；NDK 边界；minSdk 与 Java 版本对账；以及 `google-services.json` 该不该入库的官方原话。
何时读: 要给海外 Android 包接 Firebase Crashlytics（或任何要 `google-services.json` 的 Firebase 服务）时；要按马甲/productFlavor 分发不同 Firebase 配置时；要判断「上报 JS 异常」在 Android 上能做到什么程度时。
日期: 2026-09-03
依赖: docs/research/2026-09-03-cocos-native-android-template.md（**先读它**：哪些文件是源、哪些是产物、Java 类与 maven 依赖放哪不会被吃掉）、docs/research/2026-09-03-android-credential-manager-google-signin.md（minSdk 23 的另一处压力来源）、docs/adr/0006-native-android-build-and-hotupdate-e2e.md
---

# Firebase Crashlytics × Cocos 3.8.7 Android：插件与配置文件落在哪

## 结论先行

| 问题 | 结论 | 可信度 |
|---|---|---|
| 两个插件的 classpath 写哪 | **`apps/demo/native/engine/android/app/build.gradle` 自己的 `buildscript { }` 块**（模块级），不是项目级。项目级那份 `native/engine/android/build.gradle` 是被 `apply from:` 进来的脚本，**Gradle 不允许它改根工程的 buildscript classpath** | 见 §1.3，Gradle 官方 issue 明确 + 文档推断 |
| 新式 `plugins { id … version … apply false }` 能不能用 | **不能**（在本工程里）。它要求写在**根**构建脚本或 `settings.gradle` 的 `pluginManagement`，而这两个文件都是 Creator **产物**（`build/android/proj/`），删 `build/` 就没了、还不入库 | 文档推断（源与产物的判定见依赖文档 §1） |
| Crashlytics Gradle plugin 用哪个版本 | **必须用 v2 线的 `2.9.9`**。官方 v3（当前 3.0.8）要求 **AGP 8.1.0+**，而 Cocos 3.8.7 模板是 **AGP 8.0.2** | 官方文档明确（要求）+ 仓内实测（AGP 版本） |
| `google-services` plugin 版本 | `4.5.0` 可用，它只要求 **AGP 7.3.0+** | 官方文档明确 |
| `google-services.json` 放哪 | `apps/demo/native/engine/android/app/google-services.json`（= `:app` 的 projectDir 根）。按 flavor 分发放 `app/src/<flavor>/google-services.json`，**深路径优先** | 官方文档明确（位置）+ 插件源码实证（顺序） |
| 多马甲要不要多份 json | **不要**。一份 `google-services.json` 的 `client[]` 数组可以装多个包名，插件按 `applicationId` **精确匹配**挑一条（无前缀回退）。只要几个马甲在同一个 Firebase 项目下，一份就够 | 插件源码实证 |
| 要不要钱 / 要不要资质 | **不要**。Crashlytics 在 Spark（免费）计划内，**无用量配额、无需绑定支付方式**。建项目只要一个 Google 账号 | 官方文档明确 |
| 建 Android 应用要填什么 | **只有「Android package name」是必填**；App nickname 可选；**SHA-1 对 Crashlytics 不需要**（只有 Google 登录 / 手机号登录 / Dynamic Links 才要） | 官方文档明确 |
| 能不能上报自定义堆栈文本 | **Android 上不能**——SDK 没有这个 API（iOS 有 `ExceptionModel` + `StackFrame`，Android 没有对应物）。只能造一个 `Throwable` 再 `setStackTrace(StackTraceElement[])` 塞进 `recordException` | 源码实证（Android 无此 API）+ 文档推断（变通做法） |
| minSdk 对不对得上 | **对不上**。Cocos 模板 `PROP_MIN_SDK_VERSION=21`，Firebase 官方前置条件是「Uses Android 6.0 or higher」= **API 23**。要在 `native/…/app/build.gradle` 的 `defaultConfig` 里覆盖成 23 | 官方文档明确（要求）+ 仓内实测（模板值） |
| Java 版本 | **对得上**。firebase-crashlytics 自身 `sourceCompatibility = VERSION_1_8`，Cocos 模板也是 `VERSION_1_8` | 源码实证 + 仓内实测 |
| `google-services.json` 该不该入库 | **该入库**。Google 原话：「API keys for Firebase services are OK to include in code or checked-in config files.」 | 官方文档明确 |

---

## 零、这次的证据等级

沿用依赖文档的标注：**官方文档明确** / **源码实证** / **仓内实测** / **文档推断** / **待实测**。

「源码实证」这次有两处：`google/play-services-plugins` 的 `GoogleServicesPlugin.kt` / `GoogleServicesTask.kt`（决定 json 找哪里、怎么挑 client），
以及 `firebase/firebase-android-sdk` 的 `FirebaseCrashlytics.java`（决定公开 API 有哪些、限制是多少）。
这两处比文档权威——文档只举例子，源码给的是完整判据。

---

## 一、两个 gradle plugin 落在哪

### 1.1 官方要求的写法（先摆出来）

**官方文档明确**（[Get started with Firebase Crashlytics · Android](https://firebase.google.com/docs/crashlytics/android/get-started)）：

根（项目级）`build.gradle.kts`：

```kotlin
plugins {
    id("com.android.application") version "8.1.4" apply false
    id("com.google.gms.google-services") version "4.5.0" apply false
    id("com.google.firebase.crashlytics") version "3.0.8" apply false
}
```

同一页给了老式写法（原文标注 "Legacy buildscript syntax (if using older Gradle)"）：

```groovy
buildscript {
    dependencies {
        classpath 'com.google.gms:google-services:4.5.0'
        classpath 'com.google.firebase:firebase-crashlytics-gradle:3.0.8'
    }
}
```

模块（app 级）`build.gradle`：

```kotlin
plugins {
    id("com.android.application")
    id("com.google.gms.google-services")
    id("com.google.firebase.crashlytics")
}

dependencies {
    implementation(platform("com.google.firebase:firebase-bom:34.18.0"))
    implementation("com.google.firebase:firebase-crashlytics")
    implementation("com.google.firebase:firebase-analytics")
}
```

同页 "Before you begin" 的最低要求（**官方文档明确**）：**Gradle 8.0**、**Android Gradle plugin 8.1.0**、**Google services Gradle plugin 4.4.1**。

### 1.2 与 Cocos 3.8.7 模板对账

**仓内实测**（`apps/demo/native/engine/android/` 与 Creator 3.8.7 的模板目录）：

| 项 | Cocos 3.8.7 实际值 | 出处 | Crashlytics v3 要求 | 是否满足 |
|---|---|---|---|---|
| Gradle wrapper | **8.0.2** | `<Creator>/…/templates/android/build/gradle/wrapper/gradle-wrapper.properties`：`gradle-8.0.2-bin.zip` | ≥ 8.0 | ✅ |
| AGP | **8.0.2** | `build/android/proj/build.gradle` 的 `classpath 'com.android.tools.build:gradle:8.0.2'`（产物）；`native/engine/android/build.gradle` 里也写着同一个版本 | ≥ 8.1.0 | ❌ **差一个小版本** |
| `compileSdkVersion` | 34 | `PROP_COMPILE_SDK_VERSION=34` | — | — |
| `targetSdkVersion` | 34 | `PROP_TARGET_SDK_VERSION=34` | — | — |
| `minSdkVersion` | **21** | `PROP_MIN_SDK_VERSION=21`（模板写死，构建面板不暴露） | 见 §6 | ❌ |
| `buildToolsVersion` | 34.0.0 | `PROP_BUILD_TOOLS_VERSION=34.0.0` | — | — |
| Java 源码级别 | `VERSION_1_8` | `app/build.gradle` 的 `compileOptions` | 见 §6 | ✅ |

> **AGP 8.0.2 vs 8.1.0 这一条是本次调研最硬的约束。** 差的是一个 minor，但 Crashlytics v3 明确把它当门槛：
> 「The Crashlytics Gradle plugin v3 has the following minimum requirements: Android Gradle plugin 8.1+ [and] Firebase's `google-services` Gradle plugin 4.4.1+」
> （[Upgrade to Crashlytics Gradle plugin v3](https://firebase.google.com/docs/crashlytics/upgrade-to-crashlytics-gradle-plugin-v3)，**官方文档明确**）。
> 同一页给了退路：老 Gradle/AGP 用 **v2.9.9**（v2 线最后一版）。

**为什么不能简单地把 AGP 升上去**：AGP 的 classpath 声明在 **`apps/demo/build/android/proj/build.gradle`**，那是**产物**——
`copyPlatformTemplate()` 只在 `proj/` 不存在时拷一次（`overwrite: false`），所以手改能活到下次删 `build/` 为止，
而 `build/` 是 gitignore 的、每个 worktree / CI 各自重新生成。改它 = 改一个不跟仓库走的文件。
（依赖文档 §1.1、§1.3 已给出源码实证。）持久化的唯一候选是 `build-templates/`，但**具体映射路径未验**，见 §9 待实测 B。

### 1.3 为什么 classpath 必须写在 **模块级**，不能写项目级

反直觉但关键：`apps/demo/native/engine/android/build.gradle`（源，我们能改的那份）**不是根构建脚本**。
它是被产物 `proj/build.gradle` 用 `apply from: NATIVE_DIR + "/build.gradle"` **拉进来的一段脚本**：

```groovy
// build/android/proj/build.gradle（产物，模板原样）
buildscript { repositories { google(); mavenCentral() }
              dependencies { classpath 'com.android.tools.build:gradle:8.0.2' } }
apply from: NATIVE_DIR + "/build.gradle"
```

而 Gradle 有一条长期限制：**`apply from:` 进来的脚本里的 `buildscript { }` 只影响那个脚本自己的 classpath，
不会加进被应用工程（以及它的子工程）的 buildscript classpath**，因此 `:app` 里 `apply plugin: '<id>'` 看不见它。
原始诉求 [GRADLE-2628](https://issues.gradle.org/browse/GRADLE-2628.html) 被标 **Won't Fix**，
后续 [gradle/gradle#1262](https://github.com/gradle/gradle/issues/1262)「Third-party plugins cannot be applied by ID from external build scripts」同样确认。
**可信度：Gradle 官方 issue 明确 + 文档推断**（没有一处官方 user guide 正面写这句话，结论来自 issue tracker 的裁决与社区一致复现）。

> 这条同时解释了一个此前只是「文档推断」的老结论（依赖文档 §4.1 括号里那句）：
> `native/engine/android/build.gradle` 里那段 `buildscript { classpath 'com.android.tools.build:gradle:8.0.2' }` **实际上是死代码**——
> 真正给 `:app` 提供 AGP 的是产物 `proj/build.gradle`。两处版本号恰好相同，所以从来没人发现。
> **推论：想通过改这份源文件来换 AGP 版本，是无效的**（会静默无效，不报错）。**待实测 A**。

**因此推荐落点**（**文档推断**，Gradle 标准语义：每个 project 的构建脚本都有自己的 `ScriptHandler`，
子工程 buildscript classpath 继承根工程并可自行追加，同一脚本内 `apply plugin:` 能解析到）：

```groovy
// apps/demo/native/engine/android/app/build.gradle —— 源文件，Creator 每次构建只对它做
// `com.cocos.helloworld` → 真包名 的定点替换，加什么都不会被吃掉
import org.apache.tools.ant.taskdefs.condition.Os

buildscript {
    repositories { google(); mavenCentral() }          // ← 必须自己写；allprojects.repositories 管的是
    dependencies {                                      //    依赖解析，不管 buildscript classpath
        classpath 'com.google.gms:google-services:4.5.0'
        classpath 'com.google.firebase:firebase-crashlytics-gradle:2.9.9'
    }
}

apply plugin: 'com.android.application'
// …模板原有内容不动…

dependencies {
    // …模板原有 5 条不动…
    implementation platform('com.google.firebase:firebase-bom:<见 §6 选版>')
    implementation 'com.google.firebase:firebase-crashlytics'
    implementation 'com.google.firebase:firebase-analytics'
}

// 惯例放文件末尾
apply plugin: 'com.google.gms.google-services'
apply plugin: 'com.google.firebase.crashlytics'
```

`google()` 与 `mavenCentral()` 两个仓库源在 `native/engine/android/build.gradle` 的 `allprojects` 里已有，
但那是给**依赖解析**用的；`buildscript` 块要自己再声明一次。两个插件都发布在 Google Maven（`google()`）。

### 1.4 v2 与 v3 的写法差异（选了 2.9.9 就要用 v2 的写法）

**官方文档明确**（v3 升级页）：v3「Removed the extension from the `defaultConfig` android block. Instead, you should configure each variant.」
也就是说 **v2 的 `firebaseCrashlytics { }` 扩展写在 `buildTypes.<variant>` 里**：

```groovy
buildTypes {
    release {
        // …模板原有 minifyEnabled true / shrinkResources true / proguardFiles… 不动
        firebaseCrashlytics {
            mappingFileUploadEnabled true     // 默认就是 true，写出来是为了显式
            // nativeSymbolUploadEnabled true // 见 §5，暂不开
        }
    }
    debug {
        firebaseCrashlytics { mappingFileUploadEnabled false }   // debug 不混淆，省一次上传
    }
}
```

v3 另外一处破坏性变更：「Removed the deprecated field `strippedNativeLibsDir`. Instead, you should use `unstrippedNativeLibsDir`」——
这条只在开 NDK 符号上传时才碰得到（§5）。

### 1.5 混淆：Cocos 的 release 默认开 R8，有两条必须补的规则

**仓内实测**：`native/…/app/build.gradle` 的 `release` 是 `minifyEnabled true` + `shrinkResources true`。
**官方文档明确**（[Get readable crash reports · Android](https://firebase.google.com/docs/crashlytics/android/get-deobfuscated-reports)）：

- mapping 上传是**自动**的：「The Crashlytics Gradle plugin can automatically detect when you obfuscate your code. When your build generates a mapping file, the plugin uploads it…」
- 但 ProGuard 配置必须保住两样东西：

```proguard
-keepattributes SourceFile,LineNumberTable
-keep public class * extends java.lang.Exception
```

**仓内实测**：`apps/demo/native/engine/android/app/proguard-rules.pro` 当前**没有** `-keepattributes SourceFile,LineNumberTable`
（只有一堆 `-keep class`／`-dontwarn`，其中 `-keep public class com.google.** { *; }` 顺带把 Crashlytics 的类都保住了）。
不补这一行，release 包上报的堆栈**没有文件名和行号**——而 debug 包一切正常，又是一个只在出正式包时现形的坑。

---

## 二、`google-services.json` 放哪

### 2.1 官方说法

**官方文档明确**（[The Google Services Gradle Plugin](https://firebase.google.com/docs/android/google-services-plugin-and-file)）：
常规位置是模块（app 级）根目录；「As of version `2.2.0` the plugin supports build type and product flavor specific JSON files」，并给了合法目录示例：

```
app/
    google-services.json
    src/dogfood/google-services.json
    src/release/google-services.json
    src/dogfood/paid/google-services.json
    src/release/free/google-services.json
```

找不到时的报错原文：`File google-services.json is missing from module root folder. The Google Services Plugin cannot function without it`。
插件的产出是 Android 资源（`values.xml` 里的 `google_app_id` / `gcm_defaultSenderId` / `firebase_database_url` 等）。

⚠️ **官方文档没有写明这些位置之间的优先级顺序**——它只列了「哪些位置合法」。顺序得看源码。

### 2.2 完整搜索顺序（**源码实证**）

`google/play-services-plugins` 的 `GoogleServicesPlugin.kt`：

```kotlin
fun getJsonLocations(buildType: String, flavorNames: List<String>): List<String> {
  var fileLocations: MutableList<String> = ArrayList()
  val flavorName = flavorNames.stream().reduce("") { a, b -> a + if (a.isEmpty()) b else b.capitalized() }
  fileLocations.add("")
  fileLocations.add("src/$flavorName/$buildType")
  fileLocations.add("src/$buildType/$flavorName")
  fileLocations.add("src/$flavorName")
  fileLocations.add("src/$buildType")
  fileLocations.add("src/" + flavorName + buildType.capitalized())
  fileLocations.add("src/$buildType")
  var fileLocation = "src"
  for (flavor in flavorNames) {
    fileLocation += "/$flavor"
    fileLocations.add(fileLocation)
    fileLocations.add("$fileLocation/$buildType")
    fileLocations.add(fileLocation + buildType.capitalized())
  }
  return fileLocations
      .distinct()
      .sortedByDescending { path -> path.count { it == '/' } }
      .map { location -> if (location.isEmpty()) location + JSON_FILE_NAME else "$location/$JSON_FILE_NAME" }
}
```

判据三句话：

1. **按路径里 `/` 的个数降序排**——**越深越优先**，第一个存在的文件胜出；
2. 因此对 flavor `vest` + buildType `release`，实际顺序大致是
   `src/vest/release/` → `src/release/vest/` → `src/vestRelease/`（camelCase 拼接）→ `src/vest/` → `src/release/` → 模块根；
3. 这些路径是**字面量、相对 `:app` 的 projectDir**，**与 `sourceSets` 无关**。

### 2.3 换算到本工程的真实路径

`:app` 的 `projectDir` 是 **`apps/demo/native/engine/android/app`**（`settings.gradle` 里
`project(':app').projectDir = new File(NATIVE_DIR, 'app')`，依赖文档 §1.2 已实证）。于是：

```
apps/demo/native/engine/android/app/google-services.json                 ← 默认落点
apps/demo/native/engine/android/app/src/<flavor>/google-services.json    ← 按马甲分发
apps/demo/native/engine/android/app/src/<flavor>/release/google-services.json
```

⚠️ **别放 `native/engine/android/src/`**（那个 `../src`）。Cocos 的 `sourceSets.main.java.srcDirs "../src", "src"` 让 Java 类两处都能编，
但 google-services 插件**不读 sourceSets**，只按上面那串字面量路径找——`../src` 永远不会被搜到。**源码实证**。

### 2.4 多马甲：一份 json 就够（这条直接影响 flavor 组装那张票）

**源码实证**，`GoogleServicesTask.kt` 的 `getClientForPackageName`：遍历 json 的 `client[]` 数组，
用 `applicationId.get() == clientPackageName.asString` 做**精确字符串比对**，**没有前缀回退**；找不到就抛
`No matching client found for package name '<applicationId>' in <path>`。

推论（**源码实证 → 文档推断**）：

- 几个马甲若在**同一个 Firebase 项目**下，只要在 Firebase 控制台把每个包名都注册成一个 Android 应用，
  下载到的那**一份** `google-services.json` 就含有全部 `client[]` 条目 → **放模块根一份即可，不需要 `src/<flavor>/`**；
- 只有当马甲要落在**不同 Firebase 项目**（不同的数据看板 / 不同的团队权限）时，才需要 `src/<flavor>/google-services.json` 各一份；
- ⚠️ `applicationIdSuffix`（例如 debug 包加 `.debug`）会让 `applicationId` 变成 `com.cck.demo.debug`，**精确匹配就挂了**——
  要么别加后缀，要么在控制台把带后缀的包名也注册一个应用。Cocos 模板里那行 `// applicationIdSuffix ".debug"` 目前是注释掉的（**仓内实测**），保持注释状态即可。

> 另注：Cocos 模板的 `:app` **目前没有任何 productFlavor**，而 `buildDir` 被改到了 `${RES_PATH}/proj/build/${project.name}`、
> `externalNativeBuild` 绑着 cmake。加 flavor 会不会把 cmake / assets 路径搅乱，属另一张票的范围，**待实测**。

---

## 三、建项目要什么：钱、资质、字段

**官方文档明确**（[Firebase pricing](https://firebase.google.com/pricing)）：

- Crashlytics 属 **Spark（免费）计划**覆盖的服务之一（同批还有 A/B Testing、Analytics、App Check、App Distribution、
  Cloud Messaging、In-App Messaging、Performance Monitoring）；
- 该页对 Crashlytics 标的是 **"No-cost"**，**没有列任何用量配额**；
- Spark 计划 **"No payment method needed"** —— **不需要绑卡、不需要开 Blaze、不需要主体资格材料**。

**官方文档明确**（[Add Firebase to your Android project](https://firebase.google.com/docs/android/setup)）注册 Android 应用时的字段：

| 字段 | 必填？ | 原文 |
|---|---|---|
| **Android package name** | **必填** | "a package name uniquely identifies your app on the device and in the Google Play Store"；注册后**不可更改**、大小写敏感 |
| App nickname | *(Optional)* | "an internal, convenience identifier that is only visible to you in the Firebase console" |
| Debug signing certificate SHA-1 | **可选，且 Crashlytics 用不到** | 见下 |

SHA-1 的确切用途（**官方文档明确**，[Android 疑难解答与常见问题](https://firebase.google.com/docs/android/troubleshooting-faq)）：

> "SHA-1 information is required by Firebase Authentication (when using Google signin or phone number signin) and Firebase Dynamic Links. If you're not using these features, you don't have to provide a SHA-1."

也就是说：**这张票（Crashlytics）不需要 SHA-1**；**Google 登录那张票需要**，且上线时要把
release keystore 的 SHA-1 **和** Google Play Console 应用签名的 SHA-1 **两个**都填进去。

本工程当前包名（**仓内实测**）：`APPLICATION_ID = com.cck.demo`（`namespace` 与 `applicationId` 同源）。

---

## 四、非致命异常 API：精确签名与上限

### 4.1 公开方法全集（**源码实证**，`FirebaseCrashlytics.java`）

```java
public void recordException(@NonNull Throwable throwable)
public void recordException(@NonNull Throwable throwable, @NonNull CustomKeysAndValues keysAndValues)

public void log(@NonNull String message)
public void setUserId(@NonNull String identifier)

public void setCustomKey(@NonNull String key, boolean value)
public void setCustomKey(@NonNull String key, double  value)
public void setCustomKey(@NonNull String key, float   value)
public void setCustomKey(@NonNull String key, int     value)
public void setCustomKey(@NonNull String key, long    value)
public void setCustomKey(@NonNull String key, @NonNull String value)
public void setCustomKeys(@NonNull CustomKeysAndValues keysAndValues)

public boolean didCrashOnPreviousExecution()
public boolean isCrashlyticsCollectionEnabled()
public void setCrashlyticsCollectionEnabled(boolean enabled)
public void setCrashlyticsCollectionEnabled(@Nullable Boolean enabled)   // null = 回退到 manifest 配置

@NonNull public Task<Boolean> checkForUnsentReports()
public void sendUnsentReports()
public void deleteUnsentReports()
```

获取实例：`FirebaseCrashlytics.getInstance()`。

> ⚠️ 注意官方文档页把第一个重载写成 `recordException(Exception e)`，**源码里是 `Throwable`**——
> 以源码为准（能收 `Error`，不只是 `Exception`）。

### 4.2 限制（**源码实证**的 javadoc 原文 + **官方文档明确**的补充）

| 项 | 上限 | 超了会怎样 | 出处 |
|---|---|---|---|
| 自定义键值对数量 | **64**（app 级 + 单条事件级**合计**） | "New keys beyond that limit are ignored"（**丢弃新键**，不是覆盖旧键） | javadoc |
| 单个 key / value 长度 | **1024 字符** | "Keys or values that exceed 1024 characters are truncated" | javadoc |
| `setUserId` 长度 | **1024 字符** | "Identifiers longer than 1024 characters will be truncated" | javadoc |
| 日志总量 | **64 KB** | "the log rolls such that messages are removed, starting from the oldest"（**从最老的开始丢**） | javadoc |
| 单条日志长度 | 无独立上限，受 64 KB 总量约束 | — | javadoc（未提及单条上限） |
| 每次会话保留的非致命事件数 | **最近 8 条** | "Crashlytics only stores the most recent eight recorded exceptions" | [Customize crash reports · Android](https://firebase.google.com/docs/crashlytics/android/customize-crash-reports) |

> **「最近 8 条」是给 JS 异常上报设计方案时最要紧的一条。** 一次会话里 JS 抛 50 个异常，只有最后 8 个会进后台。
> 客户端侧需要自己做**去重 / 采样 / 聚合**（例如同一 message+首帧只报一次），别指望服务端替你收敛。**文档推断**。
> 另外「64 个 key 满了之后新 key 被静默忽略」也意味着：**不要拿 key 存每次异常都变的东西**（如 `errorId`），
> 那类信息应该走 `log()` 或异常 message。

### 4.3 能不能上报一段自定义的堆栈文本

**结论：Android SDK 上不能，没有 `setCustomStackTrace` 之类的 API。** —— **源码实证**：
§4.1 那份公开方法全集里，唯一能带堆栈的入口就是 `recordException(Throwable …)`，参数只能是 `Throwable`；
没有任何方法接收 `String` 形式的堆栈或帧数组。

**对照：iOS 有。** **官方文档明确**（[Customize your Apple crash reports](https://firebase.google.com/docs/crashlytics/ios/customize-crash-reports)）——
而且它的官方示例用的正是 JS 引擎的场景：

```swift
var ex = ExceptionModel(name:"FooException", reason:"There was a foo.")
ex.stackTrace = [
  StackFrame(symbol:"makeError", file:"handler.js", line:495),
  StackFrame(symbol:"then",      file:"routes.js",  line:102),
  StackFrame(symbol:"main",      file:"app.js",     line:12),
]
crashlytics.record(exceptionModel:ex)
```

`ExceptionModel` / `FIRExceptionModel` + `StackFrame` / `FIRStackFrame` + `record(exceptionModel:)` / `recordExceptionModel:`
——**Android 侧没有任何一个对应物**。

**Android 上的变通做法**（**文档推断**，用的是 Java 标准 API，非 Firebase 提供的通道）：
自己造一个 `Throwable`，把 JS 帧翻译成 `StackTraceElement` 数组塞进去。`Throwable.setStackTrace(StackTraceElement[])`
是 `java.lang` 的公开 API，而 Crashlytics 序列化时读的就是 `throwable.getStackTrace()`：

```java
// 形状示意（本次不落代码，仅记结论）
Throwable t = new Throwable(jsMessage);   // 或自定义子类，让后台看到有意义的异常类型名
t.setStackTrace(new StackTraceElement[] {
    new StackTraceElement(/*declaringClass*/ "game", /*methodName*/ "makeError",
                          /*fileName*/ "handler.js", /*lineNumber*/ 495),
    // …逐帧翻译 JS 的 error.stack…
});
t.setStackTrace(frames);
FirebaseCrashlytics.getInstance().recordException(t);
```

- `StackTraceElement(String declaringClass, String methodName, String fileName, int lineNumber)` 是 Java 8 起就有的公开构造器；
- Crashlytics 后台按「异常类型名 + 首帧」聚类，所以 `declaringClass` / `methodName` 怎么填直接决定分组是否合理；
- **`-keep public class * extends java.lang.Exception`**（§1.5 那条官方 ProGuard 规则）正是为了让自定义异常类型名在 release 包里不被改名。
- **待实测 C**：这条路径 Firebase 后台是否原样展示这些伪帧、聚类是否合理、`fileName` 带 `.js` 后缀会不会被特殊处理。
  Firebase 官方**没有为 Android 背书这种用法**，所以标 文档推断，不是官方文档明确。

> 另一条不用伪造堆栈的路：把 JS 的 `error.stack` 整段丢进 `log()`（64 KB 总量内），异常本身用一个薄 `Throwable` 承载。
> 代价是后台的堆栈面板里看不到，得点进 Logs 标签看。**两条路并不互斥**，实施时可以同时做。

---

## 五、NDK / native 崩溃：边界在哪

本次终点只要 JS 异常，但边界要写清楚（**官方文档明确**，[Get started with Crashlytics for Android NDK](https://firebase.google.com/docs/crashlytics/android/get-started-ndk)）：

| 项 | 内容 |
|---|---|
| 额外依赖 | `implementation("com.google.firebase:firebase-crashlytics-ndk")`，**要单独加** |
| gradle 扩展 | `nativeSymbolUploadEnabled = true`（不开就只有裸地址，没有可读符号）；`unstrippedNativeLibsDir = file("PATH/TO/UNSTRIPPED/DIRECTORY")` |
| 上传任务 | `uploadCrashlyticsSymbolFile<BUILD_VARIANT>`，**必须显式跑**：`./gradlew app:assemble<VARIANT> app:uploadCrashlyticsSymbolFile<VARIANT>`，**每次重新编 NDK 库之后都要跑一次** |
| 非 gradle 通道 | `firebase crashlytics:symbols:upload --app=FIREBASE_APP_ID PATH/TO/SYMBOLS`（Firebase CLI），每出一个 release 包都要做 |
| 前置版本要求 | **Gradle 8.0、AGP 8.1.0、google-services 4.4.1** —— 与 §1.2 同一堵墙，**AGP 8.0.2 过不去** |
| 二进制要求 | native 库必须带 GNU build ID，用 `readelf -n` 验 |

**代价评估**（**文档推断**）：对 Cocos 工程，unstripped 的 `libcocos.so` 是几百 MB 量级的调试符号，
每次出包多一步几分钟的上传；而且 §1.2 那堵 AGP 墙让 v3 插件用不了，v2 的 NDK 支持字段是已废弃的 `strippedNativeLibsDir`。
**结论：这一期不开 NDK 符号上传。** 开了也只能拿到引擎自己的崩溃，跟「JS 异常可见性」这个目标不在一条线上。
真要做，先解决 AGP 升级（§9 待实测 B）。

> 顺带一条边界：**不装 `firebase-crashlytics-ndk`，原生 signal 崩溃（SIGSEGV 等）不会被 Crashlytics 捕获**。
> Cocos 游戏的崩溃有相当比例落在 native 层（引擎、渲染、JSB 绑定），所以「接了 Crashlytics」≠「崩溃都能看到」。
> 这一期能看到的是：**Java 层未捕获异常** + **我们主动 `recordException` 上报的 JS 异常**。

---

## 六、minSdk / Java 版本对账

### 6.1 minSdk：21 → 23，必须改

**官方文档明确**（[Add Firebase to your Android project](https://firebase.google.com/docs/android/setup) 的 Prerequisites）：

> "Targets API level 23 (Marshmallow) or higher"
> "Uses Android 6.0 or higher"
> "Uses Jetpack (AndroidX), which includes meeting these version requirements: `com.android.tools.build:gradle` v7.3.0 or later, `compileSdkVersion` 28 or later"

「Uses Android 6.0 or higher」= **API 23**，而 Cocos 模板是 **`PROP_MIN_SDK_VERSION=21`**（**仓内实测**）。
（旁证：Firebase Android BoM v33.0.0 起把各 SDK 的 `minSdkVersion` 提到了 23 —— 这一条**在官方 release notes 页上没能直接引到原文**，
搜索结果一致这么说但页面被截断，标 **文档推断**；不过上面那两句 Prerequisites 本身已经是官方文档明确。）

**改法**（沿用依赖文档 §4.2 的结论）：**不能**改产物 `build/android/proj/gradle.properties` 的 `PROP_MIN_SDK_VERSION`（每次构建 regex 重写必被覆盖），
要在源文件 `apps/demo/native/engine/android/app/build.gradle` 的 `defaultConfig` 里覆盖：

```groovy
defaultConfig {
    applicationId APPLICATION_ID
    minSdkVersion 23          // ← 覆盖 PROP_MIN_SDK_VERSION（Groovy 后写的赢）
    targetSdkVersion PROP_TARGET_SDK_VERSION
    // …
}
```

> 🔗 **和另一张票撞在同一个数字上**：`docs/research/2026-09-03-android-credential-manager-google-signin.md` 记的
> androidx credentials 1.6.0 也要 **minSdk 23**，上一轮就是被它咬的（构建期直接失败）。
> **两张票需要的是同一次改动**，做一次即可，别各改各的。
> 不改的失败形态（**待实测 D**）是 manifest merger 报
> `uses-sdk:minSdkVersion 21 cannot be smaller than version 23 declared in library [...]`，**构建期就炸，不会拖到运行时**——
> 这算好事：不存在「装到 Android 5 的机器上才崩」的沉默失败。

### 6.2 Java：对得上，不用动

**源码实证**（`firebase/firebase-android-sdk` 的 `firebase-crashlytics/firebase-crashlytics.gradle`）：
`compileOptions { sourceCompatibility JavaVersion.VERSION_1_8; targetCompatibility JavaVersion.VERSION_1_8 }`。
Cocos 模板的 `app/build.gradle` 也是 `VERSION_1_8`（**仓内实测**）。**无需 desugaring、无需升 Java 语言级别。**

（区分两件事：**跑 Gradle 需要 JDK 17**——那是 AGP 8.x 的要求，本工程已经是 JDK 17（依赖文档 §4.3 实测）；
**编译 app 代码的语言级别**是 Java 8，Firebase 也只要 Java 8。两者互不冲突。）

---

## 七、`google-services.json` 该不该入库

**该入库。** **官方文档明确**（[Learn about using and managing API keys for Firebase](https://firebase.google.com/docs/projects/api-keys)），原文：

> "API keys for Firebase services are OK to include in code or checked-in config files."

> "If your app's setup follows the above guidelines, then API keys restricted to Firebase services do not need to be treated as secrets."

> "Unlike how API keys are typically used, API keys for Firebase services are not used to control access to backend resources; that can only be done with Firebase Security Rules and Firebase App Check."

> "None of the Firebase-related APIs use an API key as authorization for calling the API. The API key passed with the API call is only used for identification of the Firebase project or app."

> "Security of your Realtime Database, Cloud Firestore, and Cloud Storage data is enforced using Firebase Security Rules, and protection of covered APIs is by Firebase App Check — not by keeping your Firebase API key secret."

**结论与推论**：

- `google-services.json` 进 git，与 `native/` 目录本身该不该入库是**同一个决定**（依赖文档「待办 A」）——
  它要放在 `apps/demo/native/engine/android/app/`，`native/` 不入库它就不入库；
- 真正的防线不是藏 key，而是 **Firebase App Check**（如果以后接了 Firestore / Storage 之类的后端服务）；
  Crashlytics 只往上写崩溃数据，**没有可被读取的用户数据**，风险面很小；
- ⚠️ 仍然要区分：**这条豁免只覆盖 "API keys restricted to Firebase services"**。
  service account 的 JSON 私钥（`firebase-adminsdk-*.json`）、Google Play 服务账号密钥**绝对不能入库**——那是另一类东西。

---

## 八、动手清单（文件级，供实施票参考；本次未改任何代码）

全部在 `apps/demo/native/engine/android/`，全部是**源**、不会被 Creator 构建吃掉（判据见依赖文档 §1.3）：

```
app/build.gradle           改：① 顶部加 buildscript{} 声明两个插件 classpath（4.5.0 / 2.9.9）
                              ② defaultConfig 覆盖 minSdkVersion 23
                              ③ dependencies 加 firebase-bom + firebase-crashlytics (+ firebase-analytics)
                              ④ buildTypes.release/debug 里加 firebaseCrashlytics{} 扩展（v2 写法）
                              ⑤ 文件末尾 apply plugin: google-services / firebase.crashlytics
app/google-services.json   新增：从 Firebase 控制台下载（含所有马甲包名的 client[]）
app/proguard-rules.pro     改：补 -keepattributes SourceFile,LineNumberTable
                                 与 -keep public class * extends java.lang.Exception
app/src/com/cck/bridge/…   新增：JS→Java 的 Crashlytics 桥（jsb.reflection 入口，需 -keep，见依赖文档 §5/§6）
```

**不用碰**：`AndroidManifest.xml`（`INTERNET` 权限模板已有——**仓内实测**；Crashlytics 自动初始化靠
`ContentProvider` 合并进来，不需要手写 `<meta-data>`，除非要关自动采集）、`native/engine/android/build.gradle`（项目级，
往里加 classpath **无效**，见 §1.3）、`build/**` 下的一切（产物）。

TS 侧按本仓铁律分层：`packages/core` 只认接口（零 `cc`），`native.reflection` 调用封在 `packages/engine`，
Web / 小游戏给另一套实现或 no-op。

---

## 九、待实测 / 未查到清单

| # | 事项 | 为什么要紧 | 现状 |
|---|---|---|---|
| **A** | `native/engine/android/build.gradle` 里那段 `buildscript{classpath AGP}` 是否真的是死代码（`apply from` 语义） | 决定 §1.3 的落点结论是否正确；也决定 AGP 能不能从源文件升 | Gradle issue 明确「不允许」，但没在本工程实跑验证。配方：往那段 buildscript 加一个假 classpath，看 `:app` 里 `apply plugin` 能否解析 |
| **B** | Creator `build-templates/` 覆盖 `build/android/proj/build.gradle` 的确切映射路径 | 决定 **AGP 8.0.2 → 8.1+ 能不能持久化**；能则可用 Crashlytics v3 + BoM 34.18.0，NDK 符号上传也解锁 | 已知 `build-templates/native/index.ejs` 是官方覆盖点（ADR-0006 实测），但那是 ejs 模板替换、不是目录镜像。`proj/` 层的映射**未验**。与 credentials 票的待办 4 是同一件事 |
| **C** | 伪造 `StackTraceElement[]` 上报 JS 堆栈，Firebase 后台的展示与聚类效果 | 决定 §4.3 那条路可不可用；不可用就只能把堆栈塞 `log()` | Firebase 官方未为 Android 背书此用法；iOS 有一等公民 API 反证这个需求是被认可的 |
| **D** | minSdk 21 不改时的确切失败形态 | 确认是构建期硬失败（好）而非运行时崩溃（坏） | 推断是 manifest merger 报错，未实跑 |
| **E** | `firebase-crashlytics-gradle:2.9.9` 与 AGP 8.0.2 的实际兼容性 | 整条方案的地基 | 官方只说 v2 是「老 Gradle/AGP」的退路，没给 v2 的**最低/最高** AGP 矩阵；社区反馈 2.9.3 起「改善了 AGP 8 兼容性」。**必须先跑一次 `assembleDebug` 验证** |
| **F** | 搭配 2.9.9 该用哪个 `firebase-bom` 版本 | BoM 34.18.0 的 crashlytics 是 20.1.0，是否要求插件 v3，**官方没有明确表述**；搜索结果的「20.x 需要 v3」是推断不是原文 | 需要实测；若不兼容则退到 v2 时代的 BoM（其 crashlytics 为 19.x 线） |
| **G** | Crashlytics Gradle 插件是不是**强制**的（只上报非致命、不要反混淆的话能否不装） | 若非强制，AGP 那堵墙可以整个绕过 | 官方 get-started 把它列为必需步骤；「不装会怎样」官方文档未正面回答 |
| **H** | `:app` 加 productFlavor 后，Cocos 写死的 `buildDir` / `externalNativeBuild` / `assets.srcDir` 是否还成立 | flavor 组装那张票的地基 | 属另一张票范围 |

---

## 参考

**Firebase 官方**

- [Get started with Firebase Crashlytics · Android](https://firebase.google.com/docs/crashlytics/android/get-started) —— 插件版本、最低 Gradle/AGP、依赖清单
- [Upgrade to Crashlytics Gradle plugin v3](https://firebase.google.com/docs/crashlytics/upgrade-to-crashlytics-gradle-plugin-v3) —— **AGP 8.1+ 门槛**、v2→v3 破坏性变更
- [Customize your Android crash reports](https://firebase.google.com/docs/crashlytics/android/customize-crash-reports) —— 64 键 / 1 KB / 64 KB 日志 / 最近 8 条非致命
- [Customize your Apple crash reports](https://firebase.google.com/docs/crashlytics/ios/customize-crash-reports) —— `ExceptionModel` + `StackFrame`（Android 无对应物的对照）
- [Get readable crash reports · Android](https://firebase.google.com/docs/crashlytics/android/get-deobfuscated-reports) —— mapping 自动上传、`mappingFileUploadEnabled`、两条 ProGuard 规则
- [Get started with Crashlytics for Android NDK](https://firebase.google.com/docs/crashlytics/android/get-started-ndk) —— NDK 依赖、符号上传任务、版本门槛
- [Add Firebase to your Android project](https://firebase.google.com/docs/android/setup) —— 前置条件（API 23 / AGP 7.3 / compileSdk 28）、注册字段、BoM 34.18.0
- [The Google Services Gradle Plugin](https://firebase.google.com/docs/android/google-services-plugin-and-file) —— 4.5.0、json 合法位置、缺失报错、产出的 values.xml
- [Android 疑难解答与常见问题](https://firebase.google.com/docs/android/troubleshooting-faq) —— SHA-1 到底哪些产品要
- [Firebase pricing](https://firebase.google.com/pricing) —— Spark 计划、Crashlytics "No-cost"、"No payment method needed"
- [Learn about using and managing API keys for Firebase](https://firebase.google.com/docs/projects/api-keys) —— **json 入库的官方原话**

**源码（比文档权威）**

- `google/play-services-plugins`：[`GoogleServicesPlugin.kt`](https://github.com/google/play-services-plugins/blob/main/google-services-plugin/src/main/kotlin/com/google/gms/googleservices/GoogleServicesPlugin.kt)（`getJsonLocations` 搜索顺序）、
  [`GoogleServicesTask.kt`](https://github.com/google/play-services-plugins/blob/main/google-services-plugin/src/main/kotlin/com/google/gms/googleservices/GoogleServicesTask.kt)（`getClientForPackageName` 精确匹配）、
  [`README.md`](https://github.com/google/play-services-plugins/blob/main/google-services-plugin/README.md)（AGP 7.3.0+）
- `firebase/firebase-android-sdk`：[`FirebaseCrashlytics.java`](https://github.com/firebase/firebase-android-sdk/blob/main/firebase-crashlytics/src/main/java/com/google/firebase/crashlytics/FirebaseCrashlytics.java)（公开方法与 javadoc 限制）、
  `firebase-crashlytics/firebase-crashlytics.gradle`（`VERSION_1_8`）

**Gradle 语义**

- [GRADLE-2628 "Allow build script classpath to be adjusted in script plugins"](https://issues.gradle.org/browse/GRADLE-2628.html)（**Won't Fix**）
- [gradle/gradle#1262 "Third-party plugins cannot be applied by ID from external build scripts"](https://github.com/gradle/gradle/issues/1262)

**仓内**

- `docs/research/2026-09-03-cocos-native-android-template.md`（源 vs 产物、Java 类落点、ProGuard、JS↔Java 桥）
- `docs/research/2026-09-03-android-credential-manager-google-signin.md`（minSdk 23 的另一处压力）
- `docs/adr/0006-native-android-build-and-hotupdate-e2e.md`、`docs/research/2026-08-17-creator-build-custom-options.md`（build-templates 覆盖点）
- 实测文件：`apps/demo/native/engine/android/{build.gradle, app/build.gradle, app/proguard-rules.pro, app/AndroidManifest.xml}`、
  `<Creator>/resources/resources/3d/engine/templates/android/build/{build.gradle, gradle.properties, gradle/wrapper/gradle-wrapper.properties}`

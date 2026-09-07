---
状态: 已接受
日期: 2026-09-07
依赖: docs/adr/0022-capability-sdk-as-channel-attribute.md, docs/research/2026-09-03-firebase-crashlytics-cocos.md
---

# ADR-0023：不装 Crashlytics gradle plugin 的两个前提（实测）

## 背景

[ADR-0022](0022-capability-sdk-as-channel-attribute.md) 决策 3 决定**不 apply `google-services` 与
`firebase-crashlytics` 这两个 gradle plugin**，配置手写成 `src/google/res/values/firebase.xml`。
当时那条决策**没有一手依据**，是从 `FirebaseOptions.fromResource()` 的行为推断出来的，ADR 自己也
标了「实施时要实测」。

hlgit #50 在真机（Android 14 / x86_64 模拟器）上把它验了。结论：**决策成立，但缺两个前提，
少任何一个 google 包都跑不起来** —— 而且两个都不是「上报失败」这种软失败。

## 决策

### 1. `google-services` plugin 确实不需要 —— 已实证

手写六条 string 之后：

```
I FirebaseApp: Device unlocked: initializing all Firebase APIs for app [DEFAULT]
I CckReport: FirebaseApp 就绪：[DEFAULT] / 1:414118306834:android:83858c7e299a54a00024cb
```

`FirebaseInitProvider` 这个 ContentProvider 自动跑 `FirebaseApp.initializeApp()`，读的就是那几个
string 资源。plugin 干的事只是把 `google-services.json` 转成它们。**ADR-0022 决策 3 的这一半从
推断升级为实证。**

### 2. `firebase-crashlytics` plugin 也不需要，但**必须显式关掉 build id 检查**

不加会**启动即崩**，不是上报不了：

```
java.lang.IllegalStateException: The Crashlytics build ID is missing.
This occurs when the Crashlytics Gradle plugin is missing from your app's build configuration.
    at CrashlyticsCore.onPreExecute(CrashlyticsCore.java:155)
    at FirebaseCrashlytics.init(FirebaseCrashlytics.java:168)
    at ActivityThread.handleBindApplication
```

开关在 aar 里：`CrashlyticsCore.onPreExecute` 第一句就是
`CommonUtils.getBooleanResourceValue(context, "com.crashlytics.RequireBuildId", true)`（字节码实证）。
所以 `firebase.xml` 里补一条：

```xml
<bool name="com.crashlytics.RequireBuildId">false</bool>
```

⚠️ **名字是 `com.crashlytics.` 不是 `com.google.firebase.crashlytics.`**。aar 常量池里两个都有，
后者是另一处用途；写错了 aapt 不报错、构建照过、**照崩**。

**代价**：没有 build id ⇒ Crashlytics 关联不了 NDK 符号表与 ProGuard mapping。这正是那个 plugin
的全部工作，而本仓要看的是 **JS 堆栈**（两家平台都不还原 JS，见
`docs/research/2026-09-03-cocos-js-stack-reporting.md`），用不上。**Java / native 崩溃的符号化
从此指望不上** —— 真要它的那天，就是把这个 plugin 装回来的那天。

### 3. Firebase BoM 钉在 **33.1.2**，升不动

BoM 34.18.0（Crashlytics 20.1.0）在本仓**启动即崩**：

```
java.lang.NoClassDefFoundError: Failed resolution of: Landroidx/datastore/DataStoreFile;
    at com.google.firebase.sessions.FirebaseSessionsComponent...sessionConfigsDataStore
```

Firebase 自己会先打一段警告点名原因：**AGP ≤ 8.3.2 的纯 Java 工程**
（[issuetracker 328687152](https://issuetracker.google.com/328687152)）解析不出 KMP 化之后的
`androidx.datastore` 的 android 变体。Cocos 3.8.7 模板是 **AGP 8.0.2**，而 AGP 版本声明在
**不入库的构建产物** `build/android/proj/build.gradle` 里（删 `build/` 就重生成），升不动。

BoM 33.1.2（Crashlytics 19.0.3）拉的还是非 KMP 的 `androidx.datastore` 1.0.x，跑得通。

⇒ **想升 Firebase，先解决 AGP 8.0.2 → 8.4+ 能不能持久化**（与 `docs/research/2026-09-03-firebase-crashlytics-cocos.md`
待验清单 B 是同一件事）。在那之前别动这个版本号。

## 后果

- `src/google/res/values/firebase.xml` 从「六条 string」变成「六条 string + 一条 bool」，**那条 bool
  是启动前提，不是优化**。
- Firebase 依赖版本成为一个**被 AGP 锁住的常量**，注释里写明了为什么，别顺手升。
- 这三条都只影响 `report: 'firebase'` 的渠道；国内那半（Bugly）一条都不涉及 —— 它不需要任何 plugin、
  不需要任何资源、`minSdk` 只要 15。**Firebase 这半的构建期风险比 Bugly 高一个量级**，与 #43/#44
  的调研判断一致。

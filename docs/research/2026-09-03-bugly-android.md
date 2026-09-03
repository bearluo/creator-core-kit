---
状态: 已定稿（纯调研，未改任何代码）
摘要: 国内包崩溃上报选 Bugly 的一手事实。**Bugly 没停服，但分裂成三条线**——免费版（`bugly.qq.com`，QQ 登录、零资质、SDK 停更三年）／专业版（`bugly.tds.qq.com`，必须买资源包才准上报，刊例价 32,000 元/年起）／CrashSight（WeTest，走商务合同）。**只有免费版满足「不要主体资格材料」这条硬约束**。查清了 `com.tencent.bugly:crashreport:4.1.9.3` 的 aar 实证（minSdk 15、arm64 段对齐 64KB、`proguard.txt` 是空的）、`postException(int category, String errorType, String errorMsg, String stack, Map)` —— **这个 API 能直接吃一段自定义堆栈文本，category=8 就是 JS**，正好是 Firebase Crashlytics Android 侧做不到的那件事；以及 Cocos 侧的坏消息（官方 Cocos 插件 2017 年停维护，专业版 cocos2dx 插件只覆盖 cocos2d-x 的 `ScriptingCore`，Creator 3.x 一行都用不上）和好消息（`jsb.onError` 是现成的全局 JS 异常钩子）。
何时读: 要给国内 Android 包接崩溃上报、要判断「JS 堆栈能不能原样送到崩溃平台」、要评估 Bugly 三条产品线该选哪条、或者要复用 §4 的 Java 桥骨架时。
日期: 2026-09-03
依赖: hlgit #43；docs/research/2026-09-03-cocos-native-android-template.md（**先读它**：哪些文件是源、哪些是产物、Java 类与 maven 依赖放哪不会被吃掉）；docs/research/2026-09-03-firebase-crashlytics-cocos.md（海外那半边，本文多处与它对照）；docs/research/2026-09-03-android-credential-manager-google-signin.md（§4 的桥骨架沿用它）
---

# Bugly × Cocos 3.8.7 Android：还在不在、要不要资质、JS 堆栈送不送得进去

## 结论先行

| 问题 | 结论 | 可信度 |
|---|---|---|
| Bugly 2026 还在不在？ | **在，且没有任何停服公告**。但它已经分裂成三条产品线（见 §1），三条的商务门槛天差地别 | 官方站点实证（2026-09-03 逐个抓取） |
| 该选哪条线？ | **免费版 `bugly.qq.com`**。专业版必须买资源包才准上报，CrashSight 走商务合同——两条都要企业主体 | 官方文档明确 |
| 注册要主体资格材料吗？ | **免费版不要**。官方「注册产品」三步：QQ 登录 → 填邮箱/微信号/手机号 → 填应用名称/平台/产品类型/图标/描述。**全程没有营业执照、没有身份证、没有审核** | 官方文档明确（步骤清单）；**真去注册一次才算数 → 待实测** |
| 个人 QQ 号能建产品吗？ | **能**，免费版唯一的身份就是 QQ 号 | 官方文档明确 |
| maven 坐标与版本 | `com.tencent.bugly:crashreport:4.1.9.3`（2023-10-30 发布，**三年没更新了**） | Maven Central 实证 |
| ⚠️ 能不能写 `latest.release`？ | **不能**。官方文档教的就是这个写法，但 Central 的 `maven-metadata.xml` 里 `<release>` = **4.1.9**（2022-09 发布），**比 4.1.9.3 还旧**。必须钉死版本号 | Maven Central 实证 |
| minSdk 要求 | **15**（aar 内 `AndroidManifest.xml` 实证）。Cocos 模板是 21 → **没有冲突**。这是它相对 Firebase（要 23）和 Credential Manager（要 23）的唯一优势 | aar 实证 |
| 要 gradle plugin 吗？ | **不要**。Bugly 的 gradle 插件只服务「热更新(tinker)」和「符号表上传」，崩溃上报本身一个插件都不用 | 官方文档明确 |
| 要加权限吗？ | **一条都不用加**。Bugly 要 `INTERNET` / `ACCESS_NETWORK_STATE` / `ACCESS_WIFI_STATE`，Cocos 3.8.7/3.8.8 的 Android 模板 manifest **正好就这三条** | 官方文档明确 + 模板源码实证 |
| 要加混淆规则吗？ | **要，而且必须自己写**——aar 里的 `proguard.txt` 是 **0 字节**，没有 consumer rules，指望不上自动合并 | aar 实证 |
| **能不能上报自定义堆栈文本？** | **能，这是本次最关键的一条**。`CrashReport.postException(int category, String errorType, String errorMsg, String stack, Map<String,String> extraInfo)` 的 `stack` 就是一段任意 `String`，直接把 JS 堆栈原样塞进去。`category` 官方定义 `u3d c# : 4 ｜ js : 8 ｜ cocos2d lua : 6` → **我们填 8** | 官方文档明确 + aar `javap` 实证 |
| 跟 Firebase 比呢？ | 反过来了。Firebase Crashlytics 的 Android SDK **没有**这个 API（要伪造 `Throwable` + `setStackTrace`），Bugly 有原生的 | 见 firebase 那份 §结论先行 |
| `stack` 有长度上限吗？ | **官方没写**。有明确数字的只有旁路字段：`putUserData` 最多 50 对、key ≤ 50 字节、value ≤ 200 字节（超长截断）；`BuglyLog` 缓存 0–30K、上报最大 30K | 官方文档明确（旁路）；**`stack` 上限 → 待实测** |
| 后台在哪看？ | 免费版控制台的「**错误分析**」。官方术语表：「错误 = 主动上报的 Exception、Error，或脚本(如 C#、Lua、JS 等)错误」 | 官方文档明确 |
| 有官方 Cocos 指引吗？ | **实质上没有**。免费版 Cocos Plugin **2017-06-22 起停止维护**；专业版的 cocos2dx 插件是 cocos2d-x 时代的东西（`ScriptingCore::getInstance()->getGlobalContext()`、`proj.ios_mac`、`frameworks/cocos2d-x/external`），**Creator 3.x 一行都套不上** | 官方文档明确 |
| 那官方怎么说？ | 专业版 cocos 文档原话：「理论上也可以直接接入 iOS/Android 原生 sdk，然后自己封装脚本接口」——**这正是我们要做的** | 官方文档明确 |
| Android 15 的 16KB page size 会炸吗？ | **不会**。免费版 4.1.9.3 的 `arm64-v8a/libBugly_Native.so` LOAD 段 `p_align = 0x10000`（64KB ≥ 16KB） | 本地 ELF 解析实证 |
| 最大的风险 | **不是「会不会停」，是「已经在烂尾」**：免费版 Android SDK 停在 2023-11，游戏插件停在 2017，腾讯的投入全在收费的专业版和 CrashSight 上 | 发布记录实证（推断风险） |

---

## 零、这次的证据等级

沿用姊妹文档的标注：**官方文档明确** / **实证**（本地可复现的硬证据）/ **文档推断** / **待实测**。

这次「实证」有三处，都比文档硬：

1. **aar 解包**——`crashreport-4.1.9.3.aar` 的 `AndroidManifest.xml`（minSdk）、`proguard.txt`（空）、`jni/*/libBugly_Native.so`（ELF 段对齐）。
2. **`javap` 反射 API 表**——`com.tencent.bugly.crashreport.CrashReport` 的公开方法**全表**，比文档全（文档漏了一半）。
3. **Maven Central 元数据**——版本列表与每个版本的 `Last-Modified`，`latest.release` 那个坑就是这么发现的。

复现命令都写在 §2 与 §3 里。

---

## 一、Bugly 2026 年的真实形态：一个名字，三条线

「Bugly 是不是要迁到 CrashSight」这个印象**不准确**。真实情况是腾讯把这个牌子拆成了三份，各有各的站点、各有各的 SDK、各有各的商务门槛，**彼此数据不通**：

| | Bugly 免费版 | Bugly 专业版 | CrashSight |
|---|---|---|---|
| 站点 | `https://bugly.qq.com` | `https://bugly.tds.qq.com` | `https://crashsight.qq.com`（海外 `crashsight.wetest.net`） |
| 归属 | Bugly 原班 | Bugly + Shiply/TDS 体系 | 腾讯 WeTest |
| 身份 | **QQ 号** | 手机号（可与 QQ 号关联迁移） | 邮箱 / 企业微信 |
| Android SDK | `com.tencent.bugly:crashreport` **4.1.9.3**（2023-10-30） | `com.tencent.bugly:bugly-pro` **4.4.8.2**（2026-08-25） | CrashSight Android SDK 4.2.14（**创建项目后才能下载**） |
| 凭证 | 只有 **APP ID** | AppID + AppKey | AppID + AppKey |
| 钱 | **全平台免费** | **必须买资源包**，事件量套餐 6 亿条/年 = 32,000 元/年起；月活套餐 5 万 MAU = 50,000 元/年起 | 商务谈 |
| 门槛 | 无 | 「**如果产品没有绑定生效中的资源包，或者绑定的资源包已经用完，则该产品无法上报数据**」 | 「商务沟通 → 平台开通项目 → SDK 接入 → 试用结束，**签订正式使用合同**后，转正式使用」 |
| 结论 | ✅ **选它** | ❌ 要钱、要发票抬头、要企业主体 | ❌ 要合同 |

### 1.1 没有停服公告，但也没有更新

- `bugly.qq.com` 首页、Android SDK 使用指南、下载页、Android FAQ —— **四个页面逐个抓过，一个字的停服/迁移公告都没有**（2026-09-03）。
- 专业版的「产品动态」栏目里也没有任何「免费版下线」的条目。
- 官方**明说停止维护**的只有具体产物：iOS Extension SDK、watchOS SDK，以及本次最相关的两个——**Unity Plugin 与 Cocos Plugin，原话「本插件已停止维护，不再提供新增服务」，最后版本停在 2017-06-22**，页面直接引导去接专业版。
- 免费版 Android SDK 本体最后一次发版 **2023-11-01（4.1.9.3）**，到今天将近三年。

⇒ 判断：**Bugly 免费版不是「停服」，是「冻结」**。功能不会再长，但也没给下线时间表。对我们「真机抛个异常能在后台看到」这个终点来说，冻结的东西够用；但**不要把它当长期基建**，接入层要留出换后端的余地（§4 的桥只暴露一个 `report(kind, msg, stack)`，换平台只改那一个文件）。

### 1.2 CrashSight 到底是不是 Bugly 的继任者

官方口径里两者是并列产品，不是继承关系。CrashSight 的定位是**游戏**（支持 Switch / PS4&PS5 / Xbox / 主机、Unity/Unreal/Cocos 引擎、国内海外双部署合规），走 WeTest 的商务体系。它的文档写「在『我的项目』页点击『申请创建项目』按钮可自行创建项目，如果需要帮助，内部项目请企业微信搜索『CrashSight 小助手』，**外部项目请咨询邮箱 crashsight@tencent.com**」——外部项目要发邮件，WeTest 产品页的服务流程写得更直白：「商务沟通 → 申请 demo 体验或试用接入 …… 试用结束，**签订正式使用合同**后，转正式使用」。

⇒ **对我们是死路**：签合同必然要企业主体，撞死在硬约束上。

---

## 二、注册与资质：免费版的完整门槛

官方「异常上报功能简介 → 注册产品」把步骤列全了（**官方文档明确**）：

1. **登录**：「使用 **QQ** 登录 Bugly 官网」。
2. **完善开发者信息**：「在创建产品之前完善开发者信息：按照要求填写**邮箱，微信号和手机号**以便及时收到产品的动态」。
3. **创建应用**：「按照要求添加**应用名称、选择应用平台、产品类型、产品图标和描述信息**。**保存后即创建成功**。」

三步里**没有**任何一项要求提供营业执照、身份证、软著、备案号，也**没有人工审核环节**（「保存后即创建成功」）。创建完在产品设置里拿 **APP ID**（免费版只有 APP ID，没有 AppKey——AppKey 是专业版才有的东西）。

**这条是本次调研最要紧的结论，但它的可信度必须说清楚**：

- **官方文档明确**：文档列出的步骤里没有资质材料。
- **待实测**：文档没写 ≠ 实际表单不要。上一轮选渠道登录时踩过的正是这个坑（宣传页说「个人可用」，注册到一半弹出上传营业执照）。**下一步就是拿一个 QQ 号真走一遍到拿到 APP ID 为止**，这比再读十页文档都值。

对照专业版：官方原话是「按要求填写相关信息」，创建后**还得买并绑定资源包才准上报**——**这一步必然要发票抬头/付款主体**，所以专业版不是「贵一点」的问题，是「过不去」的问题。

---

## 三、Android 接入的确切形状

### 3.1 依赖

```gradle
// apps/demo/native/engine/android/app/build.gradle → dependencies { }
implementation 'com.tencent.bugly:crashreport:4.1.9.3'
```

放在哪不会被下次构建吃掉：见依赖文档 `2026-09-03-cocos-native-android-template.md` 第一节——`native/engine/android/app/build.gradle` 就是 gradle 真正编译的 `:app` 模块，构建只对它做一次包名字符串替换。仓库源 `google()` / `mavenCentral()` 模板里已有，**不用加**。

**⚠️ 别抄官方那行 `latest.release`。** 官方 Android 使用指南写的是：

```gradle
implementation 'com.tencent.bugly:crashreport:latest.release'
```

而 Central 上 `com.tencent.bugly:crashreport` 的 `maven-metadata.xml` 是这样的：

```xml
<latest>4.1.9</latest>
<release>4.1.9</release>
```

各版本的实际发布时间（`curl -I` 取 `Last-Modified`）：

| version | 发布时间 |
|---|---|
| 4.1.9 | **2022-09-06** |
| 4.1.9.1 | 2023-03-24 |
| 4.1.9.2 | 2023-04-07 |
| **4.1.9.3** | **2023-10-30** ← 真正最新 |

元数据里的 `<release>` 指着一个**比最新版旧一年多**的包。动态版本号解析到哪一个取决于 Gradle 对 Maven 元数据的处理细节（**待实测**），但没必要赌——**钉 `4.1.9.3`**。

复现：

```bash
curl -s https://repo1.maven.org/maven2/com/tencent/bugly/crashreport/maven-metadata.xml | grep -E '<latest>|<release>'
```

### 3.2 minSdk：**这次不用改**

aar 内的 `AndroidManifest.xml`（解包实证）：

```xml
<manifest package="com.tencent.bugly" android:versionCode="1" android:versionName="4.1.9.3">
    <uses-sdk android:minSdkVersion="15" android:targetSdkVersion="28" />
</manifest>
```

Cocos 3.8.7 / 3.8.8 模板都是 `PROP_MIN_SDK_VERSION=21`（`templates/android/build/gradle.properties:30`，本机两个版本都核对过）。**15 < 21，manifest merger 无话可说。**

值得记一笔的对比：同一个工程里，`androidx.credentials` 要 23、Firebase Crashlytics 要 23，**只有 Bugly 不推这条线**。所以 minSdk 提到 23 这件事迟早要做，但**不是被 Bugly 逼的**。

### 3.3 权限：一条都不用加

官方要求：

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
<uses-permission android:name="android.permission.ACCESS_WIFI_STATE" />
```

Cocos 模板 `templates/android/template/app/AndroidManifest.xml` 第 5–7 行（**源码实证**）：

```xml
<uses-permission android:name="android.permission.INTERNET"/>
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE"/>
<uses-permission android:name="android.permission.ACCESS_WIFI_STATE"/>
```

**一字不差**。这条特别值钱，因为依赖文档里写了「改 `AndroidManifest.xml` 会丢注释和格式」——不用改就不用担这个险。

### 3.4 gradle plugin：不需要

官方文档目录里的 gradle 插件只有一个：`/docs/utility-tools/plugin-gradle-hotfix/`，是**热更新(tinker)**用的。符号表另有一个独立的命令行工具（`symtabfileuploader`，最后更新 2018），给 NDK crash 还原用，**Java/JS 层上报不需要**。

⇒ **崩溃上报零插件**。对照 Firebase 那边要塞两个 plugin 进 `buildscript{}`、还要跟 AGP 8.0.2 对版本，Bugly 这边干净得多。

### 3.5 混淆规则：aar 不带，必须自己写

官方要求：

```proguard
-dontwarn com.tencent.bugly.**
-keep public class com.tencent.bugly.**{*;}
```

**实证补充（文档没说）**：aar 里的 `proguard.txt` 是 **0 字节**——它没有 consumer ProGuard rules，AGP 不会替你合并。所以这两行必须手写进 `apps/demo/native/engine/android/app/proguard-rules.pro`（该文件是源，不会被构建吃掉）。

### 3.6 ABI：aar 带五套 so，记得筛

aar 内含 `jni/{armeabi, armeabi-v7a, arm64-v8a, x86, x86_64}/libBugly_Native.so`，每个 180–210 KB。官方也提醒用 `abiFilters` 筛。跟 Cocos 构建面板选的 ABI 对齐即可，否则白白胖包。

**Android 15 的 16KB page size**（实证）：

```
arm64-v8a/libBugly_Native.so   64bit  LOAD p_align = 0x10000  (64KB)
armeabi-v7a/libBugly_Native.so 32bit  LOAD p_align = 0x1000
```

arm64 那份是 64KB 对齐，**满足 16KB 要求**（16KB 规则只约束 64 位 so）。虽然这个 aar 是 2023 年的产物，这一关意外地过了。专业版另有 `com.tencent.bugly_16kb:bugly-pro` 专门解决同一问题——**免费版不需要**。

### 3.7 初始化

```java
CrashReport.initCrashReport(getApplicationContext(), "注册时申请的APPID", false);
```

`javap` 出来的全部重载（aar 实证，文档只写了两个）：

```java
public static void initCrashReport(Context);                                        // 从 manifest 的 meta-data 读 APPID
public static void initCrashReport(Context, CrashReport.UserStrategy);
public static void initCrashReport(Context, String appId, boolean isDebug);
public static void initCrashReport(Context, String appId, boolean isDebug, CrashReport.UserStrategy);
```

第三个参数 `isDebug` 的行为（官方明确）：输出详细 SDK Log、**每一条 Crash 都立即上报**、自定义日志在 logcat 输出。**实测期必须开 true**，否则要等下次启动才上报，会以为是没接通。

官方另两条注意：「建议不要在异步线程初始化 Bugly」、「请务必在用户授权《隐私政策》后再初始化」。

初始化点：Cocos 的 `AppActivity`（`native/engine/android/app/src/com/cocos/game/AppActivity.java`，源，不会被吃掉），或者更早的 Application。**用 `getApplicationContext()`，别存 Activity。**

---

## 四、关键 API：JS 堆栈怎么原样送进去

### 4.1 两个上报入口，只有一个能带自定义堆栈

`javap -public -cp classes.jar com.tencent.bugly.crashreport.CrashReport` 的实证结果（节选，**这些方法在免费版 4.1.9.3 里全都在**）：

```java
// ① 主动上报「非致命异常」，堆栈来自 Throwable 自己
public static void postCatchedException(Throwable);
public static void postCatchedException(Throwable, Thread);
public static void postCatchedException(Throwable, Thread, boolean);

// ② 主动上报「脚本层错误」，堆栈是一段你给的字符串  ← 我们要的是这个
public static void postException(int category, String errorType, String errorMsg,
                                 String stack, Map<String,String> extraInfo);
public static void postException(Thread thread, int category, String errorType, String errorMsg,
                                 String stack, Map<String,String> extraInfo);
```

官方对 `postException` 的注释（专业版「错误」文档与 Android SDK 文档同一份，免费版文档没收录但 API 在 aar 里）：

```
* @param thread    出错线程, 默认当前线程
* @param category  异常类型 u3d c# : 4 ｜ js : 8 ｜ cocos2d lua : 6
* @param errorType 错误类型
* @param errorMsg  错误信息
* @param stack     出错堆栈
* @param extraInfo 额外信息
```

**⇒ 直接回答本次的关键问题：能。`stack` 就是一个普通 `String`，Bugly 不解析、不要求它长得像 Java 堆栈，JS 的 `error.stack` 原样塞进去即可，`category` 填 **8**。**

这比 Firebase 那边强一档：Firebase Crashlytics 的 Android SDK 没有等价 API，只能造一个假 `Throwable` 再 `setStackTrace(StackTraceElement[])`（见 firebase 那份的结论表）。**同一件事，Bugly 一行，Firebase 要伪造对象。**

上报的数据落在控制台的「**错误分析**」栏目。免费版官方术语表：「**错误**：主动上报的 Exception、Error，或脚本(如 C#、Lua、JS 等)错误，统称为错误。」——所以免费版后台**有**这个入口，不是专业版特权。

**注意 `postException` 不需要进程崩溃**，调用完立刻走上报通道，不用重启 App 就能在后台看到（专业版文档明确说「无需重启应用」；免费版同一套通道，**待实测确认**）。

### 4.2 长度上限：官方只给了旁路字段的数字

| 字段 | 上限 | 来源 |
|---|---|---|
| `postException` 的 `stack` / `errorMsg` / `errorType` | **官方没写** | —— **待实测** |
| `putUserData(context, key, value)` | 「最多可以有 **50 对**自定义的 key-value（超过则添加失败）；key 限长 **50 字节**，value 限长 **200 字节**，过长截断」 | 官方文档明确 |
| `BuglyLog` | 内存缓存默认 10K，`setCache(int byteSize)` 范围 **0–30K**；「上报 Log 最大 **30K**」 | 官方文档明确 |
| 专业版自定义附件 | 最多 10 个文件、压缩后 ≤ 10MB | 官方文档明确（专业版限定） |

⇒ **`stack` 的上限是本次最大的未知数**，而它恰恰是我们要塞长文本的那个字段。**实测方法**：分别用 4KB / 16KB / 64KB 的假堆栈各报一条，去后台看展示是否被截、截在哪。

**别把 JS 堆栈往 `putUserData` 里塞**——200 字节，一行调用栈都装不下。它只适合放「哪个 bundle / 哪个场景 / 玩家 id」这类短标签。

### 4.3 顺带记下的其它 API（`javap` 实证，文档漏了不少）

```java
public static void setUserId(String);                          // 玩家唯一 id
public static void setUserSceneTag(Context, int);              // 场景/关卡标记（int，要在后台先登记）
public static void putUserData(Context, String, String);       // 自定义 kv（50 对 / 50B / 200B）
public static void setAppVersion(Context, String);             // ← 热更后必须刷，见 §6
public static void setAppChannel(Context, String);             // 马甲/渠道，正好对上 VEST
public static void setDeviceId(Context, String);               // 新版 SDK 默认不采集设备唯一标识，要自己给
public static void setDeviceModel(Context, String);            // 同上，默认也不采机型了
public static void setIsDevelopmentDevice(Context, boolean);   // 标记开发机，别污染线上率
public static void setServerUrl(String);
public static void testJavaCrash();                            // 官方自带的冒烟入口
public static void testNativeCrash();
public static void testANRCrash();
public static boolean isLastSessionCrash();
public static void setJavascriptMonitor(WebView, boolean);     // ← 只管 WebView，跟 jsb 无关，见下
```

⚠️ **`setJavascriptMonitor` 是个同名陷阱**。它给的是 `android.webkit.WebView` 注入 JS 错误监听，捕的是**网页**的 JS。Cocos native 的 JS 跑在引擎自带的 JS 引擎里，不在 WebView 里，**这个 API 对我们完全无效**。要报 Cocos 的 JS 异常只能走 `postException`。

`BuglyLog`（`com.tencent.bugly.crashreport.BuglyLog`，实证）：`v/d/i/w/e(tag, log)`、`e(tag, log, Throwable)`、`setCache(int)`。可以把最近 N 条游戏日志随异常一起带上（30K 上限）。

---

## 五、Cocos 侧：官方指引等于没有，但钩子是现成的

### 5.1 官方的两份 Cocos 文档，一份死了、一份不对版

- **免费版 Cocos Plugin**（`/docs/user-guide/instruction-manual-plugin-cocos/`）：版本 1.4.3，更新时间 **2017-06-22**，页面挂着「**本插件已停止维护，不再提供新增服务**」，引导去专业版。它提供的 JS 接口只有 `buglySetUserId` / `buglySetTag` / `buglyAddUserValue` / `buglyLog` —— **连上报异常的接口都没有**。
- **专业版 cocos2dx 插件**（`/docs/sdk/cocos2dx/`）：还在维护，但通篇是 **cocos2d-x** 的世界——`proj.ios_mac` 的 Xcode 工程、`frameworks/cocos2d-x/external/bugly`、`AppDelegate.cpp`、以及决定性的一行：

  ```cpp
  BuglyJSAgent::registerJSExceptionHandler(ScriptingCore::getInstance()->getGlobalContext());
  ```

  `ScriptingCore` 是 cocos2d-x v3 那代 JSB 的类，**Cocos Creator 3.x 的 native 里根本没有这个类**。整份文档套不上。

  它暴露的 JS API 也还是那三个：`buglySetUserId` / `buglyAddUserValue` / `buglySetScene`。

**但同一页给了官方许可**（原话）：

> 如果业务使用的是 cocos2dx-lua 或者 cocos2dx-js，理论上也可以直接接入 iOS/Android 原生 sdk，然后**自己封装脚本接口**。

⇒ **官方对 Creator 3.x 没有指引，也没有阻拦。自己封桥是唯一路径，而且是官方点过头的路径。**

### 5.2 好消息：Creator 3.8 native 有现成的全局 JS 异常钩子 `jsb.onError`

**引擎源码实证**（本机 `Creator/3.8.7/resources/resources/3d/engine/`）：

- `native/cocos/bindings/manual/jsb_cocos_manual.cpp:849` —— `jsbObj->defineFunction("onError", _SE(js_se_setExceptionCallback));`
- 它内部调 `se::ScriptEngine::getInstance()->setJSExceptionCallback(...)`，回调签名是 `(const char *location, const char *message, const char *stack)`。
- `platforms/native/engine/jsb-game.js:33` —— 引擎**自己已经注册了一个**：

  ```js
  jsb.onError(function (location, message, stack) {
      console.error(location, message, stack);
  });
  ```

所以 JS 侧拿未捕获异常的形状是：

```ts
// 仅 native 有；Web/小游戏走 window.onerror
declare const jsb: any;
jsb.onError((location: string, message: string, stack: string) => {
    console.error(location, message, stack);   // ← 必须自己补回来，见下
    // 经反射桥交给 Java 的 CrashReport.postException(8, ...)
});
```

⚠️ **`setJSExceptionCallback` 只有一个槽，后注册覆盖前一个**（源码实证：它是个 `set`，不是 `add`），而引擎 JS 层
`platforms/native/engine/jsb-game.js:32` **已经占了它**：

```js
jsb.onError(function (location, message, stack) {
    console.error(location, message, stack);
});
```

我们一注册，这句 `console.error` 就没了——**必须在自己的回调里把它补回去**。这跟 `native.bridge.onNative`
是同一个坑（见 Credential Manager 那份 §4.1）。

**但「从此 JS 报错在 logcat 里静默」是错的**（2026-09-03 复核订正，引擎源码实证）：

```cpp
// native/cocos/bindings/jswrapper/v8/ScriptEngine.cpp:272
void ScriptEngine::callExceptionCallback(const char *location, const char *message, const char *stack) {
    if (_nativeExceptionCallback) { _nativeExceptionCallback(location, message, stack); }
    if (_jsExceptionCallback)     { _jsExceptionCallback(location, message, stack); }
}
```

**是两个独立的槽。** `jsb.onError` 写的是 `_jsExceptionCallback`；而 `CocosApplication::handleException`
（那句 `CC_LOG_ERROR("
Uncaught Exception:…")`）走的是 `setExceptionCallback` → `_nativeExceptionCallback`，
**完全不受我们影响**。所以：

- 丢的只是 JS 侧那条 `console.error`，C++ 侧那条 `Uncaught Exception:` 照常打——logcat 不会全哑。
- 更有用的推论：**C++ override 与 `jsb.onError` 可以并存**，两条路互不干扰，不必二选一。

`location` / `message` / `stack` 三个都是现成的字符串，正好一一对上 `postException` 的 `errorType` / `errorMsg` / `stack`。

### 5.3 Java 桥的形状（沿用 `GoogleSignInBridge` 那套）

`native.reflection.callStaticMethod` **只支持 number / boolean / string** 做参数，所以 `Map<String,String> extraInfo` 过不了桥——传 `null` 或在 Java 侧从一个 JSON 字符串自己拼。反射调用是**同步的、跑在 GL 线程**；`postException` 不弹 UI，**不需要 `runOnUiThread`**（比 Credential Manager 那边简单）。

签名（JS 侧写死）：`(ILjava/lang/String;Ljava/lang/String;Ljava/lang/String;)V`

```java
package com.cck.crash;

import android.content.Context;
import com.tencent.bugly.crashreport.CrashReport;

/** JS 侧唯一入口。零状态、零业务逻辑，换崩溃平台只改这一个文件。 */
public final class CrashBridge {
    private CrashBridge() {}

    /** JS: native.reflection.callStaticMethod(
     *        "com/cck/crash/CrashBridge", "report",
     *        "(ILjava/lang/String;Ljava/lang/String;Ljava/lang/String;)V",
     *        8, errorType, errorMsg, stack); */
    public static void report(int category, String errorType, String errorMsg, String stack) {
        CrashReport.postException(category, errorType, errorMsg, stack, null);
    }
}
```

放 `apps/demo/native/engine/android/app/src/com/cck/crash/CrashBridge.java`（依赖文档第一节：`app/src/` 下的 Java 类构建不会碰）。

> ⚠️ 依赖文档里那条**未决事项照旧**：根 `.gitignore` 的 `/apps/*/native/` 把整个 `native/` 忽略了，这个 Java 类不入库就只活在一台机器上。接崩溃上报和接 Google 登录撞的是同一堵墙，**一起解决**。

---

## 六、跟本仓热更新体系的接口（本次没查，但接之前必须想清楚）

Bugly 的问题聚合是按 **版本号 + 堆栈** 分组的，而本仓的 base 层/分包层可以在不改 `versionName` 的情况下换掉全部业务 JS。两处后果：

1. **`CrashReport.setAppVersion(Context, String)` 必须喂热更后的真实版本**（`baseStamp` / manifest 版本），否则后台看到的全是同一个 APK 版本号，热更前后的问题混在一起。
2. **JS 堆栈是压缩后的**。Creator 构建出来的 JS 是压缩过的，`stack` 里全是 `t.n is not a function` 这种。Bugly 的符号表功能只服务 Java mapping 和 NDK symbol，**对 JS sourcemap 一无所知**。要读得懂，要么出包关掉 JS 压缩（包体和性能代价），要么自己留一份 sourcemap 在旁边人工还原。

这两条都**超出本票范围**（本票只要「能看到、带可读堆栈」），但「可读」的天花板由它们决定，**实施前先拍板**。

---

## 七、实测清单（给下一个会话）

1. **先做这一步，它能一票否决全部方案**：拿一个 QQ 号走 `bugly.qq.com` → 完善开发者信息 → 创建产品，**看中途弹不弹资质材料**，拿到 APP ID。
2. `app/build.gradle` 加 `implementation 'com.tencent.bugly:crashreport:4.1.9.3'`（**别写 `latest.release`**）。
3. `proguard-rules.pro` 加那两行 keep（aar 不带 consumer rules）。
4. `AppActivity` 里 `CrashReport.initCrashReport(getApplicationContext(), APPID, true)`（实测期 `isDebug=true`，否则要等下次启动才上报）。
5. 放 §5.3 的 `CrashBridge.java`。
6. JS 侧注册 `jsb.onError`，**记得把引擎那句 `console.error` 补回来**，然后 `callStaticMethod(..., 8, location, message, stack)`。
7. 真机故意抛一个 JS 异常 → 后台「**错误分析**」里找。
8. **顺手测 `stack` 的长度上限**：4KB / 16KB / 64KB 各报一条，看截在哪。

---

## 八、待实测 / 待确认清单

| # | 事项 | 为什么重要 |
|---|---|---|
| 1 | 免费版创建产品的表单**实际**要不要资质材料 | **硬约束**，不过这关整条路都不用走 |
| 2 | `postException` 的 `stack` / `errorMsg` 长度上限 | 决定 JS 堆栈能不能整条送进去，超了要不要自己裁 |
| 3 | 免费版后台「错误分析」对 `category=8` 的展示形态（堆栈是纯文本还是会尝试解析成帧） | 决定要不要把 JS 堆栈格式化成 Java 风格 |
| 3b | ⚠️ **`category` 的 JS 取值到底是 8 还是 5** | 本文档取 **8**（Bugly 免费版官方文档 + aar `javap`）；同日的 `cocos-js-stack-reporting.md` 取 **5**（CrashSight 文档原文 `C#: 4, js: 5, lua: 6`）。**两家产品的常量表可能本就不同**，别互相「订正」——以真正接入的那条线（免费版 Bugly）的后台实测为准 |
| 4 | 免费版 `postException` 是不是也「无需重启应用」立刻上报 | 影响实测节奏（专业版文档说是，免费版没写） |
| 5 | 免费版有没有不写在文档里的上报频率/条数限额 | Android FAQ 里搜不到任何限额条款，可疑 |
| 6 | Gradle 对 `latest.release` 在这个 artifact 上到底解析成哪一版 | 只影响「官方那行能不能抄」，我们钉版本就绕过了 |
| 7 | `initCrashReport` 与 Cocos 引擎初始化的先后（能不能早于 `libcocos.so` 加载） | 太晚就漏掉启动期崩溃 |
| 8 | 热更后 `setAppVersion` 喂什么值才能让后台分组正确 | 见 §6，决定问题聚合有没有意义 |
| 9 | 免费版数据保留期限 | 文档没写；影响能不能当长期基建 |

---

## 九、来源

**一手（官方，均 2026-09-03 抓取）**

- [Bugly 免费版首页](https://bugly.qq.com/v2/) — 无停服公告
- [异常上报功能简介（注册产品 / 平台术语）](https://bugly.qq.com/docs/introduction/bugly-introduction/) — 注册三步、「错误 = 主动上报的 Exception、Error，或脚本(如 C#、Lua、JS 等)错误」
- [Android SDK 使用指南](https://bugly.qq.com/docs/user-guide/instruction-manual-android/) — maven 坐标、`latest.release` 写法、三条权限、混淆规则、`initCrashReport` 与 `isDebug` 行为、MultiDex 注意
- [Android 高级功能](https://bugly.qq.com/docs/user-guide/advance-features-android/) — `postCatchedException`、`putUserData` 的 50 对 / 50 字节 / 200 字节、`BuglyLog` 的 0–30K 与 30K 上限、`setJavascriptMonitor`
- [SDK 下载页](https://bugly.qq.com/v2/downloads) — Android SDK 4.1.9.3（2023-11-01）；**Unity/Cocos Plugin「本插件已停止维护，不再提供新增服务」，1.5.3 / 1.4.3，2017-06-22**
- [Android 常见问题](https://bugly.qq.com/docs/user-guide/faq-android/) — 未见任何上报限额条款
- [Bugly 专业版首页](https://bugly.tds.qq.com/) — 免费版 vs 专业版对比（「全平台免费」 vs 「收费，可以按照事件量或 MAU 购买」）
- [专业版 · 快速接入](https://bugly.tds.qq.com/docs/quick_start/create_product/) — 「需要为创建的产品购买并绑定资源包，该产品才能上报数据」
- [专业版 · 产品计费](https://bugly.tds.qq.com/docs/billing/) — 事件量 6 亿/年 32,000 元；月活 5 万 MAU 50,000 元；「不接受购买后退款」
- [专业版 · 关联产品](https://bugly.tds.qq.com/docs/quick_start/relate_product/) — 「基础版和专业版两套系统是分离的。专业版无法用基础版分配的 APPID 和 APPKEY 来上报数据」
- [专业版 · Android SDK 接入指引](https://bugly.tds.qq.com/docs/sdk/android/) — `bugly-pro` 坐标、`BuglyBuilder`、`postException` / `handleCatchException` 签名、16KB 专版 `com.tencent.bugly_16kb:bugly-pro`
- [专业版 · 错误（自定义错误使用指引）](https://bugly.tds.qq.com/docs/tutorial/error/) — `postException` 两个重载的完整 javadoc 与 `category` 取值表
- [专业版 · cocos2dx 接入](https://bugly.tds.qq.com/docs/sdk/cocos2dx/) — `ScriptingCore` 时代的做法；「理论上也可以直接接入 iOS/Android 原生 sdk，然后自己封装脚本接口」
- [CrashSight 产品介绍](https://crashsight.qq.com/docs/zh/crashsight/) — 国内/海外站点、支持平台与引擎、SDK 4.2.14、「外部项目请咨询邮箱 crashsight@tencent.com」
- [WeTest · CrashSight 产品页](https://wetest.qq.com/products/crashsight) — 服务流程「商务沟通 → 平台开通项目 → SDK 接入 → 签订正式使用合同后转正式使用」

**实证（本地可复现）**

- Maven Central：`https://repo1.maven.org/maven2/com/tencent/bugly/{crashreport,bugly-pro}/maven-metadata.xml`，以及各版本 `.pom` 的 `Last-Modified`
- `crashreport-4.1.9.3.aar` 解包：`AndroidManifest.xml`（minSdk 15 / targetSdk 28）、`proguard.txt`（0 字节）、`jni/*/libBugly_Native.so`（ELF LOAD `p_align`）
- `javap -public -cp classes.jar com.tencent.bugly.crashreport.{CrashReport,BuglyLog}` — 公开 API 全表
- 本机 Cocos Creator 3.8.7 / 3.8.8：`resources/resources/3d/engine/templates/android/template/app/AndroidManifest.xml`（三条权限）、`templates/android/build/gradle.properties:30`（`PROP_MIN_SDK_VERSION=21`）
- 本机 Cocos Creator 3.8.7 引擎源码：`native/cocos/bindings/manual/jsb_cocos_manual.cpp:642-680,849`（`jsb.onError` → `setJSExceptionCallback`，单槽覆盖）、`platforms/native/engine/jsb-game.js:33`（引擎自己注册的那个）

---
状态: 草案（事实清单，未实测）
摘要: Android Credential Manager + Sign in with Google 的一手事实：maven 坐标与当前版本、Java 侧回调式调用链（我们不用 Kotlin）、serverClientId 必须填 **Web client ID**、失败面与「取消 vs 失败」的异常分界、idToken 用 tokeninfo 当场验签的字段含义，以及 Cocos 3.8 JS↔Java 桥该转发什么。
何时读: 要在 Cocos Creator 3.8 Android 工程里接 Google 登录、要给 Credential Manager 写原生桥、要判断某个登录报错是配置问题还是用户取消时。
日期: 2026-09-03
依赖: hlgit #30；Cocos 3.8.8 内置 Android 模板（`com.cocos.lib.GlobalObject` / `JsbBridge`）；apps/demo/build-configs/android-boot.json
---

# Android Credential Manager 接 Google Sign-In 的真实形状

## 目的与范围

在 Cocos Creator 3.8 的 Android 工程里，用 JS → Java 原生桥调 Android 的 **Credential Manager**（`androidx.credentials`）拿 Google 的 **idToken**，并在**不打自家服务端**的前提下当场验证这个 token 有效。本文只产出事实清单与可照抄的调用骨架，**没有实测**——所有标「待实测」的条目要在带 GMS 的模拟器上跑过才能升级成事实。

选 Google Sign-In 的前提（来自 #30）：它是唯一同时满足「免费 + 零主体资质材料 + 有真 aar」的身份提供方。

> 版本号均为 **2026-09-03** 查证；androidx 的版本走得快，动工前重新确认发布说明。

---

## 结论先行

| 问题 | 结论 | 可信度 |
|---|---|---|
| `serverClientId` 填哪个 client？ | **Web application client ID**（不是 Android client ID） | 官方文档明确 |
| Android client 还要不要建？ | 要。它不出现在代码里，但 package name + SHA-1 是 Play services 校验调用方身份的依据；缺了会以 `GetCredentialUnknownException` 形态炸 | 官方文档明确（存在性）＋ 社区交叉验证（报错形态） |
| Java 侧能不能调？ | **能**。`getCredentialAsync(Context, request, CancellationSignal, Executor, CredentialManagerCallback)` 是 Java 友好的回调版；`getCredential` 那个 suspend 版才是 Kotlin 专用 | 官方 API 参考明确 |
| 需要 Activity 还是 Application context？ | **Activity**（要弹系统 UI）。Cocos 里经 `com.cocos.lib.GlobalObject.getActivity()` 拿 | 官方文档 ＋ 引擎源码 |
| 还依赖 `play-services-auth` 吗？ | **不用自己声明**。`credentials-play-services-auth:1.6.0` 的 POM 里 runtime 传递依赖 `com.google.android.gms:play-services-auth:21.1.1` | 官方 maven POM |
| 取消跟失败分得开吗？ | **分得开**。用户取消 = `GetCredentialCancellationException`；「没有可用账号」是另一个类 `NoCredentialException`；配置错落在 `GetCredentialProviderConfigurationException` / `GetCredentialUnknownException` | 官方文档明确 |
| idToken 怎么当场验？ | `GET https://oauth2.googleapis.com/tokeninfo?id_token=<JWT>`，看 `aud`（= 你的 Web client ID）/ `iss` / `exp` / `sub` / `nonce` | 官方文档明确（且官方标注**仅供调试**） |
| 最大的坑 | Cocos 3.8.8 Android 模板 `PROP_MIN_SDK_VERSION=21`，而 `androidx.credentials` 1.6.0 起 minSdk = **23** → 不改就是 manifest merger 失败 | 官方发布说明 ＋ 引擎模板源码 |

---

## 一、依赖与版本

### 1.1 要加的 maven 坐标

```gradle
// app/build.gradle → dependencies { }
implementation "androidx.credentials:credentials:1.6.0"
implementation "androidx.credentials:credentials-play-services-auth:1.6.0"
implementation "com.google.android.libraries.identity.googleid:googleid:1.2.0"
```

| 坐标 | 当前稳定版（2026-09-03 查证） | 说明 |
|---|---|---|
| `androidx.credentials:credentials` | **1.6.0**（2026-04-08 发布） | 核心 API。最新预览版是 `1.7.0-alpha03`（2026-07-29） |
| `androidx.credentials:credentials-play-services-auth` | **1.6.0** | Play services 提供方，**没它就 `GetCredentialProviderConfigurationException`** |
| `com.google.android.libraries.identity.googleid:googleid` | **1.2.0**（2026-01-22 发布） | 提供 `GetGoogleIdOption` / `GetSignInWithGoogleOption` / `GoogleIdTokenCredential` |

来源：[androidx credentials 发布说明](https://developer.android.com/jetpack/androidx/releases/credentials)、[googleid 发布说明](https://developers.google.com/identity/android-credential-manager/releases)、[Implement Sign in with Google](https://developer.android.com/identity/sign-in/credential-manager-siwg-implementation)。

> 官方实现指南当前示例写的是 `1.7.0-alpha03`。**建议钉稳定版 1.6.0**，别把 alpha 带进出包链。

### 1.2 `play-services-auth` 还要不要写？—— 不要（官方 POM 佐证）

`credentials-play-services-auth:1.6.0` 的 POM（`https://dl.google.com/dl/android/maven2/androidx/credentials/credentials-play-services-auth/1.6.0/credentials-play-services-auth-1.6.0.pom`）声明的依赖：

| groupId:artifactId | version | scope |
|---|---|---|
| `androidx.credentials:credentials` | [1.6.0] | compile |
| `org.jetbrains.kotlin:kotlin-stdlib` | 2.1.20 | compile |
| `com.google.android.gms:play-services-auth` | 21.1.1 | runtime |
| `com.google.android.gms:play-services-auth-blockstore` | 16.4.0 | runtime |
| `com.google.android.gms:play-services-identity-credentials` | 16.0.0-alpha08 | runtime |
| `com.google.android.gms:play-services-fido` | 21.0.0 | runtime |
| `com.google.android.libraries.identity.googleid:googleid` | 1.1.0 | runtime |
| `androidx.core:core` | 1.15.0 | runtime |

结论（官方 POM 明确）：**`play-services-auth` 是传递依赖，不用自己写**；`googleid` 虽然也是传递依赖但版本停在 1.1.0，要用 1.2.0 的 API（Security Bundle、`getEmail()`/`getUniqueId()`）就必须显式声明。有些教程（含 Google 自家 codelab）还让加 `play-services-auth`，那是老写法的惯性。

### 1.3 minSdk：这是 Cocos 工程的**第一个硬冲突**

- `androidx.credentials` 自 **1.6.0-alpha05（2025-08-13）起把默认 minSdk 从 21 提到 23**（发布说明明确）。
- Cocos Creator 3.8.8 的 Android 模板默认 `PROP_MIN_SDK_VERSION=21`（`resources/3d/engine/templates/android/build/gradle.properties:30`，本机源码核对）。
- ⇒ 直接加依赖会在 manifest merger 报 minSdk 冲突。

两条路：

1. **把工程 minSdk 提到 23**（Android 6.0，2015 年）——推荐，代价可以忽略。
2. 钉 `androidx.credentials:1.5.0`（minSdk 21）——只有真要覆盖 API 21/22 才值得。

改哪儿：Creator 构建面板不暴露 minSdk，值在产物 `build/android/proj/gradle.properties` 里。要持久化得走 `build-templates/`（**具体映射路径待实测**——Creator 的 build-templates 按产物目录镜像，猜是 `build-templates/android/proj/gradle.properties`；demo 现在只有 `build-templates/native/index.ejs`）。

另外两条环境事实（本机核对 Cocos 3.8.8 模板）：

- 模板根 `build.gradle` 的 `allprojects.repositories` 已含 `google()` 与 `mavenCentral()` —— **仓库不用加**。
- 模板 `compileOptions` 是 `VERSION_1_8`，`PROP_COMPILE_SDK_VERSION=36`；demo 的 `build-configs/android-boot.json` 里 `apiLevel: 34`（这是 Creator 的 target/compile API level）。`androidx.core:1.15.0` 这类新 AndroidX 一般要求 compileSdk ≥ 35，**apiLevel 34 够不够待实测**，不够就提到 35/36。

### 1.4 Sign in with Google 自身的平台要求

官方 [About Sign in with Google](https://developer.android.com/identity/sign-in/credential-manager-siwg) 写的是「Android 4.4（API 19）及以上」——那是**能力层**的说法；**库层**的下限由 1.3 那条 minSdk 决定，取交集即 **23**。设备侧真正的硬要求是**有 Google Play services**（提供方就是 GMS），所以模拟器必须选带 **Google Play / Google APIs** 的系统镜像。

---

## 二、调用链的确切形状

### 2.1 两种 option，先选一种

| | `GetGoogleIdOption` | `GetSignInWithGoogleOption` |
|---|---|---|
| 场景 | 进游戏自动弹的底部账号选择条（bottom sheet） | **用户点「用 Google 登录」按钮**后才弹 |
| 关键参数 | `setServerClientId` + `setFilterByAuthorizedAccounts` + `setAutoSelectEnabled` | 构造函数就吃 `serverClientId`，**没有账号过滤** |
| 典型失败 | 无授权账号时 `NoCredentialException`，要降级重试一次 | 不会因为「没授权过」而失败 |

官方对 `GetSignInWithGoogleOption` 的描述是 "A request to retrieve user's Google ID Token from an explicit 'Sign in with Google' button."

**我们的场景（游戏里一个登录按钮）建议先用 `GetSignInWithGoogleOption`** —— 少一层 `filterByAuthorizedAccounts` 的双次请求逻辑，首跑就能出 token。等要做「回头玩家静默续登」再加 `GetGoogleIdOption`。

### 2.2 `serverClientId` = **Web client ID**（本条是手续的分水岭）

官方实现指南的示例是 `.setServerClientId(WEB_CLIENT_ID)`，并明确注释这是 **Web Client ID，不是 Android Client ID**；Google codelab 同样写「The Web application client ID is passed to `setServerClientId`」。（官方文档明确）

`setServerClientId` 的语义是「**给 Google ID token 设 audience（`aud`）**」——所以拿到的 idToken 里 `aud` 就是这个 Web client ID，验签时对着它比。

**但 Android client 也必须建**（codelab 明确要求建两个 client）：

- **Web application client**：拿它的 client ID 填 `setServerClientId`，测试期不需要填 Origins / redirect URI。
- **Android client**：填 **package name**（= 我们的 `applicationId`，demo 是 `com.cck.demo`）+ **签名证书 SHA-1**。它不出现在任何代码里，是 Play services 校验「调用方是不是你」的凭据（[Client authentication](https://developers.google.com/android/guides/client-auth)）。

debug keystore 的 SHA-1（官方命令，默认密码 `android`）：

```bash
keytool -list -v -alias androiddebugkey -keystore ~/.android/debug.keystore
```

⚠️ Cocos 出包用的是它自己的签名配置：debug 构建用的是 Creator/Gradle 生成的 debug keystore，release 用构建面板里指定的 keystore。**两套证书的 SHA-1 都得登记进同一个 Android client**，否则换个构建类型就登录不了（文档推断 + 社区共识）。

另外 Google 侧还要求**品牌验证（brand verification）**才能在同意屏上显示应用名（官方文档明确）——不做也能拿 token，只是同意屏上显示的是裸 client id 之类的信息，属于上线前的事，不挡实测。

### 2.3 `filterByAuthorizedAccounts` 的含义

官方定义：*"Sets whether to only allow the user to select from Google accounts that are already authorized to sign in to your application."*

- `true`（默认）：只列**已经授权过本应用**的账号 → 老玩家一键续登；设备上没有这样的账号就抛 `NoCredentialException`。
- `false`：列设备上**所有** Google 账号，含没授权过的 → 首次登录用这个。

官方推荐的流程是：先 `true` 试，捕到 `NoCredentialException` 再用 `false` 重试一次。用 `GetSignInWithGoogleOption` 则完全绕开这个参数。

### 2.4 `nonce`：可以在 JS 侧生成

`setNonce(String)` 是防重放的随机串，Google 会把它原样放进 idToken 的 `nonce` claim。官方 Kotlin 示例用 `SecureRandom` + Base64(URL_SAFE|NO_WRAP|NO_PADDING) 生成 32 字节。

**这是纯字符串运算，没有任何 Android API 依赖 → 完全可以在 JS 侧生成后经桥传下去**，Java 侧只负责透传。这样「本次登录请求是不是我发的」这个状态留在 JS 侧，Java 侧继续无状态。

### 2.5 Java 侧的 API 形状（关键：不是只有 suspend）

`androidx.credentials.CredentialManager` 同时提供两套：

```java
// Java 友好（回调版）—— 我们用这个
void getCredentialAsync(
    Context context,
    GetCredentialRequest request,
    CancellationSignal cancellationSignal,   // 可为 null
    Executor executor,
    CredentialManagerCallback<GetCredentialResponse, GetCredentialException> callback)

void clearCredentialStateAsync(
    Context context,
    ClearCredentialStateRequest request,
    CancellationSignal cancellationSignal,
    Executor executor,
    CredentialManagerCallback<Void, ClearCredentialStateException> callback)
```

```kotlin
// Kotlin 专用（挂起版）—— 官方文档所有示例用的是它，我们用不上
suspend fun getCredential(context: Context, request: GetCredentialRequest): GetCredentialResponse
```

（[CredentialManager API 参考](https://developer.android.com/reference/androidx/credentials/CredentialManager)）

`CredentialManagerCallback<R, E>` 是普通接口：`onResult(R result)` / `onError(E e)`。所以**整条链在 Java 侧完全可写，不需要引入 Kotlin 协程，也不需要给 Cocos 工程配 kotlin 插件**（`kotlin-stdlib` 只是被依赖的 jar，不需要编 Kotlin 源码）。

**context 必须是 Activity**：文档说明这个 API 需要 Activity context 来展示系统 UI。1.7.0-alpha03 起还加了对 `MutableContextWrapper` 的自动换绑（防止转屏时 Activity 泄漏）——我们用 1.6.0 就直接传 Activity，但要注意别把 Activity 存成静态强引用。

### 2.6 结果解包

```java
Credential c = response.getCredential();
if (c instanceof CustomCredential
        && GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL.equals(c.getType())) {
    GoogleIdTokenCredential cred = GoogleIdTokenCredential.createFrom(c.getData());
    String idToken = cred.getIdToken();     // 我们要的东西
    String email   = cred.getEmail();       // 1.2.0 起，从 idToken 里解出来的
    String uid     = cred.getUniqueId();    // 同上，= idToken 的 sub
}
```

`GoogleIdTokenCredential` 的 Java 可见成员（官方 Java 参考）：静态常量 `TYPE_GOOGLE_ID_TOKEN_CREDENTIAL`（String）、静态方法 `createFrom(Bundle)`、getter `getIdToken()` / `getEmail()` / `getUniqueId()` / `getDisplayName()` / `getGivenName()` / `getFamilyName()` / `getProfilePictureUri()`；`getId()` 与 `getPhoneNumber()` 已废弃。常量的字面值官方没写，**代码里引用常量本身即可，别硬编码字符串**。

解包可能抛 `GoogleIdTokenParsingException`（`com.google.android.libraries.identity.googleid` 包内），要单独 catch。

---

## 三、Java 侧调用骨架（可照抄）

放在 Cocos 的 `native/engine/android/app/src/…` 或 `build-templates` 对应位置，包名自定（下例 `com.cck.auth`）。**整个文件不含任何业务逻辑，只做「发起 → 回传字符串」。**

```java
package com.cck.auth;

import android.app.Activity;
import android.os.Bundle;

import androidx.credentials.Credential;
import androidx.credentials.CredentialManager;
import androidx.credentials.CredentialManagerCallback;
import androidx.credentials.CustomCredential;
import androidx.credentials.GetCredentialRequest;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.exceptions.GetCredentialException;

import com.cocos.lib.GlobalObject;
import com.cocos.lib.JsbBridge;
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption;
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential;

import org.json.JSONObject;

import java.util.concurrent.Executor;
import java.util.concurrent.Executors;

/** JS 侧唯一入口。所有返回都经 JsbBridge 以 JSON 字符串回传，事件名固定 "google-signin"。 */
public final class GoogleSignInBridge {

    private static final String EVENT = "google-signin";
    private static final Executor EXEC = Executors.newSingleThreadExecutor();

    private GoogleSignInBridge() {}

    /**
     * JS: native.reflection.callStaticMethod(
     *       "com/cck/auth/GoogleSignInBridge", "signIn",
     *       "(Ljava/lang/String;Ljava/lang/String;)V", webClientId, nonce);
     * 立即返回；结果经 JsbBridge 异步回传。
     */
    public static void signIn(final String webClientId, final String nonce) {
        final Activity activity = GlobalObject.getActivity();
        if (activity == null) { reply(err("no_activity", "GlobalObject.getActivity() == null")); return; }

        // getCredentialAsync 要弹系统 UI，必须在 UI 线程发起；
        // reflection 调进来时我们在 GL 线程上。
        GlobalObject.runOnUiThread(new Runnable() {
            @Override public void run() {
                GetSignInWithGoogleOption.Builder b = new GetSignInWithGoogleOption.Builder(webClientId);
                if (nonce != null && !nonce.isEmpty()) b.setNonce(nonce);

                GetCredentialRequest req = new GetCredentialRequest.Builder()
                        .addCredentialOption(b.build())
                        .build();

                CredentialManager.create(activity).getCredentialAsync(
                    activity, req, null, EXEC,
                    new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
                        @Override public void onResult(GetCredentialResponse response) {
                            try {
                                Credential c = response.getCredential();
                                if (c instanceof CustomCredential
                                    && GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL.equals(c.getType())) {
                                    Bundle data = ((CustomCredential) c).getData();
                                    GoogleIdTokenCredential cred = GoogleIdTokenCredential.createFrom(data);
                                    JSONObject ok = new JSONObject();
                                    ok.put("ok", true);
                                    ok.put("idToken", cred.getIdToken());
                                    ok.put("email", cred.getEmail());
                                    ok.put("uniqueId", cred.getUniqueId());
                                    reply(ok.toString());
                                } else {
                                    reply(err("unexpected_credential", String.valueOf(c.getType())));
                                }
                            } catch (Throwable t) {                 // 含 GoogleIdTokenParsingException
                                reply(err("parse_failed", String.valueOf(t.getMessage())));
                            }
                        }
                        @Override public void onError(GetCredentialException e) {
                            // 不在这里判断「取消还是失败」——把分类原料原样交给 JS
                            reply(err(e.getClass().getSimpleName(), String.valueOf(e.getMessage()), e.getType()));
                        }
                    });
            }
        });
    }

    private static String err(String kind, String msg) { return err(kind, msg, null); }

    private static String err(String kind, String msg, String type) {
        try {
            JSONObject o = new JSONObject();
            o.put("ok", false); o.put("kind", kind); o.put("message", msg);
            if (type != null) o.put("type", type);
            return o.toString();
        } catch (Throwable t) { return "{\"ok\":false,\"kind\":\"json_failed\"}"; }
    }

    /** JsbBridge.sendToScript 内部会 performFunctionInCocosThread，JS 回调落在脚本线程上。 */
    private static void reply(String json) { JsbBridge.sendToScript(EVENT, json); }
}
```

要点：

- **`e.getType()` 一定要带上**。`GetCredentialException` 的 `type` 是稳定字符串常量，比 `getSimpleName()` 更适合做分流键；两个都传，JS 侧优先用 `type`。
- **不在 Java 侧判「取消 vs 失败」**——那是策略，属于 JS/VM；Java 只搬运。
- `Executors.newSingleThreadExecutor()` 是长驻单线程；也可以用 `activity.getMainExecutor()`（API 28+）。回调线程不是 UI 线程也不是脚本线程，所以**回调里除了 `JsbBridge.sendToScript` 什么都别碰**。

---

## 四、JS ↔ Java 桥：转发什么、线程在哪

### 4.1 两个方向用两套机制（Cocos 3.8 官方 API，本机源码核对）

**JS → Java：反射，同步，跑在 GL 线程**

```ts
import { native, sys } from 'cc';
if (sys.isNative && sys.os === sys.OS.ANDROID) {
    native.reflection.callStaticMethod(
        'com/cck/auth/GoogleSignInBridge', 'signIn',
        '(Ljava/lang/String;Ljava/lang/String;)V', webClientId, nonce);
}
```

`callStaticMethod(className, methodName, methodSignature, ...args)`：类名用 `/` 分隔全路径；签名格式 `(参数)返回值`（`I`/`F`/`Z`/`Ljava/lang/String;`/`V`）；**参数与返回值只支持 number / boolean / string**；调用是**同步的，跑在 GL 线程**，所以里面碰 UI 必须 `GlobalObject.runOnUiThread`（或 `CocosHelper.runOnUiThread`）。

**Java → JS：JsbBridge，异步，落到脚本线程**

```ts
native.bridge.onNative = (event: string, payload?: string | null) => {
    if (event !== 'google-signin') return;
    // payload 是上面 Java 侧拼的 JSON 字符串
};
```

`native.bridge.onNative` **只记一个函数**（后注册覆盖前一个）——框架里要自己做一层多路复用，别让两处业务各自赋值。

引擎源码事实（`3d/engine/native/cocos/bindings/manual/JavaScriptJavaBridge.cpp:207-211`）：`JsbBridge.nativeSendToScript` 内部走 `performFunctionInCocosThread`，**所以 JS 回调保证落在脚本线程**，可以直接碰引擎对象。`JsbBridge` 只能传字符串，复杂数据自己 JSON 化（官方文档也这么说，并标注该能力仍是 experimental）。

`com.cocos.lib.GlobalObject`（引擎源码核对）提供：`getActivity()` / `getContext()` / `runOnUiThread(Runnable)`。**这就是 Cocos 里拿 Activity 的正规途径**，不需要改 `AppActivity`。

### 4.2 哪些步骤**必须**在 Java 侧

| 步骤 | 必须 Java？ | 理由 |
|---|---|---|
| 构造 `GetSignInWithGoogleOption` / `GetCredentialRequest` | ✅ 必须 | 纯 Android 类型，JS 碰不到 |
| `CredentialManager.create(activity).getCredentialAsync(...)` | ✅ 必须 | 要 Activity、要弹系统 UI |
| 从 `GetCredentialResponse` 解出 `idToken` | ✅ 必须 | 要读 `Bundle` |
| 异常 → 字符串分类键 | ✅ 必须（只做搬运） | 异常对象过不了桥 |
| **生成 nonce** | ❌ 可以在 JS | 纯随机字符串，JS 生成后透传 |
| **判断「取消 vs 失败」并决定重试/降级** | ❌ 应该在 JS/VM | 是策略不是能力；VM 里可单测 |
| **解析 idToken 的 payload（读 `sub`/`exp`/`email`）** | ❌ 可以在 JS | JWT 就是 base64url，JS 侧 split('.') 解就行 |
| **调 tokeninfo 校验** | ❌ 应该在 JS | 一个 HTTP GET，走框架现成的 `INetwork` |
| 存 token / 关联账号 | ❌ JS | 走 `IStorage` |

⇒ **Java 侧可以薄到一个文件、一个 public static 方法、零状态**（上面的骨架就是全部）。所有分支逻辑留在 JS/VM，符合本仓「逻辑一律进 VM、可 node 直跑」的硬规则：`{ ok, kind, type, message, idToken }` 这个 JSON 契约就是 VM 的输入类型，单测里塞假 JSON 即可覆盖全部分支，不需要真机。

---

## 五、失败面清单

来源：[Troubleshoot common Credential Manager errors](https://developer.android.com/identity/sign-in/credential-manager-troubleshooting-guide)（官方），标注「社区」的是交叉验证结果。

| 异常类 | 官方错误文案 | 成因 | 我们该怎么办 |
|---|---|---|---|
| `GetCredentialCancellationException` | Sign in with Google 场景："Activity is cancelled by the user" | **用户在账号选择器上按返回 / 主动关掉** | **安静收摊**。官方明确写「不要自动重试，会造成打扰」；只在频次异常高时怀疑配置错 |
| `NoCredentialException` | "No matching credentials found" | ① `filterByAuthorizedAccounts=true` 但没有已授权账号；② **设备上没登任何 Google 账号**；③ 用户在系统设置 *Google Account Settings > Sign in with Google* 里全局关掉了登录提示 | 不是取消，是「没得选」。用 `GetGoogleIdOption` 时降级成 `filterByAuthorizedAccounts=false` 重试一次；再不行提示玩家去系统设置加 Google 账号 |
| `GetCredentialProviderConfigurationException` | "getCredentialAsync no provider dependencies found" | **漏了 `androidx.credentials:credentials-play-services-auth` 依赖** | 纯构建问题，加依赖 |
| `GetCredentialUnsupportedException` | "Your device doesn't support credential manager" | 设备不支持 | 把 Google 登录入口藏掉，走游客号 |
| `GetCredentialInterruptedException` | — | 操作被打断（如用户中途去改了密码管理器设置） | **可以重试**（官方明确） |
| `GetCredentialUnknownException` | 兜底 | 见下条 | 打日志、给玩家一个「稍后再试」 |
| `GetCredentialCustomException` | — | 第三方 SDK 自定义 option 才会有 | 我们用不到，记日志即可 |
| `android.os.TransactionTooLargeException` | — | 已知问题：Android 14+ 设备上有多个 Google 账号时，`GetGoogleIdOption`（不是 `GetSignInWithGoogleOption`）弹不出对话框 | 升 Play services 到 24.40.XX+；**这也是选 `GetSignInWithGoogleOption` 的一个理由** |

### 5.1 SHA-1 / client ID 配错长什么样

官方 troubleshooting 页**没有**收录这一条。社区（Capacitor / Flutter 的 issue、Google Cloud Community）一致的现场是：

```
androidx.credentials.exceptions.GetCredentialUnknownException:
    [28444] Developer console is not set up correctly.
```

（老的 GoogleSignIn API 里同一类问题表现为 `ApiException: 10 DEVELOPER_ERROR`。）

社区归纳的成因，按命中率：**① `serverClientId` 填成了 Android client ID（必须是 Web 类型）；② Android client 里的 package name 不等于实际 `applicationId`；③ 当前构建用的签名证书 SHA-1 没登记**。可信度：**社区交叉验证，非官方文档；待实测确认在 Credential Manager + googleid 1.2.0 组合下的确切文案**。

### 5.2 设备没有 GMS

官方文档没有直接说这种情况抛什么。**推断**：`credentials-play-services-auth` 找不到可用提供方 → `GetCredentialProviderConfigurationException` 或 `GetCredentialUnsupportedException`。**待实测**：拿一个不带 Google Play 的 AOSP 模拟器镜像跑一次，把真实异常类和文案记下来——这是「无 GMS 设备要不要显示 Google 登录按钮」的判据。

### 5.3 「取消不是失败」怎么落地

本仓硬规则要求区分取消与失败。映射：

- **取消**（安静收摊，不抛、不报错、不污染日志）：`GetCredentialCancellationException`。
- **可恢复的环境问题**（提示玩家、给替代路径）：`NoCredentialException`、`GetCredentialUnsupportedException`。
- **可重试**：`GetCredentialInterruptedException`。
- **真失败**（该抛、该报警）：`GetCredentialProviderConfigurationException`（构建配错）、`GetCredentialUnknownException`（含 28444 配置错）、`GoogleIdTokenParsingException`。

⚠️ 官方在 `GetCredentialCancellationException` 条目下补了一句：cancellation 也可能来自「技术性约束」而非真的用户手动取消，**大量出现要怀疑是配置问题**。所以「取消」要计数上报，不能完全静默。

---

## 六、拿到 idToken 后当场验证（不打自家服务端）

```bash
curl -s "https://oauth2.googleapis.com/tokeninfo?id_token=<粘贴 idToken>"
```

官方示例返回（[Backend auth](https://developers.google.com/identity/sign-in/web/backend-auth)）：

```json
{
 "iss": "https://accounts.google.com",
 "sub": "110169484474386276334",
 "azp": "1008719970978-hb24n2dstb40o45d4feuo2ukqmcc6381.apps.googleusercontent.com",
 "aud": "1008719970978-hb24n2dstb40o45d4feuo2ukqmcc6381.apps.googleusercontent.com",
 "iat": "1433978353",
 "exp": "1433981953",
 "email": "testuser@gmail.com",
 "email_verified": "true",
 "name" : "Test User",
 "picture": "https://lh4.googleusercontent.com/-kYgzyAWpZzJ/.../photo.jpg",
 "given_name": "Test",
 "family_name": "User",
 "locale": "en"
}
```

字段含义与我们要核对的期望值（[OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect)，官方文档明确）：

| 字段 | 官方定义 | 实测时应该等于 |
|---|---|---|
| `aud` | "The audience that this ID token is intended for. It must be one of the OAuth 2.0 client IDs of your application." | **我们传给 `setServerClientId` 的那个 Web client ID**。对不上 = 传错 client |
| `iss` | "Always `https://accounts.google.com` or `accounts.google.com`" | 二者之一 |
| `sub` | "An identifier for the user, unique among all Google Accounts and **never reused**… Use `sub` within your application as the unique-identifier key" | **这就是我们的玩家唯一 ID**（等于 `GoogleIdTokenCredential.getUniqueId()`）。不要用 email 当主键 |
| `exp` | "Expiration time on or after which the ID token must not be accepted"（Unix 秒） | 当前时间之后；Google idToken 有效期约 1 小时（上例 `exp - iat = 3600`） |
| `iat` | 签发时间（Unix 秒） | 约等于当前时间 |
| `azp` | "The `client_id` of the authorized presenter. This claim is only needed when the party requesting the ID token is not the same as the audience." | **待实测**：Android + Credential Manager 场景下它是等于 `aud`（示例如此），还是等于 Android client ID。别在验证逻辑里对它做硬断言 |
| `nonce` | "The value of the `nonce` supplied by your app… present this value only once" | **等于我们在 JS 侧生成、经桥传下去的那个串**——这条同时验证了「桥有没有把参数传对」 |
| `email` / `email_verified` | 邮箱及是否已验证 | Gmail 账号应为 `"true"`（注意 tokeninfo 返回的是**字符串** `"true"` 不是布尔） |
| `hd` | Workspace / Cloud 组织域名 | 个人账号没有这个字段 |

**官方警告（必须写进代码注释）**：tokeninfo 端点「useful for debugging but for production purposes, retrieve Google's public keys from the keys endpoint」，且「Requests to the debugging endpoint may be throttled or otherwise subject to intermittent errors」。

⇒ 定位：**tokeninfo 只用于本次实测与开发期自检**。正式链路必须由服务端用 Google 的公钥验签（服务端在另一个仓，不在本 ticket 范围）。

一次「当场验证」的判定清单（都满足才算通过）：

1. HTTP 200（400 说明 token 无效/过期/畸形）；
2. `aud` == 我们的 Web client ID；
3. `iss` ∈ {`accounts.google.com`, `https://accounts.google.com`}；
4. `exp` > now；
5. `nonce` == 我们发下去的那个；
6. `sub` 非空，且**同一 Google 账号重复登录两次 `sub` 相同**（这条最能证明它能当主键）。

---

## 七、实测前的准备清单（给下一个会话）

1. Google Cloud 项目里建两个 OAuth client：**Web**（记下 client ID）+ **Android**（`com.cck.demo` + debug SHA-1）。
2. 工程 minSdk 提到 **23**；确认 compileSdk ≥ 35（demo 现在 `apiLevel: 34`）。
3. `app/build.gradle` 加 §1.1 三条依赖。
4. 放入 §3 的 `GoogleSignInBridge.java`。
5. JS 侧：生成 nonce → `callStaticMethod` 发起 → `native.bridge.onNative` 收 JSON → VM 分流。
6. 模拟器必须是 **Google Play / Google APIs 镜像**，且**先在设置里登一个 Google 账号**（codelab 明确：不登会 `NoCredentialException`）。
7. 拿到 idToken → curl tokeninfo → 按 §6 六条判定。

---

## 八、待实测 / 待确认清单

| # | 事项 | 为什么重要 |
|---|---|---|
| 1 | 无 GMS 设备上到底抛哪个异常 | 决定「要不要显示 Google 登录按钮」的探测方式 |
| 2 | SHA-1 / client 类型配错的确切异常类与文案（是不是 `GetCredentialUnknownException: [28444] …`） | 排错手册要写准 |
| 3 | `azp` 在 Android Credential Manager 场景下等于什么 | 只影响文档准确性，不要在验证逻辑里断言 |
| 4 | Creator 的 `build-templates/` 里改 `gradle.properties`（minSdk）的确切路径 | 决定这条改动能不能随仓库走、不被重新构建冲掉 |
| 5 | `apiLevel: 34` 能否编过 `androidx.core:1.15.0` | 编不过就要提 compileSdk |
| 6 | Cocos 的 `AppActivity` 生命周期与 Credential Manager 弹窗是否有冲突（弹窗期间 GL 暂停/恢复） | 弹窗回来后引擎状态是否正常，属真机才能看到的坑 |
| 7 | release keystore 的 SHA-1 是否也要登记（几乎肯定要） | 上线前必踩 |
| 8 | `native.bridge.onNative` 单回调槽在本框架里怎么多路复用 | 一旦有第二个原生能力就会撞车 |

---

## 九、来源

**一手（官方）**

- [Implement Sign in with Google](https://developer.android.com/identity/sign-in/credential-manager-siwg-implementation) — 依赖、`serverClientId` = Web client ID、`GetGoogleIdOption` 用法、结果解包
- [About Sign in with Google](https://developer.android.com/identity/sign-in/credential-manager-siwg) — 前置条件、品牌验证、API 19+ 说法
- [Troubleshoot common Credential Manager errors](https://developer.android.com/identity/sign-in/credential-manager-troubleshooting-guide) — 异常清单与官方文案
- [CredentialManager API 参考](https://developer.android.com/reference/androidx/credentials/CredentialManager) — `getCredentialAsync` 回调版签名、Activity context
- [androidx.credentials 发布说明](https://developer.android.com/jetpack/androidx/releases/credentials) — 1.6.0 / 1.7.0-alpha03、minSdk 21→23
- [googleid 发布说明](https://developers.google.com/identity/android-credential-manager/releases) — 1.2.0（2026-01-22）
- [GetGoogleIdOption.Builder（Java 视图）](https://developers.google.com/identity/android-credential-manager/android/reference/com/google/android/libraries/identity/googleid/GetGoogleIdOption.Builder)
- [GetSignInWithGoogleOption.Builder（Java 视图）](https://developers.google.com/identity/android-credential-manager/android/reference/com/google/android/libraries/identity/googleid/GetSignInWithGoogleOption.Builder)
- [GoogleIdTokenCredential（Java 视图）](https://developers.google.com/identity/android-credential-manager/android/reference/com/google/android/libraries/identity/googleid/GoogleIdTokenCredential)
- [Verify the Google ID token / Backend auth](https://developers.google.com/identity/sign-in/web/backend-auth) — tokeninfo URL 与示例响应
- [OpenID Connect claim 定义](https://developers.google.com/identity/openid-connect/openid-connect) — `aud`/`azp`/`sub`/`exp`/`iss`/`nonce`/`hd`
- [Client authentication](https://developers.google.com/android/guides/client-auth) — Android client 的 package name + SHA-1，keytool 命令
- [Sign in with Google codelab](https://codelabs.developers.google.com/sign-in-with-google-android) — 建两个 OAuth client、模拟器必须登 Google 账号
- `credentials-play-services-auth-1.6.0.pom`（`dl.google.com/dl/android/maven2/...`）— 传递依赖表
- Cocos 官方：[JS↔Java 反射](https://docs.cocos.com/creator/3.8/manual/zh/advanced-topics/java-reflection.html)、[JsbBridge](https://docs.cocos.com/creator/3.8/manual/zh/advanced-topics/js-java-bridge.html)
- 本机 Cocos Creator 3.8.8 源码：`resources/3d/engine/native/cocos/platform/android/java/src/com/cocos/lib/{GlobalObject,JsbBridge}.java`、`bindings/manual/JavaScriptJavaBridge.cpp:207`、`templates/android/build/gradle.properties`、`templates/android/template/{build.gradle,app/build.gradle}`

**二手（仅作交叉验证，不单独立论）**

- Capacitor discussion #8444 / flutter issue #174319 / Google Cloud Community —— `[28444] Developer console is not set up correctly` 的成因归纳
- react-native-google-signin 排错文档 —— webClientId 必须是 Web 类型、package name 必须等于 applicationId

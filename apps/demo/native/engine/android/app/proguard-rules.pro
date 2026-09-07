# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in E:\developSoftware\Android\SDK/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# Add any project specific keep options here:

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Proguard Cocos2d-x-lite for release
-keep public class com.cocos.** { *; }
-dontwarn com.cocos.**

# Proguard Apache HTTP for release
-keep class org.apache.http.** { *; }
-dontwarn org.apache.http.**

# Proguard okhttp for release
-keep class okhttp3.** { *; }
-dontwarn okhttp3.**

-keep class okio.** { *; }
-dontwarn okio.**

# Proguard Android Webivew for release. you can comment if you are not using a webview
-keep public class android.net.http.SslError
-keep public class android.webkit.WebViewClient

-keep public class com.google.** { *; }

-dontwarn android.webkit.WebView
-dontwarn android.net.http.SslError
-dontwarn android.webkit.WebViewClient

# This is generated automatically by the Android Gradle plugin.
-dontwarn android.hardware.BatteryState
-dontwarn android.hardware.lights.Light
-dontwarn android.hardware.lights.LightState$Builder
-dontwarn android.hardware.lights.LightState
-dontwarn android.hardware.lights.LightsManager$LightsSession
-dontwarn android.hardware.lights.LightsManager
-dontwarn android.hardware.lights.LightsRequest$Builder
-dontwarn android.hardware.lights.LightsRequest
-dontwarn android.net.ssl.SSLSockets
-dontwarn android.os.VibratorManager
# ==== cck ====
#
# 崩溃上报的 JNI 入口。调用点在 JS 里（native.reflection.callStaticMethod），**R8 看不见**，
# 不 keep 就会被当死代码删掉 / 改名 —— debug 全对、release 才炸，且症状是「上报没了」，很安静。
# 各渠道的实现同名同包（gradle flavor 选一份），一条规则通吃。
-keep class com.cck.report.CckReport { *; }

# 让混淆后的 Java 堆栈还带得上文件名和行号。Cocos 模板原本一条都没有，于是正式包里
# 所有 Java 帧都长成 `Unknown Source` —— 崩溃上报接了也定位不到。
# 配套 -renamesourcefileattribute：源文件名统一改成 SourceFile，不泄漏原始文件名。
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# Bugly。⚠️ 它的 aar 里那份 proguard.txt 是 **0 字节** —— 一条 keep 规则都没带，
# 全靠使用方自己写。少了这段是 release 才炸。
-keep public class com.tencent.bugly.**{*;}
-dontwarn com.tencent.bugly.**

# Crashlytics 的 aar 自带 consumer rules，不用手写 keep。但合成的 JS 异常类要留住类名 ——
# 后台按 Throwable 的类名给问题分组，被混淆成 a.a.a 之后所有 JS 异常会挤成一堆。
-keep class com.cck.report.CckReport$JsException { *; }

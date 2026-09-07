package com.cck.report;

import android.app.Activity;
import android.content.pm.ApplicationInfo;
import android.util.Log;

import com.cocos.lib.GlobalObject;
import com.tencent.bugly.crashreport.CrashReport;

import org.json.JSONObject;

import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;

/**
 * 崩溃上报的 Bugly 实现 —— 国内渠道共用这一份（ADR-0022：能力代码不按渠道抄）。
 *
 * <p><b>类名 / 方法名 / 签名是跟 JS 侧的硬契约</b>，改了必须同步改
 * {@code packages/engine/src/crash-reporter.ts}。反射调用点 R8 看不见，
 * {@code proguard-rules.pro} 里的 {@code -keep} 是必须的。
 *
 * <p>载荷格式见 {@code packages/core/docs/modules/crash-reporting.md}。Bugly 这半只用
 * {@code stack} 字符串，用不上 {@code frames} —— {@code postException} 的堆栈参数
 * 本来就吃任意文本，这是它比 Crashlytics 省事的地方。
 */
public final class CckReport {
    private static final String TAG = "CckReport";

    /**
     * Bugly 的 APP ID。它随 APK 分发、反编译可见，<b>不是密钥</b>，所以可以入库。
     * 真正的密钥是 App Key（只给符号表上传工具 {@code buglyqq-upload-symbol.jar} 与开放 API 用），
     * 那个不进仓库。
     */
    private static final String APP_ID = "2b8ec7d278";

    /** 官方定义的上报类别：u3d c# = 4，<b>js = 8</b>，cocos2d lua = 6。 */
    private static final int CATEGORY_JS = 8;

    /** 后台的聚合维度之一。固定成一个值，让 JS 异常自成一类。 */
    private static final String ERROR_TYPE = "JsError";

    /** {@code extraInfo} 官方上限：最多 50 对，key ≤ 50 字节、value ≤ 200 字节，<b>超长截断</b>。 */
    private static final int MAX_VALUE = 200;

    private CckReport() {}

    /**
     * 启动时调一次，参数是 JS 侧的上下文表（不是崩溃载荷）。
     *
     * <p>Bugly 必须显式初始化才会工作 —— 这跟 Crashlytics 靠 ContentProvider 自动起来不一样，
     * 所以这个入口对 Bugly 是刚需，不是可选项。
     */
    public static void init(String ctxJson) {
        try {
            Activity act = GlobalObject.getActivity();
            if (act == null) {
                Log.e(TAG, "GlobalObject.getActivity() 为 null，Bugly 未初始化");
                return;
            }
            // isDebug = true 时 Bugly **立刻**上报（否则要等下次启动才发），并打自己的调试日志。
            // 用 FLAG_DEBUGGABLE 而不是 BuildConfig.DEBUG：BuildConfig 的包名跟着 applicationId 走，
            // 而这份代码是几个渠道共享的能力实现，不该认识某个具体 App 的包名。
            boolean isDebug = (act.getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
            CrashReport.initCrashReport(act.getApplicationContext(), APP_ID, isDebug);

            // ⚠️ 版本要喂**热更之后**的真实版本。不设的话后台读的是 APK 的 versionName，
            // 于是热更前后的问题全堆在出包那天的版本号下面，分不开。
            JSONObject ctx = new JSONObject(ctxJson == null ? "{}" : ctxJson);
            String ver = ctx.optString("ver", null);
            if (ver != null && ver.length() > 0) {
                CrashReport.setAppVersion(act, ver);
            }
        } catch (Throwable t) {
            // 上报组件自己挂了不该连累游戏启动。
            Log.e(TAG, "Bugly 初始化失败", t);
        }
    }

    /** JS 侧唯一的上报入口。哪一份实现被编进包里，由 gradle flavor 决定。 */
    public static void report(String json) {
        if (json == null) {
            return;
        }
        try {
            JSONObject o = new JSONObject(json);
            Map<String, String> extra = new HashMap<>();
            JSONObject ctx = o.optJSONObject("ctx");
            if (ctx != null) {
                for (Iterator<String> it = ctx.keys(); it.hasNext(); ) {
                    String k = it.next();
                    extra.put(k, clamp(ctx.optString(k)));
                }
            }
            extra.put("where", clamp(o.optString("location") + ":" + o.optInt("linenum")));

            CrashReport.postException(
                    CATEGORY_JS, ERROR_TYPE, o.optString("message"), o.optString("stack"), extra);
        } catch (Throwable t) {
            Log.e(TAG, "上报失败", t);
        }
    }

    private static String clamp(String s) {
        return s.length() <= MAX_VALUE ? s : s.substring(0, MAX_VALUE);
    }
}

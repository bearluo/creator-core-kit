package com.cck.report;

import android.util.Log;

import com.google.firebase.FirebaseApp;
import com.google.firebase.crashlytics.FirebaseCrashlytics;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;

/**
 * 崩溃上报的 Firebase Crashlytics 实现 —— 海外渠道用这份（ADR-0022）。
 *
 * <p><b>类名 / 方法名 / 签名是跟 JS 侧的硬契约</b>，改了必须同步改
 * {@code packages/engine/src/crash-reporter.ts}。反射调用点 R8 看不见，
 * {@code proguard-rules.pro} 里的 {@code -keep} 是必须的。
 *
 * <p>⚠️ <b>Crashlytics 的 Android SDK 没有「上报一段自定义堆栈文本」的 API</b>
 * （iOS 有 {@code ExceptionModel} + {@code StackFrame}，Android 没有对应物）。唯一能带堆栈的
 * 入口是 {@code recordException(Throwable)}，所以这里造一个 {@link JsException}、把 JS 的帧
 * {@code setStackTrace} 进去。帧是 {@code @cck/core} 的 {@code parseJsFrames} 拆好递过来的
 * （{@code frames} 字段）—— 拆解有分支、有畸形行要跳过，属逻辑，不该写在这个测不到的层里。
 */
public final class CckReport {
    private static final String TAG = "CckReport";

    /** {@code StackTraceElement} 的「类名」段。JS 没有这个概念，给个固定值让后台那行读得顺。 */
    private static final String JS_CLASS = "js";

    private CckReport() {}

    /**
     * 启动时调一次，参数是 JS 侧的上下文表（不是崩溃载荷）。
     *
     * <p>Crashlytics <b>不需要</b>显式初始化 —— {@code FirebaseInitProvider} 这个
     * ContentProvider 会在进程起来时自动跑 {@code FirebaseApp.initializeApp()}。
     *
     * <p>但本仓按 ADR-0022 <b>不 apply 任何 Firebase gradle plugin</b>，配置是手写进
     * {@code src/google/res/values/firebase.xml} 的几条 string 资源。这条路的依据是
     * {@code FirebaseOptions.fromResource()} 本来就按那几个名字读 string，plugin 只是把
     * {@code google-services.json} 转成它们 —— <b>但这是机制推断，不是实证</b>
     * （ADR-0022 里唯一没有一手依据的决策）。所以这里把 {@code FirebaseApp} 拿没拿到打出来：
     * 拿不到就说明手写 string 这条路不通，得退回「条件 apply plugin」。
     */
    public static void init(String ctxJson) {
        try {
            FirebaseApp app = FirebaseApp.getInstance();
            Log.i(TAG, "FirebaseApp 就绪：" + app.getName() + " / " + app.getOptions().getApplicationId());
        } catch (Throwable t) {
            // getInstance() 在没初始化时抛 IllegalStateException。
            Log.e(TAG, "FirebaseApp 拿不到 —— 手写 firebase.xml 这条路没走通，崩溃上报不会生效", t);
            return;
        }
        try {
            FirebaseCrashlytics fc = FirebaseCrashlytics.getInstance();
            JSONObject ctx = new JSONObject(ctxJson == null ? "{}" : ctxJson);
            for (Iterator<String> it = ctx.keys(); it.hasNext(); ) {
                String k = it.next();
                fc.setCustomKey(k, ctx.optString(k));
            }
        } catch (Throwable t) {
            Log.e(TAG, "Crashlytics 上下文设置失败", t);
        }
    }

    /** JS 侧唯一的上报入口。哪一份实现被编进包里，由 gradle flavor 决定。 */
    public static void report(String json) {
        if (json == null) {
            return;
        }
        try {
            JSONObject o = new JSONObject(json);
            FirebaseCrashlytics fc = FirebaseCrashlytics.getInstance();

            // 上下文每次现设：热更后 ver 会变，场景更是随时在变。
            JSONObject ctx = o.optJSONObject("ctx");
            if (ctx != null) {
                for (Iterator<String> it = ctx.keys(); it.hasNext(); ) {
                    String k = it.next();
                    fc.setCustomKey(k, ctx.optString(k));
                }
            }
            fc.setCustomKey("where", o.optString("location") + ":" + o.optInt("linenum"));

            // ⚠️ 原始 stack 也要原样留一份：`StackTraceElement` 的四个字段里**没有「列」**，
            // 所以 recordException 那份堆栈只能定位到行 —— 而 sourcemap 还原要的是 line+column
            // （压缩后一行塞着十几个函数，只喂 line 会还原到那行的第一个映射，多半是错的）。
            // Crashlytics 的 log 会挂在紧随其后的那条记录上，上限 64KB，够装 30 帧。
            String stack = o.optString("stack");
            if (stack.length() > 0) {
                fc.log(stack);
            }

            JsException e = new JsException(o.optString("message"));
            e.setStackTrace(frames(o));
            fc.recordException(e);
        } catch (Throwable t) {
            Log.e(TAG, "上报失败", t);
        }
    }

    /**
     * {@code frames} → {@code StackTraceElement[]}。
     *
     * <p>空堆栈也要给一帧：{@code setStackTrace(new StackTraceElement[0])} 之后后台那条问题
     * 一行位置都没有，比没上报还难查。退化时用 {@code location} + {@code linenum} 顶上。
     */
    private static StackTraceElement[] frames(JSONObject o) {
        List<StackTraceElement> out = new ArrayList<>();
        JSONArray arr = o.optJSONArray("frames");
        if (arr != null) {
            for (int i = 0; i < arr.length(); i++) {
                JSONObject f = arr.optJSONObject(i);
                if (f == null) {
                    continue;
                }
                out.add(new StackTraceElement(
                        JS_CLASS, f.optString("fn"), f.optString("file"), f.optInt("line")));
            }
        }
        if (out.isEmpty()) {
            out.add(new StackTraceElement(
                    JS_CLASS, "<unknown>", o.optString("location"), o.optInt("linenum")));
        }
        return out.toArray(new StackTraceElement[0]);
    }

    /**
     * Crashlytics 后台按 {@code Throwable} 的类名给问题分组，所以 JS 异常要有自己的类型名，
     * 否则会跟别的 {@code RuntimeException} 混在一起。
     */
    static final class JsException extends Throwable {
        JsException(String message) {
            super(message);
        }

        /** 合成栈会被 {@code setStackTrace} 覆盖，先填一遍 Java 的调用栈纯属浪费。 */
        @Override
        public synchronized Throwable fillInStackTrace() {
            return this;
        }
    }
}

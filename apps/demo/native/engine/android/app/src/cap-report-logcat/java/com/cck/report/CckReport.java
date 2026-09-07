package com.cck.report;

import android.util.Log;

/**
 * 崩溃上报的「不接第三方」实现 —— 只把载荷原样打进 logcat。
 *
 * <p>它有两个用处：
 * <ul>
 *   <li>{@code dev} 渠道的正式实现（本地跑不该往任何后台发数据）；</li>
 *   <li>接真 SDK 之前先把 <b>JS → JNI → Java</b> 这条链单独验通 —— 链路和 SDK 分开验，
 *       出问题时才知道该怪谁。</li>
 * </ul>
 *
 * <p><b>类名 / 方法名 / 签名是跟 JS 侧的硬契约</b>，改了这三样必须同步改
 * {@code packages/engine/src/crash-reporter.ts}：
 * {@code native.reflection.callStaticMethod("com/cck/report/CckReport", "report", "(Ljava/lang/String;)V", json)}。
 * 反射调用点 R8 看不见，{@code proguard-rules.pro} 里那条 {@code -keep} 是必须的
 * ——不加是 debug 全对、release 才炸。
 *
 * <p>载荷格式见 {@code packages/core/docs/modules/crash-reporting.md}。
 */
public final class CckReport {
    private static final String TAG = "CckReport";

    /** logcat 单条约 4000 字节封顶，超了**静默截断**——而被截掉的正是堆栈尾巴。 */
    private static final int CHUNK = 3000;

    private CckReport() {}

    /** JS 侧唯一的入口。各渠道的同名类各写各的实现，由 gradle flavor 选中哪一份。 */
    public static void report(String json) {
        if (json == null) {
            return;
        }
        for (int i = 0; i < json.length(); i += CHUNK) {
            Log.e(TAG, json.substring(i, Math.min(json.length(), i + CHUNK)));
        }
    }
}

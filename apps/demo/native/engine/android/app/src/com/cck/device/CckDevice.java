package com.cck.device;

import android.app.ActivityManager;
import android.app.ApplicationExitInfo;
import android.content.Context;
import android.os.Build;
import android.text.TextUtils;
import android.util.Log;

import com.cocos.lib.GlobalObject;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.FileReader;
import java.util.List;

/**
 * 设备画像的 Android 取值端 —— kit 的 {@code device-profile} 模块唯一的原生依赖。
 *
 * <p><b>类名 / 方法名 / 签名是跟 JS 侧的硬契约</b>，改了必须同步改
 * {@code packages/engine/src/device-profile.ts}：
 * {@code native.reflection.callStaticMethod("com/cck/device/CckDevice", "readProfile", "()Ljava/lang/String;")}。
 * 反射调用点 R8 看不见，{@code proguard-rules.pro} 里那条 {@code -keep} 是必须的
 * ——不加是 debug 全对、release 才炸。
 *
 * <p><b>一次调用返回一整个 JSON</b>，不是十几个 getter。三个理由：
 * <ol>
 *   <li>十几个字段只走一次 JNI；</li>
 *   <li>返回类型只有 {@code String}，完全绕开「{@code native.reflection} 的 {@code J}(long)
 *       返回可不可用」那个未验证项 —— 内部照常用 long，只是不跨 JNI 边界；</li>
 *   <li>解析落在 core 的纯函数里，node 可穷举。</li>
 * </ol>
 *
 * <p><b>这个类跟渠道无关</b>，所以放 main 源集（{@code app/src/com/...}）而不是
 * {@code cap-*} 能力目录 —— 三个 flavor 共用同一份。
 *
 * <p>零权限：本文件用到的每个 API 在官方文档上都没有 {@code Requires Manifest.permission.*}
 * 标注。**别加 {@code Build.getSerial()}** —— 那个要 {@code READ_PRIVILEGED_PHONE_STATE}，
 * 第三方应用根本申请不到，而且打分不需要设备唯一标识。
 *
 * <p>字段语义与「取不到的三种状态」见 {@code packages/engine/docs/modules/device-profile.md}。
 */
public final class CckDevice {
    private static final String TAG = "CckDevice";

    private CckDevice() {}

    /**
     * 读一份设备画像，返回 JSON。**永不抛** —— 抛出去会被 JS 侧当成「这个工程没装这个能力」，
     * 那是另一种语义。每一项独立 try/catch，失败的把字段名放进 {@code readFailures}。
     */
    public static String readProfile() {
        JSONObject o = new JSONObject();
        JSONArray failures = new JSONArray();
        try {
            Context ctx = GlobalObject.getContext();
            memory(ctx, o, failures);
            cpu(o, failures);
            screen(ctx, o, failures);
            identity(o, failures);
            lastExit(ctx, o, failures);
            o.put("readFailures", failures);
        } catch (Throwable t) {
            // 连组装都失败了：仍然交出一份**合法** JSON，否则 JS 侧会把它当「桥坏了」，
            // 而那条路已经有自己的含义。
            Log.w(TAG, "readProfile failed", t);
        }
        return o.toString();
    }

    private static void memory(Context ctx, JSONObject o, JSONArray f) {
        // 进程堆上限：稳定常量，Android 独有。iOS 没有等价物（它只给易变余量）。
        put(o, f, "processMemoryLimitBytes", () -> Runtime.getRuntime().maxMemory());

        ActivityManager am = (ActivityManager) ctx.getSystemService(Context.ACTIVITY_SERVICE);
        if (am == null) {
            f.put("deviceTotalMemoryBytes");
            f.put("availableMemoryBytes");
            f.put("lowRamDevice");
            return;
        }
        try {
            ActivityManager.MemoryInfo mi = new ActivityManager.MemoryInfo();
            am.getMemoryInfo(mi);
            o.put("deviceTotalMemoryBytes", mi.totalMem);
            o.put("availableMemoryBytes", mi.availMem);
        } catch (Throwable t) {
            f.put("deviceTotalMemoryBytes");
            f.put("availableMemoryBytes");
        }
        put(o, f, "lowRamDevice", am::isLowRamDevice);
    }

    private static void cpu(JSONObject o, JSONArray f) {
        // ⚠️ 官方原文「This value may change during a particular invocation of the virtual
        // machine」——**不是常量**。画像整体是「启动那一刻的快照」，别当永恒真理缓存。
        put(o, f, "cpuCores", () -> Runtime.getRuntime().availableProcessors());

        // AOSP 默认允许读 /sys/devices/system/cpu/**，但**厂商可以在自己的 genfs_contexts 里
        // 收紧**，而且部分设备内核没开 cpufreq CONFIG、节点压根不存在。
        // 读不到就记一笔失败 —— 「哪批机型上读不到」正是这个清单要捞的信息。
        String freq = readFirstLine("/sys/devices/system/cpu/cpu0/cpufreq/cpuinfo_max_freq");
        if (freq == null) {
            f.put("cpuMaxFreqKHz");
        } else {
            try {
                o.put("cpuMaxFreqKHz", Long.parseLong(freq.trim()));
            } catch (Throwable t) {
                f.put("cpuMaxFreqKHz");
            }
        }
    }

    private static void screen(Context ctx, JSONObject o, JSONArray f) {
        // ⚠️ **必须走这里拿**：`screen.devicePixelRatio` 在 Android 原生上恒为 1
        // （引擎 CommonScreen.cpp 硬编码 return 1），它是渲染缩放系数，不是 DisplayMetrics.density。
        // 分辨率则相反 —— 引擎的 screen.windowSize 就是物理像素，不用在这儿重复读。
        put(o, f, "densityDpi", () -> ctx.getResources().getDisplayMetrics().densityDpi);
    }

    private static void identity(JSONObject o, JSONArray f) {
        put(o, f, "brand", () -> Build.BRAND);
        put(o, f, "model", () -> Build.MODEL);
        // 桥不能读数组，拼成逗号分隔的 String 递过去。
        put(o, f, "abis", () -> TextUtils.join(",", Build.SUPPORTED_ABIS));

        // Build.SOC_MODEL 是 **API 31+**。低版本上它**天然缺席**，不是读失败 ——
        // 所以这里不进 readFailures（无值 + 不在清单 = 这个平台没这能力）。
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            put(o, f, "socModel", () -> Build.SOC_MODEL);
        }
    }

    private static void lastExit(Context ctx, JSONObject o, JSONArray f) {
        // getHistoricalProcessExitReasons 是 **API 30+（Android 11）**。低版本上同样是
        // 「这个系统没这能力」，不记失败 —— 而且**刻意不做留痕兜底**：切后台不清标记会让
        // 几乎每次启动都读到「上次非正常」（全假阳性），切后台就清则会把后台被 OOM 掉的
        // 那次读成干净退出（漏的正是最典型的那种）。坏信号比没信号更糟。
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            return;
        }
        ActivityManager am = (ActivityManager) ctx.getSystemService(Context.ACTIVITY_SERVICE);
        if (am == null) {
            f.put("lastExitReasonCode");
            return;
        }
        try {
            // 只要最近一条；maxNum=1。第二个参数 pid=0 表示不按 pid 过滤。
            List<ApplicationExitInfo> list =
                    am.getHistoricalProcessExitReasons(ctx.getPackageName(), 0, 1);
            if (list != null && !list.isEmpty()) {
                // 递**原始 int**，映射表在 core（那边 node 里能逐个断言；这边一有分支就测不了）。
                o.put("lastExitReasonCode", list.get(0).getReason());
            }
            // 列表为空 = 这是头一次启动，没有「上次」。**不是失败。**
        } catch (Throwable t) {
            f.put("lastExitReasonCode");
        }
    }

    // —— 小工具 ——

    private interface Get<T> {
        T get() throws Throwable;
    }

    /** 取一项：成功放进 JSON，失败把字段名记进清单。空字符串按「没读到」处理。 */
    private static <T> void put(JSONObject o, JSONArray f, String key, Get<T> get) {
        try {
            T v = get.get();
            if (v == null || "".equals(v)) {
                f.put(key);
                return;
            }
            o.put(key, v);
        } catch (Throwable t) {
            f.put(key);
        }
    }

    /** 读文件首行；任何失败（不存在 / SELinux 挡了 / 读不动）都返回 null。 */
    private static String readFirstLine(String path) {
        try (BufferedReader r = new BufferedReader(new FileReader(path))) {
            return r.readLine();
        } catch (Throwable t) {
            return null;
        }
    }
}

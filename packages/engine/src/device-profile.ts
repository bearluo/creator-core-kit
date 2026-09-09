import { director, gfx, native, screen, sys } from 'cc';
import {
  DEVICE_PROFILE,
  mergeDeviceProfile,
  parseBridgeProfile,
  type DeviceProfile,
  type KitModule,
} from '@cck/core';

/**
 * 设备画像的引擎半 —— **按平台取值，不含判断**。
 *
 * 判断全在 `@cck/core` 的 `parseBridgeProfile` / `mergeDeviceProfile` 里（类型守卫、
 * `readFailures` 记账、`REASON_*` 映射），node 全测得到。这里薄到**没有分支可测** ——
 * `native.reflection` 是 JNI，按 [[adr-0002]] 禁止进 cc mock，所以凡是能下沉的都下沉了。
 *
 * ## 原生桥的契约
 *
 * 跟崩溃上报同一套路（契约在 kit，实现在接入方工程的 `native/`）：
 *
 * ```java
 * package com.cck.device;
 * public final class CckDevice {
 *     public static String readProfile() { … }   // 返回一整个 JSON
 * }
 * ```
 *
 * **一次调用返回一整个 JSON**，而不是十几个 getter，换来三件事：
 * ① 十几个字段只走一次 JNI；② 完全绕开「`native.reflection` 的 `J`(long) 返回可不可用」
 * 那个未验证项（返回类型只有 `String`）；③ 解析成了纯逻辑，core 里可穷举。
 *
 * **类不存在时 `callStaticMethod` 会同步抛**（见 hlgit #35）——那被当作
 * 「这个工程没装这个能力」，**不记 `readFailures`**：缺席不是故障。装了却返回垃圾才算故障。
 */
const BRIDGE_CLASS = 'com/cck/device/CckDevice';
const BRIDGE_METHOD = 'readProfile';
const BRIDGE_SIG = '()Ljava/lang/String;';

/** 桥回来的 JSON；桥不在（或不是 Android）就是 `undefined`。 */
function readBridgeJson(): string | undefined {
  // 只认 Android：`CckDevice` 是个 Java 类，且 iOS 的 callStaticMethod 不吃签名那个参数
  // （三平台同名不同义，见 hlgit #22 §1.4）——所以接缝定在「给我一份画像」这层，不在调用管道那层。
  if (sys.os !== sys.OS.ANDROID) return undefined;
  try {
    const s = native.reflection.callStaticMethod(BRIDGE_CLASS, BRIDGE_METHOD, BRIDGE_SIG) as unknown;
    return typeof s === 'string' ? s : undefined;
  } catch {
    return undefined; // 工程没装那份 Java —— 缺席不是故障
  }
}

/** 引擎白送的那几项：GPU 型号 / 能力位 / 屏幕 / 系统版本。四平台都走这条。 */
function readFromEngine(): { fields: Partial<DeviceProfile>; readFailures: string[] } {
  const fields: Partial<DeviceProfile> = {};
  const readFailures: string[] = [];

  const size = screen.windowSize;
  // Android 原生上 devicePixelRatio 恒为 1，windowSize 即物理像素（hlgit #22 §1.2）。
  Object.assign(fields, { screenWidthPx: size.width, screenHeightPx: size.height });
  if (sys.osVersion) Object.assign(fields, { osVersion: sys.osVersion });

  // `director.root.device` 要等渲染设备建好才存在。boot() 跑在 Bootstrap 组件的 start() 里，
  // 那时它一定就位；真没有就是**本该有却没有**，记一笔让埋点看得见。
  const device = director.root?.device;
  if (!device) {
    readFailures.push('gpu');
    return { fields, readFailures };
  }

  Object.assign(fields, {
    // 原样透出，解析规则归项目 —— 这串东西的格式跟**渲染后端**绑定而不是平台
    // （GLES3 是 glGetString(GL_RENDERER)，Vulkan 是 VkPhysicalDeviceProperties.deviceName）。
    gpuRenderer: device.renderer,
    gpuVendor: device.vendor,
    maxTextureSize: device.capabilities.maxTextureSize,
    // 能力位：**分档不用猜 GPU 型号，直接问「支不支持这个压缩格式」**。
    supportsAstc: hasSampled(device, gfx.Format.ASTC_RGBA_4X4),
    supportsEtc2: hasSampled(device, gfx.Format.ETC2_RGBA8),
  });
  return { fields, readFailures };
}

function hasSampled(device: gfx.Device, format: gfx.Format): boolean {
  return (device.getFormatFeatures(format) & gfx.FormatFeatureBit.SAMPLED_TEXTURE) !== 0;
}

/**
 * 现读一份设备画像。
 *
 * **常规消费方不该调它** —— 用 DI 里的 `DEVICE_PROFILE`（一份启动快照，零成本）。
 * 这个裸函数是留给**真的需要周期重读**的场景（典型是往 `PerfWindow.peak()` 里喂内存峰值）：
 * 自己定频率、自己承担代价。这样 `perf-window` 就不必反过来依赖 `device-profile`。
 *
 * ⚠️ 每次调用都会走一趟 JNI。别在每帧、也别在崩溃上报的 `getContext` 里调。
 */
export function readDeviceProfile(): DeviceProfile {
  return mergeDeviceProfile(parseBridgeProfile(readBridgeJson()), readFromEngine());
  // 引擎那份排在后面 = 它盖桥：反射那头是间接来的，引擎这头是本进程的真值。
}

/**
 * `KitModule`：`install()` 时读一次，把**快照**注册进容器。跟 `ccStorageModule` 逐字同构。
 *
 * 注册的是**数据不是取数器**：业务自己也要读画像，留个 `read()` 会诱人反复调，而崩溃上报的
 * `getContext` 是每报一次现取的 —— 一次异常风暴就能把 JNI 桥打满。给一份数据，
 * 「它是启动那一刻的快照」还能由类型自己说，不用靠文档记住。
 */
export function deviceProfileModule(): KitModule {
  return {
    name: 'device-profile',
    install(ctx) {
      if (!ctx.container.hasLocal(DEVICE_PROFILE)) {
        ctx.container.register(DEVICE_PROFILE, { useValue: readDeviceProfile() });
      }
    },
  };
}

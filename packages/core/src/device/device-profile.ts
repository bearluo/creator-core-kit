import { createToken, type Token } from '../di';

/**
 * DeviceProfile —— 设备画像。**启动那一刻的一份不可变快照**，不是永恒真理。
 *
 * 设计见 `docs/design/device-tiering-overview.md` §2。三条要点：
 *
 * 1. **「内存额度」拆成三个自带语义的字段，故意不合并。** Android 的 `Runtime.maxMemory()`
 *    是稳定常量、iOS 的 `os_proc_available_memory()` 是易变余量、web 的 `navigator.deviceMemory`
 *    是量化过的设备 RAM —— 四个平台是**四种不同的量**。合并成一个数，打分函数就会拿到一个
 *    **含义随平台漂移**的数字：同样是 2048，在 Android 上是「进程堆上限」，在 iOS 上是
 *    「此刻还剩多少」。**名字承担语义。**
 * 2. **「取不到」有三种状态**，靠 `readFailures` 区分（见该字段注释）。这个区分**刻意不写进
 *    类型**：打分逻辑一行都不关心区别，两种情况它都只能跳过这一项；写进类型 = 让每个读取点
 *    被迫解一次它不需要的包。
 * 3. **它是快照，不是常量表。** 尤其 **CPU 核数在 Android / iOS 都不是可缓存常量**
 *    （Android 官方原文「This value may change during a particular invocation of the virtual
 *    machine」，iOS 侧受热节流影响）。要实时值去问性能采集器，别把这里的值当永恒真理缓存。
 */
export interface DeviceProfile {
  // —— 内存。三个量，三种语义，不许合并 ——
  /** 单进程堆上限（稳定常量）。Android `Runtime.maxMemory()`。**只有 Android 有。** */
  readonly processMemoryLimitBytes?: number;
  /** 设备总内存。Android `mi.totalMem` / web `navigator.deviceMemory` / 微信 `memorySize`。 */
  readonly deviceTotalMemoryBytes?: number;
  /** 当前可用余量（**易变**）。Android `mi.availMem` / iOS `os_proc_available_memory()`。 */
  readonly availableMemoryBytes?: number;
  /** 系统自己认定的低内存机。Android `ActivityManager.isLowRamDevice()`（API 19）。 */
  readonly lowRamDevice?: boolean;

  // —— CPU ——
  /** 核数（JVM / 进程视角）。⚠️ **不是常量**，见类型头第 3 条。 */
  readonly cpuCores?: number;
  /** 最大主频（kHz），读 `/sys/.../cpufreq/cpuinfo_max_freq`。部分设备内核没这个节点。 */
  readonly cpuMaxFreqKHz?: number;

  // —— 屏幕 ——
  readonly screenWidthPx?: number;
  readonly screenHeightPx?: number;
  /**
   * 像素密度。⚠️ **必须走原生桥拿 `DisplayMetrics.densityDpi`** ——
   * `screen.devicePixelRatio` 在 Android 原生上**恒为 1**（引擎 `CommonScreen.cpp` 硬编码
   * `return 1;`），它是引擎的渲染缩放系数，不是 `DisplayMetrics.density`。
   */
  readonly densityDpi?: number;

  // —— 机器身份。给日志与「机型修正表」当主键，**不参与打分** ——
  readonly brand?: string;
  readonly model?: string;
  /** SoC 型号。`Build.SOC_MODEL` 是 **API 31+**，低版本上这一项天然缺席（不是失败）。 */
  readonly socModel?: string;
  /** 支持的 ABI，逗号分隔（桥不支持返回数组，Java 侧拼好）。 */
  readonly abis?: string;
  readonly osVersion?: string;

  // —— GPU ——
  /**
   * GPU 型号字符串，**原样透出，解析规则归项目**。
   * ⚠️ 它的格式跟**渲染后端**绑定而不是平台：GLES3 给 `glGetString(GL_RENDERER)`，
   * Vulkan 给 `VkPhysicalDeviceProperties.deviceName`。同一台机换个 build config 就换一套格式。
   */
  readonly gpuRenderer?: string;
  readonly gpuVendor?: string;
  readonly maxTextureSize?: number;
  /** 能力位：问「支不支持」而不是「是多少」。**分档不用猜 GPU 型号，直接问它。** */
  readonly supportsAstc?: boolean;
  readonly supportsEtc2?: boolean;

  /**
   * 上次进程为什么没的。见 {@link exitReasonName} 的取值表；无法识别的码为 `unknown-<码>`。
   * **Android 11（API 30）以下没有这个能力** —— 那时它缺席且**不在** `readFailures` 里。
   */
  readonly lastExitReason?: string;

  /**
   * 本该读得到、这次却没读到的字段名。**只喂埋点，打分不该读它。**
   *
   * | 现象 | 含义 |
   * |---|---|
   * | 有值 | 读到了 |
   * | 无值，且**不在**本清单 | **这个平台就没有这个能力**（web 没有进程堆上限；Android < 11 没有退出原因） |
   * | 无值，且**在**本清单 | **本该有、这次没读到** —— 意味着某批机型上打分静默降级了，而我们不知道 |
   */
  readonly readFailures: readonly string[];
}

/** DI token：装一份**启动快照**。由 engine 的 `deviceProfileModule()` 在 `install()` 时注册。 */
export const DEVICE_PROFILE: Token<DeviceProfile> = createToken<DeviceProfile>('cck.deviceProfile');

/**
 * `android.app.ApplicationExitInfo` 的 `REASON_*` → 稳定字符串。
 *
 * **值取自 `javap -constants` 读 `android.jar`（android-35），不是凭记忆写的**，
 * 名字则是常量名的 camelCase 机械转写（不做归类判断 —— 归类是项目的事）。
 *
 * 映射放在这里而不是 Java 侧，是为了让 Java 那半薄到没有分支可测（ADR-0002 禁止 JNI 进 cc mock）：
 * Java 只调一句 `info.getReason()` 把 int 递过来，判断全在这张表上，node 里可穷举。
 */
const EXIT_REASONS: Readonly<Record<number, string>> = {
  0: 'unknown',
  1: 'exitSelf',
  2: 'signaled',
  3: 'lowMemory',
  4: 'crash',
  5: 'crashNative',
  6: 'anr',
  7: 'initializationFailure',
  8: 'permissionChange',
  9: 'excessiveResourceUsage',
  10: 'userRequested',
  11: 'userStopped',
  12: 'dependencyDied',
  13: 'other',
  14: 'freezer',
  15: 'packageStateChange',
  16: 'packageUpdated',
};

/**
 * 把 `ApplicationExitInfo.getReason()` 的原始 int 翻成稳定字符串。
 *
 * 未来的新码翻成 `unknown-<码>` 而不是 `'other'` —— `REASON_OTHER`(13) 是一个**有确切含义**的
 * 取值，把不认识的码并进去等于伪造信息。带上码，埋点里一眼能查回官方常量表。
 */
export function exitReasonName(code: number): string {
  return EXIT_REASONS[code] ?? `unknown-${code}`;
}

/** 原生桥（`CckDevice.readProfile()`）返回的 JSON 形状。字段全部可缺。 */
interface BridgePayload {
  readonly lastExitReasonCode?: unknown;
  readonly readFailures?: unknown;
  readonly [k: string]: unknown;
}

/** 画像里取值为数字的字段。 */
const NUMBER_FIELDS = [
  'processMemoryLimitBytes',
  'deviceTotalMemoryBytes',
  'availableMemoryBytes',
  'cpuCores',
  'cpuMaxFreqKHz',
  'screenWidthPx',
  'screenHeightPx',
  'densityDpi',
  'maxTextureSize',
] as const;

/** 取值为非空字符串的字段。 */
const STRING_FIELDS = ['brand', 'model', 'socModel', 'abis', 'osVersion'] as const;

/** 取值为布尔的字段。 */
const BOOLEAN_FIELDS = ['lowRamDevice', 'supportsAstc', 'supportsEtc2'] as const;

/** 桥整体不可用时记在 `readFailures` 里的名字。 */
export const BRIDGE_FAILURE = 'bridge';

/** 一路来源解析出来的半成品：认下的字段 + 本该读到却没读到的字段名。 */
export interface ProfileParts {
  readonly fields: Partial<DeviceProfile>;
  readonly readFailures: string[];
}

/**
 * 解析原生桥返回的 JSON。**桥只调一次、返回一整个 JSON**，所以这一步是纯逻辑、node 全可测。
 *
 * 三种输入分得清清楚楚：
 * - `undefined`（这个平台没有桥）→ 空结果，**不记失败**。缺席不是故障。
 * - 非法 JSON / 不是对象（桥在，但坏了）→ 空结果 + 记一条 {@link BRIDGE_FAILURE}。
 * - 合法 JSON → 逐字段类型守卫；**类型不对的字段跳过并记名**（桥声称给了却给了垃圾，
 *   那正是「本该有却没读到」）。Java 侧自己报的 `readFailures` 一并合入。
 *
 * 数字字段要求**有限且非负**：这些量（内存 / 核数 / 频率 / 分辨率 / dpi）没有负数含义，
 * 而 JNI 那头出错时最常见的就是 `-1`，放进来会让打分把故障当成一台极小内存的机器。
 */
export function parseBridgeProfile(json: string | undefined | null): ProfileParts {
  if (json === undefined || json === null || json === '') {
    return { fields: {}, readFailures: [] };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { fields: {}, readFailures: [BRIDGE_FAILURE] };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { fields: {}, readFailures: [BRIDGE_FAILURE] };
  }

  const p = raw as BridgePayload;
  const fields: Record<string, unknown> = {};
  const failures: string[] = [];

  // Java 侧自己知道哪几项它试过却失败了（`/sys` 节点不存在、`SOC_MODEL` 反射不到…）
  if (Array.isArray(p.readFailures)) {
    for (const f of p.readFailures) if (typeof f === 'string' && f !== '') failures.push(f);
  }

  const claim = (key: string, ok: boolean): void => {
    if (key in p && !ok && !failures.includes(key)) failures.push(key);
  };

  for (const key of NUMBER_FIELDS) {
    const v = p[key];
    const ok = typeof v === 'number' && Number.isFinite(v) && v >= 0;
    if (ok) fields[key] = v;
    else claim(key, false);
  }
  for (const key of STRING_FIELDS) {
    const v = p[key];
    const ok = typeof v === 'string' && v !== '';
    if (ok) fields[key] = v;
    else claim(key, false);
  }
  for (const key of BOOLEAN_FIELDS) {
    const v = p[key];
    if (typeof v === 'boolean') fields[key] = v;
    else claim(key, false);
  }

  const code = p.lastExitReasonCode;
  if (typeof code === 'number' && Number.isInteger(code)) {
    fields.lastExitReason = exitReasonName(code);
  } else {
    claim('lastExitReasonCode', false);
  }

  return { fields: fields as Partial<DeviceProfile>, readFailures: failures };
}

/**
 * 浏览器那边能问到的原始读数。**全声明成 `unknown`** —— 其中两项是非标准 / 条件可用的
 * API，浏览器给什么都有可能，类型守卫在下面统一做。
 */
export interface WebProfileInput {
  /** `navigator.deviceMemory`，单位 **GB**。⚠️ 见 {@link parseWebProfile} 的三条注意。 */
  readonly deviceMemoryGB?: unknown;
  /** `navigator.hardwareConcurrency`。 */
  readonly hardwareConcurrency?: unknown;
  /** `window.devicePixelRatio`。 */
  readonly devicePixelRatio?: unknown;
}

/**
 * 解析浏览器读数。web 上**只有这三项**，其余字段是这个平台真的没有（不记 `readFailures`）。
 *
 * ## 三条必须知道的
 *
 * 1. ⚠️ **`navigator.deviceMemory` 只在安全上下文（HTTPS）里有** —— 实测（2026-09-10,
 *    Chromium）`http://` 页面上 `isSecureContext === false`，它就是 `undefined`，而同一页
 *    `hardwareConcurrency` / `devicePixelRatio` 照给。**H5 挂在 http 上就永远没有内存这一项**，
 *    要它就得上 HTTPS。缺席**不记失败**：浏览器是按规矩不给，不是读坏了。
 * 2. ⚠️ **它被量化过且封顶 8** —— 规范只允许 0.25/0.5/1/2/4/8 这几档，一台 16GB 的机器也报 8。
 *    这里**原样换算、不去猜真实值**（猜错比缺失更糟），封顶的语义留给打分函数知情。
 * 3. ⚠️ **`densityDpi` 用 `dpr × 160` 而不是 × 96** —— 这个字段的语义是 Android 的
 *    `DisplayMetrics.densityDpi`，而 Android 的定义就是 `density = densityDpi / 160`，
 *    Chrome 在 Android 上的 `devicePixelRatio` 正是那个 `density`。用 CSS 的 96 dpi 换算会让
 *    同一台手机在原生与 H5 上差出 1.67 倍 —— 打分函数拿到的就成了**一把随平台变刻度的尺**，
 *    正是这个模块拆三个内存字段要避免的那件事。代价是桌面浏览器上算出来的不是显示器真实 DPI，
 *    但分档要的本来就是「相对 mdpi 有多密」。
 *
 * **`performance.memory.jsHeapSizeLimit` 刻意不用**：它虽然在 http 下也读得到（实测 ~2GB），
 * 但那是 V8 的 JS 堆上限，跟 `processMemoryLimitBytes`（Android 的 Java 堆上限，实测 192–256MB）
 * 差一个数量级。填进同一个字段，一条按 Android 写的门槛在 web 上就全判成高端机。
 */
export function parseWebProfile(input: WebProfileInput): ProfileParts {
  const fields: Record<string, unknown> = {};
  const readFailures: string[] = [];

  /** web 上的正数读数：0 / 负数 / NaN / 非数字一律不算。 */
  const positive = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined;

  // 标配能力：缺了 = 本该有却没有 → 记名。
  const cores = positive(input.hardwareConcurrency);
  if (cores !== undefined) fields.cpuCores = cores;
  else readFailures.push('cpuCores');

  const dpr = positive(input.devicePixelRatio);
  if (dpr !== undefined) fields.densityDpi = Math.round(dpr * 160);
  else readFailures.push('densityDpi');

  // 条件可用：**没给**不算失败（见上第 1 条），给了垃圾才算。
  if (input.deviceMemoryGB !== undefined) {
    const gb = positive(input.deviceMemoryGB);
    if (gb !== undefined) fields.deviceTotalMemoryBytes = gb * 1024 ** 3;
    else readFailures.push('deviceTotalMemoryBytes');
  }

  return { fields: fields as Partial<DeviceProfile>, readFailures };
}

/**
 * 把几路来源拼成一份画像。**后面的覆盖前面的**（引擎直接问到的比桥更权威 —— 桥那头是反射，
 * 引擎这头是本进程的真值），`readFailures` 则是并集去重。
 *
 * 这一步单独拎出来是因为它是**唯一**决定「谁盖谁」的地方，而那件事只用一句话就能测。
 */
export function mergeDeviceProfile(
  ...parts: readonly { fields?: Partial<DeviceProfile>; readFailures?: readonly string[] }[]
): DeviceProfile {
  const fields: Record<string, unknown> = {};
  const failures: string[] = [];
  for (const part of parts) {
    for (const [k, v] of Object.entries(part.fields ?? {})) {
      if (v !== undefined) fields[k] = v;
    }
    for (const f of part.readFailures ?? []) if (!failures.includes(f)) failures.push(f);
  }
  return { ...(fields as Partial<DeviceProfile>), readFailures: failures };
}

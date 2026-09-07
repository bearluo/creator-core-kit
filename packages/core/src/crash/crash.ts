/**
 * 崩溃上报的**纯逻辑半**：收敛（去重 + 种类上限）、规整（截首行）、载荷拼装。零 `cc`。
 *
 * engine 那半（`installCrashReporter`）只有装钩子和一次 JNI 调用，没有分支——
 * `native.reflection` 按 ADR-0002 禁止进 cc mock，所以逻辑必须全在这边才测得到。
 *
 * 设计与决策见 `packages/core/docs/modules/crash-reporting.md`。
 */

/** `globalThis.__errorHandler` 递过来的四段原始数据，未经处理。 */
export interface RawCrash {
  /** ⚠️ 引擎会把出错那行的源码连同等长空格附在后面，release 下单次可达约 100 KB。 */
  readonly location: string;
  readonly linenum: number;
  readonly message: string;
  readonly stack: string;
}

/** 收敛并规整之后、可以过河的形状。 */
export interface CrashEvent {
  /** 已截首行。 */
  readonly location: string;
  readonly linenum: number;
  readonly message: string;
  readonly stack: string;
  /** 指纹，供调试与单测断言；**不参与**上报载荷。 */
  readonly fingerprint: string;
}

export interface CrashFilter {
  /** 规整 + 判定。返回 `null` = 这条不报（重复，或已达种类上限）。 */
  accept(raw: RawCrash): CrashEvent | null;
}

/** Crashlytics 一次会话只保留**最近** 8 条非致命；Bugly 未查到上限，取小的那个不会错。 */
const DEFAULT_MAX_KINDS = 8;

function firstLine(s: string): string {
  const i = s.indexOf('\n');
  return (i < 0 ? s : s.slice(0, i)).trimEnd();
}

/**
 * 造一个收敛器。`opts.maxKinds` 是一次会话最多上报多少**种**不同指纹，默认 8。
 */
export function createCrashFilter(opts?: { maxKinds?: number }): CrashFilter {
  const maxKinds = opts?.maxKinds ?? DEFAULT_MAX_KINDS;
  // 状态在闭包里，不做模块级单例（硬规则二）。
  const seen = new Set<string>();
  return {
    accept(raw: RawCrash): CrashEvent | null {
      // 指纹 = message + stack 首帧。同一个错在不同调用路径下首帧相同 → 视作一种，
      // 这跟两家平台自己的聚合键（errorType + errorMsg + stack）方向一致。
      const fingerprint = `${raw.message}\n${firstLine(raw.stack)}`;
      if (seen.has(fingerprint) || seen.size >= maxKinds) return null;
      seen.add(fingerprint);
      return {
        location: firstLine(raw.location),
        linenum: raw.linenum,
        message: raw.message,
        stack: raw.stack,
        fingerprint,
      };
    },
  };
}

/** 一帧 JS 堆栈。Java 侧照着造 `StackTraceElement(fn, file, line)`。 */
export interface JsFrame {
  /** 函数名。匿名帧记 `<anonymous>`，因为 `StackTraceElement` 不吃 null。 */
  readonly fn: string;
  readonly file: string;
  readonly line: number;
}

/**
 * `    at Foo.bar (a/b.js:12:5)` 与 `    at a/b.js:3:1` 两种形状。
 *
 * ⚠️ 文件路径里**本来就可能有冒号**（`file:///D:/x/main.js`），所以文件那组要贪婪匹配，
 * 靠末尾「两段数字」定位行列 —— 非贪婪会在第一个冒号处切断，把盘符当成行号。
 */
const FRAME_RE = /^\s*at\s+(?:(.*?)\s+\()?(.+):(\d+):(\d+)\)?\s*$/;

/** 帧数上限。两家平台都没明说，但载荷不该无界（`Error.stackTraceLimit` 也设的 30）。 */
const DEFAULT_MAX_FRAMES = 30;

/**
 * 把 V8 的堆栈字符串拆成结构化帧。畸形行（`at [native code]`、空行）安静跳过。
 *
 * 它为 **Crashlytics** 而存在：Crashlytics 的 Android SDK **没有**「上报一段自定义堆栈文本」
 * 的 API（iOS 的 `ExceptionModel` 在 Android 上没有对应物），只能造一个 `Throwable` 再
 * `setStackTrace(...)`。Bugly 那边不需要——它的 `postException` 直接吃字符串。
 */
export function parseJsFrames(stack: string, max: number = DEFAULT_MAX_FRAMES): JsFrame[] {
  const out: JsFrame[] = [];
  for (const line of stack.split('\n')) {
    if (out.length >= max) break;
    const m = FRAME_RE.exec(line);
    if (m === null) continue; // 首行的消息、`at [native code]`、空行都落这儿
    out.push({ fn: m[1] || '<anonymous>', file: m[2], line: Number(m[3]) });
  }
  return out;
}

/**
 * 现取上下文。**它自己抛不算错**，退化成空表 —— 少一块上下文远好过整条崩溃报不出去
 * （真相源可能是登录态、bundle 表，崩溃发生时它们没就绪恰恰是常态）。
 *
 * 上报和初始化两处都要它，所以这个 try/catch 落在 core：engine 那半按 ADR-0002 薄到
 * 没有分支，一个 `catch` 都不该有。
 */
export function crashContext(getContext: () => Record<string, string>): Record<string, string> {
  try {
    return getContext() ?? {};
  } catch {
    return {};
  }
}

/**
 * 拼成过河的 JSON。各渠道的 `CckReport.report(String json)` 自己解、自己决定塞进哪家 API
 * ——两家 SDK 能力不对称（Bugly 的 `stack` 吃任意字符串，Crashlytics 只能造 `Throwable`）。
 *
 * @param getContext 上报**这一刻**现取的上下文。它自己抛不会打断上报，取不到就是空表——
 *                   少一块上下文远好过整条崩溃报不出去。
 */
export function crashPayload(
  event: CrashEvent,
  getContext: () => Record<string, string>,
): string {
  return JSON.stringify({
    location: event.location,
    linenum: event.linenum,
    message: event.message,
    // 两家 SDK 各取一个：Bugly 的 postException 直接吃 stack 字符串，
    // Crashlytics 只能靠 frames 造 StackTraceElement[]。
    stack: event.stack,
    frames: parseJsFrames(event.stack),
    ctx: crashContext(getContext),
  });
}

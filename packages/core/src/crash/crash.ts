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
  let ctx: Record<string, string> = {};
  try {
    ctx = getContext() ?? {};
  } catch {
    // 故意吞掉：上下文的真相源（登录态 / bundle 表）还没就绪是常态，不该连累上报。
  }
  return JSON.stringify({
    location: event.location,
    linenum: event.linenum,
    message: event.message,
    stack: event.stack,
    ctx,
  });
}

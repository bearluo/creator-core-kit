import { native, sys } from 'cc';
import { crashPayload, createCrashFilter } from '@cck/core';

/** Java 侧的固定入口。哪家 SDK 由 gradle flavor 决定（ADR-0022），JS 侧一行渠道分支都没有。 */
const REPORT_CLASS = 'com/cck/report/CckReport';
const REPORT_METHOD = 'report';
const REPORT_SIG = '(Ljava/lang/String;)V';

/** 默认 10 帧，在 Cocos 的事件派发链里经常还没走到业务代码就用完了。 */
const STACK_FRAMES = 30;

type ErrorHandler = (location: string, linenum: number, message: string, stack: string) => void;

/**
 * 装上 JS 未捕获异常的钩子，转发给原生上报。**Android 以外直接 no-op。**
 *
 * 出口是 `globalThis.__errorHandler` 而不是 `jsb.onError`——后者被引擎的
 * `platforms/native/engine/jsb-game.js:32` 占着那句 `console.error`，接管了就得记得补回去。
 * 用 `__errorHandler` 的额外好处：多给一个行号，且引擎自带 `_isErrorHandleWorking` 重入保护，
 * 上报代码自己抛不会递归炸。⚠️ 它在引擎源码里标着 `// For compatiblity`，升引擎时要重验。
 *
 * 本函数**没有分支逻辑可测**（`native.reflection` 是 JNI，按 ADR-0002 禁止进 cc mock）——
 * 判定、截断、载荷拼装全在 `@cck/core` 的 `createCrashFilter` / `crashPayload` 里，那边全测了。
 *
 * @param getContext 上报时**现取**的上下文（玩家 ID / 当前场景 / 产物指纹 …）。
 *                   它自己抛异常不会打断上报，取不到就是空表。
 */
export function installCrashReporter(getContext: () => Record<string, string>): void {
  // 只认 Android：`CckReport` 是个 Java 类，且 iOS 的 callStaticMethod 不吃签名那个参数。
  if (sys.os !== sys.OS.ANDROID) return;

  // V8 独有，非 V8 引擎上没有这个属性（engine 的 tsconfig 不含 node 类型，故显式收窄）。
  (Error as { stackTraceLimit?: number }).stackTraceLimit = STACK_FRAMES;
  const filter = createCrashFilter();
  const handler: ErrorHandler = (location, linenum, message, stack) => {
    const event = filter.accept({ location, linenum, message, stack });
    if (event === null) return; // 重复或已达上限——logcat 里那条 console.error 照打，一条不漏
    native.reflection.callStaticMethod(
      REPORT_CLASS,
      REPORT_METHOD,
      REPORT_SIG,
      crashPayload(event, getContext),
    );
  };
  (globalThis as { __errorHandler?: ErrorHandler }).__errorHandler = handler;
}

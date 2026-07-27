import { createConsoleLogger, type ILogger, type LogSink, type LogLevel } from '@cck/core';
import { log, warn, error, debug } from 'cc';

/**
 * ILogger 的 cc 实现 —— 理想「薄壳」：不重写 level/child/prefix 逻辑，只把 LogSink 换成
 * cc 版，复用 core 的 ConsoleLogger 全部机制。cc 无 `info`，故 info→cc.log。
 */
export const ccSink: LogSink = {
  debug: (...a) => debug(...a),
  info: (...a) => log(...a),
  warn: (...a) => warn(...a),
  error: (...a) => error(...a),
};

/** 造一个输出走 cc 的 ILogger（复用 core createConsoleLogger，仅替换 sink）。 */
export function createCcLogger(opts?: { level?: LogLevel; tag?: string }): ILogger {
  return createConsoleLogger({ level: opts?.level, tag: opts?.tag, sink: ccSink });
}

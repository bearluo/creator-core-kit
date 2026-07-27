import { createToken, getRootContainer, type Token } from '../di';

export enum LogLevel {
  Debug = 0,
  Info = 1,
  Warn = 2,
  Error = 3,
  Silent = 4,
}

/** 输出目标抽象（console-like）。默认 = globalThis.console；测试注入 fake 可断言。 */
export interface LogSink {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export interface ILogger {
  /** 当前级别（严格低于此级别的调用被丢弃）。 */
  readonly level: LogLevel;
  /** 运行时调级别；child 与 root 共享同一级别状态，一处生效。 */
  setLevel(level: LogLevel): void;
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  /** 派生带标签子 logger：输出前缀 [tag]（多级叠加 [a][b]），共享级别与 sink。 */
  child(tag: string): ILogger;
}

/** console 适配 sink：默认输出目标，零 cc。 */
const consoleSink: LogSink = {
  debug: (...a) => console.debug(...a),
  info: (...a) => console.info(...a),
  warn: (...a) => console.warn(...a),
  error: (...a) => console.error(...a),
};

/** 共享级别状态：root 与其所有 child 引用同一个，setLevel 一处生效。 */
interface LevelState {
  level: LogLevel;
}

class ConsoleLogger implements ILogger {
  private readonly _state: LevelState;
  private readonly _sink: LogSink;
  private readonly _prefix: string; // 叠加的 [tag] 前缀，'' 表示无

  constructor(state: LevelState, sink: LogSink, prefix: string) {
    this._state = state;
    this._sink = sink;
    this._prefix = prefix;
  }

  get level(): LogLevel {
    return this._state.level;
  }

  setLevel(level: LogLevel): void {
    this._state.level = level;
  }

  debug(...args: unknown[]): void {
    this._emit(LogLevel.Debug, args);
  }
  info(...args: unknown[]): void {
    this._emit(LogLevel.Info, args);
  }
  warn(...args: unknown[]): void {
    this._emit(LogLevel.Warn, args);
  }
  error(...args: unknown[]): void {
    this._emit(LogLevel.Error, args);
  }

  child(tag: string): ILogger {
    return new ConsoleLogger(this._state, this._sink, `${this._prefix}[${tag}]`);
  }

  private _emit(level: LogLevel, args: unknown[]): void {
    if (level < this._state.level) return;
    const out = this._prefix ? [this._prefix, ...args] : args;
    switch (level) {
      case LogLevel.Debug:
        this._sink.debug(...out);
        break;
      case LogLevel.Info:
        this._sink.info(...out);
        break;
      case LogLevel.Warn:
        this._sink.warn(...out);
        break;
      case LogLevel.Error:
        this._sink.error(...out);
        break;
    }
  }
}

/** 造 ConsoleLogger（零 cc）。level 默认 Info；sink 默认 globalThis.console。 */
export function createConsoleLogger(opts?: {
  level?: LogLevel;
  tag?: string;
  sink?: LogSink;
}): ILogger {
  const state: LevelState = { level: opts?.level ?? LogLevel.Info };
  const sink = opts?.sink ?? consoleSink;
  const prefix = opts?.tag ? `[${opts.tag}]` : '';
  return new ConsoleLogger(state, sink, prefix);
}

/** DI token：engine/项目可 register 覆盖默认实现（见 di-container）。 */
export const LOGGER: Token<ILogger> = createToken<ILogger>('cck.logger');

let _default: ILogger | undefined;
function defaultLogger(): ILogger {
  _default ??= createConsoleLogger();
  return _default;
}

/**
 * 便捷取用：优先 getRootContainer().tryResolve(LOGGER)；未注册则用进程级默认 ConsoleLogger
 * （不自动注册进容器）。传 tag → 返回其 child(tag)。engine register(LOGGER,…) 覆盖后自动切换。
 */
export function getLogger(tag?: string): ILogger {
  const base = getRootContainer().tryResolve(LOGGER) ?? defaultLogger();
  return tag ? base.child(tag) : base;
}

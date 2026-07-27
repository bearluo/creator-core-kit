import { describe, it, expect, vi, afterEach } from 'vitest';
import { LogLevel, createConsoleLogger, getLogger, LOGGER, type LogSink } from '../index';
import { getRootContainer } from '../../di';

function fakeSink(): LogSink & { calls: Record<string, unknown[][]> } {
  const calls: Record<string, unknown[][]> = { debug: [], info: [], warn: [], error: [] };
  return {
    calls,
    debug: (...a) => calls.debug.push(a),
    info: (...a) => calls.info.push(a),
    warn: (...a) => calls.warn.push(a),
    error: (...a) => calls.error.push(a),
  };
}

afterEach(() => {
  getRootContainer().unregister(LOGGER); // 清理，避免污染全局根
});

describe('ConsoleLogger 级别过滤', () => {
  it('1. level=Warn → debug/info 丢弃、warn/error 输出', () => {
    const sink = fakeSink();
    const log = createConsoleLogger({ level: LogLevel.Warn, sink });
    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');
    expect(sink.calls.debug).toHaveLength(0);
    expect(sink.calls.info).toHaveLength(0);
    expect(sink.calls.warn).toHaveLength(1);
    expect(sink.calls.error).toHaveLength(1);
  });

  it('2. setLevel 运行时改级别即时生效', () => {
    const sink = fakeSink();
    const log = createConsoleLogger({ level: LogLevel.Error, sink });
    log.info('a');
    expect(sink.calls.info).toHaveLength(0);
    log.setLevel(LogLevel.Debug);
    log.info('b');
    expect(sink.calls.info).toHaveLength(1);
  });

  it('3. Silent 全关', () => {
    const sink = fakeSink();
    const log = createConsoleLogger({ level: LogLevel.Silent, sink });
    log.debug('x');
    log.info('x');
    log.warn('x');
    log.error('x');
    const total =
      sink.calls.debug.length +
      sink.calls.info.length +
      sink.calls.warn.length +
      sink.calls.error.length;
    expect(total).toBe(0);
  });

  it('7. createConsoleLogger 默认 level=Info', () => {
    const sink = fakeSink();
    const log = createConsoleLogger({ sink });
    expect(log.level).toBe(LogLevel.Info);
    log.debug('d');
    expect(sink.calls.debug).toHaveLength(0);
    log.info('i');
    expect(sink.calls.info).toHaveLength(1);
  });
});

describe('child 标签', () => {
  it('4. child(tag) 前缀', () => {
    const sink = fakeSink();
    const log = createConsoleLogger({ level: LogLevel.Debug, sink });
    log.child('net').info('x');
    expect(sink.calls.info[0]).toEqual(['[net]', 'x']);
  });

  it('5. 多级 child 叠加前缀', () => {
    const sink = fakeSink();
    const log = createConsoleLogger({ level: LogLevel.Debug, sink });
    log.child('a').child('b').info('x');
    expect(sink.calls.info[0]).toEqual(['[a][b]', 'x']);
  });

  it('6. child 共享级别（root.setLevel 影响 child）', () => {
    const sink = fakeSink();
    const log = createConsoleLogger({ level: LogLevel.Debug, sink });
    const c = log.child('x');
    log.setLevel(LogLevel.Error);
    c.debug('d');
    expect(sink.calls.debug).toHaveLength(0);
    expect(c.level).toBe(LogLevel.Error);
  });
});

describe('LOGGER token + getLogger', () => {
  it('8. LOGGER token 可注册解析', () => {
    const fake = createConsoleLogger({ sink: fakeSink() });
    getRootContainer().register(LOGGER, { useValue: fake }, { allowOverride: true });
    expect(getRootContainer().resolve(LOGGER)).toBe(fake);
  });

  it('9. getLogger 未注册 → 返回可用默认（不抛，level=Info）', () => {
    getRootContainer().unregister(LOGGER);
    const spy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const log = getLogger();
    expect(() => log.info('hello')).not.toThrow();
    expect(log.level).toBe(LogLevel.Info);
    spy.mockRestore();
  });

  it('10. getLogger 在 register 后返回注入实现', () => {
    const sink = fakeSink();
    const injected = createConsoleLogger({ sink, level: LogLevel.Debug });
    getRootContainer().register(LOGGER, { useValue: injected }, { allowOverride: true });
    getLogger().info('via-di');
    expect(sink.calls.info[0]).toEqual(['via-di']);
  });

  it('11. getLogger(tag) → 带 tag 前缀', () => {
    const sink = fakeSink();
    const injected = createConsoleLogger({ sink, level: LogLevel.Debug });
    getRootContainer().register(LOGGER, { useValue: injected }, { allowOverride: true });
    getLogger('mod').info('x');
    expect(sink.calls.info[0]).toEqual(['[mod]', 'x']);
  });
});

describe('默认 sink', () => {
  it('12. 未注入 sink → 用 globalThis.console', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const log = createConsoleLogger({ level: LogLevel.Debug });
    log.info('to-console');
    expect(spy).toHaveBeenCalledWith('to-console');
    spy.mockRestore();
  });

  it('12b. 默认 sink 的 debug/warn/error → 对应 console 方法', () => {
    const dbg = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const log = createConsoleLogger({ level: LogLevel.Debug });
    log.debug('d');
    log.warn('w');
    log.error('e');
    expect(dbg).toHaveBeenCalledWith('d');
    expect(warn).toHaveBeenCalledWith('w');
    expect(err).toHaveBeenCalledWith('e');
    dbg.mockRestore();
    warn.mockRestore();
    err.mockRestore();
  });
});

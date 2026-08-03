import { afterEach, describe, expect, it, vi } from 'vitest';
import { boot, coreModule, KIT, type KitModule } from '../bootstrap';
import { getRootContainer } from '../../di';
import { EVENT_BUS, createEventBus, getEventBus } from '../../eventbus';
import { TIMER, createTimer, getTimer } from '../../timer';
import { LogLevel, type ILogger } from '../../logging';

/** 记录各模块钩子调用序的模块工厂。 */
function recorder(): { calls: string[]; mod: (name: string, deps?: string[]) => KitModule } {
  const calls: string[] = [];
  const mod = (name: string, deps?: string[]): KitModule => ({
    name,
    deps,
    install: () => void calls.push(`install:${name}`),
    start: () => void calls.push(`start:${name}`),
    stop: () => void calls.push(`stop:${name}`),
  });
  return { calls, mod };
}

/** 可断言的假 logger。 */
function fakeLogger(): ILogger & {
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
} {
  const l = {
    level: LogLevel.Debug,
    setLevel: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: () => l,
  };
  return l as unknown as ILogger & {
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };
}

describe('Bootstrap', () => {
  afterEach(async () => {
    const root = getRootContainer();
    if (root.hasLocal(KIT)) {
      await root.resolve(KIT).shutdown();
    }
    root.unregister(EVENT_BUS);
    root.unregister(TIMER);
    root.unregister(KIT);
  });

  it('1. 空 modules：boot 成功，started=true，KIT 可 resolve', async () => {
    const kit = await boot();
    expect(kit.started).toBe(true);
    expect(kit.modules).toEqual([]);
    expect(getRootContainer().resolve(KIT)).toBe(kit);
  });

  it('2. 全部 install 先于任一 start', async () => {
    const { calls, mod } = recorder();
    await boot({ modules: [mod('a'), mod('b')] });
    expect(calls).toEqual(['install:a', 'install:b', 'start:a', 'start:b']);
  });

  it('3. 无 deps 按数组序；无 hook 模块不报错', async () => {
    const { calls, mod } = recorder();
    const noHook: KitModule = { name: 'c' };
    const kit = await boot({ modules: [mod('a'), noHook, mod('b')] });
    expect(calls).toEqual(['install:a', 'install:b', 'start:a', 'start:b']);
    expect(kit.modules).toEqual(['a', 'c', 'b']);
  });

  it('4. coreModule：boot 后 getEventBus()/getTimer() 得到已注册实例', async () => {
    const kit = await boot({ modules: [coreModule()] });
    const bus = getEventBus();
    const timer = getTimer();
    expect(kit.container.resolve(EVENT_BUS)).toBe(bus);
    expect(kit.container.resolve(TIMER)).toBe(timer);
  });

  it('5. coreModule 尊重预注册：已有 EVENT_BUS/TIMER 不覆盖', async () => {
    const root = getRootContainer();
    const bus = createEventBus();
    const timer = createTimer();
    root.register(EVENT_BUS, { useValue: bus });
    root.register(TIMER, { useValue: timer });
    await boot({ modules: [coreModule()] });
    expect(root.resolve(EVENT_BUS)).toBe(bus);
    expect(root.resolve(TIMER)).toBe(timer);
  });

  it('6. 传入 timer/eventBus：resolve 到传入实例；外部 tick 驱动其 delay', async () => {
    const bus = createEventBus();
    const timer = createTimer();
    const kit = await boot({ modules: [coreModule({ eventBus: bus, timer })] });
    expect(kit.container.resolve(EVENT_BUS)).toBe(bus);
    expect(kit.container.resolve(TIMER)).toBe(timer);
    const cb = vi.fn();
    timer.delay(1, cb);
    timer.tick(1);
    expect(cb).toHaveBeenCalledOnce();
  });

  it('7. install 抛错 → reject 含模块名，未进 start', async () => {
    const started = vi.fn();
    const bad: KitModule = {
      name: 'boom',
      install: () => {
        throw new Error('x');
      },
    };
    const other: KitModule = { name: 'other', start: started };
    await expect(boot({ modules: [bad, other] })).rejects.toThrow(/boom/);
    expect(started).not.toHaveBeenCalled();
  });

  it('8. start 抛错 → reject 含模块名', async () => {
    const bad: KitModule = {
      name: 'starter',
      start: () => {
        throw new Error('y');
      },
    };
    await expect(boot({ modules: [bad] })).rejects.toThrow(/starter/);
  });

  it('9. 重复 boot 同 container → reject already booted', async () => {
    await boot({ modules: [coreModule()] });
    await expect(boot({ modules: [coreModule()] })).rejects.toThrow(/already booted/i);
  });

  it('10. shutdown 逆序 stop，started 转 false', async () => {
    const { calls, mod } = recorder();
    const kit = await boot({ modules: [mod('a'), mod('b'), mod('c')] });
    calls.length = 0;
    await kit.shutdown();
    expect(calls).toEqual(['stop:c', 'stop:b', 'stop:a']);
    expect(kit.started).toBe(false);
  });

  it('11. shutdown 幂等：二次调用 no-op 不抛', async () => {
    const { calls, mod } = recorder();
    const kit = await boot({ modules: [mod('a')] });
    await kit.shutdown();
    calls.length = 0;
    await expect(kit.shutdown()).resolves.toBeUndefined();
    expect(calls).toEqual([]);
  });

  it('12. shutdown 后 KIT 注销，可重新 boot', async () => {
    const root = getRootContainer();
    const kit1 = await boot({ modules: [coreModule()] });
    await kit1.shutdown();
    expect(root.hasLocal(KIT)).toBe(false);
    const kit2 = await boot({ modules: [coreModule()] });
    expect(kit2).not.toBe(kit1);
    expect(kit2.started).toBe(true);
  });

  it('13. stop 抛错 → best-effort：warn 且其余 stop 仍跑', async () => {
    const logger = fakeLogger();
    const okStop = vi.fn();
    const a: KitModule = { name: 'a', stop: okStop };
    const b: KitModule = {
      name: 'b',
      stop: () => {
        throw new Error('stopfail');
      },
    };
    const kit = await boot({ modules: [a, b], logger });
    await kit.shutdown();
    expect(okStop).toHaveBeenCalledOnce(); // 逆序 b→a，b 抛错不中断 a
    expect(logger.warn).toHaveBeenCalled();
  });

  it('14. 自定义 container：boot 子 scope 不污染根', async () => {
    const root = getRootContainer();
    const scope = root.createScope('boot-test');
    await boot({ container: scope, modules: [coreModule()] });
    expect(scope.hasLocal(EVENT_BUS)).toBe(true);
    expect(root.hasLocal(EVENT_BUS)).toBe(false);
    expect(root.hasLocal(KIT)).toBe(false);
    scope.dispose();
  });

  it('15. install 抛错经 logger.error 上报', async () => {
    const logger = fakeLogger();
    const bad: KitModule = {
      name: 'boom',
      install: () => {
        throw new Error('e');
      },
    };
    await expect(boot({ modules: [bad], logger })).rejects.toThrow(/boom/);
    expect(logger.error).toHaveBeenCalled();
  });

  it('16. deps 拓扑：乱序声明按依赖序 install', async () => {
    const { calls, mod } = recorder();
    const kit = await boot({ modules: [mod('game', ['core']), mod('core')] });
    expect(calls).toEqual(['install:core', 'install:game', 'start:core', 'start:game']);
    expect(kit.modules).toEqual(['core', 'game']);
  });

  it('17. 缺失依赖 → 抛错', async () => {
    await expect(boot({ modules: [{ name: 'game', deps: ['missing'] }] })).rejects.toThrow(
      /missing/,
    );
  });

  it('18. 依赖成环 → 抛错', async () => {
    const a: KitModule = { name: 'a', deps: ['b'] };
    const b: KitModule = { name: 'b', deps: ['a'] };
    await expect(boot({ modules: [a, b] })).rejects.toThrow(/cycle/i);
  });

  it('19. 模块重名 → 抛错', async () => {
    await expect(boot({ modules: [{ name: 'dup' }, { name: 'dup' }] })).rejects.toThrow(
      /duplicate/i,
    );
  });

  it('21. coreModule.stop 注销自己注册的 EVENT_BUS/TIMER → 重新 boot 拿到新实例', async () => {
    const root = getRootContainer();
    const kit1 = await boot({ modules: [coreModule()] });
    const bus1 = root.resolve(EVENT_BUS);
    const timer1 = root.resolve(TIMER);
    await kit1.shutdown();
    expect(root.hasLocal(EVENT_BUS)).toBe(false);
    expect(root.hasLocal(TIMER)).toBe(false);
    await boot({ modules: [coreModule()] });
    expect(root.resolve(EVENT_BUS)).not.toBe(bus1);
    expect(root.resolve(TIMER)).not.toBe(timer1);
  });

  // 少了这步，总线活过 shutdown → 上一轮的订阅还挂在上面，新一轮 emit 会双份触发。
  // 开发期 Game View 重播（JS 上下文不重载 → shutdown → reboot）每次都踩。
  it('22. 上一轮 kit 的订阅不会在重新 boot 后被触发', async () => {
    type E = { ping: number };
    const kit1 = await boot({ modules: [coreModule()] });
    const stale = vi.fn();
    getEventBus<E>().on('ping', stale);
    await kit1.shutdown();
    await boot({ modules: [coreModule()] });
    const fresh = vi.fn();
    getEventBus<E>().on('ping', fresh);
    getEventBus<E>().emit('ping', 1);
    expect(fresh).toHaveBeenCalledOnce();
    expect(stale).not.toHaveBeenCalled();
  });

  it('23. 只注销自己注册的：预注册的 EVENT_BUS/TIMER 在 shutdown 后保留', async () => {
    const root = getRootContainer();
    const bus = createEventBus();
    const timer = createTimer();
    root.register(EVENT_BUS, { useValue: bus });
    root.register(TIMER, { useValue: timer });
    const kit = await boot({ modules: [coreModule()] });
    await kit.shutdown();
    expect(root.resolve(EVENT_BUS)).toBe(bus);
    expect(root.resolve(TIMER)).toBe(timer);
  });

  it('20. 拓扑序：菱形依赖 deps 全在依赖者前', async () => {
    const { calls, mod } = recorder();
    await boot({
      modules: [mod('d', ['b', 'c']), mod('b', ['a']), mod('c', ['a']), mod('a')],
    });
    const order = calls
      .filter((s) => s.startsWith('install:'))
      .map((s) => s.slice('install:'.length));
    expect(order[0]).toBe('a');
    expect(order[order.length - 1]).toBe('d');
    expect(order.indexOf('b')).toBeGreaterThan(order.indexOf('a'));
    expect(order.indexOf('c')).toBeGreaterThan(order.indexOf('a'));
    expect(order.indexOf('d')).toBeGreaterThan(order.indexOf('b'));
    expect(order.indexOf('d')).toBeGreaterThan(order.indexOf('c'));
  });
});

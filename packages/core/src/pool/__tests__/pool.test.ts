import { describe, expect, it, vi } from 'vitest';
import { createPool, PoolExhaustedError, type Pool } from '../pool';
import { LogLevel, type ILogger } from '../../logging';

/** 可断言告警的 fake logger（避免 console 噪声，兼数 warn/error 次数）。 */
function fakeLogger(): { logger: ILogger; warns: unknown[][]; errors: unknown[][] } {
  const warns: unknown[][] = [];
  const errors: unknown[][] = [];
  const logger: ILogger = {
    level: LogLevel.Debug,
    setLevel: () => {},
    debug: () => {},
    info: () => {},
    warn: (...a: unknown[]) => void warns.push(a),
    error: (...a: unknown[]) => void errors.push(a),
    child: () => logger,
  };
  return { logger, warns, errors };
}

interface Box {
  id: number;
  dirty: boolean;
}

let seq = 0;
function makeBox(): Box {
  return { id: ++seq, dirty: false };
}

describe('ObjectPool', () => {
  it('1. acquire：空池新建实例，size/inUse 记账正确', () => {
    const pool = createPool<Box>({ factory: makeBox });
    const a = pool.acquire();
    expect(a).toBeTruthy();
    expect(pool.size).toBe(1);
    expect(pool.inUse).toBe(1);
    expect(pool.available).toBe(0);
  });

  it('2. release→acquire：LIFO 复用最近归还的实例，不新建', () => {
    const pool = createPool<Box>({ factory: makeBox });
    const a = pool.acquire();
    const b = pool.acquire();
    pool.release(a);
    pool.release(b);
    expect(pool.available).toBe(2);
    expect(pool.inUse).toBe(0);
    // LIFO：最后归还的 b 先被复用
    expect(pool.acquire()).toBe(b);
    expect(pool.acquire()).toBe(a);
    expect(pool.size).toBe(2); // 全程只创建过 2 个
  });

  it('3. release 调 reset、acquire 调 onAcquire', () => {
    const reset = vi.fn((o: Box) => void (o.dirty = false));
    const onAcquire = vi.fn();
    const pool = createPool<Box>({ factory: makeBox, reset, onAcquire });
    const a = pool.acquire();
    expect(onAcquire).toHaveBeenCalledTimes(1);
    a.dirty = true;
    pool.release(a);
    expect(reset).toHaveBeenCalledWith(a);
    expect(a.dirty).toBe(false);
    const a2 = pool.acquire();
    expect(a2).toBe(a);
    expect(onAcquire).toHaveBeenCalledTimes(2);
  });

  it('4. prewarm：注册即预建 N 个空闲实例', () => {
    const factory = vi.fn(makeBox);
    const pool = createPool<Box>({ factory, prewarm: 3 });
    expect(factory).toHaveBeenCalledTimes(3);
    expect(pool.available).toBe(3);
    expect(pool.size).toBe(3);
    expect(pool.inUse).toBe(0);
    pool.acquire(); // 复用，不再新建
    expect(factory).toHaveBeenCalledTimes(3);
  });

  it('5. prewarm 超过 max：收紧到 max 并告警', () => {
    const { logger, warns } = fakeLogger();
    const pool = createPool<Box>({ factory: makeBox, prewarm: 10, max: 4, logger });
    expect(pool.available).toBe(4);
    expect(warns.length).toBe(1);
  });

  it('6. max 上限：无空闲时 acquire 抛 PoolExhaustedError', () => {
    const pool = createPool<Box>({ factory: makeBox, max: 2 });
    const a = pool.acquire();
    pool.acquire();
    expect(() => pool.acquire()).toThrow(PoolExhaustedError);
    // 归还一个后又可借出
    pool.release(a);
    expect(() => pool.acquire()).not.toThrow();
  });

  it('7. 默认不限容量：可无限增长', () => {
    const pool: Pool<Box> = createPool<Box>({ factory: makeBox });
    for (let i = 0; i < 100; i++) pool.acquire();
    expect(pool.size).toBe(100);
    expect(pool.inUse).toBe(100);
  });

  it('8. release 外来对象：告警 no-op，不改记账', () => {
    const { logger, warns } = fakeLogger();
    const pool = createPool<Box>({ factory: makeBox, logger });
    pool.release({ id: -1, dirty: false });
    expect(warns.length).toBe(1);
    expect(pool.available).toBe(0);
    expect(pool.size).toBe(0);
  });

  it('9. 重复 release：第二次告警 no-op', () => {
    const { logger, warns } = fakeLogger();
    const pool = createPool<Box>({ factory: makeBox, logger });
    const a = pool.acquire();
    pool.release(a);
    pool.release(a);
    expect(warns.length).toBe(1);
    expect(pool.available).toBe(1);
  });

  it('10. clear：释放空闲（调 dispose）并清空，借出的不受影响', () => {
    const dispose = vi.fn();
    const pool = createPool<Box>({ factory: makeBox, prewarm: 2, dispose });
    const a = pool.acquire(); // available 1, inUse 1
    expect(pool.available).toBe(1);
    pool.clear();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(pool.available).toBe(0);
    expect(pool.inUse).toBe(1);
    expect(pool.size).toBe(1);
    // clear 不影响归还借出的实例
    pool.release(a);
    expect(pool.available).toBe(1);
  });

  it('11. clear 后仍可 acquire（重新新建）', () => {
    const pool = createPool<Box>({ factory: makeBox, prewarm: 1 });
    pool.clear();
    expect(pool.size).toBe(0);
    const a = pool.acquire();
    expect(a).toBeTruthy();
    expect(pool.size).toBe(1);
  });
});

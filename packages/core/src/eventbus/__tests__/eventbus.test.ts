import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEventBus, getEventBus, EVENT_BUS, type IEventBus } from '../eventbus';
import { getRootContainer } from '../../di';

/** 测试用局部事件表（无 index signature → keyof 精确、payload 精确）。 */
interface TestEvents {
  a: number;
  b: string;
  v: void;
  obj: { x: number };
}

describe('EventBus', () => {
  afterEach(() => {
    // 清理可能的全局注册，避免测试间串扰。
    getRootContainer().unregister(EVENT_BUS);
  });

  it('1. on + emit：handler 收到正确 payload；listenerCount 正确', () => {
    const bus = createEventBus<TestEvents>();
    const h = vi.fn();
    bus.on('a', h);
    expect(bus.listenerCount('a')).toBe(1);
    bus.emit('a', 42);
    expect(h).toHaveBeenCalledOnce();
    expect(h).toHaveBeenCalledWith(42);
  });

  it('2. 多订阅按 FIFO 顺序触发', () => {
    const bus = createEventBus<TestEvents>();
    const order: number[] = [];
    bus.on('a', () => order.push(1));
    bus.on('a', () => order.push(2));
    bus.on('a', () => order.push(3));
    bus.emit('a', 0);
    expect(order).toEqual([1, 2, 3]);
  });

  it('3. 幂等去重：同 (key,handler) 订阅两次 → 只触发一次', () => {
    const bus = createEventBus<TestEvents>();
    const h = vi.fn();
    bus.on('a', h);
    bus.on('a', h);
    expect(bus.listenerCount('a')).toBe(1);
    bus.emit('a', 1);
    expect(h).toHaveBeenCalledOnce();
  });

  it('4. off(key,handler) 后 emit 不再触发', () => {
    const bus = createEventBus<TestEvents>();
    const h = vi.fn();
    bus.on('a', h);
    bus.off('a', h);
    expect(bus.listenerCount('a')).toBe(0);
    bus.emit('a', 1);
    expect(h).not.toHaveBeenCalled();
  });

  it('5. disposer：调用后退订；重复调用幂等，不误伤后续同 handler 新订阅', () => {
    const bus = createEventBus<TestEvents>();
    const h = vi.fn();
    const d = bus.on('a', h);
    d();
    bus.emit('a', 1);
    expect(h).not.toHaveBeenCalled();
    // 重新订阅同 handler，旧 disposer 再调应为 no-op（不删新订阅）。
    bus.on('a', h);
    d();
    bus.emit('a', 2);
    expect(h).toHaveBeenCalledOnce();
    expect(h).toHaveBeenCalledWith(2);
  });

  it('6. once：触发一次后自动退订', () => {
    const bus = createEventBus<TestEvents>();
    const h = vi.fn();
    bus.once('a', h);
    bus.emit('a', 1);
    bus.emit('a', 2);
    expect(h).toHaveBeenCalledOnce();
    expect(h).toHaveBeenCalledWith(1);
    expect(bus.listenerCount('a')).toBe(0);
  });

  it('7. offAll(target)：退订该 target 全部订阅，其他 target 不受影响', () => {
    const bus = createEventBus<TestEvents>();
    const t1 = {};
    const t2 = {};
    const a1 = vi.fn();
    const a2 = vi.fn();
    const b1 = vi.fn();
    bus.on('a', a1, { target: t1 });
    bus.on('a', a2, { target: t2 });
    bus.on('b', b1, { target: t1 });
    bus.offAll(t1);
    bus.emit('a', 1);
    bus.emit('b', 'x');
    expect(a1).not.toHaveBeenCalled();
    expect(b1).not.toHaveBeenCalled();
    expect(a2).toHaveBeenCalledOnce();
  });

  it('8. target 绑定：handler 内 this === target', () => {
    const bus = createEventBus<TestEvents>();
    const obj = {
      got: 0,
      onA(p: number) {
        this.got = p;
      },
    };
    bus.on('a', obj.onA, { target: obj });
    bus.emit('a', 42);
    expect(obj.got).toBe(42);
  });

  it('9. 重入安全：handler 内 on 新订阅 → 本轮不触发，下轮触发', () => {
    const bus = createEventBus<TestEvents>();
    const calls: string[] = [];
    const late = () => calls.push('late');
    bus.on('a', () => {
      calls.push('first');
      bus.on('a', late);
    });
    bus.emit('a', 1);
    expect(calls).toEqual(['first']);
    bus.emit('a', 1);
    expect(calls).toEqual(['first', 'first', 'late']);
  });

  it('10. 重入安全：handler 内 off 其他订阅 → 本轮快照仍触发，下轮不触发', () => {
    const bus = createEventBus<TestEvents>();
    const calls: string[] = [];
    const h2 = () => calls.push('h2');
    bus.on('a', () => {
      calls.push('h1');
      bus.off('a', h2);
    });
    bus.on('a', h2);
    bus.emit('a', 1);
    expect(calls).toEqual(['h1', 'h2']);
    bus.emit('a', 1);
    expect(calls).toEqual(['h1', 'h2', 'h1']);
  });

  it('11. 错误隔离：前一个 handler 抛异常 → onError 被调用且后续 handler 仍触发', () => {
    const onError = vi.fn();
    const bus = createEventBus<TestEvents>({ onError });
    const ok = vi.fn();
    bus.on('a', () => {
      throw new Error('boom');
    });
    bus.on('a', ok);
    bus.emit('a', 1);
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0][1]).toBe('a');
    expect(ok).toHaveBeenCalledOnce();
  });

  it('12. void 事件免 payload：emit(key) 可省第二参', () => {
    const bus = createEventBus<TestEvents>();
    const h = vi.fn();
    bus.on('v', h);
    bus.emit('v');
    expect(h).toHaveBeenCalledOnce();
    expect(h).toHaveBeenCalledWith(undefined);
  });

  it('13. onAny：任意 emit 都收到 (key,payload)；disposer 可退订', () => {
    const bus = createEventBus<TestEvents>();
    const any = vi.fn();
    const d = bus.onAny(any);
    bus.emit('a', 1);
    bus.emit('b', 'x');
    expect(any).toHaveBeenCalledTimes(2);
    expect(any).toHaveBeenNthCalledWith(1, 'a', 1);
    expect(any).toHaveBeenNthCalledWith(2, 'b', 'x');
    d();
    bus.emit('a', 2);
    expect(any).toHaveBeenCalledTimes(2);
  });

  it('13b. onAny handler 抛异常同样被错误隔离，经 onError 上报', () => {
    const onError = vi.fn();
    const bus = createEventBus<TestEvents>({ onError });
    bus.onAny(() => {
      throw new Error('boom');
    });
    expect(() => bus.emit('a', 1)).not.toThrow();
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0][1]).toBe('a');
  });

  it('14. clear(key) 清单事件；clear() 清全部含 onAny', () => {
    const bus = createEventBus<TestEvents>();
    const a = vi.fn();
    const b = vi.fn();
    const any = vi.fn();
    bus.on('a', a);
    bus.on('b', b);
    bus.onAny(any);
    bus.clear('a');
    expect(bus.listenerCount('a')).toBe(0);
    expect(bus.listenerCount('b')).toBe(1);
    bus.emit('b', 'x');
    expect(any).toHaveBeenCalledOnce();
    bus.clear();
    bus.emit('b', 'y');
    expect(b).toHaveBeenCalledOnce();
    expect(any).toHaveBeenCalledOnce();
  });

  it('15. has / listenerCount 边界：无订阅返回 false/0', () => {
    const bus = createEventBus<TestEvents>();
    expect(bus.has('a')).toBe(false);
    expect(bus.listenerCount('a')).toBe(0);
    bus.on('a', () => {});
    expect(bus.has('a')).toBe(true);
    expect(bus.listenerCount('a')).toBe(1);
  });

  it('16. EVENT_BUS token：未注册→进程级默认；注册后→注入实现；注销后→回默认', () => {
    const root = getRootContainer();
    const before = getEventBus();
    expect(before).toBeDefined();
    const fake = createEventBus<TestEvents>();
    root.register(EVENT_BUS, { useValue: fake as IEventBus });
    expect(getEventBus()).toBe(fake);
    root.unregister(EVENT_BUS);
    expect(getEventBus()).toBe(before);
  });

  it('17. 默认 onError 未注入时经 getLogger("EventBus").error 上报（不抛）', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const bus = createEventBus<TestEvents>();
      bus.on('a', () => {
        throw new Error('boom');
      });
      expect(() => bus.emit('a', 1)).not.toThrow();
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('18. 防御边界：off 未订阅 key / onAny disposer 重复调 / disposer 在 clear 后调，均空操作不抛', () => {
    const bus = createEventBus<TestEvents>();
    expect(() => bus.off('a', () => {})).not.toThrow(); // off 从未订阅的 key
    const d1 = bus.onAny(() => {});
    d1();
    expect(() => d1()).not.toThrow(); // onAny disposer 重复调用
    const d2 = bus.on('a', () => {});
    bus.clear(); // 桶被清空
    expect(() => d2()).not.toThrow(); // disposer 在桶已删除后调用
  });
});

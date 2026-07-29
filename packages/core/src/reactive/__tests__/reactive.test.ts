import { describe, it, expect, vi } from 'vitest';
import { signal, computed, effect, untracked } from '../reactive';

describe('signal', () => {
  it('读初值 / 写后读回 / peek', () => {
    const s = signal(1);
    expect(s.value).toBe(1);
    s.value = 2;
    expect(s.value).toBe(2);
    expect(s.peek()).toBe(2);
  });

  it('写入 Object.is 相等值不触发 effect（幂等，双向回环防护）', () => {
    const s = signal(1);
    const spy = vi.fn();
    effect(() => spy(s.value));
    expect(spy).toHaveBeenCalledTimes(1);
    s.value = 1; // 相等 → 不通知
    expect(spy).toHaveBeenCalledTimes(1);
    s.value = 2; // 变了 → 通知
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe('effect', () => {
  it('建立时立即跑一次；依赖变重跑；无关 signal 变不重跑', () => {
    const a = signal(1);
    const b = signal(10);
    const spy = vi.fn();
    effect(() => spy(a.value)); // 只读 a
    expect(spy).toHaveBeenCalledTimes(1);
    a.value = 2;
    expect(spy).toHaveBeenCalledTimes(2);
    b.value = 20; // 无关
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('动态依赖：分支切换后旧依赖不再触发、新依赖开始触发', () => {
    const use = signal(true);
    const a = signal('a');
    const b = signal('b');
    const seen: string[] = [];
    effect(() => seen.push(use.value ? a.value : b.value));
    expect(seen).toEqual(['a']);
    b.value = 'b2'; // 当前读 a，b 无关
    expect(seen).toEqual(['a']);
    use.value = false; // 切到读 b
    expect(seen).toEqual(['a', 'b2']);
    a.value = 'a2'; // 现在 a 无关
    expect(seen).toEqual(['a', 'b2']);
    b.value = 'b3'; // b 现在相关
    expect(seen).toEqual(['a', 'b2', 'b3']);
  });

  it('清理函数：重跑前跑上次 cleanup；dispose 跑最后一次且此后不再重跑', () => {
    const s = signal(1);
    const cleanup = vi.fn();
    const body = vi.fn();
    const stop = effect(() => {
      body(s.value);
      return cleanup;
    });
    expect(body).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledTimes(0);
    s.value = 2; // 重跑前清一次
    expect(body).toHaveBeenCalledTimes(2);
    expect(cleanup).toHaveBeenCalledTimes(1);
    stop(); // dispose 跑最后一次
    expect(cleanup).toHaveBeenCalledTimes(2);
    s.value = 3; // 已 dispose，不再跑
    expect(body).toHaveBeenCalledTimes(2);
  });

  it('dispose 幂等：重复调不抛、不重复清理', () => {
    const cleanup = vi.fn();
    const stop = effect(() => cleanup);
    stop();
    stop(); // 再调
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});

describe('computed', () => {
  it('惰性：无人读不求值；读触发求值+缓存；依赖变才重算', () => {
    const s = signal(2);
    const getter = vi.fn(() => s.value * 10);
    const c = computed(getter);
    expect(getter).toHaveBeenCalledTimes(0); // 惰性
    expect(c.value).toBe(20);
    expect(getter).toHaveBeenCalledTimes(1);
    expect(c.value).toBe(20); // 缓存
    expect(getter).toHaveBeenCalledTimes(1);
    s.value = 3;
    expect(c.value).toBe(30); // 依赖变重算
    expect(getter).toHaveBeenCalledTimes(2);
  });

  it('computed 链：底层 signal 变 → 顶层 effect 重跑', () => {
    const base = signal(1);
    const doubled = computed(() => base.value * 2);
    const quad = computed(() => doubled.value * 2);
    const seen: number[] = [];
    effect(() => seen.push(quad.value));
    expect(seen).toEqual([4]);
    base.value = 5;
    expect(seen).toEqual([4, 20]);
  });

  it('菱形依赖：不崩、最终值正确（允许冗余重算，只断言收敛值）', () => {
    const a = signal(1);
    const b = computed(() => a.value + 1);
    const c = computed(() => a.value + 10);
    const d = computed(() => b.value + c.value);
    let last = 0;
    effect(() => {
      last = d.value;
    });
    expect(last).toBe(1 + 1 + (1 + 10)); // 13
    a.value = 2;
    expect(last).toBe(2 + 1 + (2 + 10)); // 16
  });
});

describe('untracked', () => {
  it('untracked 内读 signal 不建立依赖', () => {
    const a = signal(1);
    const b = signal(100);
    const spy = vi.fn();
    effect(() => spy(a.value + untracked(() => b.value)));
    expect(spy).toHaveBeenCalledTimes(1);
    b.value = 200; // 在 untracked 内读的，不触发
    expect(spy).toHaveBeenCalledTimes(1);
    a.value = 2; // 正常依赖
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

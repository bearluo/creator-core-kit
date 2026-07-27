import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTimer, getTimer, TIMER, type ITimer } from '../timer';
import { getRootContainer } from '../../di';

describe('Timer', () => {
  afterEach(() => {
    getRootContainer().unregister(TIMER);
  });

  it('1. delay：到期触发一次，之后不再触发', () => {
    const t = createTimer();
    const cb = vi.fn();
    t.delay(1, cb);
    t.tick(0.5);
    expect(cb).not.toHaveBeenCalled();
    t.tick(0.5);
    expect(cb).toHaveBeenCalledOnce();
    t.tick(1);
    expect(cb).toHaveBeenCalledOnce();
  });

  it('2. delay(0)：下次 tick 即触发一次', () => {
    const t = createTimer();
    const cb = vi.fn();
    t.delay(0, cb);
    t.tick(0.016);
    expect(cb).toHaveBeenCalledOnce();
  });

  it('3. interval：每 seconds 周期触发', () => {
    const t = createTimer();
    const cb = vi.fn();
    t.interval(1, cb);
    t.tick(1);
    expect(cb).toHaveBeenCalledOnce();
    t.tick(1);
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('4. interval：一帧大 dt 补触发多次', () => {
    const t = createTimer();
    const cb = vi.fn();
    t.interval(1, cb);
    t.tick(3);
    expect(cb).toHaveBeenCalledTimes(3);
  });

  it('5. interval(seconds<=0) 抛错', () => {
    const t = createTimer();
    expect(() => t.interval(0, () => {})).toThrow();
    expect(() => t.interval(-1, () => {})).toThrow();
  });

  it('6. onFrame：每次 tick 收到 effectiveDt', () => {
    const t = createTimer();
    const cb = vi.fn();
    t.onFrame(cb);
    t.tick(0.1);
    t.tick(0.2);
    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb).toHaveBeenNthCalledWith(1, 0.1);
    expect(cb).toHaveBeenNthCalledWith(2, 0.2);
  });

  it('7. now = Σ effectiveDt', () => {
    const t = createTimer();
    expect(t.now).toBe(0);
    t.tick(0.5);
    t.tick(0.25);
    expect(t.now).toBeCloseTo(0.75);
  });

  it('8. timeScale=2：now 加倍、delay 提前触发', () => {
    const t = createTimer();
    const cb = vi.fn();
    t.timeScale = 2;
    t.delay(2, cb);
    t.tick(1); // effectiveDt=2 → now=2 → delay(2) 触发
    expect(t.now).toBe(2);
    expect(cb).toHaveBeenCalledOnce();
  });

  it('9. paused / timeScale=0：冻结（now 不进、不触发）', () => {
    const t = createTimer();
    const cb = vi.fn();
    const frame = vi.fn();
    t.delay(1, cb);
    t.onFrame(frame);
    t.paused = true;
    expect(t.paused).toBe(true);
    t.tick(5);
    expect(t.now).toBe(0);
    expect(cb).not.toHaveBeenCalled();
    expect(frame).not.toHaveBeenCalled();
    t.paused = false;
    t.timeScale = 0;
    t.tick(5);
    expect(t.now).toBe(0);
    expect(cb).not.toHaveBeenCalled();
  });

  it('10. delay disposer：取消后不触发；重复调幂等，不误伤后续新任务', () => {
    const t = createTimer();
    const cb = vi.fn();
    const d = t.delay(1, cb);
    d();
    t.tick(1);
    expect(cb).not.toHaveBeenCalled();
    // 重新注册同 cb，旧 disposer 再调应为 no-op（不删新任务）。
    t.delay(1, cb);
    d();
    t.tick(1);
    expect(cb).toHaveBeenCalledOnce();
  });

  it('11. interval disposer：取消后不再周期触发', () => {
    const t = createTimer();
    const cb = vi.fn();
    const d = t.interval(1, cb);
    t.tick(1);
    expect(cb).toHaveBeenCalledOnce();
    d();
    t.tick(5);
    expect(cb).toHaveBeenCalledOnce();
  });

  it('12. onFrame disposer：取消后不再收帧', () => {
    const t = createTimer();
    const cb = vi.fn();
    const d = t.onFrame(cb);
    t.tick(0.1);
    d();
    expect(() => d()).not.toThrow(); // 重复调 disposer 幂等
    t.tick(0.1);
    expect(cb).toHaveBeenCalledOnce();
  });

  it('13. 重入安全：定时回调里 delay 新任务 → 本轮不触发，下轮触发', () => {
    const t = createTimer();
    const calls: string[] = [];
    const late = () => calls.push('late');
    t.delay(1, () => {
      calls.push('first');
      t.delay(1, late);
    });
    t.tick(1);
    expect(calls).toEqual(['first']);
    t.tick(1);
    expect(calls).toEqual(['first', 'late']);
  });

  it('14. 重入安全：定时回调里 cancel 另一任务 → 该任务本轮不触发', () => {
    const t = createTimer();
    const b = vi.fn();
    const holder: { cancel?: () => void } = {};
    t.delay(1, () => holder.cancel?.());
    holder.cancel = t.delay(1, b);
    t.tick(1);
    expect(b).not.toHaveBeenCalled();
  });

  it('15. 错误隔离：一个 cb 抛异常 → onError 调用且其余定时/onFrame 仍触发', () => {
    const onError = vi.fn();
    const t = createTimer({ onError });
    const ok = vi.fn();
    const frame = vi.fn();
    t.onFrame(() => {
      throw new Error('frame-boom');
    });
    t.onFrame(frame);
    t.delay(1, () => {
      throw new Error('task-boom');
    });
    t.delay(1, ok);
    t.tick(1);
    expect(onError).toHaveBeenCalledTimes(2);
    expect(frame).toHaveBeenCalledOnce();
    expect(ok).toHaveBeenCalledOnce();
  });

  it('16. clear：清空定时+帧回调，now 不变，之后 tick 无触发', () => {
    const t = createTimer();
    const cb = vi.fn();
    const frame = vi.fn();
    t.delay(1, cb);
    t.onFrame(frame);
    t.tick(0.5);
    const nowBefore = t.now;
    t.clear();
    t.tick(1);
    expect(t.now).toBe(nowBefore + 1); // now 仍随 tick 推进，只是无回调
    expect(cb).not.toHaveBeenCalled();
    expect(frame).toHaveBeenCalledOnce(); // clear 前那次 tick
  });

  it('17. TIMER token：未注册→默认；注册后→注入实现；注销后→回默认', () => {
    const root = getRootContainer();
    const before = getTimer();
    expect(before).toBeDefined();
    const fake = createTimer();
    root.register(TIMER, { useValue: fake as ITimer });
    expect(getTimer()).toBe(fake);
    root.unregister(TIMER);
    expect(getTimer()).toBe(before);
  });

  it('18. 默认 onError 经 getLogger("Timer").error 上报（不抛）', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const t = createTimer();
      t.delay(1, () => {
        throw new Error('boom');
      });
      expect(() => t.tick(1)).not.toThrow();
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('19. 边界：timeScale 非法夹到 0；tick(0)/tick(负) 冻结不推进', () => {
    const t = createTimer();
    t.timeScale = -1;
    expect(t.timeScale).toBe(0);
    t.tick(5);
    expect(t.now).toBe(0);
    t.timeScale = 1;
    t.tick(0);
    expect(t.now).toBe(0);
    t.tick(-2);
    expect(t.now).toBe(0);
  });

  it('20. 重入安全：onFrame 回调里 cancel 另一 onFrame → 本轮不触发', () => {
    const t = createTimer();
    const b = vi.fn();
    const holder: { cancel?: () => void } = {};
    t.onFrame(() => holder.cancel?.());
    holder.cancel = t.onFrame(b);
    t.tick(0.1);
    expect(b).not.toHaveBeenCalled();
  });

  it('21. delay 触发后调其 disposer：no-op 不抛', () => {
    const t = createTimer();
    const cb = vi.fn();
    const d = t.delay(1, cb);
    t.tick(1); // 触发 + compact 移除
    expect(cb).toHaveBeenCalledOnce();
    expect(() => d()).not.toThrow();
    t.tick(1);
    expect(cb).toHaveBeenCalledOnce();
  });
});

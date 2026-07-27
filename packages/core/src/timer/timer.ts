import { createToken, getRootContainer, type Token } from '../di';
import { getLogger } from '../logging';
import type { Disposer } from '../eventbus';

/** 消费面：业务代码拿到的定时器视图（看不到 tick，防误调驱动）。 */
export interface ITimer {
  /** 累计逻辑时间（秒）。受 timeScale/pause 影响：暂停时不增长。 */
  readonly now: number;
  /** 时间缩放（>=0，非法值夹到 0）。tick 时 effectiveDt = paused ? 0 : dt * timeScale。默认 1。 */
  timeScale: number;
  /** 暂停开关：true 时 effectiveDt=0，所有定时/onFrame 冻结（不推进、不触发）。默认 false。 */
  paused: boolean;

  /** seconds 后触发一次 cb；seconds<=0 视为下次 tick 触发。返回 disposer（调用即取消，幂等）。 */
  delay(seconds: number, cb: () => void): Disposer;
  /** 每 seconds 触发 cb（首触发在 seconds 后）。seconds<=0 抛错（防退化死循环）。返回 disposer。 */
  interval(seconds: number, cb: () => void): Disposer;
  /** 每次 tick 触发 cb，收 effectiveDt（秒）。返回 disposer。冻结帧（effectiveDt<=0）不触发。 */
  onFrame(cb: (dt: number) => void): Disposer;

  /** 清空全部定时任务 + 帧回调（不重置 now/timeScale/paused）。场景切换重置用。 */
  clear(): void;
}

/** 驱动面：只有游戏循环 driver（engine）/测试持有，负责推进时间。 */
export interface ITimerDriver {
  /** 推进时间：engine 每帧喂真实 dt（秒）；测试手动调。按 effectiveDt 推进 now、触发到期任务与 onFrame。 */
  tick(dt: number): void;
}

/** 内部定时任务：due = 触发的 _now 绝对阈值；interval=null 为一次性。 */
interface Task {
  due: number;
  interval: number | null;
  cb: () => void;
  alive: boolean;
}

/** 内部帧回调记录。 */
interface FrameCb {
  cb: (dt: number) => void;
  alive: boolean;
}

class TimerService implements ITimer, ITimerDriver {
  private _now = 0;
  private _timeScale = 1;
  private _paused = false;
  private readonly _tasks: Task[] = [];
  private readonly _frameCbs: FrameCb[] = [];
  private readonly _onError: (err: unknown) => void;

  constructor(onError: (err: unknown) => void) {
    this._onError = onError;
  }

  get now(): number {
    return this._now;
  }

  get timeScale(): number {
    return this._timeScale;
  }
  set timeScale(v: number) {
    this._timeScale = v >= 0 ? v : 0; // 非法（负 / NaN）夹到 0
  }

  get paused(): boolean {
    return this._paused;
  }
  set paused(v: boolean) {
    this._paused = v;
  }

  delay(seconds: number, cb: () => void): Disposer {
    const task: Task = { due: this._now + Math.max(0, seconds), interval: null, cb, alive: true };
    this._tasks.push(task);
    return this._taskDisposer(task);
  }

  interval(seconds: number, cb: () => void): Disposer {
    if (!(seconds > 0)) {
      throw new Error(`Timer.interval: seconds must be > 0 (got ${seconds})`);
    }
    const task: Task = { due: this._now + seconds, interval: seconds, cb, alive: true };
    this._tasks.push(task);
    return this._taskDisposer(task);
  }

  onFrame(cb: (dt: number) => void): Disposer {
    const fc: FrameCb = { cb, alive: true };
    this._frameCbs.push(fc);
    return this._frameDisposer(fc);
  }

  clear(): void {
    this._tasks.length = 0;
    this._frameCbs.length = 0;
  }

  tick(dt: number): void {
    const edt = this._paused ? 0 : dt * this._timeScale;
    if (!(edt > 0)) return; // 冻结帧 / NaN / 负 dt：不推进、不触发
    this._now += edt;

    // onFrame：快照后逐个派发（重入安全 + 错误隔离）。
    if (this._frameCbs.length > 0) {
      for (const fc of this._frameCbs.slice()) {
        if (!fc.alive) continue; // 本轮内被取消
        try {
          fc.cb(edt);
        } catch (e) {
          this._onError(e);
        }
      }
    }

    // 定时任务：快照后按到期触发（一帧内可补触发多次，追平大 dt）。
    if (this._tasks.length > 0) {
      for (const task of this._tasks.slice()) {
        while (task.alive && task.due <= this._now) {
          try {
            task.cb();
          } catch (e) {
            this._onError(e);
          }
          if (task.interval != null) task.due += task.interval;
          else task.alive = false;
        }
      }
      this._compactTasks();
    }
  }

  private _compactTasks(): void {
    for (let i = this._tasks.length - 1; i >= 0; i--) {
      if (!this._tasks[i].alive) this._tasks.splice(i, 1);
    }
  }

  private _taskDisposer(task: Task): Disposer {
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      task.alive = false;
      const i = this._tasks.indexOf(task);
      if (i >= 0) this._tasks.splice(i, 1);
    };
  }

  private _frameDisposer(fc: FrameCb): Disposer {
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      fc.alive = false;
      const i = this._frameCbs.indexOf(fc);
      if (i >= 0) this._frameCbs.splice(i, 1);
    };
  }
}

/** 造定时器（同时实现消费面 + 驱动面）。onError 默认经 getLogger('Timer').error 上报（错误隔离）。 */
export function createTimer(opts?: { onError?: (err: unknown) => void }): ITimer & ITimerDriver {
  const onError =
    opts?.onError ?? ((err: unknown) => getLogger('Timer').error('timer callback error:', err));
  return new TimerService(onError);
}

/** DI token：注入的是消费面 ITimer（engine Bootstrap register 一个 TimerService）。 */
export const TIMER: Token<ITimer> = createToken<ITimer>('cck.timer');

let _default: (ITimer & ITimerDriver) | undefined;
function defaultTimer(): ITimer & ITimerDriver {
  _default ??= createTimer();
  return _default;
}

/**
 * 便捷取用：优先 getRootContainer().tryResolve(TIMER)；未注册则用进程级默认 TimerService。
 * ⚠ 与 Logger/EventBus 不同：ITimer **必须有人 tick 才走时**——engine Bootstrap 须 register(TIMER,…)
 * 并把 cc.director 的 dt 接到该实例的 tick()。默认 fallback 实例无人驱动则定时永不触发。
 */
export function getTimer(): ITimer {
  return getRootContainer().tryResolve(TIMER) ?? defaultTimer();
}

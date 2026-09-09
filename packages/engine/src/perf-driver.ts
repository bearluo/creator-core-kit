import { director, game, Director } from 'cc';
import type { Disposer, PerfWindow } from '@cck/core';

/**
 * 把 `PerfWindow` 接到 cc 的帧循环：订阅 `EVENT_AFTER_UPDATE`（引擎与组件 update 之后），
 * 每帧把**真实 dt** 换算成毫秒喂给 `frame()`。返回解绑 Disposer。
 *
 * 形状与 `driveWithDirector` 逐字同构。**四行代码，但必须由 kit 出** —— 它堵的两个坑都是
 * 静默的，各自会让整份性能数据失真而不报任何错：
 *
 * 1. **不能挂 `ITimer.onFrame`。** 那里拿到的是 `dt * timeScale`（被慢动作 / 加速缩过），
 *    而且 `paused` 时**根本不触发** —— 游戏一暂停性能数据就断，可暂停很可能正是卡出来的。
 *    真实 dt 只在 `game.deltaTime` 上，也就是 `bootstrap.ts:26` 喂给 `driver.tick` 的那个值。
 * 2. **`game.deltaTime` 是秒，`frame(dtMs)` 要毫秒。** 差 1000 倍，而两边都是「一个正数」，
 *    类型系统一个字都不会说；直方图会整体挤进 0 号桶，分位数恒为 0，看起来还挺正常。
 *
 * `drain()` 的节拍**不在这里**，也不能用 `ITimer.interval`（同样暂停时不触发）——
 * 它归项目，「攒够 30 秒」是策略（见 `docs/design/device-tiering-overview.md` §4.3）。
 */
export function drivePerfWindow(perf: Pick<PerfWindow, 'frame'>): Disposer {
  const onFrame = (): void => {
    perf.frame(game.deltaTime * 1000);
  };
  director.on(Director.EVENT_AFTER_UPDATE, onFrame);
  return () => {
    director.off(Director.EVENT_AFTER_UPDATE, onFrame);
  };
}

import { signal, computed } from '@cck/core';
import type { ReadSignal, Signal } from '@cck/core';

/**
 * 样例 ViewModel —— 纯 TS，零 `cc` 依赖，演示 kit 铁律「逻辑可脱离引擎」。
 *
 * 这一层只有状态与行为，不碰任何引擎 API，因此可直接在 node/vitest 里单测（不用开 Creator）。
 * 真实项目请把这类业务逻辑放 `packages/core`（或你自己的纯 TS 包）；引擎侧只做渲染与事件转发。
 *
 * 用到的响应式原语来自 `@cck/core`：
 *  - `signal(v)`   可写状态，读 `.value` 建立依赖，写 `.value` 通知订阅者；
 *  - `computed(fn)` 派生状态，依赖变时自动重算（惰性 + 缓存）。
 */
export class CounterVM {
  /** 可写状态：点一下 +1。 */
  readonly count: Signal<number> = signal(0);

  /** 派生状态：给 UI 看的文本。`count` 一变，`display.value` 自动是新值。 */
  readonly display: ReadSignal<string> = computed(() => `点击次数：${this.count.value}`);

  increment(): void {
    this.count.value += 1;
  }

  reset(): void {
    this.count.value = 0;
  }
}

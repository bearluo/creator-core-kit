import { signal, computed } from '@cck/core';
import type { ReadSignal, Signal } from '@cck/core';

/**
 * 纯逻辑 ViewModel —— 零 `cc` 依赖，演示铁律「逻辑可脱离引擎」，可直接 node/vitest 单测。
 * （原 GameBoot 接入样例的计数逻辑退役后并入 mini-clicker 模块，随其 bundle 走。）
 *  - `signal(v)`   可写状态，读 `.value` 建依赖、写 `.value` 通知；
 *  - `computed(fn)` 派生状态，依赖变自动重算（惰性 + 缓存）。
 */
export class CounterVM {
  /** 可写状态：点一下 +1。 */
  readonly count: Signal<number> = signal(0);

  /** 派生状态：给 UI 看的文本。`count` 一变 `display.value` 自动是新值。 */
  readonly display: ReadSignal<string> = computed(() => `点击次数：${this.count.value}`);

  increment(): void {
    this.count.value += 1;
  }

  reset(): void {
    this.count.value = 0;
  }

  /**
   * 从 `saveState()` 吐出的值恢复（转屏 / 换皮重建走这里）。
   * 判类型、给默认值都在 VM——View 不做业务判断，这样这条分支才测得到。
   */
  restore(state: unknown): void {
    this.count.value = typeof state === 'number' && Number.isFinite(state) ? state : 0;
  }
}

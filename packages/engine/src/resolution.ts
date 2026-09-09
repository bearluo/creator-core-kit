import { ResolutionPolicy, screen, sys, view } from 'cc';
import { getLogger, setUIVariant } from '@cck/core';
import type { KitModule } from '@cck/core';
import {
  computeSafeAreaInsets,
  pickDesignResolution,
  type DesignResolution,
  type Orientation,
  type SafeAreaInsets,
} from './render-policy';

/**
 * 多分辨率 / 横竖屏适配 —— **锁短边**：短边恒 `shortSide` 设计单位永不裁切，长边随屏幕比例延展。
 *
 * 为什么需要它：引擎在旋转时**不会**交换设计分辨率。`view.ts::_updateAdaptResult()` 收到
 * `screen` 的 `window-resize` 后，只是拿**原样**的 design resolution + **原** policy 重算一遍
 * （`setDesignResolutionSize(w, h, this._resolutionPolicy)`）。所以若固定 1080×1920 + `FIXED_WIDTH`，
 * 转到横屏后仍锁宽 1080 → 可视高度缩到 ~600 设计单位，UI 全挤没。
 *
 * 本模块补上这一步：方向变了就按锁短边规则重设 design resolution + policy。
 * 相机侧不用管——camera-rig 已监听 `design-resolution-changed`，会自动重算 `orthoHeight`。
 *
 * ⚠️ 它只负责「方向变了就正确适配」，**不负责强制旋转屏幕**：`view.setOrientation()` 按引擎注释
 * 「不会对 native 部分产生任何影响，对于 native 而言，你需要在应用设置中的设置排版」——
 * 强制方向是平台/工程配置问题（原生工程设置 / 小游戏 orientation 配置），不是 kit 的职责。
 *
 * ⚠️ 两个方向的设计分辨率不同（1080×1920 vs 1920×1080），所以 UI **必须用 Widget 锚定做响应式布局**，
 * 不能硬编码坐标——否则转屏后错位。
 */

export interface ResolutionOptions {
  /** 短边设计尺寸（竖屏=宽 / 横屏=高），恒不裁切。默认 1080。 */
  readonly shortSide?: number;
  /** 长边设计尺寸（竖屏=高 / 横屏=宽）。默认 1920。 */
  readonly longSide?: number;
  /** 方向变化回调（业务想按方向换布局/换场景时用）。 */
  readonly onOrientationChange?: (orientation: Orientation) => void;
}

const policyOf = (r: DesignResolution): number =>
  r.lockAxis === 'width' ? ResolutionPolicy.FIXED_WIDTH : ResolutionPolicy.FIXED_HEIGHT;

/**
 * KitModule：按当前横竖屏「锁短边」自动切换设计分辨率与 `ResolutionPolicy`。
 * 锁单一方向的项目不用装这个模块（Project Settings 里配死即可）。
 */
export function resolutionModule(opts?: ResolutionOptions): KitModule {
  let applied: Orientation | undefined;
  // 防重入：apply 内部调 setDesignResolutionSize 会 emit 'design-resolution-changed'，
  // 而我们也监听 'canvas-resize'（它在 _updateAdaptResult 里紧随其后 emit）。
  let applying = false;

  const apply = (): void => {
    if (applying) return;
    const { width, height } = screen.windowSize;
    const r = pickDesignResolution(width, height, opts?.shortSide, opts?.longSide);
    if (r.orientation === applied) return; // 同方向内的尺寸变化交给引擎按现有 policy 重算
    applying = true;
    try {
      view.setDesignResolutionSize(r.width, r.height, policyOf(r));
    } finally {
      applying = false;
    }
    applied = r.orientation;
    // 灌进 UI 变体：登记了 orientation resolver 的界面会按需重建换 view，其余零成本（解析结果没变）。
    // 不 await——apply 由 resize/orientation 事件同步调用，重建是异步的，让它自己跑完。
    void setUIVariant({ orientation: r.orientation }).catch((e: unknown) =>
      getLogger('resolution').warn('按方向重建界面失败', e),
    );
    opts?.onOrientationChange?.(r.orientation);
  };

  return {
    name: 'resolution',
    start() {
      apply();
      // 'orientation-change' 引擎自己没订（view.init 只订了 window-resize / fullscreen-change），
      // 两个都听，取先到者；apply 内按方向去重，重复触发无副作用。
      screen.on('orientation-change', apply);
      view.on('canvas-resize', apply);
    },
    stop() {
      screen.off('orientation-change', apply);
      view.off('canvas-resize', apply);
      applied = undefined;
    },
  };
}

/**
 * 当前安全区的四边内缩量（设计单位）。**按安全区排 UI 不要调它** —— 那是引擎内置
 * `cc.SafeArea` 组件的活（挂在界面根上，靠 `Widget` 自己跟着转屏走，见 camera-rig.md「安全区」）。
 * 这个函数补的是组件给不了的**数**：按刘海高度换紧凑布局、把内缩量随崩溃一起上报、
 * 真机上打一行日志确认到底缩了多少。
 *
 * 取不到安全区的平台（桌面 / 编辑器预览 / 未开 `viewport-fit=cover` 的 H5）返回全 0，
 * 不抛错 —— 引擎的 `getSafeAreaRect` 在非异形屏上本就返回整个可视区。
 *
 * 用 `symmetric = true`（引擎默认，`cc.SafeArea` 也用它）：两侧取较大者对齐，
 * 免得刘海只在一边时 UI 整体偏心。
 */
export function getSafeAreaInsets(): SafeAreaInsets {
  const visible = view.getVisibleSize();
  const rect = sys.getSafeAreaRect();
  return computeSafeAreaInsets(visible.width, visible.height, rect);
}

/**
 * 「同一条鱼在屏幕上长什么样」的**唯一一份规则** —— 零 `cc`，游戏 View 与鱼阵编辑器共用。
 *
 * 为什么要单独一个模块：这几条规则原本各写在各的 View 里，于是漂了。实测过的三处：
 *
 * | | 游戏 | 编辑器（旧） |
 * |---|---|---|
 * | 鱼的尺寸 | 美术原尺寸（`SizeMode.TRIMMED`） | 按判定半径算的框（`r × 2.4` / `r × 2`） |
 * | 帧动画 | `_run_${step % frames}`，12fps | 永远停在 `_run_0` |
 * | 场地缩放 | cover（`Math.max`） | contain 还留白（`FIELD × 1.3`） |
 *
 * 三条全不一样，而编辑器存在的理由正是「在这儿看到的就是游戏里的」。规则收成一份、两边都
 * 从这儿取，就不必靠人记得同步 —— 漂了也不会有任何报错，只会让策划照着一个假画面摆鱼。
 *
 * **鱼画多大不在这儿**，因为没什么可算的：**一律按图集里那帧自己的尺寸画**（Cocos 侧
 * `SizeMode.TRIMMED`，DOM 侧读 `textures.plist` 的 frame 矩形）。这条规则的执行方式是
 * 「两边都不许自己发明尺寸」，不是一个函数。
 *
 * **不在这儿的**：子弹 / 网 / 炮台 / 水面后处理 / 海底 —— 编辑器不预览它们，没有第二份实现。
 */
import { FIELD } from './content/paths';
import type { FishKind } from './content/fish-kinds';

/** 序列帧速度。游动与死亡共用，全表一致。 */
export const ART_FPS = 12;

/**
 * 此刻该显示哪一帧。`elapsed` 是这条鱼所在世界的累计秒数 —— 两边都从 0 起按 `dt` 累加，
 * 不读挂钟，所以暂停 / 单步 / 拖进度条都不会让动画跳。
 */
export function fishFrame(kind: FishKind, elapsed: number): string {
  return `${kind.id}_run_${Math.floor(elapsed * ART_FPS) % kind.frames}`;
}

/**
 * 朝向。**图集里的鱼头一律朝 +x**（实测），所以直接转到路径切线方向；转过 90° 之后
 * **上下翻**而不是继续转，否则鱼会肚皮朝天。死亡帧也走这一套，不然鱼一断气就「唰」地
 * 摆正头朝右。
 */
export function fishFacing(angle: number): { readonly deg: number; readonly flipY: boolean } {
  return { deg: (angle * 180) / Math.PI, flipY: Math.abs(angle) > Math.PI / 2 };
}

/**
 * 场地缩放：**cover**（取较大者）。16:9 恰好铺满，更宽 / 更高的屏幕各裁掉一点 ——
 * 捕鱼是满屏背景的玩法，留黑边比裁掉一点边难看得多。
 *
 * ⚠️ 代价是 `FIELD` 的边缘**不保证看得见**：摆在边上的鱼在别的比例的屏幕上可能进不了画面。
 * 要知道到底裁掉多少，用 {@link visibleField}。
 */
export function fieldScale(viewWidth: number, viewHeight: number): number {
  return Math.max(viewWidth / FIELD.width, viewHeight / FIELD.height);
}

/**
 * cover 之后 `FIELD` 里**真正看得见**的那块（场地坐标，中心为原点，返回全宽全高）。
 * 落在这块外面的鱼，在这个比例的屏幕上进不了画面。
 */
export function visibleField(
  viewWidth: number,
  viewHeight: number,
): { readonly width: number; readonly height: number } {
  const s = fieldScale(viewWidth, viewHeight);
  return {
    width: Math.min(FIELD.width, viewWidth / s),
    height: Math.min(FIELD.height, viewHeight / s),
  };
}

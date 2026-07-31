/**
 * 相机组 / 分辨率适配的**纯决策逻辑** —— 本文件 **零 `cc` import**，故可在 node 里直接单测
 * （cc 的真节点/相机/Widget 行为按 ADR-0002 决策 3 不进 mock，走 apps/demo 预览验证）。
 *
 * 设计见 packages/engine/docs/modules/camera-rig.md；
 * 「为什么不用 Canvas」的源码依据见 docs/research/2026-07-30-cc-canvas-vs-renderroot2d.md。
 */

import type { Orientation } from '@cck/core';

/**
 * 相机 priority 阶梯：**值越小越先渲染 → 越大越叠在上层**（cc `Camera.priority` 语义，
 * 见 3.8.7 声明「值越小越优先渲染」）。
 *
 * `1..99` 是**预留区**，供场景自带的 3D 世界 / 特效相机使用——落在这区间即自动
 * 盖在 2D 背景之上、UI 之下。它们必须用 `DEPTH_ONLY`，否则会清掉背景相机的输出
 * （「故意不要背景」是正当需求，但要走 `claimClear`，见 createClearOwnership）。
 */
export const CAMERA_PRIORITY = {
  bg: 0,
  uiBack: 100,
  ui: 200,
  uiFront: 300,
} as const;

/** 相机组的层级标识。`ui` 用内置 `UI_2D` 层，其余见 {@link CCK_LAYERS}。 */
export type CameraRigLayer = keyof typeof CAMERA_PRIORITY;

/**
 * kit 需要的**自定义层**。必须先在 Project Settings → Layers 里以指定 bit 注册；
 * 引擎只允许用户编辑 **bit 0–19**（其余保留），见 cc `Layers.addLayer` 注释。
 * 主 UI 层用内置 `UI_2D`，3D 世界用内置 `DEFAULT`，故不在此列。
 */
export const CCK_LAYERS = {
  bg: { name: 'BG', bit: 0 },
  uiBack: { name: 'UI_BACK', bit: 1 },
  uiFront: { name: 'UI_FRONT', bit: 2 },
} as const;

/** 屏幕方向。定义在 core（它同时是 UI 变体的一个维度，见 `UIVariant`），此处转出供本包内使用。 */
export type { Orientation };

export interface DesignResolution {
  readonly orientation: Orientation;
  readonly width: number;
  readonly height: number;
  /** 锁哪条轴。shell 映射：`width → ResolutionPolicy.FIXED_WIDTH`、`height → FIXED_HEIGHT`。 */
  readonly lockAxis: 'width' | 'height';
}

/**
 * 按当前窗口宽高选设计分辨率与锁定轴 —— **锁短边**策略。
 *
 * 竖屏锁宽、横屏锁高，即**短边恒为 `shortSide` 设计单位、永不裁切**，长边随实际
 * 屏幕比例延展（多出来的空间由 Widget 锚定填充）。这就是「竖屏大厅旋转成横屏游戏」
 * 时必须做的事：引擎自己**不会**交换设计分辨率——`view.ts::_updateAdaptResult` 旋转后
 * 只是拿原样 design resolution + 原 policy 重算一遍，所以固定 `FIXED_WIDTH` 会让横屏下
 * 可视高度缩到 ~600 设计单位。
 *
 * @param windowWidth  当前窗口宽（`screen.windowSize.width`）
 * @param windowHeight 当前窗口高
 * @param shortSide    短边设计尺寸，默认 1080
 * @param longSide     长边设计尺寸，默认 1920
 */
export function pickDesignResolution(
  windowWidth: number,
  windowHeight: number,
  shortSide = 1080,
  longSide = 1920,
): DesignResolution {
  // 传反了也归一化，省掉一类静默配置错
  const short = Math.min(shortSide, longSide);
  const long = Math.max(shortSide, longSide);
  // 非法尺寸（0 / NaN，headless 或窗口最小化）退化为竖屏，不抛错
  const landscape = windowWidth > windowHeight;
  return landscape
    ? { orientation: 'landscape', width: long, height: short, lockAxis: 'height' }
    : { orientation: 'portrait', width: short, height: long, lockAxis: 'width' };
}

export interface OrthoHeightInput {
  /** `screen.windowSize.height`（真实像素）。 */
  readonly windowHeight: number;
  /** `view.getScaleY()`。 */
  readonly scaleY: number;
  /** 该相机是否渲到纹理（`camera.targetTexture` 非空）。 */
  readonly hasTargetTexture: boolean;
  /** `visibleRect.height`（设计单位）。 */
  readonly visibleRectHeight: number;
}

/**
 * 全屏正交 UI 相机的 `orthoHeight`。**照抄** `cocos/2d/framework/canvas.ts::_onResizeCamera()`，
 * 含 `targetTexture` 分支（渲到纹理时公式不同，不可省）。
 */
export function computeOrthoHeight(i: OrthoHeightInput): number {
  if (i.hasTargetTexture) return i.visibleRectHeight / 2;
  // ponytail: Canvas 源码无此 guard；这里挡住 scaleY 为 0/NaN 时把 Infinity/NaN 灌进渲染管线
  // （headless / 窗口最小化会出现），回退到设计单位口径。
  if (!(i.scaleY > 0)) return i.visibleRectHeight / 2;
  return i.windowHeight / i.scaleY / 2;
}

/**
 * 全屏正交 UI 相机的**世界 XY 位置**。不是 (0,0)——**UI 坐标系原点在可视区左下角**：
 *
 * - `view.ts::_updateAdaptResult()` 硬置 `vb.x = 0; vb.y = 0`，即 `visibleRect` 恒为 `[0,w] × [0,h]`；
 * - `widget-manager.ts::align()` 的 `isRoot` 分支拿 `visibleRect.left.x / right.x` 当边界，
 *   所以拉满屏的层级 root 落在 `[0,w] × [0,h]`、锚点 0.5 → 节点位置 `(w/2, h/2)`；
 * - 编辑器默认的 Canvas 也正是放在 `(w/2, h/2)`，其相机作为子节点跟着偏移。
 *
 * 相机若留在世界 (0,0)，视野是 `[-w/2,w/2] × [-h/2,h/2]`，与 UI 内容整整错开半屏
 * （表现为界面挤到右上角、大半不可见）。所以相机必须落在可视矩形中心。
 */
export function computeCameraCenter(
  visibleWidth: number,
  visibleHeight: number,
): { readonly x: number; readonly y: number } {
  return { x: visibleWidth / 2, y: visibleHeight / 2 };
}

/** 能被移交清色职责的相机（结构类型，便于零 cc 单测）。 */
export interface ClearFlagsHolder {
  clearFlags: number;
}

export interface ClearOwnershipDeps {
  /** 背景相机——默认的唯一清色者；移交期间关闭其节点。 */
  readonly background: { readonly node: { active: boolean } };
  /** `Camera.ClearFlag.SOLID_COLOR` 的值，由 shell 注入以免在纯逻辑里复制 cc 常量。 */
  readonly solidColor: number;
  /** `Camera.ClearFlag.DEPTH_ONLY` 的值。 */
  readonly depthOnly: number;
}

export interface ClearOwnership {
  /** 把清色职责交给 `cam`：`cam` 转 SOLID_COLOR + 关背景相机。幂等；换人会先归还前一台。 */
  claim(cam: ClearFlagsHolder): void;
  /** 收回：借用方恢复 DEPTH_ONLY + 开回背景相机。无借用方时 no-op。 */
  release(): void;
  /** 当前借用方（无则 undefined）。 */
  owner(): ClearFlagsHolder | undefined;
}

/**
 * 清色职责移交的状态机，守不变式：**任一时刻 priority 最低的活动相机必须 `SOLID_COLOR`**。
 *
 * 为什么要封成原子操作：「故意不要背景」（全屏不透明 3D / 子游戏自带整屏画面）是正当需求，
 * 但它要求**两处同改**，漏一处的后果都只在真机显形、预览查不出——
 *  - 只改 `clearFlags` 留着背景开着 → 背景整屏白画一遍再被覆盖（多一次全屏 clear + 整批 overdraw）；
 *  - 只关背景而借用方仍 `DEPTH_ONLY` → 无人清色，颜色缓冲未定义 → 真机花屏/残影。
 * 引擎也在 `Canvas.renderMode` 注释里点明「必须有一个相机 ClearFlag 选 SOLID_COLOR，否则移动端可能闪屏」。
 */
export function createClearOwnership(deps: ClearOwnershipDeps): ClearOwnership {
  let owner: ClearFlagsHolder | undefined;

  const release = (): void => {
    if (!owner) return;
    owner.clearFlags = deps.depthOnly;
    owner = undefined;
    deps.background.node.active = true;
  };

  return {
    claim(cam) {
      if (owner === cam) return; // 幂等
      release(); // 换人：先归还前一台，避免两台同时 SOLID_COLOR
      cam.clearFlags = deps.solidColor;
      owner = cam;
      deps.background.node.active = false;
    },
    release,
    owner: () => owner,
  };
}

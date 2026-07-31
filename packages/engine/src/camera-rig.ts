import {
  Camera,
  Color,
  Layers,
  Node,
  RenderRoot2D,
  UITransform,
  Widget,
  director,
  screen,
  view,
} from 'cc';
import { createToken, getRootContainer, type KitModule, type Token } from '@cck/core';
import {
  CAMERA_PRIORITY,
  CCK_LAYERS,
  computeCameraCenter,
  computeOrthoHeight,
  createClearOwnership,
  type CameraRigLayer,
  type ClearOwnership,
} from './render-policy';

/**
 * kit 常驻相机组（CameraRig）—— 全 app 唯一、跨场景常驻的「背景相机 + UI 相机 + 各层挂载 root」。
 * 业务场景不再各配相机；3D 子游戏只需把自己的 world 相机 priority 落进预留区 1..99。
 *
 * 设计见 packages/engine/docs/modules/camera-rig.md。
 * 纯决策逻辑（priority/层常量、orthoHeight 公式、清色移交状态机）在 ./render-policy（零 cc、已单测）；
 * 本文件是 cc 薄壳——真节点/相机/Widget 行为按 ADR-0002 决策 3 不进 mock，靠 apps/demo 预览验证。
 */

export interface CameraRigOptions {
  /** 背景相机清色。默认 `Color(28, 30, 40, 255)`。 */
  readonly clearColor?: Color;
  /** 要建哪些层。默认 `['bg', 'ui']`；`uiBack`/`uiFront` 按需加。 */
  readonly layers?: readonly CameraRigLayer[];
}

export interface CameraRig {
  /** 常驻根节点（已 `addPersistRootNode`）。⚠️ 不得给它加 `UITransform`，见下方 buildRoot 注释。 */
  readonly root: Node;
  /**
   * 取某层的挂载 root（已配好 `UITransform` + `RenderRoot2D` + 拉满屏的 `Widget`）。
   * ⚠️ 挂上去的节点**跨场景存活**——只放真正需要跨场景的 UI（全局 loading / toast / 断线提示）；
   * 场景自己的 UI 请留在场景里（自带 `RenderRoot2D` + 设对应层）。
   */
  layerRoot(layer: CameraRigLayer): Node;
  /** 该层是否已启用（UI 挂载点用它决定是否回退到 `ui` 层）。 */
  hasLayer(layer: CameraRigLayer): boolean;
  /** 该层的 cc layer 掩码。挂上去的节点子树须归一到它，否则相机 visibility 不含该层 → 不可见。 */
  layerMask(layer: CameraRigLayer): number;
  /** 取某层的相机。 */
  camera(layer: CameraRigLayer): Camera;
  /** 清色职责移交：`cam` 转 `SOLID_COLOR` + 关背景相机。用于「故意不要背景」的全屏场景。 */
  claimClear(cam: Camera): void;
  /** 收回清色职责：借用方恢复 `DEPTH_ONLY` + 开回背景相机。 */
  releaseClear(): void;
  /** 销毁常驻根 + 解除 `view` 事件监听。由 `KitModule.stop` 调用。 */
  dispose(): void;
}

export const CAMERA_RIG: Token<CameraRig> = createToken<CameraRig>('cck.cameraRig');

const RIG_ROOT_NAME = 'CCKRig';
const DEFAULT_LAYERS: readonly CameraRigLayer[] = ['bg', 'ui'];
/** UI 视距范围 -999..1000，与 `canvas.ts::_onResizeCamera` 的硬编码一致。 */
const UI_CAMERA_Z = 1000;

/**
 * 解析层名 → layer 掩码，并**校验自定义层已在 Project Settings → Layers 注册**。
 *
 * 故意**不做** `Layers.addLayer` 运行时兜底：运行时注册与项目设置不一致会让场景资源里存的
 * layer 值错位，变成静默的诡异 bug（决策表 #5）。宁可在启动时炸一个可操作的错。
 */
function layerMaskOf(layer: CameraRigLayer): number {
  if (layer === 'ui') return Layers.Enum.UI_2D;
  const { name, bit } = CCK_LAYERS[layer];
  const enumMap = Layers.Enum as unknown as Record<string, number | undefined>;
  const mask = enumMap[name];
  if (typeof mask !== 'number') {
    throw new Error(
      `[CameraRig] 自定义层 '${name}' 未注册。请在 Cocos Creator 的 Project Settings → Layers 里把 bit ${bit} 命名为 '${name}'。`,
    );
  }
  const expected = 1 << bit;
  if (mask !== expected) {
    throw new Error(
      `[CameraRig] 自定义层 '${name}' 注册在 bit ${Math.log2(mask)}，但 kit 约定为 bit ${bit}。请在 Project Settings → Layers 里改到 bit ${bit}，否则场景资源里存的 layer 值会错位。`,
    );
  }
  return mask;
}

/**
 * 建常驻根。**绝不给它加 `UITransform`** —— 层级 root 的 `Widget` 靠
 * `widget-manager.ts:64` 的 `useGlobal = target instanceof Scene || !target.getComponent(UITransform)`
 * 走 `isRoot` 分支、对齐 `visibleRect`（全屏）。一旦这里有了 `UITransform`，`useGlobal` 变 false
 * → Widget 改为对齐本节点 `contentSize`（默认 100×100）→ 全部 UI 缩成 100×100。
 * 详见 docs/research/2026-07-30-cc-canvas-vs-renderroot2d.md §7。
 */
function buildRoot(): Node {
  const scene = director.getScene();
  if (!scene) throw new Error('[CameraRig] 当前没有活动场景，无法建常驻相机组。');

  // 幂等：开发期热重载会重跑模块顶层。旧 rig 由旧代码建，直接换新的而非复用。
  const stale = scene.getChildByName(RIG_ROOT_NAME);
  if (stale) {
    director.removePersistRootNode(stale);
    stale.destroy();
  }

  const root = new Node(RIG_ROOT_NAME);
  scene.addChild(root);
  director.addPersistRootNode(root); // 须为场景根的直接子节点
  return root;
}

/** 建一台全屏正交相机。背景层清色，其余 `DEPTH_ONLY` 叠加（守「唯一清色相机」不变式）。 */
function buildCamera(parent: Node, layer: CameraRigLayer, mask: number, clearColor: Color): Camera {
  const node = new Node(`${layer}Camera`);
  node.layer = mask;
  parent.addChild(node);
  node.setPosition(0, 0, UI_CAMERA_Z); // XY 占位，紧随的 syncCameras 会摆到可视矩形中心

  const cam = node.addComponent(Camera);
  cam.projection = Camera.ProjectionType.ORTHO;
  cam.priority = CAMERA_PRIORITY[layer];
  cam.visibility = mask; // 只渲本层 → 多台 UI 相机不会把同一批节点渲两遍
  if (layer === 'bg') {
    cam.clearFlags = Camera.ClearFlag.SOLID_COLOR;
    cam.clearColor = clearColor;
  } else {
    cam.clearFlags = Camera.ClearFlag.DEPTH_ONLY; // 不清背景，只清深度/模板
  }
  return cam;
}

/**
 * 建一层挂载 root：`UITransform`（`RenderRoot2D` 的 `@requireComponent` 自动带）+ `RenderRoot2D`
 * + 四边全 0 的 `Widget`。`RenderRoot2D` 才是 2D 渲染入口（官方：「所有的 2D 渲染对象需在
 * RenderRoot 节点下才可以被渲染」），不必套 Canvas —— 相机配对靠 layer × visibility。
 */
function buildLayerRoot(parent: Node, layer: CameraRigLayer, mask: number): Node {
  const node = new Node(`${layer}Root`);
  node.layer = mask;
  parent.addChild(node);
  node.addComponent(UITransform);
  node.addComponent(RenderRoot2D);

  const w = node.addComponent(Widget);
  w.isAlignTop = w.isAlignBottom = w.isAlignLeft = w.isAlignRight = true;
  w.top = w.bottom = w.left = w.right = 0;
  // ON_WINDOW_RESIZE：先对齐一次，之后仅窗口尺寸变化时重对齐（不用 ALWAYS，免得每帧白算）
  w.alignMode = Widget.AlignMode.ON_WINDOW_RESIZE;
  return node;
}

export function createCameraRig(opts?: CameraRigOptions): CameraRig {
  const layers = opts?.layers ?? DEFAULT_LAYERS;
  if (!layers.includes('bg')) {
    throw new Error(
      '[CameraRig] layers 必须含 \'bg\' —— 它是唯一清颜色缓冲的相机，缺了会导致真机颜色缓冲未定义（花屏）。',
    );
  }

  // 先全量校验层注册，再动手建节点（避免建了一半失败留下残根）
  const masks = new Map<CameraRigLayer, number>(layers.map((l) => [l, layerMaskOf(l)]));

  const root = buildRoot();
  const cameras = new Map<CameraRigLayer, Camera>();
  const layerRoots = new Map<CameraRigLayer, Node>();
  const clearColor = opts?.clearColor ?? new Color(28, 30, 40, 255);

  for (const layer of layers) {
    const mask = masks.get(layer)!;
    cameras.set(layer, buildCamera(root, layer, mask, clearColor));
    layerRoots.set(layer, buildLayerRoot(root, layer, mask));
  }

  const clear: ClearOwnership = createClearOwnership({
    background: cameras.get('bg')!,
    solidColor: Camera.ClearFlag.SOLID_COLOR,
    depthOnly: Camera.ClearFlag.DEPTH_ONLY,
  });

  /**
   * 同步所有相机的 orthoHeight + 位置。orthoHeight 照抄 `canvas.ts::_onResizeCamera()`（含
   * targetTexture 分支）；位置走 `computeCameraCenter` —— UI 坐标系原点在可视区左下角，相机必须
   * 落在可视矩形中心而非世界原点（见该函数注释）。全屏同参数正交相机取值一致，一次循环设完。
   */
  const syncCameras = (): void => {
    const winH = screen.windowSize.height;
    const scaleY = view.getScaleY();
    const visible = view.getVisibleSize(); // 与引擎内部 visibleRect 同源
    const center = computeCameraCenter(visible.width, visible.height);
    for (const cam of cameras.values()) {
      if (!cam.isValid) continue;
      cam.orthoHeight = computeOrthoHeight({
        windowHeight: winH,
        scaleY,
        hasTargetTexture: !!cam.targetTexture,
        visibleRectHeight: visible.height,
      });
      cam.node.setWorldPosition(center.x, center.y, UI_CAMERA_Z);
    }
  };

  syncCameras();
  view.on('canvas-resize', syncCameras);
  view.on('design-resolution-changed', syncCameras);

  const need = <T>(m: Map<CameraRigLayer, T>, layer: CameraRigLayer, what: string): T => {
    const v = m.get(layer);
    if (!v) {
      throw new Error(
        `[CameraRig] 层 '${layer}' 未启用，取不到${what}。请在 cameraRigModule({ layers: [...] }) 里加上它。`,
      );
    }
    return v;
  };

  return {
    root,
    layerRoot: (layer) => need(layerRoots, layer, '挂载 root'),
    hasLayer: (layer) => layerRoots.has(layer),
    layerMask: (layer) => need(masks, layer, 'layer 掩码'),
    camera: (layer) => need(cameras, layer, '相机'),
    claimClear: (cam) => clear.claim(cam),
    releaseClear: () => clear.release(),
    dispose() {
      view.off('canvas-resize', syncCameras);
      view.off('design-resolution-changed', syncCameras);
      clear.release(); // 别把被改过 clearFlags 的外部相机留在借用态
      if (root.isValid) {
        director.removePersistRootNode(root);
        root.destroy();
      }
    },
  };
}

/**
 * KitModule：`start` 时建常驻相机组并注册 `CAMERA_RIG`；`stop` 时 dispose。
 * 放在 `bootCoreKit({ modules: [...] })` 里，**须在依赖 UI 挂载点的模块之前**。
 */
export function cameraRigModule(opts?: CameraRigOptions): KitModule {
  let rig: CameraRig | undefined;
  return {
    name: 'camera-rig',
    start(ctx) {
      rig = createCameraRig(opts);
      ctx.container.register(CAMERA_RIG, { useValue: rig });
    },
    stop(ctx) {
      rig?.dispose();
      rig = undefined;
      ctx.container.unregister(CAMERA_RIG);
    },
  };
}

/** 取当前相机组（同 core `getEventBus()` 等便捷访问惯例）。 */
export function getCameraRig(): CameraRig {
  return getRootContainer().resolve(CAMERA_RIG);
}

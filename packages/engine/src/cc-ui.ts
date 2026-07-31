import { Canvas, Layers, Node, director, instantiate } from 'cc';
import type { Prefab } from 'cc';
import { UI_LAYERS, UI_VIEW, getAssetLoader, getRootContainer } from '@cck/core';
import type { IUIView, KitModule, UILayer, UIViewSpec } from '@cck/core';
import { CAMERA_RIG } from './camera-rig';
import type { CameraRigLayer } from './render-policy';
import { CCKUIView } from './cck-ui-view';

/**
 * IUIView 的 cc 实现 —— UIManager 的「引擎半」：经 IAssetLoader 加载 prefab、instantiate、挂到层容器 Node、
 * 回调界面契约 {@link CCKUIView}，返回不透明 handle。去重/生命周期/变体重建决策全在 core（ui-manager.ts）。
 *
 * **层容器一次建全**（按 `UI_LAYERS` 顺序）：懒建会让 z 序退化成「首次 open 的顺序」——先开 toast
 * 再开 popup 就会被盖住。子节点挂载顺序即同一相机内的 z 序。
 */
interface Rec {
  readonly node: Node;
  readonly prefab: string;
  readonly bundle?: string;
}

/**
 * UI 层 → 相机层。`uiBack/uiFront` 未启用时回退到 `ui` root（层序仍由建全顺序保证），
 * 项目要真拆相机只需 `cameraRigModule({ layers: ['bg','uiBack','ui','uiFront'] })`，业务零改。
 */
const CAMERA_LAYER_OF: Readonly<Record<UILayer, CameraRigLayer>> = {
  back: 'uiBack',
  hud: 'ui',
  ui: 'ui',
  popup: 'ui',
  dialog: 'ui',
  guide: 'uiFront',
  loading: 'uiFront',
  system: 'uiFront',
  notify: 'uiFront',
  top: 'uiFront',
};

export function createCcUIView(opts?: { root?: Node }): IUIView {
  const layers = new Map<UILayer, Node>();
  const handles = new Map<number, Rec>();
  let next = 1;

  const fallbackRoot = (): Node => {
    const scene = director.getScene();
    const canvas = scene?.getComponentInChildren(Canvas);
    if (canvas) return canvas.node;
    // ponytail: 兜底新建 Canvas——运行时建的 Canvas 无 Camera 可能不渲染；正式项目应装 cameraRigModule。
    const node = new Node('CCK_UICanvas');
    node.addComponent(Canvas);
    if (scene) {
      scene.addChild(node);
      director.addPersistRootNode(node);
    }
    return node;
  };

  /** 某 UI 层该挂哪个 root、节点子树该归一到哪个 layer 掩码。 */
  const hostOf = (layer: UILayer): { parent: Node; mask: number } => {
    if (opts?.root && opts.root.isValid) return { parent: opts.root, mask: opts.root.layer };
    // 装了常驻相机组就用它的层挂载点：已配好 RenderRoot2D + 满屏 Widget，且**跨场景常驻**
    // ——正合 UIManager 的全局窗口语义（loading / toast / 断线提示 不该随场景消失）。
    const rig = getRootContainer().tryResolve(CAMERA_RIG);
    if (rig) {
      const want = CAMERA_LAYER_OF[layer];
      const cam: CameraRigLayer = rig.hasLayer(want) ? want : 'ui';
      if (rig.hasLayer(cam)) return { parent: rig.layerRoot(cam), mask: rig.layerMask(cam) };
    }
    return { parent: fallbackRoot(), mask: Layers.Enum.UI_2D };
  };

  /**
   * 建全部层容器（幂等；场景换掉导致容器失效时整批重建）。
   * ⚠️ **不给容器加 `UITransform`**：`widget-manager` 的 `useGlobal` 靠「父节点无 UITransform」
   * 走 isRoot 分支对齐 visibleRect（全屏）；一旦有了 UITransform，子界面的 Widget 会改为对齐
   * 100×100 的默认 contentSize → 全部 UI 缩成一团。见 docs/research/2026-07-30-cc-canvas-vs-renderroot2d.md §7。
   */
  const ensureLayers = (): void => {
    if (layers.size === UI_LAYERS.length && Array.from(layers.values()).every((n) => n.isValid)) return;
    layers.clear();
    for (const layer of UI_LAYERS) {
      const { parent, mask } = hostOf(layer);
      const node = new Node(`UILayer_${layer}`);
      node.layer = mask;
      parent.addChild(node);
      layers.set(layer, node);
    }
  };

  /**
   * 把子树 layer 归一到容器所在层。prefab 在编辑器里存的多是 `UI_2D`，直接挂到 `uiBack/uiFront`
   * 容器下会因相机 visibility 不含该层而**整屏不可见**——这类 bug 没日志、只表现为「白开一个界面」。
   */
  const applyLayer = (node: Node, mask: number): void => {
    node.layer = mask;
    for (const child of node.children) applyLayer(child, mask);
  };

  const doDestroy = (handle: number): void => {
    const rec = handles.get(handle);
    if (!rec) return;
    handles.delete(handle);
    if (rec.node.isValid) {
      rec.node.getComponent(CCKUIView)?.onHide();
      rec.node.destroy();
    }
    getAssetLoader().release(rec.prefab, { type: 'prefab', bundle: rec.bundle });
  };

  return {
    async create(spec: UIViewSpec): Promise<number> {
      ensureLayers();
      const container = layers.get(spec.layer) ?? layers.get('ui')!;
      const prefab = await getAssetLoader().load<Prefab>(spec.prefab, {
        type: 'prefab',
        bundle: spec.bundle,
      });
      const node = instantiate(prefab);
      applyLayer(node, container.layer);
      container.addChild(node);
      const handle = next++;
      handles.set(handle, { node, prefab: spec.prefab, bundle: spec.bundle });

      const view = node.getComponent(CCKUIView);
      if (view) {
        view.uiId = spec.uiId;
        try {
          await view.onShow(spec.args, spec.state);
        } catch (e) {
          doDestroy(handle); // onShow 炸了别把半初始化的界面留在树上
          throw e;
        }
      }
      return handle;
    },

    destroy: doDestroy,

    saveState(handle: number): unknown {
      const rec = handles.get(handle);
      if (!rec?.node.isValid) return undefined;
      return rec.node.getComponent(CCKUIView)?.saveState?.();
    },

    restack(_layer: UILayer, ordered: readonly number[]): void {
      ordered.forEach((h, i) => {
        const rec = handles.get(h);
        if (rec?.node.isValid) rec.node.setSiblingIndex(i);
      });
    },
  };
}

/** KitModule：注册 `UI_VIEW → cc 渲染实现`（本层未注册时）。放模块数组里，UIManager 自动拾取。 */
export function ccUIModule(): KitModule {
  return {
    name: 'ui-view',
    install(ctx) {
      if (!ctx.container.hasLocal(UI_VIEW)) {
        ctx.container.register(UI_VIEW, { useValue: createCcUIView() });
      }
    },
  };
}

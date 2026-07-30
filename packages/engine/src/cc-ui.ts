import { Canvas, Node, director, instantiate } from 'cc';
import type { Prefab } from 'cc';
import { UI_VIEW, getAssetLoader } from '@cck/core';
import type { IUIView, UIViewSpec, KitModule } from '@cck/core';

/**
 * IUIView 的 cc 实现 —— UIManager 的「引擎半」：经 IAssetLoader 加载 prefab、instantiate、挂到层容器 Node，
 * 返回不透明 handle；destroy 时销毁节点并解引用 prefab。窗口栈/去重/生命周期全在 core（ui-manager.ts）。
 * 层容器：每个 layer 懒建一个子 Node 挂在 UI 根 Canvas 下（子节点挂载顺序即 z 序）。
 */
interface Rec {
  readonly node: Node;
  readonly prefab: string;
  readonly bundle?: string;
}

export function createCcUIView(opts?: { root?: Node }): IUIView {
  const layers = new Map<string, Node>();
  const handles = new Map<number, Rec>();
  let next = 1;

  const uiRoot = (): Node => {
    if (opts?.root && opts.root.isValid) return opts.root;
    const scene = director.getScene();
    const canvas = scene?.getComponentInChildren(Canvas);
    if (canvas) return canvas.node;
    // ponytail: 兜底新建 Canvas——运行时建的 Canvas 无 Camera 可能不渲染；正式项目场景应自带 Canvas。
    const node = new Node('CCK_UICanvas');
    node.addComponent(Canvas);
    if (scene) {
      scene.addChild(node);
      director.addPersistRootNode(node);
    }
    return node;
  };

  const layerNode = (layer: string): Node => {
    let n = layers.get(layer);
    if (!n || !n.isValid) {
      n = new Node(`UILayer_${layer}`);
      uiRoot().addChild(n);
      layers.set(layer, n);
    }
    return n;
  };

  return {
    async create(spec: UIViewSpec): Promise<number> {
      const prefab = await getAssetLoader().load<Prefab>(spec.prefab, { type: 'prefab', bundle: spec.bundle });
      const node = instantiate(prefab);
      layerNode(spec.layer).addChild(node);
      // ponytail: spec.args 透传未接——需先约定 UI 脚本基类/接口，再在此 node.getComponent(...)?.onShow(args)。
      const handle = next++;
      handles.set(handle, { node, prefab: spec.prefab, bundle: spec.bundle });
      return handle;
    },

    destroy(handle: number): void {
      const rec = handles.get(handle);
      if (!rec) return;
      handles.delete(handle);
      if (rec.node.isValid) rec.node.destroy();
      getAssetLoader().release(rec.prefab, { type: 'prefab', bundle: rec.bundle });
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

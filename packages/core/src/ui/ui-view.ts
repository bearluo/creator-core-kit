import { createToken, type Token } from '../di';
import type { UILayer } from './ui-registry';

/** 一个 UI 的实例化规格，交给 engine 渲染层。 */
export interface UIViewSpec {
  /** UI 标识（单实例键）。 */
  uiId: string;
  /** prefab 资源路径（已按变体解析）。 */
  prefab: string;
  /** prefab 所在 Asset Bundle 名（省略 = 内置 resources/主包）。 */
  bundle?: string;
  /** 归属层（决定挂到哪个层容器 Node，定 z 序）。 */
  layer: UILayer;
  /** 打开传参，透传给界面的 `onShow(args, state)`。 */
  args?: unknown;
  /** 变体重建时回灌的界面自存状态（来自上一实例的 `saveState`）。首次打开为 undefined。 */
  state?: unknown;
}

/**
 * 渲染接缝：core 只认本接口（守零 cc 铁律）。engine 用 IAssetLoader 加载 prefab、
 * instantiate、挂到 layer 容器 Node、调界面钩子，返回不透明正整数 handle(>0)。
 * 去重 / 生命周期 / 变体重建决策全在 core（ui-manager.ts），本接口只做 4 个原子 IO。
 */
export interface IUIView {
  /** 加载并挂载一个 UI，返回 handle(>0)。失败抛错（UIManager 捕获转 false）。 */
  create(spec: UIViewSpec): Promise<number>;
  /** 销毁指定 UI（未知 handle 为 no-op）。 */
  destroy(handle: number): void;
  /** 重建前取界面自存状态（界面没实现则 undefined）。 */
  saveState(handle: number): unknown;
  /** 按给定顺序复位某层内的 z 序（部分重建后层内次序会错乱）。 */
  restack(layer: UILayer, handles: readonly number[]): void;
}

/** DI token：engine Bootstrap register cc 渲染适配；未注册时 UIManager 回退空实现（只发号、不出画面）。 */
export const UI_VIEW: Token<IUIView> = createToken<IUIView>('cck.uiView');

/**
 * 空渲染层（null object）：不建节点，只发号。默认实现（无 engine 时）+ 单测背书。
 * 让 UIManager 的去重/生命周期/重建逻辑在 node 环境可脱引擎跑。
 */
export function createMemoryUIView(): IUIView {
  let next = 1;
  return {
    create: () => Promise.resolve(next++),
    destroy: () => {},
    saveState: () => undefined,
    restack: () => {},
  };
}

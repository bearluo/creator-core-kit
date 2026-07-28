import { createToken, type Token } from '../di';

/** 一个 UI 的实例化规格，交给 engine 渲染层。 */
export interface UIViewSpec {
  /** UI 标识（单实例键），也作默认 prefab 路径。 */
  uiId: string;
  /** prefab 资源路径（默认 = uiId）。 */
  prefab: string;
  /** 归属层名（决定挂到哪个层容器 Node，定 z 序）。 */
  layer: string;
  /** 打开传参，透传给 UI 脚本的 onShow/init。 */
  args?: unknown;
}

/**
 * 渲染接缝：core 只认本接口（守零 cc 铁律）。engine 用 IAssetLoader 加载 prefab、
 * instantiate、挂到 layer 容器 Node、播出场动画，返回不透明正整数 handle(>0)。
 * core 只管窗口栈/去重/生命周期决策，不碰 cc.Node。
 */
export interface IUIView {
  /** 加载并挂载一个 UI，返回 handle(>0)。失败抛错（UIManager 捕获转 false）。 */
  create(spec: UIViewSpec): Promise<number>;
  /** 销毁指定 UI（未知 handle 为 no-op）。 */
  destroy(handle: number): void;
}

/** DI token：engine Bootstrap register cc 渲染适配；未注册时 UIManager 回退空实现（只发号、不出画面）。 */
export const UI_VIEW: Token<IUIView> = createToken<IUIView>('cck.uiView');

/**
 * 空渲染层（null object）：不建节点，只发号。默认实现（无 engine 时）+ 单测背书。
 * 让 UIManager 的栈/去重/生命周期逻辑在 node 环境可脱引擎跑。
 */
export function createMemoryUIView(): IUIView {
  let next = 1;
  return {
    create: () => Promise.resolve(next++),
    destroy: () => {},
  };
}

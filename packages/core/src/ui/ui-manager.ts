import { createToken, getRootContainer, type Token } from '../di';
import { getLogger, type ILogger } from '../logging';
import { UI_VIEW, createMemoryUIView, type IUIView } from './ui-view';

/** 默认层名（engine 侧对应一个层容器 Node）。 */
export const DEFAULT_UI_LAYER = 'ui';

export interface UIOpenOptions {
  /** 归属层，默认 'ui'。每层独立、无全局返回栈（层内单实例）。 */
  layer?: string;
  /** prefab 路径，默认 = uiId。 */
  prefab?: string;
  /** 打开传参，透传给 engine 渲染层。 */
  args?: unknown;
}

export interface UIManager {
  /**
   * 打开 UI（层内单实例：同 uiId 已开/加载中则不重复建）。
   * 返回是否处于打开态：true=已打开或已在打开中并成功；false=加载失败。
   * 并发重复 open 同 uiId 复用同一 inflight（对齐 AssetManager 去重）。
   */
  open(uiId: string, opts?: UIOpenOptions): Promise<boolean>;
  /** 关闭 UI（含加载中的：标记取消，create 落地即销毁）。返回是否原本被跟踪。 */
  close(uiId: string): boolean;
  /** 是否被跟踪（含加载中）。 */
  isOpen(uiId: string): boolean;
  /** 关闭某层全部 UI。 */
  closeLayer(layer: string): void;
  /** 关闭全部 UI。 */
  closeAll(): void;
  /** 当前被跟踪的 uiId（升序）。 */
  list(): string[];
  /** uiId 的归属层；未跟踪返回 undefined。 */
  layerOf(uiId: string): string | undefined;
}

export interface UIManagerOptions {
  /** 渲染后端。默认：DI UI_VIEW，未注册则空实现。 */
  view?: IUIView;
  logger?: ILogger;
}

interface Entry {
  readonly layer: string;
  /** engine 渲染 handle；加载完成前为 0。 */
  view: number;
  inflight?: Promise<boolean>;
  /** close 在加载中先行 → create 落地即销毁，防节点泄漏。 */
  closed: boolean;
}

/** 造 UIManager（纯逻辑、零 cc；实例化/销毁经 IUIView 接缝注入）。 */
export function createUIManager(opts?: UIManagerOptions): UIManager {
  const view = opts?.view ?? getRootContainer().tryResolve(UI_VIEW) ?? createMemoryUIView();
  const logger = opts?.logger ?? getLogger('UIManager');

  const open = new Map<string, Entry>();

  const doClose = (uiId: string): boolean => {
    const e = open.get(uiId);
    if (!e) return false;
    open.delete(uiId);
    e.closed = true;
    if (e.view) view.destroy(e.view);
    return true;
  };

  return {
    open(uiId: string, o?: UIOpenOptions): Promise<boolean> {
      const existing = open.get(uiId);
      if (existing) {
        // 加载中 → 复用 inflight；已打开 → 单实例 no-op 成功
        return existing.inflight ?? Promise.resolve(true);
      }
      const layer = o?.layer ?? DEFAULT_UI_LAYER;
      const prefab = o?.prefab ?? uiId;
      const entry: Entry = { layer, view: 0, closed: false };
      const p = (async (): Promise<boolean> => {
        try {
          const handle = await view.create({ uiId, prefab, layer, args: o?.args });
          if (entry.closed) {
            // 加载期间被 close：销毁刚建好的节点，不回填
            view.destroy(handle);
            return false;
          }
          entry.view = handle;
          entry.inflight = undefined;
          return true;
        } catch (e) {
          open.delete(uiId);
          logger.warn(`open: UI '${uiId}' 创建失败`, e);
          return false;
        }
      })();
      entry.inflight = p;
      open.set(uiId, entry);
      return p;
    },

    close(uiId: string): boolean {
      return doClose(uiId);
    },

    isOpen(uiId: string): boolean {
      return open.has(uiId);
    },

    closeLayer(layer: string): void {
      for (const [id, e] of [...open]) {
        if (e.layer === layer) doClose(id);
      }
    },

    closeAll(): void {
      for (const id of [...open.keys()]) doClose(id);
    },

    list(): string[] {
      return [...open.keys()].sort();
    },

    layerOf(uiId: string): string | undefined {
      return open.get(uiId)?.layer;
    },
  };
}

/** DI token：项目可 register 自己的 UIManager 覆盖默认。 */
export const UI_MANAGER: Token<UIManager> = createToken<UIManager>('cck.uiManager');

let _default: UIManager | undefined;

/** 便捷取用：优先 tryResolve(UI_MANAGER)；未注册则进程级默认（空渲染层背书）。 */
export function getUIManager(): UIManager {
  return getRootContainer().tryResolve(UI_MANAGER) ?? (_default ??= createUIManager());
}

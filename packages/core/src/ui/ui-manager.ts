import { createToken, getRootContainer, type Token } from '../di';
import { getLogger, type ILogger } from '../logging';
import {
  DEFAULT_UI_VARIANT,
  getUIDef,
  layerOfDef,
  resolveUIDef,
  type UIDef,
  type UILayer,
  type UIVariant,
} from './ui-registry';
import { UI_VIEW, createMemoryUIView, type IUIView } from './ui-view';

export interface UIManager {
  /**
   * 打开 UI（层内单实例：同 uiId 已开/加载中则不重复建）。「怎么开」全来自注册表（{@link registerUI}）。
   * 返回是否处于打开态：true=已打开或已在打开中并成功；false=未注册 / 加载失败。
   * 并发重复 open 同 uiId 复用同一 inflight（对齐 AssetManager 去重）。
   */
  open(uiId: string, args?: unknown): Promise<boolean>;
  /** 关闭 UI（含加载中的：标记取消，create 落地即销毁）。返回是否原本被跟踪。 */
  close(uiId: string): boolean;
  /** 是否被跟踪（含加载中）。 */
  isOpen(uiId: string): boolean;
  /** 关闭某层全部 UI。 */
  closeLayer(layer: UILayer): void;
  /**
   * 关闭所有「按**当前变体**解析后 bundle === 该名」的界面（含加载中的）。
   * 卸载 / 换版本该 bundle 前必须先调：换版本后 cc 类表被静默替换，旧类实例即成孤儿。
   */
  closeByBundle(bundle: string): void;
  /** 关闭全部 UI。 */
  closeAll(): void;
  /** 当前被跟踪的 uiId（升序）。 */
  list(): string[];
  /** uiId 的归属层；未跟踪返回 undefined。 */
  layerOf(uiId: string): UILayer | undefined;
  /** 当前界面变体。 */
  variant(): UIVariant;
  /** 改变体 → 遍历打开中的界面，**只重建解析结果真的变了的**。同值为完全 no-op。 */
  setVariant(patch: Partial<UIVariant>): Promise<void>;
}

export interface UIManagerOptions {
  /** 渲染后端。默认：DI UI_VIEW，未注册则空实现。 */
  view?: IUIView;
  logger?: ILogger;
  /** 初始变体，默认竖屏 + `'default'` 皮肤。 */
  variant?: UIVariant;
}

interface Entry {
  readonly def: UIDef;
  readonly layer: UILayer;
  readonly args?: unknown;
  /** engine 渲染 handle；加载完成前为 0。 */
  view: number;
  inflight?: Promise<boolean>;
  /** close 在加载中先行 → create 落地即销毁，防节点泄漏。 */
  closed: boolean;
}

/** 造 UIManager（纯逻辑、零 cc；实例化/销毁经 IUIView 接缝注入）。 */
export function createUIManager(opts?: UIManagerOptions): UIManager {
  // 渲染后端**延迟解析**：UIManager 常在 engine 注册 UI_VIEW 之前就被 getUIManager() 造出来，
  // 构造期解析会把它永久固化成空实现——表现为「open 返回 true 却没画面」这类无日志的坑。
  let backend = opts?.view;
  const view = (): IUIView =>
    (backend ??= getRootContainer().tryResolve(UI_VIEW) ?? createMemoryUIView());
  const logger = opts?.logger ?? getLogger('UIManager');
  let variant: UIVariant = opts?.variant ?? DEFAULT_UI_VARIANT;

  const open = new Map<string, Entry>();

  const doClose = (uiId: string): boolean => {
    const e = open.get(uiId);
    if (!e) return false;
    open.delete(uiId);
    e.closed = true;
    if (e.view) view().destroy(e.view);
    return true;
  };

  /** 按当前变体解析并建实例；失败则摘掉登记并 warn。首建与变体重建共用。 */
  const spawn = (uiId: string, e: Entry, state?: unknown): Promise<boolean> => {
    const r = resolveUIDef(e.def, variant);
    return (async () => {
      try {
        const handle = await view().create({
          uiId,
          prefab: r.prefab,
          bundle: r.bundle,
          layer: e.layer,
          args: e.args,
          state,
        });
        if (e.closed) {
          // 加载期间被 close：销毁刚建好的节点，不回填
          view().destroy(handle);
          return false;
        }
        e.view = handle;
        e.inflight = undefined;
        return true;
      } catch (err) {
        open.delete(uiId);
        logger.warn(`UI '${uiId}' 创建失败`, err);
        return false;
      }
    })();
  };

  return {
    open(uiId: string, args?: unknown): Promise<boolean> {
      const existing = open.get(uiId);
      if (existing) {
        // 加载中 → 复用 inflight；已打开 → 单实例 no-op 成功
        return existing.inflight ?? Promise.resolve(true);
      }
      const def = getUIDef(uiId);
      if (!def) {
        logger.warn(`open: UI '${uiId}' 未注册 —— 先 registerUI('${uiId}', { prefab, ... })`);
        return Promise.resolve(false);
      }
      const entry: Entry = { def, layer: layerOfDef(def), args, view: 0, closed: false };
      const p = spawn(uiId, entry);
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

    closeLayer(layer: UILayer): void {
      for (const [id, e] of Array.from(open)) {
        if (e.layer === layer) doClose(id);
      }
    },

    closeByBundle(bundle: string): void {
      for (const [id, e] of Array.from(open)) {
        if (resolveUIDef(e.def, variant).bundle === bundle) doClose(id);
      }
    },

    closeAll(): void {
      for (const id of Array.from(open.keys())) doClose(id);
    },

    list(): string[] {
      return Array.from(open.keys()).sort();
    },

    layerOf(uiId: string): UILayer | undefined {
      return open.get(uiId)?.layer;
    },

    variant(): UIVariant {
      return variant;
    },

    async setVariant(patch: Partial<UIVariant>): Promise<void> {
      const next: UIVariant = { ...variant, ...patch };
      if (next.orientation === variant.orientation && next.skin === variant.skin) return;

      // 先让加载中的界面落地，免得拿半成品去比对解析结果
      const pendings = Array.from(open.values()).flatMap((e) => (e.inflight ? [e.inflight] : []));
      if (pendings.length) await Promise.all(pendings);

      const prev = variant;
      variant = next;

      const touched = new Set<UILayer>();
      for (const [uiId, e] of Array.from(open)) {
        // ponytail: 上面那轮 await 期间新开的仍在加载 → 沿用旧变体，下次 open 才纠正。
        if (e.closed || !e.view) continue;
        const a = resolveUIDef(e.def, prev);
        const b = resolveUIDef(e.def, next);
        if (a.prefab === b.prefab && a.bundle === b.bundle) continue; // 按需重建：解析没变就不动
        const state = view().saveState(e.view);
        view().destroy(e.view);
        e.view = 0;
        e.inflight = spawn(uiId, e, state);
        await e.inflight;
        touched.add(e.layer);
      }

      // 重建的会 addChild 到层末尾 → 同层其余界面的相对次序错乱，按账本顺序复位
      for (const layer of touched) {
        const handles = Array.from(open.values())
          .filter((e) => e.layer === layer && e.view)
          .map((e) => e.view);
        view().restack(layer, handles);
      }
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

/** 当前界面变体（全局 UIManager 的）。 */
export function getUIVariant(): UIVariant {
  return getUIManager().variant();
}

/** 改全局变体 → 按需重建受影响的界面。engine `resolutionModule` 在转屏回调里调它。 */
export function setUIVariant(patch: Partial<UIVariant>): Promise<void> {
  return getUIManager().setVariant(patch);
}

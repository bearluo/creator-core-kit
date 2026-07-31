/**
 * UI 注册表 + 层枚举 + 变体解析 —— 「一个界面长什么样、从哪来」的唯一登记处。
 *
 * 调用方只写 `open('shop')`；换皮 / 横竖屏换 view 改这里一行，多处调用点零改。
 * 对齐 oops-framework `GameUIConfig`、TEngine `[Window]` attribute。
 */

/**
 * UI 层：**自下而上，数组顺序即 z 序**。engine 启动时按本数组顺序把层容器一次建全
 * （懒建会让 z 序退化成「首次 open 的顺序」）。
 *
 * ⚠️ 这是一次性定死的东西：事后往中间插档会改变所有既有界面的相对次序，故一次给全。
 */
export const UI_LAYERS = [
  /** 背景 UI、场景装饰（夹在世界与主 UI 之间）。 */
  'back',
  /** 常驻 HUD、底部导航栏（会被主界面盖住）。 */
  'hud',
  /** 主界面。 */
  'ui',
  /** 非模态弹窗，可多开。 */
  'popup',
  /** 模态窗，不可透点。 */
  'dialog',
  /** 新手引导——必须盖住被引导的 popup/dialog。 */
  'guide',
  /** 全屏加载 / 转场遮罩——转场时连引导一起遮。 */
  'loading',
  /** 断线重连 / 强更 / 公告——盖过一切业务，含 loading。 */
  'system',
  /** 飘字 toast——不阻断，所以压在阻断类之上。 */
  'notify',
  /** 调试面板 / FPS / 开发期覆盖。 */
  'top',
] as const;

export type UILayer = (typeof UI_LAYERS)[number];

/** 主界面层。注册时不写 `layer` 即落这里。 */
export const DEFAULT_UI_LAYER: UILayer = 'ui';

export type Orientation = 'portrait' | 'landscape';

/** 界面变体：决定同一 uiId 实际取哪份资源。engine `resolutionModule` 自动灌 orientation，skin 由业务定。 */
export interface UIVariant {
  readonly orientation: Orientation;
  readonly skin: string;
}

export const DEFAULT_UI_VARIANT: UIVariant = { orientation: 'portrait', skin: 'default' };

/**
 * 一个界面的登记。`bundle` / `prefab` 给函数即为变体解析：
 * - `prefab: v => v.orientation === 'landscape' ? 'Shop_land' : 'Shop'` —— 换 view（横竖屏两套布局）
 * - `bundle: v => v.skin === 'newyear' ? 'shop-newyear' : 'shop'` —— 整包换皮
 *   （Cocos 3.x 无 Prefab Variant / AB Variant，同名 prefab 放不同 bundle 是唯一干净的整包换皮路径）
 */
export interface UIDef {
  /** 归属层，默认 `'ui'`。 */
  readonly layer?: UILayer;
  /** prefab 所在 Asset Bundle 名（省略 = 主包）。 */
  readonly bundle?: string | ((v: UIVariant) => string);
  /** prefab 路径。 */
  readonly prefab: string | ((v: UIVariant) => string);
}

/** `UIDef` 按变体解析后的实际资源坐标。 */
export interface ResolvedUI {
  readonly bundle?: string;
  readonly prefab: string;
}

const registry = new Map<string, UIDef>();

/** 登记一个界面。同 uiId 重复登记后者覆盖（开发期热重载会重跑登记代码）。 */
export function registerUI(uiId: string, def: UIDef): void {
  registry.set(uiId, def);
}

export function getUIDef(uiId: string): UIDef | undefined {
  return registry.get(uiId);
}

/** 已登记的 uiId（升序）。 */
export function listUIDefs(): string[] {
  return Array.from(registry.keys()).sort();
}

/** 清空登记（单测隔离用；正常运行期不需要）。 */
export function clearUIRegistry(): void {
  registry.clear();
}

/**
 * 纯函数：把 def 按变体解析成实际资源坐标。
 * **按需重建判定的唯一依据**——解析结果没变就不重建（转屏对普通界面零成本）。
 */
export function resolveUIDef(def: UIDef, v: UIVariant): ResolvedUI {
  return {
    prefab: typeof def.prefab === 'function' ? def.prefab(v) : def.prefab,
    bundle: typeof def.bundle === 'function' ? def.bundle(v) : def.bundle,
  };
}

/** 取 def 的归属层（未写 = `'ui'`）。 */
export function layerOfDef(def: UIDef): UILayer {
  return def.layer ?? DEFAULT_UI_LAYER;
}

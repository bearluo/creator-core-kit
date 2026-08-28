import {
  Color,
  Label,
  Layers,
  Node,
  Sprite,
  SpriteAtlas,
  SpriteFrame,
  UITransform,
  view,
  type EventTouch,
} from 'cc';
import { getAssetLoader } from '@cck/core';
import { getGameHost } from './host';

/**
 * 子游戏场景的**建场小工具** —— 每个 `kind:'game'` 模块的 View 都要的那几件事。
 *
 * 不是 UI 框架，也不给「脸」：本文件一张图、一个 prefab 都没有，只有「建个节点记得置层」
 * 「按同一套姿势加载 bundle 内的贴图」「返回按钮长什么样、按下去干什么」这种在四个游戏里
 * 一模一样的十几行。地基「只有逻辑、没有脸」说的是**美术资产**不许住这层（`login/LoginView.ts`
 * 同样 import `cc`），代码工具不在此列。
 *
 * 游戏 View 仍然只做那四件事（取组件 / 建绑定 / 转发事件 / 转发生命周期），玩法全在各自的 VM。
 */

/** 建一个子节点。**必须置 `UI_2D` 层** —— 不置就不归 kit 那台常驻 ui 相机管，画面全黑还没有日志。 */
export function gameNode(parent: Node, name: string): Node {
  const node = new Node(name);
  node.layer = Layers.Enum.UI_2D;
  parent.addChild(node);
  return node;
}

/** 建一个贴图节点。 */
export function gameSprite(
  parent: Node,
  name: string,
  frame: SpriteFrame,
  anchor: readonly [number, number],
  width: number,
  height: number,
): Node {
  const node = gameNode(parent, name);
  const sprite = node.addComponent(Sprite);
  sprite.spriteFrame = frame;
  // 顺序有讲究：`spriteFrame` 会按 sizeMode 回写 contentSize，所以先改 sizeMode 再定尺寸。
  sprite.sizeMode = Sprite.SizeMode.CUSTOM;
  const ui = node.getComponent(UITransform)!;
  ui.setAnchorPoint(anchor[0], anchor[1]);
  ui.setContentSize(width, height);
  return node;
}

/** 建一个居中文字。 */
export function gameLabel(
  parent: Node,
  name: string,
  fontSize: number,
  color: Color,
  box: readonly [number, number],
): Label {
  const node = gameNode(parent, name);
  node.addComponent(UITransform).setContentSize(box[0], box[1]);
  const text = node.addComponent(Label);
  text.fontSize = fontSize;
  text.lineHeight = fontSize + 10;
  text.color = color;
  text.horizontalAlign = Label.HorizontalAlign.CENTER;
  text.verticalAlign = Label.VerticalAlign.CENTER;
  return text;
}

/** {@link exitButton} 的可调项。位置由调用方 `node.setPosition` 自己定。 */
export interface ExitButtonOptions {
  readonly fontSize?: number;
  readonly color?: Color;
  readonly box?: readonly [number, number];
  readonly text?: string;
}

/**
 * 「← 返回大厅」按钮 —— **子游戏出去的唯一姿势**。
 *
 * 里头就一句 `getGameHost().exit()`：游戏不 import 大厅、不认识 EventBus、不知道自己是被
 * `loadScene` 切进来的还是别的什么。`propagationStopped` 是必须的 —— 不然这一下会顺着冒泡
 * 被场景根当成一次操作（在 mini-plane 里就是「点返回顺便拉升一次」）。
 */
export function exitButton(parent: Node, opts: ExitButtonOptions = {}): Label {
  const label = gameLabel(
    parent,
    'Back',
    opts.fontSize ?? 44,
    opts.color ?? new Color(120, 220, 160),
    opts.box ?? [300, 90],
  );
  label.string = opts.text ?? '← 返回大厅';
  label.node.on(Node.EventType.TOUCH_END, (e: EventTouch) => {
    e.propagationStopped = true;
    getGameHost().exit();
  });
  return label;
}

/**
 * 按 bundle 内路径批量加载贴图，**并统一登记到 `group = bundle`**：
 * 场景销毁时一句 {@link releaseGameArt} 全还掉，不必逐张记账。
 *
 * 路径约定 `art/<name>/spriteFrame` —— 每个游戏模块的贴图都放自己 bundle 的 `art/` 下。
 *
 * **`owner` 死了就返回 `undefined`**（返回类型带 `| undefined`，忘了判 `typecheck` 当场红）。
 * 加载要几百毫秒到几秒，这期间玩家可能已经退出/断线回大厅/热更重启把场景切走了：
 * - 资源的账不用这里管 —— `onDestroy` 的 {@link releaseGameArt} 已经把整组拆掉，
 *   迟到的那份由 AssetLoader 自己还给引擎（见 core `asset-manager.md` 的「迟到分支」）；
 * - 这里挡的是**在尸体上继续建节点**，以及**把「取消」当成「失败」抛出去**——
 *   bundle 已经被卸掉时那几个 `load` 会 reject，而 `async start()` 没人 catch，
 *   控制台就会多一条查起来很误导的 Uncaught (in promise)。
 * - `owner` 还活着时的失败是**真失败**，照抛不误 —— 那是该看见的错。
 */
export async function loadGameArt<T extends string>(
  owner: Node,
  bundle: string,
  names: readonly T[],
): Promise<Record<T, SpriteFrame> | undefined> {
  const assets = getAssetLoader();
  const loaded = await guardedLoad(owner, () =>
    Promise.all(
      names.map((name) =>
        assets.load<SpriteFrame>(`art/${name}/spriteFrame`, {
          bundle,
          type: 'spriteFrame',
          group: bundle,
        }),
      ),
    ),
  );
  if (!loaded) return undefined;
  const table = {} as Record<T, SpriteFrame>;
  names.forEach((name, i) => (table[name] = loaded[i]));
  return table;
}

/**
 * 同 {@link loadGameArt}，但取的是**一张图集**（`art/<name>` → `SpriteAtlas`），取消语义一模一样。
 *
 * 一张图集换掉几十上百张散图：一次加载、一个 draw call、一条释放路径。
 * 帧名就是图集里的原名（`atlas.getSpriteFrame('fish_red_run_0')`）。
 */
export async function loadGameAtlas(
  owner: Node,
  bundle: string,
  name: string,
): Promise<SpriteAtlas | undefined> {
  return guardedLoad(owner, () =>
    getAssetLoader().load<SpriteAtlas>(`art/${name}`, {
      bundle,
      type: 'spriteAtlas',
      group: bundle,
    }),
  );
}

/**
 * {@link loadGameArt} / {@link loadGameAtlas} 共用的那道守卫 —— 三条规矩收在这一处：
 * 宿主已死时的 reject 是**取消**不是失败（安静收摊，别让没人 catch 的 `async start()` 往
 * 控制台扔一条很误导的 Uncaught in promise）；宿主还活着时的失败是**真失败**，照抛；
 * 加载回来宿主才死的，返回 `undefined` 挡住「在尸体上继续建节点」。
 */
async function guardedLoad<T>(owner: Node, run: () => Promise<T>): Promise<T | undefined> {
  let value: T;
  try {
    value = await run();
  } catch (e) {
    if (owner.isValid) throw e;
    return undefined;
  }
  return owner.isValid ? value : undefined;
}

/** 还掉 {@link loadGameArt} 那一组的引用。在 `onDestroy` 里调 —— bundle 随后被大厅 release。 */
export function releaseGameArt(bundle: string): void {
  getAssetLoader().releaseGroup(bundle);
}

/** {@link fieldMetrics} 的结果：设计单位下的场地半径 + 屏幕像素的换算比例。 */
export interface FieldMetrics {
  /** 设计单位 → 屏幕像素。把它设到场地根节点的 scale 上。 */
  readonly scale: number;
  readonly halfWidth: number;
  readonly halfHeight: number;
  /** 屏幕高的一半（像素）—— HUD 贴边用，HUD 不跟着场地缩放。 */
  readonly halfScreenHeight: number;
}

/**
 * 场地按**高**定尺：屏幕高映射到 `designHeight` 个设计单位，可见宽度由屏幕宽高比反推。
 *
 * 这样竖屏铺满整屏不留黑边，而 VM 只认设计单位、完全不知道屏幕多大 —— 换分辨率不动玩法。
 * 适合「纵向是玩法主轴、横向随便多宽都行」的游戏（mini-plane 的场、mini-shooter 的天）。
 */
export function fieldByHeight(designHeight: number): FieldMetrics {
  const size = view.getVisibleSize();
  const scale = size.height / designHeight;
  return {
    scale,
    halfWidth: size.width / scale / 2,
    halfHeight: designHeight / 2,
    halfScreenHeight: size.height / 2,
  };
}

/**
 * 场地按**宽**定尺，另一头随屏幕。给横向布局定死的游戏用 —— mini-brick 的砖墙就是
 * 8×64 摆满，按高定尺的话竖屏可见宽只剩两百多，墙根本摆不下。
 */
export function fieldByWidth(designWidth: number): FieldMetrics {
  const size = view.getVisibleSize();
  const scale = size.width / designWidth;
  return {
    scale,
    halfWidth: designWidth / 2,
    halfHeight: size.height / scale / 2,
    halfScreenHeight: size.height / 2,
  };
}

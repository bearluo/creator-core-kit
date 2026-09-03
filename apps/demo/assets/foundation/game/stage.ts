import {
  Label,
  Layers,
  Node,
  Prefab,
  Sprite,
  SpriteAtlas,
  SpriteFrame,
  UITransform,
  instantiate,
  view,
  type EventTouch,
} from 'cc';
import { getAssetLoader, type AssetTypeToken } from '@cck/core';
import { getGameHost } from './host';

/**
 * 子游戏场景的**建场小工具** —— 每个 `kind:'game'` 模块的 View 都要的那几件事。
 *
 * 不是 UI 框架，也不给「脸」：本文件一张图、一个 prefab 都没有，只有「建个节点记得置层」
 * 「按同一套姿势加载 bundle 内的贴图」「界面 prefab 怎么装、返回按钮按下去干什么」这种在
 * 七个游戏里一模一样的十几行。**脸住各模块自己的 `Hud.prefab`**（见 {@link loadHud}），
 * 地基这层只有接线。地基「只有逻辑、没有脸」说的是**美术资产**不许住这层
 *（`login/LoginView.ts` 同样 import `cc`），代码工具不在此列。
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

/**
 * 装本模块的**界面层** `Hud.prefab`，挂到 `owner` 底下，返回它的根节点。
 *
 * 每个 `kind:'game'` 子游戏一张，住自己 bundle 的根上（`modules/<id>/Hud.prefab`），
 * 描述在 `apps/demo/scripts/prefab-gen/<id>-hud.prefab.json`。**字号 / 颜色 / 盒子 / 贴边全在
 * prefab 里**，代码只负责接线 —— 这就是「UI 一律走 prefab」那条仓规对子游戏这一层的兑现。
 *
 * **界面与世界的分界**：这个节点的**数量和位置是不是由 VM 每帧算出来的** —— 是就是世界
 *（鱼 / 砖 / 岩石 / 敌机 / 牌 / 关卡砖 / 炮台），归 View 按 VM 建；否就是界面
 *（读数 / 提示 / 返回 / 加减档 / 虚拟按键），归这张 prefab。
 *
 * 贴屏幕边靠 prefab 里的 `Widget`（子游戏场景根自带 `align=45` 的 Widget 拉满屏，
 * 所以挂进来就有一个跟屏幕同大的父节点），**不再由 TS 拿 `halfScreenHeight` 现算**。
 *
 * 取消语义同 {@link loadGameArt}：宿主已死返回 `undefined`，别在尸体上挂节点。
 */
export async function loadHud(owner: Node, bundle: string): Promise<Node | undefined> {
  const prefab = await loadGameAsset<Prefab>(owner, bundle, 'Hud', 'prefab');
  if (!prefab) return undefined;
  const hud = instantiate(prefab);
  owner.addChild(hud);
  return hud;
}

/**
 * 按名字取 HUD 里的一个节点（支持 `A/B` 这样的层级路径）。**取不到当场抛**。
 *
 * 抛比返回 `undefined` 重要得多：View 有几十处按名字取节点，prefab 里改个名字就静默少一个
 * 绑定 —— 界面照常显示、什么都不报，只是那个读数永远不动。`test/foundation/game/hud.test.ts`
 * 把这两边的名字对了账，这里再兜一道运行时的。
 */
export function hudNode(hud: Node, path: string): Node {
  const node = hud.getChildByPath(path);
  if (!node) throw new Error(`[game] ${hud.name}.prefab 里没有节点 '${path}'`);
  return node;
}

/** 同 {@link hudNode}，取它的 `Label`。 */
export function hudLabel(hud: Node, path: string): Label {
  const label = hudNode(hud, path).getComponent(Label);
  if (!label) throw new Error(`[game] ${hud.name}.prefab 的 '${path}' 上没有 Label`);
  return label;
}

/**
 * 把界面层**接上** —— 每个子游戏 `buildHud` 的最后一句，干两件事：
 *
 * 1. **把 HUD 提到最上层**。`loadHud` 是跟美术并行 `await` 的，回来时世界还没建；
 *    随后 `buildField` 建的背景是**后来的兄弟节点**，而 2D 渲染顺序就是子节点顺序 ⇒
 *    满屏的天空 / 海底会把整张 HUD 盖掉。表现是「世界正常、读数和返回键全没了」，
 *    不报错、不崩，只有把游戏点开才看得见（mini-plane 上实测过一次）。
 * 2. **给「← 返回大厅」接线** —— 子游戏出去的唯一姿势。里头就一句 `getGameHost().exit()`：
 *    游戏不 import 大厅、不认识 EventBus、不知道自己是被 `loadScene` 切进来的还是别的什么。
 *    `propagationStopped` 是必须的 —— 不然这一下会顺着冒泡被场景根当成一次操作
 *    （在 mini-plane 里就是「点返回顺便拉升一次」）。
 *
 * 按钮的**脸**（文案 / 字号 / 颜色 / 贴哪个角）在各自的 `Hud.prefab` 里，各游戏各画各的。
 */
export function wireHud(hud: Node, exitPath = 'Back'): void {
  const parent = hud.parent;
  if (parent) hud.setSiblingIndex(parent.children.length - 1);
  hudNode(hud, exitPath).on(Node.EventType.TOUCH_END, (e: EventTouch) => {
    e.propagationStopped = true;
    getGameHost().exit();
  });
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
 * 同 {@link loadGameArt}，但按**原样路径**取任意一种资源（effect / json / prefab …），
 * 取消语义一模一样。默认 `type:'asset'` 走通配加载 —— 同名同路径下只可能有一个资源，
 * 不指定类型就够了；真有歧义再传具体 token。
 */
export async function loadGameAsset<T>(
  owner: Node,
  bundle: string,
  path: string,
  type: AssetTypeToken = 'asset',
): Promise<T | undefined> {
  return guardedLoad(owner, () => getAssetLoader().load<T>(path, { bundle, type, group: bundle }));
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

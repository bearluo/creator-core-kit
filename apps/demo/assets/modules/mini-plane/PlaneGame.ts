import { _decorator, Color, Component, Node, Sprite, SpriteFrame, UITransform } from 'cc';
import { bindText, BindingScope } from '@cck/engine';
import { scoreboardFor } from '../../foundation/game/host';
import {
  exitButton,
  fieldByHeight,
  gameLabel,
  gameNode,
  gameSprite,
  loadGameArt,
  releaseGameArt,
} from '../../foundation/game/stage';
import { PLANE_ART, PlaneVM, ROCK_ART_HEIGHT, ROCK_HALF_WIDTH, TILE } from './PlaneVM';

const { ccclass } = _decorator;
const TAG = '[CCK-PLANE]';

/** 本模块的 bundle 名（= `modules/mini-plane` 目录名），也是这批贴图的释放组。 */
const BUNDLE = 'mini-plane';

/**
 * 贴图名 → bundle 内路径。`sky.png` 是本仓生成的纯色小图（取自 `bg.png` 的天空色）：
 * 竖屏场地比 480 高的 bg 高得多，上方拿它铺满，接缝看不出来。其余全是 Kenney 的原图。
 */
const ART = [
  'plane0',
  'plane1',
  'plane2',
  'rock-top',
  'rock-bottom',
  'bg',
  'ground',
  'tap',
  'sky',
] as const;
type ArtName = (typeof ART)[number];

const PROPELLER: readonly ArtName[] = ['plane0', 'plane1', 'plane2'];
/** 螺旋桨三帧的切换间隔。 */
const PROPELLER_FRAME_TIME = 0.06;

/**
 * 场地按**高**定尺：屏幕高映射到这么多设计单位，可见宽度由屏幕宽高比反推。
 * 竖屏铺满整屏、不留黑边，同时场地不会高到让缝显得针尖大（判据见 PlaneVM 的换算表）。
 */
const FIELD_HEIGHT = 900;

/**
 * 岩石画多宽、上下拉到哪，**出处都在 VM**（`ROCK_HALF_WIDTH` / `ROCK_ART_HEIGHT` / `vm.rockEdge`）：
 * 判定是照这张图的像素掩码做的，这里画大画小就会跟判定脱节。机身尺寸同理走 `PLANE_ART`。
 */
const ROCK_WIDTH = ROCK_HALF_WIDTH * 2;

/** 只跟画面有关的贴图尺寸（不进判定）。 */
const BG_HEIGHT = 480;
const GROUND_HEIGHT = 71;
const TAP_SIZE = 59;

/**
 * mini-plane · Kenney「Tappy Plane」的 Cocos 版（kind:'game'）—— 全屏子游戏样例。
 *
 * 美术与手感来自 Kenney 的 Construct 2 模板 `tappyplane.capx`（CC0，www.kenney.nl）。
 *
 * **这个 View 一条玩法规则都没有**：撞没撞、加不加分、岩石什么时候出，全在 {@link PlaneVM}
 * 里（零 `cc`，node 直跑，见 `test/modules/mini-plane/PlaneVM.test.ts`）。这里只做四件事 ——
 * 加载贴图建节点、每帧把 VM 的数摆成位置、把点击转给 VM、把 `update`/`onDestroy` 转给它。
 * 于是手感调参不用开 Creator，换一张脸也不用碰玩法。
 *
 * 挂在本 bundle 自带的 `Plane.scene` 上，host 经 `bundle.loadScene('Plane')` 切过来（同 mini-dodge）。
 * 场景不自带相机、不套 Canvas —— kit 的常驻相机组跨场景存活，内容在 `UI_2D` 层即可被渲染。
 * 「返回大厅」不 import 主包，走 core EventBus 发 `lobby:back`。
 */
@ccclass('PlaneGame')
export class PlaneGame extends Component {
  private vm?: PlaneVM;
  private frames?: Record<ArtName, SpriteFrame>;
  private binds?: BindingScope;

  private plane?: Node;
  private tapHint?: Node;
  private rockLayer?: Node;
  /** 岩石节点池：VM 那边一对岩石，这边一个节点（下挂上下两张图）。 */
  private readonly rockNodes: Node[] = [];
  private readonly backgrounds: Node[] = [];
  private readonly grounds: Node[] = [];

  private propellerTimer = 0;
  private propellerFrame = 0;

  async start(): Promise<void> {
    const metrics = fieldByHeight(FIELD_HEIGHT);

    this.frames = await loadGameArt(BUNDLE, ART);
    if (!this.node.isValid) return; // 加载期间被切走了

    this.vm = new PlaneVM({
      halfWidth: metrics.halfWidth,
      halfHeight: metrics.halfHeight,
      scoreboard: scoreboardFor(BUNDLE),
    });
    this.buildField(metrics.scale);
    this.buildHud(metrics.halfScreenHeight);
    this.node.on(Node.EventType.TOUCH_END, () => this.vm?.tap());
    console.log(
      `${TAG} Plane.scene 启动（场 ${(metrics.halfWidth * 2).toFixed(0)}×${FIELD_HEIGHT}，缩放 ${metrics.scale.toFixed(2)}）`,
    );
  }

  update(dt: number): void {
    const vm = this.vm;
    if (!vm) return;
    vm.step(dt);
    this.syncScenery(vm);
    this.syncRocks(vm);
    this.syncPlane(vm, dt);
  }

  onDestroy(): void {
    this.binds?.dispose();
    // 贴图随本场景走：切回大厅时连同 bundle 一起卸，这里先把这一组的引用还掉。
    releaseGameArt(BUNDLE);
  }

  // —— 建场 ————————————————————————————————————————————————

  private buildField(scale: number): void {
    const vm = this.vm!;
    const field = gameNode(this.node, 'Field');
    field.setScale(scale, scale, 1);

    // 子节点顺序 = 渲染顺序：天 → 背景 → 岩石 → 地面 → 飞机 → 提示。
    this.sprite(field, 'Sky', 'sky', [0.5, 0.5], vm.halfWidth * 2, vm.halfHeight * 2);
    for (let i = 0; i < 2; i++)
      this.backgrounds.push(this.sprite(field, `Bg${i}`, 'bg', [0, 0], TILE.background, BG_HEIGHT));
    this.rockLayer = gameNode(field, 'Rocks');
    for (let i = 0; i < 2; i++)
      this.grounds.push(this.sprite(field, `Ground${i}`, 'ground', [0, 1], TILE.ground, GROUND_HEIGHT));

    this.plane = this.sprite(field, 'Plane', 'plane0', [0.5, 0.5], PLANE_ART.width, PLANE_ART.height);
    this.tapHint = this.sprite(field, 'TapHint', 'tap', [0.5, 0.5], TAP_SIZE, TAP_SIZE);
    this.tapHint.setPosition(vm.planeX + 150, vm.y, 0);
  }

  private buildHud(halfScreenHeight: number): void {
    const vm = this.vm!;
    this.binds = new BindingScope();

    const score = gameLabel(this.node, 'Score', 96, new Color(255, 255, 255), [600, 130]);
    score.node.setPosition(0, halfScreenHeight - 160, 0);
    this.binds.add(bindText(score, () => `${vm.score.value}`));

    const hint = gameLabel(this.node, 'Hint', 52, new Color(70, 85, 95), [760, 280]);
    hint.node.setPosition(0, -180, 0);
    this.binds.add(bindText(hint, () => vm.hint.value));

    // 「返回大厅」现在走 `foundation/game` 的统一按钮：里头就一句 `getGameHost().exit()`，
    // 本文件不再认识 EventBus，也不必自己记得「别让这一下顺带被当成拉升」。
    const back = exitButton(this.node, { color: new Color(50, 105, 85) });
    back.node.setPosition(-330, halfScreenHeight - 90, 0);
  }

  // —— 每帧照抄 VM ————————————————————————————————————————

  private syncScenery(vm: PlaneVM): void {
    for (let i = 0; i < 2; i++) {
      // 两份接龙：偏移 VM 已经取过模，左边那份最多滑出一整块宽，右边那份正好补上。
      this.backgrounds[i].setPosition(
        -TILE.background / 2 - vm.backgroundScroll + i * TILE.background,
        vm.groundY,
        0,
      );
      this.grounds[i].setPosition(-TILE.ground / 2 - vm.groundScroll + i * TILE.ground, vm.groundY, 0);
    }
  }

  private syncRocks(vm: PlaneVM): void {
    const edge = vm.rockEdge;
    for (let i = 0; i < vm.rocks.length; i++) {
      const rock = vm.rocks[i];
      const node = this.rockNode(i);
      node.active = true;
      node.setPosition(rock.x, 0, 0);
      // 上下两根从缝边一路拉到场外 —— VM 判定按同一组数把世界行折算回贴图行，画面即判定。
      const [top, bottom] = [node.children[0], node.children[1]];
      top.setPosition(0, rock.gapY + vm.gapHalf, 0);
      resize(top, edge - (rock.gapY + vm.gapHalf));
      bottom.setPosition(0, rock.gapY - vm.gapHalf, 0);
      resize(bottom, rock.gapY - vm.gapHalf + edge);
    }
    for (let i = vm.rocks.length; i < this.rockNodes.length; i++) this.rockNodes[i].active = false;
  }

  private syncPlane(vm: PlaneVM, dt: number): void {
    const plane = this.plane!;
    plane.setPosition(vm.planeX, vm.y, 0);
    plane.angle = vm.angle;

    this.propellerTimer += dt;
    if (this.propellerTimer >= PROPELLER_FRAME_TIME) {
      this.propellerTimer = 0;
      this.propellerFrame = (this.propellerFrame + 1) % PROPELLER.length;
      plane.getComponent(Sprite)!.spriteFrame = this.frames![PROPELLER[this.propellerFrame]];
    }
    this.tapHint!.active = vm.phase.value === 'ready';
  }

  // —— 小工具 ————————————————————————————————————————————

  /** 取第 i 个岩石节点，不够就补一个（下挂上下两张图，锚点分别贴住缝的上下沿）。 */
  private rockNode(i: number): Node {
    const cached = this.rockNodes[i];
    if (cached) return cached;
    const node = gameNode(this.rockLayer!, `Rock${i}`);
    this.sprite(node, 'Top', 'rock-top', [0.5, 0], ROCK_WIDTH, ROCK_ART_HEIGHT);
    this.sprite(node, 'Bottom', 'rock-bottom', [0.5, 1], ROCK_WIDTH, ROCK_ART_HEIGHT);
    this.rockNodes[i] = node;
    return node;
  }

  /** 建图节点。按名取帧这一下是本模块的事，其余交给 `foundation/game` 的 {@link gameSprite}。 */
  private sprite(
    parent: Node,
    name: string,
    art: ArtName,
    anchor: readonly [number, number],
    width: number,
    height: number,
  ): Node {
    return gameSprite(parent, name, this.frames![art], anchor, width, height);
  }
}

function resize(node: Node, height: number): void {
  const ui = node.getComponent(UITransform)!;
  ui.setContentSize(ui.contentSize.width, Math.max(height, 1));
}

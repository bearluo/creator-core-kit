import {
  _decorator,
  Color,
  Component,
  Label,
  Layers,
  Node,
  Sprite,
  SpriteFrame,
  UITransform,
  view,
  type EventTouch,
} from 'cc';
import { getAssetLoader, getEventBus } from '@cck/core';
import { bindText, BindingScope } from '@cck/engine';
import { LOBBY_EVENTS, type LobbyEventMap } from '../../foundation/events';
import { PlaneVM, TILE } from './PlaneVM';

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

/** 岩石贴图 108 宽；上下两根都从缝边一直拉到场外 40。 */
const ROCK_WIDTH = 108;
const ROCK_ART_HEIGHT = 239;
const ROCK_OVERSHOOT = 40;

/** 贴图原始尺寸。 */
const BG_HEIGHT = 480;
const GROUND_HEIGHT = 71;
const PLANE_SIZE = { width: 88, height: 73 };
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
    const size = view.getVisibleSize();
    const scale = size.height / FIELD_HEIGHT;
    const halfWidth = size.width / scale / 2;

    this.frames = await this.loadArt();
    if (!this.node.isValid) return; // 加载期间被切走了

    this.vm = new PlaneVM({ halfWidth, halfHeight: FIELD_HEIGHT / 2 });
    this.buildField(scale);
    this.buildHud(size.height / 2);
    this.node.on(Node.EventType.TOUCH_END, () => this.vm?.tap());
    console.log(
      `${TAG} Plane.scene 启动（场 ${(halfWidth * 2).toFixed(0)}×${FIELD_HEIGHT}，缩放 ${scale.toFixed(2)}）`,
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
    getAssetLoader().releaseGroup(BUNDLE);
  }

  // —— 建场 ————————————————————————————————————————————————

  private async loadArt(): Promise<Record<ArtName, SpriteFrame>> {
    const assets = getAssetLoader();
    const loaded = await Promise.all(
      ART.map((name) =>
        assets.load<SpriteFrame>(`art/${name}/spriteFrame`, {
          bundle: BUNDLE,
          type: 'spriteFrame',
          group: BUNDLE,
        }),
      ),
    );
    const table = {} as Record<ArtName, SpriteFrame>;
    ART.forEach((name, i) => (table[name] = loaded[i]));
    return table;
  }

  private buildField(scale: number): void {
    const vm = this.vm!;
    const field = child(this.node, 'Field');
    field.setScale(scale, scale, 1);

    // 子节点顺序 = 渲染顺序：天 → 背景 → 岩石 → 地面 → 飞机 → 提示。
    this.sprite(field, 'Sky', 'sky', [0.5, 0.5], vm.halfWidth * 2, vm.halfHeight * 2);
    for (let i = 0; i < 2; i++)
      this.backgrounds.push(this.sprite(field, `Bg${i}`, 'bg', [0, 0], TILE.background, BG_HEIGHT));
    this.rockLayer = child(field, 'Rocks');
    for (let i = 0; i < 2; i++)
      this.grounds.push(this.sprite(field, `Ground${i}`, 'ground', [0, 1], TILE.ground, GROUND_HEIGHT));

    this.plane = this.sprite(field, 'Plane', 'plane0', [0.5, 0.5], PLANE_SIZE.width, PLANE_SIZE.height);
    this.tapHint = this.sprite(field, 'TapHint', 'tap', [0.5, 0.5], TAP_SIZE, TAP_SIZE);
    this.tapHint.setPosition(vm.planeX + 150, vm.y, 0);
  }

  private buildHud(halfScreenHeight: number): void {
    const vm = this.vm!;
    this.binds = new BindingScope();

    const score = label(this.node, 'Score', 96, new Color(255, 255, 255), [600, 130]);
    score.node.setPosition(0, halfScreenHeight - 160, 0);
    this.binds.add(bindText(score, () => `${vm.score.value}`));

    const hint = label(this.node, 'Hint', 52, new Color(70, 85, 95), [760, 280]);
    hint.node.setPosition(0, -180, 0);
    this.binds.add(bindText(hint, () => vm.hint.value));

    const back = label(this.node, 'Back', 44, new Color(50, 105, 85), [300, 90]);
    back.string = '← 返回大厅';
    back.node.setPosition(-330, halfScreenHeight - 90, 0);
    back.node.on(Node.EventType.TOUCH_END, (e: EventTouch) => {
      e.propagationStopped = true; // 别让这一下顺带被当成拉升
      console.log(`${TAG} 点返回 → emit '${LOBBY_EVENTS.back}'（不 import 主包，走 core EventBus）`);
      getEventBus<LobbyEventMap>().emit(LOBBY_EVENTS.back);
    });
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
    const edge = vm.halfHeight + ROCK_OVERSHOOT;
    for (let i = 0; i < vm.rocks.length; i++) {
      const rock = vm.rocks[i];
      const node = this.rockNode(i);
      node.active = true;
      node.setPosition(rock.x, 0, 0);
      // 上下两根从缝边一路拉到场外 —— 于是「没在缝里就是撞」这条判定跟画面对得上。
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
    const node = child(this.rockLayer!, `Rock${i}`);
    this.sprite(node, 'Top', 'rock-top', [0.5, 0], ROCK_WIDTH, ROCK_ART_HEIGHT);
    this.sprite(node, 'Bottom', 'rock-bottom', [0.5, 1], ROCK_WIDTH, ROCK_ART_HEIGHT);
    this.rockNodes[i] = node;
    return node;
  }

  private sprite(
    parent: Node,
    name: string,
    art: ArtName,
    anchor: readonly [number, number],
    width: number,
    height: number,
  ): Node {
    const node = child(parent, name);
    const sprite = node.addComponent(Sprite);
    sprite.spriteFrame = this.frames![art];
    // 顺序有讲究：`spriteFrame` 会按 sizeMode 回写 contentSize，所以先改 sizeMode 再定尺寸。
    sprite.sizeMode = Sprite.SizeMode.CUSTOM;
    const ui = node.getComponent(UITransform)!;
    ui.setAnchorPoint(anchor[0], anchor[1]);
    ui.setContentSize(width, height);
    return node;
  }
}

function child(parent: Node, name: string): Node {
  const node = new Node(name);
  node.layer = Layers.Enum.UI_2D; // 不置层就不归 kit 那台常驻 ui 相机管 → 黑屏
  parent.addChild(node);
  return node;
}

function resize(node: Node, height: number): void {
  const ui = node.getComponent(UITransform)!;
  ui.setContentSize(ui.contentSize.width, Math.max(height, 1));
}

function label(
  parent: Node,
  name: string,
  fontSize: number,
  color: Color,
  size: readonly [number, number],
): Label {
  const node = child(parent, name);
  node.addComponent(UITransform).setContentSize(size[0], size[1]);
  const text = node.addComponent(Label);
  text.fontSize = fontSize;
  text.lineHeight = fontSize + 10;
  text.color = color;
  text.horizontalAlign = Label.HorizontalAlign.CENTER;
  text.verticalAlign = Label.VerticalAlign.CENTER;
  return text;
}

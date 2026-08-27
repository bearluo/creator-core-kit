import { _decorator, Color, Component, Node, Sprite, SpriteFrame, type EventTouch } from 'cc';
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
import { ALIEN_ART, COIN_SIZE, HopVM } from './HopVM';
import { DECORS, GOAL, HAZARDS, LEVEL_WIDTH, SOLIDS, TILE_SIZE } from './level';

const { ccclass } = _decorator;
const TAG = '[CCK-HOP]';

/** 本模块的 bundle 名（= `modules/mini-hop` 目录名），也是释放组与成绩表的 key。 */
const BUNDLE = 'mini-hop';

const ART = [
  'alien-idle',
  'alien-jump',
  'alien-walk0',
  'alien-walk1',
  'barnacle',
  'brick',
  'cloud',
  'coin',
  'flag',
  'grass',
  'ground',
  'ground-top',
  'qblock',
  'sign',
] as const;
type ArtName = (typeof ART)[number];

/**
 * 场地按**高**定尺 760：关卡内容在 y ∈ [-10, 620]，760 正好把整关的高度装下还留点天。
 * 竖屏下可见宽 ≈ 427（六块砖），镜头横向跟着人走。
 */
const FIELD_HEIGHT = 760;
/** 镜头的固定高度（关卡纵向装得下，就不做纵向跟随 —— 上下晃反而看不清跳哪）。 */
const CAMERA_Y = 340;

/** 走路两帧的切换间隔。 */
const WALK_FRAME_TIME = 0.12;

/** 虚拟按键的大小与位置（屏幕像素，不随场地缩放）。 */
const PAD = { size: 170, bottom: 190, left: -340, right: -150, jump: 330 } as const;

/**
 * mini-hop · Kenney「Platformer」的 Cocos 版（kind:'game'）。
 *
 * 美术与手感来自 Kenney 的 Construct 2 模板 `platformer.capx`（CC0，www.kenney.nl）。
 *
 * **这个 View 一条玩法规则都没有** —— 重力、跳跃、撞砖、吃币全在 {@link HopVM}（零 `cc`，
 * node 直跑）。关卡也不在场景里：那 108 个手摆的实例烘成了 `level.ts`，**VM 和这里读同一份**，
 * 于是画出来的砖和判定用的砖不可能对不上。
 *
 * 原版用键盘方向键，手机上没有 —— 这里给三个虚拟键，按下去只是调 `setDir` / `jump`。
 * 「按键」这种东西 VM 一无所知，换成重力感应也不用碰玩法。
 */
@ccclass('HopGame')
export class HopGame extends Component {
  private vm?: HopVM;
  private frames!: Record<ArtName, SpriteFrame>;
  private binds?: BindingScope;

  private world?: Node;
  private alien?: Node;
  private readonly coinNodes: Node[] = [];

  private halfViewWidth = 0;
  private walkTimer = 0;
  private walkFrame = 0;

  async start(): Promise<void> {
    const metrics = fieldByHeight(FIELD_HEIGHT);
    this.halfViewWidth = metrics.halfWidth;

    const frames = await loadGameArt(this.node, BUNDLE, ART);
    if (!frames) return; // 加载期间被切走了
    this.frames = frames;

    this.vm = new HopVM({ scoreboard: scoreboardFor(BUNDLE) });
    this.buildWorld(metrics.scale);
    this.buildPad(metrics.halfScreenHeight);
    this.buildHud(metrics.halfScreenHeight);

    // 摔了 / 通关之后点空白处重来。三个虚拟键和返回键都吃掉自己的事件，不会误触发。
    this.node.on(Node.EventType.TOUCH_END, () => this.vm?.restart());
    console.log(`${TAG} Hop.scene 启动（关卡 ${LEVEL_WIDTH}×${FIELD_HEIGHT}，实心 ${SOLIDS.length} 块）`);
  }

  update(dt: number): void {
    const vm = this.vm;
    if (!vm) return;
    vm.step(dt);
    this.followCamera(vm);
    this.syncAlien(vm, dt);
    for (let i = 0; i < this.coinNodes.length; i++) this.coinNodes[i].active = !vm.coins[i].taken;
  }

  onDestroy(): void {
    this.binds?.dispose();
    releaseGameArt(BUNDLE);
  }

  // —— 建场 ————————————————————————————————————————————————

  private buildWorld(scale: number): void {
    const field = gameNode(this.node, 'Field');
    field.setScale(scale, scale, 1);
    const world = gameNode(field, 'World');
    this.world = world;

    // 顺序 = 渲染层次：云 → 装饰 → 砖 → 硬币 → 藤壶 → 人。
    for (const decor of DECORS) {
      if (decor.art !== 'cloud') continue;
      place(gameSprite(world, 'Cloud', this.frames.cloud, [0, 0], decor.w, decor.h), decor.x, decor.y);
    }
    for (const decor of DECORS) {
      if (decor.art === 'cloud') continue;
      place(
        gameSprite(world, decor.art, this.frames[decor.art as ArtName], [0, 0], decor.w, decor.h),
        decor.x,
        decor.y,
      );
    }
    for (const tile of SOLIDS) {
      place(
        gameSprite(world, tile.art, this.frames[tile.art as ArtName], [0, 0], TILE_SIZE, TILE_SIZE),
        tile.x,
        tile.y,
      );
    }
    // 终点也插一面旗 —— 不然「跑到最右边」只能靠猜（原版那面旗在出生点，是起点标记）。
    place(gameSprite(world, 'Goal', this.frames.flag, [0.5, 0], TILE_SIZE, TILE_SIZE), GOAL.x, GOAL.y);
    for (const coin of this.vm!.coins) {
      this.coinNodes.push(
        place(gameSprite(world, 'Coin', this.frames.coin, [0.5, 0.5], COIN_SIZE, COIN_SIZE), coin.x, coin.y),
      );
    }
    for (const hazard of HAZARDS) {
      place(
        gameSprite(world, 'Barnacle', this.frames.barnacle, [0.5, 0], hazard.w, hazard.h),
        hazard.x,
        hazard.y,
      );
    }
    this.alien = gameSprite(world, 'Alien', this.frames['alien-idle'], [0.5, 0], ALIEN_ART.width, ALIEN_ART.height);
  }

  /** 三个虚拟键。按住走、点一下跳 —— 都只是把输入转给 VM。 */
  private buildPad(halfScreenHeight: number): void {
    const vm = this.vm!;
    const y = -halfScreenHeight + PAD.bottom;
    this.padButton('◀', PAD.left, y, () => vm.setDir(-1), () => vm.setDir(0));
    this.padButton('▶', PAD.right, y, () => vm.setDir(1), () => vm.setDir(0));
    this.padButton('⤒', PAD.jump, y, () => vm.jump(), () => undefined);
  }

  private padButton(
    text: string,
    x: number,
    y: number,
    onDown: () => void,
    onUp: () => void,
  ): void {
    const label = gameLabel(this.node, `Pad${text}`, 92, new Color(255, 255, 255, 200), [PAD.size, PAD.size]);
    label.string = text;
    label.node.setPosition(x, y, 0);
    const stop = (e: EventTouch): void => {
      e.propagationStopped = true; // 别让按键这一下顺带被当成「点空白处重来」
    };
    label.node.on(Node.EventType.TOUCH_START, (e: EventTouch) => {
      stop(e);
      onDown();
    });
    label.node.on(Node.EventType.TOUCH_END, (e: EventTouch) => {
      stop(e);
      onUp();
    });
    // 手指滑出按键范围也算松手，否则人会一直往那个方向走。
    label.node.on(Node.EventType.TOUCH_CANCEL, (e: EventTouch) => {
      stop(e);
      onUp();
    });
  }

  private buildHud(halfScreenHeight: number): void {
    const vm = this.vm!;
    this.binds = new BindingScope();

    const score = gameLabel(this.node, 'Score', 72, new Color(255, 255, 255), [700, 110]);
    score.node.setPosition(0, halfScreenHeight - 150, 0);
    this.binds.add(bindText(score, () => `${vm.score.value} 分 · 硬币 ${vm.coinsTaken.value}/${vm.coins.length}`));

    const hint = gameLabel(this.node, 'Hint', 52, new Color(255, 250, 235), [820, 300]);
    hint.node.setPosition(0, 120, 0);
    this.binds.add(bindText(hint, () => vm.hint.value));

    const back = exitButton(this.node, { color: new Color(255, 220, 150) });
    back.node.setPosition(-330, halfScreenHeight - 90, 0);
  }

  // —— 每帧照抄 VM ————————————————————————————————————————

  /** 镜头横向跟人，夹在关卡两端之内；纵向固定（见 {@link CAMERA_Y}）。 */
  private followCamera(vm: HopVM): void {
    const min = this.halfViewWidth;
    const max = LEVEL_WIDTH - this.halfViewWidth;
    const camX = Math.min(Math.max(vm.x, min), Math.max(min, max));
    this.world!.setPosition(-camX, -CAMERA_Y, 0);
  }

  private syncAlien(vm: HopVM, dt: number): void {
    const alien = this.alien!;
    alien.setPosition(vm.x, vm.y, 0);
    alien.setScale(vm.facing, 1, 1); // 原版靠按键事件 `Set mirrored`，这里跟着实际朝向

    let art: ArtName = 'alien-idle';
    if (!vm.onGround) {
      art = 'alien-jump';
    } else if (vm.walking) {
      this.walkTimer += dt;
      if (this.walkTimer >= WALK_FRAME_TIME) {
        this.walkTimer = 0;
        this.walkFrame = 1 - this.walkFrame;
      }
      art = this.walkFrame === 0 ? 'alien-walk0' : 'alien-walk1';
    }
    alien.getComponent(Sprite)!.spriteFrame = this.frames[art];
  }
}

/** 摆到关卡坐标上（锚点在建节点时就定好了）。 */
function place(node: Node, x: number, y: number): Node {
  node.setPosition(x, y, 0);
  return node;
}

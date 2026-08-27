import { _decorator, Color, Component, Node, SpriteFrame, view, type EventTouch } from 'cc';
import { bindText, BindingScope } from '@cck/engine';
import { scoreboardFor } from '../../foundation/game/host';
import {
  exitButton,
  fieldByWidth,
  gameLabel,
  gameNode,
  gameSprite,
  loadGameArt,
  releaseGameArt,
} from '../../foundation/game/stage';
import {
  BALL_RADIUS,
  BG_TILE,
  BRICK_SIZE,
  BrickVM,
  PADDLE_SIZE,
  type Brick,
} from './BrickVM';

const { ccclass } = _decorator;
const TAG = '[CCK-BRICK]';

/** 本模块的 bundle 名（= `modules/mini-brick` 目录名），也是这批贴图的释放组、成绩表的 key。 */
const BUNDLE = 'mini-brick';

const ART = ['ball', 'bat', 'block-blue', 'block-green', 'block-red', 'block-yellow', 'bg'] as const;
type ArtName = (typeof ART)[number];

/**
 * 场地按**宽**定尺：屏幕宽映射到 800 个设计单位（= 原版宽），高由屏幕宽高比反推。
 * 砖墙是 8×64 摆死的，横向必须够宽；纵向多出来的地方正好给球飞。
 */
const FIELD_WIDTH = 800;

/**
 * mini-brick · Kenney「Paddle Ball」的 Cocos 版（kind:'game'）。
 *
 * 美术与手感来自 Kenney 的 Construct 2 模板 `paddleball.capx`（CC0，www.kenney.nl）。
 *
 * **这个 View 一条玩法规则都没有** —— 反弹、计分、清台全在 {@link BrickVM}（零 `cc`，node 直跑）。
 * 这里只做四件事：加载贴图建节点、每帧把 VM 的数摆成位置、把触摸转给 VM、把生命周期转给它。
 *
 * 跟大厅的往来只经 `foundation/game`：`scoreboardFor(BUNDLE)` 取成绩、`exitButton` 回大厅。
 * 本文件不认识大厅、不认识 EventBus。
 */
@ccclass('BrickGame')
export class BrickGame extends Component {
  private vm?: BrickVM;
  private frames!: Record<ArtName, SpriteFrame>;
  private binds?: BindingScope;

  private ball?: Node;
  private paddle?: Node;
  private readonly brickNodes: Node[] = [];

  /** 设计单位 → 屏幕像素。触摸点要按它折回场地坐标。 */
  private scale = 1;

  async start(): Promise<void> {
    const metrics = fieldByWidth(FIELD_WIDTH);
    this.scale = metrics.scale;

    const frames = await loadGameArt(this.node, BUNDLE, ART);
    if (!frames) return; // 加载期间被切走了
    this.frames = frames;

    this.vm = new BrickVM({
      halfWidth: metrics.halfWidth,
      halfHeight: metrics.halfHeight,
      scoreboard: scoreboardFor(BUNDLE),
    });
    this.buildField(metrics.scale);
    this.buildHud(metrics.halfScreenHeight);

    // 手指按住拖 = 移板；抬手 = 发球 / 重来。两件事分开，才不会「想瞄准结果先把球发了」。
    this.node.on(Node.EventType.TOUCH_START, (e: EventTouch) => this.aim(e));
    this.node.on(Node.EventType.TOUCH_MOVE, (e: EventTouch) => this.aim(e));
    this.node.on(Node.EventType.TOUCH_END, () => this.vm?.tap());
    console.log(
      `${TAG} Brick.scene 启动（场 ${FIELD_WIDTH}×${(metrics.halfHeight * 2).toFixed(0)}，${this.vm.bricks.length} 块砖）`,
    );
  }

  update(dt: number): void {
    const vm = this.vm;
    if (!vm) return;
    vm.step(dt);
    this.paddle!.setPosition(vm.paddleX, vm.paddleY, 0);
    this.ball!.setPosition(vm.ballX, vm.ballY, 0);
    for (let i = 0; i < this.brickNodes.length; i++) {
      this.brickNodes[i].active = vm.bricks[i].alive;
    }
  }

  onDestroy(): void {
    this.binds?.dispose();
    releaseGameArt(BUNDLE);
  }

  // —— 建场 ————————————————————————————————————————————————

  private buildField(scale: number): void {
    const vm = this.vm!;
    const field = gameNode(this.node, 'Field');
    field.setScale(scale, scale, 1);

    this.tileBackground(field, vm.halfWidth, vm.halfHeight);
    const wall = gameNode(field, 'Wall');
    for (const brick of vm.bricks) this.brickNodes.push(this.brickNode(wall, brick));
    this.paddle = gameSprite(field, 'Paddle', this.frames.bat, [0.5, 0.5], PADDLE_SIZE.width, PADDLE_SIZE.height);
    this.ball = gameSprite(field, 'Ball', this.frames.ball, [0.5, 0.5], BALL_RADIUS * 2, BALL_RADIUS * 2);
  }

  /**
   * 背景是 256×256 的小图，铺满整场。
   *
   * 用节点一块块铺，不用 `Sprite.Type.TILED` —— 后者要求这张图没被打进图集，而打不打图集
   * 是构建期的事，代码里看不出来；铺出来是空白还得去翻构建配置。二十来个节点换一个
   * 「构建怎么配都对」的确定结果，值。
   */
  private tileBackground(parent: Node, halfWidth: number, halfHeight: number): void {
    const layer = gameNode(parent, 'Bg');
    const cols = Math.ceil((halfWidth * 2) / BG_TILE);
    const rows = Math.ceil((halfHeight * 2) / BG_TILE);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const tile = gameSprite(layer, `Tile${r}_${c}`, this.frames.bg, [0, 0], BG_TILE, BG_TILE);
        tile.setPosition(-halfWidth + c * BG_TILE, -halfHeight + r * BG_TILE, 0);
      }
    }
  }

  private brickNode(parent: Node, brick: Brick): Node {
    const node = gameSprite(
      parent,
      `Brick${brick.x}_${brick.y}`,
      this.frames[`block-${brick.color}` as ArtName],
      [0.5, 0.5],
      BRICK_SIZE.width,
      BRICK_SIZE.height,
    );
    node.setPosition(brick.x, brick.y, 0);
    return node;
  }

  private buildHud(halfScreenHeight: number): void {
    const vm = this.vm!;
    this.binds = new BindingScope();

    const score = gameLabel(this.node, 'Score', 96, new Color(255, 255, 255), [600, 130]);
    score.node.setPosition(0, halfScreenHeight - 160, 0);
    this.binds.add(bindText(score, () => `${vm.score.value}`));

    const hint = gameLabel(this.node, 'Hint', 52, new Color(240, 240, 245), [820, 300]);
    hint.node.setPosition(0, 0, 0);
    this.binds.add(bindText(hint, () => vm.hint.value));

    const back = exitButton(this.node, { color: new Color(150, 230, 190) });
    back.node.setPosition(-330, halfScreenHeight - 90, 0);
  }

  // —— 转发触摸 ————————————————————————————————————————————

  /** 屏幕像素 → 场地设计单位。UI 坐标原点在屏幕左下，场地原点在正中。 */
  private aim(e: EventTouch): void {
    this.vm?.aim((e.getUILocation().x - view.getVisibleSize().width / 2) / this.scale);
  }
}

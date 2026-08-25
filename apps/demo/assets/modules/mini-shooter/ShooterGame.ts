import { _decorator, Color, Component, Node, Sprite, SpriteFrame, view, type EventTouch } from 'cc';
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
  BG_TILE,
  ENEMY_SIZE,
  LASER_SIZE,
  PLAYER_SIZE,
  ShooterVM,
} from './ShooterVM';

const { ccclass } = _decorator;
const TAG = '[CCK-SHOOTER]';

/** 本模块的 bundle 名（= `modules/mini-shooter` 目录名），也是释放组与成绩表的 key。 */
const BUNDLE = 'mini-shooter';

const ART = ['player', 'laser', 'enemy0', 'enemy1', 'enemy2', 'space'] as const;
type ArtName = (typeof ART)[number];

/** 三张陨石图，`Enemy.kind` 是下标。 */
const ENEMY_ART: readonly ArtName[] = ['enemy0', 'enemy1', 'enemy2'];

/** 场地按宽定尺，宽度取原版的 800。 */
const FIELD_WIDTH = 800;

/**
 * mini-shooter · Kenney「Space Shooter」的 Cocos 版（kind:'game'）。
 *
 * 美术与手感来自 Kenney 的 Construct 2 模板 `spaceshooter.capx`（CC0，www.kenney.nl）。
 *
 * **这个 View 一条玩法规则都没有** —— 打中没打中、什么时候出陨石全在 {@link ShooterVM}
 * （零 `cc`，node 直跑）。这里只做四件事：建节点、每帧摆位置、转发触摸、转发生命周期。
 *
 * 激光和陨石数量每帧都在变，用**节点池**：VM 那边一个对象，这边一个节点，多出来的藏起来
 * 而不是销毁 —— 一局里开几百发，反复建销毁是白给的 GC 压力。
 */
@ccclass('ShooterGame')
export class ShooterGame extends Component {
  private vm?: ShooterVM;
  private frames?: Record<ArtName, SpriteFrame>;
  private binds?: BindingScope;

  private player?: Node;
  private laserLayer?: Node;
  private enemyLayer?: Node;
  private readonly laserNodes: Node[] = [];
  private readonly enemyNodes: Node[] = [];

  private scale = 1;

  async start(): Promise<void> {
    const metrics = fieldByWidth(FIELD_WIDTH);
    this.scale = metrics.scale;

    this.frames = await loadGameArt(BUNDLE, ART);
    if (!this.node.isValid) return;

    this.vm = new ShooterVM({
      halfWidth: metrics.halfWidth,
      halfHeight: metrics.halfHeight,
      scoreboard: scoreboardFor(BUNDLE),
    });
    this.buildField(metrics.scale);
    this.buildHud(metrics.halfScreenHeight);

    this.node.on(Node.EventType.TOUCH_START, (e: EventTouch) => this.aim(e));
    this.node.on(Node.EventType.TOUCH_MOVE, (e: EventTouch) => this.aim(e));
    this.node.on(Node.EventType.TOUCH_END, () => this.vm?.tap());
    console.log(
      `${TAG} Shooter.scene 启动（场 ${FIELD_WIDTH}×${(metrics.halfHeight * 2).toFixed(0)}，陨石 ${this.vm.enemySpeed.toFixed(0)}px/s）`,
    );
  }

  update(dt: number): void {
    const vm = this.vm;
    if (!vm) return;
    vm.step(dt);
    this.player!.setPosition(vm.playerX, vm.playerY, 0);
    syncPool(this.laserNodes, vm.lasers.length, (i) => this.laserNode(i), (node, i) =>
      node.setPosition(vm.lasers[i].x, vm.lasers[i].y, 0),
    );
    syncPool(this.enemyNodes, vm.enemies.length, (i) => this.enemyNode(i), (node, i) => {
      const enemy = vm.enemies[i];
      node.setPosition(enemy.x, enemy.y, 0);
      // 种类是出生时定的，但节点是复用的 —— 每帧对一次图，才不会「打掉一颗、后面那颗换了张脸」。
      node.getComponent(Sprite)!.spriteFrame = this.frames![ENEMY_ART[enemy.kind]];
    });
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
    this.enemyLayer = gameNode(field, 'Enemies');
    this.laserLayer = gameNode(field, 'Lasers');
    this.player = gameSprite(field, 'Player', this.frames!.player, [0.5, 0.5], PLAYER_SIZE.width, PLAYER_SIZE.height);
  }

  /** 星空是 256×256 的小图，铺满整场（不用 `Sprite.Type.TILED`，理由同 mini-brick）。 */
  private tileBackground(parent: Node, halfWidth: number, halfHeight: number): void {
    const layer = gameNode(parent, 'Space');
    const cols = Math.ceil((halfWidth * 2) / BG_TILE);
    const rows = Math.ceil((halfHeight * 2) / BG_TILE);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const tile = gameSprite(layer, `Tile${r}_${c}`, this.frames!.space, [0, 0], BG_TILE, BG_TILE);
        tile.setPosition(-halfWidth + c * BG_TILE, -halfHeight + r * BG_TILE, 0);
      }
    }
  }

  private laserNode(i: number): Node {
    return gameSprite(this.laserLayer!, `Laser${i}`, this.frames!.laser, [0.5, 0.5], LASER_SIZE.width, LASER_SIZE.height);
  }

  private enemyNode(i: number): Node {
    return gameSprite(this.enemyLayer!, `Enemy${i}`, this.frames!.enemy0, [0.5, 0.5], ENEMY_SIZE.width, ENEMY_SIZE.height);
  }

  private buildHud(halfScreenHeight: number): void {
    const vm = this.vm!;
    this.binds = new BindingScope();

    const score = gameLabel(this.node, 'Score', 96, new Color(255, 255, 255), [600, 130]);
    score.node.setPosition(0, halfScreenHeight - 160, 0);
    this.binds.add(bindText(score, () => `${vm.score.value}`));

    const hint = gameLabel(this.node, 'Hint', 52, new Color(235, 240, 255), [820, 300]);
    this.binds.add(bindText(hint, () => vm.hint.value));

    const back = exitButton(this.node, { color: new Color(150, 200, 255) });
    back.node.setPosition(-330, halfScreenHeight - 90, 0);
  }

  private aim(e: EventTouch): void {
    this.vm?.aim((e.getUILocation().x - view.getVisibleSize().width / 2) / this.scale);
  }
}

/**
 * 节点池对表：不够就补，多出来的藏起来（不销毁）。
 *
 * `create` 只在补的时候调，`apply` 每帧对所有在用的节点调一次。
 */
function syncPool(
  pool: Node[],
  count: number,
  create: (i: number) => Node,
  apply: (node: Node, i: number) => void,
): void {
  for (let i = pool.length; i < count; i++) pool.push(create(i));
  for (let i = 0; i < pool.length; i++) {
    const node = pool[i];
    node.active = i < count;
    if (i < count) apply(node, i);
  }
}

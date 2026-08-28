import {
  _decorator,
  Color,
  Component,
  EventTouch,
  Node,
  Sprite,
  SpriteAtlas,
  SpriteFrame,
  UIOpacity,
  UITransform,
  view,
} from 'cc';
import { bindText, BindingScope } from '@cck/engine';
import { defineQuery, enterQuery, exitQuery, Position } from '@cck/ecs-bitecs';
import {
  exitButton,
  gameLabel,
  gameNode,
  loadGameArt,
  loadGameAtlas,
  releaseGameArt,
} from '../../foundation/game/stage';
import { Angle, Bullet, Fish } from './components';
import { AI_LEVEL, CANNON_SLOTS, FishVM, INITIAL_COINS } from './FishVM';
import { DEAD_FRAMES, fishKind } from './fish-kinds';
import { netRadius } from './netSystem';
import { accountWallet } from './wallet-storage';
import { FIELD } from './paths';

const { ccclass } = _decorator;
const TAG = '[CCK-FISH]';

/** 本模块的 bundle 名（= `modules/mini-fish` 目录名），也是这批资源的释放组。 */
const BUNDLE = 'mini-fish';

/** 序列帧速度（游动与死亡共用）。 */
const ART_FPS = 12;
/** 死亡动画时长：4 帧刚好放完一轮。 */
const DEATH_TIME = DEAD_FRAMES / ART_FPS;
/** 网张开到消失。逻辑上网只活一帧，这是**表现**时长。 */
const NET_TIME = 0.3;
/** 炮口火光时长（`weapon_level_<L>_1..4`）。 */
const MUZZLE_TIME = 0.16;
/** 炮台画多高（贴图 51×69 ~ 63×87，统一按这个高度画）。 */
const CANNON_HEIGHT = 96;

const fishQuery = defineQuery([Fish, Position, Angle]);
const fishEnter = enterQuery(fishQuery);
const fishExit = exitQuery(fishQuery);
const bulletQuery = defineQuery([Bullet, Position]);
const bulletEnter = enterQuery(bulletQuery);
const bulletExit = exitQuery(bulletQuery);

/** 缺帧只警告一次 —— 200 条鱼一帧刷屏两百条日志，比缺图本身还难查。 */
const warned = new Set<string>();

/** 一段放完就自毁的表现（张网 / 鱼的死亡动画）。 */
interface Effect {
  readonly node: Node;
  readonly sprite: Sprite;
  /** 序列帧前缀；`frames === 1` 时不换图（网）。 */
  readonly prefix: string;
  readonly frames: number;
  readonly total: number;
  left: number;
}

/**
 * mini-fish 的 View（`kind:'game'`）—— **一条玩法规则都没有**。
 *
 * 打不打得死、赔多少、鱼从哪来，全在 {@link FishVM} 和它下面那七个 system 里（零 `cc`、
 * node 直跑）。这里只做那四件事：加载图集建节点、每帧把 ECS 里的数摆成节点、把点击转给 VM、
 * 把 `update` / `onDestroy` 转给它。
 *
 * ## ECS → 节点那座桥
 *
 * 鱼和子弹的**生灭**不走事件，走 bitECS 的 `enterQuery` / `exitQuery` 自己 diff：
 * 实体进查询就建节点、出查询就销毁，View 不必知道它是被打死的还是游出界的。
 * 事件只播 query 看不出来的那部分 —— 开炮的火光、张网、以及「这条鱼是**死**了」
 * （退出查询分不出死和游走，而这两件事该放的动画完全不同）。
 *
 * ## 横屏
 *
 * 玩法是横屏的（决策 F）。kit 的 `resolution` 模块负责「转过来之后正确适配」，
 * **不负责强制旋转**（那是平台工程配置，不是 kit 的职责）。所以竖屏时这里盖一张提示，
 * 并且**停止 tick** —— 别让玩家在看不见的场上把钱打光。
 */
@ccclass('FishGame')
export class FishGame extends Component {
  private vm?: FishVM;
  private atlas?: SpriteAtlas;
  private binds?: BindingScope;

  private field?: Node;
  private fishLayer?: Node;
  private bulletLayer?: Node;
  private effectLayer?: Node;
  private rotateHint?: Node;

  private readonly cannonNodes: Node[] = [];
  private readonly cannonSprites: Sprite[] = [];
  /** 每门炮剩余的火光时间；> 0 时播 `_1.._4`。 */
  private readonly muzzle: number[] = [];

  private readonly fishNodes = new Map<number, Node>();
  private readonly bulletNodes = new Map<number, Node>();
  private readonly effects: Effect[] = [];

  private elapsed = 0;
  private scale = 1;

  async start(): Promise<void> {
    const [atlas, art, wallet] = await Promise.all([
      loadGameAtlas(this.node, BUNDLE, 'textures'),
      loadGameArt(this.node, BUNDLE, ['seabed'] as const),
      accountWallet(INITIAL_COINS),
    ]);
    if (!atlas || !art || !this.node.isValid) return; // 加载期间被切走了 —— 那是取消，不是失败
    this.atlas = atlas;

    this.vm = new FishVM({ wallet });
    this.build(art.seabed);
    this.layout();
    view.on('canvas-resize', this.layout, this);
    console.log(
      `${TAG} Fish.scene 启动（场 ${FIELD.width}×${FIELD.height}，图集 ${BUNDLE}/art/textures）`,
    );
  }

  update(dt: number): void {
    const vm = this.vm;
    if (!vm) return;
    if (this.rotateHint?.active) return; // 竖屏：不推进，别让玩家在看不见的场上把钱打光

    this.elapsed += dt;
    vm.tick(dt);
    this.playEvents();
    this.syncFish();
    this.syncBullets();
    this.syncCannons(dt);
    this.tickEffects(dt);
  }

  onDestroy(): void {
    view.off('canvas-resize', this.layout, this);
    this.binds?.dispose();
    // 图集随本场景走：切回大厅时连同 bundle 一起卸，这里先把这一组的引用还掉。
    releaseGameArt(BUNDLE);
  }

  // —— 建场 ————————————————————————————————————————————————

  private build(seabed: SpriteFrame): void {
    const field = gameNode(this.node, 'Field');
    this.field = field;

    // 子节点顺序 = 渲染顺序：海底 → 鱼 → 子弹 → 特效 → 炮台。
    const bg = gameNode(field, 'Seabed');
    const bgSprite = bg.addComponent(Sprite);
    bgSprite.spriteFrame = seabed;
    bgSprite.sizeMode = Sprite.SizeMode.CUSTOM;
    bg.getComponent(UITransform)!.setContentSize(FIELD.width, FIELD.height);

    this.fishLayer = gameNode(field, 'Fishes');
    this.bulletLayer = gameNode(field, 'Bullets');
    this.effectLayer = gameNode(field, 'Effects');

    const cannons = gameNode(field, 'Cannons');
    CANNON_SLOTS.forEach((slot, i) => {
      const node = gameNode(cannons, `Cannon${i}`);
      node.setPosition(slot.x, slot.y);
      const sprite = node.addComponent(Sprite);
      sprite.sizeMode = Sprite.SizeMode.CUSTOM;
      node.getComponent(UITransform)!.setContentSize(CANNON_HEIGHT * 0.74, CANNON_HEIGHT);
      this.cannonNodes.push(node);
      this.cannonSprites.push(sprite);
      this.muzzle.push(0);
    });

    this.buildHud();
    this.node.on(Node.EventType.TOUCH_END, (e: EventTouch) => this.aim(e));
  }

  private buildHud(): void {
    const vm = this.vm!;
    const hud = gameNode(this.node, 'Hud');
    this.binds = new BindingScope();

    const balance = gameLabel(hud, 'Balance', 40, new Color(255, 214, 90), [420, 60]);
    this.binds.add(bindText(balance, () => `金币 ${vm.balance.value}`));

    const level = gameLabel(hud, 'Level', 36, new Color(180, 230, 255), [300, 56]);
    this.binds.add(bindText(level, () => `炮 ${vm.level.value} 级`));

    const minus = gameLabel(hud, 'Minus', 44, new Color(210, 210, 210), [80, 60]);
    minus.string = '－';
    minus.node.on(Node.EventType.TOUCH_END, (e: EventTouch) => {
      e.propagationStopped = true;
      vm.setLevel(vm.level.value - 1);
    });

    const plus = gameLabel(hud, 'Plus', 44, new Color(210, 210, 210), [80, 60]);
    plus.string = '＋';
    plus.node.on(Node.EventType.TOUCH_END, (e: EventTouch) => {
      e.propagationStopped = true;
      vm.setLevel(vm.level.value + 1);
    });

    exitButton(hud);

    // 竖屏提示：盖住整屏（`layout` 按方向开关它）。
    const hint = gameNode(this.node, 'RotateHint');
    const cover = hint.addComponent(Sprite);
    cover.sizeMode = Sprite.SizeMode.CUSTOM;
    cover.color = new Color(6, 12, 26);
    hint.addComponent(UIOpacity).opacity = 235;
    const tip = gameLabel(hint, 'Tip', 48, new Color(230, 240, 255), [760, 280]);
    tip.string = '请把手机横过来\n\n捕鱼是横屏玩法';
    this.rotateHint = hint;
  }

  /**
   * 按当前屏幕摆位。场地用 **cover 缩放**（宽高比取较大者）：16:9 恰好铺满，更宽 / 更高的屏幕
   * 各裁掉一点边 —— 捕鱼是满屏背景的玩法，留黑边比裁掉一点边难看得多。
   * HUD 不跟着缩放，贴屏幕边走。
   */
  private layout(): void {
    const size = view.getVisibleSize();
    const portrait = size.height > size.width;

    const hint = this.rotateHint;
    if (hint) {
      hint.active = portrait;
      hint.getComponent(UITransform)!.setContentSize(size.width, size.height);
    }
    if (portrait) return;

    this.scale = Math.max(size.width / FIELD.width, size.height / FIELD.height);
    this.field?.setScale(this.scale, this.scale, 1);

    const halfW = size.width / 2;
    const halfH = size.height / 2;
    this.hudNode('Balance')?.setPosition(-halfW + 230, halfH - 50);
    this.hudNode('Back')?.setPosition(halfW - 180, halfH - 50);
    this.hudNode('Minus')?.setPosition(halfW - 400, -halfH + 60);
    this.hudNode('Level')?.setPosition(halfW - 250, -halfH + 60);
    this.hudNode('Plus')?.setPosition(halfW - 100, -halfH + 60);
  }

  private hudNode(name: string): Node | undefined {
    return this.node.getChildByName('Hud')?.getChildByName(name) ?? undefined;
  }

  // —— 每帧同步 ————————————————————————————————————————————

  /** 事件只播 query 看不出来的：开炮、张网、鱼**死了**（不是游走）。 */
  private playEvents(): void {
    for (const e of this.vm!.events) {
      if (e.type === 'fire') {
        this.muzzle[e.cannon] = MUZZLE_TIME;
        this.cannonNodes[e.cannon]?.setRotationFromEuler(0, 0, (e.angle * 180) / Math.PI - 90);
      } else if (e.type === 'hit') {
        const r = netRadius(e.level);
        this.spawnEffect(`net_${e.level}`, '', 1, NET_TIME, e.x, e.y, r * 2);
      } else {
        const kind = fishKind(e.kind);
        this.spawnEffect(`${kind.id}_dead_0`, `${kind.id}_dead_`, DEAD_FRAMES, DEATH_TIME, e.x, e.y, 0);
      }
    }
  }

  private syncFish(): void {
    const world = this.vm!.world;
    for (const eid of fishExit(world)) this.dropNode(this.fishNodes, eid);
    for (const eid of fishEnter(world)) {
      const node = gameNode(this.fishLayer!, `Fish${eid}`);
      const sprite = node.addComponent(Sprite);
      sprite.sizeMode = Sprite.SizeMode.TRIMMED;
      sprite.spriteFrame = this.frame(`${fishKind(Fish.kind[eid]).id}_run_0`);
      this.fishNodes.set(eid, node);
    }

    const step = Math.floor(this.elapsed * ART_FPS);
    for (const eid of fishQuery(world)) {
      const node = this.fishNodes.get(eid);
      if (!node) continue;
      const kind = fishKind(Fish.kind[eid]);
      node.setPosition(Position.x[eid], Position.y[eid]);
      // 鱼头朝 +x（图集实测），所以直接转到路径切线方向；朝左时**上下翻**，别让它肚皮朝天。
      const angle = Angle.v[eid];
      node.setRotationFromEuler(0, 0, (angle * 180) / Math.PI);
      node.setScale(1, Math.abs(angle) > Math.PI / 2 ? -1 : 1, 1);
      node.getComponent(Sprite)!.spriteFrame = this.frame(`${kind.id}_run_${step % kind.frames}`);
    }
  }

  private syncBullets(): void {
    const world = this.vm!.world;
    for (const eid of bulletExit(world)) this.dropNode(this.bulletNodes, eid);
    for (const eid of bulletEnter(world)) {
      const node = gameNode(this.bulletLayer!, `Bullet${eid}`);
      const sprite = node.addComponent(Sprite);
      sprite.sizeMode = Sprite.SizeMode.TRIMMED;
      sprite.spriteFrame = this.frame(`bullet${Bullet.level[eid]}`);
      this.bulletNodes.set(eid, node);
    }
    for (const eid of bulletQuery(world)) {
      this.bulletNodes.get(eid)?.setPosition(Position.x[eid], Position.y[eid]);
    }
  }

  private syncCannons(dt: number): void {
    for (let i = 0; i < this.cannonSprites.length; i++) {
      const level = i === 0 ? this.vm!.level.value : AI_LEVEL;
      this.muzzle[i] = Math.max(0, this.muzzle[i] - dt);
      // `_0` 是待机，`_1.._4` 是开火那一下。
      const done = (MUZZLE_TIME - this.muzzle[i]) / MUZZLE_TIME;
      const idx = this.muzzle[i] > 0 ? Math.min(4, 1 + Math.floor(done * 4)) : 0;
      this.cannonSprites[i].spriteFrame = this.frame(`weapon_level_${level}_${idx}`);
    }
  }

  private tickEffects(dt: number): void {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const fx = this.effects[i];
      fx.left -= dt;
      if (fx.left <= 0) {
        fx.node.destroy();
        this.effects.splice(i, 1);
        continue;
      }
      if (fx.frames > 1) {
        const done = 1 - fx.left / fx.total;
        fx.sprite.spriteFrame = this.frame(
          `${fx.prefix}${Math.min(fx.frames - 1, Math.floor(done * fx.frames))}`,
        );
      }
    }
  }

  // —— 小工具 ————————————————————————————————————————————

  /** 点屏幕 = 瞄那儿。UI 坐标原点在左下，减半屏再除以场地缩放就是场地坐标（同 mini-brick）。 */
  private aim(e: EventTouch): void {
    const size = view.getVisibleSize();
    const p = e.getUILocation();
    this.vm?.aim((p.x - size.width / 2) / this.scale, (p.y - size.height / 2) / this.scale);
  }

  /** 取图集里一帧。缺帧只警告不抛 —— 少一张图不该让整局游戏停住。 */
  private frame(name: string): SpriteFrame | null {
    const f = this.atlas?.getSpriteFrame(name) ?? null;
    if (!f && !warned.has(name)) {
      warned.add(name);
      console.warn(`${TAG} 图集里没有帧 '${name}'`);
    }
    return f;
  }

  /** `size > 0` = 按这个直径画（网）；`0` = 用贴图原尺寸（鱼的死亡帧）。 */
  private spawnEffect(
    first: string,
    prefix: string,
    frames: number,
    total: number,
    x: number,
    y: number,
    size: number,
  ): void {
    const node = gameNode(this.effectLayer!, prefix || first);
    node.setPosition(x, y);
    const sprite = node.addComponent(Sprite);
    sprite.spriteFrame = this.frame(first);
    if (size > 0) {
      sprite.sizeMode = Sprite.SizeMode.CUSTOM;
      node.getComponent(UITransform)!.setContentSize(size, size);
    } else {
      sprite.sizeMode = Sprite.SizeMode.TRIMMED;
    }
    this.effects.push({ node, sprite, prefix, frames, total, left: total });
  }

  private dropNode(table: Map<number, Node>, eid: number): void {
    const node = table.get(eid);
    if (!node) return;
    table.delete(eid);
    node.destroy();
  }
}

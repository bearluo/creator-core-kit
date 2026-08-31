import {
  _decorator,
  Camera,
  Color,
  Component,
  EventTouch,
  Layers,
  Material,
  Node,
  RenderTexture,
  Sprite,
  SpriteAtlas,
  SpriteFrame,
  Texture2D,
  UIOpacity,
  UITransform,
  Vec4,
  view,
  type EffectAsset,
} from 'cc';
import { bindText, BindingScope } from '@cck/engine';
import { defineQuery, enterQuery, exitQuery, Position, Velocity } from '@cck/ecs-bitecs';
import {
  exitButton,
  gameLabel,
  gameNode,
  loadGameArt,
  loadGameAsset,
  loadGameAtlas,
  releaseGameArt,
} from '../../foundation/game/stage';
import { Angle, Bullet, Fish } from './ecs/components';
import { reconcileNodes } from './ecs/reconcile';
import { AI_LEVEL, CANNON_SLOTS, FishVM, INITIAL_COINS } from './FishVM';
import { DEAD_FRAMES, fishKind } from './content/fish-kinds';
import { netRadius } from './ecs/netSystem';
import { accountWallet } from './seams/wallet-storage';
import { FIELD } from './content/paths';

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
/** 挨一网没死，白闪多久。 */
const HURT_TIME = 0.12;

/**
 * **水下层** —— 只有这一层进 RenderTexture、跟着水面折射。
 * 渔网 / 炮台 / HUD 留在 `UI_2D` 一点都不扭：网是玩家撒下去的，跟着水晃会让人以为自己瞄歪了。
 * bit 0 被 kit 的 `BG` 层占着，这里用 bit 1。
 */
const WATER_LAYER = 'WATER';
const WATER_BIT = 1;

/** 注册（或取回）水下层。`Layers.addLayer` 是全局注册表，重复注册会打警告，所以先查一次。 */
function waterLayerMask(): number {
  const known = (Layers.Enum as unknown as Record<string, number | undefined>)[WATER_LAYER];
  if (typeof known === 'number') return known;
  Layers.addLayer(WATER_LAYER, WATER_BIT);
  return 1 << WATER_BIT;
}

/** 整棵子树置层 —— `layer` 不继承，每个节点各记各的。 */
function sinkLayer(node: Node, layer: number): void {
  node.layer = layer;
  node.children.forEach((c) => sinkLayer(c, layer));
}

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
  /** `new Material()` / `new RenderTexture()` 不归 AssetLoader 记账，得自己销毁。 */
  private water?: Material;
  private flash?: Material;
  private waterRT?: RenderTexture;
  private waterCam?: Camera;
  private waterView?: Sprite;
  private waterFrame?: SpriteFrame;
  /** 建好就 = 水下层的 layer 值；`0` 表示 effect 没加载上，这一局不做后处理。 */
  private waterLayer = 0;
  /** 受击闪白剩余时间（eid → 秒）。 */
  private readonly hurting = new Map<number, number>();

  async start(): Promise<void> {
    const [atlas, art, water, flash, wallet] = await Promise.all([
      loadGameAtlas(this.node, BUNDLE, 'textures'),
      loadGameArt(this.node, BUNDLE, ['seabed', 'noise'] as const),
      loadGameAsset<EffectAsset>(this.node, BUNDLE, 'art/water'),
      loadGameAsset<EffectAsset>(this.node, BUNDLE, 'art/hit-flash'),
      accountWallet(INITIAL_COINS),
    ]);
    if (!atlas || !art || !this.node.isValid) return; // 加载期间被切走了 —— 那是取消，不是失败
    this.atlas = atlas;

    this.vm = new FishVM({ wallet });
    this.build(art.seabed);
    // 两样都是「有更好，没有照玩」：effect 没加载上就退回没水效、没闪白的普通画面
    if (water) this.buildWater(water, art.noise);
    if (flash) {
      this.flash = new Material();
      this.flash.initialize({ effectAsset: flash });
    }
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
    this.tickHurt(dt);
  }

  onDestroy(): void {
    view.off('canvas-resize', this.layout, this);
    this.binds?.dispose();
    this.water?.destroy();
    this.flash?.destroy();
    this.waterRT?.destroy();
    // 图集随本场景走：切回大厅时连同 bundle 一起卸，这里先把这一组的引用还掉。
    releaseGameArt(BUNDLE);
  }

  // —— 建场 ————————————————————————————————————————————————

  /**
   * 水面**后处理**：海底 / 鱼 / 子弹沉进水下层 → 一台只看这层的相机把它们画进 RenderTexture
   * → 一张全屏 quad 用 `art/water.effect` 采这张 RT，折射 + 焦散 + 气泡一次做完。
   *
   * 所以拧的是「隔着水面看到的一切」，不是某张贴图的 UV —— 鱼会跟着晃，
   * 而**渔网 / 炮台 / HUD 不进 RT，一点都不扭**。
   *
   * 噪声图**必须开 REPEAT**：波纹靠 UV 一直往外滚，clamp 的话滚出 [0,1] 之后整幅图
   * 会糊成边缘那一行像素。64×64 是 2 的幂，WebGL1 也吃得下这个 wrap。
   */
  private buildWater(effect: EffectAsset, noise: SpriteFrame): void {
    const size = view.getVisibleSize();
    const layer = waterLayerMask();
    this.waterLayer = layer;
    const field = this.field!;
    // 只沉海底和鱼。**子弹不进水** —— 折射是个空间上变化的位移场，一条直线穿过去就
    // 不再是直线；鱼大且慢只表现为微微变形，子弹细长又每帧走很远，整条轨迹会被拧成
    // 抖动的波浪，还跟不扭的炮口对不上。跟渔网同一条理由：玩家射出去的东西不许晃。
    sinkLayer(field.getChildByName('Seabed')!, layer);
    sinkLayer(this.fishLayer!, layer);

    const rt = new RenderTexture();
    rt.reset({ width: Math.round(size.width), height: Math.round(size.height) });
    this.waterRT = rt;

    const camNode = gameNode(this.node, 'WaterCamera');
    camNode.setPosition(0, 0, 1000);
    const cam = camNode.addComponent(Camera);
    cam.projection = Camera.ProjectionType.ORTHO;
    cam.orthoHeight = size.height / 2;
    cam.near = 1;
    cam.far = 2000;
    cam.visibility = layer;
    cam.clearFlags = Camera.ClearFlag.SOLID_COLOR;
    cam.clearColor = new Color(0, 0, 0, 255);
    cam.priority = 100; // 必须小于 kit 那台 ui 相机（200）：RT 得先画完，采它的人才画得对
    cam.targetTexture = rt;
    this.waterCam = cam;

    const tex = noise.texture as Texture2D;
    tex.setWrapMode(Texture2D.WrapMode.REPEAT, Texture2D.WrapMode.REPEAT);
    const mat = new Material();
    mat.initialize({ effectAsset: effect });
    mat.setProperty('noiseMap', tex);
    // 气泡按场地宽高比换算成正方形坐标，否则宽屏上会被拉成椭圆
    mat.setProperty('bubbleParams', new Vec4(22, FIELD.width / FIELD.height, 1, 0.3));
    this.water = mat;

    const viewNode = gameNode(this.node, 'WaterView');
    const sprite = viewNode.addComponent(Sprite);
    const frame = new SpriteFrame();
    frame.texture = rt;
    sprite.customMaterial = mat;
    sprite.spriteFrame = frame;
    sprite.sizeMode = Sprite.SizeMode.CUSTOM;
    viewNode.setSiblingIndex(0); // 压在 Field 底下 —— 网 / 炮台画在水面之上
    this.waterView = sprite;
    this.waterFrame = frame;
  }

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
      // 贴图炮口朝 +y，所以上半场那两门待机时先转过来朝下；开过火之后由 `fire` 事件接管朝向。
      if (slot.y > 0) node.setRotationFromEuler(0, 0, 180);
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
    // 竖屏不推进玩法，那张全屏 RT 也别白画
    if (this.waterCam) this.waterCam.enabled = !portrait;
    if (portrait) return;
    this.layoutWater(size.width, size.height);

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

  /** 屏幕变了：RT 跟着改尺寸，相机的正交高度和水面 quad 一起对齐过去。 */
  private layoutWater(width: number, height: number): void {
    const rt = this.waterRT;
    const frame = this.waterFrame;
    const sprite = this.waterView;
    if (!rt || !frame || !sprite) return;
    const w = Math.round(width);
    const h = Math.round(height);
    if (rt.width !== w || rt.height !== h) {
      rt.resize(w, h);
      // resize 之后 SpriteFrame 的 uv 是按旧尺寸算的，重挂一次让它重算
      frame.texture = rt;
      sprite.spriteFrame = frame;
    }
    this.waterCam!.orthoHeight = h / 2;
    sprite.node.getComponent(UITransform)!.setContentSize(w, h);
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
        this.spawnEffect(`net_${e.level}`, '', 1, NET_TIME, e.x, e.y, r * 2, 0);
      } else if (e.type === 'hurt') {
        // 罩住了没打死 —— 闪一下白。鱼还活着，节点一定已经建好了
        const node = this.fishNodes.get(e.eid);
        if (node && this.flash) {
          node.getComponent(Sprite)!.customMaterial = this.flash;
          this.hurting.set(e.eid, HURT_TIME);
        }
      } else {
        const kind = fishKind(e.kind);
        this.spawnEffect(
          `${kind.id}_dead_0`,
          `${kind.id}_dead_`,
          DEAD_FRAMES,
          DEATH_TIME,
          e.x,
          e.y,
          0,
          e.angle,
        );
      }
    }
  }

  private syncFish(): void {
    const world = this.vm!.world;
    const alive = fishQuery(world);
    // 别照着 entered/exited 直接做 —— 两个数组读不出交错顺序，见 `ecs/reconcile.ts`
    const diff = reconcileNodes(alive, fishEnter(world), fishExit(world));
    for (const eid of diff.drop) this.dropNode(this.fishNodes, eid);
    for (const eid of diff.create) {
      this.dropNode(this.fishNodes, eid); // eid 可能是回收重用的，先拆掉上一位租客
      const node = gameNode(this.fishLayer!, `Fish${eid}`);
      if (this.waterLayer) node.layer = this.waterLayer; // 新生的鱼也得沉到水下层
      const sprite = node.addComponent(Sprite);
      sprite.sizeMode = Sprite.SizeMode.TRIMMED;
      sprite.spriteFrame = this.frame(`${fishKind(Fish.kind[eid]).id}_run_0`);
      this.fishNodes.set(eid, node);
    }

    const step = Math.floor(this.elapsed * ART_FPS);
    for (const eid of alive) {
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
    const alive = bulletQuery(world);
    const diff = reconcileNodes(alive, bulletEnter(world), bulletExit(world));
    for (const eid of diff.drop) this.dropNode(this.bulletNodes, eid);
    for (const eid of diff.create) {
      this.dropNode(this.bulletNodes, eid);
      const node = gameNode(this.bulletLayer!, `Bullet${eid}`);
      const sprite = node.addComponent(Sprite);
      sprite.sizeMode = Sprite.SizeMode.TRIMMED;
      sprite.spriteFrame = this.frame(`bullet${Bullet.level[eid]}`);
      this.bulletNodes.set(eid, node);
    }
    for (const eid of alive) {
      const node = this.bulletNodes.get(eid);
      if (!node) continue;
      node.setPosition(Position.x[eid], Position.y[eid]);
      // 子弹贴图头朝 +y（跟炮台一样），所以转到速度方向要减 90°。
      // 速度是匀速直线的，方向一辈子不变——但每帧算一次比记一份状态便宜。
      node.setRotationFromEuler(
        0,
        0,
        (Math.atan2(Velocity.y[eid], Velocity.x[eid]) * 180) / Math.PI - 90,
      );
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

  /**
   * `size > 0` = 按这个直径画（网）；`0` = 用贴图原尺寸（鱼的死亡帧）。
   * `angle` 是弧度（网传 0）—— 死亡帧得**接着活鱼那一套朝向**演（转到切线 + 朝左时上下翻），
   * 否则鱼一断气就「唰」地摆正头朝右。
   */
  private spawnEffect(
    first: string,
    prefix: string,
    frames: number,
    total: number,
    x: number,
    y: number,
    size: number,
    angle: number,
  ): void {
    const node = gameNode(this.effectLayer!, prefix || first);
    node.setPosition(x, y);
    if (angle !== 0) {
      node.setRotationFromEuler(0, 0, (angle * 180) / Math.PI);
      node.setScale(1, Math.abs(angle) > Math.PI / 2 ? -1 : 1, 1);
    }
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

  /** 闪白到点了换回内置材质。鱼死了 / eid 换了租客都只是查不到节点，删掉记账即可。 */
  private tickHurt(dt: number): void {
    for (const [eid, left] of this.hurting) {
      const next = left - dt;
      if (next > 0) {
        this.hurting.set(eid, next);
        continue;
      }
      this.hurting.delete(eid);
      const node = this.fishNodes.get(eid);
      if (node?.isValid) node.getComponent(Sprite)!.customMaterial = null;
    }
  }

  private dropNode(table: Map<number, Node>, eid: number): void {
    const node = table.get(eid);
    if (!node) return;
    table.delete(eid);
    node.destroy();
  }
}

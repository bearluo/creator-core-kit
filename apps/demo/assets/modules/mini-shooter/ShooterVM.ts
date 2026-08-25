import { computed, signal } from '@cck/core';
import type { ReadSignal, Signal } from '@cck/core';
import { memoryScoreboard, type GameScoreboard } from '../../foundation/game/scoreboard';

/**
 * mini-shooter 的全部玩法 —— **零 `cc` 依赖**，node 里直跑（`test/modules/mini-shooter/ShooterVM.test.ts`）。
 *
 * 来自 Kenney 的 Construct 2 模板 `spaceshooter.capx`（CC0，www.kenney.nl）。原版事件表六条：
 * 飞船跟鼠标 X、激光每 tick 上移 10、敌人每 tick 下移 3、点一下在船身左右 ±35 各生成一发激光、
 * 每 2 秒在随机 x 处生成一个敌人（三张图随机一张）、激光撞敌人双双销毁、飞船撞敌人 restart layout。
 *
 * 三处换算：
 *
 * 1. **坐标系** —— C2 左上角原点 / +Y 向下 → Cocos 中心原点 / +Y 向上。
 * 2. **时间基** —— 「每 tick」隐含 60fps → 全换成每秒量，`step(dt)` 与帧率无关。
 * 3. **速度跟着场高走** —— 原版 800×480 横屏，demo 竖屏场地高得多。照搬 180px/s 的话敌人
 *    要飘八秒才落地。所以敌人速度定义成「**穿过整个场要几秒**」（原版 ≈3.4 秒），激光速度
 *    按原版 600:180 的比例跟着走。生成间隔仍是 2 秒 —— 穿场时间不变，密度也就不变。
 *
 * 原版不计分；这里补了（成绩要交给大厅，见 {@link GameScoreboard}），其余一比一。
 *
 * **判定是收紧的矩形，不是像素级** —— 飞船和陨石都接近实心矩形，掩码那套（mini-plane 干过）
 * 在这里换不来手感差别。收紧的那一下是给玩家的：擦着边过去不算死。
 */

/** 飞船贴图 99×75。 */
export const PLAYER_SIZE = { width: 99, height: 75 } as const;
/** 激光贴图 9×54。 */
export const LASER_SIZE = { width: 9, height: 54 } as const;
/** 三张陨石贴图里最大的那张（104×84）——判定统一按它算，画面各画各的。 */
export const ENEMY_SIZE = { width: 104, height: 84 } as const;
/** 陨石图有三张，`Enemy.kind` 是下标。 */
export const ENEMY_KINDS = 3;
/** 星空背景平铺尺寸（256×256）。只跟画面有关。 */
export const BG_TILE = 256;

/** 双发激光相对船心的横向偏移（原版 ±35）。 */
export const MUZZLE_OFFSET = 35;

/** 判定用的收紧系数：飞船只算中间那 55%，陨石算 80%。两边都偏玩家。 */
const PLAYER_HIT_SCALE = 0.55;
const ENEMY_HIT_SCALE = 0.8;

/** 敌人穿过整个场（含上下出生 / 出屏余量）要几秒。原版 (480+50+84)/180 ≈ 3.4。 */
const ENEMY_CROSS_SECONDS = 3.4;
/** 激光比敌人快多少倍（原版 600 / 180）。 */
const LASER_SPEED_RATIO = 600 / 180;
/** 出敌人的间隔（秒）。原版就是 2。 */
const SPAWN_INTERVAL = 2;
/** 飞船离场底多高（原版 480-384=96，按场高的比例给）。 */
const PLAYER_BOTTOM_RATIO = 0.2;

/** 单帧最大步长 —— 卡一下不该让敌人瞬移穿过飞船。 */
const MAX_STEP = 1 / 30;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** 打着 → 撞毁（点一下重开）。原版没有「等开始」那一段，进来就打。 */
export type ShooterPhase = 'playing' | 'dead';

/** 一发激光。 */
export interface Laser {
  x: number;
  y: number;
}

/** 一颗陨石。`kind` 决定画哪张图，不影响判定。 */
export interface Enemy {
  x: number;
  y: number;
  readonly kind: number;
}

export interface ShooterVMOptions {
  /** 可见半场宽（设计单位）。缺省即原版的 400。 */
  halfWidth?: number;
  /** 半场高（设计单位）。 */
  halfHeight?: number;
  /** 随机源。注进来是为了测试能给定序列 —— 出生位置与陨石种类是本游戏仅有的随机量。 */
  rand?: () => number;
  /** 成绩去哪 —— 运行期是 `scoreboardFor('mini-shooter')`，单测给内存的那份。 */
  scoreboard?: GameScoreboard;
}

export class ShooterVM {
  readonly halfWidth: number;
  readonly halfHeight: number;
  /** 飞船的 y。它只左右动。 */
  readonly playerY: number;
  /** 陨石下落速度（px/s，正数）。 */
  readonly enemySpeed: number;
  /** 激光上升速度（px/s，正数）。 */
  readonly laserSpeed: number;

  readonly phase: Signal<ShooterPhase> = signal<ShooterPhase>('playing');
  /** 本局分数：打掉一颗陨石 +1。 */
  readonly score: Signal<number> = signal(0);
  readonly best: Signal<number>;
  readonly newRecord: Signal<boolean> = signal(false);

  readonly hint: ReadSignal<string> = computed(() =>
    this.phase.value === 'dead'
      ? `被撞毁了\n本局 ${this.score.value} · 最好 ${this.best.value}${this.newRecord.value ? ' · 新纪录！' : ''}\n点击重来`
      : '',
  );

  /** 船心 x。每帧都可能变，故意不走 signal。 */
  playerX = 0;
  /** 场上的激光 / 陨石。View 按它们建 / 复用节点。 */
  readonly lasers: Laser[] = [];
  readonly enemies: Enemy[] = [];

  private readonly rand: () => number;
  private readonly scoreboard: GameScoreboard;
  /** 出生 / 出屏的纵向余量：一整个陨石高，保证是「从屏外飘进来」。 */
  private readonly margin: number;
  private spawnTimer = 0;

  constructor(options: ShooterVMOptions = {}) {
    this.halfWidth = options.halfWidth ?? 400;
    this.halfHeight = options.halfHeight ?? 240;
    this.rand = options.rand ?? Math.random;
    this.scoreboard = options.scoreboard ?? memoryScoreboard();
    this.best = signal(this.scoreboard.best());

    this.playerY = -this.halfHeight + this.halfHeight * 2 * PLAYER_BOTTOM_RATIO;
    this.margin = ENEMY_SIZE.height;
    this.enemySpeed = (this.halfHeight * 2 + this.margin * 2) / ENEMY_CROSS_SECONDS;
    this.laserSpeed = this.enemySpeed * LASER_SPEED_RATIO;
  }

  /** 飞船跟手指：夹在场内。 */
  aim(x: number): void {
    const limit = this.halfWidth - PLAYER_SIZE.width / 2;
    this.playerX = clamp(x, -limit, limit);
  }

  /** 点一下：开两炮 / 重开。 */
  tap(): void {
    if (this.phase.value === 'dead') {
      this.restart();
      return;
    }
    // 原版就是船身左右各生一发，没有冷却。点得快就打得密 —— 这是它的手感，别加节流。
    this.lasers.push({ x: this.playerX - MUZZLE_OFFSET, y: this.playerY });
    this.lasers.push({ x: this.playerX + MUZZLE_OFFSET, y: this.playerY });
  }

  /** 推进 `dt` 秒。撞毁后只有 `tap()` 能让它再动。 */
  step(dt: number): void {
    if (this.phase.value === 'dead') return;
    const t = clamp(dt, 0, MAX_STEP);

    this.moveLasers(t);
    this.moveEnemies(t);
    this.spawn(t);
    this.resolveHits();
  }

  // —— 内部 ————————————————————————————————————————————————

  /** 激光上升；飞出场顶就删（原版的 `Is outside layout → Destroy`）。 */
  private moveLasers(t: number): void {
    const top = this.halfHeight + LASER_SIZE.height;
    for (let i = this.lasers.length - 1; i >= 0; i--) {
      const laser = this.lasers[i];
      laser.y += this.laserSpeed * t;
      if (laser.y > top) this.lasers.splice(i, 1);
    }
  }

  /** 陨石下落；掉出场底就删（原版没删，靠 restart 清场；不删的话数组只涨不落）。 */
  private moveEnemies(t: number): void {
    const bottom = -this.halfHeight - this.margin;
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const enemy = this.enemies[i];
      enemy.y -= this.enemySpeed * t;
      if (enemy.y < bottom) this.enemies.splice(i, 1);
    }
  }

  private spawn(t: number): void {
    this.spawnTimer += t;
    if (this.spawnTimer < SPAWN_INTERVAL) return;
    this.spawnTimer -= SPAWN_INTERVAL;
    const usable = this.halfWidth - ENEMY_SIZE.width / 2;
    this.enemies.push({
      x: (this.rand() * 2 - 1) * usable,
      y: this.halfHeight + this.margin,
      kind: Math.min(ENEMY_KINDS - 1, Math.floor(this.rand() * ENEMY_KINDS)),
    });
  }

  /** 激光打中陨石 → 双双消失 +1 分；陨石撞上飞船 → 结束。 */
  private resolveHits(): void {
    for (let e = this.enemies.length - 1; e >= 0; e--) {
      const enemy = this.enemies[e];
      let hit = false;
      for (let l = this.lasers.length - 1; l >= 0; l--) {
        const laser = this.lasers[l];
        if (!overlaps(laser.x, laser.y, LASER_SIZE, 1, enemy.x, enemy.y, ENEMY_SIZE, ENEMY_HIT_SCALE)) {
          continue;
        }
        this.lasers.splice(l, 1);
        hit = true;
        break;
      }
      if (hit) {
        this.enemies.splice(e, 1);
        this.score.value += 1;
        continue;
      }
      if (
        overlaps(
          this.playerX,
          this.playerY,
          PLAYER_SIZE,
          PLAYER_HIT_SCALE,
          enemy.x,
          enemy.y,
          ENEMY_SIZE,
          ENEMY_HIT_SCALE,
        )
      ) {
        this.phase.value = 'dead';
        this.newRecord.value = this.scoreboard.submit(this.score.value);
        this.best.value = this.scoreboard.best();
        return;
      }
    }
  }

  private restart(): void {
    this.phase.value = 'playing';
    this.score.value = 0;
    this.newRecord.value = false;
    this.lasers.length = 0;
    this.enemies.length = 0;
    this.spawnTimer = 0;
  }
}

/** 两个轴对齐矩形是否相交，各自按 `scale` 收紧。 */
function overlaps(
  ax: number,
  ay: number,
  a: { readonly width: number; readonly height: number },
  aScale: number,
  bx: number,
  by: number,
  b: { readonly width: number; readonly height: number },
  bScale: number,
): boolean {
  return (
    Math.abs(ax - bx) < (a.width * aScale + b.width * bScale) / 2 &&
    Math.abs(ay - by) < (a.height * aScale + b.height * bScale) / 2
  );
}

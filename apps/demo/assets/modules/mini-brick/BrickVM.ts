import { computed, signal } from '@cck/core';
import type { ReadSignal, Signal } from '@cck/core';
import { memoryScoreboard, type GameScoreboard } from '../../foundation/game/scoreboard';

/**
 * mini-brick 的全部玩法 —— **零 `cc` 依赖**，node 里直跑（`test/modules/mini-brick/BrickVM.test.ts`）。
 *
 * 来自 Kenney 的 Construct 2 模板 `paddleball.capx`（CC0，www.kenney.nl）。原版事件表只有四条：
 * 板跟鼠标 X、球撞到砖就销毁砖、点一下把球设成速度 500 / 角度 90（C2 的 90° 是**向下**）、
 * 球的 Y 超过屏底就 restart layout。反弹是 C2 `Bullet` 行为的 `bounce off solids`（板、砖、
 * 三面墙都挂了 `Solid`）。
 *
 * 照搬到本 demo 有三处必须改，都记在这里：
 *
 * | 原版 | 这里 | 为什么 |
 * |---|---|---|
 * | 800×480 横屏 | **按宽定尺**：半场宽固定 400（= 原版），场高由屏幕宽高比反推 | demo 是竖屏。按高定尺的话可见宽只剩 270，8×64 的砖墙根本摆不下 |
 * | 开球角度 90°（向下） | 向上开球 | 原版球生在半空、板在下方，向下开正好被接住；这里球贴在板上，向下开等于立刻掉出去 |
 * | 纯镜面反弹 | 出射角挂在**击球点偏移**上（±60°） | 镜面反弹 + 平板 = 球永远在一条竖直线上来回，那是「模板」不是游戏 |
 *
 * 速度 640 而不是原版的 500：竖屏场地比 480 高了近三倍，同样的速度像在爬。
 *
 * 原版不计分、也没有「清台」；这里补了两者（成绩要交给大厅，见 {@link GameScoreboard}），其余一比一。
 *
 * View 只读不写：每帧取 `ballX / ballY / paddleX / bricks` 摆位置，`phase / score / best` 走 signal 绑文本。
 */

/** 砖贴图 64×32。四色四行，颜色只是行号的映射，不影响判定。 */
export const BRICK_SIZE = { width: 64, height: 32 } as const;

/** 板贴图 104×24。 */
export const PADDLE_SIZE = { width: 104, height: 24 } as const;

/** 球贴图 22×22 → 半径 11。判定按**正方形**近似（见 {@link BrickVM.overlaps}）。 */
export const BALL_RADIUS = 11;

/** 背景图平铺尺寸（256×256）。只跟画面有关。 */
export const BG_TILE = 256;

/** 四行砖的颜色，**从上到下** —— 原版 C2 里 y 越小越靠上，蓝色那行在最上面。 */
export const BRICK_COLORS = ['blue', 'green', 'yellow', 'red'] as const;
export type BrickColor = (typeof BRICK_COLORS)[number];

/** 8 列 × 4 行，跟原版一样。列整体居中（原版 x 176…624，正中就是 400）。 */
const COLUMNS = 8;
const ROWS = BRICK_COLORS.length;

/** 球速（px/s）。见类注释的换算表。 */
const BALL_SPEED = 640;
/** 击球点在板边缘时的最大出射偏角（度）。0 = 正上方。 */
const MAX_BOUNCE_DEG = 60;
/** 砖墙顶距天花板 / 板底距场底。纯布局。 */
const WALL_TOP_GAP = 60;
const PADDLE_BOTTOM_GAP = 90;

/** 单帧最大步长 —— 卡一下不该让球瞬移穿过整面墙。 */
const MAX_STEP = 1 / 30;
const DEG_TO_RAD = Math.PI / 180;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** 等发球 → 打着 → 球掉了 / 清台（都点一下继续）。 */
export type BrickPhase = 'ready' | 'playing' | 'dead' | 'clear';

/** 一块砖。位置在建墙时定死，之后只有 `alive` 会变。 */
export interface Brick {
  readonly x: number;
  readonly y: number;
  readonly color: BrickColor;
  alive: boolean;
}

export interface BrickVMOptions {
  /** 可见半场宽（设计单位）。缺省即原版的 400。 */
  halfWidth?: number;
  /** 半场高（设计单位）。View 按屏幕宽高比算，缺省给一个能跑测试的方场。 */
  halfHeight?: number;
  /** 成绩去哪 —— 运行期是 `scoreboardFor('mini-brick')`，单测给内存的那份。 */
  scoreboard?: GameScoreboard;
}

export class BrickVM {
  readonly halfWidth: number;
  readonly halfHeight: number;
  /** 板的 y（板心）。板只左右动。 */
  readonly paddleY: number;

  readonly phase: Signal<BrickPhase> = signal<BrickPhase>('ready');
  /** 本局分数：敲掉一块砖 +1。 */
  readonly score: Signal<number> = signal(0);
  /** 历史最好成绩。开局从记分板读，结算时回写。 */
  readonly best: Signal<number>;
  /** 上一局破了纪录 —— 只影响提示文本。 */
  readonly newRecord: Signal<boolean> = signal(false);

  readonly hint: ReadSignal<string> = computed(() => {
    const tail = `本局 ${this.score.value} · 最好 ${this.best.value}${this.newRecord.value ? ' · 新纪录！' : ''}`;
    switch (this.phase.value) {
      case 'ready':
        return '点击发球';
      case 'clear':
        return `清台！\n${tail}\n点击开下一面`;
      case 'dead':
        return `球掉了\n${tail}\n点击重来`;
      default:
        return '';
    }
  });

  /** 板心 x。每帧都可能变，故意不走 signal —— 逐帧写 signal 只是白白通知一圈。 */
  paddleX = 0;
  ballX = 0;
  ballY = 0;
  ballVX = 0;
  ballVY = 0;

  /** 整面墙。View 按它建 / 复用节点，`alive` 为假就藏起来。 */
  readonly bricks: Brick[] = [];

  private readonly scoreboard: GameScoreboard;

  constructor(options: BrickVMOptions = {}) {
    this.halfWidth = options.halfWidth ?? 400;
    this.halfHeight = options.halfHeight ?? 400;
    this.scoreboard = options.scoreboard ?? memoryScoreboard();
    this.best = signal(this.scoreboard.best());
    this.paddleY = -this.halfHeight + PADDLE_BOTTOM_GAP;
    this.buildWall();
    this.stickBall();
  }

  /** 还剩几块砖。 */
  get bricksLeft(): number {
    return this.bricks.reduce((n, b) => n + (b.alive ? 1 : 0), 0);
  }

  /** 板跟手指：夹在场内（原版是 `BoundToLayout`）。 */
  aim(x: number): void {
    const limit = this.halfWidth - PADDLE_SIZE.width / 2;
    this.paddleX = clamp(x, -limit, limit);
  }

  /** 点一下：发球 / 重来 / 开下一面。 */
  tap(): void {
    switch (this.phase.value) {
      case 'ready':
        this.serve();
        break;
      case 'dead':
        this.score.value = 0;
        this.newRecord.value = false;
        this.buildWall();
        this.stickBall();
        this.phase.value = 'ready';
        break;
      case 'clear':
        // 分数留着 —— 一面接一面打下去，成绩才是「打了多少砖」而不是「这一面打了几块」。
        this.newRecord.value = false;
        this.buildWall();
        this.stickBall();
        this.phase.value = 'ready';
        break;
      default:
        break;
    }
  }

  /** 推进 `dt` 秒。非 `playing` 时球贴着板走，其余什么都不发生。 */
  step(dt: number): void {
    if (this.phase.value !== 'playing') {
      if (this.phase.value === 'ready') this.stickBall();
      return;
    }
    const t = clamp(dt, 0, MAX_STEP);
    // 子步：一步走的距离不超过一个球半径。砖只有 32 高，一帧 640px/s 的球在 1/30 秒里能走
    // 21px —— 不切子步就会有「明明打中了却穿过去」的帧，而那种 bug 只在低帧率时偶发。
    const distance = Math.hypot(this.ballVX, this.ballVY) * t;
    const steps = Math.max(1, Math.ceil(distance / BALL_RADIUS));
    const h = t / steps;
    for (let i = 0; i < steps && this.phase.value === 'playing'; i++) this.advance(h);
  }

  // —— 内部 ————————————————————————————————————————————————

  /** 一个子步：走一段 → 依次判墙 / 板 / 砖 / 掉底。 */
  private advance(h: number): void {
    this.ballX += this.ballVX * h;
    this.ballY += this.ballVY * h;

    // 三面墙（原版是三个 `solid` 对象：左、右、顶）。位置钳回边界再翻速度方向，
    // 不是简单取反 —— 取反会在球已经嵌进墙里时来回抖。
    const limitX = this.halfWidth - BALL_RADIUS;
    if (this.ballX < -limitX) {
      this.ballX = -limitX;
      this.ballVX = Math.abs(this.ballVX);
    } else if (this.ballX > limitX) {
      this.ballX = limitX;
      this.ballVX = -Math.abs(this.ballVX);
    }
    const limitY = this.halfHeight - BALL_RADIUS;
    if (this.ballY > limitY) {
      this.ballY = limitY;
      this.ballVY = -Math.abs(this.ballVY);
    }

    if (this.ballVY < 0 && this.overlaps(this.paddleX, this.paddleY, PADDLE_SIZE.width, PADDLE_SIZE.height)) {
      this.bounceOffPaddle();
    }
    this.hitBrick();

    // 原版是「Y 超过窗口高 → restart layout」。这里补一个 dead 阶段，好把成绩交出去。
    if (this.ballY < -this.halfHeight - BALL_RADIUS) this.finish('dead');
  }

  /**
   * 球 vs 矩形。球按**正方形**近似 —— 差别只在四个角那几个像素，而这套美术里球本来就是
   * 一个圆滑的小方块；换成真圆要在角上算距离，多的那点精度换不来手感变化。
   */
  private overlaps(x: number, y: number, width: number, height: number): boolean {
    return (
      Math.abs(this.ballX - x) < width / 2 + BALL_RADIUS &&
      Math.abs(this.ballY - y) < height / 2 + BALL_RADIUS
    );
  }

  /** 板反弹：出射角由击球点偏移定（见类注释）。速度大小恒定。 */
  private bounceOffPaddle(): void {
    const offset = clamp(
      (this.ballX - this.paddleX) / (PADDLE_SIZE.width / 2 + BALL_RADIUS),
      -1,
      1,
    );
    const angle = offset * MAX_BOUNCE_DEG * DEG_TO_RAD;
    this.ballVX = BALL_SPEED * Math.sin(angle);
    this.ballVY = BALL_SPEED * Math.cos(angle);
    // 推到板面上方：不推的话下一子步可能还在重叠区里，会连着反弹两次（球就粘在板上了）。
    this.ballY = this.paddleY + PADDLE_SIZE.height / 2 + BALL_RADIUS;
  }

  /** 撞砖：销毁 + 计分 + 按**穿透较浅的那个轴**反弹。一个子步最多敲一块。 */
  private hitBrick(): void {
    for (const brick of this.bricks) {
      if (!brick.alive) continue;
      if (!this.overlaps(brick.x, brick.y, BRICK_SIZE.width, BRICK_SIZE.height)) continue;
      const overlapX = BRICK_SIZE.width / 2 + BALL_RADIUS - Math.abs(this.ballX - brick.x);
      const overlapY = BRICK_SIZE.height / 2 + BALL_RADIUS - Math.abs(this.ballY - brick.y);
      if (overlapX < overlapY) {
        this.ballVX = -this.ballVX;
        this.ballX += Math.sign(this.ballX - brick.x) * overlapX;
      } else {
        this.ballVY = -this.ballVY;
        this.ballY += Math.sign(this.ballY - brick.y) * overlapY;
      }
      brick.alive = false;
      this.score.value += 1;
      if (this.bricksLeft === 0) this.finish('clear');
      return;
    }
  }

  /** 一局结束：交成绩、记下破没破纪录。 */
  private finish(phase: 'dead' | 'clear'): void {
    this.phase.value = phase;
    this.newRecord.value = this.scoreboard.submit(this.score.value);
    this.best.value = this.scoreboard.best();
  }

  /** 发球：从板上向**正上方**弹出（原版是向下 —— 见类注释）。 */
  private serve(): void {
    this.phase.value = 'playing';
    this.ballVX = 0;
    this.ballVY = BALL_SPEED;
  }

  /** 未发球时球贴在板中央上沿，跟着板走。 */
  private stickBall(): void {
    this.ballX = this.paddleX;
    this.ballY = this.paddleY + PADDLE_SIZE.height / 2 + BALL_RADIUS;
    this.ballVX = 0;
    this.ballVY = 0;
  }

  /** 建整面墙（就地重建，View 拿到的还是同一个数组）。 */
  private buildWall(): void {
    this.bricks.length = 0;
    for (let row = 0; row < ROWS; row++) {
      const y = this.halfHeight - WALL_TOP_GAP - (row + 0.5) * BRICK_SIZE.height;
      for (let col = 0; col < COLUMNS; col++) {
        this.bricks.push({
          x: (col - (COLUMNS - 1) / 2) * BRICK_SIZE.width,
          y,
          color: BRICK_COLORS[row],
          alive: true,
        });
      }
    }
  }
}

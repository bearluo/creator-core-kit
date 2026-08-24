import { signal, computed } from '@cck/core';
import type { ReadSignal, Signal } from '@cck/core';

/**
 * mini-plane 的全部玩法 —— **零 `cc` 依赖**，node 里直跑（`test/modules/mini-plane/PlaneVM.test.ts`）。
 *
 * 手感直接来自 Kenney 的 Construct 2 模板 `tappyplane.capx`（CC0，www.kenney.nl）的事件表，
 * 做了三处换算：
 *
 * 1. **坐标系** —— C2 左上角原点 / +Y 向下 → Cocos 中心原点 / +Y 向上。
 * 2. **时间基** —— C2 是「每 tick」、隐含 60fps → 全部换成每秒量，`step(dt)` 与帧率无关。
 * 3. **场地尺寸跟着屏幕** —— 原版是 800×480 横屏，demo 是竖屏。照搬绝对数值会两头不讨好：
 *    定死 480 高就缩成屏幕中间一条，铺满整屏又让 141 的缝掉进 1600 高的场里（比原版难四倍）。
 *    所以**场地由 View 按屏幕给一组 `halfWidth / halfHeight`，其余全部按原版的比例推导**：
 *
 *    | 量 | 推导 | 代回原版 (400, 240) |
 *    |---|---|---|
 *    | 机身 x     | `-0.68 × halfWidth`              | -272 |
 *    | 地面上沿   | `-halfHeight + 60`               | -180 |
 *    | 缝的净空   | `0.336 × 天花板到地面`           | 141 |
 *    | 缝的抖动   | `±0.25 × halfHeight`             | ±60 |
 *    | 出生 x     | `halfWidth + 岩石半宽`           | 454（原版 530，略靠外） |
 *    | 出岩石间隔 | `1.2 个屏宽 ÷ 卷动速度`          | 2 秒 |
 *
 *    重力 / 抬升 / 卷动速度**不缩放** —— 它们决定手感，缩放了就不是这个游戏了。
 *
 * 原版撞上就 restart layout、也不计分；这里补了 `dead` 阶段与计分，其余一比一。
 *
 * View 只读不写：每帧取 `y / angle / rocks / *Scroll` 摆位置，`phase / score / best` 走 signal 绑文本。
 */

/** 岩石贴图宽 108。高度不进判定 —— 上下两根一直顶到场边（View 拉伸贴图），只有缝是通的。 */
export const ROCK_HALF_WIDTH = 54;

/** 地面带的高度：`groundY` 到场底。 */
const GROUND_HEIGHT = 60;

/** 飞机贴图 88×73；判定盒按 0.7 收紧一圈，贴边过缝才不憋屈。 */
const PLANE_HALF = { width: (88 * 0.7) / 2, height: (73 * 0.7) / 2 };

/** 机身 x 占半场宽的比例（原版 -272 / 400）。 */
const PLANE_X_RATIO = -0.68;
/** 缝的净空占「天花板到地面」的比例（原版 141 / 420）。 */
const GAP_RATIO = 141 / 420;
/** 缝隙中心的抖动幅度占 `halfHeight` 的比例（原版 60 / 240）。 */
const GAP_JITTER_RATIO = 0.25;
/** 相邻两对岩石相距几个屏宽（原版 960 / 800）。 */
const ROCK_SPACING_SCREENS = 1.2;

/** 每秒量 = 原版每帧量 × 60（重力是 × 60²）。这一组是手感，不随屏幕缩放。 */
const SCROLL_SPEED = 480;
const BG_SCROLL_SPEED = 240;
const GRAVITY = 1080;
const JUMP_SPEED = 420;

/** 背景图与地面图的平铺宽度（View 摆两份接龙，VM 只管把偏移取模）。 */
export const TILE = { background: 800, ground: 808 } as const;

/** 单帧最大步长 —— 卡一下不该让飞机瞬移穿过岩石。 */
const MAX_STEP = 1 / 30;

/** 等首次点击 → 飞行中 → 坠毁（点一下重开）。 */
export type PlanePhase = 'ready' | 'playing' | 'dead';

/** 一对岩石（上下同 x、共用一条缝）。 */
export interface RockPair {
  /** 岩石对中心 x。 */
  x: number;
  /** 缝隙中心 y：通的那段是 `gapY ± gapHalf`，上下都顶到场边。 */
  gapY: number;
  /** 已飞过、已计分。 */
  passed: boolean;
}

export interface PlaneVMOptions {
  /** 可见半场宽（设计单位）。View 按屏幕宽高比算，缺省即原版的 400。 */
  halfWidth?: number;
  /** 半场高（设计单位）。缺省即原版的 240。 */
  halfHeight?: number;
  /** 随机源。注进来是为了测试能给定序列 —— 缝隙高度是本游戏唯一的随机量。 */
  rand?: () => number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export class PlaneVM {
  /** 可见半场宽：出屏 / 出生都以它为界。 */
  readonly halfWidth: number;
  /** 半场高：天花板 `+halfHeight`，场底 `-halfHeight`。 */
  readonly halfHeight: number;
  /** 地面上沿 —— 掉到这条线以下即坠机。 */
  readonly groundY: number;
  /** 飞机固定的 x —— 它只上下动，世界向左卷。 */
  readonly planeX: number;
  /** 缝隙净空的一半。 */
  readonly gapHalf: number;

  /** 阶段。变的时候 View 换提示文本。 */
  readonly phase: Signal<PlanePhase> = signal<PlanePhase>('ready');

  /** 本局分数：飞过一对岩石 +1。 */
  readonly score: Signal<number> = signal(0);

  /** 本次会话最好成绩 —— 只活在内存里，bundle 一卸就清零（没接存档服务，属样例的边界）。 */
  readonly best: Signal<number> = signal(0);

  /** 给 UI 的提示文本。 */
  readonly hint: ReadSignal<string> = computed(() => {
    switch (this.phase.value) {
      case 'ready':
        return '点击起飞';
      case 'dead':
        return `坠毁了\n本局 ${this.score.value} · 最好 ${this.best.value}\n点击重来`;
      default:
        return '';
    }
  });

  /** 机身 y。每帧都变，故意不走 signal —— 逐帧写 signal 只是白白通知一圈。 */
  y: number;

  /** 竖直速度（px/s，+ 为上升）。 */
  vy = 0;

  /** 场上的岩石对，从左到右。View 按它建 / 复用节点。 */
  readonly rocks: RockPair[] = [];

  /** 地面与背景的横向卷动偏移（已取模到一个平铺宽度内，恒为正）。 */
  groundScroll = 0;
  backgroundScroll = 0;

  private readonly rand: () => number;
  private readonly gapBaseY: number;
  private readonly gapJitter: number;
  private readonly spawnX: number;
  private readonly spawnInterval: number;
  private spawnTimer = 0;

  constructor(options: PlaneVMOptions = {}) {
    this.halfWidth = options.halfWidth ?? 400;
    this.halfHeight = options.halfHeight ?? 240;
    this.rand = options.rand ?? Math.random;

    this.groundY = -this.halfHeight + GROUND_HEIGHT;
    this.planeX = this.halfWidth * PLANE_X_RATIO;
    this.gapHalf = ((this.halfHeight - this.groundY) * GAP_RATIO) / 2;
    this.spawnX = this.halfWidth + ROCK_HALF_WIDTH;
    this.spawnInterval = (this.halfWidth * 2 * ROCK_SPACING_SCREENS) / SCROLL_SPEED;
    // 缝的基准取「天花板与地面的正中」，抖动按场高取比例。
    this.gapBaseY = (this.halfHeight + this.groundY) / 2;
    this.gapJitter = this.halfHeight * GAP_JITTER_RATIO;
    this.y = this.gapBaseY;
  }

  /** 机身角度（度，+ 为抬头）—— 原版 `angle = gravity * 2`，同样只是速度的线性映射。 */
  get angle(): number {
    return clamp(this.vy / 30, -75, 25);
  }

  /** 点一下：起飞 / 拉升 / 重开。 */
  tap(): void {
    if (this.phase.value === 'dead') {
      this.restart();
      return;
    }
    this.phase.value = 'playing';
    this.vy = JUMP_SPEED;
  }

  /** 推进 `dt` 秒。坠毁后只有 `tap()` 能让它再动。 */
  step(dt: number): void {
    if (this.phase.value === 'dead') return;
    const t = clamp(dt, 0, MAX_STEP);

    // 卷动一直在跑（`ready` 阶段也是），原版就这样：世界先动起来，飞机等你点。
    this.backgroundScroll = (this.backgroundScroll + BG_SCROLL_SPEED * t) % TILE.background;
    this.groundScroll = (this.groundScroll + SCROLL_SPEED * t) % TILE.ground;
    if (this.phase.value !== 'playing') return;

    this.vy -= GRAVITY * t;
    this.y = Math.min(this.y + this.vy * t, this.halfHeight);

    this.spawnTimer += t;
    if (this.spawnTimer >= this.spawnInterval) {
      this.spawnTimer -= this.spawnInterval;
      // 原版是 random(-60) + random(60)：两个均匀分布相加 = 三角分布，缝更爱待在中间。
      this.rocks.push({
        x: this.spawnX,
        gapY: this.gapBaseY + (this.rand() - this.rand()) * this.gapJitter,
        passed: false,
      });
    }

    for (const rock of this.rocks) {
      rock.x -= SCROLL_SPEED * t;
      if (!rock.passed && rock.x < this.planeX) {
        rock.passed = true;
        this.score.value += 1;
      }
    }
    // 出屏的删掉。倒着删，正着删会跳过元素。
    for (let i = this.rocks.length - 1; i >= 0; i--)
      if (this.rocks[i].x < -this.halfWidth - ROCK_HALF_WIDTH) this.rocks.splice(i, 1);

    if (this.crashed()) {
      this.phase.value = 'dead';
      this.best.value = Math.max(this.best.value, this.score.value);
    }
  }

  /** 重开一局：清场、回起点，回到等点击。最好成绩留着。 */
  restart(): void {
    this.rocks.length = 0;
    this.spawnTimer = 0;
    this.y = this.gapBaseY;
    this.vy = 0;
    this.score.value = 0;
    this.phase.value = 'ready';
  }

  /** 撞地或撞岩石。岩石上下顶到场边，所以「没在缝里」就是撞。 */
  private crashed(): boolean {
    if (this.y - PLANE_HALF.height <= this.groundY) return true;
    for (const rock of this.rocks) {
      if (Math.abs(rock.x - this.planeX) >= ROCK_HALF_WIDTH + PLANE_HALF.width) continue;
      if (
        this.y + PLANE_HALF.height > rock.gapY + this.gapHalf ||
        this.y - PLANE_HALF.height < rock.gapY - this.gapHalf
      )
        return true;
    }
    return false;
  }
}

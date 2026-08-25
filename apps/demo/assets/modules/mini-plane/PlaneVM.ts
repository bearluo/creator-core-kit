import { signal, computed } from '@cck/core';
import type { ReadSignal, Signal } from '@cck/core';
import { memoryScoreboard, type GameScoreboard } from '../../foundation/game/scoreboard';
import { PLANE_MASK, ROCK_BOTTOM_MASK, ROCK_TOP_MASK, type CollisionMask } from './collision-masks';

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
 * **判定是像素级的**，见 {@link PlaneVM.crashed}。原版和多数 flappy 类一样拿收紧的矩形近似，
 * 那在这套美术上错得很明显：岩石是根**锥子**，尖端只有 8px 宽，矩形却按 108 全宽算 ——
 * 贴着缝边擦过去时，整个机身宽度都落在假判定里。
 *
 * View 只读不写：每帧取 `y / angle / rocks / *Scroll` 摆位置，`phase / score / best` 走 signal 绑文本。
 */

/** 岩石贴图宽 108 → 半宽 54。真实轮廓远比这窄，这个数只在宽相里当包围盒用。 */
export const ROCK_HALF_WIDTH = ROCK_TOP_MASK.width / 2;

/** 岩石贴图高。上下两根都是这张图纵向拉伸到位的，判定采样要按拉伸倍率折算回来。 */
export const ROCK_ART_HEIGHT = ROCK_TOP_MASK.height;

/** 岩石从缝边一路拉到场外多少 —— 拉伸倍率由它定，所以它是**玩法几何**，View 从这里取。 */
export const ROCK_OVERSHOOT = 40;

/** 地面带的高度：`groundY` 到场底。 */
const GROUND_HEIGHT = 60;

/**
 * 机身贴图尺寸。View 必须照这个尺寸画 —— 掩码是按原图逐像素烘的，画大画小判定就跟画面脱节，
 * 所以尺寸的唯一出处在这里（`ROCK_HALF_WIDTH` / `ROCK_ART_HEIGHT` 同理）。
 */
export const PLANE_ART = { width: PLANE_MASK.width, height: PLANE_MASK.height } as const;

/** 机身贴图的一半。判定用掩码逐像素，这里只做宽相包围盒，故不再收紧。 */
const PLANE_HALF = { width: PLANE_ART.width / 2, height: PLANE_ART.height / 2 };

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

const DEG_TO_RAD = Math.PI / 180;

/** 等首次点击 → 飞行中 → 坠毁（点一下重开）。 */
export type PlanePhase = 'ready' | 'playing' | 'dead';

/** 一对岩石（上下同 x、共用一条缝）。 */
export interface RockPair {
  /** 岩石对中心 x。 */
  x: number;
  /** 缝隙中心 y：通的那段是 `gapY ± gapHalf`，上下两根各自从缝边拉到场外 `ROCK_OVERSHOOT`。 */
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
  /** 成绩去哪 —— 运行期是 `scoreboardFor('mini-plane')`，单测给内存的那份。 */
  scoreboard?: GameScoreboard;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * 掩码采样。`x` 左→右、`y` **上→下**（贴图行序，跟 PNG 一致）。越界即空 ——
 * 岩石拉伸后世界行可能落到贴图之外，靠这个边界检查兜住，调用方不用另判。
 */
function maskAt(mask: CollisionMask, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) return false;
  return ((mask.bits[y * mask.stride + (x >>> 5)] >>> (x & 31)) & 1) !== 0;
}

export class PlaneVM {
  /** 可见半场宽：出屏 / 出生都以它为界。 */
  readonly halfWidth: number;
  /** 半场高：天花板 `+halfHeight`，场底 `-halfHeight`。 */
  readonly halfHeight: number;
  /** 地面上沿 —— 机身像素碰到这条线即坠机。 */
  readonly groundY: number;
  /** 飞机固定的 x —— 它只上下动，世界向左卷。 */
  readonly planeX: number;
  /** 缝隙净空的一半。 */
  readonly gapHalf: number;
  /** 岩石外沿：上下两根分别拉到 `±rockEdge`。View 照它画，判定照它折算拉伸倍率。 */
  readonly rockEdge: number;

  /** 阶段。变的时候 View 换提示文本。 */
  readonly phase: Signal<PlanePhase> = signal<PlanePhase>('ready');

  /** 本局分数：飞过一对岩石 +1。 */
  readonly score: Signal<number> = signal(0);

  /** 历史最好成绩。开局从记分板读，坠毁时回写 —— 落不落盘由注进来的那份决定。 */
  readonly best: Signal<number>;

  /** 上一局破了纪录 —— 只影响提示文本。 */
  readonly newRecord: Signal<boolean> = signal(false);

  /** 给 UI 的提示文本。 */
  readonly hint: ReadSignal<string> = computed(() => {
    switch (this.phase.value) {
      case 'ready':
        return '点击起飞';
      case 'dead':
        return `坠毁了\n本局 ${this.score.value} · 最好 ${this.best.value}${this.newRecord.value ? ' · 新纪录！' : ''}\n点击重来`;
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
  private readonly scoreboard: GameScoreboard;
  private readonly gapBaseY: number;
  private readonly gapJitter: number;
  private readonly spawnX: number;
  private readonly spawnInterval: number;
  private spawnTimer = 0;

  constructor(options: PlaneVMOptions = {}) {
    this.halfWidth = options.halfWidth ?? 400;
    this.halfHeight = options.halfHeight ?? 240;
    this.rand = options.rand ?? Math.random;
    this.scoreboard = options.scoreboard ?? memoryScoreboard();
    this.best = signal(this.scoreboard.best());

    this.groundY = -this.halfHeight + GROUND_HEIGHT;
    this.planeX = this.halfWidth * PLANE_X_RATIO;
    this.gapHalf = ((this.halfHeight - this.groundY) * GAP_RATIO) / 2;
    this.spawnX = this.halfWidth + ROCK_HALF_WIDTH;
    this.spawnInterval = (this.halfWidth * 2 * ROCK_SPACING_SCREENS) / SCROLL_SPEED;
    this.rockEdge = this.halfHeight + ROCK_OVERSHOOT;
    // 缝的基准取「天花板与地面的正中」，抖动按场高取比例。
    this.gapBaseY = (this.halfHeight + this.groundY) / 2;
    this.gapJitter = this.halfHeight * GAP_JITTER_RATIO;
    this.y = this.gapBaseY;
  }

  /** 机身角度（度，逆时针为正）—— 原版 `angle = gravity * 2`，同样只是速度的线性映射。 */
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
      // 交给记分板：破没破纪录由它说了算，最好成绩也从它读回来（运行期那份会落盘）。
      this.newRecord.value = this.scoreboard.submit(this.score.value);
      this.best.value = this.scoreboard.best();
    }
  }

  /** 重开一局：清场、回起点，回到等点击。最好成绩留着。 */
  restart(): void {
    this.rocks.length = 0;
    this.spawnTimer = 0;
    this.y = this.gapBaseY;
    this.vy = 0;
    this.score.value = 0;
    this.newRecord.value = false;
    this.phase.value = 'ready';
  }

  /**
   * 撞地或撞岩石 —— **像素级**：两张贴图的 alpha 掩码（构建期烘的，见 `collision-masks.ts`）
   * 真有实心像素叠在一起才算撞。
   *
   * 三层，一层比一层贵，前一层过不了就不进后一层：
   *
   * 1. **宽相** —— 机身贴图四角按当前角度旋转后的世界包围盒，跟地面 / 岩石列快速排除；
   * 2. **扫描行** —— 世界每整数行只算一次「这行落在上根还是下根、对应贴图第几行」。
   *    岩石纵向被拉伸（倍率随缝高变），这一步把世界行折算回贴图行；
   * 3. **逐像素** —— 先查岩石（轴对齐，一次位测试），命中了再把该点逆旋转进机身局部坐标查机身。
   *
   * 逐像素而不是位图行对齐 `AND`：机身会转（±75°），转过之后两张图的像素栅格不再平行，
   * 整字 `AND` 就不成立了。逆变换采样换来的是**任意角度都精确**，且不必按角度预烘多份掩码。
   *
   * 采样落在整数世界坐标上（1 设计单位 = 1 贴图像素，美术就是按这个比例摆的），所以精度是
   * 1 像素而非无限精度，亚像素级的擦碰可能判过。这跟「帧间离散」一样，是可接受的近似。
   */
  private crashed(): boolean {
    const rad = this.angle * DEG_TO_RAD;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    // 旋转后的包围盒半径 —— 宽相宁可放大不可放小。
    const ex = Math.abs(cos) * PLANE_HALF.width + Math.abs(sin) * PLANE_HALF.height;
    const ey = Math.abs(sin) * PLANE_HALF.width + Math.abs(cos) * PLANE_HALF.height;
    const minX = this.planeX - ex;
    const maxX = this.planeX + ex;
    const minY = this.y - ey;
    const maxY = this.y + ey;

    if (minY <= this.groundY && this.hitsGround(cos, sin, minX, maxX, minY)) return true;
    for (const rock of this.rocks) {
      if (rock.x + ROCK_HALF_WIDTH <= minX || rock.x - ROCK_HALF_WIDTH >= maxX) continue;
      if (this.hitsRock(rock, cos, sin, minX, maxX, minY, maxY)) return true;
    }
    return false;
  }

  /** 机身有没有实心像素低到地面上沿以下。只在包围盒够得着地面时才会被调到。 */
  private hitsGround(cos: number, sin: number, minX: number, maxX: number, minY: number): boolean {
    for (let wy = Math.floor(minY); wy <= this.groundY; wy++)
      for (let wx = Math.floor(minX); wx <= maxX; wx++)
        if (this.planeSolidAt(wx, wy, cos, sin)) return true;
    return false;
  }

  /** 机身有没有实心像素压在这对岩石的实心像素上。 */
  private hitsRock(
    rock: RockPair,
    cos: number,
    sin: number,
    minX: number,
    maxX: number,
    minY: number,
    maxY: number,
  ): boolean {
    const edge = this.rockEdge;
    const gapTop = rock.gapY + this.gapHalf;
    const gapBot = rock.gapY - this.gapHalf;
    const topH = edge - gapTop;
    const botH = gapBot + edge;
    const x0 = Math.floor(Math.max(minX, rock.x - ROCK_HALF_WIDTH));
    const x1 = Math.min(maxX, rock.x + ROCK_HALF_WIDTH);

    for (let wy = Math.floor(minY); wy <= maxY; wy++) {
      // 世界行 → 贴图行。上根锚在缝上沿往上拉、下根锚在缝下沿往下拉，各按各的倍率折算。
      let mask: CollisionMask;
      let row: number;
      if (wy >= gapTop) {
        if (topH <= 0) continue;
        mask = ROCK_TOP_MASK;
        row = ((edge - wy) / topH) * ROCK_ART_HEIGHT;
      } else if (wy <= gapBot) {
        if (botH <= 0) continue;
        mask = ROCK_BOTTOM_MASK;
        row = ((gapBot - wy) / botH) * ROCK_ART_HEIGHT;
      } else continue; // 这一行整行都在缝里，没有岩石
      const r = Math.floor(row);
      for (let wx = x0; wx <= x1; wx++) {
        if (!maskAt(mask, Math.floor(wx - rock.x + ROCK_HALF_WIDTH), r)) continue;
        if (this.planeSolidAt(wx, wy, cos, sin)) return true;
      }
    }
    return false;
  }

  /** 世界点是不是落在机身的实心像素上：逆旋转进机身局部，再换成贴图行列采样。 */
  private planeSolidAt(wx: number, wy: number, cos: number, sin: number): boolean {
    const dx = wx - this.planeX;
    const dy = wy - this.y;
    const lx = dx * cos + dy * sin;
    const ly = -dx * sin + dy * cos;
    // 局部 +Y 向上、贴图行 +Y 向下，故行号是减出来的。
    return maskAt(PLANE_MASK, Math.floor(lx + PLANE_HALF.width), Math.floor(PLANE_HALF.height - ly));
  }
}

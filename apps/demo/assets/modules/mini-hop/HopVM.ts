import { computed, signal } from '@cck/core';
import type { ReadSignal, Signal } from '@cck/core';
import { memoryScoreboard, type GameScoreboard } from '../../foundation/game/scoreboard';
import {
  COINS,
  GOAL,
  HAZARDS,
  LEVEL_WIDTH,
  SOLIDS,
  SPAWN,
  TILE_SIZE,
  type LevelTile,
} from './level';

/**
 * mini-hop 的全部玩法 —— **零 `cc` 依赖**，node 里直跑（`test/modules/mini-hop/HopVM.test.ts`）。
 *
 * 来自 Kenney 的 Construct 2 模板 `platformer.capx`（CC0，www.kenney.nl）。原版的玩法**不在
 * 事件表里** —— 事件表只管翻转朝向和切动画，真正的移动/跳跃/踩地是 C2 内置的 `Platform`
 * 行为，参数写在 alien 那个实例上：
 *
 * | 参数 | 值 |
 * |---|---|
 * | 最大速度 | 330 px/s |
 * | 加速 / 减速 | 1500 px/s² |
 * | 跳跃初速 | 650 px/s |
 * | 重力 | 1500 px/s² |
 * | 最大下落速度 | 1000 px/s |
 *
 * 这里把那套行为**照参数重写**成三十来行（分轴推进 + 轴对齐推出），于是它变成可测的纯逻辑。
 * 关卡那 108 个手摆的实例烘成了 {@link ./level}（`scripts/gen-hop-level.mjs`），VM 与单测读同一份。
 *
 * 三处不是原版的，都是原版缺的：
 *
 * - **计分** —— 原版碰到硬币只是销毁，没有分。这里 `硬币 ×10 + 通关 50`，好交给大厅。
 * - **终点** —— 原版那面旗插在出生点旁边、没绑事件。这里以关卡尽头那堵墙为终点。
 * - **控制** —— 原版是键盘方向键。手机上没有键盘，改成 {@link HopVM.setDir} / {@link HopVM.jump}
 *   两个纯输入口，具体是虚拟按钮还是别的由 View 决定（VM 不认识「按钮」这种东西）。
 *
 * 判定盒比贴图**窄**（50 对 66）：alien 的图两边是空的，按图宽算会卡在 70 宽的缝里过不去。
 */

/** 判定盒。脚在 `y`，盒子从脚往上长。比贴图窄，见类注释。 */
export const BODY = { width: 50, height: 88 } as const;
/** 贴图尺寸（View 照这个画）。 */
export const ALIEN_ART = { width: 66, height: 92 } as const;
/** 硬币判定直径。 */
export const COIN_SIZE = 44;

/** 一枚硬币 +10 分，通关 +50。原版不计分，见类注释。 */
const COIN_SCORE = 10;
const GOAL_SCORE = 50;

/** C2 `Platform` 行为的原参数，一个没改。 */
const MAX_SPEED = 330;
const ACCELERATION = 1500;
const DECELERATION = 1500;
const JUMP_SPEED = 650;
const GRAVITY = 1500;
const MAX_FALL_SPEED = 1000;

/** 掉到这条线以下就算摔死（关卡最低的地面在 y=-10）。 */
const PIT_Y = -200;

/** 单帧最大步长。330/1000 的速度在 1/30 秒里最多走 33px，不到一块砖，不会穿。 */
const MAX_STEP = 1 / 30;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** 跑着 → 摔死 / 通关（都点一下重来）。 */
export type HopPhase = 'playing' | 'dead' | 'won';

/** 场上的一枚硬币。位置来自关卡数据，`taken` 是本局的状态。 */
export interface Coin {
  readonly x: number;
  readonly y: number;
  taken: boolean;
}

export interface HopVMOptions {
  /** 成绩去哪 —— 运行期是 `scoreboardFor('mini-hop')`，单测给内存的那份。 */
  scoreboard?: GameScoreboard;
}

export class HopVM {
  /** 脚下 x（身体中线）。 */
  x = SPAWN.x;
  /** 脚下 y。 */
  y = SPAWN.y;
  vx = 0;
  vy = 0;
  /** 脚踩在实心上。跳跃只在为真时生效（原版 `Platform` 也不给二段跳）。 */
  onGround = true;
  /** 朝向：1 向右、-1 向左。原版靠按键事件翻转，这里跟着实际移动方向。 */
  facing: 1 | -1 = 1;

  readonly phase: Signal<HopPhase> = signal<HopPhase>('playing');
  readonly score: Signal<number> = signal(0);
  readonly best: Signal<number>;
  readonly newRecord: Signal<boolean> = signal(false);
  /** 本局吃了几枚硬币（HUD 显示用；分数是它 ×10 再加通关奖励）。 */
  readonly coinsTaken: Signal<number> = signal(0);

  readonly hint: ReadSignal<string> = computed(() => {
    const tail = `本局 ${this.score.value} · 最好 ${this.best.value}${this.newRecord.value ? ' · 新纪录！' : ''}`;
    switch (this.phase.value) {
      case 'won':
        return `到终点了！\n${tail}\n点这里重来`;
      case 'dead':
        return `摔了\n${tail}\n点这里重来`;
      default:
        return '';
    }
  });

  /** 本局的硬币。View 按它建 / 复用节点，`taken` 为真就藏起来。 */
  readonly coins: Coin[] = COINS.map((c) => ({ x: c.x, y: c.y, taken: false }));

  private readonly scoreboard: GameScoreboard;
  /** 当前按住的方向：-1 / 0 / 1。 */
  private dir = 0;

  constructor(options: HopVMOptions = {}) {
    this.scoreboard = options.scoreboard ?? memoryScoreboard();
    this.best = signal(this.scoreboard.best());
  }

  /** 走路是**按住**：View 按下时给 ±1，松开给 0。 */
  setDir(dir: number): void {
    this.dir = Math.sign(dir);
  }

  /** 跳。只在脚踩着实心时生效。 */
  jump(): void {
    if (this.phase.value !== 'playing' || !this.onGround) return;
    this.vy = JUMP_SPEED;
    this.onGround = false;
  }

  /** 摔死 / 通关之后点一下重来。 */
  restart(): void {
    if (this.phase.value === 'playing') return;
    this.x = SPAWN.x;
    this.y = SPAWN.y;
    this.vx = 0;
    this.vy = 0;
    this.onGround = true;
    this.dir = 0;
    this.facing = 1;
    this.score.value = 0;
    this.coinsTaken.value = 0;
    this.newRecord.value = false;
    for (const coin of this.coins) coin.taken = false;
    this.phase.value = 'playing';
  }

  /** 走着（脚踩地且真的在动）—— View 据此切走路动画。 */
  get walking(): boolean {
    return this.onGround && Math.abs(this.vx) > 1;
  }

  /** 推进 `dt` 秒。非 `playing` 时什么都不发生。 */
  step(dt: number): void {
    if (this.phase.value !== 'playing') return;
    const t = clamp(dt, 0, MAX_STEP);

    this.accelerate(t);
    this.moveX(t);
    this.moveY(t);
    this.collect();
    this.checkFate();
  }

  // —— 内部 ————————————————————————————————————————————————

  /** 水平加速 / 松手减速，夹在最大速度内。原样照抄 `Platform` 的三个参数。 */
  private accelerate(t: number): void {
    if (this.dir !== 0) {
      this.vx = clamp(this.vx + this.dir * ACCELERATION * t, -MAX_SPEED, MAX_SPEED);
      this.facing = this.dir > 0 ? 1 : -1;
    } else if (this.vx > 0) {
      this.vx = Math.max(0, this.vx - DECELERATION * t);
    } else if (this.vx < 0) {
      this.vx = Math.min(0, this.vx + DECELERATION * t);
    }
  }

  /**
   * 先走 x，再把撞进砖里的部分推出来。
   *
   * **分轴**是这类平台跳跃的通用做法：一次只动一个轴，推出方向就没有歧义（否则贴着地面
   * 往前走会被判成「从侧面撞上了下一块砖」，人一步都迈不出去）。
   */
  private moveX(t: number): void {
    if (this.vx === 0) return;
    const half = BODY.width / 2;
    this.x = clamp(this.x + this.vx * t, half, LEVEL_WIDTH - half);
    const hits = this.overlapping();
    if (hits.length === 0) return;
    // 撞进砖里了：按运动方向推到贴面为止（多块砖就取最保守的那个），然后横向速度清零 ——
    // 不清零的话人会一直往墙里顶，下一帧又要推一次。
    for (const tile of hits) {
      if (this.vx > 0) this.x = Math.min(this.x, tile.x - half);
      else this.x = Math.max(this.x, tile.x + TILE_SIZE + half);
    }
    this.vx = 0;
  }

  /** 再走 y。落地 / 顶头都在这里判。 */
  private moveY(t: number): void {
    this.vy = Math.max(this.vy - GRAVITY * t, -MAX_FALL_SPEED);
    this.y += this.vy * t;
    this.onGround = false;
    const hits = this.overlapping();
    if (hits.length === 0) return;
    for (const tile of hits) {
      // `vy <= 0` 而不是 `< 0`：站着不动那一帧速度已经被清成 0，还得判一次才不会缓慢沉下去。
      if (this.vy <= 0) {
        this.y = Math.max(this.y, tile.y + TILE_SIZE);
        this.onGround = true;
      } else {
        this.y = Math.min(this.y, tile.y - BODY.height);
      }
    }
    this.vy = 0;
  }

  /** 现在身体和哪些实心砖重叠。关卡只有 87 块，线性扫一遍比维护一张空间索引省事得多。 */
  private overlapping(): LevelTile[] {
    const left = this.x - BODY.width / 2;
    const right = this.x + BODY.width / 2;
    const bottom = this.y;
    const top = this.y + BODY.height;
    const hits: LevelTile[] = [];
    for (const tile of SOLIDS) {
      if (
        left < tile.x + TILE_SIZE &&
        right > tile.x &&
        bottom < tile.y + TILE_SIZE &&
        top > tile.y
      ) {
        hits.push(tile);
      }
    }
    return hits;
  }

  /** 吃硬币。 */
  private collect(): void {
    for (const coin of this.coins) {
      if (coin.taken) continue;
      if (
        Math.abs(this.x - coin.x) < (BODY.width + COIN_SIZE) / 2 &&
        Math.abs(this.y + BODY.height / 2 - coin.y) < (BODY.height + COIN_SIZE) / 2
      ) {
        coin.taken = true;
        this.coinsTaken.value += 1;
        this.score.value += COIN_SCORE;
      }
    }
  }

  /** 摔死 / 碰到藤壶 / 跑到终点。 */
  private checkFate(): void {
    if (this.y < PIT_Y) {
      this.finish('dead');
      return;
    }
    for (const hazard of HAZARDS) {
      if (
        Math.abs(this.x - hazard.x) < (BODY.width + hazard.w) / 2 &&
        this.y < hazard.y + hazard.h &&
        this.y + BODY.height > hazard.y
      ) {
        this.finish('dead');
        return;
      }
    }
    if (this.x >= GOAL.x) {
      this.score.value += GOAL_SCORE;
      this.finish('won');
    }
  }

  private finish(phase: 'dead' | 'won'): void {
    this.phase.value = phase;
    this.vx = 0;
    this.vy = 0;
    this.dir = 0;
    this.newRecord.value = this.scoreboard.submit(this.score.value);
    this.best.value = this.scoreboard.best();
  }
}

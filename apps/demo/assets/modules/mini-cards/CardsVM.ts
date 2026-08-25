import { computed, signal } from '@cck/core';
import type { ReadSignal, Signal } from '@cck/core';

/**
 * mini-cards 的全部玩法 —— **零 `cc` 依赖**，node 里直跑（`test/modules/mini-cards/CardsVM.test.ts`）。
 *
 * 来自 Kenney 的 Construct 2 模板 `dicecards.capx`（CC0，www.kenney.nl）。原版事件表三条：
 * 点牌背 → 在牌背右边 200 处生成一张牌，角度 `random(15)-random(15)`、牌面 `random(51)`；
 * 点红骰 / 白骰 → 换一个随机面。**没有胜负、没有分数** —— 它是一张桌子，不是一局游戏。
 *
 * 照搬时只改了一处：**按一副真牌无放回地发**。原版每次 `random(51)` 独立取，连着点两下
 * 发出两张一样的牌是常事，而且 51 这个上界还漏了最后一张。这里洗一副 52 张，发完自动重洗。
 *
 * 牌面下标 → 花色/点数由这套图自己决定（实测 `card00`=2♣、`card13`=2♦、`card26`=2♥），
 * 即 `suit = ⌊i/13⌋`、`rank = i%13 + 2`。`card52` 是另一张牌背，不在牌堆里。
 *
 * 这个模块**没有记分板** —— 它没有可比的成绩，硬塞一个「最好」只会是假的。它给大厅演示的
 * 是另外两件事：`GameHost.player`（桌上显示谁在玩）和 `exit()`。
 */

/** 牌贴图 140×190。 */
export const CARD_SIZE = { width: 140, height: 190 } as const;
/** 骰子贴图 68×68。 */
export const DIE_SIZE = { width: 68, height: 68 } as const;

/** 一副牌 52 张（`card00`…`card51`）。 */
export const DECK_SIZE = 52;
/** 骰子六个面。 */
export const DIE_FACES = 6;

/** 花色顺序由贴图决定，见类注释。 */
export const SUITS = ['♣', '♦', '♥', '♠'] as const;
/** 点数顺序：每个花色从 2 排到 A。 */
export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'] as const;

/** 发牌时的最大歪斜角度（原版 `random(15)-random(15)`，即 ±15）。 */
const MAX_TILT_DEG = 15;

/** 桌上的一张牌。位置由 View 摆（都堆在同一处），VM 只管牌面和歪斜。 */
export interface DealtCard {
  /** 牌面下标 0…51。 */
  readonly face: number;
  /** 歪斜角度（度）。 */
  readonly tilt: number;
}

/** 牌面下标 → 人看的名字，如 `♠A`。 */
export function cardName(face: number): string {
  return `${SUITS[Math.floor(face / RANKS.length)]}${RANKS[face % RANKS.length]}`;
}

export interface CardsVMOptions {
  /** 随机源。注进来是为了测试能给定序列 —— 洗牌、歪斜、骰子点数都靠它。 */
  rand?: () => number;
}

export class CardsVM {
  /** 桌上已发的牌，先发的在前。View 按它建 / 复用节点。 */
  readonly dealt: DealtCard[] = [];
  /**
   * 两颗骰子的面（0…5，即点数 1…6）。左红右白。
   *
   * 走 signal 而不是裸数组：{@link diceTotal} 是 `computed`，而 `computed` 只跟踪 signal 的读写 ——
   * 裸数组改了它不会重算，界面上的点数和就会永远停在开局那一次。
   */
  readonly dice: readonly [Signal<number>, Signal<number>] = [signal(0), signal(0)];

  /** 牌堆还剩几张。 */
  readonly remaining: Signal<number> = signal(DECK_SIZE);
  /** 洗过几次牌 —— 桌面提示用。 */
  readonly shuffles: Signal<number> = signal(0);
  /** 最近发出的那张牌的名字（还没发过是空串）。 */
  readonly lastCard: Signal<string> = signal('');
  /** 两颗骰子的点数和。 */
  readonly diceTotal: ReadSignal<number> = computed(() => this.dice[0].value + this.dice[1].value + 2);

  private readonly rand: () => number;
  /** 未发的牌，队尾是「最上面那张」。 */
  private deck: number[] = [];

  constructor(options: CardsVMOptions = {}) {
    this.rand = options.rand ?? Math.random;
    this.shuffle();
    this.roll();
  }

  /** 点牌堆：翻一张放到桌上。发完了先洗牌再发第一张。 */
  draw(): void {
    if (this.deck.length === 0) this.shuffle();
    const face = this.deck.pop()!;
    this.dealt.push({ face, tilt: (this.rand() - this.rand()) * MAX_TILT_DEG });
    this.remaining.value = this.deck.length;
    this.lastCard.value = cardName(face);
  }

  /** 点骰子：两颗一起重掷（原版红白各点各的，一起掷更像在玩）。 */
  roll(): void {
    this.dice[0].value = this.face();
    this.dice[1].value = this.face();
  }

  /** 洗一副新牌，清空桌面。 */
  private shuffle(): void {
    // 从 0…51 现建一副，再 Fisher-Yates 就地洗。用 `Array.from` 而不是 `[...]` ——
    // 展开语法会被构建期的 babel 降级成 `[].concat(...)`，在 Creator 的产物里出过错。
    this.deck = Array.from({ length: DECK_SIZE }, (_, i) => i);
    for (let i = this.deck.length - 1; i > 0; i--) {
      const j = Math.min(i, Math.floor(this.rand() * (i + 1)));
      const tmp = this.deck[i];
      this.deck[i] = this.deck[j];
      this.deck[j] = tmp;
    }
    this.dealt.length = 0;
    this.remaining.value = this.deck.length;
    this.lastCard.value = '';
    this.shuffles.value += 1; // 开局那次也算 —— 桌上写「第 1 副」，第二副接着数
  }

  private face(): number {
    return Math.min(DIE_FACES - 1, Math.floor(this.rand() * DIE_FACES));
  }
}

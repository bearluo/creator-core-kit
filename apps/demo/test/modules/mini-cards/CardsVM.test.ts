import { describe, expect, it } from 'vitest';
import { CardsVM, DECK_SIZE, cardName } from '../../../assets/modules/mini-cards/CardsVM';

/** 固定随机源，让洗牌与骰子可复现。 */
const fixedRand = (...values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length];
};

describe('CardsVM · 牌', () => {
  it('一副 52 张，发完为止不重复 —— 原版每次 random(51) 会发出重复的牌', () => {
    const vm = new CardsVM();
    const seen = new Set<number>();
    for (let i = 0; i < DECK_SIZE; i++) {
      vm.draw();
      seen.add(vm.dealt[vm.dealt.length - 1].face);
    }
    expect(seen.size).toBe(DECK_SIZE);
    expect(vm.remaining.value).toBe(0);
  });

  it('发完自动重洗：桌面清空、副数 +1、又能接着发', () => {
    const vm = new CardsVM();
    expect(vm.shuffles.value).toBe(1); // 开局那副也算第 1 副
    for (let i = 0; i < DECK_SIZE; i++) vm.draw();
    expect(vm.dealt).toHaveLength(DECK_SIZE);

    vm.draw(); // 第 53 次：先洗再发
    expect(vm.shuffles.value).toBe(2);
    expect(vm.dealt).toHaveLength(1);
    expect(vm.remaining.value).toBe(DECK_SIZE - 1);
  });

  it('歪斜在 ±15 之内（原版 random(15)-random(15)）', () => {
    const vm = new CardsVM();
    for (let i = 0; i < 20; i++) vm.draw();
    for (const card of vm.dealt) expect(Math.abs(card.tilt)).toBeLessThanOrEqual(15);
  });

  it('牌面下标 → 花色点数，按这套图实测的排法（card00=2♣、card13=2♦、card26=2♥）', () => {
    expect(cardName(0)).toBe('♣2');
    expect(cardName(12)).toBe('♣A');
    expect(cardName(13)).toBe('♦2');
    expect(cardName(26)).toBe('♥2');
    expect(cardName(51)).toBe('♠A');
  });

  it('刚发的那张会写在提示里', () => {
    const vm = new CardsVM();
    vm.draw();
    expect(vm.lastCard.value).toBe(cardName(vm.dealt[0].face));
  });
});

describe('CardsVM · 骰子', () => {
  it('两颗都在 0…5，点数和在 2…12', () => {
    const vm = new CardsVM();
    for (let i = 0; i < 50; i++) {
      vm.roll();
      expect(vm.dice[0].value).toBeGreaterThanOrEqual(0);
      expect(vm.dice[0].value).toBeLessThanOrEqual(5);
      expect(vm.dice[1].value).toBeGreaterThanOrEqual(0);
      expect(vm.dice[1].value).toBeLessThanOrEqual(5);
      // 每掷一次都要跟着变 —— 裸数组配 computed 就会卡在开局那一次（这条测试抓到过）。
      expect(vm.diceTotal.value).toBe(vm.dice[0].value + vm.dice[1].value + 2);
    }
  });

  it('随机源吐 1 也不会越界 —— Math.floor(1×6)=6 得夹住', () => {
    const vm = new CardsVM({ rand: fixedRand(1) });
    vm.roll();
    expect(vm.dice[0].value).toBe(5);
    expect(vm.dice[1].value).toBe(5);
    expect(vm.diceTotal.value).toBe(12);
  });
});

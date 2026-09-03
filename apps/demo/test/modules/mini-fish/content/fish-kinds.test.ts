import { describe, expect, it } from 'vitest';
import {
  BOMB_RADIUS,
  FISH_KINDS,
  MAX_FISH_R,
  fishKind,
} from '../../../../assets/modules/mini-fish/content/fish-kinds';

describe('鱼种表', () => {
  it('id 不重复 —— 它是图集帧名前缀，重了第二刀会静默切错图', () => {
    expect(new Set(FISH_KINDS.map((k) => k.id)).size).toBe(FISH_KINDS.length);
  });

  it('倍率与半径都是正数', () => {
    for (const k of FISH_KINDS) {
      expect(k.m).toBeGreaterThan(0);
      expect(k.r).toBeGreaterThan(0);
    }
  });

  /**
   * `r` 是短边的一半、`body` 是长边，两列都从图集同一帧抄来，所以 `body ≥ 2r` 是恒等式。
   * 抄错一位没有别的地方会红：`pathSystem` 那条「大鱼转得稳」只比大鱼小鱼的相对快慢，
   * 鲨鱼抄成 49 照样过 —— 只有这条量纲关系抓得住。
   */
  it('体长不短于判定直径 —— 两列抄自同一帧，长边不可能比短边小', () => {
    for (const k of FISH_KINDS) expect(k.body, k.name).toBeGreaterThanOrEqual(2 * k.r);
  });

  it('全表只有一条炸弹鱼（决策 D3：做一种就够，做四种是重复付第一种付过的钱）', () => {
    expect(FISH_KINDS.filter((k) => k.bomb).map((k) => k.id)).toEqual(['fish_hetun']);
  });

  it('MAX_FISH_R 真的是最大半径 —— 空间哈希的查询半径靠它，小了会漏掉大鱼', () => {
    expect(MAX_FISH_R).toBe(Math.max(...FISH_KINDS.map((k) => k.r)));
  });

  it('炸圈比最大的网还大，否则炸弹鱼跟普通鱼没区别', () => {
    expect(BOMB_RADIUS).toBeGreaterThan(MAX_FISH_R);
  });

  it('越界下标当场抛，不静默返回 undefined', () => {
    expect(() => fishKind(FISH_KINDS.length)).toThrow(/未知鱼种/);
    expect(fishKind(0).id).toBe('fish_red');
  });
});

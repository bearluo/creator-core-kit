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

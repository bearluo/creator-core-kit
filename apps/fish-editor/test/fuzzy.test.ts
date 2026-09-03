import { describe, expect, it } from 'vitest';
import { fuzzyFilter, fuzzyScore } from '../src/fuzzy';

const PATHS = ['cross-lr', 'cross-rl-high', 'diag-up', 'diag-down', 'wave-lr', 'wave-rl', 'rise', 'loop-left'];

describe('fuzzyScore', () => {
  it('没命中是 null，不是 0 —— 0 是空查询的合法得分', () => {
    expect(fuzzyScore('cross-lr', 'zzz')).toBeNull();
    expect(fuzzyScore('cross-lr', '')).toBe(0);
  });

  it('四档由高到低：相等 > 前缀 > 含子串 > 子序列', () => {
    const eq = fuzzyScore('rise', 'rise')!;
    const pre = fuzzyScore('rise-2', 'rise')!;
    const sub = fuzzyScore('go-rise', 'rise')!;
    const seq = fuzzyScore('red-is-here', 'rise')!;
    expect(eq).toBeGreaterThan(pre);
    expect(pre).toBeGreaterThan(sub);
    expect(sub).toBeGreaterThan(seq);
  });

  it('子序列能中 —— `includes` 一个都中不了的连字符串正是下拉里的常客', () => {
    expect(fuzzyScore('cross-rl-high', 'crh')).not.toBeNull();
    expect(fuzzyScore('cross-rl-high', 'chr')).toBeNull(); // 顺序不对就不算
  });

  it('大小写不管', () => {
    expect(fuzzyScore('fish_yellow', 'YEL')).not.toBeNull();
  });
});

describe('fuzzyFilter', () => {
  it('空查询原样返回（含顺序）', () => {
    expect(fuzzyFilter(PATHS, '  ')).toEqual(PATHS);
  });

  it('敲 rl：完整子串那两条排在只凑齐字母的前面', () => {
    const out = fuzzyFilter(PATHS, 'rl');
    expect(out.slice(0, 2)).toEqual(['wave-rl', 'cross-rl-high']);
    expect(out).toContain('cross-lr'); // 子序列也中，但排后面
  });

  it('同分保持原序 —— 下拉每次开都该长一个样', () => {
    expect(fuzzyFilter(['aa-x', 'aa-y'], 'aa')).toEqual(['aa-x', 'aa-y']);
  });

  it('一条都不中就是空数组', () => {
    expect(fuzzyFilter(PATHS, 'zzzz')).toEqual([]);
  });
});

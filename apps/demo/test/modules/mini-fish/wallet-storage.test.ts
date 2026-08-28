import { describe, expect, it, vi } from 'vitest';
import { persistentWallet } from '../../../assets/modules/mini-fish/wallet-storage';

describe('persistentWallet', () => {
  it('读得到存档就从存档开始', () => {
    const w = persistentWallet(10_000, '777', () => {});
    expect(w.balance()).toBe(777);
  });

  it('没存档（首次进游戏）就从 initial 开始', () => {
    expect(persistentWallet(10_000, undefined, () => {}).balance()).toBe(10_000);
    expect(persistentWallet(10_000, null, () => {}).balance()).toBe(10_000);
  });

  it('存档坏了就当没有 —— 一行脏数据不该把游戏卡死', () => {
    for (const bad of ['', 'abc', '{}', 'NaN', 'Infinity', '-5']) {
      expect(persistentWallet(10_000, bad, () => {}).balance(), `坏值 '${bad}'`).toBe(10_000);
    }
  });

  it('存档是 0 是合法的（打光了不该被当成脏数据重置成 10000）', () => {
    expect(persistentWallet(10_000, '0', () => {}).balance()).toBe(0);
  });

  it('花钱、赚钱都写回；花不出去就不写', () => {
    const save = vi.fn();
    const w = persistentWallet(0, '10', save);

    expect(w.spend(3)).toBe(true);
    expect(save).toHaveBeenLastCalledWith(7);

    w.earn(5);
    expect(save).toHaveBeenLastCalledWith(12);

    save.mockClear();
    expect(w.spend(999)).toBe(false);
    expect(save).not.toHaveBeenCalled(); // 余额不足：不扣，也不写
    expect(w.balance()).toBe(12);
  });
});

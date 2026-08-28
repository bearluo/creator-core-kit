import { describe, expect, it } from 'vitest';
import {
  localArbiter,
  memoryWallet,
  MAX_LEVEL,
  RTP,
  type FishArbiter,
} from '../../../assets/modules/mini-fish/economy';
import { FISH_KINDS, fishKind } from '../../../assets/modules/mini-fish/fish-kinds';

/** 逐个吐出给定值，用完从头再来。用来把「这条鱼死不死」钉死。 */
function scriptedRand(...values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

/** mulberry32：小、快、确定。只给 RTP 模拟用。 */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('memoryWallet', () => {
  it('余额不足时 spend 返回 false 且一分不扣', () => {
    const w = memoryWallet(5);
    expect(w.spend(6)).toBe(false);
    expect(w.balance()).toBe(5);
    expect(w.spend(5)).toBe(true);
    expect(w.balance()).toBe(0);
  });

  it('earn 累加；非正数与小数被挡在门口', () => {
    const w = memoryWallet(10);
    w.earn(7);
    expect(w.balance()).toBe(17);
    w.earn(-100);
    w.earn(0);
    expect(w.balance()).toBe(17);
    w.earn(2.9);
    expect(w.balance()).toBe(19);
    expect(w.spend(0)).toBe(false);
  });
});

describe('localArbiter.fire', () => {
  it('玩家那门炮按档位扣钱；余额不足开不出票', () => {
    const wallet = memoryWallet(10);
    const a = localArbiter({ wallet });
    expect(a.fire(0, 7)).toEqual({ cannon: 0, level: 7 });
    expect(wallet.balance()).toBe(3);
    expect(a.fire(0, 7)).toBeNull();
    expect(wallet.balance()).toBe(3); // 开不出票就一分不动
  });

  it('AI 那三门炮照开不误，但不花玩家的钱', () => {
    const wallet = memoryWallet(0);
    const a = localArbiter({ wallet });
    expect(a.fire(2, 3)).toEqual({ cannon: 2, level: 3 });
    expect(wallet.balance()).toBe(0);
  });

  it('档位越界开不出票', () => {
    const a = localArbiter({ wallet: memoryWallet(1000) });
    expect(a.fire(0, 0)).toBeNull();
    expect(a.fire(0, MAX_LEVEL + 1)).toBeNull();
  });
});

describe('localArbiter.resolve', () => {
  it('一组进一组出，顺序与入参一致', () => {
    const a = localArbiter({ wallet: memoryWallet(1000), rand: scriptedRand(1) }); // 全不死
    const out = a.resolve({ cannon: 0, level: 1 }, [
      { eid: 7, kind: 0 },
      { eid: 9, kind: 3 },
    ]);
    expect(out.map((s) => s.eid)).toEqual([7, 9]);
    expect(out.every((s) => !s.dead && s.payout === 0)).toBe(true);
  });

  it('击杀概率恰好是 RTP/(N×m)，赔付恰好是 level×m —— 卡在阈值两侧各验一次', () => {
    const kind = 9; // 鲨鱼 m=50
    const m = fishKind(kind).m;
    const n = 3;
    const p = RTP / (n * m);
    const caught = [
      { eid: 1, kind },
      { eid: 2, kind },
      { eid: 3, kind },
    ];

    // 第一条刚好低于阈值 → 死；第二条刚好等于阈值 → 活（`rand() < p` 是严格小于）；第三条远高 → 活。
    const wallet = memoryWallet(0);
    const a = localArbiter({ wallet, rand: scriptedRand(p - 1e-9, p, 0.99) });
    const out = a.resolve({ cannon: 0, level: 4 }, caught);
    expect(out.map((s) => s.dead)).toEqual([true, false, false]);
    expect(out[0].payout).toBe(4 * m);
    expect(wallet.balance()).toBe(4 * m);
  });

  it('AI 打死的鱼不进玩家钱包', () => {
    const wallet = memoryWallet(0);
    const a = localArbiter({ wallet, rand: scriptedRand(0) }); // 全死
    const out = a.resolve({ cannon: 1, level: 5 }, [{ eid: 1, kind: 0 }]);
    expect(out[0].dead).toBe(true);
    expect(out[0].payout).toBeGreaterThan(0);
    expect(wallet.balance()).toBe(0);
  });

  it('空网不判、不入账', () => {
    const wallet = memoryWallet(100);
    const a = localArbiter({ wallet, rand: scriptedRand(0) });
    expect(a.resolve({ cannon: 0, level: 1 }, [])).toEqual([]);
    expect(wallet.balance()).toBe(100);
  });

  it('p 恒小于 1（最小的鱼、独自被罩住时也不是必死）', () => {
    const minM = Math.min(...FISH_KINDS.map((k) => k.m));
    expect(RTP / (1 * minM)).toBeLessThan(1);
  });
});

describe('RTP', () => {
  // 30 万局、鱼种随机、网内鱼数随机 —— 唯独档位固定为 1：赔付方差 ∝ level²，
  // 放开档位要多跑一个数量级才能收到同样窄的区间，而「与档位无关」已由上面那条阈值用例精确钉死。
  //
  // 容差 0.03 是**算出来的不是试出来的**：单局赔付方差 ≈ RTP × level² × m̄ ≈ 26.6，
  // 30 万局的标准差 ≈ √(3e5 × 26.6) / 3e5 ≈ 0.0094，0.03 ≈ 3.2σ。
  it('一万局×30 的实测返奖率落在 0.95 附近（破产保底不参与，那是白送的钱）', () => {
    const rand = seeded(20260828);
    const start = 10_000_000;
    const wallet = memoryWallet(start);
    const arbiter: FishArbiter = localArbiter({ wallet, rand });

    const rounds = 300_000;
    let spent = 0;
    for (let i = 0; i < rounds; i++) {
      const ticket = arbiter.fire(0, 1);
      expect(ticket).not.toBeNull();
      spent += 1;
      const n = 1 + Math.floor(rand() * 5);
      const caught: { eid: number; kind: number }[] = [];
      for (let k = 0; k < n; k++) {
        caught.push({ eid: k, kind: Math.floor(rand() * FISH_KINDS.length) });
      }
      arbiter.resolve(ticket as { cannon: number; level: number }, caught);
    }

    const payout = wallet.balance() - start + spent;
    expect(payout / spent).toBeGreaterThan(RTP - 0.03);
    expect(payout / spent).toBeLessThan(RTP + 0.03);
  });
});

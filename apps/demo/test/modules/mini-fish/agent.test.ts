import { describe, expect, it } from 'vitest';
import { aiAgent, manualAgent, type PoolView } from '../../../assets/modules/mini-fish/agent';

const pool = (...fish: { eid: number; kind: number; x: number; y: number }[]): PoolView => ({ fish });
const empty: PoolView = { fish: [] };

describe('manualAgent', () => {
  it('瞄一次开一发：角度取走就清空，不会连发', () => {
    const a = manualAgent(0, 0);
    expect(a.update(0.016, empty)).toBeNull();
    a.aim(10, 0);
    expect(a.update(0.016, empty)).toBeCloseTo(0, 9);
    expect(a.update(0.016, empty)).toBeNull();
  });

  it('同一帧多次点击只算最后一次', () => {
    const a = manualAgent(0, 0);
    a.aim(10, 0);
    a.aim(0, 10);
    expect(a.update(0.016, empty)).toBeCloseTo(Math.PI / 2, 9);
  });

  it('角度是相对炮位算的，不是相对原点', () => {
    const a = manualAgent(100, 100);
    a.aim(100, 200);
    expect(a.update(0.016, empty)).toBeCloseTo(Math.PI / 2, 9);
  });
});

describe('aiAgent', () => {
  /** rand 恒 0.5 → 间隔恒为 interval×1。 */
  const rand = () => 0.5;

  it('不到间隔不开火', () => {
    const a = aiAgent({ x: 0, y: 0, interval: 1, rand });
    expect(a.update(0.9, pool({ eid: 1, kind: 0, x: 0, y: 100 }))).toBeNull();
  });

  it('到点了瞄场上倍率最高的那条', () => {
    const a = aiAgent({ x: 0, y: 0, interval: 1, rand });
    const angle = a.update(1, pool(
      { eid: 1, kind: 0, x: 100, y: 0 }, // 红鱼 m=10，正右
      { eid: 2, kind: 9, x: 0, y: 100 }, // 鲨鱼 m=50，正上 ← 该打这条
    ));
    expect(angle).toBeCloseTo(Math.PI / 2, 9);
  });

  it('场上没鱼就不开火（但计时照样重置，不会攒出一次瞬发）', () => {
    const a = aiAgent({ x: 0, y: 0, interval: 1, rand });
    expect(a.update(1, empty)).toBeNull();
    expect(a.update(0.5, pool({ eid: 1, kind: 0, x: 100, y: 0 }))).toBeNull();
    expect(a.update(0.5, pool({ eid: 1, kind: 0, x: 100, y: 0 }))).toBeCloseTo(0, 9);
  });

  it('间隔带抖动，三门 AI 不会齐射', () => {
    const early = aiAgent({ x: 0, y: 0, interval: 1, rand: () => 0 }); // 0.5×
    const late = aiAgent({ x: 0, y: 0, interval: 1, rand: () => 1 }); // 1.5×
    const p = pool({ eid: 1, kind: 0, x: 100, y: 0 });
    expect(early.update(0.6, p)).not.toBeNull();
    expect(late.update(0.6, p)).toBeNull();
  });
});

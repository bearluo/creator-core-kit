import { describe, expect, it } from 'vitest';
import {
  emptyFeeder,
  randomFeeder,
  scriptedFeeder,
} from '../../../assets/modules/mini-fish/feeder';
import { FISH_KINDS } from '../../../assets/modules/mini-fish/fish-kinds';
import { PATHS } from '../../../assets/modules/mini-fish/paths';

const spawn = (kind: number) => ({ kind, pathId: 0, speed: 100 });

/** 循环吐出固定值。 */
function scriptedRand(...values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

describe('scriptedFeeder', () => {
  it('到点才放，且按 at 排序（写乱了也照样对）', () => {
    const f = scriptedFeeder([
      { at: 2, spawn: spawn(1) },
      { at: 0, spawn: spawn(0) },
    ]);
    expect(f.next(0.5).map((s) => s.kind)).toEqual([0]);
    expect(f.next(0.5)).toEqual([]);
    expect(f.next(1.0).map((s) => s.kind)).toEqual([1]);
    expect(f.next(10)).toEqual([]);
  });

  it('一步大 dt 一次补齐 —— 单测能直接跳到第 N 秒的局面', () => {
    const f = scriptedFeeder([
      { at: 1, spawn: spawn(0) },
      { at: 2, spawn: spawn(1) },
      { at: 3, spawn: spawn(2) },
    ]);
    expect(f.next(5)).toHaveLength(3);
  });
});

describe('emptyFeeder', () => {
  it('一条也不放', () => {
    expect(emptyFeeder().next(100)).toEqual([]);
  });
});

describe('randomFeeder', () => {
  it('不到间隔不放，到了放一批', () => {
    const f = randomFeeder({ interval: 1, batch: 3, rand: scriptedRand(0.5) });
    expect(f.next(0.9)).toEqual([]);
    expect(f.next(0.2)).toHaveLength(3);
  });

  it('放出来的鱼种 / 路径 / 速度都在表内', () => {
    const f = randomFeeder({ interval: 0.1, batch: 5, minSpeed: 50, maxSpeed: 60 });
    const out = f.next(0.1);
    for (const s of out) {
      expect(s.kind).toBeGreaterThanOrEqual(0);
      expect(s.kind).toBeLessThan(FISH_KINDS.length);
      expect(s.pathId).toBeGreaterThanOrEqual(0);
      expect(s.pathId).toBeLessThan(PATHS.length);
      expect(s.speed).toBeGreaterThanOrEqual(50);
      expect(s.speed).toBeLessThanOrEqual(60);
    }
  });

  it('大鱼罕见：权重 ∝ 1/m —— rand 贴近 0 取到第一种（最便宜），贴近 1 取到最后一种（最贵）', () => {
    const cheap = randomFeeder({ interval: 1, batch: 1, rand: scriptedRand(0) }).next(1);
    const dear = randomFeeder({ interval: 1, batch: 1, rand: scriptedRand(0.999999) }).next(1);
    expect(cheap[0].kind).toBe(0);
    expect(dear[0].kind).toBe(FISH_KINDS.length - 1);
  });

  it('掉帧不许一次性倒进几百条鱼：一帧最多补 4 批，余数清零', () => {
    const f = randomFeeder({ interval: 0.1, batch: 1, rand: scriptedRand(0.5) });
    expect(f.next(100)).toHaveLength(4);
    // 余数被清零，所以下一帧要重新等满一个间隔
    expect(f.next(0.05)).toEqual([]);
    expect(f.next(0.05)).toHaveLength(1);
  });
});

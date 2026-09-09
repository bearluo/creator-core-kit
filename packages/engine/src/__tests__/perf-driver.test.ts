import { afterEach, describe, expect, it } from 'vitest';
import { director, game, Director, resetCcMock } from 'cc';
import { PerfWindow } from '@cck/core';

import { drivePerfWindow } from '../perf-driver';

describe('drivePerfWindow', () => {
  afterEach(() => {
    resetCcMock();
  });

  it('每帧把 game.deltaTime 从**秒换算成毫秒**推给 frame()', () => {
    const dts: number[] = [];
    const dispose = drivePerfWindow({ frame: (ms) => void dts.push(ms) });

    game.deltaTime = 0.016;
    director.emit(Director.EVENT_AFTER_UPDATE);
    game.deltaTime = 0.25; // 一次卡顿
    director.emit(Director.EVENT_AFTER_UPDATE);

    // 单位错了整份数据都是错的，而且不会报错 —— 这个函数存在的一半理由就是这行
    expect(dts).toEqual([16, 250]);
    dispose();
  });

  it('解绑后不再喂', () => {
    const dts: number[] = [];
    const dispose = drivePerfWindow({ frame: (ms) => void dts.push(ms) });

    game.deltaTime = 0.016;
    director.emit(Director.EVENT_AFTER_UPDATE);
    dispose();
    director.emit(Director.EVENT_AFTER_UPDATE);

    expect(dts).toEqual([16]);
  });

  it('接到真的 PerfWindow 上：帧数与卡顿都落到报告里', () => {
    const perf = new PerfWindow({ stallThresholdsMs: [100] });
    const dispose = drivePerfWindow(perf);

    game.deltaTime = 0.016;
    for (let i = 0; i < 10; i++) director.emit(Director.EVENT_AFTER_UPDATE);
    game.deltaTime = 0.25;
    director.emit(Director.EVENT_AFTER_UPDATE);
    dispose();

    const r = perf.drain().reports[0];
    expect(r.frames).toBe(11);
    expect(r.maxFrameMs).toBe(250);
    expect(r.stalls).toEqual([{ thresholdMs: 100, frames: 1, totalMs: 250 }]);
  });
});

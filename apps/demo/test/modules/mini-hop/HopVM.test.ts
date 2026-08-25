import { describe, expect, it } from 'vitest';
import { memoryScoreboard } from '../../../assets/foundation/game/scoreboard';
import { BODY, HopVM } from '../../../assets/modules/mini-hop/HopVM';
import { COINS, GOAL, HAZARDS, SPAWN } from '../../../assets/modules/mini-hop/level';

/**
 * mini-hop 的全部判据 —— node 里跑。
 *
 * 关卡是**烘出来的纯数据**（`level.ts`），VM 和这些测试读同一份，所以「这级台阶跳不跳得上去」
 * 「这块砖挡不挡头」在这里就能问死，不用开 Creator 一遍遍试跳。
 *
 * 关卡里几处关键地形（坐标来自 `level.ts`）：
 * - 出生点 (210, 130)，脚下那片地面表面在 y=130；
 * - x=350 起是一级 **70 高的台阶**，表面 y=200；
 * - x≈1120 上空 y=270 悬着一块砖（跳起来会顶头）；
 * - 藤壶两只：(840.5, 200) 在台上、(1820.5, 60) 在终点前；
 * - 终点 x=1855，紧挨着第二只藤壶 —— **只能跳过去**，走过去必死。
 */

const run = (vm: HopVM, seconds: number): void => {
  for (let i = 0; i < Math.round(seconds * 60); i++) vm.step(1 / 60);
};

/** 把人摆到一个精确的位置上（用来问一个几何问题，不必真的跑过去）。 */
const at = (x: number, y: number, scoreboard = memoryScoreboard()): HopVM => {
  const vm = new HopVM({ scoreboard });
  vm.x = x;
  vm.y = y;
  return vm;
};

describe('HopVM · 站与走', () => {
  it('站着不下沉 —— 每帧的重力都被地面吃掉', () => {
    const vm = new HopVM();
    run(vm, 2);
    expect(vm.y).toBe(SPAWN.y);
    expect(vm.onGround).toBe(true);
    expect(vm.vy).toBe(0);
  });

  it('加速到 330 封顶，松手减速回 0 —— 原样照抄 Platform 行为的三个参数', () => {
    const vm = new HopVM();
    vm.setDir(1);
    run(vm, 0.3);
    expect(vm.vx).toBe(330);
    expect(vm.facing).toBe(1);

    vm.setDir(0);
    run(vm, 0.3);
    expect(vm.vx).toBe(0);
  });

  it('撞上台阶就停住，不会卡进砖里', () => {
    const vm = new HopVM();
    vm.setDir(1);
    run(vm, 3);
    expect(vm.x).toBeCloseTo(350 - BODY.width / 2, 6); // 贴着台阶立面
    expect(vm.vx).toBe(0);
    expect(vm.y).toBe(SPAWN.y); // 没被顶上去，也没陷下去
  });

  it('跳一下就上得去那级 70 的台阶', () => {
    const vm = at(350 - BODY.width / 2, SPAWN.y);
    vm.setDir(1);
    vm.jump();
    run(vm, 1.5);
    expect(vm.y).toBe(200); // 台阶表面
    expect(vm.x).toBeGreaterThan(360);
    expect(vm.onGround).toBe(true);
  });

  it('不给二段跳 —— 空中再点没用', () => {
    const vm = new HopVM();
    vm.jump();
    const first = vm.vy;
    vm.step(1 / 60);
    vm.jump();
    expect(vm.vy).toBeLessThan(first);
  });

  it('头顶那块砖挡得住 —— 跳到砖底就停，不会穿过去', () => {
    const vm = at(1120, 130);
    vm.jump();
    run(vm, 0.8);
    // 砖底在 y=270，人高 88 → 头顶被压住时脚最多到 182；不挡的话按初速 650 能升到 270 出头。
    expect(vm.y).toBeLessThanOrEqual(270 - BODY.height);
  });
});

describe('HopVM · 硬币 / 藤壶 / 终点', () => {
  it('吃硬币 +10，且只吃一次', () => {
    const coin = COINS[0];
    const vm = at(coin.x, 200);
    vm.step(1 / 60);
    expect(vm.coinsTaken.value).toBe(1);
    expect(vm.score.value).toBe(10);
    run(vm, 0.5);
    expect(vm.coinsTaken.value).toBe(1);
    expect(vm.score.value).toBe(10);
  });

  it('碰到藤壶就死', () => {
    const hazard = HAZARDS[0];
    const vm = at(hazard.x, hazard.y);
    vm.step(1 / 60);
    expect(vm.phase.value).toBe('dead');
  });

  it('掉出关卡底也算死（这一关没坑，但规则得在）', () => {
    const vm = at(210, -500);
    vm.step(1 / 60);
    expect(vm.phase.value).toBe('dead');
  });

  it('终点紧挨着最后一只藤壶 —— 走过去必死，跳过去才算赢', () => {
    const last = HAZARDS[HAZARDS.length - 1];
    // 贴地走到终点：还没走到就被藤壶碰死。
    const walker = at(GOAL.x, last.y);
    walker.step(1 / 60);
    expect(walker.phase.value).toBe('dead');

    // 从藤壶头顶飞过去：同一个 x，高度不同，结果就不同。
    const jumper = at(GOAL.x + 5, 200);
    jumper.step(1 / 60);
    expect(jumper.phase.value).toBe('won');
  });

  it('通关 +50，成绩交给记分板', () => {
    const board = memoryScoreboard();
    const vm = at(GOAL.x + 5, 200, board);
    vm.score.value = 60; // 假装一路捡了 6 枚
    vm.step(1 / 60);
    expect(vm.phase.value).toBe('won');
    expect(vm.score.value).toBe(110);
    expect(board.best()).toBe(110);
    expect(vm.newRecord.value).toBe(true);
    expect(vm.hint.value).toContain('新纪录');
  });

  it('结算后世界停住，重来复位到出生点且硬币回来', () => {
    const coin = COINS[0];
    const vm = at(coin.x, 200);
    vm.step(1 / 60);
    expect(vm.coinsTaken.value).toBe(1);

    vm.x = HAZARDS[0].x;
    vm.y = HAZARDS[0].y;
    vm.step(1 / 60);
    expect(vm.phase.value).toBe('dead');

    const frozen = { x: vm.x, y: vm.y };
    run(vm, 1);
    expect(vm.x).toBe(frozen.x);
    expect(vm.y).toBe(frozen.y);

    vm.restart();
    expect(vm.phase.value).toBe('playing');
    expect(vm.x).toBe(SPAWN.x);
    expect(vm.y).toBe(SPAWN.y);
    expect(vm.score.value).toBe(0);
    expect(vm.coins.every((c) => !c.taken)).toBe(true);
  });
});

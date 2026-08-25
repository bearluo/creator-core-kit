import { describe, expect, it } from 'vitest';
import { memoryScoreboard } from '../../../assets/foundation/game/scoreboard';
import {
  ENEMY_SIZE,
  MUZZLE_OFFSET,
  PLAYER_SIZE,
  ShooterVM,
} from '../../../assets/modules/mini-shooter/ShooterVM';

/** 固定随机源，让出生位置与陨石种类可复现。 */
const fixedRand = (...values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length];
};

const run = (vm: ShooterVM, seconds: number): void => {
  for (let i = 0; i < Math.round(seconds * 60); i++) vm.step(1 / 60);
};

describe('ShooterVM · 出场与移动', () => {
  it('每 2 秒出一颗陨石 —— 原版就是这个节奏', () => {
    const vm = new ShooterVM({ rand: fixedRand(0.5) });
    run(vm, 1.9);
    expect(vm.enemies).toHaveLength(0);
    run(vm, 0.2);
    expect(vm.enemies).toHaveLength(1);
    run(vm, 2);
    expect(vm.enemies).toHaveLength(2);
  });

  it('陨石从场外飘进来，穿过整个场约 3.4 秒 —— 换屏幕不改手感', () => {
    const tall = new ShooterVM({ halfHeight: 711 });
    const short = new ShooterVM({ halfHeight: 240 });
    // 速度跟着场高走，于是「飘多久」是常数。
    expect((711 * 2 + ENEMY_SIZE.height * 2) / tall.enemySpeed).toBeCloseTo(3.4, 6);
    expect((240 * 2 + ENEMY_SIZE.height * 2) / short.enemySpeed).toBeCloseTo(3.4, 6);
    expect(tall.enemySpeed).toBeGreaterThan(short.enemySpeed);
  });

  it('激光比陨石快 10/3 倍（原版 600 : 180）', () => {
    const vm = new ShooterVM();
    expect(vm.laserSpeed / vm.enemySpeed).toBeCloseTo(600 / 180, 6);
  });

  it('飞船跟手指，夹在场内', () => {
    const vm = new ShooterVM();
    vm.aim(99999);
    expect(vm.playerX).toBe(vm.halfWidth - PLAYER_SIZE.width / 2);
  });
});

describe('ShooterVM · 开火', () => {
  it('点一下出两发，分别在船身左右 ±35', () => {
    const vm = new ShooterVM();
    vm.aim(100);
    vm.tap();
    expect(vm.lasers).toHaveLength(2);
    expect(vm.lasers[0].x).toBe(100 - MUZZLE_OFFSET);
    expect(vm.lasers[1].x).toBe(100 + MUZZLE_OFFSET);
    expect(vm.lasers[0].y).toBe(vm.playerY);
  });

  it('没有冷却 —— 点得多快就打得多密，这是原版的手感', () => {
    const vm = new ShooterVM();
    vm.tap();
    vm.tap();
    vm.tap();
    expect(vm.lasers).toHaveLength(6);
  });

  it('飞出场顶的激光会被删掉 —— 否则数组只涨不落', () => {
    const vm = new ShooterVM({ halfHeight: 240 });
    vm.tap();
    run(vm, 3);
    expect(vm.lasers).toHaveLength(0);
  });
});

describe('ShooterVM · 命中与结算', () => {
  it('激光打中陨石：双双消失，+1 分', () => {
    const vm = new ShooterVM();
    vm.enemies.push({ x: 0, y: 0, kind: 0 });
    vm.lasers.push({ x: 0, y: 0 });
    vm.step(1 / 60);
    expect(vm.enemies).toHaveLength(0);
    expect(vm.lasers).toHaveLength(0);
    expect(vm.score.value).toBe(1);
    expect(vm.phase.value).toBe('playing');
  });

  it('一发只打一颗 —— 两颗叠在一起时另一颗还在', () => {
    const vm = new ShooterVM();
    vm.enemies.push({ x: 0, y: 0, kind: 0 });
    vm.enemies.push({ x: 0, y: 0, kind: 1 });
    vm.lasers.push({ x: 0, y: 0 });
    vm.step(1 / 60);
    expect(vm.enemies).toHaveLength(1);
    expect(vm.score.value).toBe(1);
  });

  it('陨石撞上飞船 → dead，成绩交给记分板，点一下重开', () => {
    const board = memoryScoreboard();
    const vm = new ShooterVM({ scoreboard: board });
    vm.score.value = 5;
    vm.enemies.push({ x: vm.playerX, y: vm.playerY, kind: 0 });
    vm.step(1 / 60);
    expect(vm.phase.value).toBe('dead');
    expect(board.best()).toBe(5);
    expect(vm.newRecord.value).toBe(true);
    expect(vm.hint.value).toContain('新纪录');

    vm.tap();
    expect(vm.phase.value).toBe('playing');
    expect(vm.score.value).toBe(0);
    expect(vm.enemies).toHaveLength(0);
    expect(vm.lasers).toHaveLength(0);
  });

  it('判定是收紧的 —— 擦着贴图边过去不算死', () => {
    const vm = new ShooterVM();
    // 两张图的边缘刚好相接：按贴图全宽算必死，按收紧的盒子算活。
    vm.enemies.push({ x: vm.playerX + (PLAYER_SIZE.width + ENEMY_SIZE.width) / 2 - 4, y: vm.playerY, kind: 0 });
    vm.step(1 / 60);
    expect(vm.phase.value).toBe('playing');
  });

  it('坠毁后世界停住 —— 陨石不再往下走', () => {
    const vm = new ShooterVM();
    vm.enemies.push({ x: vm.playerX, y: vm.playerY, kind: 0 });
    vm.step(1 / 60);
    expect(vm.phase.value).toBe('dead');
    const frozen = vm.enemies.map((e) => e.y);
    run(vm, 1);
    expect(vm.enemies.map((e) => e.y)).toEqual(frozen);
  });
});

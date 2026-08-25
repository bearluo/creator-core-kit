import { describe, expect, it } from 'vitest';
import { memoryScoreboard } from '../../../assets/foundation/game/scoreboard';
import {
  BALL_RADIUS,
  BRICK_COLORS,
  BRICK_SIZE,
  BrickVM,
  PADDLE_SIZE,
} from '../../../assets/modules/mini-brick/BrickVM';

/**
 * mini-brick 的全部判据 —— node 里跑，没有 `cc`、没有渲染、没有 Creator。
 * 反弹角、清台、掉球都能在这里问，不用开编辑器一局一局试。
 */

/** 按 60fps 推进 `seconds` 秒。 */
const run = (vm: BrickVM, seconds: number): void => {
  for (let i = 0; i < Math.round(seconds * 60); i++) vm.step(1 / 60);
};

/** 发好球、按需摆一个初始速度方向。 */
const served = (): BrickVM => {
  const vm = new BrickVM();
  vm.tap();
  return vm;
};

describe('BrickVM · 建墙', () => {
  it('8 列 × 4 行 = 32 块，四色各占一行，整体居中', () => {
    const vm = new BrickVM();
    expect(vm.bricks).toHaveLength(32);
    expect(vm.bricksLeft).toBe(32);

    const xs = Array.from(new Set(vm.bricks.map((b) => b.x))).sort((a, b) => a - b);
    expect(xs).toHaveLength(8);
    expect(xs[0]).toBe(-224); // 原版 176 → 居中即 -224
    expect(xs[7]).toBe(224);

    // 每行一色，从上往下 blue → green → yellow → red（原版 C2 里 y 越小越靠上）。
    const rows = Array.from(new Set(vm.bricks.map((b) => b.y))).sort((a, b) => b - a);
    rows.forEach((y, i) => {
      const row = vm.bricks.filter((b) => b.y === y);
      expect(row).toHaveLength(8);
      expect(row.every((b) => b.color === BRICK_COLORS[i])).toBe(true);
    });
  });
});

describe('BrickVM · 板与球', () => {
  it('没发球时球贴在板上跟着走 —— 拖板不会把球甩下去', () => {
    const vm = new BrickVM();
    vm.aim(150);
    run(vm, 0.5);
    expect(vm.ballX).toBe(150);
    expect(vm.ballY).toBe(vm.paddleY + PADDLE_SIZE.height / 2 + BALL_RADIUS);
    expect(vm.phase.value).toBe('ready');
  });

  it('板被夹在场内 —— 原版的 BoundToLayout', () => {
    const vm = new BrickVM();
    vm.aim(99999);
    expect(vm.paddleX).toBe(vm.halfWidth - PADDLE_SIZE.width / 2);
    vm.aim(-99999);
    expect(vm.paddleX).toBe(-vm.halfWidth + PADDLE_SIZE.width / 2);
  });

  it('发球向**上** —— 原版角度 90 是向下的，照搬就等于立刻掉出去', () => {
    const vm = served();
    expect(vm.phase.value).toBe('playing');
    expect(vm.ballVY).toBeGreaterThan(0);
    expect(vm.ballVX).toBe(0);
  });

  it('出射角挂在击球点偏移上 —— 打板中间上下走，打板边斜着飞', () => {
    const straight = new BrickVM({ halfHeight: 300 });
    straight.tap();
    straight.ballVY = -600; // 让它掉回板上
    straight.ballY = straight.paddleY + 40;
    run(straight, 0.05);
    expect(Math.abs(straight.ballVX)).toBeLessThan(1);

    const edge = new BrickVM({ halfHeight: 300 });
    edge.tap();
    edge.ballVY = -600;
    edge.ballY = edge.paddleY + 40;
    edge.ballX = edge.paddleX + PADDLE_SIZE.width / 2; // 打在板的右缘
    run(edge, 0.05);
    expect(edge.ballVX).toBeGreaterThan(100); // 往右斜着飞出去
    expect(edge.ballVY).toBeGreaterThan(0);
  });

  it('左右墙和天花板都弹得回来', () => {
    const vm = served();
    vm.ballX = vm.halfWidth - BALL_RADIUS - 1;
    vm.ballVX = 500;
    vm.ballVY = 0;
    run(vm, 0.1);
    expect(vm.ballVX).toBeLessThan(0);
    expect(vm.ballX).toBeLessThanOrEqual(vm.halfWidth - BALL_RADIUS);

    const top = served();
    top.ballY = top.halfHeight - BALL_RADIUS - 1;
    top.ballVY = 500;
    top.ballVX = 0;
    top.step(1 / 60);
    expect(top.ballVY).toBeLessThan(0);
  });
});

describe('BrickVM · 砖与结算', () => {
  it('撞一块砖：砖没了、+1 分、球被弹开', () => {
    const vm = served();
    // 取**最下面那行**的一块：从下往上打时它是第一个挡路的，判据不会跟上面几行纠缠。
    const brick = vm.bricks[vm.bricks.length - 1];
    vm.ballX = brick.x;
    vm.ballY = brick.y - BRICK_SIZE.height / 2 - BALL_RADIUS + 1; // 从下面顶上去
    vm.ballVX = 0;
    vm.ballVY = 300;
    vm.step(1 / 60);
    expect(brick.alive).toBe(false);
    expect(vm.score.value).toBe(1);
    expect(vm.ballVY).toBeLessThan(0); // 顶完往回落
  });

  it('打光整面墙 → clear，分数留着，点一下开下一面', () => {
    const vm = served();
    for (const brick of vm.bricks.slice(0, 31)) brick.alive = false;
    vm.score.value = 31;
    const last = vm.bricks[31];
    vm.ballX = last.x;
    vm.ballY = last.y;
    vm.step(1 / 60);
    expect(vm.phase.value).toBe('clear');
    expect(vm.score.value).toBe(32);

    vm.tap();
    expect(vm.phase.value).toBe('ready');
    expect(vm.bricksLeft).toBe(32); // 新一面
    expect(vm.score.value).toBe(32); // 分数接着算
  });

  it('球掉出场底 → dead，成绩交给记分板，点一下从头来', () => {
    const board = memoryScoreboard();
    const vm = new BrickVM({ scoreboard: board });
    vm.tap();
    vm.score.value = 7;
    vm.ballY = -vm.halfHeight;
    vm.ballVX = 0;
    vm.ballVY = -600;
    run(vm, 0.2);
    expect(vm.phase.value).toBe('dead');
    expect(board.best()).toBe(7);
    expect(vm.best.value).toBe(7);
    expect(vm.newRecord.value).toBe(true);
    expect(vm.hint.value).toContain('新纪录');

    vm.tap();
    expect(vm.phase.value).toBe('ready');
    expect(vm.score.value).toBe(0);
    expect(vm.newRecord.value).toBe(false);
  });

  it('没破纪录就不吹 —— 记分板说了算，VM 不自己比', () => {
    const vm = new BrickVM({ scoreboard: memoryScoreboard(50) });
    expect(vm.best.value).toBe(50);
    vm.tap();
    vm.score.value = 3;
    vm.ballY = -vm.halfHeight - 100;
    vm.step(1 / 60);
    expect(vm.phase.value).toBe('dead');
    expect(vm.newRecord.value).toBe(false);
    expect(vm.best.value).toBe(50);
  });

  it('球快到一帧能跨过一整块砖时也打得中 —— 子步切分', () => {
    const vm = served();
    const brick = vm.bricks[vm.bricks.length - 1]; // 最下面那行，路上没有别的砖
    vm.ballX = brick.x;
    vm.ballY = brick.y - 300;
    vm.ballVX = 0;
    vm.ballVY = 9000; // 一帧 300px，远超一块砖的 32 高
    vm.step(1 / 30);
    expect(brick.alive).toBe(false);
  });
});

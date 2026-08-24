import { describe, expect, it } from 'vitest';
import { PlaneVM, ROCK_HALF_WIDTH, TILE } from '../../../assets/modules/mini-plane/PlaneVM';

/**
 * 玩法的全部判据 —— 全在 node 里跑，没有 `cc`、没有渲染、没有 Creator。
 * 这正是「逻辑一律进 VM」换来的东西：手感参数（重力 / 抬升 / 缝宽 / 出岩石节奏）改一个数，
 * 这里立刻告诉你撞不撞、计不计分，不用开编辑器。
 */

/** 固定随机源，让缝隙位置可复现。VM 每次取缝用两次 `rand()`，喂 `(1, 0)` 即抖到正上限。 */
const fixedRand = (...values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length];
};

/** 按 60fps 推进 `seconds` 秒。 */
const run = (vm: PlaneVM, seconds: number): void => {
  for (let i = 0; i < Math.round(seconds * 60); i++) vm.step(1 / 60);
};

/**
 * 同上，但每帧先把飞机按在 `y` 上、速度清零 —— 只想看出岩石节奏时用，
 * 免得它自己先掉到地上，测试就跑不到 2 秒。
 */
const hover = (vm: PlaneVM, seconds: number, y: number): void => {
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    vm.y = y;
    vm.vy = 0;
    vm.step(1 / 60);
  }
};

describe('PlaneVM · 阶段', () => {
  it('ready：世界已经在卷，但飞机不掉 —— 原版就是「先动起来，等你点」', () => {
    const vm = new PlaneVM();
    const y = vm.y;
    run(vm, 1);
    expect(vm.y).toBe(y);
    expect(vm.vy).toBe(0);
    expect(vm.groundScroll).toBeGreaterThan(0);
    expect(vm.rocks).toHaveLength(0); // 没开始就不出岩石
  });

  it('点一下进 playing 并立刻获得抬升速度', () => {
    const vm = new PlaneVM();
    vm.tap();
    expect(vm.phase.value).toBe('playing');
    expect(vm.vy).toBe(420);
  });

  it('重力把抬升吃回去：一帧之内速度就在往下掉', () => {
    const vm = new PlaneVM();
    const start = vm.y;
    vm.tap();
    vm.step(1 / 60);
    expect(vm.vy).toBeCloseTo(420 - 1080 / 60, 6);
    expect(vm.y).toBeGreaterThan(start);
  });

  it('机身角度只是速度的线性映射，且两头夹住不打转', () => {
    const vm = new PlaneVM();
    vm.vy = 420;
    expect(vm.angle).toBe(14); // 抬头
    vm.vy = -420;
    expect(vm.angle).toBe(-14); // 低头
    vm.vy = -100000;
    expect(vm.angle).toBe(-75); // 夹住
  });
});

describe('PlaneVM · 岩石', () => {
  it('开局 2 秒出第一对，早一点都不出', () => {
    const vm = new PlaneVM({ rand: fixedRand(0.5) });
    vm.tap();
    hover(vm, 1.9, 30);
    expect(vm.rocks).toHaveLength(0);
    hover(vm, 0.2, 30);
    expect(vm.rocks).toHaveLength(1);
  });

  it('默认参数就是原版那组数 —— 换算表代回 (400, 240) 必须一比一', () => {
    const vm = new PlaneVM();
    expect(vm.planeX).toBe(-272);
    expect(vm.groundY).toBe(-180);
    expect(vm.gapHalf).toBe(70.5); // 净空 141
    expect(vm.halfWidth).toBe(400);
  });

  it('缝隙抖动幅度是场高的固定比例 —— 竖屏拉高之后缝照样铺满整场，不挤在某一头', () => {
    const jitterOf = (halfHeight: number) => {
      const up = new PlaneVM({ halfHeight, rand: fixedRand(1, 0) }); // rand()-rand() = +1
      const mid = new PlaneVM({ halfHeight, rand: fixedRand(0.5) }); // = 0，取基准
      up.tap();
      mid.tap();
      hover(up, 2.1, 0);
      hover(mid, 2.1, 0);
      return up.rocks[0].gapY - mid.rocks[0].gapY;
    };
    expect(jitterOf(240)).toBeCloseTo(240 * 0.25, 6);
    expect(jitterOf(711)).toBeCloseTo(711 * 0.25, 6);
  });

  it('飞过机头 +1 分，且只加一次', () => {
    const vm = new PlaneVM({ rand: fixedRand(0.5) });
    vm.tap();
    vm.rocks.push({ x: vm.planeX + 1, gapY: vm.y, passed: false });
    vm.step(1 / 60);
    expect(vm.score.value).toBe(1);
    vm.step(1 / 60);
    expect(vm.score.value).toBe(1);
  });

  it('出屏的岩石会被删掉 —— 否则数组只涨不落', () => {
    const vm = new PlaneVM({ rand: fixedRand(0.5) });
    vm.tap();
    vm.rocks.push({ x: -vm.halfWidth - ROCK_HALF_WIDTH - 1, gapY: vm.y, passed: true });
    vm.step(1 / 60);
    expect(vm.rocks).toHaveLength(0);
  });
});

describe('PlaneVM · 坠机', () => {
  it('掉到地面上沿以下就坠机，并刷新最好成绩', () => {
    const vm = new PlaneVM();
    vm.tap();
    vm.score.value = 3;
    run(vm, 5); // 不再点，一路掉到地面
    expect(vm.phase.value).toBe('dead');
    expect(vm.best.value).toBe(3);
  });

  it('没在缝里就是撞 —— 岩石上下顶到场边', () => {
    const vm = new PlaneVM({ rand: fixedRand(0.5) });
    vm.tap();
    vm.rocks.push({ x: vm.planeX, gapY: vm.y + vm.gapHalf * 3, passed: false });
    vm.step(1 / 60);
    expect(vm.phase.value).toBe('dead');
  });

  it('对准缝就能过去', () => {
    const vm = new PlaneVM({ rand: fixedRand(0.5) });
    vm.tap();
    vm.rocks.push({ x: vm.planeX, gapY: vm.y, passed: false });
    vm.step(1 / 60);
    expect(vm.phase.value).toBe('playing');
  });

  it('坠机后世界停住，点一下才重开', () => {
    const vm = new PlaneVM();
    vm.tap();
    run(vm, 5);
    const frozen = { y: vm.y, scroll: vm.groundScroll };
    run(vm, 1);
    expect(vm.y).toBe(frozen.y);
    expect(vm.groundScroll).toBe(frozen.scroll);

    vm.score.value = 7;
    vm.best.value = 9;
    vm.tap();
    expect(vm.phase.value).toBe('ready'); // 重开后仍等一次点击，不会直接开跌
    expect(vm.score.value).toBe(0);
    expect(vm.best.value).toBe(9); // 最好成绩留着
    expect(vm.rocks).toHaveLength(0);
  });
});

describe('PlaneVM · 时间与卷动', () => {
  it('单帧步长被夹住 —— 卡一下不该让飞机瞬移穿过岩石', () => {
    const a = new PlaneVM();
    const b = new PlaneVM();
    a.tap();
    b.tap();
    a.step(10);
    b.step(1 / 30);
    expect(a.y).toBeCloseTo(b.y, 6);
  });

  it('卷动偏移始终落在一块平铺宽度内 —— View 才能只摆两份接龙', () => {
    const vm = new PlaneVM();
    run(vm, 30);
    expect(vm.groundScroll).toBeGreaterThanOrEqual(0);
    expect(vm.groundScroll).toBeLessThan(TILE.ground);
    expect(vm.backgroundScroll).toBeLessThan(TILE.background);
  });

  it('背景比地面卷得慢 —— 视差', () => {
    const vm = new PlaneVM();
    vm.step(1 / 60);
    expect(vm.backgroundScroll).toBeCloseTo(vm.groundScroll / 2, 6);
  });
});

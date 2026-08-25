import { describe, expect, it } from 'vitest';
import {
  PLANE_ART,
  PlaneVM,
  ROCK_HALF_WIDTH,
  TILE,
} from '../../../assets/modules/mini-plane/PlaneVM';

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

/**
 * **只跑判定，不推进世界** —— `step(0)` 各项增量都是 0，剩下的只有碰撞检测。
 * 于是可以把飞机和岩石摆到一个精确的几何位置上问「这样算不算撞」，不被那一帧的位移搅浑。
 */
const probe = (vm: PlaneVM): string => {
  vm.step(0);
  return vm.phase.value;
};

/** 摆一局：起飞、按住不动、按需摆一对岩石，返回 `probe` 的结果。 */
const poseWithRock = (rockDx: number, gapY: number, y?: number): string => {
  const vm = new PlaneVM();
  vm.tap();
  vm.vy = 0;
  if (y !== undefined) vm.y = y;
  vm.rocks.push({ x: vm.planeX + rockDx, gapY, passed: false });
  return probe(vm);
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
  it('机头姿态进判定 —— 同一高度，平飞过得去，俯冲就啃地', () => {
    const level = new PlaneVM();
    level.tap();
    level.vy = 0;
    level.y = level.groundY + 40;
    expect(probe(level)).toBe('playing');

    const dive = new PlaneVM();
    dive.tap();
    dive.vy = -2250; // 角度夹到下限
    dive.y = dive.groundY + 40;
    expect(dive.angle).toBe(-75);
    expect(probe(dive)).toBe('dead');
  });

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

  it('岩石是根锥子 —— 尖端旁边那片空气飞得过去（矩形模型这里必死）', () => {
    const vm = new PlaneVM();
    // 缝上沿切在机身顶下方 20：机身有 20 高**露在缝外**。矩形模型只问「出没出缝」，出了就死。
    const gapY = vm.y + PLANE_ART.height / 2 - 20 - vm.gapHalf;
    // 岩石正对机身：锥尖就落在机身覆盖的那几列里 → 真撞。
    expect(poseWithRock(0, gapY)).toBe('dead');
    // 岩石往边上挪 70：那个高度上岩石只有十来像素宽，机身翼尖还差一大截 → 过得去。
    expect(poseWithRock(-70, gapY)).toBe('playing');
    expect(poseWithRock(70, gapY)).toBe('playing');
  });

  it('锥尖偏右，致命窗口跟着偏 —— 只有逐像素才看得见这种不对称', () => {
    const vm = new PlaneVM();
    const gapY = vm.y + PLANE_ART.height / 2 - 14 - vm.gapHalf;
    // 贴图里尖端那几行占 x∈[59,71]，图心却在 54 —— 尖端整体右偏约 11px。
    // 于是同样贴 50 过去，岩石在左边会蹭到、在右边蹭不到。
    // （矩形模型两边都得死：50 < 半宽 54 + 机身半宽。实测致命窗口是 dx∈[-55, 23]。）
    expect(poseWithRock(-50, gapY)).toBe('dead');
    expect(poseWithRock(50, gapY)).toBe('playing');
  });

  it('岩石被纵向拉伸，判定跟着倍率折算 —— 根部照样是实心的', () => {
    const vm = new PlaneVM();
    // 缝抬到最高处：下面那根被拉得最长，机身待在场底附近仍在它体内。
    const gapY = vm.y + vm.halfHeight * 0.25;
    expect(poseWithRock(0, gapY, vm.groundY + 100)).toBe('dead');
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

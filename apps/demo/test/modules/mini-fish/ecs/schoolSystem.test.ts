import { describe, expect, it } from 'vitest';
import { createEcsWorld, Position, type EcsWorld } from '@cck/ecs-bitecs';
import { Angle, PathFollow, School } from '../../../../assets/modules/mini-fish/ecs/components';
import { spawnFish } from '../../../../assets/modules/mini-fish/ecs/feedSystem';
import { pathSystem } from '../../../../assets/modules/mini-fish/ecs/pathSystem';
import { driftCap, schoolSystem } from '../../../../assets/modules/mini-fish/ecs/schoolSystem';
import { PATHS, poseAt } from '../../../../assets/modules/mini-fish/content/paths';

/** 跟 `FishVM` 的流水线同序：先摆槽位，再让它摆。 */
function tick(w: EcsWorld, dt: number, times = 1): void {
  for (let i = 0; i < times; i++) {
    w.time.delta = dt;
    w.time.elapsed += dt;
    pathSystem(w);
    schoolSystem(w);
  }
}

const drift = (e: number): number => Math.hypot(School.dx[e], School.dy[e]);

describe('schoolSystem', () => {
  it('散鱼（school 0）一步都不摆 —— 随机底噪照旧沿中线走', () => {
    const w = createEcsWorld();
    const e = spawnFish(w, { kind: 0, pathId: 0, speed: 120 });
    tick(w, 1 / 60, 120);
    const slot = poseAt(PATHS[0], PathFollow.progress[e], 0);
    expect(Position.x[e]).toBeCloseTo(slot.x, 6);
    expect(Position.y[e]).toBeCloseTo(slot.y, 6);
    expect(drift(e)).toBe(0);
  });

  it('群里的鱼会偏离槽位 —— 「整群严丝合缝」正是要治的那个假', () => {
    const w = createEcsWorld();
    const e = spawnFish(w, { kind: 0, pathId: 0, speed: 120, school: 7, seed: 0.3 });
    tick(w, 1 / 60, 120); // 2 秒
    expect(drift(e)).toBeGreaterThan(3);
    const slot = poseAt(PATHS[0], PathFollow.progress[e], 0);
    expect(Math.hypot(Position.x[e] - slot.x, Position.y[e] - slot.y)).toBeCloseTo(drift(e), 4);
  });

  it('同群不同鱼摆得不一样 —— 相位来自 seed，整群同步就还是呆板', () => {
    const w = createEcsWorld();
    const a = spawnFish(w, { kind: 0, pathId: 0, speed: 120, school: 1, seed: 0 });
    const b = spawnFish(w, { kind: 0, pathId: 0, speed: 120, school: 1, seed: 0.5, offset: 200 });
    tick(w, 1 / 60, 120);
    expect(Math.abs(School.dx[a] - School.dx[b])).toBeGreaterThan(1);
  });

  it('侧向偏移是队形、不是漫游：槽位本身照 offset 摆好，漫游只是叠在上面', () => {
    const w = createEcsWorld();
    const e = spawnFish(w, { kind: 0, pathId: 0, speed: 120, school: 1, seed: 0.2, offset: 90 });
    tick(w, 1 / 60, 60);
    const mid = poseAt(PATHS[0], PathFollow.progress[e], 0);
    const slot = poseAt(PATHS[0], PathFollow.progress[e], 90);
    expect(Math.hypot(slot.x - mid.x, slot.y - mid.y)).toBeCloseTo(90, 4);
    // 实际位置 = 槽位 + 位移，位移不许大到把 90 的偏移吃掉
    expect(Math.hypot(Position.x[e] - slot.x, Position.y[e] - slot.y)).toBeLessThan(driftCap(0));
  });

  /**
   * ⚠️ 阈值和时刻都是**量出来的**，不是拍的：把 `SEPARATE` 调成 0 再跑同一段，半秒时只分开
   * 14.9 像素（那是漫游自己晃出来的），而分离在场时是 48.1。取 0.5 秒 / 30 像素，这条断言问的
   * 才真是分离力；跑到 3 秒两者收敛到 48.3 比 37.2，那时候问就分不出来了。
   */
  it('槽位重叠的两条鱼会被推开（分离），半秒内就分得开', () => {
    const w = createEcsWorld();
    const a = spawnFish(w, { kind: 0, pathId: 0, speed: 120, school: 3, seed: 0 });
    const b = spawnFish(w, { kind: 0, pathId: 0, speed: 120, school: 3, seed: 0.5 });
    const gap = (): number => Math.hypot(Position.x[a] - Position.x[b], Position.y[a] - Position.y[b]);
    expect(gap()).toBe(0);
    tick(w, 1 / 60, 30); // 0.5 秒
    expect(gap()).toBeGreaterThan(30);
    tick(w, 1 / 60, 150); // 再跑 2.5 秒：停在「刚好不叠」的量级，不是弹飞
    expect(gap()).toBeGreaterThan(20);
    expect(gap()).toBeLessThan(2 * 28 + 12); // 判定半径和 56
  });

  it('位移封顶 —— 再自然也不许游出队形之外，否则编好的形状不作数', () => {
    const w = createEcsWorld();
    const ents = Array.from({ length: 6 }, (_, i) =>
      spawnFish(w, { kind: 5, pathId: 0, speed: 120, school: 4, seed: i / 6 }),
    );
    tick(w, 1 / 60, 600); // 六条全叠在一起硬挤 10 秒
    for (const e of ents) expect(drift(e)).toBeLessThanOrEqual(driftCap(5) + 1e-4);
    // 也得**够到**上限：封顶按鱼种算，给死一个小数字就是把大鱼又钉回轨道上
    expect(Math.max(...ents.map(drift))).toBeGreaterThan(driftCap(5) * 0.9);
  });

  /**
   * 一条鱼单独跑 `secs` 秒（自己一个群 ⇒ 没有分离力掺和），量它摆多远、摆多快。
   * 摆多快用 `dx` 的**变号次数**数，不用频率反解 —— 数出来的东西不会因为公式改了就失真。
   */
  function swimOf(kind: number, secs: number): { peak: number; turns: number } {
    const w = createEcsWorld();
    const e = spawnFish(w, { kind, pathId: 0, speed: 40, school: 1, seed: 0.3 });
    let peak = 0;
    let turns = 0;
    let sign = 0;
    for (let i = 0; i < secs * 60; i++) {
      tick(w, 1 / 60);
      peak = Math.max(peak, drift(e));
      const cur = Math.sign(School.dx[e]);
      if (cur !== 0 && sign !== 0 && cur !== sign) turns++;
      if (cur !== 0) sign = cur;
    }
    return { peak, turns };
  }

  /**
   * 摆幅要是个绝对像素，鲨鱼和黄鱼就摆一样多 —— 小鱼快活、大鱼看着仍旧钉在轨道上滑过去。
   * 幅度按 `r / R0` 缩放之后，大鱼摆得远；弹簧按 `R0 / r` 软化之后，它还摆得慢。
   */
  it('体型自动算进去：鲨鱼摆得比黄鱼远，而且慢', () => {
    const small = swimOf(2, 10); // 黄鱼 r17
    const big = swimOf(9, 10); // 鲨鱼 r102
    expect(big.peak).toBeGreaterThan(small.peak * 1.5);
    expect(big.turns).toBeLessThan(small.turns);
  });

  /**
   * 上一条只证明「体型接上了」—— 光按半径缩放也能过。这条挑**体型几乎一样、性格相反**的
   * 两种鱼：水母（r41，飘 `sway 1.3` / 松 `hold 0.5`）对河豚（r44，稳 `sway 0.7` / 紧 `hold 1.2`）。
   * 半径只差 3 像素，差别只可能来自表里那两列，砍掉哪一列这条都得红。
   */
  it('性格来自鱼种表：一样大的水母比河豚飘得多、也慢', () => {
    const jelly = swimOf(10, 60);
    const puffer = swimOf(7, 60);
    expect(jelly.peak).toBeGreaterThan(puffer.peak * 1.5);
    // 差得**明显** —— 只按体型算，41 对 44 连方向都是反的
    expect(jelly.turns).toBeLessThan(puffer.turns * 0.85);
  });

  it('不动朝向 —— fishFacing 在 ±90° 处翻上下，让摆动去碰它鱼会抽搐', () => {
    const w = createEcsWorld();
    const e = spawnFish(w, { kind: 0, pathId: 6, speed: 110, school: 1, seed: 0.4 }); // rise：竖直向上
    tick(w, 1 / 60, 120);
    expect(Angle.v[e]).toBeCloseTo(poseAt(PATHS[6], PathFollow.progress[e]).angle, 6);
  });

  /**
   * 同一份内容 + 同一串 `dt` ⇒ 同一个画面。编辑器的走带是「从 0 重放到第 N 秒」，
   * 不确定就意味着拖一下走带鱼群就换个样；将来跟服务端逐行对照也靠这条。
   */
  it('确定性：两个世界跑同一串 dt，位置逐位相同', () => {
    const run = (): number[] => {
      const w = createEcsWorld();
      const ents = Array.from({ length: 4 }, (_, i) =>
        spawnFish(w, { kind: 2, pathId: 4, speed: 120, school: 9, seed: i / 4, offset: i * 40 - 60 }),
      );
      tick(w, 1 / 60, 240);
      return ents.flatMap((e) => [Position.x[e], Position.y[e]]);
    };
    expect(run()).toEqual(run());
  });

/**
   * bitECS 的 SoA 数组按 eid 索引、eid 会回收，所以新鱼拿到的槽位里留着**上一条鱼摆到一半**
   * 的状态。这里直接把一段槽位弄脏来模拟（等真的回收不可靠 —— bitECS 攒够一批才发回来）。
   */
  it('槽位里的脏值必须被写满 —— 不清就是新鱼一出生就歪在旁边、还带着速度', () => {
    for (let e = 0; e < 256; e++) {
      School.dx[e] = 99;
      School.dy[e] = -99;
      School.vx[e] = 9;
      School.vy[e] = -9;
      School.gid[e] = 123;
      School.seed[e] = 0.9;
    }
    const w = createEcsWorld();
    const fresh = spawnFish(w, { kind: 0, pathId: 0, speed: 120 });
    expect(drift(fresh)).toBe(0);
    expect(School.vx[fresh]).toBe(0);
    expect(School.vy[fresh]).toBe(0);
    expect(School.gid[fresh]).toBe(0); // 没给 school 就是散鱼，别继承上一条的群
    expect(School.seed[fresh]).toBe(0);
  });
});

import { describe, it, expect } from 'vitest';
import { addEntity, addComponent } from 'bitecs';
import { createEcsWorld, createEcsRunner } from '../../world';
import { Position, Velocity, Circle, Seeker, Static } from '../components';
import { createSpatialHash } from '../hash';
import { createFlowField } from '../flow-field';
import {
  createSpatialIndexSystem,
  createSeekSystem,
  createFlowFollowSystem,
  createSeparationSystem,
  createCollisionSystem,
  movementSystem,
} from '../systems';

type W = ReturnType<typeof createEcsWorld>;

/** 造一个带 Position+Velocity+Circle(可选 Seeker) 的实体。 */
function spawn(w: W, x: number, y: number, r = 1, seeker = true): number {
  const e = addEntity(w);
  addComponent(w, Position, e);
  addComponent(w, Velocity, e);
  addComponent(w, Circle, e);
  if (seeker) addComponent(w, Seeker, e);
  Position.x[e] = x;
  Position.y[e] = y;
  Circle.r[e] = r;
  return e;
}

describe('SpatialHash', () => {
  it('queryNeighbors 命中邻域、漏掉远处;clear 后查空', () => {
    const h = createSpatialHash(2);
    h.insert(1, 0, 0);
    h.insert(2, 1, 1); // 邻近(同格)
    h.insert(3, 100, 100); // 远
    const hit = new Set<number>();
    h.queryNeighbors(0, 0, 2, (id) => hit.add(id));
    expect(hit.has(1)).toBe(true);
    expect(hit.has(2)).toBe(true);
    expect(hit.has(3)).toBe(false);

    h.clear();
    const after: number[] = [];
    h.queryNeighbors(0, 0, 2, (id) => after.push(id));
    expect(after).toEqual([]);
  });
});

describe('FlowField', () => {
  const out: [number, number] = [0, 0];

  it('无墙时处处指向目标,目标格为 [0,0]', () => {
    const f = createFlowField(8, 8, 1);
    f.build([[0, 0]]);
    f.dirAt(5.5, 0.5, out); // 格(5,0),目标在 x=0
    expect(out[0]).toBeLessThan(0); // 朝 -x
    f.dirAt(0.5, 0.5, out); // 目标格
    expect(out).toEqual([0, 0]);
  });

  it('封死墙:另一侧不可达 → [0,0];留缺口 → 可达非零(绕行)', () => {
    const sealed = createFlowField(8, 8, 1);
    sealed.build([[0, 0]], (cx) => cx === 3); // x=3 整列墙,封死左右
    sealed.dirAt(5.5, 0.5, out); // 墙右侧
    expect(out).toEqual([0, 0]); // 不穿墙 → 不可达

    const gap = createFlowField(8, 8, 1);
    gap.build([[0, 0]], (cx, cy) => cx === 3 && cy !== 0); // cy=0 留缺口
    gap.dirAt(5.5, 0.5, out);
    expect(out[0] === 0 && out[1] === 0).toBe(false); // 经缺口可达
  });
});

describe('systems', () => {
  it('spatialIndex:建索引后能查到实体', () => {
    const w = createEcsWorld();
    const e = spawn(w, 3, 3, 1, false);
    const hash = createSpatialHash(2);
    createEcsRunner(w, [createSpatialIndexSystem(hash)]).tick(0.016);
    const hit: number[] = [];
    hash.queryNeighbors(3, 3, 2, (id) => hit.push(id));
    expect(hit).toContain(e);
  });

  it('seek:Seeker 速度指向 target;非 Seeker 不动', () => {
    const w = createEcsWorld();
    const target = spawn(w, 10, 0, 1, false);
    const enemy = spawn(w, 0, 0, 1, true);
    const bystander = spawn(w, 0, 5, 1, false);
    createEcsRunner(w, [createSeekSystem(target, 3)]).tick(0.016);
    expect(Velocity.x[enemy]).toBeCloseTo(3); // 指向 +x,speed 3
    expect(Velocity.y[enemy]).toBeCloseTo(0);
    expect(Velocity.x[bystander]).toBe(0); // 非 Seeker 未被处理
  });

  it('seek:arrive 半径内线速衰减(近目标减速,消除中心 churn)', () => {
    const w = createEcsWorld();
    const target = spawn(w, 100, 0, 1, false);
    const near = spawn(w, 95, 0, 1, true); // 距目标 5,arriveRadius 10 → 半速
    const far = spawn(w, 0, 0, 1, true); // 距目标 100 > 10 → 全速
    createEcsRunner(w, [createSeekSystem(target, 3, 10)]).tick(0.016);
    expect(Velocity.x[near]).toBeCloseTo(1.5); // 3 * 5/10
    expect(Velocity.x[far]).toBeCloseTo(3); // 半径外不衰减
  });

  it('seek:stopRadius 死区内站定(v=0),不再注入向心速度', () => {
    const w = createEcsWorld();
    const target = spawn(w, 0, 0, 1, false);
    const inside = spawn(w, 5, 0, 1, true); // 距目标 5 < stopRadius 10 → 站定
    createEcsRunner(w, [createSeekSystem(target, 3, 40, 10)]).tick(0.016);
    expect(Velocity.x[inside]).toBe(0);
    expect(Velocity.y[inside]).toBe(0);
  });

  it('flowFollow:速度跟随场方向', () => {
    const w = createEcsWorld();
    const e = spawn(w, 5.5, 0.5, 1, true);
    const field = createFlowField(8, 8, 1);
    field.build([[0, 0]]);
    createEcsRunner(w, [createFlowFollowSystem(field, 2)]).tick(0.016);
    expect(Velocity.x[e]).toBeLessThan(0); // 场指向 -x → 速度 -x
  });

  it('separation:重叠实体互推;孤立不变', () => {
    const w = createEcsWorld();
    const a = spawn(w, 0, 0, 1, false);
    const b = spawn(w, 1, 0, 1, false); // dist 1 < rr 2 → 重叠
    const lone = spawn(w, 50, 50, 1, false);
    const hash = createSpatialHash(2);
    createEcsRunner(w, [createSpatialIndexSystem(hash), createSeparationSystem(hash, 1)]).tick(0.016);
    expect(Velocity.x[a]).toBeLessThan(0); // a 推向 -x(远离 b)
    expect(Velocity.x[b]).toBeGreaterThan(0); // b 推向 +x
    expect(Velocity.x[lone]).toBe(0);
    expect(Velocity.y[lone]).toBe(0);
  });

  it('separation:perception>1 在接触前就避让', () => {
    const w = createEcsWorld();
    const a = spawn(w, 0, 0, 1, false);
    const b = spawn(w, 2.5, 0, 1, false); // dist 2.5 > 接触距离 rr 2:未接触
    const hash = createSpatialHash(2);
    createEcsRunner(w, [createSpatialIndexSystem(hash), createSeparationSystem(hash, 1, 1.5)]).tick(0.016);
    expect(Velocity.x[a]).toBeLessThan(0); // reach = 2*1.5 = 3 > 2.5 → 提前推开
    expect(Velocity.x[b]).toBeGreaterThan(0);
  });

  it('collision:重叠圆推开到不重叠;本不重叠不动', () => {
    const w = createEcsWorld();
    const a = spawn(w, 0, 0, 1, false);
    const b = spawn(w, 1.5, 0, 1, false); // dist 1.5 < rr 2 → 重叠
    const lone = spawn(w, 50, 0, 1, false);
    const lone0 = Position.x[lone];
    const hash = createSpatialHash(2);
    createEcsRunner(w, [createSpatialIndexSystem(hash), createCollisionSystem(hash)]).tick(0.016);
    const dist = Math.hypot(Position.x[b] - Position.x[a], Position.y[b] - Position.y[a]);
    expect(dist).toBeGreaterThanOrEqual(2 - 1e-3); // 推开到 >= r1+r2
    expect(Position.x[lone]).toBe(lone0); // 孤立不动
  });

  it('collision:Static 实体不被推开,动态对方独自让开', () => {
    const w = createEcsWorld();
    const wall = spawn(w, 0, 0, 1, false);
    addComponent(w, Static, wall);
    const mover = spawn(w, 1.5, 0, 1, false); // 与 wall 重叠(dist 1.5 < rr 2)
    const wx0 = Position.x[wall];
    const wy0 = Position.y[wall];
    const hash = createSpatialHash(2);
    createEcsRunner(w, [createSpatialIndexSystem(hash), createCollisionSystem(hash)]).tick(0.016);
    expect(Position.x[wall]).toBe(wx0); // 静止物纹丝不动
    expect(Position.y[wall]).toBe(wy0);
    const dist = Math.hypot(Position.x[mover] - Position.x[wall], Position.y[mover] - Position.y[wall]);
    expect(dist).toBeGreaterThanOrEqual(2 - 1e-3); // 动态方独自让到相切
  });

  it('collision:slop 容差内的微重叠不处理(免微抖)', () => {
    const w = createEcsWorld();
    const a = spawn(w, 0, 0, 1, false);
    const b = spawn(w, 1.9, 0, 1, false); // 重叠量 rr-d = 2-1.9 = 0.1
    const bx0 = Position.x[b];
    const ax0 = Position.x[a];
    const hash = createSpatialHash(2);
    createEcsRunner(w, [createSpatialIndexSystem(hash), createCollisionSystem(hash, 1, 0.2)]).tick(0.016); // slop 0.2 > 0.1
    expect(Position.x[a]).toBe(ax0); // 微重叠 ≤ slop → 纹丝不动
    expect(Position.x[b]).toBe(bx0);
  });

  it('collision:精确重合(d=0)也能分开(法线退化兜底)', () => {
    const w = createEcsWorld();
    const a = spawn(w, 5, 5, 1, false);
    const b = spawn(w, 5, 5, 1, false); // 完全重合 → 旧实现 d2===0 静默不推
    const hash = createSpatialHash(2);
    createEcsRunner(w, [createSpatialIndexSystem(hash), createCollisionSystem(hash)]).tick(0.016);
    const dist = Math.hypot(Position.x[b] - Position.x[a], Position.y[b] - Position.y[a]);
    expect(dist).toBeGreaterThanOrEqual(2 - 1e-3); // 推开到相切(r1+r2)
  });

  it('movement:秒制积分(tick(0.5) → x += v*0.5)', () => {
    const w = createEcsWorld();
    const e = spawn(w, 0, 0, 1, false);
    Velocity.x[e] = 10;
    Velocity.y[e] = -4;
    createEcsRunner(w, [movementSystem]).tick(0.5);
    expect(Position.x[e]).toBe(5);
    expect(Position.y[e]).toBe(-2);
  });

  it('集成 pipeline:群体朝 target 聚拢且两两不完全重叠', () => {
    const w = createEcsWorld();
    const target = spawn(w, 0, 0, 1, false);
    const hash = createSpatialHash(2);
    const agents: number[] = [];
    for (let gx = 0; gx < 6; gx++) {
      for (let gy = 0; gy < 6; gy++) {
        agents.push(spawn(w, 20 + gx * 0.5, 20 + gy * 0.5, 1, true)); // 固定分布,避免 flaky
      }
    }
    const dTo = (e: number): number =>
      Math.hypot(Position.x[e] - Position.x[target], Position.y[e] - Position.y[target]);
    const before = agents.reduce((s, e) => s + dTo(e), 0) / agents.length;

    const run = createEcsRunner(w, [
      createSpatialIndexSystem(hash),
      createSeekSystem(target, 8),
      createSeparationSystem(hash, 2),
      movementSystem,
      createCollisionSystem(hash),
    ]);
    for (let i = 0; i < 120; i++) run.tick(1 / 60);

    const after = agents.reduce((s, e) => s + dTo(e), 0) / agents.length;
    expect(after).toBeLessThan(before); // 聚拢

    let minD = Infinity;
    for (let i = 0; i < agents.length; i++) {
      for (let j = i + 1; j < agents.length; j++) {
        minD = Math.min(
          minD,
          Math.hypot(
            Position.x[agents[i]] - Position.x[agents[j]],
            Position.y[agents[i]] - Position.y[agents[j]],
          ),
        );
      }
    }
    expect(minD).toBeGreaterThan(0); // 不完全重合
  });
});

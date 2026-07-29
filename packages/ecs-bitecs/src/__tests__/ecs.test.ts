import { describe, it, expect } from 'vitest';
import {
  Types,
  defineComponent,
  defineQuery,
  addEntity,
  addComponent,
  removeComponent,
  removeEntity,
  hasComponent,
} from 'bitecs';
import { createTimer } from '@cck/core';
import { createEcsWorld, createEcsRunner, type EcsSystem } from '../world';

// 模块级组件 + 查询（bitECS：组件是全局 SoA 数组、按 eid 索引；查询按 world 过滤）。
const Position = defineComponent({ x: Types.f32, y: Types.f32 });
const Velocity = defineComponent({ x: Types.f32, y: Types.f32 });
const moveQuery = defineQuery([Position, Velocity]);

/** 秒制积分 system：Position += Velocity * world.time.delta。 */
const movement: EcsSystem = (w) => {
  const dt = w.time.delta;
  for (const eid of moveQuery(w)) {
    Position.x[eid] += Velocity.x[eid] * dt;
    Position.y[eid] += Velocity.y[eid] * dt;
  }
  return w;
};

/** 造一个带 Position+Velocity 的实体（addComponent 默认 reset → 分量归 0）。 */
function spawnMover(w: ReturnType<typeof createEcsWorld>, vx: number, vy: number): number {
  const eid = addEntity(w);
  addComponent(w, Position, eid);
  addComponent(w, Velocity, eid);
  Velocity.x[eid] = vx;
  Velocity.y[eid] = vy;
  return eid;
}

describe('ecs-bitecs · kit 接入胶水', () => {
  it('createEcsWorld 初始化 time 为 0', () => {
    const w = createEcsWorld();
    expect(w.time).toEqual({ delta: 0, elapsed: 0 });
  });

  it('增删组件 + 查询命中/落空', () => {
    const w = createEcsWorld();
    const eid = spawnMover(w, 1, 1);
    expect(hasComponent(w, Position, eid)).toBe(true);
    Position.x[eid] = 3;
    expect(Position.x[eid]).toBe(3);
    expect(moveQuery(w)).toContain(eid);

    removeComponent(w, Velocity, eid); // 少了 Velocity → 不再命中双组件查询
    expect(moveQuery(w)).not.toContain(eid);

    removeEntity(w, eid);
    expect(hasComponent(w, Position, eid)).toBe(false);
  });

  it('movementSystem 按秒制积分（tick(0.5) → x += v*0.5）', () => {
    const w = createEcsWorld();
    const eid = spawnMover(w, 10, -4);
    const runner = createEcsRunner(w, [movement]);
    runner.tick(0.5);
    expect(Position.x[eid]).toBe(5); // 0 + 10*0.5
    expect(Position.y[eid]).toBe(-2); // 0 + (-4)*0.5
  });

  it('tick 累加 elapsed、delta 为最近一帧', () => {
    const w = createEcsWorld();
    const runner = createEcsRunner(w, []);
    runner.tick(0.1);
    runner.tick(0.25);
    expect(w.time.delta).toBeCloseTo(0.25);
    expect(w.time.elapsed).toBeCloseTo(0.35);
  });

  it('多 system 按注册序执行', () => {
    const w = createEcsWorld();
    const order: string[] = [];
    const a: EcsSystem = (x) => {
      order.push('a');
      return x;
    };
    const b: EcsSystem = (x) => {
      order.push('b');
      return x;
    };
    createEcsRunner(w, [a, b]).tick(0.016);
    expect(order).toEqual(['a', 'b']);
  });

  it('接入 kit 帧驱动：ITimer.onFrame 驱动 runner，dispose 后停', () => {
    const w = createEcsWorld();
    const eid = spawnMover(w, 10, 0);
    const runner = createEcsRunner(w, [movement]);

    // kit 侧惯用接线（等同 engine driveWithDirector → timer.tick → onFrame）。
    const timer = createTimer();
    const dispose = timer.onFrame((dt) => runner.tick(dt));
    timer.tick(0.1);
    timer.tick(0.1);
    expect(Position.x[eid]).toBeCloseTo(2); // 10 * (0.1+0.1)
    expect(w.time.elapsed).toBeCloseTo(0.2);

    dispose(); // 退订后不再驱动
    timer.tick(0.1);
    expect(Position.x[eid]).toBeCloseTo(2); // 冻结
    expect(w.time.elapsed).toBeCloseTo(0.2);
  });
});

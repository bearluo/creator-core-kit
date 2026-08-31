import { describe, expect, it } from 'vitest';
import {
  createEcsWorld,
  createSpatialHash,
  createSpatialIndexSystem,
  defineQuery,
  Position,
  Velocity,
  type EcsWorld,
} from '@cck/ecs-bitecs';
import { Bullet, Net } from '../../../../assets/modules/mini-fish/ecs/components';
import {
  BULLET_SPEED,
  createBulletSystem,
  spawnBullet,
} from '../../../../assets/modules/mini-fish/ecs/bulletSystem';
import type { FireTicket, TicketBook } from '../../../../assets/modules/mini-fish/seams/economy';
import { spawnFish } from '../../../../assets/modules/mini-fish/ecs/feedSystem';
import { MAX_FISH_R } from '../../../../assets/modules/mini-fish/content/fish-kinds';
import { FIELD, FIELD_MARGIN } from '../../../../assets/modules/mini-fish/content/paths';

const bullets = defineQuery([Bullet]);
const nets = defineQuery([Net]);

/** 摆一条鱼在指定位置（`spawnFish` 会把它放在路径起点，这里挪过来）。 */
function fishAt(w: EcsWorld, kind: number, x: number, y: number): number {
  const eid = spawnFish(w, { kind, pathId: 0, speed: 0 });
  Position.x[eid] = x;
  Position.y[eid] = y;
  return eid;
}

function setup() {
  const world = createEcsWorld();
  const hash = createSpatialHash(MAX_FISH_R * 2);
  const index = createSpatialIndexSystem(hash);
  const tickets: TicketBook = new Map();
  const system = createBulletSystem(hash, tickets);
  /** 先重建索引再跑子弹 —— 跟真流水线里的顺序一致。 */
  const step = (dt: number): void => {
    world.time.delta = dt;
    index(world);
    system(world);
  };
  return { world, tickets, step };
}

const ticket = (level = 2, cannon = 0): FireTicket => ({ cannon, level });

describe('spawnBullet', () => {
  it('从炮口出发，按角度拆速度，并把票记在自己名下', () => {
    const { world, tickets } = setup();
    const t = ticket(5, 3);
    const b = spawnBullet(world, tickets, t, -240, -450, Math.PI / 2);
    expect(Position.x[b]).toBeCloseTo(-240, 4);
    expect(Position.y[b]).toBeCloseTo(-450, 4);
    expect(Bullet.cannon[b]).toBe(3);
    expect(Bullet.level[b]).toBe(5);
    expect(tickets.get(b)).toBe(t);
  });
});

describe('bulletSystem', () => {
  it('飞出场地就销毁，票一起作废 —— 打空了不退钱', () => {
    const { world, tickets, step } = setup();
    const b = spawnBullet(world, tickets, ticket(), 0, FIELD.height / 2 + FIELD_MARGIN + 1, 0);
    step(0.016);
    expect(bullets(world)).toHaveLength(0);
    expect(tickets.has(b)).toBe(false);
    expect(nets(world)).toHaveLength(0);
  });

  it('场上没鱼就继续飞，不销毁', () => {
    const { world, tickets, step } = setup();
    spawnBullet(world, tickets, ticket(), 0, 0, 0);
    step(0.016);
    expect(bullets(world)).toHaveLength(1);
    expect(nets(world)).toHaveLength(0);
  });

  it('碰到鱼 → 就地张网、子弹消失、票转给网（档位与炮位跟着票走）', () => {
    const { world, tickets, step } = setup();
    fishAt(world, 0, 100, 0);
    const t = ticket(6, 2);
    const b = spawnBullet(world, tickets, t, 100, 0, 0);
    step(0.016);

    expect(bullets(world)).toHaveLength(0);
    expect(tickets.has(b)).toBe(false);
    const net = nets(world)[0];
    expect(net).toBeDefined();
    expect(Net.cannon[net]).toBe(2);
    expect(Net.level[net]).toBe(6);
    expect(Position.x[net]).toBeCloseTo(100, 4);
    expect(tickets.get(net)).toBe(t);
  });

  it('同时够得着两条时打中**最近**的那条 —— 网张在近处不是远处', () => {
    const { world, tickets, step } = setup();
    // 鲨鱼半径 88，两条都在子弹的可及范围内，但一条更近
    fishAt(world, 9, 60, 0);
    fishAt(world, 9, 10, 0);
    spawnBullet(world, tickets, ticket(), 0, 0, 0);
    step(0.016);
    expect(Position.x[nets(world)[0]]).toBeCloseTo(0, 4); // 网张在子弹处
    expect(nets(world)).toHaveLength(1); // 一发只张一张网
  });

  it('够不着就不算命中', () => {
    const { world, tickets, step } = setup();
    fishAt(world, 0, 400, 0); // 红鱼半径 34，离子弹 400 像素
    spawnBullet(world, tickets, ticket(), 0, 0, 0);
    step(0.016);
    expect(nets(world)).toHaveLength(0);
    expect(bullets(world)).toHaveLength(1);
  });

  it('没票的子弹绝不凭空张网 —— 那等于客户端自己开了一炮', () => {
    const { world, tickets, step } = setup();
    fishAt(world, 0, 0, 0);
    const b = spawnBullet(world, tickets, ticket(), 0, 0, 0);
    tickets.delete(b); // 模拟票被弄丢
    step(0.016);
    expect(bullets(world)).toHaveLength(0);
    expect(nets(world)).toHaveLength(0);
  });

  it('速度大小恒为 BULLET_SPEED，方向按角度拆 —— 位移交给包里的 movementSystem', () => {
    const { world, tickets } = setup();
    const b = spawnBullet(world, tickets, ticket(), 0, 0, Math.PI / 3);
    expect(Math.hypot(Velocity.x[b], Velocity.y[b])).toBeCloseTo(BULLET_SPEED, 3);
    expect(Velocity.y[b] / Velocity.x[b]).toBeCloseTo(Math.tan(Math.PI / 3), 5);
  });
});

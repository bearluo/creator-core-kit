/**
 * 流水线第 5 步：子弹飞行 → 出界销毁 / 命中张网。
 *
 * 位置由包里现成的 `movementSystem` 推（子弹是匀速直线），本 system 只管**结果**：
 * 飞出场地 → 连票一起作废（打空了不退钱，跟街机一致）；碰到鱼 → 就地张一张网、子弹消失，
 * **票转给网**（见 {@link TicketBook}）。
 */
import {
  addComponent,
  addEntity,
  defineQuery,
  hasComponent,
  removeEntity,
  Circle,
  Position,
  Velocity,
  type EcsSystem,
  type EcsWorld,
  type SpatialHash,
} from '@cck/ecs-bitecs';
import { Bullet, Fish, Net } from './components';
import { MAX_FISH_R } from './fish-kinds';
import type { FireTicket, TicketBook } from './economy';
import { FIELD, FIELD_MARGIN } from './paths';

/** 子弹速度（像素/秒）与判定半径。 */
export const BULLET_SPEED = 1400;
export const BULLET_R = 12;

const bullets = defineQuery([Bullet, Position, Velocity]);

/** 开一发：票已经开好了（钱已经扣了），这里只负责让它飞。返回子弹 eid。 */
export function spawnBullet(
  world: EcsWorld,
  tickets: TicketBook,
  ticket: FireTicket,
  x: number,
  y: number,
  angle: number,
): number {
  const eid = addEntity(world);
  addComponent(world, Bullet, eid);
  addComponent(world, Position, eid);
  addComponent(world, Velocity, eid);
  Bullet.cannon[eid] = ticket.cannon;
  Bullet.level[eid] = ticket.level;
  Position.x[eid] = x;
  Position.y[eid] = y;
  Velocity.x[eid] = Math.cos(angle) * BULLET_SPEED;
  Velocity.y[eid] = Math.sin(angle) * BULLET_SPEED;
  tickets.set(eid, ticket);
  return eid;
}

export function createBulletSystem(hash: SpatialHash, tickets: TicketBook): EcsSystem {
  const halfW = FIELD.width / 2 + FIELD_MARGIN;
  const halfH = FIELD.height / 2 + FIELD_MARGIN;

  return (world) => {
    const ents = bullets(world);
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i];
      const x = Position.x[e];
      const y = Position.y[e];

      if (Math.abs(x) > halfW || Math.abs(y) > halfH) {
        tickets.delete(e);
        removeEntity(world, e);
        continue;
      }

      // 空间哈希是粗筛（回调里会有子弹、网、圈外的东西），narrow-phase 在这儿精判。
      // 取**最近**的那条而不是第一条：一发子弹只该打中它先撞上的那个。
      let hit = -1;
      let bestD2 = Infinity;
      hash.queryNeighbors(x, y, BULLET_R + MAX_FISH_R, (id) => {
        if (!hasComponent(world, Fish, id)) return;
        const dx = Position.x[id] - x;
        const dy = Position.y[id] - y;
        const reach = BULLET_R + Circle.r[id];
        const d2 = dx * dx + dy * dy;
        if (d2 <= reach * reach && d2 < bestD2) {
          bestD2 = d2;
          hit = id;
        }
      });
      if (hit < 0) continue;

      const ticket = tickets.get(e);
      tickets.delete(e);
      removeEntity(world, e);
      if (!ticket) continue; // 没票的子弹不该存在；真出现了就当它没打中，别凭空判一次生死

      const net = addEntity(world);
      addComponent(world, Net, net);
      addComponent(world, Position, net);
      Net.cannon[net] = ticket.cannon;
      Net.level[net] = ticket.level;
      Position.x[net] = x;
      Position.y[net] = y;
      tickets.set(net, ticket);
    }
    return world;
  };
}

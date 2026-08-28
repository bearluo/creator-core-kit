/**
 * 流水线第 6 步：**这一款的心脏** —— 网罩住谁 → 交给裁决 → 产出表现事件 → 炸弹鱼连锁 → 网消亡。
 *
 * 三条不显然的规矩：
 *
 * - **一网对一条鱼只判一次。** 被罩住就进 `settled`，不管死没死。所以炸弹连锁不会把刚从这张网
 *   底下逃掉的鱼再判一遍 —— 那等于一发子弹买了两次机会，RTP 立刻不成立。
 * - **连锁是一个队列不是一层递归。** 炸弹鱼炸死了另一条炸弹鱼就再炸一圈，天然收敛：
 *   每条鱼最多进 `settled` 一次，队列必然排空。
 * - **两张网罩住同一条鱼是顺序问题**，按 ticket 先后串行处理，先判死的先得 —— 后一张网查到的
 *   已经是个被 `removeEntity` 摘掉 `Fish` 组件的 eid，`collect` 那道过滤自然跳过它。
 */
import {
  defineQuery,
  hasComponent,
  removeEntity,
  Circle,
  Position,
  type EcsSystem,
  type EcsWorld,
  type SpatialHash,
} from '@cck/ecs-bitecs';
import { Bomb, Fish, Net } from './components';
import type { CaughtFish, FishArbiter, TicketBook } from './economy';
import type { FishEvent } from './events';
import { BOMB_RADIUS, MAX_FISH_R } from './fish-kinds';

/** 网的半径随档位增大：1 级 108，7 级 216（设计像素）。 */
export const NET_BASE_R = 90;
export const NET_STEP_R = 18;
export function netRadius(level: number): number {
  return NET_BASE_R + level * NET_STEP_R;
}

const nets = defineQuery([Net, Position]);

/** 一个「炸圈」：网自己是第一个，炸弹鱼死一条就往队列里再添一个。 */
interface Zone {
  readonly x: number;
  readonly y: number;
  readonly r: number;
}

export function createNetSystem(
  hash: SpatialHash,
  arbiter: FishArbiter,
  tickets: TicketBook,
  events: FishEvent[],
): EcsSystem {
  /** 罩住 `zone` 里还没被这张网判过的鱼。空间哈希是粗筛，这里精判。 */
  const collect = (world: EcsWorld, zone: Zone, settled: Set<number>): CaughtFish[] => {
    const out: CaughtFish[] = [];
    hash.queryNeighbors(zone.x, zone.y, zone.r + MAX_FISH_R, (id) => {
      if (settled.has(id) || !hasComponent(world, Fish, id)) return;
      const dx = Position.x[id] - zone.x;
      const dy = Position.y[id] - zone.y;
      const reach = zone.r + Circle.r[id];
      if (dx * dx + dy * dy > reach * reach) return;
      settled.add(id);
      out.push({ eid: id, kind: Fish.kind[id] });
    });
    return out;
  };

  return (world) => {
    const ents = nets(world);
    for (let i = 0; i < ents.length; i++) {
      const net = ents[i];
      const cannon = Net.cannon[net];
      const level = Net.level[net];
      const x = Position.x[net];
      const y = Position.y[net];
      const ticket = tickets.get(net);
      tickets.delete(net);
      removeEntity(world, net); // 一网只判一次，判完就没（张网多久是表现，View 收到 hit 自己播）

      events.push({ type: 'hit', cannon, level, x, y });
      if (!ticket) continue; // 没票的网不该存在；真出现了也绝不凭空判一次生死

      const settled = new Set<number>();
      const queue: Zone[] = [{ x, y, r: netRadius(level) }];
      while (queue.length > 0) {
        const zone = queue.shift() as Zone;
        const caught = collect(world, zone, settled);
        if (caught.length === 0) continue;

        const results = arbiter.resolve(ticket, caught);
        for (let k = 0; k < results.length; k++) {
          const s = results[k];
          if (!s.dead) continue;
          const fx = Position.x[s.eid];
          const fy = Position.y[s.eid];
          events.push({
            type: 'catch',
            eid: s.eid,
            kind: Fish.kind[s.eid],
            cannon,
            payout: s.payout,
            x: fx,
            y: fy,
          });
          if (hasComponent(world, Bomb, s.eid)) queue.push({ x: fx, y: fy, r: BOMB_RADIUS });
          removeEntity(world, s.eid);
        }
      }
    }
    return world;
  };
}

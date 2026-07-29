import { defineQuery, Not, hasComponent } from 'bitecs';
import type { EcsSystem } from '../world';
import { Position, Velocity, Circle, Seeker, Static } from './components';
import type { SpatialHash } from './hash';
import type { FlowField } from './flow-field';

/**
 * 大规模实体的空间/群体运动 system 组。典型一帧 pipeline（宿主组进 createEcsRunner）:
 *   spatialIndex → seek | flowFollow → separation → movement → collision
 * 见 docs/modules/spatial.md「行为与数据流」。
 */

const positioned = defineQuery([Position]);
const seekers = defineQuery([Position, Velocity, Seeker]);
const movers = defineQuery([Position, Velocity]);
const circles = defineQuery([Position, Circle]); // 碰撞:含 Static(它们是障碍,别人要绕开)
const dynamics = defineQuery([Position, Velocity, Circle, Not(Static)]); // 分离:只作用于会转向的动态体

/**
 * 两实体几乎重合(d≈0)时法线 (dx,dy)/d 退化为 0/0，de-overlap 会静默失效——
 * 几百实体涌向同一点(survivors 主场景)必然出现。用 id 哈希取一个确定性角度兜底：
 * 确定性 → 可测且不引入随机；按 pair 变化 → 避免整团朝同一方向平移。写入共享 scratch `_n`。
 */
const EPS2 = 1e-6;
const _n: [number, number] = [0, 0];
function degenerateNormal(a: number, b: number): void {
  const h = ((a * 73856093) ^ (b * 19349663)) & 1023;
  const ang = (h / 1024) * Math.PI * 2;
  _n[0] = Math.cos(ang);
  _n[1] = Math.sin(ang);
}

/** 每帧重建空间索引:hash.clear() + 遍历 Position 实体 insert。碰撞/分离的前置,应排在它们之前。 */
export function createSpatialIndexSystem(hash: SpatialHash): EcsSystem {
  return (w) => {
    hash.clear();
    const ents = positioned(w);
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i];
      hash.insert(e, Position.x[e], Position.y[e]);
    }
    return w;
  };
}

/**
 * 开阔场 seek:每个 Seeker 的 Velocity = normalize(target - self) * speed（覆盖写,每帧重置 Velocity）。
 * arrive-to-ring:`stopRadius` 内直接站定(v=0),`stopRadius..arriveRadius` 线性升速,之外全速。
 * 关键在**死区不注入向心速度**——本管线 seek 每帧覆盖 Velocity,所以「碰撞回写速度」那套无效,
 * 唯有从源头停止内灌才能消掉「已到达仍全速内挤 × 碰撞硬推开」逐帧对顶的中心 churn/闪烁。
 * 默认 stopRadius=arriveRadius=0 → 纯 seek,不改旧行为。见 docs/research/2026-07-29-swarm-separation-vs-collision.md。
 */
export function createSeekSystem(targetEid: number, speed: number, arriveRadius = 0, stopRadius = 0): EcsSystem {
  // ponytail: 统一 speed + 单 targetEid;enemy 多速度加 Speed{value} 组件、多目标改 Target tag 查询。
  return (w) => {
    const tx = Position.x[targetEid];
    const ty = Position.y[targetEid];
    const ents = seekers(w);
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i];
      const dx = tx - Position.x[e];
      const dy = ty - Position.y[e];
      const len = Math.hypot(dx, dy);
      if (len > 1e-6 && len > stopRadius) {
        const v =
          arriveRadius > stopRadius && len < arriveRadius
            ? (speed * (len - stopRadius)) / (arriveRadius - stopRadius)
            : speed;
        Velocity.x[e] = (dx / len) * v;
        Velocity.y[e] = (dy / len) * v;
      } else {
        Velocity.x[e] = 0; // 死区内站定:不再注入向心速度
        Velocity.y[e] = 0;
      }
    }
    return w;
  };
}

/** 有墙寻路:每个 Seeker 的 Velocity = field.dirAt(self) * speed（覆盖写）。field 由宿主按需 build。 */
export function createFlowFollowSystem(field: FlowField, speed: number): EcsSystem {
  const dir: [number, number] = [0, 0];
  return (w) => {
    const ents = seekers(w);
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i];
      field.dirAt(Position.x[e], Position.y[e], dir);
      Velocity.x[e] = dir[0] * speed;
      Velocity.y[e] = dir[1] * speed;
    }
    return w;
  };
}

/**
 * boids 分离（叠加写）:每个动态 Circle 查 hash 近邻,按距离反比累加「远离邻居」向量,Velocity += sep * strength。
 * `perception`>1 时在**接触前**(reach = (r1+r2)·perception)就开始避让 → 主动维持间距、把硬碰撞触发压到极低
 * (纯 boids 主间距的关键;拧 strength 会过冲反而更抖,拧 perception 才对)。依赖同帧前置 seek/flowFollow 已设基础 Velocity。
 */
export function createSeparationSystem(hash: SpatialHash, strength: number, perception = 1): EcsSystem {
  return (w) => {
    const ents = dynamics(w);
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i];
      const ex = Position.x[e];
      const ey = Position.y[e];
      const er = Circle.r[e];
      let sx = 0;
      let sy = 0;
      hash.queryNeighbors(ex, ey, er * 2 * perception, (other) => {
        if (other === e) return;
        const dx = ex - Position.x[other];
        const dy = ey - Position.y[other];
        const reach = (er + Circle.r[other]) * perception; // 感知距离(≥接触距离)
        const d2 = dx * dx + dy * dy;
        if (d2 < reach * reach) {
          let nx: number;
          let ny: number;
          let d: number;
          if (d2 > EPS2) {
            d = Math.sqrt(d2);
            nx = dx / d;
            ny = dy / d;
          } else {
            degenerateNormal(e, other);
            nx = _n[0];
            ny = _n[1];
            d = 0;
          }
          const push = (reach - d) / reach; // 越近越大,(0,1]
          sx += nx * push;
          sy += ny * push;
        }
      });
      Velocity.x[e] += sx * strength;
      Velocity.y[e] += sy * strength;
    }
    return w;
  };
}

/** 位移积分:Position += Velocity * world.time.delta（秒制）。 */
export const movementSystem: EcsSystem = (w) => {
  const dt = w.time.delta;
  const ents = movers(w);
  for (let i = 0; i < ents.length; i++) {
    const e = ents[i];
    Position.x[e] += Velocity.x[e] * dt;
    Position.y[e] += Velocity.y[e] * dt;
  }
  return w;
};

/**
 * 硬碰撞去重叠:近邻圆-圆重叠沿法线推开（改 Position;静止方不动,动态方独吞）。**稀发兜底**用——
 * 主间距应交给带 perception 的 separation,这里只清残留大重叠(见 research + docs/modules/spatial.md)。
 * `iterations` = 每帧松弛趟数(Gauss-Seidel):单趟对稀疏够用,密堆残留大时调高。默认 1。
 * `slop` = 容差:重叠量 ≤ slop 的微重叠不处理,免密堆里逐帧 snap 微抖(默认 0 = 严格,不改旧行为)。
 */
export function createCollisionSystem(hash: SpatialHash, iterations = 1, slop = 0): EcsSystem {
  // ponytail: 多趟复用帧初索引（每趟后位置略移,索引略陈但位移 < 一格,收敛仍好）;残留穿透下帧修。
  return (w) => {
    const ents = circles(w);
    for (let iter = 0; iter < iterations; iter++) {
      for (let i = 0; i < ents.length; i++) {
        const e = ents[i];
        const er = Circle.r[e];
        const eStatic = hasComponent(w, Static, e); // 每 e 一次,提出邻居回调外
        hash.queryNeighbors(Position.x[e], Position.y[e], er * 2, (other) => {
          if (other <= e) return; // 每对只处理一次（a<b）+ 跳过 self
          const dx = Position.x[other] - Position.x[e];
          const dy = Position.y[other] - Position.y[e];
          const rr = er + Circle.r[other];
          const d2 = dx * dx + dy * dy;
          if (d2 >= rr * rr) return;
          const oStatic = hasComponent(w, Static, other);
          if (eStatic && oStatic) return; // 两静止物不互推
          let nx: number;
          let ny: number;
          let total: number; // 需消除的总重叠量（沿法线两端分摊）
          if (d2 > EPS2) {
            const d = Math.sqrt(d2);
            nx = dx / d;
            ny = dy / d;
            total = rr - d;
          } else {
            degenerateNormal(e, other); // d≈0：法线退化，取确定性方向按完全重合推开
            nx = _n[0];
            ny = _n[1];
            total = rr;
          }
          if (total <= slop) return; // 微重叠在容差内 → 不推,免逐帧微抖
          // 静止方吃 0、动态方独吞全部;都动态则各让一半。
          const eShare = oStatic ? total : eStatic ? 0 : total / 2;
          const oShare = eStatic ? total : oStatic ? 0 : total / 2;
          Position.x[e] -= nx * eShare;
          Position.y[e] -= ny * eShare;
          Position.x[other] += nx * oShare;
          Position.y[other] += ny * oShare;
        });
      }
    }
    return w;
  };
}

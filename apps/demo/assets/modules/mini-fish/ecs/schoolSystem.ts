/**
 * 流水线第 3 步：**让一群鱼看着像活的**。
 *
 * `pathSystem` 刚把每条鱼摆到它的**槽位**上（路径中线 + 侧向偏移）。整群严丝合缝地保持队形
 * 游过全场，是一眼就能看穿的假 —— 真鱼群的形状一直在抖、在错位、在互相让位。这一步就在
 * 槽位上叠一层位移，槽位本身一点不改（编好的队形还是那个队形）。
 *
 * ## 只写了 boids 的一条半
 *
 * | boids 的三条规则 | 这儿谁在管 |
 * |---|---|
 * | 对齐（朝同一个方向） | **路径本身** —— 整群同速、同切线，天生就是对齐的 |
 * | 聚合（别掉队） | **槽位弹簧** —— 目标是编好的队形，比「群心」更听话：形状归内容说了算 |
 * | 分离（别叠一起） | 真的在算，同群内 O(n²) |
 *
 * 外加一条 boids 没有的**漫游**：两条不同频的正弦推着它慢慢晃，鱼群于是像在呼吸。
 * 相位与频率来自 `School.seed`（投喂源按群内序号发的），**不是随机数** —— 同一份内容 +
 * 同一串 `dt` 必须重放出同一个画面：编辑器的走带靠它，将来跟服务端逐行对照也靠它。
 *
 * ## 三处刻意的「不」
 *
 * - **不动朝向**。让鱼扭头追合成速度确实更生动，但 `render-map.fishFacing` 在 |角度| = 90°
 *   处翻转上下，而 `rise` 那种竖直路径正好压在这条线上 —— 摆一下翻一次，鱼会疯狂抽搐。
 *   位置在动、朝向不动，看上去就是鱼群在横着摆尾，正是要的。
 * - **位移封顶**（摆幅的 {@link CAP} 倍）。再自然也不许游出队形之外，否则编的人摆好的形状不作数了。
 * - **散鱼（`gid = 0`）一概不管**。随机底噪那些鱼没有队形可言，让它们照旧沿中线走 ——
 *   一群在摆、背景的散鱼不摆，反倒把「这是一群」凸出来了。
 *
 * ## 一套常数管全表是不够的
 *
 * 摆幅要是个绝对像素，鲨鱼（半径 102）和黄鱼（半径 17）摆一样多 —— 小鱼快活、大鱼看着仍旧
 * 钉在轨道上滑过去。所以**体型那一份自动给**（按 `r / R0` 缩放摆幅、按 `R0 / r` 软化弹簧 ⇒
 * 大鱼摆得远而缓），性格那一份交给鱼种表的 `sway` / `hold` 两列（水母飘、鲨鱼稳）。
 *
 * 只有**分离**全表一个值：两条鱼叠在一起就是不行，那是物理不是性格；它的**半径**本来就随
 * 鱼走（判定圈之和），已经是按鱼种来的了。
 */
import { Circle, defineQuery, Position, type EcsSystem } from '@cck/ecs-bitecs';
import { FISH_KINDS } from '../content/fish-kinds';
import { Fish, School } from './components';

const schooled = defineQuery([Fish, School, Position, Circle]);

/** 参照体型（像素）：表里小鱼那一档。摆幅与弹簧都按 `r / R0` 缩放。 */
const R0 = 24;
/** `R0` 那么大、`sway = 1` 的鱼的稳态摆幅（像素）。 */
const SWAY = 15;
/** `R0` 那么大、`hold = 1` 的鱼的回槽弹簧（1/s²）。 */
const SPRING = 5.5;
/** 阻尼比。略欠阻尼 ⇒ 回得干脆，又不像钉死在槽位上。 */
const ZETA = 0.68;
/** 位移封顶 = 摆幅的几倍。**绑在摆幅上**而不是给个绝对值：安静的鱼该连封顶也小。 */
const CAP = 2.6;
/** 分离：两条鱼的判定圈**叠上了**才互推，贴到圆心重合时的加速度（像素/s²）。 */
const SEPARATE = 300;

/**
 * 每种鱼的游法，从 {@link FISH_KINDS} 现推。下标同 `Fish.kind`。
 *
 * 现推不另存：`r` / `sway` / `hold` 一改，这儿跟着变，没有第二份会漂的数。
 */
const SWIM = FISH_KINDS.map((k) => {
  const scale = k.r / R0;
  const spring = (SPRING * k.hold) / scale; // 大鱼弹簧软 ⇒ 摆得慢
  return {
    spring,
    damp: 2 * ZETA * Math.sqrt(spring),
    amp: SWAY * scale * k.sway,
    /** 受迫频率跟着自然频率走 ⇒ 各体型的「快慢感」是一致的，不是大鱼大幅高频地抽 */
    wScale: Math.sqrt(spring / SPRING),
  };
});

/** 这种鱼最多能偏离槽位多远（像素）。给测试和 View 看的，运行时内部直接用 {@link SWIM}。 */
export function driftCap(kind: number): number {
  return (SWIM[kind]?.amp ?? 0) * CAP;
}

/**
 * 分桶与加速度的暂存，跨帧复用。
 *
 * 这不是「模块级单例」那条禁令说的那种状态：每次进来先清空、出去前用完即弃，
 * 两个 `FishVM`（游戏 + 编辑器预览）共用也不串 —— system 是同步跑完的，不会交错。
 */
const bucket = new Map<number, number[]>();
const accX: number[] = [];
const accY: number[] = [];

export const schoolSystem: EcsSystem = (world) => {
  const dt = world.time.delta;
  if (dt <= 0) return world;
  const t = world.time.elapsed;

  bucket.clear();
  const ents = schooled(world);
  for (let i = 0; i < ents.length; i++) {
    const gid = School.gid[ents[i]];
    if (gid === 0) continue;
    const list = bucket.get(gid);
    if (list) list.push(ents[i]);
    else bucket.set(gid, [ents[i]]);
  }

  for (const members of bucket.values()) {
    const n = members.length;

    // ① 先把加速度全算出来。**不边算边挪** —— 分离力得两边对称，谁先算谁占便宜就成了
    //    「排在前面的鱼把后面的推开、自己纹丝不动」。
    for (let i = 0; i < n; i++) {
      const e = members[i];
      const seed = School.seed[e];
      const s = SWIM[Fish.kind[e]];
      const w = (1.2 + 0.9 * seed) * s.wScale; // 每条鱼频率略不同 ⇒ 一群不会整齐划一地摆
      const wy = 1.7 * w;
      const ph = seed * 6.2832;
      // 受迫振子的稳态幅度 A = F/√((k−ω²)² + (cω)²)，这里反解出 F ——
      // 于是 `amp` 说的就是**真的摆幅（像素）**，改弹簧不会把幅度一起带跑
      const kx = s.spring - w * w;
      const cx = s.damp * w;
      const ky = s.spring - wy * wy;
      const cy = s.damp * wy;
      const fx = s.amp * Math.sqrt(kx * kx + cx * cx);
      const fy = s.amp * Math.sqrt(ky * ky + cy * cy);
      let ax = fx * Math.cos(w * t + ph) - s.spring * School.dx[e] - s.damp * School.vx[e];
      let ay = fy * Math.sin(wy * t + ph) - s.spring * School.dy[e] - s.damp * School.vy[e];

      const px = Position.x[e] + School.dx[e];
      const py = Position.y[e] + School.dy[e];
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const o = members[j];
        const r = Circle.r[e] + Circle.r[o];
        let ox = px - (Position.x[o] + School.dx[o]);
        let oy = py - (Position.y[o] + School.dy[o]);
        let d2 = ox * ox + oy * oy;
        if (d2 >= r * r) continue;
        if (d2 < 1e-4) {
          // 圆心重合 ⇒ 方向没定义。按 seed 定一个**确定**的方向推开，别 NaN 也别随机
          ox = Math.cos(seed * 6.2832);
          oy = Math.sin(seed * 6.2832);
          d2 = 1;
        }
        const d = Math.sqrt(d2);
        const push = (SEPARATE * (1 - d / r)) / d;
        ax += ox * push;
        ay += oy * push;
      }
      accX[i] = ax;
      accY[i] = ay;
    }

    // ② 积分，然后把位移加到槽位上
    for (let i = 0; i < n; i++) {
      const e = members[i];
      let vx = School.vx[e] + accX[i] * dt;
      let vy = School.vy[e] + accY[i] * dt;
      let dx = School.dx[e] + vx * dt;
      let dy = School.dy[e] + vy * dt;
      const cap = SWIM[Fish.kind[e]].amp * CAP;
      const d = Math.hypot(dx, dy);
      if (d > cap) {
        const k = cap / d;
        dx *= k;
        dy *= k;
        // 速度一起收：不收的话顶到上限的鱼会一直贴着边使劲，松开时弹一下
        vx *= k;
        vy *= k;
      }
      School.vx[e] = vx;
      School.vy[e] = vy;
      School.dx[e] = dx;
      School.dy[e] = dy;
      Position.x[e] += dx;
      Position.y[e] += dy;
    }
  }
  return world;
};

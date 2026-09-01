/**
 * mini-fish 自己的 ECS 组件（bitECS SoA，按 eid 索引）。
 *
 * **住 `assets/` 不住 npm 包**，判据见 [ADR-0019](../../../../docs/adr/0019-npm-package-base-vs-assets-boundary.md)：
 * npm 依赖统统落 AOT chunk（改它要热更 + 重启），而玩法字段恰恰是改得最勤的东西。
 * `Position` / `Velocity` / `Circle` 那三个**通用**原语相反 —— 它们在 `@cck/ecs-bitecs` 里，白拿。
 */
import { defineComponent, Types } from '@cck/ecs-bitecs';

/** 一条鱼。`kind` 是 {@link ../fish-kinds.FISH_KINDS} 的下标，倍率 / 半径 / 是否炸弹全查表。 */
export const Fish = defineComponent({ kind: Types.ui8 });

/** 沿路径游动：`pathId` 查 {@link ../paths.PATHS}，`t∈[0,1]` 是进度，`speed` 是像素/秒。 */
/**
 * 沿路径游动。`progress` 是**已走弧长比例** ∈[0,1]，不是贝塞尔参数 ——
 * 它曾经叫 `t`，而那个名字正是「鱼忽快忽慢」那个 bug 的根：外面按弧长推、`pointAt` 按参数解，
 * 两边都以为自己说的是同一个 t。改名不是洁癖，是让下一个人读到它时不会再搞错。
 */
export const PathFollow = defineComponent({
  pathId: Types.ui16,
  progress: Types.f32,
  speed: Types.f32,
});

/** 朝向（弧度）。`pathSystem` 每帧算好放这儿，View 直接拿去转节点，不自己做数学。 */
export const Angle = defineComponent({ v: Types.f32 });

/** 飞行中的一发。`cannon` 是哪门炮开的，`level` 是档位（= 消耗 = 赔付倍数）。 */
export const Bullet = defineComponent({ cannon: Types.ui8, level: Types.ui8 });

/**
 * 子弹命中处张开的一张网。**只活一帧** —— `bulletSystem` 建它，同帧 `netSystem` 判完就销毁
 * （「一网只判一次」，决策 D4）。网张开多久是**表现**，由 View 收到 `hit` 事件后自己播。
 */
export const Net = defineComponent({ cannon: Types.ui8, level: Types.ui8 });

/** tag：炸弹鱼（河豚）。死了要再炸一圈，见 `netSystem`。 */
export const Bomb = defineComponent();

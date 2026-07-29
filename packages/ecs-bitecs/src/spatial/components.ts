import { defineComponent, Types } from 'bitecs';

/**
 * spatial system 组的规范组件（bitECS SoA，按 eid 索引）。系统直接读写这些组件；
 * 项目可直接用,或抄这 ~5 行自定义同名组件后改系统查询。见 docs/modules/spatial.md 决策 #7。
 */

/** 世界坐标（Position.x[eid]）。 */
export const Position = defineComponent({ x: Types.f32, y: Types.f32 });
/** 每秒速度（秒制,对齐 world.time.delta）。 */
export const Velocity = defineComponent({ x: Types.f32, y: Types.f32 });
/** 碰撞/分离半径。 */
export const Circle = defineComponent({ r: Types.f32 });
/** tag:标记「会朝目标移动」的实体（seek/flowFollow 只处理它）。 */
export const Seeker = defineComponent();
/**
 * tag:标记「宿主手控/静态障碍」的 kinematic 实体（玩家、传送带、圆形石柱）。
 * 碰撞里不被推、只推开动态对方;分离/位移不作用于它——避免宿主每帧手写 Position 与物理系统抢写而抖动。
 */
export const Static = defineComponent();

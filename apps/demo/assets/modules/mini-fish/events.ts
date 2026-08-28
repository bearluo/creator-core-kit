/**
 * system 产出给 View 的**表现事件** —— 这是四道接缝里唯一的「输出侧缓冲」。
 *
 * 输入侧不搞命令队列（工厂闭包直接捕获依赖，沿用 `@cck/ecs-bitecs` 在本仓的既有姿势）；
 * 输出侧必须有，因为 system 零 `cc`、碰不到节点，只能把「刚发生了什么」记下来让 View 去演。
 * 数组**每帧清空**：`FishVM.tick` 开头清，View 在 tick 之后读完即弃 —— 没人存它，就不会有
 * 「上一帧的金币又飞了一次」这种事。
 *
 * ⚠️ 鱼的**生灭**不在这里：View 用 bitECS 的 `enterQuery` / `exitQuery` 自己 diff 就行。
 * 事件只记 query 看不出来的那部分 —— 尤其是「鱼没了」到底是被打死还是游出界，退出查询分不出来。
 */

/** 某门炮开了一发（给炮口火光、后坐力）。 */
export interface FireEvent {
  readonly type: 'fire';
  readonly cannon: number;
  readonly level: number;
  /** 弧度，+x 为 0。 */
  readonly angle: number;
}

/** 一张网在这里张开了（给张网动画）。半径由 `level` 决定，View 查 `netRadius`。 */
export interface HitEvent {
  readonly type: 'hit';
  readonly cannon: number;
  readonly level: number;
  readonly x: number;
  readonly y: number;
}

/** 一条鱼被打死了（给死亡动画 + 金币飞向那门炮）。**游出界的鱼不发这个**。 */
export interface CatchEvent {
  readonly type: 'catch';
  readonly eid: number;
  readonly kind: number;
  readonly cannon: number;
  readonly payout: number;
  readonly x: number;
  readonly y: number;
}

export type FishEvent = FireEvent | HitEvent | CatchEvent;

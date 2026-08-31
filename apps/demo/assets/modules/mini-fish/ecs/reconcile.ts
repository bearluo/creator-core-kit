/**
 * `enterQuery` / `exitQuery` → 「这一帧建哪些节点、拆哪些节点」的**纯函数**（零 `cc`）。
 *
 * ## 为什么不能直接照着两个数组做
 *
 * bitECS 的 `entered` / `exited` 是**两个独立数组**，同一个 eid 一帧内可以同时出现在两边，
 * 而数组里读不出这两件事谁先谁后。两种交错都真会发生：
 *
 * | 交错 | 怎么来的 | 照着数组做会怎样 |
 * |---|---|---|
 * | **enter → exit**（出生即死） | 子弹在炮口出生的那一帧就命中了正巧游过炮口的鱼 | 先跑 exit（表里还没有，空转）再跑 enter → 建出一个**实体已经不存在**的节点：它不在 query 里，位置永远不会被刷新，就停在 `(0, 0)`（**屏幕正中**）；也永远不会再 exit（它已经 exit 过了）→ 永久孤儿 |
 * | **exit → enter**（eid 被回收再分配） | bitECS 的 `removeEntity` 把 eid 还进池子，同帧 `addEntity` 又把它取出来 | 新租客的节点被 exit 那一步拆掉，或者 enter 覆盖了表里的旧节点、旧节点从此没人销毁 |
 *
 * 两种都在 demo 里真的踩到过：连打一分钟，`Bullets` 层下攒出十来个停在正中央不动的子弹。
 *
 * ## 判据：只问「这一帧结束时它还在不在 query 里」
 *
 * `alive` 就是这一帧 `query(world)` 的结果 —— 它是**结论**，不受交错顺序影响：
 *
 * - 在 `exited` 里且**不在** `alive` → 真的走了，拆。
 * - 在 `entered` 里且**在** `alive` → 真的来了，建（建之前先拆掉同 eid 的旧节点，应付 eid 回收）。
 * - 在 `entered` 里但**不在** `alive` → 出生即死，这一帧当它没来过，**别建**。
 */

/** 这一帧要拆的、要建的。`create` 里的每一个都要先拆掉同 eid 的旧节点（eid 会被回收重用）。 */
export interface NodeDiff {
  readonly drop: readonly number[];
  readonly create: readonly number[];
}

export function reconcileNodes(
  alive: readonly number[] | Uint32Array,
  entered: readonly number[] | Uint32Array,
  exited: readonly number[] | Uint32Array,
): NodeDiff {
  const live = new Set<number>();
  for (let i = 0; i < alive.length; i++) live.add(alive[i]);

  const drop: number[] = [];
  for (let i = 0; i < exited.length; i++) {
    if (!live.has(exited[i])) drop.push(exited[i]);
  }
  const create: number[] = [];
  for (let i = 0; i < entered.length; i++) {
    if (live.has(entered[i])) create.push(entered[i]);
  }
  return { drop, create };
}

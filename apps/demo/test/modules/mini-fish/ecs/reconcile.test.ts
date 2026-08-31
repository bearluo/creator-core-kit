import { describe, expect, it } from 'vitest';
import { reconcileNodes } from '../../../../assets/modules/mini-fish/ecs/reconcile';

/**
 * 这四条对应 `entered` / `exited` 两个数组能凑出的全部交错。第三条是真在 demo 里踩到的那个：
 * 连打一分钟，`Bullets` 层下攒出十来个停在屏幕正中不动的子弹。
 */
describe('reconcileNodes', () => {
  it('纯新增：建出来', () => {
    expect(reconcileNodes([1, 2], [2], [])).toEqual({ drop: [], create: [2] });
  });

  it('纯退出：拆掉', () => {
    expect(reconcileNodes([1], [], [2])).toEqual({ drop: [2], create: [] });
  });

  it('出生即死（enter + exit 同一帧，且已不在场）—— **不许建**，否则就是永久孤儿', () => {
    // 子弹在炮口出生的那一帧就命中了正巧游过炮口的鱼。
    // 它照样进 `drop`：表里通常没有它（本来就没建过），拆一次是幂等的空转；
    // 而万一表里还留着同 eid 上一位租客的节点，这一下正好清掉。
    expect(reconcileNodes([1], [7], [7])).toEqual({ drop: [7], create: [] });
  });

  it('eid 被回收再分配（exit + enter 同一帧，且还在场）—— 要建、**不许拆**', () => {
    // 旧租客走了、新租客拿到同一个 eid：拆掉它等于把新节点删了
    expect(reconcileNodes([7], [7], [7])).toEqual({ drop: [], create: [7] });
  });

  it('吃 TypedArray（bitECS 的 query 返回的就是它）', () => {
    const alive = new Uint32Array([3, 4]);
    const entered = new Uint32Array([4, 9]);
    const exited = new Uint32Array([9, 5]);
    // 9 既 enter 又 exit 且已不在场（出生即死）→ 拆、不建；4 还在场 → 建；5 真的走了 → 拆
    expect(reconcileNodes(alive, entered, exited)).toEqual({ drop: [9, 5], create: [4] });
  });

  it('空帧不产出动作', () => {
    expect(reconcileNodes([], [], [])).toEqual({ drop: [], create: [] });
  });
});

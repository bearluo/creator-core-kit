import { describe, expect, it, vi } from 'vitest';

vi.mock('cc', () => {
  const decorator = () => () => undefined;
  class Mat4 { m00 = 1; m01 = 0; m04 = 0; m05 = 1; m12 = 0; m13 = 0; }
  class Node {
    isValid = true;
    matrix: Mat4 | null = null;
  }
  return { _decorator: { ccclass: decorator, property: decorator }, Mat4, Node };
});

const { SpineVatSocket, syncSockets } = await import('../../../../extensions/spine-vat-importer/assets/runtime/SpineVatSocket');
const { Node } = await import('cc') as any;

describe('syncSockets', () => {
  it('把 [a,b,c,d,x,y] 写成 target 的本地矩阵（列主序：m01=c，m04=b）；没烘的骨骼跳过', () => {
    const hand = Object.assign(new SpineVatSocket(), { bone: 'hand', target: new Node() });
    const missing = Object.assign(new SpineVatSocket(), { bone: 'nope', target: new Node() });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    syncSockets([hand, missing], (bone) => (bone === 'hand' ? [1, 2, 3, 4, 5, 6] : null));
    const m = (hand.target as any).matrix;
    expect([m.m00, m.m01, m.m04, m.m05, m.m12, m.m13]).toEqual([1, 3, 2, 4, 5, 6]);
    expect((missing.target as any).matrix).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

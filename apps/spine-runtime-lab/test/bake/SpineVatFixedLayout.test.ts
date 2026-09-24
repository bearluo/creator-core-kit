import { describe, expect, it } from 'vitest';
import { MAX_CLIP_VERTICES, planFixedLayout, writeFixedFrame } from '../../assets/bake/SpineVatFixedLayout';
import type { FixedFrame, FixedKeyRange } from '../../assets/bake/SpineVatFixedBaker';

const STRIDE = 28;

/** keys: [键, 顶点数, 剪裁]；每个键的三角形取 0,1,2；顶点 x = 键序号 * 10 + 顶点号。 */
function frame(keys: Array<[string, number, string | null]>, clips: Record<string, number[]> = {}): FixedFrame {
  const vertexCount = keys.reduce((sum, [, count]) => sum + count, 0);
  const vertices = new Uint8Array(vertexCount * STRIDE);
  const view = new DataView(vertices.buffer);
  const indices: number[] = [];
  const ranges: FixedKeyRange[] = [];
  let vertexStart = 0;
  keys.forEach(([key, count, clip], order) => {
    for (let vertex = 0; vertex < count; vertex += 1) {
      const at = (vertexStart + vertex) * STRIDE;
      view.setFloat32(at, order * 10 + vertex, true);
      view.setFloat32(at + 12, 0.5, true);
      vertices.set([255, 255, 255, 200], at + 20);
    }
    ranges.push({
      key, slot: order, vertexStart, vertexCount: count, indexStart: indices.length, indexCount: 3,
      textureId: 'atlas', blendMode: 0, clip,
    });
    indices.push(vertexStart, vertexStart + 1, vertexStart + 2);
    vertexStart += count;
  });
  return {
    source: {
      time: 0, vertexCount, indexCount: indices.length, segments: [],
      vertices, indices: Uint16Array.from(indices),
    },
    keys: ranges,
    clips: new Map(Object.entries(clips)),
  };
}

describe('planFixedLayout', () => {
  it('每个附件一个固定槽位，没画出来的键写成退化，剪裁区按帧写多边形', () => {
    const square = [0, 0, 1, 0, 1, 1, 0, 1];
    const plan = planFixedLayout([{
      animation: 'a',
      frames: [
        frame([['0/a', 4, null], ['1/b', 3, '9/zz']], { '9/zz': square }),
        frame([['0/a', 4, null]]), // b 隐藏、剪裁关闭
      ],
    }]);
    expect(plan.rejected.size).toBe(0);
    expect(plan.vertexCount).toBe(7);
    expect(plan.lanes).toHaveLength(1);
    expect(plan.lanes[0].indices).toEqual([0, 1, 2, 4, 5, 6]);
    expect(Array.from(plan.vertexClip)).toEqual([-1, -1, -1, -1, 0, 0, 0]);
    expect(plan.frameStride).toBe(7 + MAX_CLIP_VERTICES);

    const texels = plan.frameStride * 2;
    const position = new Float32Array(texels * 4);
    const light = new Uint8Array(texels * 4);
    plan.accepted[0].frames.forEach((f, index) => writeFixedFrame(plan, f, index * plan.frameStride, position, light, 4, undefined));
    // 帧 0：b 的第 0 个顶点 x = 10；剪裁生效、4 个顶点
    expect(position[4 * 4]).toBe(10);
    expect(Array.from(position.subarray(7 * 4, 7 * 4 + 4))).toEqual([0, 0, 1, 4]);
    // 帧 1：b 退化（uv -1、alpha 0），剪裁不生效
    const f1 = plan.frameStride;
    expect(Array.from(position.subarray((f1 + 4) * 4 + 2, (f1 + 4) * 4 + 4))).toEqual([-1, -1]);
    expect(light[(f1 + 4) * 4 + 3]).toBe(0);
    expect(position[(f1 + 7) * 4 + 2]).toBe(0);
  });

  it('剪裁关掉的帧归属为空不算冲突；剪裁开着却没裁它才退回', () => {
    const on = { '9/zz': [0, 0, 1, 0, 1, 1] };
    const toggle = planFixedLayout([{
      animation: 'toggle',
      frames: [frame([['1/b', 3, '9/zz']], on), frame([['1/b', 3, null]])],
    }]);
    expect(toggle.rejected.size).toBe(0);
    expect(Array.from(toggle.vertexClip)).toEqual([0, 0, 0]);
    const escaped = planFixedLayout([{
      animation: 'escaped',
      frames: [frame([['1/b', 3, '9/zz']], on), frame([['1/b', 3, null]], on)],
    }]);
    expect(Array.from(escaped.rejected.keys())).toEqual(['escaped']);
  });

  it('绘制顺序逐帧变化的动画整段退回，不影响其它动画', () => {
    const plan = planFixedLayout([
      { animation: 'swap', frames: [frame([['0/a', 3, null], ['1/b', 3, null]]), frame([['1/b', 3, null], ['0/a', 3, null]])] },
      { animation: 'ok', frames: [frame([['0/a', 3, null], ['1/b', 3, null]])] },
    ]);
    expect([...plan.rejected.keys()]).toEqual(['swap']);
    expect(plan.accepted.map((bake) => bake.animation)).toEqual(['ok']);
  });
});

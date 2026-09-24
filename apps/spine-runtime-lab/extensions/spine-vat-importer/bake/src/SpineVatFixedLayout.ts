import type { FixedBakeResult, FixedFrame } from './SpineVatFixedBaker';

/** 每个剪裁每帧占的 texel 数 = 支持的最大多边形顶点数（shader 的 varying / 循环上限，改了要同步 effect）。 */
export const MAX_CLIP_VERTICES = 8;
const VERTEX_STRIDE = 28;
const MAX_LANE_VERTICES = 0xffff;

interface KeyInfo {
  key: string;
  vertexCount: number;
  textureId: string;
  blendMode: number;
  /** 附件自带的三角形（附件内局部顶点号）。 */
  triangles: number[];
}

export interface FixedLane {
  textureId: string;
  blendMode: number;
  vertexOffset: number;
  vertexCapacity: number;
  indices: number[];
}

export interface FixedLayoutPlan {
  /** 走固定槽位的动画。 */
  accepted: FixedBakeResult[];
  /** 过不了固定槽位规则的动画 → 原因（编译时整体报错）。 */
  rejected: Map<string, string>;
  lanes: FixedLane[];
  /** 顶点区大小；剪裁区紧随其后。 */
  vertexCount: number;
  clipKeys: string[];
  frameStride: number;
  /** 每个顶点所属剪裁在 clipKeys 里的序号，-1 = 不裁。 */
  vertexClip: Int16Array;
  keyOffsets: Map<string, number>;
}

function keyInfos(frame: FixedFrame): KeyInfo[] {
  return frame.keys.map((range) => ({
    key: range.key,
    vertexCount: range.vertexCount,
    textureId: range.textureId,
    blendMode: range.blendMode,
    triangles: Array.from(
      frame.source.indices.subarray(range.indexStart, range.indexStart + range.indexCount),
      (index) => index - range.vertexStart,
    ),
  }));
}

function sameInfo(a: KeyInfo, b: KeyInfo): string | null {
  if (a.vertexCount !== b.vertexCount || a.triangles.length !== b.triangles.length) return `附件 ${a.key} 顶点数/三角形数逐帧变化`;
  if (a.textureId !== b.textureId || a.blendMode !== b.blendMode) return `附件 ${a.key} 材质逐帧变化`;
  for (let i = 0; i < a.triangles.length; i += 1) {
    if (a.triangles[i] !== b.triangles[i]) return `附件 ${a.key} 三角形逐帧变化`;
  }
  return null;
}

/** 把一帧的键序并入全局键序；顺序冲突（绘制顺序变了）返回 null。 */
function mergeOrder(order: string[], sequence: string[]): string[] | null {
  const next = [...order];
  let cursor = -1;
  for (const key of sequence) {
    const at = next.indexOf(key);
    if (at >= 0) {
      if (at <= cursor) return null;
      cursor = at;
    } else {
      next.splice(cursor + 1, 0, key);
      cursor += 1;
    }
  }
  return next;
}

/**
 * 剪裁归属：键只能归一个剪裁。某帧归属为 null 只在「那个剪裁这帧没生效」时才算一致（激活切换）；
 * 剪裁生效却没裁它 = 剪裁范围变了，退回。
 */
function clipConflict(frames: FixedFrame[], clipOf: Map<string, string>): string | null {
  for (const frame of frames) {
    for (const range of frame.keys) {
      const owner = clipOf.get(range.key);
      if (range.clip && owner && range.clip !== owner) return `附件 ${range.key} 先后被不同剪裁裁`;
      if (!range.clip && owner && frame.clips.has(owner)) return `附件 ${range.key} 的剪裁范围逐帧变化`;
    }
  }
  return null;
}

/** 逐动画判定能否走固定槽位（不能的整段退回），再给通过的键分配槽位、按材质切 lane。 */
export function planFixedLayout(bakes: FixedBakeResult[]): FixedLayoutPlan {
  let order: string[] = [];
  const infos = new Map<string, KeyInfo>();
  const clipOf = new Map<string, string>();
  const accepted: FixedBakeResult[] = [];
  const rejected = new Map<string, string>();
  for (const bake of bakes) {
    let clipOrder = order;
    const clipInfos = new Map(infos);
    const clipClipOf = new Map(clipOf);
    let reason: string | null = null;
    for (const frame of bake.frames) {
      for (const polygon of frame.clips.values()) {
        if (polygon.length / 2 > MAX_CLIP_VERTICES) reason ??= `剪裁多边形 ${polygon.length / 2} 个顶点，超过 ${MAX_CLIP_VERTICES}`;
      }
      const merged = mergeOrder(clipOrder, frame.keys.map((range) => range.key));
      if (!merged) reason ??= '绘制顺序逐帧变化';
      else clipOrder = merged;
      for (const info of keyInfos(frame)) {
        const known = clipInfos.get(info.key);
        if (!known) clipInfos.set(info.key, info);
        else reason ??= sameInfo(known, info);
      }
      for (const range of frame.keys) {
        if (range.clip && !clipClipOf.has(range.key)) clipClipOf.set(range.key, range.clip);
      }
      if (reason) break;
    }
    reason ??= clipConflict(bake.frames, clipClipOf);
    if (reason) {
      rejected.set(bake.animation, reason);
      continue;
    }
    order = clipOrder;
    clipInfos.forEach((info, key) => infos.set(key, info));
    clipClipOf.forEach((clip, key) => clipOf.set(key, clip));
    accepted.push(bake);
  }

  const lanes: FixedLane[] = [];
  const keyOffsets = new Map<string, number>();
  let vertexCount = 0;
  for (const key of order) {
    const info = infos.get(key)!;
    let lane = lanes[lanes.length - 1];
    if (!lane || lane.textureId !== info.textureId || lane.blendMode !== info.blendMode
      || lane.vertexCapacity + info.vertexCount > MAX_LANE_VERTICES) {
      lane = { textureId: info.textureId, blendMode: info.blendMode, vertexOffset: vertexCount, vertexCapacity: 0, indices: [] };
      lanes.push(lane);
    }
    keyOffsets.set(key, vertexCount);
    for (const index of info.triangles) lane.indices.push(lane.vertexCapacity + index);
    lane.vertexCapacity += info.vertexCount;
    vertexCount += info.vertexCount;
  }

  const clipKeys = Array.from(new Set(order.map((key) => clipOf.get(key)).filter((clip): clip is string => !!clip)));
  const vertexClip = new Int16Array(vertexCount).fill(-1);
  for (const key of order) {
    const info = infos.get(key)!;
    const clip = clipOf.get(key);
    if (clip) vertexClip.fill(clipKeys.indexOf(clip), keyOffsets.get(key)!, keyOffsets.get(key)! + info.vertexCount);
  }
  return {
    accepted,
    rejected,
    lanes,
    vertexCount,
    clipKeys,
    frameStride: vertexCount + clipKeys.length * MAX_CLIP_VERTICES,
    vertexClip,
    keyOffsets,
  };
}

/**
 * 写一帧：没画出来的键 uv = (-1,-1)、alpha 0（退化，且 uv 与相邻帧不同 → 插值自动阶跃）；
 * 剪裁区每 texel = (x, y, 生效 ? 1 : 0, 顶点数)，按原顺序首尾相接成闭合多边形。
 */
export function writeFixedFrame(
  plan: FixedLayoutPlan,
  frame: FixedFrame,
  texelBase: number,
  position: Float32Array,
  light: Uint8Array | undefined,
  lightComponents: 1 | 4,
  dark: Uint8Array | undefined,
): void {
  for (let vertex = 0; vertex < plan.vertexCount; vertex += 1) {
    const target = (texelBase + vertex) * 4;
    position[target + 2] = -1;
    position[target + 3] = -1;
    if (light && lightComponents === 4) light.set([255, 255, 255, 0], target);
  }
  const view = new DataView(frame.source.vertices.buffer, frame.source.vertices.byteOffset, frame.source.vertices.byteLength);
  for (const range of frame.keys) {
    const offset = plan.keyOffsets.get(range.key)!;
    for (let vertex = 0; vertex < range.vertexCount; vertex += 1) {
      const source = (range.vertexStart + vertex) * VERTEX_STRIDE;
      const texel = texelBase + offset + vertex;
      const target = texel * 4;
      position[target] = view.getFloat32(source, true);
      position[target + 1] = view.getFloat32(source + 4, true);
      position[target + 2] = view.getFloat32(source + 12, true);
      position[target + 3] = view.getFloat32(source + 16, true);
      if (light && lightComponents === 1) light[texel] = frame.source.vertices[source + 23];
      else if (light) light.set(frame.source.vertices.subarray(source + 20, source + 24), target);
      if (dark) dark.set(frame.source.vertices.subarray(source + 24, source + 28), target);
    }
  }
  plan.clipKeys.forEach((key, clip) => {
    const polygon = frame.clips.get(key);
    const count = polygon ? polygon.length / 2 : 0;
    for (let vertex = 0; vertex < MAX_CLIP_VERTICES; vertex += 1) {
      const target = (texelBase + plan.vertexCount + clip * MAX_CLIP_VERTICES + vertex) * 4;
      // 不足 MAX_CLIP_VERTICES 的用第 0 个点补齐：补出来的边长度为 0，奇偶判定里不计数，FS 可以固定查 8 条边。
      const source = polygon && vertex < count ? vertex : 0;
      position[target] = polygon ? polygon[source * 2] : 0;
      position[target + 1] = polygon ? polygon[source * 2 + 1] : 0;
      position[target + 2] = polygon ? 1 : 0;
      position[target + 3] = count;
    }
  });
}

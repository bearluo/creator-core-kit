import { sp } from 'cc';
import type { SpineVatSocketMatrix, SpineVatSocketTrack } from './SpineVatTypes';

const FRAME_RATE = 60;
const TINTED_VERTEX_STRIDE = 28;

export interface VatSegment {
  vertexCount: number;
  indexCount: number;
  blendMode: number;
  textureId: string;
}

export interface VatFrame {
  time: number;
  vertexCount: number;
  indexCount: number;
  segments: VatSegment[];
  vertices: Uint8Array;
  indices: Uint16Array;
}

export interface SpineVatBakeResult {
  animation: string;
  duration: number;
  frameRate: number;
  frames: VatFrame[];
  stableVertexLayout: boolean;
  stableIndices: boolean;
  stableSegments: boolean;
  stableTopology: boolean;
  mismatchFrames: number[];
  sockets: SpineVatSocketTrack[];
}

export interface SpineVatMetadata {
  format: 'spine-vat-1';
  animation: string;
  duration: number;
  frameRate: number;
  frameCount: number;
  vertexCount: number;
  indices: number[];
  segments: VatSegment[];
  textureBytes: number;
  topologyMode?: 'stable-indexed' | 'triangle-soup';
  sourceStableTopology?: boolean;
}

export interface PackedSpineVat {
  metadata: SpineVatMetadata;
  position: Float32Array;
  light: Uint8Array;
  dark: Uint8Array;
}

/**
 * Builds a SkeletonData variant suitable for fixed-topology VAT.
 * Clipping changes triangle counts every frame, while animated draw order
 * changes packed vertex identity; both must be handled separately or removed.
 */
export function createVatCompatibleSkeletonData(source: sp.SkeletonData): sp.SkeletonData {
  const json = JSON.parse(JSON.stringify(source.skeletonJson)) as any;
  if (json.skeleton?.hash) json.skeleton.hash = `${json.skeleton.hash}-vat-fixed-topology`;
  for (const skin of json.skins ?? []) {
    if (skin.attachments) delete skin.attachments.mask;
  }
  const speedlineSlot = (json.slots ?? []).find((slot: any) => slot.name === 'speedline_00000');
  if (speedlineSlot && !speedlineSlot.attachment) speedlineSlot.attachment = 'speedline_00000';
  for (const animation of Object.values(json.animations ?? {}) as any[]) {
    delete animation.drawOrder;
    delete animation.draworder;
  }

  const result = new sp.SkeletonData();
  result.skeletonJson = json;
  result.atlasText = source.atlasText;
  result.textureNames = [...source.textureNames];
  result.textures = [...source.textures];
  result.scale = source.scale;
  return result;
}

interface SpineWasmModel {
  vPtr: number;
  iPtr: number;
  vCount: number;
  iCount: number;
  getData(): { size(): number; get(index: number): number };
  getTextures(): { get(index: number): string };
}

function equalIndices(a: Uint16Array, b: Uint16Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function equalSegments(a: VatSegment[], b: VatSegment[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i];
    const right = b[i];
    if (left.vertexCount !== right.vertexCount
      || left.indexCount !== right.indexCount
      || left.blendMode !== right.blendMode
      || left.textureId !== right.textureId) return false;
  }
  return true;
}

function stabilizeTopology(result: SpineVatBakeResult): {
  result: SpineVatBakeResult;
  topologyMode: 'stable-indexed' | 'triangle-soup';
} {
  if (result.stableTopology) return { result, topologyMode: 'stable-indexed' };
  if (result.frames.length === 0) throw new Error('VAT bake produced no frames');

  const referenceSegments = result.frames[0].segments;
  const segmentCapacities = referenceSegments.map(() => 0);
  for (let frameIndex = 0; frameIndex < result.frames.length; frameIndex += 1) {
    const frame = result.frames[frameIndex];
    if (frame.segments.length !== referenceSegments.length) {
      throw new Error(`VAT triangle-soup requires stable segment count (frame ${frameIndex})`);
    }
    for (let segmentIndex = 0; segmentIndex < frame.segments.length; segmentIndex += 1) {
      const segment = frame.segments[segmentIndex];
      const reference = referenceSegments[segmentIndex];
      if (segment.blendMode !== reference.blendMode || segment.textureId !== reference.textureId) {
        throw new Error(`VAT triangle-soup requires stable segment material order (frame ${frameIndex})`);
      }
      if (segment.indexCount % 3 !== 0) {
        throw new Error(`VAT segment index count is not a triangle list (frame ${frameIndex})`);
      }
      segmentCapacities[segmentIndex] = Math.max(segmentCapacities[segmentIndex], segment.indexCount);
    }
  }

  const vertexCount = segmentCapacities.reduce((total, count) => total + count, 0);
  if (vertexCount > 0xffff) throw new Error(`VAT triangle-soup exceeds Uint16 vertex limit: ${vertexCount}`);
  const indices = Uint16Array.from({ length: vertexCount }, (_, index) => index);
  const segments = referenceSegments.map((segment, index): VatSegment => ({
    vertexCount: segmentCapacities[index],
    indexCount: segmentCapacities[index],
    blendMode: segment.blendMode,
    textureId: segment.textureId,
  }));

  const frames = result.frames.map((frame, frameIndex): VatFrame => {
    const vertices = new Uint8Array(vertexCount * TINTED_VERTEX_STRIDE);
    let sourceVertexOffset = 0;
    let sourceIndexOffset = 0;
    let targetVertexOffset = 0;
    for (let segmentIndex = 0; segmentIndex < frame.segments.length; segmentIndex += 1) {
      const segment = frame.segments[segmentIndex];
      for (let index = 0; index < segment.indexCount; index += 1) {
        const sourceVertex = frame.indices[sourceIndexOffset + index];
        if (sourceVertex < sourceVertexOffset || sourceVertex >= sourceVertexOffset + segment.vertexCount) {
          throw new Error(`VAT segment index escaped its vertex range (frame ${frameIndex})`);
        }
        const source = sourceVertex * TINTED_VERTEX_STRIDE;
        const target = (targetVertexOffset + index) * TINTED_VERTEX_STRIDE;
        vertices.set(frame.vertices.subarray(source, source + TINTED_VERTEX_STRIDE), target);
      }
      sourceVertexOffset += segment.vertexCount;
      sourceIndexOffset += segment.indexCount;
      targetVertexOffset += segmentCapacities[segmentIndex];
    }
    return {
      time: frame.time,
      vertexCount,
      indexCount: vertexCount,
      segments,
      vertices,
      indices,
    };
  });

  console.log(`[VatBake] normalized variable clipping topology as triangle-soup: ${vertexCount} vertices`);
  return {
    topologyMode: 'triangle-soup',
    result: {
      ...result,
      frames,
      stableVertexLayout: true,
      stableIndices: true,
      stableSegments: true,
      stableTopology: true,
      mismatchFrames: [],
    },
  };
}

export function captureSpineVatFrame(skeleton: sp.Skeleton, time: number): VatFrame {
  const model = (skeleton as any).updateRenderData() as SpineWasmModel;
  const heap = (sp.spine as any).wasmUtil.wasm.HEAPU8 as Uint8Array;
  const vertexBytes = model.vCount * TINTED_VERTEX_STRIDE;
  const indexBytes = model.iCount * Uint16Array.BYTES_PER_ELEMENT;
  const vertices = heap.slice(model.vPtr, model.vPtr + vertexBytes);
  const indexCopy = heap.slice(model.iPtr, model.iPtr + indexBytes);
  const indices = new Uint16Array(indexCopy.buffer, indexCopy.byteOffset, model.iCount).slice();
  const data = model.getData();
  const textures = model.getTextures();
  const segments: VatSegment[] = [];
  for (let i = 0; i < data.size(); i += 5) {
    segments.push({
      vertexCount: data.get(i + 2),
      indexCount: data.get(i + 3),
      blendMode: data.get(i + 4),
      textureId: textures.get(i / 5),
    });
  }
  return {
    time,
    vertexCount: model.vCount,
    indexCount: model.iCount,
    segments,
    vertices,
    indices,
  };
}

/** Packs the stable runtime vertices into textures that can be shipped to Native. */
export function packSpineVat(result: SpineVatBakeResult): PackedSpineVat {
  const normalized = stabilizeTopology(result);
  const bake = normalized.result;
  const width = bake.frames[0].vertexCount;
  const height = bake.frames.length;
  const position = new Float32Array(width * height * 4);
  const light = new Uint8Array(width * height * 4);
  const dark = new Uint8Array(width * height * 4);

  for (let frameIndex = 0; frameIndex < height; frameIndex += 1) {
    const vertices = bake.frames[frameIndex].vertices;
    const view = new DataView(vertices.buffer, vertices.byteOffset, vertices.byteLength);
    for (let vertexIndex = 0; vertexIndex < width; vertexIndex += 1) {
      const source = vertexIndex * TINTED_VERTEX_STRIDE;
      const target = (frameIndex * width + vertexIndex) * 4;
      position[target] = view.getFloat32(source, true);
      position[target + 1] = view.getFloat32(source + 4, true);
      position[target + 2] = view.getFloat32(source + 12, true);
      position[target + 3] = view.getFloat32(source + 16, true);
      light.set(vertices.subarray(source + 20, source + 24), target);
      dark.set(vertices.subarray(source + 24, source + 28), target);
    }
  }

  return {
    metadata: {
      format: 'spine-vat-1',
      animation: bake.animation,
      duration: bake.duration,
      frameRate: bake.frameRate,
      frameCount: height,
      vertexCount: width,
      indices: Array.from(bake.frames[0].indices),
      segments: bake.frames[0].segments,
      textureBytes: position.byteLength + light.byteLength + dark.byteLength,
      topologyMode: normalized.topologyMode,
      sourceStableTopology: result.stableTopology,
    },
    position,
    light,
    dark,
  };
}

/** Deterministically samples a realtime Spine animation without wall-clock input. */
export function bakeSpineAnimation(
  skeleton: sp.Skeleton,
  animationName: string,
  frameRate = FRAME_RATE,
  premultipliedAlpha = false,
  socketNames: readonly string[] = [],
): SpineVatBakeResult {
  const animation = skeleton.findAnimation(animationName);
  if (!animation) throw new Error(`Spine animation not found: ${animationName}`);

  skeleton.paused = true;
  skeleton.useTint = true;
  skeleton.premultipliedAlpha = premultipliedAlpha;
  skeleton.clearTracks();
  skeleton.setToSetupPose();
  skeleton.setAnimation(0, animationName, false);

  const duration = animation.duration;
  const frameCount = Math.max(1, Math.ceil(duration * frameRate));
  const frames: VatFrame[] = [];
  const socketTracks = socketNames.map((name): SpineVatSocketTrack => ({ name, frames: [] }));
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    // Call the WASM instance directly because Skeleton.updateAnimation respects paused.
    // Frame 0 also updates (by 0) so t=0 keys are applied; setAnimation alone leaves the setup pose.
    (skeleton as any)._instance.updateAnimation(frameIndex > 0 ? 1 / frameRate : 0);
    frames.push(captureSpineVatFrame(skeleton, frameIndex / frameRate));
    for (const track of socketTracks) {
      const bone = skeleton.findBone(track.name);
      if (!bone) throw new Error(`Spine socket bone not found: ${track.name}`);
      const matrix: SpineVatSocketMatrix = [bone.a, bone.b, bone.c, bone.d, bone.worldX, bone.worldY];
      track.frames.push(matrix);
    }
  }

  const first = frames[0];
  let stableVertexLayout = true;
  let stableIndices = true;
  let stableSegments = true;
  const mismatchFrames: number[] = [];
  for (let i = 1; i < frames.length; i += 1) {
    const frame = frames[i];
    const vertexLayoutMatches = frame.vertexCount === first.vertexCount
      && frame.indexCount === first.indexCount;
    const indicesMatch = equalIndices(frame.indices, first.indices);
    const segmentsMatch = equalSegments(frame.segments, first.segments);
    stableVertexLayout &&= vertexLayoutMatches;
    stableIndices &&= indicesMatch;
    stableSegments &&= segmentsMatch;
    if (!vertexLayoutMatches || !indicesMatch || !segmentsMatch) mismatchFrames.push(i);
  }

  const result: SpineVatBakeResult = {
    animation: animationName,
    duration,
    frameRate,
    frames,
    stableVertexLayout,
    stableIndices,
    stableSegments,
    stableTopology: stableVertexLayout && stableIndices && stableSegments,
    mismatchFrames,
    sockets: socketTracks,
  };
  const summary = {
    animation: result.animation,
    duration: result.duration,
    frameRate: result.frameRate,
    frameCount: frames.length,
    vertexCount: first.vertexCount,
    indexCount: first.indexCount,
    segments: first.segments,
    stableVertexLayout,
    stableIndices,
    stableSegments,
    stableTopology: result.stableTopology,
    mismatchFrames,
  };
  console.log(`[VatBake] ${JSON.stringify(summary)}`);
  return result;
}

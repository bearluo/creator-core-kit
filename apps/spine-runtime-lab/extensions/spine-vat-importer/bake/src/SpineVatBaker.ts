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

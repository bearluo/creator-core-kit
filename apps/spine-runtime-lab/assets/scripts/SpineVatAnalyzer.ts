import { Node, sp } from 'cc';
import {
  aggregateCompatibility,
  analyzeSpineJson,
  buildClipAnalysis,
  DEFAULT_SPINE_VAT_BUDGET,
  materialKey,
} from './SpineVatAnalyzerCore';
import type {
  SpineVatAlphaMode,
  SpineVatAnalysisReport,
  SpineVatBlendMode,
  SpineVatBudget,
  SpineVatClipAnalysis,
  SpineVatFrameProbe,
  SpineVatMaterialSegmentProbe,
  SpineVatTextureProfile,
} from './SpineVatTypes';

const TINTED_VERTEX_STRIDE = 28;

interface SpineWasmModel {
  vPtr: number;
  iPtr: number;
  vCount: number;
  iCount: number;
  getData(): { size(): number; get(index: number): number };
  getTextures(): { get(index: number): string };
}

export interface SpineVatAnalyzerOptions {
  frameRate?: number;
  animations?: string[];
  alphaMode?: Exclude<SpineVatAlphaMode, 'unknown'>;
  textureProfile?: SpineVatTextureProfile;
  budget?: Partial<SpineVatBudget>;
}

function blendModeFromRuntime(value: number): SpineVatBlendMode {
  if (value === 1) return 'additive';
  if (value === 2) return 'multiply';
  if (value === 3) return 'screen';
  return 'normal';
}

function fnvUpdate(hash: number, value: number): number {
  return Math.imul((hash ^ value) >>> 0, 0x01000193) >>> 0;
}

function hashStridedBytes(
  heap: Uint8Array,
  vertexPtr: number,
  vertexCount: number,
  offset: number,
  byteCount: number,
): string {
  let hash = 0x811c9dc5;
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const start = vertexPtr + vertex * TINTED_VERTEX_STRIDE + offset;
    for (let byte = 0; byte < byteCount; byte += 1) hash = fnvUpdate(hash, heap[start + byte]);
  }
  return hash.toString(16).padStart(8, '0');
}

function allStridedBytes(
  heap: Uint8Array,
  vertexPtr: number,
  vertexCount: number,
  offset: number,
  byteCount: number,
  expected: number,
): boolean {
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const start = vertexPtr + vertex * TINTED_VERTEX_STRIDE + offset;
    for (let byte = 0; byte < byteCount; byte += 1) {
      if (heap[start + byte] !== expected) return false;
    }
  }
  return true;
}

function hashIndices(heap: Uint8Array, indexPtr: number, indexCount: number): string {
  let hash = 0x811c9dc5;
  const end = indexPtr + indexCount * Uint16Array.BYTES_PER_ELEMENT;
  for (let offset = indexPtr; offset < end; offset += 1) hash = fnvUpdate(hash, heap[offset]);
  return hash.toString(16).padStart(8, '0');
}

function mergeAdjacentSegments(segments: SpineVatMaterialSegmentProbe[]): SpineVatMaterialSegmentProbe[] {
  const merged: SpineVatMaterialSegmentProbe[] = [];
  for (const segment of segments) {
    const previous = merged[merged.length - 1];
    if (previous && materialKey(previous) === materialKey(segment)) {
      previous.vertexCount += segment.vertexCount;
      previous.indexCount += segment.indexCount;
    } else {
      merged.push({ ...segment });
    }
  }
  return merged;
}

function captureFrame(skeleton: sp.Skeleton, frame: number, time: number): SpineVatFrameProbe {
  const model = (skeleton as any).updateRenderData() as SpineWasmModel | null;
  if (!model) throw new Error('Spine updateRenderData() did not return a WASM model');
  const heap = (sp.spine as any).wasmUtil?.wasm?.HEAPU8 as Uint8Array | undefined;
  if (!heap) throw new Error('Spine WASM heap is unavailable; dry-run must execute in Creator Web/WASM');
  const data = model.getData();
  const textures = model.getTextures();
  const segments: SpineVatMaterialSegmentProbe[] = [];
  for (let index = 0; index < data.size(); index += 5) {
    segments.push({
      vertexCount: data.get(index + 2),
      indexCount: data.get(index + 3),
      blendMode: blendModeFromRuntime(data.get(index + 4)),
      textureId: String(textures.get(index / 5)),
    });
  }
  return {
    frame,
    time,
    vertexCount: model.vCount,
    indexCount: model.iCount,
    indexHash: hashIndices(heap, model.iPtr, model.iCount),
    uvHash: hashStridedBytes(heap, model.vPtr, model.vCount, 12, 8),
    lightHash: hashStridedBytes(heap, model.vPtr, model.vCount, 20, 4),
    darkHash: hashStridedBytes(heap, model.vPtr, model.vCount, 24, 4),
    lightAllWhite: allStridedBytes(heap, model.vPtr, model.vCount, 20, 4, 0xff),
    darkAllZero: allStridedBytes(heap, model.vPtr, model.vCount, 24, 4, 0),
    segments: mergeAdjacentSegments(segments),
  };
}

async function hashSourceTexts(values: Record<string, string>): Promise<{
  algorithm: 'SHA-256' | 'FNV-1A-32';
  hashes: Record<string, string>;
}> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const hashes: Record<string, string> = {};
    for (const [name, value] of Object.entries(values)) {
      const digest = await subtle.digest('SHA-256', new TextEncoder().encode(value));
      hashes[name] = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    }
    return { algorithm: 'SHA-256', hashes };
  }

  const hashes: Record<string, string> = {};
  for (const [name, value] of Object.entries(values)) {
    let hash = 0x811c9dc5;
    const bytes = new TextEncoder().encode(value);
    for (const byte of bytes) hash = fnvUpdate(hash, byte);
    hashes[name] = hash.toString(16).padStart(8, '0');
  }
  return { algorithm: 'FNV-1A-32', hashes };
}

function parseSkeletonJson(skeletonData: sp.SkeletonData): Record<string, any> {
  const source = skeletonData.skeletonJson as unknown;
  if (typeof source === 'string') return JSON.parse(source) as Record<string, any>;
  if (!source || typeof source !== 'object') {
    throw new Error('M1 analyzer requires JSON SkeletonData; binary static reflection is a later milestone');
  }
  return source as Record<string, any>;
}

function sampleAnimation(
  parent: Node,
  skeletonData: sp.SkeletonData,
  animationName: string,
  frameRate: number,
  alphaMode: SpineVatAlphaMode,
): { duration: number; frames: SpineVatFrameProbe[] } {
  const node = new Node(`VAT-Analyze-${animationName}`);
  node.parent = parent;
  node.setPosition(100000, 100000, 0);
  const skeleton = node.addComponent(sp.Skeleton);
  skeleton.defaultCacheMode = sp.SpineAnimationCacheMode.REALTIME;
  skeleton.enableBatch = false;
  skeleton.useTint = true;
  skeleton.premultipliedAlpha = alphaMode === 'premultiplied';
  skeleton.skeletonData = skeletonData;
  const animation = skeleton.findAnimation(animationName);
  if (!animation) {
    node.destroy();
    throw new Error(`Spine animation not found: ${animationName}`);
  }

  skeleton.paused = true;
  skeleton.clearTracks();
  skeleton.setToSetupPose();
  skeleton.setAnimation(0, animationName, false);
  const duration = animation.duration;
  const frameCount = Math.max(1, Math.ceil(duration * frameRate));
  const frames: SpineVatFrameProbe[] = [];
  for (let frame = 0; frame < frameCount; frame += 1) {
    (skeleton as any)._instance.updateAnimation(frame > 0 ? 1 / frameRate : 0); // 0 帧也 apply，同 SpineVatBaker
    frames.push(captureFrame(skeleton, frame, frame / frameRate));
  }
  node.destroy();
  return { duration, frames };
}

/** Runs a deterministic, allocation-light dry-run over every selected animation. */
export async function analyzeSpineVatSkeletonData(
  parent: Node,
  skeletonData: sp.SkeletonData,
  options: SpineVatAnalyzerOptions = {},
): Promise<SpineVatAnalysisReport> {
  const json = parseSkeletonJson(skeletonData);
  const atlasText = skeletonData.atlasText ?? '';
  const staticAnalysis = analyzeSpineJson(json, atlasText);
  const alphaMode = options.alphaMode ?? staticAnalysis.inferredAlphaMode;
  const frameRate = Math.max(1, Math.floor(options.frameRate ?? 60));
  const textureProfile = options.textureProfile ?? 'balanced';
  const budget: SpineVatBudget = { ...DEFAULT_SPINE_VAT_BUDGET, ...options.budget };
  const animationNames = options.animations ?? staticAnalysis.features.animations;
  const sourceHashes = await hashSourceTexts({
    skeletonJson: JSON.stringify(json),
    atlasText,
  });

  const clips: SpineVatClipAnalysis[] = [];
  for (const animationName of animationNames) {
    const sample = sampleAnimation(parent, skeletonData, animationName, frameRate, alphaMode);
    clips.push(buildClipAnalysis(
      animationName,
      sample.duration,
      frameRate,
      sample.frames,
      staticAnalysis,
      alphaMode,
      textureProfile,
      budget,
    ));
    await Promise.resolve();
  }

  const estimatedGpuBytes = clips.reduce(
    (sum, clip) => sum + clip.estimatedTextureBytes + clip.estimatedMeshBytes,
    0,
  );
  const warnings = [...staticAnalysis.warnings];
  for (const clip of clips) {
    warnings.push(...clip.warnings.map((warning) => `${clip.name}: ${warning}`));
  }
  let level = aggregateCompatibility(clips);
  if (estimatedGpuBytes > budget.maxTextureBytes) {
    warnings.push(`全部动画预计 GPU 数据 ${estimatedGpuBytes} 字节超过资产预算 ${budget.maxTextureBytes}`);
    level = 'RUNTIME_FALLBACK';
  }

  return {
    format: 'spine-vat-analysis-1',
    source: {
      creator: '3.8.7',
      spineVersion: staticAnalysis.spineVersion,
      runtimeFamily: staticAnalysis.runtimeFamily,
      hashAlgorithm: sourceHashes.algorithm,
      hashes: sourceHashes.hashes,
    },
    recipe: {
      alphaMode,
      fps: frameRate,
      textureProfile,
      budget,
    },
    static: staticAnalysis,
    clips,
    compatibility: {
      level,
      warnings,
      estimatedGpuBytes,
      drawCallsPerBatch: clips.reduce((maximum, clip) => Math.max(maximum, clip.lanes.length), 0),
    },
  };
}

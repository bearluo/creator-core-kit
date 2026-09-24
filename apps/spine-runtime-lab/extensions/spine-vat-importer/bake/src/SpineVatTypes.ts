export type SpineVatAlphaMode = 'straight' | 'premultiplied' | 'unknown';
export type SpineVatBlendMode = 'normal' | 'additive' | 'multiply' | 'screen';
export type SpineVatCompatibilityLevel =
  | 'LOSSLESS_VAT'
  | 'BAKED_VARIANT'
  | 'HYBRID'
  | 'RUNTIME_FALLBACK';
export type SpineVatGeometryMode = 'indexed-stable' | 'triangle-soup-dynamic';
export type SpineVatTextureProfile = 'exact' | 'balanced' | 'compact';

export interface SpineVatEventKey {
  time: number;
  name: string;
  intValue?: number;
  floatValue?: number;
  stringValue?: string;
  audioPath?: string;
  volume?: number;
  balance?: number;
}

/** Spine 2D affine matrix: x'=a*x+b*y+x, y'=c*x+d*y+y. */
export type SpineVatSocketMatrix = [number, number, number, number, number, number];

export interface SpineVatSocketTrack {
  name: string;
  frames: SpineVatSocketMatrix[];
}

export interface SpineVatBudget {
  maxRenderLanes: number;
  maxTextureBytes: number;
  maxTextureSize: number;
}

export interface SpineVatAtlasPageInfo {
  name: string;
  pma: boolean | null;
}

export interface SpineVatStaticFeatures {
  bones: number;
  slots: number;
  skins: string[];
  animations: string[];
  attachments: Record<string, number>;
  weightedMeshes: number;
  sequences: number;
  constraints: {
    ik: number;
    transform: number;
    path: number;
    physics: number;
  };
  timelines: {
    deform: boolean;
    attachment: boolean;
    drawOrder: boolean;
    events: boolean;
    twoColor: boolean;
  };
  blendModes: SpineVatBlendMode[];
}

export interface SpineVatStaticAnalysis {
  spineVersion: string;
  runtimeFamily: string;
  atlasPages: SpineVatAtlasPageInfo[];
  inferredAlphaMode: SpineVatAlphaMode;
  features: SpineVatStaticFeatures;
  warnings: string[];
}

export interface SpineVatMaterialSegmentProbe {
  textureId: string;
  blendMode: SpineVatBlendMode;
  vertexCount: number;
  indexCount: number;
}

export interface SpineVatFrameProbe {
  frame: number;
  time: number;
  vertexCount: number;
  indexCount: number;
  indexHash: string;
  uvHash: string;
  lightHash: string;
  darkHash: string;
  lightAllWhite: boolean;
  darkAllZero: boolean;
  segments: SpineVatMaterialSegmentProbe[];
}

export interface SpineVatRenderLaneAnalysis {
  materialKey: string;
  textureId: string;
  blendMode: SpineVatBlendMode;
  vertexCapacity: number;
  triangleCapacity: number;
}

export interface SpineVatClipAnalysis {
  name: string;
  duration: number;
  fps: number;
  frameCount: number;
  geometryMode: SpineVatGeometryMode;
  stableVertexLayout: boolean;
  stableIndices: boolean;
  stableSegments: boolean;
  staticUv: boolean;
  lightAllWhite: boolean;
  darkAllZero: boolean;
  mismatchFrames: number[];
  lanes: SpineVatRenderLaneAnalysis[];
  estimatedTextureBytes: number;
  estimatedTexturePages: number;
  estimatedMeshBytes: number;
  compatibility: SpineVatCompatibilityLevel;
  warnings: string[];
}

export interface SpineVatAnalysisReport {
  format: 'spine-vat-analysis-1';
  source: {
    creator: '3.8.7';
    spineVersion: string;
    runtimeFamily: string;
    hashAlgorithm: 'SHA-256' | 'FNV-1A-32';
    hashes: Record<string, string>;
  };
  recipe: {
    alphaMode: SpineVatAlphaMode;
    fps: number;
    textureProfile: SpineVatTextureProfile;
    budget: SpineVatBudget;
  };
  static: SpineVatStaticAnalysis;
  clips: SpineVatClipAnalysis[];
  compatibility: {
    level: SpineVatCompatibilityLevel;
    warnings: string[];
    estimatedGpuBytes: number;
    drawCallsPerBatch: number;
  };
}

export interface SpineVatManifestV2 {
  format: 'spine-vat-2';
  source: SpineVatAnalysisReport['source'];
  alphaMode: Exclude<SpineVatAlphaMode, 'unknown'>;
  textureProfile: SpineVatTextureProfile;
  channels: {
    light: boolean;
    dark: boolean;
  };
  pageTexels: number;
  texturePages: Array<{
    semantic: 'position' | 'uv' | 'light' | 'dark';
    path: string;
    size: [number, number];
    format: string;
  }>;
  atlasPages: Array<{ id: string; path: string }>;
  layouts: Array<{
    id: string;
    frameStride: number;
    bounds: [number, number, number, number];
    /** 剪裁数（每帧顶点区之后各占 MAX_CLIP_VERTICES 个 texel）与静态区（每顶点所属剪裁）所在帧。 */
    clipCount: number;
    staticFrame: number;
    lanes: Array<{
      atlasPage: number;
      textureId: string;
      blendMode: SpineVatBlendMode;
      vertexOffset: number;
      vertexCapacity: number;
      logicalLane: number;
      geometryMode: 'indexed-stable';
      /** lane 内局部顶点号的三角形列表。 */
      indices: number[];
    }>;
  }>;
  variants: Array<{ name: string; skins: string[]; layout: string }>;
  clips: Array<{
    name: string;
    variant: string;
    fps: number;
    duration: number;
    frameOffset: number;
    frameCount: number;
    layout: string;
    events?: SpineVatEventKey[];
    sockets?: SpineVatSocketTrack[];
  }>;
  compatibility: SpineVatAnalysisReport['compatibility'];
}

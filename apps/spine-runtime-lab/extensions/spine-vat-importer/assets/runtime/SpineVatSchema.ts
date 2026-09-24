export type SpineVatAlphaMode = 'straight' | 'premultiplied';
export type SpineVatBlendMode = 'normal' | 'additive' | 'multiply' | 'screen';

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

export interface SpineVatManifest {
  format: 'spine-vat-2';
  source: {
    creator: '3.8.7';
    spineVersion: string;
    runtimeFamily: string;
    hashAlgorithm: string;
    hashes: Record<string, string>;
  };
  alphaMode: SpineVatAlphaMode;
  textureProfile: 'exact' | 'balanced' | 'compact';
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
    /** 剪裁数（每帧顶点区之后各占 8 个 texel）与静态区（每顶点所属剪裁）所在帧。 */
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
    sockets?: Array<{
      name: string;
      frames: SpineVatSocketMatrix[];
    }>;
  }>;
  compatibility: {
    level: 'LOSSLESS_VAT' | 'BAKED_VARIANT' | 'HYBRID' | 'RUNTIME_FALLBACK';
    warnings: string[];
    estimatedGpuBytes: number;
    drawCallsPerBatch: number;
  };
}

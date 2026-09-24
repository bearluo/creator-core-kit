import { Node, sp } from 'cc';
import { bakeSpineAnimation } from './SpineVatBaker';
import type { SpineVatBakeResult, VatFrame } from './SpineVatBaker';
import { bakeFixedSlots, createUnclippedSkeletonData } from './SpineVatFixedBaker';
import type { FixedBakeResult } from './SpineVatFixedBaker';
import { planFixedLayout, writeFixedFrame } from './SpineVatFixedLayout';
import type {
  SpineVatAlphaMode,
  SpineVatAnalysisReport,
  SpineVatBlendMode,
  SpineVatManifestV2,
  SpineVatEventKey,
} from './SpineVatTypes';

const VERTEX_STRIDE = 28;
const MAX_EXACT_FLOAT_INTEGER = 0x1000000;

export interface SpineVatV2PageData {
  width: number;
  height: number;
  position: Float32Array;
  light?: Uint8Array;
  dark?: Uint8Array;
}

export interface CompiledSpineVatV2 {
  manifest: SpineVatManifestV2;
  pages: SpineVatV2PageData[];
  textureBytes: number;
}

export interface SpineVatCompileOptions {
  maxTextureSize?: number;
  maxTexturePages?: number;
  socketNames?: readonly string[];
  skeletonJson?: unknown;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** Extracts authored Spine events without keeping AnimationState alive at runtime. */
export function extractSpineVatEvents(skeletonJson: any, animationName: string): SpineVatEventKey[] {
  const timeline = skeletonJson?.animations?.[animationName]?.events;
  if (!Array.isArray(timeline)) return [];
  const definitions = skeletonJson?.events ?? {};
  return timeline.map((key: any): SpineVatEventKey => {
    const name = String(key?.name ?? '');
    if (!name) throw new Error(`Spine event in ${animationName} is missing a name`);
    const defaults = definitions?.[name] ?? {};
    return {
      time: Math.max(0, optionalNumber(key?.time) ?? 0),
      name,
      intValue: optionalNumber(key?.int) ?? optionalNumber(defaults?.int),
      floatValue: optionalNumber(key?.float) ?? optionalNumber(defaults?.float),
      stringValue: optionalString(key?.string) ?? optionalString(defaults?.string),
      audioPath: optionalString(key?.audio) ?? optionalString(defaults?.audio),
      volume: optionalNumber(key?.volume) ?? optionalNumber(defaults?.volume),
      balance: optionalNumber(key?.balance) ?? optionalNumber(defaults?.balance),
    };
  }).sort((left, right) => left.time - right.time);
}

function runtimeBlendMode(value: number): SpineVatBlendMode {
  if (value === 1) return 'additive';
  if (value === 2) return 'multiply';
  if (value === 3) return 'screen';
  return 'normal';
}

function resolveAtlasPage(textureId: string, atlasTextureIds: string[]): number {
  const exact = atlasTextureIds.indexOf(textureId);
  if (exact >= 0) return exact;
  const prefix = atlasTextureIds.findIndex((id) => textureId.startsWith(id) || id.startsWith(textureId));
  if (prefix >= 0) return prefix;
  if (atlasTextureIds.length === 1) return 0;
  throw new Error(`VAT texture id does not match an atlas page: ${textureId}`);
}

function channelIs(frame: VatFrame, offset: number, expected: number): boolean {
  for (let vertex = 0; vertex < frame.vertexCount; vertex += 1) {
    const start = vertex * VERTEX_STRIDE + offset;
    for (let byte = 0; byte < 4; byte += 1) {
      if (frame.vertices[start + byte] !== expected) return false;
    }
  }
  return true;
}

/** light 的 RGB 在每个顶点都是 255：只有插槽透明度在变，可只存 alpha。 */
function lightRgbIsWhite(frame: VatFrame): boolean {
  for (let vertex = 0; vertex < frame.vertexCount; vertex += 1) {
    const start = vertex * VERTEX_STRIDE + 20;
    if ((frame.vertices[start] & frame.vertices[start + 1] & frame.vertices[start + 2]) !== 0xff) return false;
  }
  return true;
}

function splitPages(
  position: Float32Array,
  light: Uint8Array | undefined,
  lightComponents: 1 | 4,
  dark: Uint8Array | undefined,
  totalTexels: number,
  maxTextureSize: number,
  maxTexturePages: number,
): { pages: SpineVatV2PageData[]; pageTexels: number } {
  const pageTexels = maxTextureSize * maxTextureSize;
  const pageCount = Math.max(1, Math.ceil(totalTexels / pageTexels));
  if (pageCount > maxTexturePages) {
    throw new Error(`VAT needs ${pageCount} texture pages, runtime limit is ${maxTexturePages}`);
  }

  const pages: SpineVatV2PageData[] = [];
  for (let page = 0; page < pageCount; page += 1) {
    const startTexel = page * pageTexels;
    const texelCount = Math.min(pageTexels, totalTexels - startTexel);
    const width = Math.min(maxTextureSize, Math.max(1, texelCount));
    const height = Math.max(1, Math.ceil(texelCount / width));
    const componentCapacity = width * height * 4;
    const positionPage = new Float32Array(componentCapacity);
    positionPage.set(position.subarray(startTexel * 4, (startTexel + texelCount) * 4));
    const lightPage = light ? new Uint8Array(width * height * lightComponents) : undefined;
    const darkPage = dark ? new Uint8Array(componentCapacity) : undefined;
    if (lightPage && light) {
      lightPage.set(light.subarray(startTexel * lightComponents, (startTexel + texelCount) * lightComponents));
    }
    if (darkPage && dark) darkPage.set(dark.subarray(startTexel * 4, (startTexel + texelCount) * 4));
    pages.push({ width, height, position: positionPage, light: lightPage, dark: darkPage });
  }
  return { pages, pageTexels };
}

/**
 * bakes = 官方（剪裁后）输出，只取时长 / 帧率 / socket / bounds；fixed = 同一批动画的固定槽位烘焙，出几何。
 * 任何一段动画过不了固定槽位规则就整体拒绝（规则见 docs/spine-vat-fixed-slot-gpu-clip.md）。
 */
export function compileSpineVatV2(
  bakes: SpineVatBakeResult[],
  fixed: FixedBakeResult[],
  atlasTextureIds: string[],
  analysis: SpineVatAnalysisReport,
  options: SpineVatCompileOptions = {},
): CompiledSpineVatV2 {
  if (bakes.length === 0) throw new Error('VAT v2 compile requires at least one animation');
  if (analysis.recipe.alphaMode === 'unknown') throw new Error('VAT v2 compile requires an explicit alpha mode');
  if (analysis.source.runtimeFamily !== '4.2') throw new Error('VAT v2 compiler currently targets Spine 4.2');
  if (analysis.compatibility.level === 'RUNTIME_FALLBACK') {
    throw new Error('VAT v2 compile refused a RUNTIME_FALLBACK analysis');
  }
  if (atlasTextureIds.length === 0) throw new Error('VAT v2 compile requires atlas texture ids');
  if (fixed.map((bake) => bake.animation).join('|') !== bakes.map((bake) => bake.animation).join('|')) {
    throw new Error('VAT v2 compile: fixed 与 bakes 的动画必须一一对应');
  }
  const maxTextureSize = Math.max(1, Math.floor(options.maxTextureSize ?? 4096));
  const maxTexturePages = Math.max(1, Math.min(4, Math.floor(options.maxTexturePages ?? 4)));

  const plan = planFixedLayout(fixed);
  if (plan.rejected.size > 0) {
    const reasons = Array.from(plan.rejected).map(([name, reason]) => `${name}（${reason}）`).join('；');
    throw new Error(`VAT 无法固定槽位烘焙：${reasons}`);
  }
  const frames = ([] as FixedBakeResult['frames']).concat(...fixed.map((bake) => bake.frames));
  const sources = frames.map((frame) => frame.source);
  const darkAllZero = sources.every((source) => channelIs(source, 24, 0));
  // 没画出来的键 alpha 写 0，light 不可能恒白；RGB 恒白时只存 alpha（a8），运行时以 VAT_LIGHT_ALPHA 还原。
  const lightComponents: 1 | 4 = sources.every(lightRgbIsWhite) ? 1 : 4;
  const stride = plan.frameStride;
  // 最后多占一「帧」放静态区（每顶点所属剪裁）。
  const staticFrame = frames.length;
  const totalTexels = (staticFrame + 1) * stride;
  if (totalTexels > MAX_EXACT_FLOAT_INTEGER) {
    throw new Error(`VAT needs ${totalTexels} texels, exceeding exact float addressing`);
  }
  const exactTextureBytes = totalTexels * (16 + lightComponents + (darkAllZero ? 0 : 4));
  if (exactTextureBytes > analysis.recipe.budget.maxTextureBytes) {
    throw new Error(
      `VAT exact texture data ${exactTextureBytes} bytes exceeds budget ${analysis.recipe.budget.maxTextureBytes}`,
    );
  }
  const position = new Float32Array(totalTexels * 4);
  const light = new Uint8Array(totalTexels * lightComponents);
  const dark = darkAllZero ? undefined : new Uint8Array(totalTexels * 4);
  frames.forEach((frame, index) => {
    writeFixedFrame(plan, frame, index * stride, position, light, lightComponents, dark);
  });
  plan.vertexClip.forEach((clip, vertex) => {
    position[(staticFrame * stride + vertex) * 4] = clip;
  });

  // bounds = 看得见的范围：取官方（剪裁后）输出，不算剪裁前被裁掉的几何。
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const frame of bakes.reduce((all, bake) => all.concat(bake.frames), [] as VatFrame[])) {
    const view = new DataView(frame.vertices.buffer, frame.vertices.byteOffset, frame.vertices.byteLength);
    for (let vertex = 0; vertex < frame.vertexCount; vertex += 1) {
      const x = view.getFloat32(vertex * VERTEX_STRIDE, true);
      const y = view.getFloat32(vertex * VERTEX_STRIDE + 4, true);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  const split = splitPages(position, light, lightComponents, dark, totalTexels, maxTextureSize, maxTexturePages);
  let textureBytes = 0;
  const texturePages: SpineVatManifestV2['texturePages'] = [];
  split.pages.forEach((page, index) => {
    textureBytes += page.position.byteLength + (page.light?.byteLength ?? 0) + (page.dark?.byteLength ?? 0);
    texturePages.push({
      semantic: 'position',
      path: `position-${index}.bin`,
      size: [page.width, page.height],
      format: 'rgba32f',
    });
    if (page.light) texturePages.push({
      semantic: 'light',
      path: `light-${index}.bin`,
      size: [page.width, page.height],
      format: lightComponents === 1 ? 'a8' : 'rgba8',
    });
    if (page.dark) texturePages.push({
      semantic: 'dark',
      path: `dark-${index}.bin`,
      size: [page.width, page.height],
      format: 'rgba8',
    });
  });

  let frameOffset = 0;
  const clips: SpineVatManifestV2['clips'] = bakes.map((bake, index) => {
    const events = extractSpineVatEvents(options.skeletonJson, bake.animation);
    const clip = {
      name: bake.animation,
      variant: 'default',
      fps: bake.frameRate,
      duration: bake.duration,
      frameOffset,
      frameCount: fixed[index].frames.length,
      layout: 'fixed',
      ...(events.length > 0 ? { events } : {}),
      ...(bake.sockets.length > 0 ? { sockets: bake.sockets } : {}),
    };
    frameOffset += clip.frameCount;
    return clip;
  });
  const lanes: SpineVatManifestV2['layouts'][number]['lanes'] = plan.lanes.map((lane, index) => ({
    atlasPage: resolveAtlasPage(lane.textureId, atlasTextureIds),
    textureId: lane.textureId,
    blendMode: runtimeBlendMode(lane.blendMode),
    vertexOffset: lane.vertexOffset,
    vertexCapacity: lane.vertexCapacity,
    logicalLane: index,
    geometryMode: 'indexed-stable',
    indices: lane.indices,
  }));
  const hybrid = clips.some((clip) => (clip.events?.length ?? 0) > 0 || (clip.sockets?.length ?? 0) > 0);
  const manifest: SpineVatManifestV2 = {
    format: 'spine-vat-2',
    source: analysis.source,
    alphaMode: analysis.recipe.alphaMode as Exclude<SpineVatAlphaMode, 'unknown'>,
    textureProfile: 'exact',
    channels: { light: true, dark: Boolean(dark) },
    pageTexels: split.pageTexels,
    texturePages,
    atlasPages: analysis.static.atlasPages.map((page, index) => ({
      id: atlasTextureIds[index] ?? page.name,
      path: page.name,
    })),
    layouts: [{
      id: 'fixed',
      frameStride: stride,
      bounds: [minX, minY, maxX, maxY],
      clipCount: plan.clipKeys.length,
      staticFrame,
      lanes,
    }],
    variants: [{ name: 'default', skins: ['default'], layout: 'fixed' }],
    clips,
    compatibility: {
      level: hybrid ? 'HYBRID' : analysis.compatibility.level,
      warnings: [
        ...analysis.compatibility.warnings,
        ...(options.socketNames?.length
          ? [`已烘焙 socket 骨骼：${options.socketNames.join(', ')}`]
          : []),
      ],
      estimatedGpuBytes: textureBytes + lanes.reduce((sum, lane) => sum + lane.vertexCapacity * 14, 0),
      drawCallsPerBatch: lanes.length,
    },
  };

  return { manifest, pages: split.pages, textureBytes };
}

export async function bakeAndCompileSpineVatV2(
  parent: Node,
  skeletonData: sp.SkeletonData,
  analysis: SpineVatAnalysisReport,
  options: SpineVatCompileOptions = {},
): Promise<CompiledSpineVatV2> {
  if (analysis.recipe.alphaMode === 'unknown') throw new Error('VAT v2 bake requires an explicit alpha mode');
  const premultipliedAlpha = analysis.recipe.alphaMode === 'premultiplied';
  const bakes: SpineVatBakeResult[] = [];
  const fixed: FixedBakeResult[] = [];
  const unclippedData = createUnclippedSkeletonData(skeletonData);
  for (const clip of analysis.clips) {
    if (clip.compatibility === 'RUNTIME_FALLBACK') continue;
    const node = new Node(`VAT-v2-Bake-${clip.name}`);
    node.parent = parent;
    node.setPosition(100000, 100000, 0);
    try {
      const skeleton = node.addComponent(sp.Skeleton);
      skeleton.defaultCacheMode = sp.SpineAnimationCacheMode.REALTIME;
      skeleton.enableBatch = false;
      skeleton.skeletonData = skeletonData;
      bakes.push(bakeSpineAnimation(
        skeleton,
        clip.name,
        clip.fps,
        premultipliedAlpha,
        options.socketNames,
      ));
      const unclippedNode = new Node(`VAT-fixed-Bake-${clip.name}`);
      unclippedNode.parent = node;
      const unclipped = unclippedNode.addComponent(sp.Skeleton);
      unclipped.defaultCacheMode = sp.SpineAnimationCacheMode.REALTIME;
      unclipped.enableBatch = false;
      unclipped.skeletonData = unclippedData;
      fixed.push(bakeFixedSlots(unclipped, skeleton, clip.name, clip.fps, premultipliedAlpha));
    } finally {
      node.destroy();
    }
    await Promise.resolve();
  }
  const atlasTextureIds = skeletonData.textures.map((texture) => texture.uuid);
  return compileSpineVatV2(bakes, fixed, atlasTextureIds, analysis, {
    ...options,
    skeletonJson: skeletonData.skeletonJson,
  });
}

import { Node, sp } from 'cc';
import { materialKey, mergeMaterialSequences } from './SpineVatAnalyzerCore';
import { bakeSpineAnimation } from './SpineVatBaker';
import type { SpineVatBakeResult, VatFrame, VatSegment } from './SpineVatBaker';
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
const MAX_LANE_VERTICES = 0xffff;
const MAX_EXACT_FLOAT_INTEGER = 0x1000000;

interface GroupedSegment extends VatSegment {
  sourceVertexOffset: number;
  sourceIndexOffset: number;
}

interface CompiledFrame {
  source: VatFrame;
  groups: GroupedSegment[];
  globalFrame: number;
}

interface PhysicalLane {
  materialKey: string;
  textureId: string;
  blendMode: SpineVatBlendMode;
  atlasPage: number;
  logicalLane: number;
  logicalVertexStart: number;
  vertexOffset: number;
  vertexCapacity: number;
}

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
  /** 固定槽位烘焙结果（bakeFixedSlots）：能走的动画进 `fixed` layout，其余留在三角形汤。 */
  fixed?: FixedBakeResult[];
  /** bakeAndCompileSpineVatV2 用：同时做固定槽位烘焙。 */
  fixedSlots?: boolean;
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

function groupFrameSegments(frame: VatFrame): GroupedSegment[] {
  const groups: GroupedSegment[] = [];
  let sourceVertexOffset = 0;
  let sourceIndexOffset = 0;
  for (const segment of frame.segments) {
    if (segment.indexCount > 0) {
      const next: GroupedSegment = {
        ...segment,
        sourceVertexOffset,
        sourceIndexOffset,
      };
      const previous = groups[groups.length - 1];
      if (previous && materialKey({
        textureId: previous.textureId,
        blendMode: runtimeBlendMode(previous.blendMode),
      }) === materialKey({
        textureId: next.textureId,
        blendMode: runtimeBlendMode(next.blendMode),
      })) {
        previous.vertexCount += next.vertexCount;
        previous.indexCount += next.indexCount;
      } else {
        groups.push(next);
      }
    }
    sourceVertexOffset += segment.vertexCount;
    sourceIndexOffset += segment.indexCount;
  }
  return groups;
}

function groupKey(group: GroupedSegment): string {
  return materialKey({ textureId: group.textureId, blendMode: runtimeBlendMode(group.blendMode) });
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

export function compileSpineVatV2(
  bakes: SpineVatBakeResult[],
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
  const maxTextureSize = Math.max(1, Math.floor(options.maxTextureSize ?? 4096));
  const maxTexturePages = Math.max(1, Math.min(4, Math.floor(options.maxTexturePages ?? 4)));

  const fixedPlan = options.fixed?.length ? planFixedLayout(options.fixed) : null;
  const fixedNames = new Set(fixedPlan?.accepted.map((bake) => bake.animation) ?? []);
  const fixedFrames = ([] as FixedBakeResult['frames']).concat(...(fixedPlan?.accepted.map((bake) => bake.frames) ?? []));
  const soupBakes = bakes.filter((bake) => !fixedNames.has(bake.animation));

  const frames: CompiledFrame[] = [];
  let globalFrame = 0;
  for (const bake of soupBakes) {
    for (const frame of bake.frames) {
      frames.push({ source: frame, groups: groupFrameSegments(frame), globalFrame });
      globalFrame += 1;
    }
  }

  let logicalKeys: string[] = [];
  for (const frame of frames) logicalKeys = mergeMaterialSequences(logicalKeys, frame.groups.map(groupKey));
  const logicalCapacities = logicalKeys.map(() => 0);
  const frameAssignments: Array<Array<GroupedSegment | undefined>> = [];
  for (const frame of frames) {
    const assignments: Array<GroupedSegment | undefined> = logicalKeys.map(() => undefined);
    let cursor = 0;
    for (const group of frame.groups) {
      const key = groupKey(group);
      while (cursor < logicalKeys.length && logicalKeys[cursor] !== key) cursor += 1;
      if (cursor >= logicalKeys.length) throw new Error(`Frame ${frame.globalFrame} cannot map to render lanes`);
      if (group.indexCount % 3 !== 0) throw new Error(`Frame ${frame.globalFrame} has a non-triangle segment`);
      assignments[cursor] = group;
      logicalCapacities[cursor] = Math.max(logicalCapacities[cursor], group.indexCount);
      cursor += 1;
    }
    frameAssignments.push(assignments);
  }

  const physicalLanes: PhysicalLane[] = [];
  const logicalVertexOffsets: number[] = [];
  let frameStride = 0;
  for (let logicalLane = 0; logicalLane < logicalKeys.length; logicalLane += 1) {
    const key = logicalKeys[logicalLane];
    const [textureId, blendMode] = key.split('\u001f') as [string, SpineVatBlendMode];
    const atlasPage = resolveAtlasPage(textureId, atlasTextureIds);
    logicalVertexOffsets[logicalLane] = frameStride;
    let remaining = logicalCapacities[logicalLane];
    let logicalVertexStart = 0;
    while (remaining > 0) {
      const vertexCapacity = Math.min(MAX_LANE_VERTICES, remaining);
      physicalLanes.push({
        materialKey: key,
        textureId,
        blendMode,
        atlasPage,
        logicalLane,
        logicalVertexStart,
        vertexOffset: frameStride,
        vertexCapacity,
      });
      frameStride += vertexCapacity;
      logicalVertexStart += vertexCapacity;
      remaining -= vertexCapacity;
    }
  }
  if (frameStride === 0 && frames.length > 0) throw new Error('VAT v2 compile produced no renderable triangles');

  const sources = [...frames.map((frame) => frame.source), ...fixedFrames.map((frame) => frame.source)];
  // 固定槽位里没画出来的键 alpha 写 0，light 不可能恒白。
  const lightAllWhite = fixedFrames.length === 0 && sources.every((source) => channelIs(source, 20, 0xff));
  const darkAllZero = sources.every((source) => channelIs(source, 24, 0));
  // 无损：RGB 恒白时 light 只存 alpha（a8，1 B/texel），运行时以 VAT_LIGHT_ALPHA 还原成 (1,1,1,a)。
  const lightComponents: 1 | 4 = !lightAllWhite && sources.every(lightRgbIsWhite) ? 1 : 4;
  // 固定 layout 接在三角形汤后面，起点补齐到它 stride 的整数倍：帧号直接接续，shader 寻址公式不变。
  // 最后多占一「帧」放静态区（每顶点所属剪裁）。
  const fixedStride = fixedPlan?.frameStride ?? 0;
  const fixedBase = fixedFrames.length > 0 ? Math.ceil(frameStride * frames.length / fixedStride) : 0;
  const staticFrame = fixedBase + fixedFrames.length;
  const totalTexels = fixedFrames.length > 0 ? (staticFrame + 1) * fixedStride : frameStride * frames.length;
  if (totalTexels > MAX_EXACT_FLOAT_INTEGER) {
    throw new Error(`VAT needs ${totalTexels} texels, exceeding exact float addressing`);
  }
  const exactTextureBytes = totalTexels * (16 + (lightAllWhite ? 0 : lightComponents) + (darkAllZero ? 0 : 4));
  if (exactTextureBytes > analysis.recipe.budget.maxTextureBytes) {
    throw new Error(
      `VAT exact texture data ${exactTextureBytes} bytes exceeds budget ${analysis.recipe.budget.maxTextureBytes}`,
    );
  }
  const position = new Float32Array(totalTexels * 4);
  const light = lightAllWhite ? undefined : new Uint8Array(totalTexels * lightComponents);
  const dark = darkAllZero ? undefined : new Uint8Array(totalTexels * 4);
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (let frameIndex = 0; frameIndex < frames.length; frameIndex += 1) {
    const frame = frames[frameIndex].source;
    const assignments = frameAssignments[frameIndex];
    const view = new DataView(frame.vertices.buffer, frame.vertices.byteOffset, frame.vertices.byteLength);
    for (let logicalLane = 0; logicalLane < assignments.length; logicalLane += 1) {
      const group = assignments[logicalLane];
      if (!group) continue;
      const logicalTarget = frameIndex * frameStride + logicalVertexOffsets[logicalLane];
      for (let index = 0; index < group.indexCount; index += 1) {
        const sourceVertex = frame.indices[group.sourceIndexOffset + index];
        const groupEnd = group.sourceVertexOffset + group.vertexCount;
        if (sourceVertex < group.sourceVertexOffset || sourceVertex >= groupEnd) {
          throw new Error(`Frame ${frameIndex} segment index escaped its vertex range`);
        }
        const source = sourceVertex * VERTEX_STRIDE;
        const target = (logicalTarget + index) * 4;
        const x = view.getFloat32(source, true);
        const y = view.getFloat32(source + 4, true);
        position[target] = x;
        position[target + 1] = y;
        position[target + 2] = view.getFloat32(source + 12, true);
        position[target + 3] = view.getFloat32(source + 16, true);
        if (light && lightComponents === 1) light[logicalTarget + index] = frame.vertices[source + 23];
        else if (light) light.set(frame.vertices.subarray(source + 20, source + 24), target);
        if (dark) dark.set(frame.vertices.subarray(source + 24, source + 28), target);
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  if (fixedPlan && fixedFrames.length > 0) {
    fixedFrames.forEach((frame, index) => {
      writeFixedFrame(fixedPlan, frame, (fixedBase + index) * fixedStride, position, light, lightComponents, dark);
    });
    // bounds = 看得见的范围：取官方（剪裁后）输出，不算剪裁前被裁掉的几何。
    for (const frame of bakes.filter((bake) => fixedNames.has(bake.animation)).map((bake) => bake.frames)
      .reduce((all, next) => all.concat(next), [] as VatFrame[])) {
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
    fixedPlan.vertexClip.forEach((clip, vertex) => {
      position[(staticFrame * fixedStride + vertex) * 4] = clip;
    });
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
  let fixedOffset = fixedBase;
  const clips: SpineVatManifestV2['clips'] = bakes.map((bake) => {
    const events = extractSpineVatEvents(options.skeletonJson, bake.animation);
    const fixed = fixedNames.has(bake.animation);
    const clip = {
      name: bake.animation,
      variant: 'default',
      fps: bake.frameRate,
      duration: bake.duration,
      frameOffset: fixed ? fixedOffset : frameOffset,
      frameCount: bake.frames.length,
      layout: fixed ? 'fixed' : 'default',
      ...(events.length > 0 ? { events } : {}),
      ...(bake.sockets.length > 0 ? { sockets: bake.sockets } : {}),
    };
    if (fixed) fixedOffset += bake.frames.length;
    else frameOffset += bake.frames.length;
    return clip;
  });
  const bounds: [number, number, number, number] = [minX, minY, maxX, maxY];
  const layouts: SpineVatManifestV2['layouts'] = [];
  if (frames.length > 0) layouts.push({
    id: 'default',
    frameStride,
    bounds,
    lanes: physicalLanes.map((lane) => ({
      atlasPage: lane.atlasPage,
      textureId: lane.textureId,
      blendMode: lane.blendMode,
      vertexOffset: lane.vertexOffset,
      vertexCapacity: lane.vertexCapacity,
      logicalLane: lane.logicalLane,
      geometryMode: 'triangle-soup-dynamic',
    })),
  });
  if (fixedPlan && fixedFrames.length > 0) layouts.push({
    id: 'fixed',
    frameStride: fixedStride,
    bounds,
    clipCount: fixedPlan.clipKeys.length,
    staticFrame,
    lanes: fixedPlan.lanes.map((lane, index) => ({
      atlasPage: resolveAtlasPage(lane.textureId, atlasTextureIds),
      textureId: lane.textureId,
      blendMode: runtimeBlendMode(lane.blendMode),
      vertexOffset: lane.vertexOffset,
      vertexCapacity: lane.vertexCapacity,
      logicalLane: index,
      geometryMode: 'indexed-stable',
      indices: lane.indices,
    })),
  });
  const allLanes = ([] as SpineVatManifestV2['layouts'][number]['lanes']).concat(...layouts.map((layout) => layout.lanes));
  const hybrid = clips.some((clip) => (clip.events?.length ?? 0) > 0 || (clip.sockets?.length ?? 0) > 0);
  const manifest: SpineVatManifestV2 = {
    format: 'spine-vat-2',
    source: analysis.source,
    alphaMode: analysis.recipe.alphaMode as Exclude<SpineVatAlphaMode, 'unknown'>,
    textureProfile: 'exact',
    channels: { light: Boolean(light), dark: Boolean(dark) },
    pageTexels: split.pageTexels,
    texturePages,
    atlasPages: analysis.static.atlasPages.map((page, index) => ({
      id: atlasTextureIds[index] ?? page.name,
      path: page.name,
    })),
    layouts,
    variants: [{ name: 'default', skins: ['default'], layout: 'default' }],
    clips,
    compatibility: {
      level: hybrid ? 'HYBRID' : analysis.compatibility.level,
      warnings: [
        ...analysis.compatibility.warnings,
        ...Array.from(fixedPlan?.rejected ?? new Map<string, string>()).map(([name, reason]) => `${name}: 退回三角形汤（${reason}）`),
        ...(options.socketNames?.length
          ? [`已烘焙 socket 骨骼：${options.socketNames.join(', ')}`]
          : []),
      ],
      estimatedGpuBytes: textureBytes
        + allLanes.reduce((sum, lane) => sum + lane.vertexCapacity * 14, 0),
      drawCallsPerBatch: allLanes.length,
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
  const unclippedData = options.fixedSlots ? createUnclippedSkeletonData(skeletonData) : null;
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
      if (unclippedData) {
        const unclippedNode = new Node(`VAT-fixed-Bake-${clip.name}`);
        unclippedNode.parent = node;
        const unclipped = unclippedNode.addComponent(sp.Skeleton);
        unclipped.defaultCacheMode = sp.SpineAnimationCacheMode.REALTIME;
        unclipped.enableBatch = false;
        unclipped.skeletonData = unclippedData;
        fixed.push(bakeFixedSlots(unclipped, skeleton, clip.name, clip.fps, premultipliedAlpha));
      }
    } finally {
      node.destroy();
    }
    await Promise.resolve();
  }
  const atlasTextureIds = skeletonData.textures.map((texture) => texture.uuid);
  return compileSpineVatV2(bakes, atlasTextureIds, analysis, {
    ...options,
    skeletonJson: skeletonData.skeletonJson,
    fixed,
  });
}

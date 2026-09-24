import type {
  SpineVatAlphaMode,
  SpineVatAtlasPageInfo,
  SpineVatBlendMode,
  SpineVatBudget,
  SpineVatClipAnalysis,
  SpineVatCompatibilityLevel,
  SpineVatFrameProbe,
  SpineVatMaterialSegmentProbe,
  SpineVatStaticAnalysis,
  SpineVatTextureProfile,
} from './SpineVatTypes';

export const DEFAULT_SPINE_VAT_BUDGET: SpineVatBudget = {
  maxRenderLanes: 12,
  maxTextureBytes: 64 * 1024 * 1024,
  maxTextureSize: 4096,
};

type JsonRecord = Record<string, any>;

function objectEntries(value: unknown): Array<[string, any]> {
  return value && typeof value === 'object' ? Object.entries(value as JsonRecord) : [];
}

function countArray(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function containsKey(value: unknown, names: ReadonlySet<string>): boolean {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((entry) => containsKey(entry, names));
  for (const [key, child] of objectEntries(value)) {
    if (names.has(key.toLowerCase()) || containsKey(child, names)) return true;
  }
  return false;
}

function normalizeBlendMode(value: unknown): SpineVatBlendMode {
  const name = String(value ?? 'normal').toLowerCase();
  if (name === 'additive' || name === 'add') return 'additive';
  if (name === 'multiply') return 'multiply';
  if (name === 'screen') return 'screen';
  return 'normal';
}

function parseAtlasPages(atlasText: string): SpineVatAtlasPageInfo[] {
  const normalized = atlasText.replace(/\r/g, '').trim();
  if (!normalized) return [];
  return normalized.split(/\n\s*\n+/).map((block) => {
    const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
    const pmaLine = lines.find((line) => /^pma\s*:/i.test(line));
    const pmaValue = pmaLine?.split(':', 2)[1]?.trim().toLowerCase();
    return {
      name: lines[0] ?? '',
      pma: pmaValue === 'true' ? true : pmaValue === 'false' ? false : null,
    };
  }).filter((page) => page.name.length > 0);
}

/** Spine 4.x 导出勾了「Premultiply alpha」才在每页写 pma: true，没写就是 straight；各页不一致返回 unknown。 */
function inferAlphaMode(pages: SpineVatAtlasPageInfo[]): SpineVatAlphaMode {
  if (pages.length === 0) return 'unknown';
  if (pages.every((page) => page.pma === true)) return 'premultiplied';
  if (pages.every((page) => page.pma !== true)) return 'straight';
  return 'unknown';
}

function skinEntries(skins: unknown): Array<[string, JsonRecord]> {
  if (Array.isArray(skins)) {
    return skins.map((skin, index) => [String(skin?.name ?? `skin-${index}`), skin?.attachments ?? {}]);
  }
  return objectEntries(skins).map(([name, attachments]) => [name, attachments as JsonRecord]);
}

function addAttachmentFeatures(
  attachments: JsonRecord,
  counts: Record<string, number>,
): { weightedMeshes: number; sequences: number } {
  let weightedMeshes = 0;
  let sequences = 0;
  for (const [, slotAttachments] of objectEntries(attachments)) {
    for (const [, attachment] of objectEntries(slotAttachments)) {
      const type = String(attachment?.type ?? 'region').toLowerCase();
      counts[type] = (counts[type] ?? 0) + 1;
      if (attachment?.sequence) sequences += 1;
      if (type === 'mesh' && Array.isArray(attachment?.vertices) && Array.isArray(attachment?.uvs)
        && attachment.vertices.length !== attachment.uvs.length) weightedMeshes += 1;
    }
  }
  return { weightedMeshes, sequences };
}

export function analyzeSpineJson(json: JsonRecord, atlasText: string): SpineVatStaticAnalysis {
  const warnings: string[] = [];
  const spineVersion = String(json?.skeleton?.spine ?? 'unknown');
  const runtimeFamily = /^\d+\.\d+/.exec(spineVersion)?.[0] ?? 'unknown';
  const pages = parseAtlasPages(atlasText);
  const skins = skinEntries(json?.skins);
  const attachmentCounts: Record<string, number> = {};
  let weightedMeshes = 0;
  let sequences = 0;
  for (const [, attachments] of skins) {
    const result = addAttachmentFeatures(attachments, attachmentCounts);
    weightedMeshes += result.weightedMeshes;
    sequences += result.sequences;
  }

  const animations = json?.animations ?? {};
  const slots = Array.isArray(json?.slots) ? json.slots : [];
  const blendModes = Array.from(new Set<SpineVatBlendMode>(
    slots.map((slot: JsonRecord) => normalizeBlendMode(slot?.blend)),
  ));
  if (blendModes.length === 0) blendModes.push('normal');

  const inferredAlphaMode = inferAlphaMode(pages);
  if (runtimeFamily !== '4.2') warnings.push(`目标 worker 是 Spine 4.2，源数据版本为 ${spineVersion}`);
  if (pages.length === 0) warnings.push('Atlas 中没有识别到纹理页');
  if (inferredAlphaMode === 'unknown') warnings.push('Atlas 各页的 pma 声明不一致（有的预乘有的没有），无法判断 alpha 模式');

  return {
    spineVersion,
    runtimeFamily,
    atlasPages: pages,
    inferredAlphaMode,
    features: {
      bones: countArray(json?.bones),
      slots: slots.length,
      skins: skins.map(([name]) => name),
      animations: objectEntries(animations).map(([name]) => name),
      attachments: attachmentCounts,
      weightedMeshes,
      sequences,
      constraints: {
        ik: countArray(json?.ik),
        transform: countArray(json?.transform),
        path: countArray(json?.path),
        physics: countArray(json?.physics),
      },
      timelines: {
        deform: containsKey(animations, new Set(['deform', 'vertices'])),
        attachment: containsKey(animations, new Set(['attachment'])),
        drawOrder: containsKey(animations, new Set(['draworder', 'draw-order'])),
        events: containsKey(animations, new Set(['events', 'event'])),
        twoColor: slots.some((slot: JsonRecord) => typeof slot?.dark === 'string')
          || containsKey(animations, new Set(['rgba2', 'rgb2', 'twocolor'])),
      },
      blendModes,
    },
    warnings,
  };
}

export function materialKey(segment: Pick<SpineVatMaterialSegmentProbe, 'textureId' | 'blendMode'>): string {
  return `${segment.textureId}\u001f${segment.blendMode}`;
}

/** Deterministic shortest common supersequence for one incremental merge. */
export function mergeMaterialSequences(left: string[], right: string[]): string[] {
  const rows = left.length + 1;
  const columns = right.length + 1;
  const lengths = Array.from({ length: rows }, () => new Uint16Array(columns));
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      lengths[i][j] = left[i] === right[j]
        ? lengths[i + 1][j + 1] + 1
        : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
  }

  const result: string[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      result.push(left[i]);
      i += 1;
      j += 1;
    } else if (lengths[i + 1][j] >= lengths[i][j + 1]) {
      result.push(left[i]);
      i += 1;
    } else {
      result.push(right[j]);
      j += 1;
    }
  }
  result.push(...left.slice(i), ...right.slice(j));
  return result;
}

function sameSegments(left: SpineVatMaterialSegmentProbe[], right: SpineVatMaterialSegmentProbe[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((segment, index) => {
    const other = right[index];
    return materialKey(segment) === materialKey(other)
      && segment.vertexCount === other.vertexCount
      && segment.indexCount === other.indexCount;
  });
}

function bytesPerVertex(profile: SpineVatTextureProfile, includeLight: boolean, includeDark: boolean): number {
  const geometryBytes = profile === 'exact' ? 16 : profile === 'balanced' ? 8 : 8;
  return geometryBytes + (includeLight ? 4 : 0) + (includeDark ? 4 : 0);
}

function levelForClip(
  staticAnalysis: SpineVatStaticAnalysis,
  alphaMode: SpineVatAlphaMode,
  warnings: string[],
): SpineVatCompatibilityLevel {
  if (staticAnalysis.runtimeFamily !== '4.2') {
    warnings.push(`Spine ${staticAnalysis.runtimeFamily} 需要独立 worker，本阶段不生成 4.2 VAT`);
    return 'RUNTIME_FALLBACK';
  }
  if (alphaMode === 'unknown') {
    warnings.push('Alpha mode 未确定，禁止生成可能混合错误的 VAT');
    return 'RUNTIME_FALLBACK';
  }
  if (staticAnalysis.features.timelines.events) return 'HYBRID';
  if (staticAnalysis.features.skins.length > 1) return 'BAKED_VARIANT';
  return 'LOSSLESS_VAT';
}

export function buildClipAnalysis(
  name: string,
  duration: number,
  fps: number,
  frames: SpineVatFrameProbe[],
  staticAnalysis: SpineVatStaticAnalysis,
  alphaMode: SpineVatAlphaMode,
  textureProfile: SpineVatTextureProfile,
  budget: SpineVatBudget,
): SpineVatClipAnalysis {
  if (frames.length === 0) throw new Error(`Runtime dry-run produced no frames for ${name}`);
  const first = frames[0];
  let stableVertexLayout = true;
  let stableIndices = true;
  let stableSegments = true;
  const mismatchFrames: number[] = [];
  for (let index = 1; index < frames.length; index += 1) {
    const frame = frames[index];
    const vertexLayoutMatches = frame.vertexCount === first.vertexCount
      && frame.indexCount === first.indexCount;
    const indicesMatch = frame.indexHash === first.indexHash;
    const segmentsMatch = sameSegments(frame.segments, first.segments);
    stableVertexLayout &&= vertexLayoutMatches;
    stableIndices &&= indicesMatch;
    stableSegments &&= segmentsMatch;
    if (!vertexLayoutMatches || !indicesMatch || !segmentsMatch) mismatchFrames.push(frame.frame);
  }
  const stableTopology = stableVertexLayout && stableIndices && stableSegments;
  const geometryMode = stableTopology ? 'indexed-stable' : 'triangle-soup-dynamic';

  let laneKeys: string[] = [];
  for (const frame of frames) {
    laneKeys = mergeMaterialSequences(laneKeys, frame.segments.map(materialKey));
  }
  const laneCapacities = laneKeys.map(() => ({ vertices: 0, indices: 0 }));
  for (const frame of frames) {
    let laneCursor = 0;
    for (const segment of frame.segments) {
      const key = materialKey(segment);
      while (laneCursor < laneKeys.length && laneKeys[laneCursor] !== key) laneCursor += 1;
      if (laneCursor >= laneKeys.length) throw new Error(`Frame ${frame.frame} cannot map to render lanes`);
      laneCapacities[laneCursor].vertices = Math.max(laneCapacities[laneCursor].vertices, segment.vertexCount);
      laneCapacities[laneCursor].indices = Math.max(laneCapacities[laneCursor].indices, segment.indexCount);
      laneCursor += 1;
    }
  }

  const lanes = laneKeys.map((key, index) => {
    const [textureId, blendMode] = key.split('\u001f') as [string, SpineVatBlendMode];
    const vertexCapacity = stableTopology
      ? laneCapacities[index].vertices
      : laneCapacities[index].indices;
    return {
      materialKey: key,
      textureId,
      blendMode,
      vertexCapacity,
      triangleCapacity: Math.ceil(laneCapacities[index].indices / 3),
    };
  });

  const staticUv = stableTopology && frames.every((frame) => frame.uvHash === first.uvHash);
  const lightAllWhite = frames.every((frame) => frame.lightAllWhite);
  const darkAllZero = frames.every((frame) => frame.darkAllZero);
  const totalVertexCapacity = lanes.reduce((sum, lane) => sum + lane.vertexCapacity, 0);
  const texelsPerSemantic = totalVertexCapacity * frames.length;
  const semanticTextureCount = 1 + (!lightAllWhite ? 1 : 0) + (!darkAllZero ? 1 : 0);
  const textureSize = Math.max(1, Math.floor(budget.maxTextureSize));
  const texelsPerPage = textureSize * textureSize;
  const estimatedTexturePages = semanticTextureCount * Math.max(1, Math.ceil(texelsPerSemantic / texelsPerPage));
  const estimatedTextureBytes = totalVertexCapacity * frames.length
    * bytesPerVertex(textureProfile, !lightAllWhite, !darkAllZero);
  const estimatedMeshBytes = totalVertexCapacity * 12
    + lanes.reduce((sum, lane) => sum + lane.triangleCapacity * 3 * 2, 0);
  const warnings: string[] = [];
  let compatibility = levelForClip(staticAnalysis, alphaMode, warnings);
  if (!stableTopology) warnings.push(`发现 ${mismatchFrames.length} 个变化拓扑帧，将使用 triangle soup`);
  if (lanes.length > budget.maxRenderLanes) {
    warnings.push(`Render Lane ${lanes.length} 超过预算 ${budget.maxRenderLanes}`);
    compatibility = 'RUNTIME_FALLBACK';
  }
  if (estimatedTextureBytes > budget.maxTextureBytes) {
    warnings.push(`预计纹理 ${estimatedTextureBytes} 字节超过预算 ${budget.maxTextureBytes}`);
    compatibility = 'RUNTIME_FALLBACK';
  }

  return {
    name,
    duration,
    fps,
    frameCount: frames.length,
    geometryMode,
    stableVertexLayout,
    stableIndices,
    stableSegments,
    staticUv,
    lightAllWhite,
    darkAllZero,
    mismatchFrames,
    lanes,
    estimatedTextureBytes,
    estimatedTexturePages,
    estimatedMeshBytes,
    compatibility,
    warnings,
  };
}

const LEVEL_PRIORITY: Record<SpineVatCompatibilityLevel, number> = {
  LOSSLESS_VAT: 0,
  BAKED_VARIANT: 1,
  HYBRID: 2,
  RUNTIME_FALLBACK: 3,
};

export function aggregateCompatibility(clips: SpineVatClipAnalysis[]): SpineVatCompatibilityLevel {
  return clips.reduce<SpineVatCompatibilityLevel>((result, clip) => (
    LEVEL_PRIORITY[clip.compatibility] > LEVEL_PRIORITY[result] ? clip.compatibility : result
  ), 'LOSSLESS_VAT');
}

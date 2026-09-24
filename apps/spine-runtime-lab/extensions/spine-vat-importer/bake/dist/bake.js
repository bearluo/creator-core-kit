// 生成物，勿手改：node tools/build-bake.mjs
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// apps/spine-runtime-lab/extensions/spine-vat-importer/bake/src/index.ts
var index_exports = {};
__export(index_exports, {
  bakeSpineVat: () => bakeSpineVat
});
module.exports = __toCommonJS(index_exports);
var import_cc5 = require("cc");

// apps/spine-runtime-lab/extensions/spine-vat-importer/bake/src/SpineVatAnalyzer.ts
var import_cc = require("cc");

// apps/spine-runtime-lab/extensions/spine-vat-importer/bake/src/SpineVatAnalyzerCore.ts
var DEFAULT_SPINE_VAT_BUDGET = {
  maxRenderLanes: 12,
  maxTextureBytes: 64 * 1024 * 1024,
  maxTextureSize: 4096
};
function objectEntries(value) {
  return value && typeof value === "object" ? Object.entries(value) : [];
}
function countArray(value) {
  return Array.isArray(value) ? value.length : 0;
}
function containsKey(value, names) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((entry) => containsKey(entry, names));
  for (const [key, child] of objectEntries(value)) {
    if (names.has(key.toLowerCase()) || containsKey(child, names)) return true;
  }
  return false;
}
function normalizeBlendMode(value) {
  const name = String(value ?? "normal").toLowerCase();
  if (name === "additive" || name === "add") return "additive";
  if (name === "multiply") return "multiply";
  if (name === "screen") return "screen";
  return "normal";
}
function parseAtlasPages(atlasText) {
  const normalized = atlasText.replace(/\r/g, "").trim();
  if (!normalized) return [];
  return normalized.split(/\n\s*\n+/).map((block) => {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    const pmaLine = lines.find((line) => /^pma\s*:/i.test(line));
    const pmaValue = pmaLine?.split(":", 2)[1]?.trim().toLowerCase();
    return {
      name: lines[0] ?? "",
      pma: pmaValue === "true" ? true : pmaValue === "false" ? false : null
    };
  }).filter((page) => page.name.length > 0);
}
function inferAlphaMode(pages) {
  const declared = pages.map((page) => page.pma).filter((value) => value !== null);
  if (declared.length !== pages.length || declared.length === 0) return "unknown";
  if (declared.every(Boolean)) return "premultiplied";
  if (declared.every((value) => !value)) return "straight";
  return "unknown";
}
function skinEntries(skins) {
  if (Array.isArray(skins)) {
    return skins.map((skin, index) => [String(skin?.name ?? `skin-${index}`), skin?.attachments ?? {}]);
  }
  return objectEntries(skins).map(([name, attachments]) => [name, attachments]);
}
function addAttachmentFeatures(attachments, counts) {
  let weightedMeshes = 0;
  let sequences = 0;
  for (const [, slotAttachments] of objectEntries(attachments)) {
    for (const [, attachment] of objectEntries(slotAttachments)) {
      const type = String(attachment?.type ?? "region").toLowerCase();
      counts[type] = (counts[type] ?? 0) + 1;
      if (attachment?.sequence) sequences += 1;
      if (type === "mesh" && Array.isArray(attachment?.vertices) && Array.isArray(attachment?.uvs) && attachment.vertices.length !== attachment.uvs.length) weightedMeshes += 1;
    }
  }
  return { weightedMeshes, sequences };
}
function analyzeSpineJson(json, atlasText) {
  const warnings = [];
  const spineVersion = String(json?.skeleton?.spine ?? "unknown");
  const runtimeFamily = /^\d+\.\d+/.exec(spineVersion)?.[0] ?? "unknown";
  const pages = parseAtlasPages(atlasText);
  const skins = skinEntries(json?.skins);
  const attachmentCounts = {};
  let weightedMeshes = 0;
  let sequences = 0;
  for (const [, attachments] of skins) {
    const result = addAttachmentFeatures(attachments, attachmentCounts);
    weightedMeshes += result.weightedMeshes;
    sequences += result.sequences;
  }
  const animations = json?.animations ?? {};
  const slots = Array.isArray(json?.slots) ? json.slots : [];
  const blendModes = Array.from(new Set(
    slots.map((slot) => normalizeBlendMode(slot?.blend))
  ));
  if (blendModes.length === 0) blendModes.push("normal");
  const inferredAlphaMode = inferAlphaMode(pages);
  if (runtimeFamily !== "4.2") warnings.push(`\u76EE\u6807 worker \u662F Spine 4.2\uFF0C\u6E90\u6570\u636E\u7248\u672C\u4E3A ${spineVersion}`);
  if (pages.length === 0) warnings.push("Atlas \u4E2D\u6CA1\u6709\u8BC6\u522B\u5230\u7EB9\u7406\u9875");
  if (inferredAlphaMode === "unknown") warnings.push("Atlas \u672A\u63D0\u4F9B\u4E00\u81F4\u7684 pma \u58F0\u660E\uFF0C\u9700\u8981 recipe \u660E\u786E\u6307\u5B9A alpha mode");
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
        physics: countArray(json?.physics)
      },
      timelines: {
        deform: containsKey(animations, /* @__PURE__ */ new Set(["deform", "vertices"])),
        attachment: containsKey(animations, /* @__PURE__ */ new Set(["attachment"])),
        drawOrder: containsKey(animations, /* @__PURE__ */ new Set(["draworder", "draw-order"])),
        events: containsKey(animations, /* @__PURE__ */ new Set(["events", "event"])),
        twoColor: slots.some((slot) => typeof slot?.dark === "string") || containsKey(animations, /* @__PURE__ */ new Set(["rgba2", "rgb2", "twocolor"]))
      },
      blendModes
    },
    warnings
  };
}
function materialKey(segment) {
  return `${segment.textureId}${segment.blendMode}`;
}
function mergeMaterialSequences(left, right) {
  const rows = left.length + 1;
  const columns = right.length + 1;
  const lengths = Array.from({ length: rows }, () => new Uint16Array(columns));
  for (let i2 = left.length - 1; i2 >= 0; i2 -= 1) {
    for (let j2 = right.length - 1; j2 >= 0; j2 -= 1) {
      lengths[i2][j2] = left[i2] === right[j2] ? lengths[i2 + 1][j2 + 1] + 1 : Math.max(lengths[i2 + 1][j2], lengths[i2][j2 + 1]);
    }
  }
  const result = [];
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
function sameSegments(left, right) {
  if (left.length !== right.length) return false;
  return left.every((segment, index) => {
    const other = right[index];
    return materialKey(segment) === materialKey(other) && segment.vertexCount === other.vertexCount && segment.indexCount === other.indexCount;
  });
}
function bytesPerVertex(profile, includeLight, includeDark) {
  const geometryBytes = profile === "exact" ? 16 : profile === "balanced" ? 8 : 8;
  return geometryBytes + (includeLight ? 4 : 0) + (includeDark ? 4 : 0);
}
function levelForClip(staticAnalysis, alphaMode, warnings) {
  if (staticAnalysis.runtimeFamily !== "4.2") {
    warnings.push(`Spine ${staticAnalysis.runtimeFamily} \u9700\u8981\u72EC\u7ACB worker\uFF0C\u672C\u9636\u6BB5\u4E0D\u751F\u6210 4.2 VAT`);
    return "RUNTIME_FALLBACK";
  }
  if (alphaMode === "unknown") {
    warnings.push("Alpha mode \u672A\u786E\u5B9A\uFF0C\u7981\u6B62\u751F\u6210\u53EF\u80FD\u6DF7\u5408\u9519\u8BEF\u7684 VAT");
    return "RUNTIME_FALLBACK";
  }
  if (staticAnalysis.features.timelines.events) return "HYBRID";
  if (staticAnalysis.features.skins.length > 1) return "BAKED_VARIANT";
  return "LOSSLESS_VAT";
}
function buildClipAnalysis(name, duration, fps, frames, staticAnalysis, alphaMode, textureProfile, budget) {
  if (frames.length === 0) throw new Error(`Runtime dry-run produced no frames for ${name}`);
  const first = frames[0];
  let stableVertexLayout = true;
  let stableIndices = true;
  let stableSegments = true;
  const mismatchFrames = [];
  for (let index = 1; index < frames.length; index += 1) {
    const frame = frames[index];
    const vertexLayoutMatches = frame.vertexCount === first.vertexCount && frame.indexCount === first.indexCount;
    const indicesMatch = frame.indexHash === first.indexHash;
    const segmentsMatch = sameSegments(frame.segments, first.segments);
    stableVertexLayout && (stableVertexLayout = vertexLayoutMatches);
    stableIndices && (stableIndices = indicesMatch);
    stableSegments && (stableSegments = segmentsMatch);
    if (!vertexLayoutMatches || !indicesMatch || !segmentsMatch) mismatchFrames.push(frame.frame);
  }
  const stableTopology = stableVertexLayout && stableIndices && stableSegments;
  const geometryMode = stableTopology ? "indexed-stable" : "triangle-soup-dynamic";
  let laneKeys = [];
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
    const [textureId, blendMode] = key.split("");
    const vertexCapacity = stableTopology ? laneCapacities[index].vertices : laneCapacities[index].indices;
    return {
      materialKey: key,
      textureId,
      blendMode,
      vertexCapacity,
      triangleCapacity: Math.ceil(laneCapacities[index].indices / 3)
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
  const estimatedTextureBytes = totalVertexCapacity * frames.length * bytesPerVertex(textureProfile, !lightAllWhite, !darkAllZero);
  const estimatedMeshBytes = totalVertexCapacity * 12 + lanes.reduce((sum, lane) => sum + lane.triangleCapacity * 3 * 2, 0);
  const warnings = [];
  let compatibility = levelForClip(staticAnalysis, alphaMode, warnings);
  if (!stableTopology) warnings.push(`\u53D1\u73B0 ${mismatchFrames.length} \u4E2A\u53D8\u5316\u62D3\u6251\u5E27\uFF0C\u5C06\u4F7F\u7528 triangle soup`);
  if (lanes.length > budget.maxRenderLanes) {
    warnings.push(`Render Lane ${lanes.length} \u8D85\u8FC7\u9884\u7B97 ${budget.maxRenderLanes}`);
    compatibility = "RUNTIME_FALLBACK";
  }
  if (estimatedTextureBytes > budget.maxTextureBytes) {
    warnings.push(`\u9884\u8BA1\u7EB9\u7406 ${estimatedTextureBytes} \u5B57\u8282\u8D85\u8FC7\u9884\u7B97 ${budget.maxTextureBytes}`);
    compatibility = "RUNTIME_FALLBACK";
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
    warnings
  };
}
var LEVEL_PRIORITY = {
  LOSSLESS_VAT: 0,
  BAKED_VARIANT: 1,
  HYBRID: 2,
  RUNTIME_FALLBACK: 3
};
function aggregateCompatibility(clips) {
  return clips.reduce((result, clip) => LEVEL_PRIORITY[clip.compatibility] > LEVEL_PRIORITY[result] ? clip.compatibility : result, "LOSSLESS_VAT");
}

// apps/spine-runtime-lab/extensions/spine-vat-importer/bake/src/SpineVatAnalyzer.ts
var TINTED_VERTEX_STRIDE = 28;
function blendModeFromRuntime(value) {
  if (value === 1) return "additive";
  if (value === 2) return "multiply";
  if (value === 3) return "screen";
  return "normal";
}
function fnvUpdate(hash, value) {
  return Math.imul((hash ^ value) >>> 0, 16777619) >>> 0;
}
function hashStridedBytes(heap, vertexPtr, vertexCount, offset, byteCount) {
  let hash = 2166136261;
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const start = vertexPtr + vertex * TINTED_VERTEX_STRIDE + offset;
    for (let byte = 0; byte < byteCount; byte += 1) hash = fnvUpdate(hash, heap[start + byte]);
  }
  return hash.toString(16).padStart(8, "0");
}
function allStridedBytes(heap, vertexPtr, vertexCount, offset, byteCount, expected) {
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const start = vertexPtr + vertex * TINTED_VERTEX_STRIDE + offset;
    for (let byte = 0; byte < byteCount; byte += 1) {
      if (heap[start + byte] !== expected) return false;
    }
  }
  return true;
}
function hashIndices(heap, indexPtr, indexCount) {
  let hash = 2166136261;
  const end = indexPtr + indexCount * Uint16Array.BYTES_PER_ELEMENT;
  for (let offset = indexPtr; offset < end; offset += 1) hash = fnvUpdate(hash, heap[offset]);
  return hash.toString(16).padStart(8, "0");
}
function mergeAdjacentSegments(segments) {
  const merged = [];
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
function captureFrame(skeleton, frame, time) {
  const model = skeleton.updateRenderData();
  if (!model) throw new Error("Spine updateRenderData() did not return a WASM model");
  const heap = import_cc.sp.spine.wasmUtil?.wasm?.HEAPU8;
  if (!heap) throw new Error("Spine WASM heap is unavailable; dry-run must execute in Creator Web/WASM");
  const data = model.getData();
  const textures = model.getTextures();
  const segments = [];
  for (let index = 0; index < data.size(); index += 5) {
    segments.push({
      vertexCount: data.get(index + 2),
      indexCount: data.get(index + 3),
      blendMode: blendModeFromRuntime(data.get(index + 4)),
      textureId: String(textures.get(index / 5))
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
    lightAllWhite: allStridedBytes(heap, model.vPtr, model.vCount, 20, 4, 255),
    darkAllZero: allStridedBytes(heap, model.vPtr, model.vCount, 24, 4, 0),
    segments: mergeAdjacentSegments(segments)
  };
}
async function hashSourceTexts(values) {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const hashes2 = {};
    for (const [name, value] of Object.entries(values)) {
      const digest = await subtle.digest("SHA-256", new TextEncoder().encode(value));
      hashes2[name] = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    }
    return { algorithm: "SHA-256", hashes: hashes2 };
  }
  const hashes = {};
  for (const [name, value] of Object.entries(values)) {
    let hash = 2166136261;
    const bytes2 = new TextEncoder().encode(value);
    for (const byte of bytes2) hash = fnvUpdate(hash, byte);
    hashes[name] = hash.toString(16).padStart(8, "0");
  }
  return { algorithm: "FNV-1A-32", hashes };
}
function parseSkeletonJson(skeletonData) {
  const source = skeletonData.skeletonJson;
  if (typeof source === "string") return JSON.parse(source);
  if (!source || typeof source !== "object") {
    throw new Error("Spine VAT analyzer requires JSON SkeletonData; binary (.skel) is not supported");
  }
  return source;
}
function sampleAnimation(parent, skeletonData, animationName, frameRate, alphaMode) {
  const node = new import_cc.Node(`VAT-Analyze-${animationName}`);
  node.parent = parent;
  node.setPosition(1e5, 1e5, 0);
  const skeleton = node.addComponent(import_cc.sp.Skeleton);
  skeleton.defaultCacheMode = import_cc.sp.SpineAnimationCacheMode.REALTIME;
  skeleton.enableBatch = false;
  skeleton.useTint = true;
  skeleton.premultipliedAlpha = alphaMode === "premultiplied";
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
  const frames = [];
  for (let frame = 0; frame < frameCount; frame += 1) {
    skeleton._instance.updateAnimation(frame > 0 ? 1 / frameRate : 0);
    frames.push(captureFrame(skeleton, frame, frame / frameRate));
  }
  node.destroy();
  return { duration, frames };
}
async function analyzeSpineVatSkeletonData(parent, skeletonData, options = {}) {
  const json = parseSkeletonJson(skeletonData);
  const atlasText = skeletonData.atlasText ?? "";
  const staticAnalysis = analyzeSpineJson(json, atlasText);
  const alphaMode = options.alphaMode ?? staticAnalysis.inferredAlphaMode;
  const frameRate = Math.max(1, Math.floor(options.frameRate ?? 60));
  const textureProfile = options.textureProfile ?? "balanced";
  const budget = { ...DEFAULT_SPINE_VAT_BUDGET, ...options.budget };
  const animationNames = options.animations ?? staticAnalysis.features.animations;
  const sourceHashes = await hashSourceTexts({
    skeletonJson: JSON.stringify(json),
    atlasText
  });
  const clips = [];
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
      budget
    ));
    await Promise.resolve();
  }
  const estimatedGpuBytes = clips.reduce(
    (sum, clip) => sum + clip.estimatedTextureBytes + clip.estimatedMeshBytes,
    0
  );
  const warnings = [...staticAnalysis.warnings];
  for (const clip of clips) {
    warnings.push(...clip.warnings.map((warning) => `${clip.name}: ${warning}`));
  }
  let level = aggregateCompatibility(clips);
  if (estimatedGpuBytes > budget.maxTextureBytes) {
    warnings.push(`\u5168\u90E8\u52A8\u753B\u9884\u8BA1 GPU \u6570\u636E ${estimatedGpuBytes} \u5B57\u8282\u8D85\u8FC7\u8D44\u4EA7\u9884\u7B97 ${budget.maxTextureBytes}`);
    level = "RUNTIME_FALLBACK";
  }
  return {
    format: "spine-vat-analysis-1",
    source: {
      creator: "3.8.7",
      spineVersion: staticAnalysis.spineVersion,
      runtimeFamily: staticAnalysis.runtimeFamily,
      hashAlgorithm: sourceHashes.algorithm,
      hashes: sourceHashes.hashes
    },
    recipe: {
      alphaMode,
      fps: frameRate,
      textureProfile,
      budget
    },
    static: staticAnalysis,
    clips,
    compatibility: {
      level,
      warnings,
      estimatedGpuBytes,
      drawCallsPerBatch: clips.reduce((maximum, clip) => Math.max(maximum, clip.lanes.length), 0)
    }
  };
}

// apps/spine-runtime-lab/extensions/spine-vat-importer/bake/src/SpineVatCompilerV2.ts
var import_cc4 = require("cc");

// apps/spine-runtime-lab/extensions/spine-vat-importer/bake/src/SpineVatBaker.ts
var import_cc2 = require("cc");
var FRAME_RATE = 60;
var TINTED_VERTEX_STRIDE2 = 28;
function equalIndices(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
function equalSegments(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i];
    const right = b[i];
    if (left.vertexCount !== right.vertexCount || left.indexCount !== right.indexCount || left.blendMode !== right.blendMode || left.textureId !== right.textureId) return false;
  }
  return true;
}
function captureSpineVatFrame(skeleton, time) {
  const model = skeleton.updateRenderData();
  const heap = import_cc2.sp.spine.wasmUtil.wasm.HEAPU8;
  const vertexBytes = model.vCount * TINTED_VERTEX_STRIDE2;
  const indexBytes = model.iCount * Uint16Array.BYTES_PER_ELEMENT;
  const vertices = heap.slice(model.vPtr, model.vPtr + vertexBytes);
  const indexCopy = heap.slice(model.iPtr, model.iPtr + indexBytes);
  const indices = new Uint16Array(indexCopy.buffer, indexCopy.byteOffset, model.iCount).slice();
  const data = model.getData();
  const textures = model.getTextures();
  const segments = [];
  for (let i = 0; i < data.size(); i += 5) {
    segments.push({
      vertexCount: data.get(i + 2),
      indexCount: data.get(i + 3),
      blendMode: data.get(i + 4),
      textureId: textures.get(i / 5)
    });
  }
  return {
    time,
    vertexCount: model.vCount,
    indexCount: model.iCount,
    segments,
    vertices,
    indices
  };
}
function bakeSpineAnimation(skeleton, animationName, frameRate = FRAME_RATE, premultipliedAlpha = false, socketNames = []) {
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
  const frames = [];
  const socketTracks = socketNames.map((name) => ({ name, frames: [] }));
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    skeleton._instance.updateAnimation(frameIndex > 0 ? 1 / frameRate : 0);
    frames.push(captureSpineVatFrame(skeleton, frameIndex / frameRate));
    for (const track of socketTracks) {
      const bone = skeleton.findBone(track.name);
      if (!bone) throw new Error(`Spine socket bone not found: ${track.name}`);
      const matrix = [bone.a, bone.b, bone.c, bone.d, bone.worldX, bone.worldY];
      track.frames.push(matrix);
    }
  }
  const first = frames[0];
  let stableVertexLayout = true;
  let stableIndices = true;
  let stableSegments = true;
  const mismatchFrames = [];
  for (let i = 1; i < frames.length; i += 1) {
    const frame = frames[i];
    const vertexLayoutMatches = frame.vertexCount === first.vertexCount && frame.indexCount === first.indexCount;
    const indicesMatch = equalIndices(frame.indices, first.indices);
    const segmentsMatch = equalSegments(frame.segments, first.segments);
    stableVertexLayout && (stableVertexLayout = vertexLayoutMatches);
    stableIndices && (stableIndices = indicesMatch);
    stableSegments && (stableSegments = segmentsMatch);
    if (!vertexLayoutMatches || !indicesMatch || !segmentsMatch) mismatchFrames.push(i);
  }
  const result = {
    animation: animationName,
    duration,
    frameRate,
    frames,
    stableVertexLayout,
    stableIndices,
    stableSegments,
    stableTopology: stableVertexLayout && stableIndices && stableSegments,
    mismatchFrames,
    sockets: socketTracks
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
    mismatchFrames
  };
  console.log(`[VatBake] ${JSON.stringify(summary)}`);
  return result;
}

// apps/spine-runtime-lab/extensions/spine-vat-importer/bake/src/SpineVatFixedBaker.ts
var import_cc3 = require("cc");
function createUnclippedSkeletonData(source) {
  const json = JSON.parse(JSON.stringify(source.skeletonJson));
  if (json.skeleton?.hash) json.skeleton.hash = `${json.skeleton.hash}-vat-unclipped`;
  const removed = /* @__PURE__ */ new Set();
  for (const skin of json.skins ?? []) {
    for (const [slot, attachments] of Object.entries(skin.attachments ?? {})) {
      for (const [name, attachment] of Object.entries(attachments)) {
        if (attachment?.type !== "clipping") continue;
        delete attachments[name];
        removed.add(`${skin.name}/${slot}/${name}`);
      }
    }
  }
  for (const animation of Object.values(json.animations ?? {})) {
    for (const [skin, slots] of Object.entries(animation.attachments ?? {})) {
      for (const [slot, attachments] of Object.entries(slots)) {
        for (const name of Object.keys(attachments)) {
          if (removed.has(`${skin}/${slot}/${name}`)) delete attachments[name];
        }
      }
    }
  }
  const result = new import_cc3.sp.SkeletonData();
  result.skeletonJson = json;
  result.atlasText = source.atlasText;
  result.textureNames = [...source.textureNames];
  result.textures = [...source.textures];
  result.scale = source.scale;
  return result;
}
var spine = () => import_cc3.sp.spine;
function renderedKeys(skeleton) {
  const keys = [];
  for (const slot of skeleton.drawOrder) {
    if (!slot.bone.active) continue;
    const attachment = slot.getAttachment();
    if (!attachment) continue;
    const index = slot.data.index;
    if (attachment instanceof spine().RegionAttachment) {
      keys.push({ key: `${index}/${attachment.name}`, slot: index, vertexCount: 4, indexCount: 6 });
    } else if (attachment instanceof spine().MeshAttachment) {
      keys.push({
        key: `${index}/${attachment.name}`,
        slot: index,
        vertexCount: attachment.worldVerticesLength / 2,
        indexCount: attachment.triangles.length
      });
    }
  }
  return keys;
}
function clipState(skeleton) {
  const bySlot = /* @__PURE__ */ new Map();
  const clips = /* @__PURE__ */ new Map();
  let current = null;
  const clipEnd = (slot) => {
    if (current && current.end === slot.data.index) current = null;
  };
  for (const slot of skeleton.drawOrder) {
    if (!slot.bone.active) continue;
    const attachment = slot.getAttachment();
    if (!attachment) {
      clipEnd(slot);
      continue;
    }
    if (attachment instanceof spine().ClippingAttachment) {
      if (current) continue;
      const key = `${slot.data.index}/${attachment.name}`;
      const polygon = new Array(attachment.worldVerticesLength).fill(0);
      attachment.computeWorldVertices(slot, 0, attachment.worldVerticesLength, polygon, 0, 2);
      clips.set(key, polygon);
      current = { key, end: attachment.endSlot.index };
      continue;
    }
    if (current && (attachment instanceof spine().RegionAttachment || attachment instanceof spine().MeshAttachment)) {
      bySlot.set(slot.data.index, current.key);
    }
    clipEnd(slot);
  }
  return { bySlot, clips };
}
function bakeFixedSlots(unclipped, original, animationName, frameRate, premultipliedAlpha) {
  const animation = original.findAnimation(animationName);
  if (!animation) throw new Error(`Spine animation not found: ${animationName}`);
  for (const skeleton of [unclipped, original]) {
    skeleton.paused = true;
    skeleton.useTint = true;
    skeleton.premultipliedAlpha = premultipliedAlpha;
    skeleton.clearTracks();
    skeleton.setToSetupPose();
    skeleton.setAnimation(0, animationName, false);
  }
  const frameCount = Math.max(1, Math.ceil(animation.duration * frameRate));
  const frames = [];
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    for (const skeleton of [unclipped, original]) {
      skeleton._instance.updateAnimation(frameIndex > 0 ? 1 / frameRate : 0);
    }
    const source = captureSpineVatFrame(unclipped, frameIndex / frameRate);
    original.updateRenderData();
    const { bySlot, clips } = clipState(original._skeleton);
    const materials = [];
    let segmentEnd = 0;
    for (const segment of source.segments) {
      segmentEnd += segment.vertexCount;
      materials.push({ end: segmentEnd, textureId: segment.textureId, blendMode: segment.blendMode });
    }
    let vertexStart = 0;
    let indexStart = 0;
    const keys = renderedKeys(unclipped._skeleton).map((entry) => {
      const material = materials.find((candidate) => candidate.end > vertexStart);
      if (!material) throw new Error(`${animationName} \u5E27 ${frameIndex}\uFF1A\u9644\u4EF6 ${entry.key} \u8D85\u51FA\u6E32\u67D3\u8F93\u51FA`);
      const range = {
        ...entry,
        vertexStart,
        indexStart,
        textureId: material.textureId,
        blendMode: material.blendMode,
        clip: bySlot.get(entry.slot) ?? null
      };
      vertexStart += entry.vertexCount;
      indexStart += entry.indexCount;
      return range;
    });
    if (vertexStart !== source.vertexCount || indexStart !== source.indexCount) {
      throw new Error(`${animationName} \u5E27 ${frameIndex}\uFF1A\u6309 drawOrder \u6570\u51FA ${vertexStart}/${indexStart}\uFF0C\u6E32\u67D3\u8F93\u51FA ${source.vertexCount}/${source.indexCount}`);
    }
    frames.push({ source, keys, clips });
  }
  return { animation: animationName, frames };
}

// apps/spine-runtime-lab/extensions/spine-vat-importer/bake/src/SpineVatFixedLayout.ts
var MAX_CLIP_VERTICES = 8;
var VERTEX_STRIDE = 28;
var MAX_LANE_VERTICES = 65535;
function keyInfos(frame) {
  return frame.keys.map((range) => ({
    key: range.key,
    vertexCount: range.vertexCount,
    textureId: range.textureId,
    blendMode: range.blendMode,
    triangles: Array.from(
      frame.source.indices.subarray(range.indexStart, range.indexStart + range.indexCount),
      (index) => index - range.vertexStart
    )
  }));
}
function sameInfo(a, b) {
  if (a.vertexCount !== b.vertexCount || a.triangles.length !== b.triangles.length) return `\u9644\u4EF6 ${a.key} \u9876\u70B9\u6570/\u4E09\u89D2\u5F62\u6570\u9010\u5E27\u53D8\u5316`;
  if (a.textureId !== b.textureId || a.blendMode !== b.blendMode) return `\u9644\u4EF6 ${a.key} \u6750\u8D28\u9010\u5E27\u53D8\u5316`;
  for (let i = 0; i < a.triangles.length; i += 1) {
    if (a.triangles[i] !== b.triangles[i]) return `\u9644\u4EF6 ${a.key} \u4E09\u89D2\u5F62\u9010\u5E27\u53D8\u5316`;
  }
  return null;
}
function mergeOrder(order, sequence) {
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
function clipConflict(frames, clipOf) {
  for (const frame of frames) {
    for (const range of frame.keys) {
      const owner = clipOf.get(range.key);
      if (range.clip && owner && range.clip !== owner) return `\u9644\u4EF6 ${range.key} \u5148\u540E\u88AB\u4E0D\u540C\u526A\u88C1\u88C1`;
      if (!range.clip && owner && frame.clips.has(owner)) return `\u9644\u4EF6 ${range.key} \u7684\u526A\u88C1\u8303\u56F4\u9010\u5E27\u53D8\u5316`;
    }
  }
  return null;
}
function planFixedLayout(bakes) {
  let order = [];
  const infos = /* @__PURE__ */ new Map();
  const clipOf = /* @__PURE__ */ new Map();
  const accepted = [];
  const rejected = /* @__PURE__ */ new Map();
  for (const bake of bakes) {
    let clipOrder = order;
    const clipInfos = new Map(infos);
    const clipClipOf = new Map(clipOf);
    let reason = null;
    for (const frame of bake.frames) {
      for (const polygon of frame.clips.values()) {
        if (polygon.length / 2 > MAX_CLIP_VERTICES) reason ?? (reason = `\u526A\u88C1\u591A\u8FB9\u5F62 ${polygon.length / 2} \u4E2A\u9876\u70B9\uFF0C\u8D85\u8FC7 ${MAX_CLIP_VERTICES}`);
      }
      const merged = mergeOrder(clipOrder, frame.keys.map((range) => range.key));
      if (!merged) reason ?? (reason = "\u7ED8\u5236\u987A\u5E8F\u9010\u5E27\u53D8\u5316");
      else clipOrder = merged;
      for (const info of keyInfos(frame)) {
        const known = clipInfos.get(info.key);
        if (!known) clipInfos.set(info.key, info);
        else reason ?? (reason = sameInfo(known, info));
      }
      for (const range of frame.keys) {
        if (range.clip && !clipClipOf.has(range.key)) clipClipOf.set(range.key, range.clip);
      }
      if (reason) break;
    }
    reason ?? (reason = clipConflict(bake.frames, clipClipOf));
    if (reason) {
      rejected.set(bake.animation, reason);
      continue;
    }
    order = clipOrder;
    clipInfos.forEach((info, key) => infos.set(key, info));
    clipClipOf.forEach((clip, key) => clipOf.set(key, clip));
    accepted.push(bake);
  }
  const lanes = [];
  const keyOffsets = /* @__PURE__ */ new Map();
  let vertexCount = 0;
  for (const key of order) {
    const info = infos.get(key);
    let lane = lanes[lanes.length - 1];
    if (!lane || lane.textureId !== info.textureId || lane.blendMode !== info.blendMode || lane.vertexCapacity + info.vertexCount > MAX_LANE_VERTICES) {
      lane = { textureId: info.textureId, blendMode: info.blendMode, vertexOffset: vertexCount, vertexCapacity: 0, indices: [] };
      lanes.push(lane);
    }
    keyOffsets.set(key, vertexCount);
    for (const index of info.triangles) lane.indices.push(lane.vertexCapacity + index);
    lane.vertexCapacity += info.vertexCount;
    vertexCount += info.vertexCount;
  }
  const clipKeys = Array.from(new Set(order.map((key) => clipOf.get(key)).filter((clip) => !!clip)));
  const vertexClip = new Int16Array(vertexCount).fill(-1);
  for (const key of order) {
    const info = infos.get(key);
    const clip = clipOf.get(key);
    if (clip) vertexClip.fill(clipKeys.indexOf(clip), keyOffsets.get(key), keyOffsets.get(key) + info.vertexCount);
  }
  return {
    accepted,
    rejected,
    lanes,
    vertexCount,
    clipKeys,
    frameStride: vertexCount + clipKeys.length * MAX_CLIP_VERTICES,
    vertexClip,
    keyOffsets
  };
}
function writeFixedFrame(plan, frame, texelBase, position, light, lightComponents, dark) {
  for (let vertex = 0; vertex < plan.vertexCount; vertex += 1) {
    const target = (texelBase + vertex) * 4;
    position[target + 2] = -1;
    position[target + 3] = -1;
    if (light && lightComponents === 4) light.set([255, 255, 255, 0], target);
  }
  const view = new DataView(frame.source.vertices.buffer, frame.source.vertices.byteOffset, frame.source.vertices.byteLength);
  for (const range of frame.keys) {
    const offset = plan.keyOffsets.get(range.key);
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
      const source = polygon && vertex < count ? vertex : 0;
      position[target] = polygon ? polygon[source * 2] : 0;
      position[target + 1] = polygon ? polygon[source * 2 + 1] : 0;
      position[target + 2] = polygon ? 1 : 0;
      position[target + 3] = count;
    }
  });
}

// apps/spine-runtime-lab/extensions/spine-vat-importer/bake/src/SpineVatCompilerV2.ts
var VERTEX_STRIDE2 = 28;
var MAX_EXACT_FLOAT_INTEGER = 16777216;
function optionalNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : void 0;
}
function optionalString(value) {
  return typeof value === "string" ? value : void 0;
}
function extractSpineVatEvents(skeletonJson, animationName) {
  const timeline = skeletonJson?.animations?.[animationName]?.events;
  if (!Array.isArray(timeline)) return [];
  const definitions = skeletonJson?.events ?? {};
  return timeline.map((key) => {
    const name = String(key?.name ?? "");
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
      balance: optionalNumber(key?.balance) ?? optionalNumber(defaults?.balance)
    };
  }).sort((left, right) => left.time - right.time);
}
function runtimeBlendMode(value) {
  if (value === 1) return "additive";
  if (value === 2) return "multiply";
  if (value === 3) return "screen";
  return "normal";
}
function resolveAtlasPage(textureId, atlasTextureIds) {
  const exact = atlasTextureIds.indexOf(textureId);
  if (exact >= 0) return exact;
  const prefix = atlasTextureIds.findIndex((id) => textureId.startsWith(id) || id.startsWith(textureId));
  if (prefix >= 0) return prefix;
  if (atlasTextureIds.length === 1) return 0;
  throw new Error(`VAT texture id does not match an atlas page: ${textureId}`);
}
function channelIs(frame, offset, expected) {
  for (let vertex = 0; vertex < frame.vertexCount; vertex += 1) {
    const start = vertex * VERTEX_STRIDE2 + offset;
    for (let byte = 0; byte < 4; byte += 1) {
      if (frame.vertices[start + byte] !== expected) return false;
    }
  }
  return true;
}
function lightRgbIsWhite(frame) {
  for (let vertex = 0; vertex < frame.vertexCount; vertex += 1) {
    const start = vertex * VERTEX_STRIDE2 + 20;
    if ((frame.vertices[start] & frame.vertices[start + 1] & frame.vertices[start + 2]) !== 255) return false;
  }
  return true;
}
function splitPages(position, light, lightComponents, dark, totalTexels, maxTextureSize, maxTexturePages) {
  const pageTexels = maxTextureSize * maxTextureSize;
  const pageCount = Math.max(1, Math.ceil(totalTexels / pageTexels));
  if (pageCount > maxTexturePages) {
    throw new Error(`VAT needs ${pageCount} texture pages, runtime limit is ${maxTexturePages}`);
  }
  const pages = [];
  for (let page = 0; page < pageCount; page += 1) {
    const startTexel = page * pageTexels;
    const texelCount = Math.min(pageTexels, totalTexels - startTexel);
    const width = Math.min(maxTextureSize, Math.max(1, texelCount));
    const height = Math.max(1, Math.ceil(texelCount / width));
    const componentCapacity = width * height * 4;
    const positionPage = new Float32Array(componentCapacity);
    positionPage.set(position.subarray(startTexel * 4, (startTexel + texelCount) * 4));
    const lightPage = light ? new Uint8Array(width * height * lightComponents) : void 0;
    const darkPage = dark ? new Uint8Array(componentCapacity) : void 0;
    if (lightPage && light) {
      lightPage.set(light.subarray(startTexel * lightComponents, (startTexel + texelCount) * lightComponents));
    }
    if (darkPage && dark) darkPage.set(dark.subarray(startTexel * 4, (startTexel + texelCount) * 4));
    pages.push({ width, height, position: positionPage, light: lightPage, dark: darkPage });
  }
  return { pages, pageTexels };
}
function compileSpineVatV2(bakes, fixed, atlasTextureIds, analysis, options = {}) {
  if (bakes.length === 0) throw new Error("VAT v2 compile requires at least one animation");
  if (analysis.recipe.alphaMode === "unknown") throw new Error("VAT v2 compile requires an explicit alpha mode");
  if (analysis.source.runtimeFamily !== "4.2") throw new Error("VAT v2 compiler currently targets Spine 4.2");
  if (analysis.compatibility.level === "RUNTIME_FALLBACK") {
    throw new Error("VAT v2 compile refused a RUNTIME_FALLBACK analysis");
  }
  if (atlasTextureIds.length === 0) throw new Error("VAT v2 compile requires atlas texture ids");
  if (fixed.map((bake) => bake.animation).join("|") !== bakes.map((bake) => bake.animation).join("|")) {
    throw new Error("VAT v2 compile: fixed \u4E0E bakes \u7684\u52A8\u753B\u5FC5\u987B\u4E00\u4E00\u5BF9\u5E94");
  }
  const maxTextureSize = Math.max(1, Math.floor(options.maxTextureSize ?? 4096));
  const maxTexturePages = Math.max(1, Math.min(4, Math.floor(options.maxTexturePages ?? 4)));
  const plan = planFixedLayout(fixed);
  if (plan.rejected.size > 0) {
    const reasons = Array.from(plan.rejected).map(([name, reason]) => `${name}\uFF08${reason}\uFF09`).join("\uFF1B");
    throw new Error(`VAT \u65E0\u6CD5\u56FA\u5B9A\u69FD\u4F4D\u70D8\u7119\uFF1A${reasons}`);
  }
  const frames = [].concat(...fixed.map((bake) => bake.frames));
  const sources = frames.map((frame) => frame.source);
  const darkAllZero = sources.every((source) => channelIs(source, 24, 0));
  const lightComponents = sources.every(lightRgbIsWhite) ? 1 : 4;
  const stride = plan.frameStride;
  const staticFrame = frames.length;
  const totalTexels = (staticFrame + 1) * stride;
  if (totalTexels > MAX_EXACT_FLOAT_INTEGER) {
    throw new Error(`VAT needs ${totalTexels} texels, exceeding exact float addressing`);
  }
  const exactTextureBytes = totalTexels * (16 + lightComponents + (darkAllZero ? 0 : 4));
  if (exactTextureBytes > analysis.recipe.budget.maxTextureBytes) {
    throw new Error(
      `VAT exact texture data ${exactTextureBytes} bytes exceeds budget ${analysis.recipe.budget.maxTextureBytes}`
    );
  }
  const position = new Float32Array(totalTexels * 4);
  const light = new Uint8Array(totalTexels * lightComponents);
  const dark = darkAllZero ? void 0 : new Uint8Array(totalTexels * 4);
  frames.forEach((frame, index) => {
    writeFixedFrame(plan, frame, index * stride, position, light, lightComponents, dark);
  });
  plan.vertexClip.forEach((clip, vertex) => {
    position[(staticFrame * stride + vertex) * 4] = clip;
  });
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const frame of bakes.reduce((all, bake) => all.concat(bake.frames), [])) {
    const view = new DataView(frame.vertices.buffer, frame.vertices.byteOffset, frame.vertices.byteLength);
    for (let vertex = 0; vertex < frame.vertexCount; vertex += 1) {
      const x = view.getFloat32(vertex * VERTEX_STRIDE2, true);
      const y = view.getFloat32(vertex * VERTEX_STRIDE2 + 4, true);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  const split = splitPages(position, light, lightComponents, dark, totalTexels, maxTextureSize, maxTexturePages);
  let textureBytes = 0;
  const texturePages = [];
  split.pages.forEach((page, index) => {
    textureBytes += page.position.byteLength + (page.light?.byteLength ?? 0) + (page.dark?.byteLength ?? 0);
    texturePages.push({
      semantic: "position",
      path: `position-${index}.bin`,
      size: [page.width, page.height],
      format: "rgba32f"
    });
    if (page.light) texturePages.push({
      semantic: "light",
      path: `light-${index}.bin`,
      size: [page.width, page.height],
      format: lightComponents === 1 ? "a8" : "rgba8"
    });
    if (page.dark) texturePages.push({
      semantic: "dark",
      path: `dark-${index}.bin`,
      size: [page.width, page.height],
      format: "rgba8"
    });
  });
  let frameOffset = 0;
  const clips = bakes.map((bake, index) => {
    const events = extractSpineVatEvents(options.skeletonJson, bake.animation);
    const clip = {
      name: bake.animation,
      variant: "default",
      fps: bake.frameRate,
      duration: bake.duration,
      frameOffset,
      frameCount: fixed[index].frames.length,
      layout: "fixed",
      ...events.length > 0 ? { events } : {},
      ...bake.sockets.length > 0 ? { sockets: bake.sockets } : {}
    };
    frameOffset += clip.frameCount;
    return clip;
  });
  const lanes = plan.lanes.map((lane, index) => ({
    atlasPage: resolveAtlasPage(lane.textureId, atlasTextureIds),
    textureId: lane.textureId,
    blendMode: runtimeBlendMode(lane.blendMode),
    vertexOffset: lane.vertexOffset,
    vertexCapacity: lane.vertexCapacity,
    logicalLane: index,
    geometryMode: "indexed-stable",
    indices: lane.indices
  }));
  const hybrid = clips.some((clip) => (clip.events?.length ?? 0) > 0 || (clip.sockets?.length ?? 0) > 0);
  const manifest = {
    format: "spine-vat-2",
    source: analysis.source,
    alphaMode: analysis.recipe.alphaMode,
    textureProfile: "exact",
    channels: { light: true, dark: Boolean(dark) },
    pageTexels: split.pageTexels,
    texturePages,
    atlasPages: analysis.static.atlasPages.map((page, index) => ({
      id: atlasTextureIds[index] ?? page.name,
      path: page.name
    })),
    layouts: [{
      id: "fixed",
      frameStride: stride,
      bounds: [minX, minY, maxX, maxY],
      clipCount: plan.clipKeys.length,
      staticFrame,
      lanes
    }],
    variants: [{ name: "default", skins: ["default"], layout: "fixed" }],
    clips,
    compatibility: {
      level: hybrid ? "HYBRID" : analysis.compatibility.level,
      warnings: [
        ...analysis.compatibility.warnings,
        ...options.socketNames?.length ? [`\u5DF2\u70D8\u7119 socket \u9AA8\u9ABC\uFF1A${options.socketNames.join(", ")}`] : []
      ],
      estimatedGpuBytes: textureBytes + lanes.reduce((sum, lane) => sum + lane.vertexCapacity * 14, 0),
      drawCallsPerBatch: lanes.length
    }
  };
  return { manifest, pages: split.pages, textureBytes };
}
async function bakeAndCompileSpineVatV2(parent, skeletonData, analysis, options = {}) {
  if (analysis.recipe.alphaMode === "unknown") throw new Error("VAT v2 bake requires an explicit alpha mode");
  const premultipliedAlpha = analysis.recipe.alphaMode === "premultiplied";
  const bakes = [];
  const fixed = [];
  const unclippedData = createUnclippedSkeletonData(skeletonData);
  for (const clip of analysis.clips) {
    if (clip.compatibility === "RUNTIME_FALLBACK") continue;
    const node = new import_cc4.Node(`VAT-v2-Bake-${clip.name}`);
    node.parent = parent;
    node.setPosition(1e5, 1e5, 0);
    try {
      const skeleton = node.addComponent(import_cc4.sp.Skeleton);
      skeleton.defaultCacheMode = import_cc4.sp.SpineAnimationCacheMode.REALTIME;
      skeleton.enableBatch = false;
      skeleton.skeletonData = skeletonData;
      bakes.push(bakeSpineAnimation(
        skeleton,
        clip.name,
        clip.fps,
        premultipliedAlpha,
        options.socketNames
      ));
      const unclippedNode = new import_cc4.Node(`VAT-fixed-Bake-${clip.name}`);
      unclippedNode.parent = node;
      const unclipped = unclippedNode.addComponent(import_cc4.sp.Skeleton);
      unclipped.defaultCacheMode = import_cc4.sp.SpineAnimationCacheMode.REALTIME;
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
    skeletonJson: skeletonData.skeletonJson
  });
}

// apps/spine-runtime-lab/extensions/spine-vat-importer/bake/src/index.ts
async function bakeSpineVat(data, alphaMode) {
  assertRuntimeCanParse(data);
  const scene = import_cc5.director.getScene();
  if (!scene) throw new Error("\u70D8\u7119\u9700\u8981\u4E00\u4E2A\u6253\u5F00\u7684\u573A\u666F\uFF0C\u5148\u6253\u5F00\u4EFB\u610F\u573A\u666F");
  const parent = new import_cc5.Node("Spine VAT Bake");
  parent.hideFlags |= import_cc5.CCObject.Flags.DontSave | import_cc5.CCObject.Flags.HideInHierarchy;
  parent.parent = scene;
  try {
    const report = await analyzeSpineVatSkeletonData(parent, data, { alphaMode, frameRate: 30, textureProfile: "balanced" });
    const compiled = await bakeAndCompileSpineVatV2(parent, data, report);
    const files = [["manifest.spinevat", JSON.stringify(compiled.manifest, null, 2)]];
    compiled.pages.forEach((page, index) => {
      files.push([`position-${index}.bin`, bytes(page.position)]);
      if (page.light) files.push([`light-${index}.bin`, bytes(page.light)]);
      if (page.dark) files.push([`dark-${index}.bin`, bytes(page.dark)]);
    });
    return {
      files,
      atlasPages: compiled.manifest.atlasPages.map((page) => page.path),
      summary: `clips=${compiled.manifest.clips.length} textureBytes=${compiled.textureBytes} warnings=${report.compatibility.warnings.length}`
    };
  } finally {
    parent.destroy();
  }
}
function assertRuntimeCanParse(data) {
  const animations = data.getRuntimeData(true)?.animations;
  const count = animations?.length ?? 0;
  let ok = count > 0;
  for (let i = 0; ok && i < count; i += 1) ok = Boolean(animations[i]);
  if (ok) return;
  const version = data.skeletonJson?.skeleton?.spine ?? "\u672A\u77E5\u7248\u672C";
  throw new Error(`\u5F15\u64CE\u7684 Spine \u8FD0\u884C\u65F6\u89E3\u6790\u4E0D\u4E86\u8FD9\u4EFD Spine ${version} \u6570\u636E\uFF1A\u9879\u76EE\u8BBE\u7F6E \u2192 \u529F\u80FD\u88C1\u526A \u2192 Spine \u9009 4.2\uFF0C\u91CD\u542F\u7F16\u8F91\u5668\u540E\u518D\u70D8\u7119`);
}
function bytes(view) {
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  bakeSpineVat
});

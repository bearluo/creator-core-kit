import {
  CCObject,
  director,
  gfx,
  ImageAsset,
  Material,
  Mesh,
  MeshRenderer,
  Texture2D,
  Vec3,
  Vec4,
} from 'cc';
import type {
  SpineVatColor,
  SpineVatPlayOptions,
  SpineVatRuntimeEvent,
  SpineVatSnapshot,
} from './SpineVatPlayback';
import { SpineVatPlayback } from './SpineVatPlayback';
import type { SpineVatBlendMode, SpineVatManifest, SpineVatSocketMatrix } from './SpineVatSchema';
import { SpineVatSkeletonData } from './SpineVatSkeletonData';

const MAX_TEXTURE_PAGES = 4;

export interface CompiledPage {
  width: number;
  height: number;
  position: Float32Array;
  /** RGBA8（4 B/texel），或 lightAlpha 时只有 alpha（1 B/texel）。 */
  light?: Uint8Array;
  lightAlpha: boolean;
  dark?: Uint8Array;
}

/**
 * light 的 RGB 恒为 255（只有插槽透明度在变）时可只存 alpha，无损。
 * 全 0 的 texel 是某帧没用到的顶点槽（退化三角形，不可见），不影响判定。
 */
function lightIsAlphaOnly(light: Uint8Array): boolean {
  for (let i = 0; i < light.length; i += 4) {
    const r = light[i];
    const g = light[i + 1];
    const b = light[i + 2];
    if ((r & g & b) !== 255 && (r | g | b | light[i + 3]) !== 0) return false;
  }
  return true;
}

function alphaChannel(light: Uint8Array): Uint8Array {
  const alpha = new Uint8Array(light.length / 4);
  for (let i = 0; i < alpha.length; i += 1) alpha[i] = light[i * 4 + 3];
  return alpha;
}

/** 按实际数据选 shader 宏（见 spine-vat-v2.effect / spine-vat-ui.effect 顶部说明）。 */
export function vatChannelDefines(pages: readonly CompiledPage[]): Record<string, boolean> {
  return {
    VAT_NO_LIGHT: !pages[0].light,
    VAT_LIGHT_ALPHA: pages[0].lightAlpha,
    VAT_NO_DARK: !pages[0].dark,
  };
}

/**
 * 单通道 alpha 纹理的格式：GLES3 / WebGL2 走不可变存储（glTexStorage2D），只收带位宽的 R8；
 * WebGL1 没有 R8，用 L8（LUMINANCE）。两者在 shader 里都读 .r。
 */
export function alphaTextureFormat(): gfx.Format {
  return director.root?.device.gfxAPI === gfx.API.WEBGL ? gfx.Format.L8 : gfx.Format.R8;
}

export function createLightTexture(page: CompiledPage): Texture2D {
  return createTexture(page.light!, page.width, page.height, page.lightAlpha ? alphaTextureFormat() : gfx.Format.RGBA8);
}

interface SharedRenderResources {
  key: string;
  references: number;
  manifest: SpineVatManifest;
  mesh: Mesh;
  materials: Material[];
  ownedTextures: Texture2D[];
}

interface ResourceSlot {
  promise: Promise<SharedRenderResources>;
}

const resourceCache = new Map<string, ResourceSlot>();

function now(): number {
  return director.root?.cumulativeTime ?? 0;
}

function assertAssets<T>(label: string, assets: readonly (T | null | undefined)[], expected: number): T[] {
  if (assets.length !== expected) {
    throw new Error(`VAT needs ${expected} ${label}, received ${assets.length}`);
  }
  const missing = assets.findIndex((asset) => !asset);
  if (missing >= 0) throw new Error(`VAT ${label} ${missing} is empty`);
  return assets as T[];
}

export function compilePages(data: SpineVatSkeletonData): CompiledPage[] {
  const manifest = data.manifest;
  const positionEntries = manifest.texturePages.filter((entry) => entry.semantic === 'position');
  if (positionEntries.length < 1 || positionEntries.length > MAX_TEXTURE_PAGES) {
    throw new Error(`VAT manifest has ${positionEntries.length} position pages`);
  }
  const positions = assertAssets('position pages', data.positionPages, positionEntries.length);
  const lights = assertAssets('light pages', data.lightPages, manifest.channels.light ? positionEntries.length : 0);
  const darks = assertAssets('dark pages', data.darkPages, manifest.channels.dark ? positionEntries.length : 0);

  const compiled = positionEntries.map((entry, pageIndex): CompiledPage => {
    const texels = entry.size[0] * entry.size[1];
    const position = positions[pageIndex].buffer();
    const light = lights[pageIndex]?.buffer();
    const dark = darks[pageIndex]?.buffer();
    if (position.byteLength !== texels * 16) {
      throw new Error(`VAT position page ${pageIndex} byte length does not match manifest`);
    }
    // light 页：rgba8（4 B/texel）或编译期已压成 alpha 的 a8（1 B/texel）。
    if (light && light.byteLength !== texels * 4 && light.byteLength !== texels) {
      throw new Error(`VAT light page ${pageIndex} byte length does not match manifest`);
    }
    if (dark && dark.byteLength !== texels * 4) {
      throw new Error(`VAT dark page ${pageIndex} byte length does not match manifest`);
    }
    return {
      width: entry.size[0],
      height: entry.size[1],
      position: new Float32Array(position),
      light: light ? new Uint8Array(light) : undefined,
      lightAlpha: !!light && light.byteLength === texels,
      dark: dark ? new Uint8Array(dark) : undefined,
    };
  });
  // 旧数据（rgba8 但 RGB 恒白）加载时就地压成 alpha：显存 1/4、少解码 3 个通道。
  if (compiled.every((page) => page.light && !page.lightAlpha && lightIsAlphaOnly(page.light))) {
    for (const page of compiled) {
      page.light = alphaChannel(page.light!);
      page.lightAlpha = true;
    }
  }
  if (new Set(compiled.map((page) => page.lightAlpha)).size > 1) throw new Error('VAT light pages mix rgba8 and a8');
  return compiled;
}

export function createTexture(
  data: Float32Array | Uint8Array,
  width: number,
  height: number,
  format: gfx.Format,
): Texture2D {
  const image = new ImageAsset({ width, height, _data: data, _compressed: false, format: format as never });
  const texture = new Texture2D();
  texture.hideFlags = CCObject.Flags.DontSave;
  texture.setFilters(Texture2D.Filter.NEAREST, Texture2D.Filter.NEAREST);
  texture.setMipFilter(Texture2D.Filter.NONE);
  texture.setWrapMode(
    Texture2D.WrapMode.CLAMP_TO_EDGE,
    Texture2D.WrapMode.CLAMP_TO_EDGE,
    Texture2D.WrapMode.CLAMP_TO_EDGE,
  );
  texture.image = image;
  return texture;
}

function createCombinedMesh(layout: SpineVatManifest['layouts'][number]): Mesh {
  const vertexCount = layout.lanes.reduce((sum, lane) => sum + lane.vertexCapacity, 0);
  if (vertexCount < 1) throw new Error('VAT layout contains no vertices');
  const vertexStride = 12;
  const indexStride = vertexCount > 0xffff ? 4 : 2;
  const vertexBytes = vertexCount * vertexStride;
  const buffer = new ArrayBuffer(vertexBytes + vertexCount * indexStride);
  const view = new DataView(buffer);
  const primitives: Mesh.ISubMesh[] = [];
  let globalVertex = 0;
  let indexOffset = vertexBytes;

  for (const lane of layout.lanes) {
    for (let laneVertex = 0; laneVertex < lane.vertexCapacity; laneVertex += 1) {
      const vertexOffset = globalVertex * vertexStride;
      view.setFloat32(vertexOffset, lane.vertexOffset + laneVertex, true);
      view.setFloat32(vertexOffset + 4, 0, true);
      view.setFloat32(vertexOffset + 8, 0, true);
      const target = indexOffset + laneVertex * indexStride;
      if (indexStride === 4) view.setUint32(target, globalVertex, true);
      else view.setUint16(target, globalVertex, true);
      globalVertex += 1;
    }
    primitives.push({
      primitiveMode: gfx.PrimitiveMode.TRIANGLE_LIST,
      vertexBundelIndices: [0],
      indexView: {
        offset: indexOffset,
        length: lane.vertexCapacity * indexStride,
        count: lane.vertexCapacity,
        stride: indexStride,
      },
    });
    indexOffset += lane.vertexCapacity * indexStride;
  }

  const mesh = new Mesh();
  mesh.hideFlags = CCObject.Flags.DontSave;
  mesh.reset({
    struct: {
      vertexBundles: [{
        attributes: [new gfx.Attribute(gfx.AttributeName.ATTR_POSITION, gfx.Format.RGB32F)],
        view: { offset: 0, length: vertexBytes, count: vertexCount, stride: vertexStride },
      }],
      primitives,
      minPosition: new Vec3(layout.bounds[0], layout.bounds[1], -1),
      maxPosition: new Vec3(layout.bounds[2], layout.bounds[3], 1),
    },
    data: new Uint8Array(buffer),
  });
  return mesh;
}

function techniqueIndex(alphaMode: SpineVatManifest['alphaMode'], blendMode: SpineVatBlendMode): number {
  const blendOffset = blendMode === 'additive' ? 1 : blendMode === 'multiply' ? 2 : blendMode === 'screen' ? 3 : 0;
  return (alphaMode === 'premultiplied' ? 4 : 0) + blendOffset;
}

function cacheKey(data: SpineVatSkeletonData): string {
  const dependencies = [
    ...data.positionPages,
    ...data.lightPages,
    ...data.darkPages,
    ...data.atlasPages,
    data.effectAsset,
  ].filter(Boolean).map((asset) => `${asset!.uuid}:${asset!.nativeUrl}`).join('|');
  return `${data.uuid}|${JSON.stringify(data.manifest)}|${dependencies}`;
}

async function createResources(data: SpineVatSkeletonData, key: string): Promise<SharedRenderResources> {
  if (!data.effectAsset) {
    throw new Error('Spine VAT SkeletonData lacks its Effect dependency; reimport manifest.spinevat');
  }
  const manifest = data.manifest;
  const layout = manifest.layouts[0];
  if (!layout) throw new Error('VAT manifest has no render layout');
  const incompatibleClip = manifest.clips.find((clip) => clip.layout !== layout.id);
  if (incompatibleClip) {
    throw new Error(
      `VAT clip ${incompatibleClip.name} uses layout ${incompatibleClip.layout}; `
      + `spinevat.Skeleton currently requires one shared layout (${layout.id})`,
    );
  }
  const atlasPages = assertAssets('atlas pages', data.atlasPages, manifest.atlasPages.length);
  const pages = compilePages(data);
  const positionTextures = pages.map((page) => createTexture(
    page.position,
    page.width,
    page.height,
    gfx.Format.RGBA32F,
  ));
  const lightTextures = manifest.channels.light ? pages.map(createLightTexture) : [];
  const darkTextures = manifest.channels.dark
    ? pages.map((page) => createTexture(page.dark!, page.width, page.height, gfx.Format.RGBA8))
    : [];
  const black = createTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, gfx.Format.RGBA8);
  const white = createTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, gfx.Format.RGBA8);
  const pageSizes = pages.map((page) => new Vec4(page.width, page.height, 0, 0));
  while (pageSizes.length < MAX_TEXTURE_PAGES) pageSizes.push(new Vec4(1, 1, 0, 0));

  const materials = layout.lanes.map((lane) => {
    const atlas = atlasPages[lane.atlasPage];
    if (!atlas) throw new Error(`VAT lane references missing atlas page ${lane.atlasPage}`);
    const material = new Material();
    material.hideFlags = CCObject.Flags.DontSave;
    material.initialize({
      effectAsset: data.effectAsset!,
      technique: techniqueIndex(manifest.alphaMode, lane.blendMode),
      defines: { USE_INSTANCING: true, ...vatChannelDefines(pages) },
    });
    material.setProperty('mainTexture', atlas);
    for (let page = 0; page < MAX_TEXTURE_PAGES; page += 1) {
      material.setProperty(`positionTexture${page}`, positionTextures[page] ?? black);
      if (lightTextures.length > 0) material.setProperty(`lightTexture${page}`, lightTextures[page] ?? white);
      if (darkTextures.length > 0) material.setProperty(`darkTexture${page}`, darkTextures[page] ?? black);
      material.setProperty(`vatPageSize${page}`, pageSizes[page]);
    }
    material.setProperty('vatLayout', new Vec4(layout.frameStride, manifest.pageTexels, pages.length, 0));
    return material;
  });

  return {
    key,
    references: 0,
    manifest,
    mesh: createCombinedMesh(layout),
    materials,
    ownedTextures: [...positionTextures, ...lightTextures, ...darkTextures, black, white],
  };
}

async function acquireResources(data: SpineVatSkeletonData): Promise<SharedRenderResources> {
  const key = cacheKey(data);
  let slot = resourceCache.get(key);
  if (!slot) {
    slot = { promise: createResources(data, key) };
    resourceCache.set(key, slot);
  }
  try {
    const resources = await slot.promise;
    resources.references += 1;
    return resources;
  } catch (error) {
    if (resourceCache.get(key) === slot) resourceCache.delete(key);
    throw error;
  }
}

function releaseResources(resources: SharedRenderResources): void {
  resources.references -= 1;
  if (resources.references > 0) return;
  resourceCache.delete(resources.key);
  resources.mesh.destroy();
  for (const material of resources.materials) material.destroy();
  for (const texture of resources.ownedTextures) texture.destroy();
}

export class SpineVatRenderHandle {
  private readonly playback: SpineVatPlayback;
  private readonly listeners = new Set<(event: SpineVatRuntimeEvent) => void>();
  private destroyed = false;

  private constructor(
    private readonly renderer: MeshRenderer,
    private readonly resources: SharedRenderResources,
    initialClip?: string,
  ) {
    this.playback = new SpineVatPlayback(resources.manifest.clips, resources.manifest.alphaMode, now(), initialClip);
    renderer.mesh = resources.mesh;
    renderer.sharedMaterials = resources.materials;
    this.upload();
  }

  static async create(
    renderer: MeshRenderer,
    data: SpineVatSkeletonData,
    initialClip?: string,
  ): Promise<SpineVatRenderHandle> {
    const resources = await acquireResources(data);
    try {
      return new SpineVatRenderHandle(renderer, resources, initialClip);
    } catch (error) {
      releaseResources(resources);
      throw error;
    }
  }

  get currentClip(): SpineVatManifest['clips'][number] {
    return this.playback.currentClip;
  }

  play(animation: string, options: SpineVatPlayOptions = {}): void {
    this.playback.play(animation, options, now());
    this.upload();
  }

  pause(): void {
    this.playback.pause(now());
    this.upload();
  }

  resume(): void {
    this.playback.resume(now());
    this.upload();
  }

  seek(seconds: number): void {
    this.playback.seek(seconds, now());
    this.upload();
  }

  setSpeed(speed: number): void {
    this.playback.setSpeed(speed, now());
    this.upload();
  }

  setLoop(loop: boolean): void {
    this.playback.setLoop(loop);
    this.upload();
  }

  setColor(color: SpineVatColor): void {
    this.playback.setColor(color);
    this.upload();
  }

  setManualFrame(frame: number | null): void {
    this.playback.setManualFrame(frame, now());
    this.upload();
  }

  snapshot(): SpineVatSnapshot {
    return this.playback.snapshot(now());
  }

  socket(name: string): SpineVatSocketMatrix | null {
    return this.playback.socket(name, now());
  }

  onEvent(listener: (event: SpineVatRuntimeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  update(): void {
    for (const event of this.playback.drainEvents(now())) {
      for (const listener of this.listeners) listener(event);
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.renderer.mesh = null;
    this.renderer.sharedMaterials = [];
    this.listeners.clear();
    releaseResources(this.resources);
  }

  private upload(): void {
    const attributes = this.playback.gpuAttributes(now());
    this.renderer.setInstancedAttribute('a_vatAnim0', attributes.anim0);
    this.renderer.setInstancedAttribute('a_vatAnim1', attributes.anim1);
    this.renderer.setInstancedAttribute('a_vatColor', attributes.color);
  }
}

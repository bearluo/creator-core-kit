import {
  BufferAsset,
  director,
  EffectAsset,
  gfx,
  ImageAsset,
  Layers,
  Material,
  Mesh,
  MeshRenderer,
  Node,
  resources,
  Texture2D,
  UIMeshRenderer,
  Vec3,
  Vec4,
  utils,
} from 'cc';
import { SpineVatAsset } from './SpineVatAsset';
import {
  SpineVatPlaybackState,
  type SpineVatInstanceColor,
  type SpineVatInstanceSnapshot,
  type SpineVatPlayOptions,
  type SpineVatRuntimeEvent,
} from './SpineVatPlayerCore';
import type { SpineVatBlendMode, SpineVatManifestV2, SpineVatSocketMatrix } from './SpineVatTypes';

export interface VatPopulationLayout {
  columns?: number;
  spacingX?: number;
  spacingY?: number;
  scale?: number;
  offsetY?: number;
}

export interface SpineVatCompiledPageV2 {
  width: number;
  height: number;
  position: Float32Array;
  light?: Uint8Array;
  dark?: Uint8Array;
}

export interface SpineVatCompiledDataV2 {
  manifest: SpineVatManifestV2;
  pages: SpineVatCompiledPageV2[];
  textureBytes: number;
}

const MAX_TEXTURE_PAGES = 4;

type VatTexturePageEntry = SpineVatManifestV2['texturePages'][number];

interface VatTexturePageEntries {
  position: VatTexturePageEntry[];
  light: VatTexturePageEntry[];
  dark: VatTexturePageEntry[];
}

function texturePageEntries(manifest: SpineVatManifestV2): VatTexturePageEntries {
  if (!manifest || manifest.format !== 'spine-vat-2') {
    throw new Error(`Unsupported VAT v2 format: ${String((manifest as any)?.format)}`);
  }

  const entries: VatTexturePageEntries = {
    position: manifest.texturePages.filter((entry) => entry.semantic === 'position'),
    light: manifest.texturePages.filter((entry) => entry.semantic === 'light'),
    dark: manifest.texturePages.filter((entry) => entry.semantic === 'dark'),
  };
  if (entries.position.length < 1 || entries.position.length > MAX_TEXTURE_PAGES) {
    throw new Error(`VAT v2 manifest has ${entries.position.length} position pages`);
  }

  const expectedLightPages = manifest.channels.light ? entries.position.length : 0;
  const expectedDarkPages = manifest.channels.dark ? entries.position.length : 0;
  if (entries.light.length !== expectedLightPages) {
    throw new Error(
      `VAT v2 manifest declares light=${manifest.channels.light}, but contains ${entries.light.length} light pages`,
    );
  }
  if (entries.dark.length !== expectedDarkPages) {
    throw new Error(
      `VAT v2 manifest declares dark=${manifest.channels.dark}, but contains ${entries.dark.length} dark pages`,
    );
  }

  for (let pageIndex = 0; pageIndex < entries.position.length; pageIndex += 1) {
    const positionSize = entries.position[pageIndex].size;
    for (const [semantic, pages] of [['light', entries.light], ['dark', entries.dark]] as const) {
      const page = pages[pageIndex];
      if (page && (page.size[0] !== positionSize[0] || page.size[1] !== positionSize[1])) {
        throw new Error(`VAT ${semantic} page ${pageIndex} size does not match its position page`);
      }
    }
  }
  return entries;
}

function assertAssetArray<T>(label: string, assets: readonly (T | null | undefined)[], expected: number): T[] {
  if (assets.length !== expected) {
    throw new Error(`VAT v2 needs ${expected} ${label}, received ${assets.length}`);
  }
  const missingIndex = assets.findIndex((asset) => !asset);
  if (missingIndex >= 0) throw new Error(`VAT v2 ${label} ${missingIndex} is empty`);
  return assets as T[];
}

function loadResource<T>(path: string, type: new (...args: any[]) => T): Promise<T> {
  return new Promise((resolve, reject) => {
    resources.load(path, type as any, (error, asset) => {
      if (error || !asset) reject(error ?? new Error(`VAT v2 resource not found: ${path}`));
      else resolve(asset as T);
    });
  });
}

function loadEffect(): Promise<EffectAsset> {
  return new Promise((resolve, reject) => {
    resources.load('spine-vat-v2', EffectAsset, (error, asset) => {
      if (error || !asset) reject(error ?? new Error('VAT v2 effect not found'));
      else resolve(asset);
    });
  });
}

function createTexture(
  data: Float32Array | Uint8Array,
  width: number,
  height: number,
  format: gfx.Format,
): Texture2D {
  const image = new ImageAsset({ width, height, _data: data, _compressed: false, format: format as any });
  const texture = new Texture2D();
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

function createLaneMesh(
  vertexOffset: number,
  vertexCapacity: number,
  bounds: [number, number, number, number],
): Mesh {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let vertex = 0; vertex < vertexCapacity; vertex += 1) {
    positions.push(vertexOffset + vertex, 0, 0);
    indices.push(vertex);
  }
  return utils.createMesh({
    positions,
    indices,
    minPos: { x: bounds[0], y: bounds[1], z: -1 },
    maxPos: { x: bounds[2], y: bounds[3], z: 1 },
  });
}

function techniqueIndex(alphaMode: SpineVatManifestV2['alphaMode'], blendMode: SpineVatBlendMode): number {
  const blendOffset = blendMode === 'additive' ? 1 : blendMode === 'multiply' ? 2 : blendMode === 'screen' ? 3 : 0;
  return (alphaMode === 'premultiplied' ? 4 : 0) + blendOffset;
}

function engineTime(): number {
  return director.root?.cumulativeTime ?? 0;
}

export class SpineVatInstanceV2 {
  private readonly playback: SpineVatPlaybackState;
  private readonly eventListeners = new Set<(event: SpineVatRuntimeEvent) => void>();

  constructor(
    readonly node: Node,
    private readonly renderers: readonly MeshRenderer[],
    private readonly layoutId: string,
    private readonly playerManifest: SpineVatManifestV2,
    initialClip: string,
  ) {
    this.playback = new SpineVatPlaybackState(
      playerManifest.clips,
      playerManifest.alphaMode,
      engineTime(),
      initialClip,
    );
    this.assertCompatibleLayout();
    this.upload();
  }

  get currentClip(): SpineVatManifestV2['clips'][number] {
    return this.playback.currentClip;
  }

  play(animation: string, options: SpineVatPlayOptions = {}): void {
    const clip = this.playerManifest.clips.find((candidate) => candidate.name === animation);
    if (!clip) throw new Error(`VAT clip not found: ${animation}`);
    if (clip.layout !== this.layoutId) {
      throw new Error(`VAT clip ${animation} uses layout ${clip.layout}; renderer uses ${this.layoutId}`);
    }
    this.playback.play(animation, options, engineTime());
    this.upload();
  }

  pause(): void {
    const now = engineTime();
    this.dispatchEvents(now);
    this.playback.pause(now);
    this.upload();
  }

  resume(): void {
    this.playback.resume(engineTime());
    this.upload();
  }

  seek(seconds: number): void {
    this.playback.seek(seconds, engineTime());
    this.upload();
  }

  setSpeed(speed: number): void {
    const now = engineTime();
    this.dispatchEvents(now);
    this.playback.setSpeed(speed, now);
    this.upload();
  }

  setLoop(loop: boolean): void {
    this.playback.setLoop(loop);
    this.upload();
  }

  setColor(color: SpineVatInstanceColor): void {
    this.playback.setColor(color);
    this.upload();
  }

  setManualFrame(frame: number | null): void {
    this.playback.setManualFrame(frame, engineTime());
    this.upload();
  }

  snapshot(): SpineVatInstanceSnapshot {
    return this.playback.snapshot(engineTime());
  }

  onEvent(listener: (event: SpineVatRuntimeEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  socket(name: string): SpineVatSocketMatrix | null {
    return this.playback.socket(name, engineTime());
  }

  updateHybrid(): void {
    this.dispatchEvents(engineTime());
  }

  private assertCompatibleLayout(): void {
    if (this.currentClip.layout !== this.layoutId) {
      throw new Error(
        `VAT clip ${this.currentClip.name} uses layout ${this.currentClip.layout}; renderer uses ${this.layoutId}`,
      );
    }
  }

  private upload(): void {
    const attributes = this.playback.gpuAttributes();
    for (const renderer of this.renderers) {
      renderer.setInstancedAttribute('a_vatAnim0', attributes.anim0);
      renderer.setInstancedAttribute('a_vatAnim1', attributes.anim1);
      renderer.setInstancedAttribute('a_vatColor', attributes.color);
    }
  }

  private dispatchEvents(now: number): void {
    const events = this.playback.drainEvents(now);
    if (events.length === 0 || this.eventListeners.size === 0) return;
    for (const event of events) {
      for (const listener of this.eventListeners) listener(event);
    }
  }
}

export class SpineVatPopulationV2 {
  readonly root: Node;
  readonly manifest: SpineVatManifestV2;
  readonly textureBytes: number;
  readonly drawGroups: number;
  readonly instances: readonly SpineVatInstanceV2[];

  private readonly materials: Material[];
  private readonly meshes: Mesh[];
  private readonly textures: Texture2D[];
  private readonly pageSizes: Vec4[];
  private readonly pageCount: number;
  private readonly layout: SpineVatManifestV2['layouts'][number];

  private constructor(
    root: Node,
    compiled: SpineVatCompiledDataV2,
    materials: Material[],
    meshes: Mesh[],
    textures: Texture2D[],
    pageSizes: Vec4[],
    instances: SpineVatInstanceV2[],
  ) {
    this.root = root;
    this.manifest = compiled.manifest;
    this.textureBytes = compiled.textureBytes;
    this.drawGroups = meshes.length;
    this.materials = materials;
    this.meshes = meshes;
    this.textures = textures;
    this.pageSizes = pageSizes;
    this.pageCount = compiled.pages.length;
    this.layout = compiled.manifest.layouts[0];
    this.instances = instances;
  }

  static async create(
    parent: Node,
    compiled: SpineVatCompiledDataV2,
    atlasPages: Texture2D[],
    instanceCount: number,
    populationLayout: VatPopulationLayout = {},
    initialClip?: string,
    effectAsset?: EffectAsset,
  ): Promise<SpineVatPopulationV2> {
    const effect = effectAsset ?? await loadEffect();
    const { manifest, pages } = compiled;
    const layout = manifest.layouts[0];
    if (!layout) throw new Error('VAT v2 manifest has no layout');
    if (pages.length < 1 || pages.length > MAX_TEXTURE_PAGES) {
      throw new Error(`VAT v2 renderer supports 1-${MAX_TEXTURE_PAGES} data pages`);
    }
    if (atlasPages.length < manifest.atlasPages.length) {
      throw new Error(`VAT v2 needs ${manifest.atlasPages.length} atlas pages, received ${atlasPages.length}`);
    }

    const positionPages = pages.map((page) => createTexture(
      page.position,
      page.width,
      page.height,
      gfx.Format.RGBA32F,
    ));
    // 编译器在 light 的 RGB 恒白时输出 a8（只有 alpha），按字节数识别。
    const lightAlpha = manifest.channels.light && pages[0].light!.length === pages[0].width * pages[0].height;
    const lightPages = manifest.channels.light
      ? pages.map((page) => createTexture(
        page.light!,
        page.width,
        page.height,
        // 同 SpineVatRenderResources.alphaTextureFormat：GLES3/WebGL2 只收 R8，WebGL1 用 L8。
        lightAlpha ? (director.root?.device.gfxAPI === gfx.API.WEBGL ? gfx.Format.L8 : gfx.Format.R8) : gfx.Format.RGBA8,
      ))
      : [];
    const darkPages = manifest.channels.dark
      ? pages.map((page) => createTexture(page.dark!, page.width, page.height, gfx.Format.RGBA8))
      : [];
    const black = createTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, gfx.Format.RGBA8);
    const white = createTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, gfx.Format.RGBA8);
    const pageSizes = pages.map((page) => new Vec4(page.width, page.height, 0, 0));
    while (pageSizes.length < MAX_TEXTURE_PAGES) pageSizes.push(new Vec4(1, 1, 0, 0));

    const meshes: Mesh[] = [];
    const materials: Material[] = [];
    for (const lane of layout.lanes) {
      const atlas = atlasPages[lane.atlasPage];
      if (!atlas) throw new Error(`VAT v2 lane references missing atlas page ${lane.atlasPage}`);
      meshes.push(createLaneMesh(lane.vertexOffset, lane.vertexCapacity, layout.bounds));
      const material = new Material();
      material.initialize({
        effectAsset: effect,
        technique: techniqueIndex(manifest.alphaMode, lane.blendMode),
        defines: {
          USE_INSTANCING: true,
          VAT_NO_LIGHT: !manifest.channels.light,
          VAT_LIGHT_ALPHA: lightAlpha,
          VAT_NO_DARK: !manifest.channels.dark,
        },
      });
      material.setProperty('mainTexture', atlas);
      for (let page = 0; page < MAX_TEXTURE_PAGES; page += 1) {
        material.setProperty(`positionTexture${page}`, positionPages[page] ?? black);
        if (lightPages.length > 0) material.setProperty(`lightTexture${page}`, lightPages[page] ?? white);
        if (darkPages.length > 0) material.setProperty(`darkTexture${page}`, darkPages[page] ?? black);
        material.setProperty(`vatPageSize${page}`, pageSizes[page]);
      }
      material.setProperty('vatLayout', new Vec4(
        layout.frameStride,
        manifest.pageTexels,
        pages.length,
        0,
      ));
      materials.push(material);
    }

    // Keep VAT in the same 2D UI submission path as Sprite/Spine. The
    // UIMeshRenderer wrapper detaches the model from the 3D scene queue and
    // commits it through the Canvas UI batcher, where sibling order can work.
    const renderLayer = Layers.Enum.UI_2D;
    const root = new Node('SpineVAT-v2');
    root.layer = renderLayer;
    root.parent = parent;
    const columns = populationLayout.columns ?? Math.max(1, Math.ceil(Math.sqrt(instanceCount)));
    const rows = Math.ceil(instanceCount / columns);
    const scale = populationLayout.scale ?? (instanceCount <= 5 ? 0.7 : 0.42);
    const spacingX = populationLayout.spacingX ?? 140;
    const spacingY = populationLayout.spacingY ?? 160;
    const offsetY = populationLayout.offsetY ?? -40;
    const instanceNodes: Node[] = [];
    const instanceRenderers: MeshRenderer[][] = [];
    for (let instanceIndex = 0; instanceIndex < instanceCount; instanceIndex += 1) {
      const instance = new Node(`VAT-v2-${instanceIndex}`);
      instance.layer = renderLayer;
      instance.parent = root;
      instance.setPosition(new Vec3(
        (instanceIndex % columns - (columns - 1) / 2) * spacingX,
        (Math.floor(instanceIndex / columns) - (rows - 1) / 2) * spacingY + offsetY,
        0,
      ));
      instance.setScale(scale, scale, scale);
      const renderers: MeshRenderer[] = [];
      for (let laneIndex = 0; laneIndex < meshes.length; laneIndex += 1) {
        const laneNode = new Node(`lane-${laneIndex}`);
        laneNode.layer = renderLayer;
        laneNode.parent = instance;
        laneNode.setPosition(0, 0, laneIndex * 0.01);
        const renderer = laneNode.addComponent(MeshRenderer);
        renderer.mesh = meshes[laneIndex];
        renderer.setSharedMaterial(materials[laneIndex], 0);
        laneNode.addComponent(UIMeshRenderer);
        renderers.push(renderer);
      }
      instanceNodes.push(instance);
      instanceRenderers.push(renderers);
    }

    const resolvedInitialClip = initialClip ?? manifest.clips[0]?.name ?? '';
    const instances = instanceNodes.map((node, index) => new SpineVatInstanceV2(
      node,
      instanceRenderers[index],
      layout.id,
      manifest,
      resolvedInitialClip,
    ));

    const population = new SpineVatPopulationV2(
      root,
      compiled,
      materials,
      meshes,
      [...positionPages, ...lightPages, ...darkPages, black, white],
      pageSizes,
      instances,
    );
    return population;
  }

  /** Creates a population from the single asset assigned to SpineVatComponent. */
  static async createFromVatAsset(
    parent: Node,
    vatAsset: SpineVatAsset,
    instanceCount: number,
    populationLayout: VatPopulationLayout = {},
    initialClip?: string,
  ): Promise<SpineVatPopulationV2> {
    if (!vatAsset.effectAsset) {
      throw new Error('SpineVatAsset 缺少 EffectAsset 依赖，请在 Creator 中重新导入 manifest.spinevat');
    }
    return SpineVatPopulationV2.createFromPageAssets(
      parent,
      vatAsset.manifest,
      vatAsset.atlasPages,
      vatAsset.positionPages,
      vatAsset.lightPages,
      vatAsset.darkPages,
      instanceCount,
      populationLayout,
      initialClip,
      vatAsset.effectAsset,
    );
  }

  /** Benchmark-only loader for the native test scene's pre-baked resources bundle. */
  static async createFromResources(
    parent: Node,
    _atlasPages: Texture2D[],
    instanceCount: number,
    resourceRoot: string,
    populationLayout: VatPopulationLayout = {},
    initialClip?: string,
  ): Promise<SpineVatPopulationV2> {
    const vatAsset = await loadResource(`${resourceRoot}/manifest`, SpineVatAsset);
    return SpineVatPopulationV2.createFromVatAsset(
      parent,
      vatAsset,
      instanceCount,
      populationLayout,
      initialClip,
    );
  }

  /** Low-level entry used by tests and importer validation. */
  static async createFromAssets(
    parent: Node,
    manifestAsset: { json: unknown },
    atlasPages: readonly Texture2D[],
    positionPages: readonly BufferAsset[],
    lightPages: readonly BufferAsset[],
    darkPages: readonly BufferAsset[],
    instanceCount: number,
    populationLayout: VatPopulationLayout = {},
    initialClip?: string,
  ): Promise<SpineVatPopulationV2> {
    const manifest = manifestAsset?.json as SpineVatManifestV2 | null;
    return SpineVatPopulationV2.createFromPageAssets(
      parent,
      manifest!,
      atlasPages,
      positionPages,
      lightPages,
      darkPages,
      instanceCount,
      populationLayout,
      initialClip,
    );
  }

  private static async createFromPageAssets(
    parent: Node,
    manifest: SpineVatManifestV2,
    atlasPages: readonly Texture2D[],
    positionPages: readonly BufferAsset[],
    lightPages: readonly BufferAsset[],
    darkPages: readonly BufferAsset[],
    instanceCount: number,
    populationLayout: VatPopulationLayout,
    initialClip?: string,
    effectAsset?: EffectAsset,
  ): Promise<SpineVatPopulationV2> {
    const entries = texturePageEntries(manifest!);
    const resolvedAtlasPages = assertAssetArray('atlas pages', atlasPages, manifest!.atlasPages.length);
    const resolvedPositionPages = assertAssetArray('position pages', positionPages, entries.position.length);
    const resolvedLightPages = assertAssetArray('light pages', lightPages, entries.light.length);
    const resolvedDarkPages = assertAssetArray('dark pages', darkPages, entries.dark.length);

    const pages = entries.position.map((positionEntry, pageIndex): SpineVatCompiledPageV2 => {
      const texelBytes = positionEntry.size[0] * positionEntry.size[1] * 4;
      const positionBuffer = resolvedPositionPages[pageIndex].buffer();
      const lightBuffer = resolvedLightPages[pageIndex]?.buffer();
      const darkBuffer = resolvedDarkPages[pageIndex]?.buffer();
      if (positionBuffer.byteLength !== texelBytes * 4) {
        throw new Error(`VAT position page ${pageIndex} byte length does not match manifest`);
      }
      if (lightBuffer && lightBuffer.byteLength !== texelBytes) {
        throw new Error(`VAT light page ${pageIndex} byte length does not match manifest`);
      }
      if (darkBuffer && darkBuffer.byteLength !== texelBytes) {
        throw new Error(`VAT dark page ${pageIndex} byte length does not match manifest`);
      }
      return {
        width: positionEntry.size[0],
        height: positionEntry.size[1],
        position: new Float32Array(positionBuffer),
        light: lightBuffer ? new Uint8Array(lightBuffer) : undefined,
        dark: darkBuffer ? new Uint8Array(darkBuffer) : undefined,
      };
    });
    const textureBytes = pages.reduce((sum, page) => (
      sum + page.position.byteLength + (page.light?.byteLength ?? 0) + (page.dark?.byteLength ?? 0)
    ), 0);
    return SpineVatPopulationV2.create(
      parent,
      { manifest: manifest!, pages, textureBytes },
      resolvedAtlasPages,
      instanceCount,
      populationLayout,
      initialClip,
      effectAsset,
    );
  }

  get currentClip(): SpineVatManifestV2['clips'][number] {
    return this.instances[0]?.currentClip ?? this.manifest.clips[0];
  }

  setClip(name: string): void {
    for (const instance of this.instances) instance.play(name);
  }

  setManualFrame(frame: number | null): void {
    for (const instance of this.instances) instance.setManualFrame(frame);
  }

  updateHybrid(): void {
    for (const instance of this.instances) instance.updateHybrid();
  }

  destroy(): void {
    this.root.destroy();
    for (const material of this.materials) material.destroy();
    for (const mesh of this.meshes) mesh.destroy();
    for (const texture of this.textures) texture.destroy();
  }
}

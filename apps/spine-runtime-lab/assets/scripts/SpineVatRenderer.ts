import {
  BufferAsset,
  director,
  EffectAsset,
  gfx,
  ImageAsset,
  JsonAsset,
  Layers,
  Material,
  Mesh,
  MeshRenderer,
  Node,
  resources,
  Texture2D,
  Vec3,
  Vec4,
  utils,
} from 'cc';
import { packSpineVat } from './SpineVatBaker';
import type { PackedSpineVat, SpineVatBakeResult, SpineVatMetadata, VatSegment } from './SpineVatBaker';

export interface VatPopulationLayout {
  columns?: number;
  spacingX?: number;
  spacingY?: number;
  scale?: number;
  offsetY?: number;
}

function loadEffect(): Promise<EffectAsset> {
  return new Promise((resolve, reject) => {
    resources.load('spine-vat', EffectAsset, (error, asset) => {
      if (error || !asset) reject(error ?? new Error('VAT effect not found'));
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
  texture.setWrapMode(Texture2D.WrapMode.CLAMP_TO_EDGE, Texture2D.WrapMode.CLAMP_TO_EDGE, Texture2D.WrapMode.CLAMP_TO_EDGE);
  texture.image = image;
  return texture;
}

function createSegmentMesh(
  totalVertexCount: number,
  segment: VatSegment,
  vertexOffset: number,
  allIndices: Uint16Array,
  indexOffset: number,
): Mesh {
  const positions: number[] = [];
  for (let i = 0; i < segment.vertexCount; i += 1) {
    positions.push((vertexOffset + i + 0.5) / totalVertexCount, 0, 0);
  }
  const indices = Array.from(
    allIndices.subarray(indexOffset, indexOffset + segment.indexCount),
    (index) => index - vertexOffset,
  );
  return utils.createMesh({
    positions,
    indices,
    minPos: { x: -240, y: -240, z: -1 },
    maxPos: { x: 240, y: 240, z: 1 },
  });
}

function buildVatTextures(packed: PackedSpineVat): {
  position: Texture2D;
  light: Texture2D;
  dark: Texture2D;
  byteLength: number;
} {
  const { metadata, position: positionData, light: lightData, dark: darkData } = packed;
  return {
    position: createTexture(positionData, metadata.vertexCount, metadata.frameCount, gfx.Format.RGBA32F),
    light: createTexture(lightData, metadata.vertexCount, metadata.frameCount, gfx.Format.RGBA8),
    dark: createTexture(darkData, metadata.vertexCount, metadata.frameCount, gfx.Format.RGBA8),
    byteLength: positionData.byteLength + lightData.byteLength + darkData.byteLength,
  };
}

export class SpineVatPopulation {
  readonly root: Node;
  readonly textureBytes: number;
  readonly drawGroups: number;

  private readonly materials: Material[];
  private readonly meshes: Mesh[];
  private readonly textures: Texture2D[];
  private readonly frameRate: number;
  private readonly frameCount: number;
  private readonly animationStartTime: number;

  private constructor(
    root: Node,
    materials: Material[],
    meshes: Mesh[],
    textures: Texture2D[],
    frameRate: number,
    frameCount: number,
    animationStartTime: number,
    textureBytes: number,
  ) {
    this.root = root;
    this.materials = materials;
    this.meshes = meshes;
    this.textures = textures;
    this.frameRate = frameRate;
    this.frameCount = frameCount;
    this.animationStartTime = animationStartTime;
    this.textureBytes = textureBytes;
    this.drawGroups = meshes.length;
  }

  static async create(
    parent: Node,
    result: SpineVatBakeResult,
    atlas: Texture2D,
    instanceCount: number,
    layout: VatPopulationLayout = {},
  ): Promise<SpineVatPopulation> {
    return SpineVatPopulation.createPacked(parent, packSpineVat(result), atlas, instanceCount, layout);
  }

  static async createFromResources(
    parent: Node,
    atlas: Texture2D,
    instanceCount: number,
    resourceRoot = 'tuan42-vat',
    layout: VatPopulationLayout = {},
  ): Promise<SpineVatPopulation> {
    const [metadataAsset, positionAsset, lightAsset, darkAsset] = await Promise.all([
      loadResource(`${resourceRoot}/metadata`, JsonAsset),
      loadResource(`${resourceRoot}/position`, BufferAsset),
      loadResource(`${resourceRoot}/light`, BufferAsset),
      loadResource(`${resourceRoot}/dark`, BufferAsset),
    ]);
    const metadata = metadataAsset.json as SpineVatMetadata;
    if (metadata.format !== 'spine-vat-1') throw new Error(`Unsupported VAT format: ${metadata.format}`);
    const packed: PackedSpineVat = {
      metadata,
      position: new Float32Array(positionAsset.buffer()),
      light: new Uint8Array(lightAsset.buffer()),
      dark: new Uint8Array(darkAsset.buffer()),
    };
    return SpineVatPopulation.createPacked(parent, packed, atlas, instanceCount, layout);
  }

  private static async createPacked(
    parent: Node,
    packed: PackedSpineVat,
    atlas: Texture2D,
    instanceCount: number,
    layout: VatPopulationLayout,
  ): Promise<SpineVatPopulation> {
    const effect = await loadEffect();
    const vatTextures = buildVatTextures(packed);
    const { metadata } = packed;
    const meshes: Mesh[] = [];
    const materials: Material[] = [];
    const animationStartTime = director.root?.cumulativeTime ?? 0;
    let vertexOffset = 0;
    let indexOffset = 0;
    const indices = Uint16Array.from(metadata.indices);
    for (const segment of metadata.segments) {
      meshes.push(createSegmentMesh(metadata.vertexCount, segment, vertexOffset, indices, indexOffset));
      const material = new Material();
      const technique = segment.blendMode === 1
        ? 1
        : metadata.topologyMode === 'triangle-soup' ? 2 : 0;
      material.initialize({
        effectAsset: effect,
        technique,
        defines: { USE_INSTANCING: true },
      });
      material.setProperty('mainTexture', atlas);
      material.setProperty('positionTexture', vatTextures.position);
      material.setProperty('lightTexture', vatTextures.light);
      material.setProperty('darkTexture', vatTextures.dark);
      material.setProperty('vatControl', new Vec4(
        metadata.frameRate,
        metadata.frameCount,
        animationStartTime,
        -1,
      ));
      materials.push(material);
      vertexOffset += segment.vertexCount;
      indexOffset += segment.indexCount;
    }

    const root = new Node('SpineVAT');
    root.layer = Layers.Enum.UI_3D;
    root.parent = parent;
    const columns = layout.columns ?? Math.max(1, Math.ceil(Math.sqrt(instanceCount)));
    const rows = Math.ceil(instanceCount / columns);
    const scale = layout.scale ?? (instanceCount <= 5 ? 0.7 : 0.42);
    const spacingX = layout.spacingX ?? 140;
    const spacingY = layout.spacingY ?? 160;
    const offsetY = layout.offsetY ?? -40;
    for (let i = 0; i < instanceCount; i += 1) {
      const instance = new Node(`VAT-${i}`);
      instance.layer = Layers.Enum.UI_3D;
      instance.parent = root;
      instance.setPosition(new Vec3(
        (i % columns - (columns - 1) / 2) * spacingX,
        (Math.floor(i / columns) - (rows - 1) / 2) * spacingY + offsetY,
        0,
      ));
      instance.setScale(scale, scale, scale);
      for (let segmentIndex = 0; segmentIndex < meshes.length; segmentIndex += 1) {
        const child = new Node(`segment-${segmentIndex}`);
        child.layer = Layers.Enum.UI_3D;
        child.parent = instance;
        child.setPosition(0, 0, segmentIndex * 0.01);
        const renderer = child.addComponent(MeshRenderer);
        renderer.mesh = meshes[segmentIndex];
        renderer.setSharedMaterial(materials[segmentIndex], 0);
      }
    }

    return new SpineVatPopulation(
      root,
      materials,
      meshes,
      [vatTextures.position, vatTextures.light, vatTextures.dark],
      metadata.frameRate,
      metadata.frameCount,
      animationStartTime,
      vatTextures.byteLength,
    );
  }

  setManualFrame(frame: number | null): void {
    const normalizedFrame = frame === null ? -1 : Math.max(0, Math.min(this.frameCount - 1, Math.floor(frame)));
    for (const material of this.materials) {
      material.setProperty('vatControl', new Vec4(
        this.frameRate,
        this.frameCount,
        this.animationStartTime,
        normalizedFrame,
      ));
    }
  }

  destroy(): void {
    this.root.destroy();
    for (const material of this.materials) material.destroy();
    for (const mesh of this.meshes) mesh.destroy();
    for (const texture of this.textures) texture.destroy();
  }
}

function loadResource<T>(path: string, type: new (...args: any[]) => T): Promise<T> {
  return new Promise((resolve, reject) => {
    resources.load(path, type as any, (error, asset) => {
      if (error || !asset) reject(error ?? new Error(`Resource not found: ${path}`));
      else resolve(asset as T);
    });
  });
}

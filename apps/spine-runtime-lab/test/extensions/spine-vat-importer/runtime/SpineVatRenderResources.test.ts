import { describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({
  materials: [] as Array<{ destroyed: boolean }>,
  meshes: [] as Array<{ destroyed: boolean; info?: unknown }>,
  textures: [] as Array<{ destroyed: boolean }>,
}));

vi.mock('cc', () => {
  const identityDecorator = () => (target: unknown) => target;
  const propertyDecorator = () => () => undefined;

  class Asset {
    uuid = '';
    nativeUrl = '';
  }

  class BufferAsset extends Asset {
    constructor(private readonly bytes = new ArrayBuffer(0)) {
      super();
    }

    buffer(): ArrayBuffer {
      return this.bytes;
    }
  }

  class EffectAsset extends Asset {}

  class ImageAsset {
    constructor(public readonly options: unknown) {}
  }

  class Texture2D extends Asset {
    static Filter = { NEAREST: 0, NONE: 1 };
    static WrapMode = { CLAMP_TO_EDGE: 0 };
    destroyed = false;
    hideFlags = 0;
    image: ImageAsset | null = null;

    constructor() {
      super();
      runtime.textures.push(this);
    }

    setFilters(): void {}
    setMipFilter(): void {}
    setWrapMode(): void {}
    destroy(): void { this.destroyed = true; }
  }

  class Material extends Asset {
    destroyed = false;
    hideFlags = 0;
    initializeInfo: unknown;
    readonly properties = new Map<string, unknown>();

    constructor() {
      super();
      runtime.materials.push(this);
    }

    initialize(info: unknown): void { this.initializeInfo = info; }
    setProperty(name: string, value: unknown): void { this.properties.set(name, value); }
    destroy(): void { this.destroyed = true; }
  }

  class Mesh extends Asset {
    destroyed = false;
    hideFlags = 0;
    info?: unknown;

    constructor() {
      super();
      runtime.meshes.push(this);
    }

    reset(info: unknown): void { this.info = info; }
    destroy(): void { this.destroyed = true; }
  }

  class MeshRenderer {
    mesh: Mesh | null = null;
    sharedMaterials: Array<Material | null> = [];
    readonly attributes = new Map<string, readonly number[]>();

    setSharedMaterial(material: Material | null, index: number): void {
      this.sharedMaterials[index] = material;
    }

    setInstancedAttribute(name: string, value: readonly number[]): void {
      this.attributes.set(name, value);
    }
  }

  class Vec3 {
    constructor(public x = 0, public y = 0, public z = 0) {}
  }

  class Vec4 {
    constructor(public x = 0, public y = 0, public z = 0, public w = 0) {}
  }

  const Enum = (definition: Record<string, number>): Record<string, string | number> => {
    const value: Record<string, string | number> = { ...definition };
    for (const [name, index] of Object.entries(definition)) value[index] = name;
    return value;
  };

  return {
    _decorator: {
      ccclass: identityDecorator,
      executeInEditMode: identityDecorator,
      menu: identityDecorator,
      playOnFocus: identityDecorator,
      property: propertyDecorator,
    },
    Asset,
    BufferAsset,
    CCObject: { Flags: { DontSave: 1 } },
    director: { root: { cumulativeTime: 10, device: { gfxAPI: 0 } } },
    EffectAsset,
    Enum,
    gfx: {
      Attribute: class Attribute {
        constructor(public name: string, public format: number) {}
      },
      AttributeName: { ATTR_POSITION: 'a_position' },
      API: { WEBGL: 1 },
      Format: { RGB32F: 1, RGBA32F: 2, RGBA8: 3, R8: 4, L8: 5 },
      PrimitiveMode: { TRIANGLE_LIST: 0 },
    },
    ImageAsset,
    js: { getClassByName: () => null },
    Material,
    Mesh,
    MeshRenderer,
    Texture2D,
    Vec3,
    Vec4,
  };
});

import type { BufferAsset, EffectAsset, Mesh, Texture2D } from 'cc';
import { SpineVatRenderHandle } from '../../../../extensions/spine-vat-importer/assets/runtime/SpineVatRenderResources';
import type { SpineVatManifest } from '../../../../extensions/spine-vat-importer/assets/runtime/SpineVatSchema';
import { SpineVatSkeletonData } from '../../../../extensions/spine-vat-importer/assets/runtime/SpineVatSkeletonData';

let assetSequence = 0;

function createData(): SpineVatSkeletonData {
  const data = new SpineVatSkeletonData();
  data.uuid = `vat-${assetSequence += 1}`;
  const manifest: SpineVatManifest = {
    format: 'spine-vat-2',
    source: {
      creator: '3.8.7',
      spineVersion: '4.2',
      runtimeFamily: 'spine-ts',
      hashAlgorithm: 'sha-256',
      hashes: {},
    },
    alphaMode: 'straight',
    textureProfile: 'balanced',
    channels: { light: true, dark: false },
    pageTexels: 4,
    texturePages: [
      { semantic: 'position', path: 'position-0.bin', size: [2, 2], format: 'rgba32f' },
      { semantic: 'light', path: 'light-0.bin', size: [2, 2], format: 'rgba8' },
    ],
    atlasPages: [{ id: 'atlas-0', path: 'atlas.png' }],
    layouts: [{
      id: 'fixed',
      frameStride: 15,
      bounds: [-10, -20, 30, 40],
      clipCount: 1,
      staticFrame: 45,
      lanes: [
        {
          atlasPage: 0,
          textureId: 'atlas-0',
          blendMode: 'normal',
          vertexOffset: 0,
          vertexCapacity: 4,
          logicalLane: 0,
          geometryMode: 'indexed-stable',
          indices: [0, 1, 2, 0, 2, 3],
        },
        {
          atlasPage: 0,
          textureId: 'atlas-0',
          blendMode: 'additive',
          vertexOffset: 4,
          vertexCapacity: 3,
          logicalLane: 1,
          geometryMode: 'indexed-stable',
          indices: [0, 1, 2],
        },
      ],
    }],
    variants: [{ name: 'default', skins: ['default'], layout: 'fixed' }],
    clips: [
      { name: 'idle', variant: 'default', fps: 30, duration: 1, frameOffset: 0, frameCount: 30, layout: 'fixed' },
      { name: 'win', variant: 'default', fps: 30, duration: 0.5, frameOffset: 30, frameCount: 15, layout: 'fixed' },
    ],
    compatibility: {
      level: 'LOSSLESS_VAT',
      warnings: [],
      estimatedGpuBytes: 80,
      drawCallsPerBatch: 2,
    },
  };
  data.setManifest(manifest);
  data.positionPages.push({ uuid: 'position', nativeUrl: '', buffer: () => new ArrayBuffer(64) } as BufferAsset);
  data.lightPages.push({ uuid: 'light', nativeUrl: '', buffer: () => new ArrayBuffer(16) } as BufferAsset);
  data.atlasPages.push({ uuid: 'atlas', nativeUrl: '' } as Texture2D);
  (data as unknown as { effectAsset: EffectAsset }).effectAsset = { uuid: 'effect', nativeUrl: '' } as EffectAsset;
  return data;
}

describe('扩展内 spinevat.SkeletonData', () => {
  it('从导入资源生成与官方 Spine 相同形状的动画枚举', () => {
    const data = createData();
    const animations = data.getAnimsEnum();

    expect(animations['<Default>']).toBe(0);
    expect(animations.idle).toBe(1);
    expect(animations.win).toBe(2);
    expect(animations[2]).toBe('win');
  });
});

describe('扩展内 spinevat.Skeleton 渲染资源', () => {
  it('一个 Renderer 使用多 SubMesh 表示多个 Lane，索引取 lane.indices', async () => {
    const { MeshRenderer } = await import('cc');
    const renderer = new MeshRenderer();
    const handle = await SpineVatRenderHandle.create(renderer, createData(), true, 'idle');
    const meshInfo = (renderer.mesh as Mesh & { info: {
      struct: { primitives: Array<{ indexView: { offset: number; count: number; stride: number } }> };
      data: Uint8Array;
    } }).info;

    const primitives = meshInfo.struct.primitives;
    expect(primitives.map((primitive) => primitive.indexView.count)).toEqual([6, 3]);
    const indices = primitives.map(({ indexView }) => Array.from(
      new Uint16Array(meshInfo.data.buffer, indexView.offset, indexView.count),
    ));
    expect(indices).toEqual([[0, 1, 2, 0, 2, 3], [4, 5, 6]]);
    expect(renderer.sharedMaterials).toHaveLength(2);
    const material = renderer.sharedMaterials[0] as unknown as {
      initializeInfo: { defines: Record<string, boolean> };
      properties: Map<string, { x: number; y: number }>;
    };
    expect(material.initializeInfo.defines).toMatchObject({ VAT_LERP: true, VAT_CLIP: true });
    // 静态区在第 45 帧；剪裁区从帧内第 15 - 8 = 7 个 texel 开始。
    expect(material.properties.get('vatClip')).toMatchObject({ x: 45, y: 7 });
    expect(renderer.attributes.get('a_vatAnim0')).toEqual([0, 30, 30, 10]);
    expect(renderer.attributes.get('a_vatAnim1')).toEqual([0, 1, 1, -1]);

    handle.destroy();
  });

  it('多个组件共享 Mesh、Material 和 VAT Texture，最后一个释放时才销毁', async () => {
    const { MeshRenderer } = await import('cc');
    const data = createData();
    const firstRenderer = new MeshRenderer();
    const secondRenderer = new MeshRenderer();
    const meshStart = runtime.meshes.length;
    const materialStart = runtime.materials.length;
    const textureStart = runtime.textures.length;

    const first = await SpineVatRenderHandle.create(firstRenderer, data, true, 'idle');
    const second = await SpineVatRenderHandle.create(secondRenderer, data, true, 'win');

    expect(runtime.meshes.length - meshStart).toBe(1);
    expect(runtime.materials.length - materialStart).toBe(2);
    expect(runtime.textures.length - textureStart).toBe(4);
    expect(secondRenderer.mesh).toBe(firstRenderer.mesh);
    expect(secondRenderer.sharedMaterials[0]).toBe(firstRenderer.sharedMaterials[0]);
    expect(firstRenderer.attributes.get('a_vatAnim0')?.[0]).toBe(0);
    expect(secondRenderer.attributes.get('a_vatAnim0')?.[0]).toBe(30);

    const sharedMesh = firstRenderer.mesh as Mesh & { destroyed: boolean };
    first.destroy();
    expect(sharedMesh.destroyed).toBe(false);
    expect(secondRenderer.mesh).toBe(sharedMesh);

    second.destroy();
    expect(sharedMesh.destroyed).toBe(true);
    expect(firstRenderer.mesh).toBeNull();
    expect(secondRenderer.mesh).toBeNull();
  });

  it('拒绝旧的多 layout / 无索引资源（需要重新烘焙）', async () => {
    const { MeshRenderer } = await import('cc');
    const data = createData();
    const manifest = structuredClone(data.manifest);
    manifest.layouts.push({ ...manifest.layouts[0], id: 'default' });
    data.setManifest(manifest);

    await expect(SpineVatRenderHandle.create(new MeshRenderer(), data, true, 'idle'))
      .rejects.toThrow(/只能有一个 layout/);
  });
});

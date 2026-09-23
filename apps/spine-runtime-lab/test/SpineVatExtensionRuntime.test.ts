import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
    director: { root: { cumulativeTime: 10 } },
    EffectAsset,
    Enum,
    gfx: {
      Attribute: class Attribute {
        constructor(public name: string, public format: number) {}
      },
      AttributeName: { ATTR_POSITION: 'a_position' },
      Format: { RGB32F: 1, RGBA32F: 2, RGBA8: 3 },
      PrimitiveMode: { TRIANGLE_LIST: 0 },
    },
    ImageAsset,
    Material,
    Mesh,
    MeshRenderer,
    Texture2D,
    Vec3,
    Vec4,
  };
});

import type { BufferAsset, EffectAsset, Mesh, Texture2D } from 'cc';
import { SpineVatRenderHandle } from '../extensions/spine-vat-importer/assets/runtime/SpineVatRenderResources';
import type { SpineVatManifest } from '../extensions/spine-vat-importer/assets/runtime/SpineVatSchema';
import { SpineVatSkeletonData } from '../extensions/spine-vat-importer/assets/runtime/SpineVatSkeletonData';

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
      id: 'default',
      frameStride: 6,
      bounds: [-10, -20, 30, 40],
      lanes: [
        {
          atlasPage: 0,
          textureId: 'atlas-0',
          blendMode: 'normal',
          vertexOffset: 0,
          vertexCapacity: 3,
          logicalLane: 0,
          geometryMode: 'triangle-soup-dynamic',
        },
        {
          atlasPage: 0,
          textureId: 'atlas-0',
          blendMode: 'additive',
          vertexOffset: 3,
          vertexCapacity: 3,
          logicalLane: 1,
          geometryMode: 'triangle-soup-dynamic',
        },
      ],
    }],
    variants: [{ name: 'default', skins: ['default'], layout: 'default' }],
    clips: [
      { name: 'idle', variant: 'default', fps: 30, duration: 1, frameOffset: 0, frameCount: 30, layout: 'default' },
      { name: 'win', variant: 'default', fps: 30, duration: 0.5, frameOffset: 30, frameCount: 15, layout: 'default' },
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
  it('一个 Renderer 使用多 SubMesh 表示多个 Lane，不创建额外实例节点', async () => {
    const { MeshRenderer } = await import('cc');
    const renderer = new MeshRenderer();
    const handle = await SpineVatRenderHandle.create(renderer, createData(), 'idle');
    const meshInfo = (renderer.mesh as Mesh & { info: {
      struct: { primitives: Array<{ indexView: { offset: number; count: number } }> };
    } }).info;

    expect(meshInfo.struct.primitives).toHaveLength(2);
    expect(meshInfo.struct.primitives.map((primitive) => primitive.indexView.count)).toEqual([3, 3]);
    expect(renderer.sharedMaterials).toHaveLength(2);
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

    const first = await SpineVatRenderHandle.create(firstRenderer, data, 'idle');
    const second = await SpineVatRenderHandle.create(secondRenderer, data, 'win');

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

  it('拒绝把不同布局的动画静默套用到错误 Mesh', async () => {
    const { MeshRenderer } = await import('cc');
    const data = createData();
    const manifest = structuredClone(data.manifest);
    manifest.clips[1].layout = 'other-layout';
    data.setManifest(manifest);

    await expect(SpineVatRenderHandle.create(new MeshRenderer(), data, 'idle'))
      .rejects.toThrow(/requires one shared layout/);
  });

  it('循环帧在 GPU 精度误差下仍被限制在当前动画内', () => {
    const effect = readFileSync(resolve(
      __dirname,
      '../extensions/spine-vat-importer/assets/spine-vat-v2.effect',
    ), 'utf8');

    expect(effect).toContain('min(mod(floor(rawFrame), a_vatAnim0.y), a_vatAnim0.y - 1.0)');
  });
});

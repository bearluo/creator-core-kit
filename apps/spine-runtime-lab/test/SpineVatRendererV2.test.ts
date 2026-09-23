import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('cc', () => {
  class Stub {}
  return {
    _decorator: {
      ccclass: () => (target: unknown) => target,
      property: () => () => undefined,
    },
    Asset: Stub,
    BufferAsset: Stub,
    director: { root: null },
    EffectAsset: Stub,
    gfx: { Format: {} },
    ImageAsset: Stub,
    JsonAsset: Stub,
    Layers: { Enum: { UI_3D: 0 } },
    Material: Stub,
    Mesh: Stub,
    MeshRenderer: Stub,
    Node: Stub,
    resources: { load: vi.fn() },
    Texture2D: Stub,
    Vec3: Stub,
    Vec4: Stub,
    utils: { createMesh: vi.fn() },
  };
});

import type { BufferAsset, EffectAsset, JsonAsset, Texture2D } from 'cc';
import type { SpineVatAsset } from '../assets/scripts/SpineVatAsset';
import { SpineVatPopulationV2 } from '../assets/scripts/SpineVatRendererV2';
import type { SpineVatManifestV2 } from '../assets/scripts/SpineVatTypes';

function manifest(channels = { light: true, dark: false }): SpineVatManifestV2 {
  return {
    format: 'spine-vat-2',
    channels,
    atlasPages: [{ id: 'atlas-0', path: 'atlas.png' }],
    texturePages: [
      { semantic: 'position', path: 'position-0.bin', size: [2, 2], format: 'rgba32f' },
      ...(channels.light
        ? [{ semantic: 'light' as const, path: 'light-0.bin', size: [2, 2] as [number, number], format: 'rgba8' }]
        : []),
      ...(channels.dark
        ? [{ semantic: 'dark' as const, path: 'dark-0.bin', size: [2, 2] as [number, number], format: 'rgba8' }]
        : []),
    ],
  } as SpineVatManifestV2;
}

function jsonAsset(json: SpineVatManifestV2): JsonAsset {
  return { json } as JsonAsset;
}

function bufferAsset(byteLength: number): BufferAsset {
  return { buffer: () => new ArrayBuffer(byteLength) } as BufferAsset;
}

afterEach(() => vi.restoreAllMocks());

describe('SpineVatPopulationV2.createFromAssets', () => {
  it('把 Inspector 资源转换为与路径加载一致的编译数据', async () => {
    const create = vi.spyOn(SpineVatPopulationV2, 'create').mockResolvedValue({} as SpineVatPopulationV2);
    await SpineVatPopulationV2.createFromAssets(
      {} as never,
      jsonAsset(manifest()),
      [{} as Texture2D],
      [bufferAsset(64)],
      [bufferAsset(16)],
      [],
      3,
    );

    const compiled = create.mock.calls[0][1];
    expect(compiled.textureBytes).toBe(80);
    expect(compiled.pages[0].position).toBeInstanceOf(Float32Array);
    expect(compiled.pages[0].light).toBeInstanceOf(Uint8Array);
    expect(compiled.pages[0].dark).toBeUndefined();
  });

  it('资源页数与 manifest 不一致时拒绝创建', async () => {
    await expect(SpineVatPopulationV2.createFromAssets(
      {} as never,
      jsonAsset(manifest()),
      [{} as Texture2D],
      [],
      [bufferAsset(16)],
      [],
      1,
    )).rejects.toThrow(/needs 1 position pages, received 0/);
  });

  it('二进制字节数与纹理尺寸不一致时拒绝创建', async () => {
    await expect(SpineVatPopulationV2.createFromAssets(
      {} as never,
      jsonAsset(manifest({ light: false, dark: false })),
      [{} as Texture2D],
      [bufferAsset(60)],
      [],
      [],
      1,
    )).rejects.toThrow(/position page 0 byte length/);
  });
});

describe('SpineVatPopulationV2.createFromVatAsset', () => {
  it('把 SpineVatAsset 隐藏关联的 Effect 传给渲染器', async () => {
    const effectAsset = {} as EffectAsset;
    const vatAsset = {
      effectAsset,
      manifest: manifest(),
      atlasPages: [{} as Texture2D],
      positionPages: [bufferAsset(64)],
      lightPages: [bufferAsset(16)],
      darkPages: [],
    } as SpineVatAsset;
    const create = vi.spyOn(SpineVatPopulationV2, 'create').mockResolvedValue({} as SpineVatPopulationV2);

    await SpineVatPopulationV2.createFromVatAsset({} as never, vatAsset, 3);

    expect(create.mock.calls[0][6]).toBe(effectAsset);
  });

  it('缺少扩展 Effect 依赖时要求重新导入 manifest', async () => {
    const vatAsset = { effectAsset: null } as SpineVatAsset;

    await expect(SpineVatPopulationV2.createFromVatAsset(
      {} as never,
      vatAsset,
      1,
    )).rejects.toThrow(/重新导入 manifest\.spinevat/);
  });
});

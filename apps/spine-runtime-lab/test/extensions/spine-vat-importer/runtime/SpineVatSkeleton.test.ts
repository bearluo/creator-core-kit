import { describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({ time: 0 }));

vi.mock('cc/env', () => ({ EDITOR_NOT_IN_PREVIEW: false }));

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
    hideFlags = 0;
    image: ImageAsset | null = null;
    setFilters(): void {}
    setMipFilter(): void {}
    setWrapMode(): void {}
    destroy(): void {}
  }

  class Material extends Asset {
    hideFlags = 0;
    readonly passes = [{ getHandle: () => 0, setUniformArray: () => undefined }];
    initialize(): void {}
    setProperty(): void {}
    destroy(): void {}
  }

  class Vec4 {
    constructor(public x = 0, public y = 0, public z = 0, public w = 0) {}
    set(x = 0, y = 0, z = 0, w = 0): this {
      this.x = x;
      this.y = y;
      this.z = z;
      this.w = w;
      return this;
    }
  }

  class Node {
    hideFlags = 0;
    isValid = true;
    layer = 0;
    parent: Node | null = null;
    worldMatrix = { m00: 1, m01: 0, m04: 0, m05: 1, m12: 0, m13: 0 };
    constructor(public name = '') {}
    addComponent<T>(type: new () => T): T {
      return new type();
    }
    destroy(): void {
      this.isValid = false;
    }
  }

  class MeshRenderer {
    isValid = true;
    enabledInHierarchy = true;
    mesh: unknown = null;
    sharedMaterials: unknown[] = [];
    onLoad(): void {}
    onEnable(): void {}
    onDisable(): void {}
    onDestroy(): void {}
    onRestore(): void {}
    scheduleOnce(): void {}
    unschedule(): void {}
    setInstancedAttribute(): void {}
  }

  class Component {
    isValid = true;
    enabledInHierarchy = true;
    node = new Node('vat');
  }

  const Enum = (definition: Record<string, number>): Record<string, string | number> => {
    const value: Record<string, string | number> = { ...definition };
    for (const [name, index] of Object.entries(definition)) value[index] = name;
    return value;
  };

  return {
    _decorator: {
      ccclass: identityDecorator,
      executeInEditMode: (target: unknown) => target, // 不带括号的装饰器
      menu: identityDecorator,
      playOnFocus: (target: unknown) => target,
      property: propertyDecorator,
    },
    Asset,
    BufferAsset,
    CCObject: { Flags: { DontSave: 1 } },
    Component,
    director: {
      root: { get cumulativeTime() { return runtime.time; }, device: { gfxAPI: 0 } },
      on: () => undefined,
      off: () => undefined,
    },
    Director: { EVENT_BEFORE_DRAW: 'before-draw' },
    EffectAsset,
    Enum,
    gfx: {
      API: { WEBGL: 1 },
      Attribute: class Attribute {
        constructor(public name: string, public format: number) {}
      },
      AttributeName: { ATTR_POSITION: 'a_position' },
      Format: { RGB32F: 1, RGBA32F: 2, RGBA8: 3, R8: 4, L8: 5 },
      PrimitiveMode: { TRIANGLE_LIST: 0 },
    },
    ImageAsset,
    js: { getClassByName: () => null },
    Material,
    Mesh: class {
      hideFlags = 0;
      reset(): void {}
      destroy(): void {}
    },
    MeshRenderer,
    Node,
    setPropertyEnumType: () => undefined,
    Texture2D,
    Vec3: class {},
    Vec4,
  };
});

import { BufferAsset, EffectAsset, Texture2D } from 'cc';
import type { SpineVatManifest, SpineVatSocketMatrix } from '../../../../extensions/spine-vat-importer/assets/runtime/SpineVatSchema';
import { SpineVatSkeleton } from '../../../../extensions/spine-vat-importer/assets/runtime/SpineVatSkeleton';
import { SpineVatSkeletonData } from '../../../../extensions/spine-vat-importer/assets/runtime/SpineVatSkeletonData';

const FRAMES = 10;
const STRIDE = 3;

function socketFrame(frame: number): SpineVatSocketMatrix {
  return [1, 0, 0, 1, frame, -frame];
}

let assetSequence = 0;

/** 一个 clip：10 帧 @10fps（1 秒），0.25 秒处一个事件，带 socket `hand`。 */
function createData(): SpineVatSkeletonData {
  const data = new SpineVatSkeletonData();
  data.uuid = `ui-vat-${assetSequence += 1}`;
  const texels = (FRAMES + 1) * STRIDE;
  const manifest: SpineVatManifest = {
    format: 'spine-vat-2',
    source: { creator: '3.8.7', spineVersion: '4.2', runtimeFamily: '4.2', hashAlgorithm: 'SHA-256', hashes: {} },
    alphaMode: 'straight',
    textureProfile: 'exact',
    channels: { light: false, dark: false },
    pageTexels: texels,
    texturePages: [{ semantic: 'position', path: 'position-0.bin', size: [texels, 1], format: 'rgba32f' }],
    atlasPages: [{ id: 'atlas-0', path: 'atlas.png' }],
    layouts: [{
      id: 'fixed',
      frameStride: STRIDE,
      bounds: [0, 0, 1, 1],
      clipCount: 0,
      staticFrame: FRAMES,
      lanes: [{
        atlasPage: 0,
        textureId: 'atlas-0',
        blendMode: 'normal',
        vertexOffset: 0,
        vertexCapacity: STRIDE,
        logicalLane: 0,
        geometryMode: 'indexed-stable',
        indices: [0, 1, 2],
      }],
    }],
    variants: [{ name: 'default', skins: ['default'], layout: 'fixed' }],
    clips: [{
      name: 'idle',
      variant: 'default',
      fps: 10,
      duration: 1,
      frameOffset: 0,
      frameCount: FRAMES,
      layout: 'fixed',
      events: [{ time: 0.25, name: 'hit', intValue: 7 }],
      sockets: [{ name: 'hand', frames: Array.from({ length: FRAMES }, (_, frame) => socketFrame(frame)) }],
    }],
    compatibility: { level: 'HYBRID', warnings: [], estimatedGpuBytes: 0, drawCallsPerBatch: 1 },
  };
  data.setManifest(manifest);
  Object.assign(data, {
    positionPages: [new BufferAsset(new ArrayBuffer(texels * 16))],
    lightPages: [],
    darkPages: [],
    atlasPages: [new Texture2D()],
    effectAsset: new EffectAsset(),
  });
  return data;
}

/** 推进引擎时间并跑一帧 update。 */
function step(skeleton: SpineVatSkeleton, seconds: number): void {
  runtime.time += seconds;
  skeleton.update();
}

describe('SpineVatSkeleton 事件监听', () => {
  it('加载完成前注册的监听不丢，reload 后仍然有效', async () => {
    runtime.time = 0;
    const skeleton = new SpineVatSkeleton();
    const received: string[] = [];
    const off = skeleton.onVatEvent((event) => received.push(event.name)); // 此时还没有 handle
    skeleton.skeletonData = createData();
    await skeleton.reload();
    step(skeleton, 0.3);
    expect(received).toEqual(['hit']);

    await skeleton.reload(); // handle 重建
    step(skeleton, 0.3);
    expect(received).toEqual(['hit', 'hit']);

    off();
    step(skeleton, 1);
    expect(received).toHaveLength(2);
  });

  it('socket / snapshot 走当前 handle', async () => {
    runtime.time = 0;
    const skeleton = new SpineVatSkeleton();
    expect(skeleton.snapshot()).toBeNull();
    skeleton.skeletonData = createData();
    await skeleton.reload();
    runtime.time = 0.35;
    expect(skeleton.snapshot()).toMatchObject({ clip: 'idle', frame: 3 });
    expect(skeleton.socket('hand')).toEqual(socketFrame(3));
  });
});

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
      executeInEditMode: identityDecorator,
      menu: identityDecorator,
      playOnFocus: identityDecorator,
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
      Format: { RGB32F: 1, RGBA32F: 2, RGBA8: 3, R8: 4, L8: 5 },
    },
    ImageAsset,
    js: { getClassByName: () => null },
    Material,
    Mesh: class {},
    MeshRenderer: class {},
    Node,
    setPropertyEnumType: () => undefined,
    Texture2D,
    Vec3: class {},
    Vec4,
  };
});

vi.mock('../../../../extensions/spine-vat-importer/assets/runtime/SpineVatUiLane', () => ({
  SLOT_SHIFT: 16384,
  SpineVatUiLane: class {
    init(): void {}
  },
}));

import { BufferAsset, EffectAsset, Texture2D } from 'cc';
import type { SpineVatManifest, SpineVatSocketMatrix } from '../../../../extensions/spine-vat-importer/assets/runtime/SpineVatSchema';
import { SpineVatSkeletonData } from '../../../../extensions/spine-vat-importer/assets/runtime/SpineVatSkeletonData';
import { SpineVatUiSkeleton } from '../../../../extensions/spine-vat-importer/assets/runtime/SpineVatUiSkeleton';

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
    uiEffectAsset: new EffectAsset(),
  });
  return data;
}

function createSkeleton(): SpineVatUiSkeleton {
  runtime.time = 0;
  const skeleton = new SpineVatUiSkeleton();
  skeleton.skeletonData = createData();
  return skeleton;
}

/** 推进引擎时间并跑一帧 update。 */
function step(skeleton: SpineVatUiSkeleton, seconds: number): void {
  runtime.time += seconds;
  skeleton.update();
}

describe('SpineVatUiSkeleton 事件 / socket / snapshot', () => {
  it('未加载时 snapshot / socket 返回 null，onVatEvent 仍可注册', () => {
    const skeleton = new SpineVatUiSkeleton();
    expect(skeleton.snapshot()).toBeNull();
    expect(skeleton.socket('hand')).toBeNull();
    expect(typeof skeleton.onVatEvent(() => undefined)).toBe('function');
    expect(() => skeleton.update()).not.toThrow();
  });

  it('snapshot 反映当前 clip、帧与播放状态', () => {
    const skeleton = createSkeleton();
    runtime.time = 0.45;
    expect(skeleton.snapshot()).toMatchObject({ clip: 'idle', frame: 4, loop: true, speed: 1, paused: false });
    skeleton.pause();
    runtime.time = 0.9;
    expect(skeleton.snapshot()).toMatchObject({ frame: 4, paused: true });
    skeleton.setManualFrame(7);
    expect(skeleton.snapshot()).toMatchObject({ frame: 7, manualFrame: 7 });
  });

  it('socket 按当前离散帧取矩阵，未知名字返回 null', () => {
    const skeleton = createSkeleton();
    runtime.time = 0.35;
    expect(skeleton.socket('hand')).toEqual(socketFrame(3));
    runtime.time = 1.25; // 循环回第 2 帧
    expect(skeleton.socket('hand')).toEqual(socketFrame(2));
    expect(skeleton.socket('missing')).toBeNull();
  });

  it('onVatEvent 在越过事件时刻时派发，取消订阅后不再收到', () => {
    const skeleton = createSkeleton();
    const received: string[] = [];
    const off = skeleton.onVatEvent((event) => received.push(`${event.clip}:${event.name}:${event.intValue}`));
    step(skeleton, 0.2);
    expect(received).toEqual([]);
    step(skeleton, 0.1);
    expect(received).toEqual(['idle:hit:7']);
    step(skeleton, 1); // 下一圈又越过一次
    expect(received).toHaveLength(2);
    off();
    step(skeleton, 1);
    expect(received).toHaveLength(2);
  });

  it('没有监听时游标照常推进：后加的监听不会收到积压事件', () => {
    const skeleton = createSkeleton();
    for (let i = 0; i < 50; i += 1) step(skeleton, 0.1); // 5 圈、5 次事件，无人监听
    const received: string[] = [];
    skeleton.onVatEvent((event) => received.push(event.name));
    step(skeleton, 0.1);
    expect(received).toEqual([]); // 当前在 0.0 → 0.1 之间，未越过 0.25
    step(skeleton, 0.2);
    expect(received).toEqual(['hit']);
  });

  it('重建（换 initialClip）后监听保留', () => {
    const skeleton = createSkeleton();
    const received: string[] = [];
    skeleton.onVatEvent((event) => received.push(event.name));
    skeleton.initialClipIndex = 1; // 选中 idle → 重建
    step(skeleton, 0.3);
    expect(received).toEqual(['hit']);
  });
});

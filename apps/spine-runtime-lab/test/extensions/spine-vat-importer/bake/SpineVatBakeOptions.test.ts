import { describe, expect, it } from 'vitest';
import { assertBakeOptions, bakeDefaultsFromManifest, type SpineVatBakeOptions } from '../../../../extensions/spine-vat-importer/bake/src/SpineVatBakeOptions';

const fallback: SpineVatBakeOptions = { frameRate: 30, animations: ['idle', 'run', 'hit'], socketNames: [] };
const skeleton = { animations: ['idle', 'run', 'hit'], bones: ['root', 'hand', 'head'] };

function manifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    format: 'spine-vat-2',
    alphaMode: 'premultiplied',
    clips: [
      { name: 'run', fps: 60, sockets: [{ name: 'head', frames: [] }] },
      { name: 'idle', fps: 60, sockets: [{ name: 'hand', frames: [] }, { name: 'head', frames: [] }] },
    ],
    ...overrides,
  };
}

describe('bakeDefaultsFromManifest', () => {
  it('没有旧 manifest 时用 fallback', () => {
    expect(bakeDefaultsFromManifest(null, fallback, skeleton)).toEqual({ options: fallback, dropped: [] });
    expect(bakeDefaultsFromManifest({ format: 'other' }, fallback, skeleton).options).toEqual(fallback);
  });

  it('读回帧率、动画与 socket 并集，按骨架顺序排', () => {
    expect(bakeDefaultsFromManifest(manifest(), fallback, skeleton)).toEqual({
      options: { frameRate: 60, animations: ['idle', 'run'], socketNames: ['hand', 'head'] },
      dropped: [],
    });
  });

  it('骨架里已经没有的动画和骨骼丢掉并列出来', () => {
    const result = bakeDefaultsFromManifest(
      manifest({ clips: [{ name: 'gone', fps: 30 }, { name: 'idle', fps: 30, sockets: [{ name: 'tail', frames: [] }] }] }),
      fallback,
      skeleton,
    );
    expect(result.options.animations).toEqual(['idle']);
    expect(result.options.socketNames).toEqual([]);
    expect(result.dropped).toEqual(['gone', 'tail']);
  });

  it('非法字段回落到 fallback', () => {
    const result = bakeDefaultsFromManifest(
      manifest({ clips: [{ name: 'gone', fps: 0 }] }),
      fallback,
      skeleton,
    );
    expect(result.options).toEqual(fallback);
  });
});

describe('assertBakeOptions', () => {
  it('合法参数通过，非法的写明原因', () => {
    expect(() => assertBakeOptions(fallback, skeleton)).not.toThrow();
    expect(() => assertBakeOptions({ ...fallback, animations: [] }, skeleton)).toThrow('至少选一段动画');
    expect(() => assertBakeOptions({ ...fallback, frameRate: 0 }, skeleton)).toThrow('帧率');
    expect(() => assertBakeOptions({ ...fallback, socketNames: ['tail'] }, skeleton)).toThrow('tail');
  });
});

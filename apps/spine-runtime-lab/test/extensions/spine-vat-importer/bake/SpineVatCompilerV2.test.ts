import { describe, expect, it, vi } from 'vitest';

vi.mock('cc', () => ({ Node: class {}, sp: {} }));

import { compileSpineVatV2, extractSpineVatEvents } from '../../../../extensions/spine-vat-importer/bake/src/SpineVatCompilerV2';
import type { SpineVatBakeResult } from '../../../../extensions/spine-vat-importer/bake/src/SpineVatBaker';
import type { FixedBakeResult, FixedFrame, FixedKeyRange } from '../../../../extensions/spine-vat-importer/bake/src/SpineVatFixedBaker';
import type { SpineVatAnalysisReport } from '../../../../extensions/spine-vat-importer/bake/src/SpineVatTypes';

const STRIDE = 28;

function analysis(level: SpineVatAnalysisReport['compatibility']['level'] = 'LOSSLESS_VAT'): SpineVatAnalysisReport {
  return {
    format: 'spine-vat-analysis-1',
    source: {
      creator: '3.8.7',
      spineVersion: '4.2.43',
      runtimeFamily: '4.2',
      hashAlgorithm: 'FNV-1A-32',
      hashes: {},
    },
    recipe: {
      alphaMode: 'straight',
      fps: 30,
      textureProfile: 'exact',
      budget: { maxRenderLanes: 12, maxTextureBytes: 64 * 1024 * 1024, maxTextureSize: 4096 },
    },
    static: {
      spineVersion: '4.2.43',
      runtimeFamily: '4.2',
      atlasPages: [{ name: 'atlas.png', pma: false }],
      inferredAlphaMode: 'straight',
      features: {
        bones: 1,
        slots: 1,
        skins: ['default'],
        animations: ['animation'],
        attachments: { region: 1 },
        weightedMeshes: 0,
        sequences: 0,
        constraints: { ik: 0, transform: 0, path: 0, physics: 0 },
        timelines: { deform: false, attachment: false, drawOrder: false, events: false, twoColor: false },
        blendModes: ['normal'],
      },
      warnings: [],
    },
    clips: [],
    compatibility: { level, warnings: [], estimatedGpuBytes: 0, drawCallsPerBatch: 1 },
  };
}

/** keys: [键, 顶点数, 贴图]；每个键一个三角形 0,1,2；顶点 x = 键序号 * 10 + 顶点号。 */
function frame(keys: Array<[string, number, string?]>): FixedFrame {
  const vertexCount = keys.reduce((sum, [, count]) => sum + count, 0);
  const vertices = new Uint8Array(vertexCount * STRIDE);
  const view = new DataView(vertices.buffer);
  const indices: number[] = [];
  const ranges: FixedKeyRange[] = [];
  let vertexStart = 0;
  keys.forEach(([key, count, textureId = 'atlas-0'], order) => {
    for (let vertex = 0; vertex < count; vertex += 1) {
      const at = (vertexStart + vertex) * STRIDE;
      view.setFloat32(at, order * 10 + vertex, true);
      view.setFloat32(at + 12, 0.5, true);
      vertices.fill(255, at + 20, at + 24);
    }
    ranges.push({
      key, slot: order, vertexStart, vertexCount: count, indexStart: indices.length, indexCount: 3,
      textureId, blendMode: 0, clip: null,
    });
    indices.push(vertexStart, vertexStart + 1, vertexStart + 2);
    vertexStart += count;
  });
  return {
    source: {
      time: 0, vertexCount, indexCount: indices.length, segments: [],
      vertices, indices: Uint16Array.from(indices),
    },
    keys: ranges,
    clips: new Map(),
  };
}

/** 同一批帧同时当官方输出（bounds / 时长）和固定槽位烘焙结果。 */
function clip(animation: string, frames: FixedFrame[]): { bake: SpineVatBakeResult; fixed: FixedBakeResult } {
  return {
    bake: {
      animation,
      duration: frames.length / 30,
      frameRate: 30,
      frames: frames.map((entry) => entry.source),
      stableVertexLayout: true,
      stableIndices: true,
      stableSegments: true,
      stableTopology: true,
      mismatchFrames: [],
      sockets: [],
    },
    fixed: { animation, frames },
  };
}

function compile(
  clips: Array<ReturnType<typeof clip>>,
  atlasIds = ['atlas-0'],
  report = analysis(),
  options: Parameters<typeof compileSpineVatV2>[4] = {},
): ReturnType<typeof compileSpineVatV2> {
  return compileSpineVatV2(clips.map((entry) => entry.bake), clips.map((entry) => entry.fixed), atlasIds, report, options);
}

describe('SpineVatCompilerV2', () => {
  it('所有动画共用一个固定 layout，帧区间连续，末尾一帧是静态区', () => {
    const result = compile([
      clip('idle', [frame([['0/a', 4]]), frame([['0/a', 4]])]),
      clip('win', [frame([['0/a', 4]]), frame([['0/a', 4]]), frame([['0/a', 4], ['1/b', 3]])]),
    ]);
    const { layouts, clips } = result.manifest;
    expect(layouts).toHaveLength(1);
    expect(layouts[0].id).toBe('fixed');
    expect(layouts[0].staticFrame).toBe(5);
    expect(layouts[0].lanes[0].geometryMode).toBe('indexed-stable');
    expect(layouts[0].lanes[0].indices).toEqual([0, 1, 2, 4, 5, 6]);
    expect(clips.map(({ name, frameOffset, frameCount, layout }) => ({ name, frameOffset, frameCount, layout }))).toEqual([
      { name: 'idle', frameOffset: 0, frameCount: 2, layout: 'fixed' },
      { name: 'win', frameOffset: 2, frameCount: 3, layout: 'fixed' },
    ]);
    // 静态区：7 个顶点都不受剪裁（-1）；idle 帧 0 里 b 没画出来 → uv = -1。
    const stride = layouts[0].frameStride;
    const position = result.pages[0].position;
    for (let vertex = 0; vertex < 7; vertex += 1) expect(position[(5 * stride + vertex) * 4]).toBe(-1);
    expect(position[4 * 4 + 2]).toBe(-1);
  });

  it('dark 只看 RGB：PMA 下运行时在 dark.a 写 255 作标记，RGB 全 0 时不出 dark 页', () => {
    const withDark = (rgb: number): FixedFrame => {
      const entry = frame([['0/a', 4]]);
      for (let vertex = 0; vertex < 4; vertex += 1) {
        entry.source.vertices.fill(rgb, vertex * STRIDE + 24, vertex * STRIDE + 27);
        entry.source.vertices[vertex * STRIDE + 27] = 255;
      }
      return entry;
    };
    const flagOnly = compile([clip('idle', [withDark(0), withDark(0)])]);
    expect(flagOnly.manifest.channels.dark).toBe(false);
    expect(flagOnly.pages[0].dark).toBeUndefined();
    const tinted = compile([clip('idle', [withDark(0), withDark(40)])]);
    expect(tinted.manifest.channels.dark).toBe(true);
    expect(tinted.pages[0].dark).toBeDefined();
  });

  it('有动画过不了固定槽位规则就整体拒绝，并写明原因', () => {
    expect(() => compile([
      clip('ok', [frame([['0/a', 3]])]),
      clip('swap', [frame([['0/a', 3], ['1/b', 3]]), frame([['1/b', 3], ['0/a', 3]])]),
    ])).toThrow(/swap/);
  });

  it('按贴图 id 找 atlas page', () => {
    const report = analysis();
    report.static.atlasPages = [
      { name: 'a.png', pma: false },
      { name: 'b.png', pma: false },
    ];
    const result = compile([clip('animation', [frame([['0/a', 3, 'page-a'], ['1/b', 3, 'page-b']])])], ['page-a', 'page-b'], report);
    expect(result.manifest.layouts[0].lanes.map((lane) => lane.atlasPage)).toEqual([0, 1]);
  });

  it('refuses analysis results that require runtime fallback', () => {
    expect(() => compile([clip('animation', [frame([['0/a', 3]])])], ['atlas-0'], analysis('RUNTIME_FALLBACK')))
      .toThrow(/RUNTIME_FALLBACK/);
  });

  it('extracts event values with event-definition defaults', () => {
    expect(extractSpineVatEvents({
      events: { reward: { int: 7, float: 1.5, string: 'base', audio: 'win.mp3', volume: 0.8 } },
      animations: { animation: { events: [{ time: 0.75, name: 'reward', int: 9 }] } },
    }, 'animation')).toEqual([{
      time: 0.75,
      name: 'reward',
      intValue: 9,
      floatValue: 1.5,
      stringValue: 'base',
      audioPath: 'win.mp3',
      volume: 0.8,
      balance: undefined,
    }]);
  });

  it('writes event and socket tracks to a HYBRID manifest', () => {
    const source = clip('animation', [frame([['0/a', 3]])]);
    source.bake.sockets = [{ name: 'fx', frames: [[1, 0, 0, 1, 12, 34]] }];
    const result = compile([source], ['atlas-0'], analysis('BAKED_VARIANT'), {
      socketNames: ['fx'],
      skeletonJson: {
        events: { sparkle: { string: 'gold' } },
        animations: { animation: { events: [{ time: 0.01, name: 'sparkle' }] } },
      },
    });

    expect(result.manifest.compatibility.level).toBe('HYBRID');
    expect(result.manifest.clips[0].events?.[0].stringValue).toBe('gold');
    expect(result.manifest.clips[0].sockets?.[0].frames[0]).toEqual([1, 0, 0, 1, 12, 34]);
  });
});

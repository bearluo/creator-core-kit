import { describe, expect, it, vi } from 'vitest';

vi.mock('cc', () => ({ Node: class {}, sp: {} }));

import { compileSpineVatV2, extractSpineVatEvents } from '../assets/scripts/SpineVatCompilerV2';
import type { SpineVatBakeResult, VatFrame, VatSegment } from '../assets/scripts/SpineVatBaker';
import type { SpineVatAnalysisReport } from '../assets/scripts/SpineVatTypes';

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

function frame(segments: VatSegment[], indices?: Uint16Array): VatFrame {
  const vertexCount = segments.reduce((sum, segment) => sum + segment.vertexCount, 0);
  const vertices = new Uint8Array(vertexCount * STRIDE);
  const view = new DataView(vertices.buffer);
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const offset = vertex * STRIDE;
    view.setFloat32(offset, vertex + 1, true);
    view.setFloat32(offset + 4, vertex + 2, true);
    view.setFloat32(offset + 12, vertex / Math.max(1, vertexCount), true);
    view.setFloat32(offset + 16, 0.5, true);
    vertices.fill(255, offset + 20, offset + 24);
  }
  const resolvedIndices = indices ?? Uint16Array.from({ length: vertexCount }, (_, index) => index);
  return {
    time: 0,
    vertexCount,
    indexCount: resolvedIndices.length,
    segments,
    vertices,
    indices: resolvedIndices,
  };
}

function bake(frames: VatFrame[], animation = 'animation'): SpineVatBakeResult {
  return {
    animation,
    duration: frames.length / 30,
    frameRate: 30,
    frames,
    stableVertexLayout: false,
    stableIndices: false,
    stableSegments: false,
    stableTopology: false,
    mismatchFrames: [1],
    sockets: [],
  };
}

describe('SpineVatCompilerV2', () => {
  it('为多个动画生成互不重叠的连续帧区间', () => {
    const segment: VatSegment = {
      vertexCount: 3,
      indexCount: 3,
      blendMode: 0,
      textureId: 'atlas-0',
    };
    const result = compileSpineVatV2([
      bake([frame([segment]), frame([segment])], 'idle'),
      bake([frame([segment]), frame([segment]), frame([segment])], 'win'),
    ], ['atlas-0'], analysis());

    expect(result.manifest.clips.map((clip) => ({
      name: clip.name,
      frameOffset: clip.frameOffset,
      frameCount: clip.frameCount,
    }))).toEqual([
      { name: 'idle', frameOffset: 0, frameCount: 2 },
      { name: 'win', frameOffset: 2, frameCount: 3 },
    ]);
  });

  it('builds a render-lane supersequence and leaves absent lanes degenerate', () => {
    const normal = (textureId = 'atlas-0'): VatSegment => ({
      vertexCount: 3,
      indexCount: 3,
      blendMode: 0,
      textureId,
    });
    const additive = (): VatSegment => ({
      vertexCount: 3,
      indexCount: 3,
      blendMode: 1,
      textureId: 'atlas-0',
    });
    const result = compileSpineVatV2(
      [bake([frame([normal(), additive(), normal()]), frame([additive(), normal()])])],
      ['atlas-0'],
      analysis(),
      { maxTextureSize: 3 },
    );

    expect(result.manifest.layouts[0].lanes).toHaveLength(3);
    expect(result.manifest.compatibility.drawCallsPerBatch).toBe(3);
    expect(result.manifest.channels).toEqual({ light: false, dark: false });
    expect(result.pages).toHaveLength(2);
    expect(Array.from(result.pages[1].position.slice(0, 12))).toEqual(new Array(12).fill(0));
  });

  it('maps separate runtime texture ids to their atlas pages', () => {
    const segments: VatSegment[] = [
      { vertexCount: 3, indexCount: 3, blendMode: 0, textureId: 'page-a' },
      { vertexCount: 3, indexCount: 3, blendMode: 0, textureId: 'page-b' },
    ];
    const report = analysis();
    report.static.atlasPages = [
      { name: 'a.png', pma: false },
      { name: 'b.png', pma: false },
    ];
    const result = compileSpineVatV2([bake([frame(segments)])], ['page-a', 'page-b'], report);
    expect(result.manifest.layouts[0].lanes.map((lane) => lane.atlasPage)).toEqual([0, 1]);
  });

  it('splits a triangle-soup lane without cutting a triangle', () => {
    const indexCount = 65538;
    const indices = Uint16Array.from({ length: indexCount }, (_, index) => index % 3);
    const source = frame([{
      vertexCount: 3,
      indexCount,
      blendMode: 0,
      textureId: 'atlas-0',
    }], indices);
    const result = compileSpineVatV2(
      [bake([source])],
      ['atlas-0'],
      analysis(),
      { maxTextureSize: 256 },
    );
    expect(result.manifest.layouts[0].lanes.map((lane) => lane.vertexCapacity)).toEqual([65535, 3]);
    expect(result.manifest.layouts[0].lanes.every((lane) => lane.vertexCapacity % 3 === 0)).toBe(true);
  });

  it('refuses analysis results that require runtime fallback', () => {
    expect(() => compileSpineVatV2(
      [bake([frame([{ vertexCount: 3, indexCount: 3, blendMode: 0, textureId: 'atlas-0' }])])],
      ['atlas-0'],
      analysis('RUNTIME_FALLBACK'),
    )).toThrow(/RUNTIME_FALLBACK/);
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
    const source = bake([frame([{ vertexCount: 3, indexCount: 3, blendMode: 0, textureId: 'atlas-0' }])]);
    source.sockets = [{ name: 'fx', frames: [[1, 0, 0, 1, 12, 34]] }];
    const result = compileSpineVatV2([source], ['atlas-0'], analysis('BAKED_VARIANT'), {
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

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  analyzeSpineJson,
  buildClipAnalysis,
  DEFAULT_SPINE_VAT_BUDGET,
  mergeMaterialSequences,
} from '../../../../extensions/spine-vat-importer/bake/src/SpineVatAnalyzerCore';
import type { SpineVatFrameProbe } from '../../../../extensions/spine-vat-importer/bake/src/SpineVatTypes';

const appRoot = resolve(import.meta.dirname, '../../../..');

function readJson(relativePath: string): Record<string, any> {
  return JSON.parse(readFileSync(resolve(appRoot, relativePath), 'utf8')) as Record<string, any>;
}

function readText(relativePath: string): string {
  return readFileSync(resolve(appRoot, relativePath), 'utf8');
}

function frame(
  index: number,
  segments: SpineVatFrameProbe['segments'],
  vertexCount: number,
  indexHash: string,
): SpineVatFrameProbe {
  return {
    frame: index,
    time: index / 60,
    vertexCount,
    indexCount: segments.reduce((sum, segment) => sum + segment.indexCount, 0),
    indexHash,
    uvHash: 'uv',
    lightHash: 'light',
    darkHash: 'dark',
    lightAllWhite: true,
    darkAllZero: true,
    segments,
  };
}

describe('SpineVatAnalyzerCore', () => {
  it('识别 Spine 4.2 clipping、mesh、动画时间线和 atlas', () => {
    const result = analyzeSpineJson(
      readJson('assets/resources/spine/nanwuzhe/letsparty_tuan_nanwuzhe_cliptest.json'),
      readText('assets/resources/spine/nanwuzhe/letsparty_tuan_nanwuzhe.atlas'),
    );

    expect(result.spineVersion).toBe('4.2.43');
    expect(result.runtimeFamily).toBe('4.2');
    expect(result.atlasPages.map((page) => page.name)).toEqual(['letsparty_tuan_nanwuzhe.png']);
    expect(result.inferredAlphaMode).toBe('unknown');
    expect(result.features.attachments.clipping).toBe(1);
    expect(result.features.attachments.mesh).toBeGreaterThan(0);
    expect(result.features.timelines.attachment).toBe(true);
    expect(result.features.timelines.drawOrder).toBe(false);
  });

  it('将 Spine 3.8 标成独立 worker，并保留约束统计', () => {
    const result = analyzeSpineJson({
      skeleton: { spine: '3.8.99' },
      bones: [{ name: 'root' }],
      ik: [{ name: 'a' }, { name: 'b' }],
      transform: [{ name: 'c' }],
    }, 'page.png\nsize:4,4\n');

    expect(result.runtimeFamily).toBe('3.8');
    expect(result.features.constraints.ik).toBe(2);
    expect(result.features.constraints.transform).toBe(1);
    expect(result.warnings.some((warning) => warning.includes('Spine 4.2'))).toBe(true);
  });

  it('构造确定性的材质公共超序列', () => {
    const lanes = mergeMaterialSequences(
      ['page/normal', 'page/additive', 'page/normal'],
      ['page/additive', 'page/normal'],
    );
    expect(lanes).toEqual(['page/normal', 'page/additive', 'page/normal']);
  });

  it('变化拓扑使用 triangle soup，并把重复材质映射到不同 lane', () => {
    const staticAnalysis = analyzeSpineJson({
      skeleton: { spine: '4.2.43' },
      bones: [{}],
      slots: [{ name: 'slot' }],
      skins: [{ name: 'default', attachments: {} }],
      animations: { idle: {} },
    }, 'page.png\npma: false\n');
    const normal = { textureId: 'page', blendMode: 'normal' as const, vertexCount: 4, indexCount: 6 };
    const additive = { textureId: 'page', blendMode: 'additive' as const, vertexCount: 4, indexCount: 6 };
    const frames = [
      frame(0, [normal, additive, normal], 12, 'indices-a'),
      frame(1, [additive, normal], 8, 'indices-b'),
    ];
    const result = buildClipAnalysis(
      'idle',
      1,
      60,
      frames,
      staticAnalysis,
      'straight',
      'balanced',
      DEFAULT_SPINE_VAT_BUDGET,
    );

    expect(result.geometryMode).toBe('triangle-soup-dynamic');
    expect(result.lanes.map((lane) => lane.blendMode)).toEqual(['normal', 'additive', 'normal']);
    expect(result.lanes.every((lane) => lane.vertexCapacity === 6)).toBe(true);
    expect(result.estimatedTexturePages).toBe(1);
    expect(result.lightAllWhite).toBe(true);
    expect(result.darkAllZero).toBe(true);
  });

  it('alpha mode 不明确时硬回退 Runtime', () => {
    const staticAnalysis = analyzeSpineJson({
      skeleton: { spine: '4.2.43' },
      bones: [{}],
      slots: [{}],
      skins: [{ name: 'default', attachments: {} }],
      animations: { idle: {} },
    }, 'page.png\nsize: 16,16\n');
    const normal = { textureId: 'page', blendMode: 'normal' as const, vertexCount: 4, indexCount: 6 };
    const result = buildClipAnalysis(
      'idle',
      1,
      30,
      [frame(0, [normal], 4, 'indices')],
      staticAnalysis,
      'unknown',
      'balanced',
      DEFAULT_SPINE_VAT_BUDGET,
    );

    expect(result.compatibility).toBe('RUNTIME_FALLBACK');
    expect(result.warnings.some((warning) => warning.includes('Alpha mode'))).toBe(true);
  });
});

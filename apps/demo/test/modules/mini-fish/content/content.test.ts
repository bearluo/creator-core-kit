import { describe, expect, it } from 'vitest';
import { CONTENT, type FishWave } from '../../../../assets/modules/mini-fish/content/content';
import { FISH_KINDS } from '../../../../assets/modules/mini-fish/content/fish-kinds';

/**
 * 内容自检 —— **不是**生成物闸。
 *
 * `content.ts` 的源和产物是同一个文件（编辑器读它、人贴回它），没有第二份源要同步，
 * 所以 `--check` 那种闸挡的是不会发生的事（判据同 `mini-hop` 的 `level.ts`）。真正会坏的是
 * **跨表引用**和**数值范围** —— 人手贴回、手改、git 冲突解错的时候，而 `as const` + `typecheck`
 * 恰好覆盖不到这两样。所以用一条断言，让坏内容在 CI 当场红，而不是玩到那一阵才炸。
 */
describe('content.ts 内容自检', () => {
  const pathIds = new Set<string>(CONTENT.paths.map((p) => p.id));
  const kindIds = new Set<string>(FISH_KINDS.map((k) => k.id));
  // 放宽成接口类型再遍历：`as const` 让省略了 `gap` 的 group 连这个属性都没有，
  // 而自检问的正是「省略时当 0 算合不合法」。
  const waves: readonly FishWave[] = CONTENT.waves;

  it('路径 id 唯一，每条 8 个控制点', () => {
    expect(pathIds.size).toBe(CONTENT.paths.length);
    for (const p of CONTENT.paths) expect(p.p).toHaveLength(8);
  });

  it('鱼阵 id 唯一，且每阵至少一个 group', () => {
    const waveIds = new Set<string>(waves.map((w) => w.id));
    expect(waveIds.size).toBe(waves.length);
    for (const w of waves) expect(w.groups.length).toBeGreaterThan(0);
  });

  it('每个 group 的 path / kind 都解析得到', () => {
    for (const w of waves) {
      for (const g of w.groups) {
        expect(pathIds.has(g.path), `鱼阵 ${w.id} 引用了未知路径 ${g.path}`).toBe(true);
        expect(kindIds.has(g.kind), `鱼阵 ${w.id} 引用了未知鱼种 ${g.kind}`).toBe(true);
      }
    }
  });

  it('数值在合法范围：count ≥ 1、gap ≥ 0、speed > 0、at ≥ 0', () => {
    for (const w of waves) {
      for (const g of w.groups) {
        expect(g.count).toBeGreaterThanOrEqual(1);
        expect(g.gap ?? 0).toBeGreaterThanOrEqual(0);
        expect(g.speed).toBeGreaterThan(0);
        expect(g.at).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('rev 是正整数 —— 它是「发布过一次」的编号，编辑器每次导出 +1', () => {
    expect(Number.isInteger(CONTENT.rev)).toBe(true);
    expect(CONTENT.rev).toBeGreaterThan(0);
  });
});

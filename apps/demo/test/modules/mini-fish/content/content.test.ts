import { describe, expect, it } from 'vitest';
import { CONTENT } from '../../../../assets/modules/mini-fish/content/content';
import type { FishWave } from '../../../../assets/modules/mini-fish/content/content-types';
import { FISH_KINDS } from '../../../../assets/modules/mini-fish/content/fish-kinds';
import {
  MIN_HANDLE,
  PATHS,
  pointAt,
  segmentCount,
} from '../../../../assets/modules/mini-fish/content/paths';

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

  it('路径 id 唯一，控制点数是 6n+2（n 段贝塞尔，相邻段共享接点）', () => {
    expect(pathIds.size).toBe(CONTENT.paths.length);
    for (const p of CONTENT.paths) {
      expect(p.p.length, `路径 ${p.id} 的控制点数 ${p.p.length} 不是 6n+2`).toBeGreaterThanOrEqual(8);
      expect((p.p.length - 2) % 6, `路径 ${p.id} 的控制点数 ${p.p.length} 不是 6n+2`).toBe(0);
    }
  });

  /**
   * 「鱼恒速前进」这个性质**直接测它本身**，不靠注释担保。
   *
   * 这条闸是有来历的：改造之前 `PathFollow.t` 被当**弧长比例**推进、而 `pointAt` 按**贝塞尔参数**
   * 求值，两者不是一回事 —— `loop-left` 实测快慢比 **4.01×**，那条鲨鱼一直在忽快忽慢。没人发现，
   * 因为只有那一条路够弯，其余是控制点等距的直路（参数 ≈ 弧长）。担保它的只有一行注释，
   * 而注释拦不住任何东西。
   *
   * 阈值 1.05：查找表每段 128 采样时最弯那条实测 1.017×，留了三倍余量；采样再疏就会顶到阈值
   * （32 段 → 1.093× 直接红）。
   */
  it('每条路径都真恒速 —— 按弧长均匀采样，相邻点距离的快慢比 ≤ 1.05', () => {
    const N = 200;
    for (const path of PATHS) {
      const step: number[] = [];
      let prev = pointAt(path, 0);
      for (let i = 1; i <= N; i++) {
        const q = pointAt(path, i / N);
        step.push(Math.hypot(q.x - prev.x, q.y - prev.y));
        prev = q;
      }
      const ratio = Math.max(...step) / Math.min(...step);
      expect(ratio, `路径下标 ${PATHS.indexOf(path)} 的快慢比 ${ratio.toFixed(3)}× 超了`).toBeLessThanOrEqual(1.05);
    }
  });

  /**
   * 手柄不许贴到锚点上：P1 压在 P0 上时贝塞尔导数 `3(P1−P0)` 退化成 0，`angleAt` 那道守卫
   * 返回 0 ⇒ 鱼游到那儿**突然朝右**，不崩、不报错，最难查的一类。
   *
   * 编辑器拖拽时会夹紧，但这条闸挡的是**另一条进来的路**：`content.ts` 是人手贴回的文件，
   * 手改、合并冲突解错都可能造出零长手柄。
   */
  it('每个手柄离它的锚点都不近于 MIN_HANDLE', () => {
    for (const it2 of CONTENT.paths) {
      const p = it2.p;
      for (let k = 0; k < segmentCount(p); k++) {
        const b = k * 6;
        // 段内四个点：锚点 b、手柄 b+2、手柄 b+4、锚点 b+6
        for (const [a, h] of [
          [b, b + 2],
          [b + 6, b + 4],
        ] as const) {
          const d = Math.hypot(p[h] - p[a], p[h + 1] - p[a + 1]);
          expect(d, `路径 ${it2.id} 第 ${k + 1} 段有个手柄离锚点只有 ${d.toFixed(1)}`).toBeGreaterThanOrEqual(MIN_HANDLE);
        }
      }
    }
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

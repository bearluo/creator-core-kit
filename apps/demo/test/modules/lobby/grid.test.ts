import { describe, expect, it } from 'vitest';
import { gridLayout, type GridInput } from '../../../assets/modules/lobby/grid';

/**
 * 大厅入口的排布 —— 真实参数是 `LobbyItem.prefab` 的 360×66 + `LobbyHost` 的 24/14 间距，
 * 可用区取 base 皮在 1080×1920 / 1920×1080 下算出来的那两块。改了间距或条目尺寸这里会红。
 */
const ITEM = { itemW: 360, itemH: 66, gapX: 24, gapY: 14 };
/** 竖屏 1080×1920：宽去掉两侧留白，高从「prefab 指定的列表上沿」到屏幕底部留白。 */
const PORTRAIT = { availW: 1000, availH: 1013, horizontal: false };
/** 横屏 1920×1080：上沿同一个（93），底部 -500。 */
const LANDSCAPE = { availW: 1840, availH: 593, horizontal: true };

const layout = (over: Partial<GridInput> & { count: number }) =>
  gridLayout({ ...ITEM, ...PORTRAIT, ...over } as GridInput);

describe('竖屏：先填满一行再往下，上下滚', () => {
  it('1080 宽排得下两列 —— 十个入口是 5 行 2 列', () => {
    const g = layout({ count: 10 });
    expect([g.cols, g.rows]).toEqual([2, 5]);
    expect([g.contentW, g.contentH]).toEqual([24 + 2 * 384, 14 + 5 * 80]);
  });

  it('行优先：第二个在第一个**右边**，第三个才换行', () => {
    const g = layout({ count: 10 });
    expect(g.slots[1].y).toBe(g.slots[0].y);
    expect(g.slots[1].x).toBeGreaterThan(g.slots[0].x);
    expect(g.slots[2].x).toBe(g.slots[0].x);
    expect(g.slots[2].y).toBeLessThan(g.slots[0].y); // y 向下为负
  });

  it('装得下就不滚：视口贴着内容收窄，不留一大片空白', () => {
    const g = layout({ count: 10 });
    expect(g.viewH).toBe(g.contentH); // 414 < 1013
    expect(g.viewW).toBe(g.contentW);
  });

  it('装不下才滚：视口被可用区截断，差值就是能滚的距离', () => {
    const g = layout({ count: 30 }); // 15 行 = 1214 > 1013
    expect(g.viewH).toBe(PORTRAIT.availH);
    expect(g.contentH).toBeGreaterThan(g.viewH);
    expect(g.viewW).toBe(g.contentW); // 横向仍装得下 → 不横滚
  });
});

describe('横屏：先填满一列再往右，左右滚', () => {
  it('1080 高排得下七行 —— 十个入口是 7 行 2 列（现在就放得下，不用滚）', () => {
    const g = layout({ count: 10, ...LANDSCAPE });
    expect([g.cols, g.rows]).toEqual([2, 7]);
    expect(g.viewH).toBe(g.contentH);
    expect(g.viewW).toBe(g.contentW);
  });

  it('列优先：第二个在第一个**下面**，排满一列才换列', () => {
    const g = layout({ count: 10, ...LANDSCAPE });
    expect(g.slots[1].x).toBe(g.slots[0].x);
    expect(g.slots[1].y).toBeLessThan(g.slots[0].y);
    expect(g.slots[7].x).toBeGreaterThan(g.slots[0].x); // 第 8 个开第二列
    expect(g.slots[7].y).toBe(g.slots[0].y);
  });

  it('列多到超出屏宽才横滚', () => {
    const g = layout({ count: 40, ...LANDSCAPE }); // 6 列 = 2328 > 1840
    expect(g.viewW).toBe(LANDSCAPE.availW);
    expect(g.contentW).toBeGreaterThan(g.viewW);
    expect(g.viewH).toBe(g.contentH); // 纵向排得下 → 不竖滚
  });
});

describe('边界', () => {
  it('没有条目就是空的（不做除零）', () => {
    const g = layout({ count: 0 });
    expect(g).toMatchObject({ cols: 0, rows: 0, contentW: 0, contentH: 0, slots: [] });
  });

  it('条目比排得下的还少：不撑出空行空列', () => {
    const g = layout({ count: 1 });
    expect([g.cols, g.rows]).toEqual([1, 1]);
    const g2 = layout({ count: 3, ...LANDSCAPE });
    expect([g2.cols, g2.rows]).toEqual([1, 3]); // 排得下 7 行，只有 3 个 → 就 3 行
  });

  it('可用区比一个条目还窄也至少排一列 —— 那条轴跟着滚，不是把条目叠成一堆', () => {
    const g = layout({ count: 5, availW: 100 });
    expect(g.cols).toBe(1);
    expect(g.viewW).toBe(100);
    expect(g.contentW).toBeGreaterThan(g.viewW);
  });

  it('每个条目都落在 content 里 —— 排出界的话滚到头也看不见它', () => {
    for (const over of [{ count: 10 }, { count: 30 }, { count: 10, ...LANDSCAPE }]) {
      const g = layout(over);
      for (const s of g.slots) {
        expect(s.x - ITEM.itemW / 2).toBeGreaterThanOrEqual(0);
        expect(s.x + ITEM.itemW / 2).toBeLessThanOrEqual(g.contentW);
        expect(-s.y - ITEM.itemH / 2).toBeGreaterThanOrEqual(0);
        expect(-s.y + ITEM.itemH / 2).toBeLessThanOrEqual(g.contentH);
      }
    }
  });
});

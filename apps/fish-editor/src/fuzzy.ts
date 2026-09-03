/**
 * 模糊匹配 —— 下拉里挑路径 / 鱼种用。**纯函数，node 直跑**（View 里只有一句调用）。
 *
 * 判据是「**子序列**命中」而不是 `includes`：路径 id 是 `cross-rl-high` 这种连字符串，
 * 敲 `crh` 要能中，`includes` 一个都中不了。同时给完整子串更高的分 —— 敲 `rl` 的人
 * 想要的是 `cross-rl-high`，不是碰巧字母凑齐的那条。
 */

/**
 * `text` 对 `query` 的得分。**没命中返回 `null`**（0 是合法得分，不能拿它当「没中」）。
 *
 * 四档，高的先出：整条相等 → 前缀 → 含完整子串（越靠前越高）→ 子序列（跨度越小越高）。
 * 大小写一律折成小写：id 全是小写，让人敲大写也能中。
 */
export function fuzzyScore(text: string, query: string): number | null {
  const t = text.toLowerCase();
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  if (t === q) return 1000;
  if (t.startsWith(q)) return 800 - t.length;
  const at = t.indexOf(q);
  if (at >= 0) return 600 - at * 4 - t.length;

  // 子序列：逐字去找下一个，找不到就是没中。跨度 = 首末命中之间的距离，越紧凑越像人要的那个。
  let i = 0;
  let first = -1;
  let last = -1;
  for (const c of q) {
    const k = t.indexOf(c, i);
    if (k < 0) return null;
    if (first < 0) first = k;
    last = k;
    i = k + 1;
  }
  return 300 - (last - first) - t.length;
}

/**
 * 命中的选项，按得分降序。**同分保持原序** —— 原序是人排的（鱼种表按倍率、路径按编的顺序），
 * 洗掉它下拉每次开都换个样子。空查询原样返回。
 */
export function fuzzyFilter(options: readonly string[], query: string): string[] {
  if (!query.trim()) return options.slice();
  return options
    .map((o, i) => ({ o, i, s: fuzzyScore(o, query) }))
    .filter((it): it is { o: string; i: number; s: number } => it.s !== null)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((it) => it.o);
}

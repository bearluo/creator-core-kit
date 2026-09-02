/**
 * 捕鱼的内容数据：路径几何 + 鱼阵编排。
 *
 * ⚠️ **这个文件是编辑器导出的全文**（`apps/fish-editor`：复制 → 人 `Ctrl+V` 覆盖 → `git diff`
 * 看得见改了什么）。别往里写说明或手写代码 —— 下一次导出会整份盖掉。字段含义、为什么这么设计、
 * 联网之后怎么办，都在 `content-types.ts` 和
 * `docs/design/2026-08-31-mini-fish-content-editor.md`。
 *
 * `rev` 只在**导出**时 +1：它是「这份内容被发布过一次」的编号，不是操作计数。
 */
import type { FishContent } from './content-types';

export const CONTENT = {
  rev: 1,
  paths: [
    { id: 'cross-lr', p: [-1160, 0, -400, 0, 400, 0, 1160, 0] },
    { id: 'cross-rl-high', p: [1160, 260, 400, 260, -400, 260, -1160, 260] },
    { id: 'diag-up', p: [-1160, -420, -400, -200, 400, 200, 1160, 420] },
    { id: 'diag-down', p: [1160, 420, 400, 200, -400, -200, -1160, -420] },
    { id: 'wave-lr', p: [-1160, -300, -400, 600, 400, -600, 1160, 300] },
    { id: 'wave-rl', p: [1160, -300, 400, 600, -400, -600, -1160, 300] },
    { id: 'rise', p: [-300, -740, -300, -200, -300, 200, -300, 740] },
    { id: 'loop-left', p: [-1160, -200, 600, -700, 600, 700, -1160, 200] },
  ],
  waves: [
    {
      id: 'yellow-cross',
      groups: [
        { at: 0, path: 'cross-lr', kind: 'fish_yellow', count: 8, gap: 0.3, speed: 120 },
      ],
    },
    {
      id: 'red-cross',
      groups: [
        { at: 0, path: 'diag-up', kind: 'fish_red', count: 6, gap: 0.35, speed: 130 },
        { at: 0.8, path: 'diag-down', kind: 'fish_bigred', count: 3, gap: 0.5, speed: 130 },
      ],
    },
    {
      id: 'hetun-escort',
      groups: [
        { at: 0, path: 'wave-lr', kind: 'fish_hetun', count: 1, speed: 80 },
        { at: 0.6, path: 'wave-lr', kind: 'fish_yellow', count: 5, gap: 0.25, speed: 95 },
      ],
    },
    {
      id: 'shark-pass',
      groups: [
        { at: 0, path: 'loop-left', kind: 'fish_shayu', count: 1, speed: 70 },
        { at: 1.5, path: 'rise', kind: 'fish_denglongyu', count: 4, gap: 0.4, speed: 110 },
      ],
    },
  ],
} as const satisfies FishContent;

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
  rev: 3,
  paths: [
    { id: 'cross-lr', p: [-1160, 0, -400, 0, 400, 0, 1160, 0] },
    { id: 'cross-rl-high', p: [1160, 260, 400, 260, -400, 260, -1160, 260] },
    { id: 'diag-up', p: [-1160, -420, -400, -200, 400, 200, 1160, 420] },
    { id: 'diag-down', p: [1160, 420, 400, 200, -400, -200, -1160, -420] },
    { id: 'wave-lr', p: [-1160, -140, -780, -140, -640, 300, -260, 300, 120, 300, 620, -300, 1160, -240] },
    { id: 'wave-rl', p: [1160, -140, 780, -140, 640, 300, 260, 300, -120, 300, -620, -300, -1160, -240] },
    { id: 'rise', p: [-300, -740, -300, -200, -300, 200, -300, 740] },
    { id: 'loop-left', p: [-1160, -200, 600, -700, 600, 700, -1160, 200] },
    { id: 'cross-lr-low', p: [-1160, -330, -400, -330, 400, -330, 1160, -330] },
    { id: 'dive', p: [420, 740, 420, 200, 420, -200, 420, -740] },
    { id: 'arc-top', p: [-1160, -60, -520, 640, 520, 640, 1160, -60] },
    { id: 'arc-bottom', p: [1160, 60, 520, -640, -520, -640, -1160, 60] },
    { id: 'loop-right', p: [1160, -200, -600, -700, -600, 700, 1160, 200] },
    { id: 'sweep-in', p: [1160, 420, 520, 420, 60, 300, -300, 120, -700, -80, -160, -460, 1160, -360] },
  ],
  waves: [
    {
      id: 'school-yellow',
      groups: [
        { at: 0, path: 'cross-lr-low', kind: 'fish_yellow', speed: 140, formation: [0, -52, 0, 0, 0, 52, -55, -78, -55, -26, -55, 26, -110, -52, -110, 0, -110, 52, -165, -78, -165, -26, -165, 26] },
        { at: 1.4, path: 'cross-rl-high', kind: 'fish_yellow', speed: 130, formation: [0, -130, 0, -78, 0, -26, 0, 26, 0, 78, 0, 130] },
      ],
    },
    {
      id: 'red-wedge',
      groups: [
        { at: 0, path: 'diag-up', kind: 'fish_red', speed: 135, formation: [0, 0, -60, 60, -60, -60, -120, 120, -120, -120, -180, 180, -180, -180] },
        { at: 0.7, path: 'diag-down', kind: 'fish_bigred', speed: 125, formation: [0, 0, -70, 0, -140, 0] },
      ],
    },
    {
      id: 'jelly-drift',
      groups: [
        { at: 0, path: 'rise', kind: 'fish_shuimu', speed: 72, formation: [0, 0, -100, 70, -200, -60, -300, 50] },
        { at: 1.2, path: 'dive', kind: 'fish_hailuoshuimu', speed: 78, formation: [0, 0, -95, 55, -190, -50, -285, 45] },
      ],
    },
    {
      id: 'hetun-escort',
      groups: [
        { at: 0, path: 'wave-lr', kind: 'fish_hetun', speed: 88, formation: [0, 0] },
        { at: 1.2, path: 'wave-lr', kind: 'fish_yellow', speed: 88, formation: [0, -95, 0, 95, -60, -60, -60, 60, -120, -95, -120, 95, -180, -60, -180, 60] },
      ],
    },
    {
      id: 'manta-glide',
      groups: [
        { at: 0, path: 'arc-top', kind: 'fish_fuyi', speed: 95, formation: [0, -100, 0, 100, -190, -100, -190, 100] },
        { at: 1.8, path: 'arc-bottom', kind: 'fish_fuyi', speed: 95, formation: [0, 0, -190, 0] },
      ],
    },
    {
      id: 'lantern-line',
      groups: [
        { at: 0, path: 'wave-rl', kind: 'fish_denglongyu', speed: 108, formation: [0, 0, -135, 0, -270, 0, -405, 0, -540, 0] },
        { at: 2.5, path: 'cross-lr', kind: 'fish_yellow', speed: 150, formation: [0, 0, -46, 44, -46, -44, -92, 88, -92, -88, -138, 0] },
      ],
    },
    {
      id: 'ghost-hunt',
      groups: [
        { at: 0, path: 'sweep-in', kind: 'fish_gui', speed: 88, formation: [0, 0, -175, 95, -175, -95] },
        { at: 2.2, path: 'cross-rl-high', kind: 'fish_yellow', speed: 160, formation: [0, -30, 0, 30, -48, -72, -48, 0, -48, 72, -96, -30, -96, 30, -144, -72, -144, 0, -144, 72] },
      ],
    },
    {
      id: 'shark-hunt',
      groups: [
        { at: 0, path: 'loop-left', kind: 'fish_shayu', speed: 72, formation: [0, 150, -480, -160] },
        { at: 0.6, path: 'cross-lr', kind: 'fish_red', speed: 145, formation: [0, 0, -62, 62, -62, -62, -124, 124, -124, -124, -186, 62, -186, -62, -248, 0] },
      ],
    },
    {
      id: 'golden-boss',
      groups: [
        { at: 0, path: 'loop-right', kind: 'fish_jinshayu', speed: 58, formation: [0, 0] },
        { at: 2, path: 'arc-bottom', kind: 'fish_bigred', speed: 120, formation: [0, 0, -58, 58, -58, -58, -116, 116, -116, -116, -174, 0] },
        { at: 4.2, path: 'rise', kind: 'fish_denglongyu', speed: 100, formation: [0, 0, -130, 0, -260, 0, -390, 0] },
      ],
    },
  ],
} as const satisfies FishContent;

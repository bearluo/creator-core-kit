/**
 * 捕鱼的**内容**：路径几何 + 鱼阵编排。设计与判据见
 * `docs/design/2026-08-31-mini-fish-content-editor.md`。
 *
 * 这份文件是**编辑器导出的全文**（源码往返：编辑器复制 → 人 `Ctrl+V` 覆盖 → `git diff` 看得见
 * 改了什么）。它同时是**离线默认内容** —— 联网之后整份由服务端下发（决策 D2：客户端自己随机 =
 * 外挂能预知下一波），那时 `waveFeeder` / `randomFeeder` 一起下线，但这份不能删：node 单测、
 * 单机、断线兜底都要它。
 *
 * 三条设计约束，改这个文件之前先读懂：
 * - **引用用稳定 id 不用下标**。错位是静默的、越界是响的：删掉第 3 条路径，下标方案会让鱼阵
 *   指向另一条**完全合法**的路径 —— 不抛异常，只是这队鱼走错了路。id 给人和编辑器，
 *   下标给机器（`PathFollow.pathId` 只装数字），转换发生在 `waveFeeder` 载入这一刻。
 * - **不存派生量**。弧长 `length` 由 `paths.ts` 载入时采样算出。将来服务端下发时也只发几何 ——
 *   两份采样实现的浮点一漂，同一条鱼在不同客户端就位置不同。
 * - **一个 `rev` 盖住两张表**。鱼阵引用路径 id，两张表必须一致；拆成两个版本号，
 *   「wave 表新、path 表旧」这个组合一定会在某次热更或下发里出现。
 */

/** 一队同种鱼：在 `at` 秒从 `path` 的起点出发，每 `gap` 秒放一条，共 `count` 条，整队同速。 */
export interface FishGroup {
  /** 相对本阵开始的秒数。 */
  readonly at: number;
  /** 引用 {@link FishContent.paths} 里的 `id`。 */
  readonly path: string;
  /** 引用 `FISH_KINDS` 里的 `id`。 */
  readonly kind: string;
  readonly count: number;
  /** 每条隔几秒进场。省略即 0（整队同时进场）。 */
  readonly gap?: number;
  /** 像素/秒。整队同速 —— 同速才保得住队形。 */
  readonly speed: number;
}

/** 一个鱼阵 = 若干 group 的组合。混种、多路径、「大鱼带一串小弟」都是多一个 group 而已。 */
export interface FishWave {
  readonly id: string;
  readonly groups: readonly FishGroup[];
}

export interface FishContent {
  /** 「这份内容被**发布**过一次」的编号，编辑器每次导出 +1。不是操作计数。 */
  readonly rev: number;
  /** 一条路径 = 三次贝塞尔四控制点（x0,y0,x1,y1,x2,y2,x3,y3），屏心为原点的横屏设计像素。 */
  readonly paths: readonly { readonly id: string; readonly p: readonly number[] }[];
  readonly waves: readonly FishWave[];
}

export const CONTENT = {
  rev: 1,
  // 八条覆盖四种观感：横穿、斜穿、上下大摆、以及一条从左边进又从左边出的回旋。
  // 控制点故意伸到屏外（±1160 / ±740）：鱼从画面外游进来、从画面外游出去。
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
  // 起手四个阵，够验「有编排的内容」这件事；编几条、覆盖哪些观感是拿着编辑器才估得出的内容工作量。
  waves: [
    {
      id: 'yellow-cross',
      groups: [{ at: 0, path: 'cross-lr', kind: 'fish_yellow', count: 8, gap: 0.3, speed: 120 }],
    },
    {
      // 两队斜着对穿，在屏心附近交错
      id: 'red-cross',
      groups: [
        { at: 0, path: 'diag-up', kind: 'fish_red', count: 6, gap: 0.35, speed: 130 },
        { at: 0.8, path: 'diag-down', kind: 'fish_bigred', count: 3, gap: 0.5, speed: 130 },
      ],
    },
    {
      // 大鱼带一串小弟：河豚在前，黄鱼跟着同一条路
      id: 'hetun-escort',
      groups: [
        { at: 0, path: 'wave-lr', kind: 'fish_hetun', count: 1, speed: 80 },
        { at: 0.6, path: 'wave-lr', kind: 'fish_yellow', count: 5, gap: 0.25, speed: 95 },
      ],
    },
    {
      // 鲨鱼走回旋（从左进从左出），同时一列灯笼鱼由下往上穿过去
      id: 'shark-pass',
      groups: [
        { at: 0, path: 'loop-left', kind: 'fish_shayu', count: 1, speed: 70 },
        { at: 1.5, path: 'rise', kind: 'fish_denglongyu', count: 4, gap: 0.4, speed: 110 },
      ],
    },
  ],
} as const satisfies FishContent;

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

/**
 * 一**群**同种鱼：`at` 秒沿 `path` 进场，整群同速，各自站在 {@link FishGroup.formation} 给的位置上。
 *
 * 群里可以只有一条（`formation: [0, 0]`）—— 「一条大鱼」和「一群小鱼」是同一种东西的两个极端，
 * 不为前者另立一个概念。
 */
export interface FishGroup {
  /** 相对本阵开始的秒数。**领队**（队形最靠前那条）在这一刻进场。 */
  readonly at: number;
  /** 引用 {@link FishContent.paths} 里的 `id`。 */
  readonly path: string;
  /** 引用 `FISH_KINDS` 里的 `id`。 */
  readonly kind: string;
  /** 像素/秒。**整群同速** —— 同速才保得住队形。 */
  readonly speed: number;
  /**
   * 队形：`2n` 个数 `[dx0, dy0, dx1, dy1, …]`，n ≥ 1，**路径局部坐标**（设计像素）：
   * `dx` 沿前进方向（负 = 靠后），`dy` 垂直于它（正 = 左手边）。
   *
   * **存距离不存秒数**（旧格式是 `count` + `gap` 秒）：队形是**空间**上的形状，改速度时该
   * 保持不变。存秒数则 speed 一调，一列鱼的疏密跟着变 —— 那是「流」不是「队」。
   *
   * 两维落地的方式不一样，因为路径起点之前没有路可站：`dy` 是真的侧向偏移
   * （{@link ../paths.poseAt}），`dx` 在 `waveFeeder` 载入时换算成**进场延迟**
   * `(最靠前的 dx − dx) / speed` 秒。所以整群的纵深不是瞬间铺开的，是从起点鱼贯而入。
   */
  readonly formation: readonly number[];
}

/** 一个鱼阵 = 若干群的组合。混种、多路径、「大鱼带一串小弟」都是多一群而已。 */
export interface FishWave {
  readonly id: string;
  readonly groups: readonly FishGroup[];
}

export interface FishContent {
  /** 「这份内容被**发布**过一次」的编号，编辑器每次导出 +1。不是操作计数。 */
  readonly rev: number;
  /**
   * 一条路径 = **分段三次贝塞尔链**，`6n+2` 个数，屏心为原点的横屏设计像素。
   *
   * 第 k 段吃下标 `6k..6k+7`，于是相邻两段**共享接点那一对坐标** —— 位置连续是结构保证的，
   * 不可能裂开。`n=1` 正好 8 个数，所以单段路径天然合法。切线在接点处允许不连续（折角）。
   * 手柄离锚点不许近于 `MIN_HANDLE`（贴上去会让导数退化、鱼突然朝右），闸在 `content.test.ts`。
   */
  readonly paths: readonly { readonly id: string; readonly p: readonly number[] }[];
  readonly waves: readonly FishWave[];
}

/**
 * 现有内容的两句话（放这儿不放 `content.ts` —— 那个文件会被编辑器整份覆盖）：
 *
 * - **八条路径覆盖四种观感**：横穿、斜穿、上下大摆、以及一条从左边进又从左边出的回旋。
 *   控制点故意伸到屏外（±1160 / ±740）：鱼从画面外游进来、从画面外游出去，玩家看不到「凭空出现」。
 * - **四个起手阵**：错位两列横穿、雁阵斜穿配一列大红鱼、河豚带一簇小弟、鲨鱼回旋配一列上升的灯笼鱼。
 *   够验「有编排的内容」这件事；编几条、覆盖哪些观感是拿着编辑器才估得出的内容工作量。
 */

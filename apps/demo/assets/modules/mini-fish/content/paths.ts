/**
 * 鱼的游动路径 —— 一条三次贝塞尔，四个控制点。
 *
 * **直线也是贝塞尔**（四个控制点共线），于是全表只有一套求值代码：一个 `pointAt` + 一个 `angleAt`，
 * 没有「直线分支 / 曲线分支」。鱼沿路径按**恒定像素速度**前进（`t += speed × dt / length`），
 * 所以长路径不会自动跑得更快 —— 弧长在建表时采样算好（{@link arcLength}），运行期只做一次除法。
 *
 * 坐标系：**屏心为原点**的横屏设计像素，x∈[-960,960]、y∈[-540,540]。控制点故意伸到屏外
 * （±1160 / ±740）：鱼从画面外游进来、从画面外游出去，玩家看不到「凭空出现」。
 *
 * 路径**数据**住 `content.ts`（编辑器导出的那份），本文件只留几何计算。它不是生成物 ——
 * 判据是「源在不在仓里」（CLAUDE.md 那条）：`mini-hop` 的关卡有个 `.capx` 源在仓外所以烘成
 * 生成物 + 配闸；这里源和产物是同一个文件，改配一条内容自检单测（`test/…/content.test.ts`）。
 */
import { CONTENT } from './content';

/** 横屏玩法场地（设计像素，屏心为原点）。 */
export const FIELD = { width: 1920, height: 1080 } as const;
/** 出了这个范围就算离场（子弹销毁用）。比场地宽一圈，免得贴边就没。 */
export const FIELD_MARGIN = 120;

/** 一条路径：四个控制点（x0,y0,x1,y1,x2,y2,x3,y3）+ 采样出来的弧长。 */
export interface FishPath {
  readonly p: readonly number[];
  /** 采样弧长（设计像素）。恒速前进靠它换算，见类注释。 */
  readonly length: number;
}

/** 弧长采样段数。32 段对这几条平缓曲线足够（再密下去误差已在 1‰ 内，白烧启动时间）。 */
const ARC_SAMPLES = 32;

function bezier(p: readonly number[], t: number, i: number): number {
  const u = 1 - t;
  return (
    u * u * u * p[i] + 3 * u * u * t * p[i + 2] + 3 * u * t * t * p[i + 4] + t * t * t * p[i + 6]
  );
}

/** 折线逼近弧长。 */
function arcLength(p: readonly number[]): number {
  let total = 0;
  let px = bezier(p, 0, 0);
  let py = bezier(p, 0, 1);
  for (let i = 1; i <= ARC_SAMPLES; i++) {
    const t = i / ARC_SAMPLES;
    const x = bezier(p, t, 0);
    const y = bezier(p, t, 1);
    total += Math.hypot(x - px, y - py);
    px = x;
    py = y;
  }
  return total;
}

/**
 * 运行期的路径表：`CONTENT.paths` 的顺序 + 载入时采样出来的弧长。
 *
 * **下标只是运行期的事**（`PathFollow.pathId[eid]` 只装得下数字），存档格式是 `content.ts` 里的
 * **字符串 id**；id → 下标的转换发生在 `waveFeeder` 载入内容那一刻。所以改 `content.paths` 的
 * 顺序不再会让鱼阵静默走错路 —— 引用不到会当场抛。
 */
export const PATHS: readonly FishPath[] = CONTENT.paths.map((it) => ({
  p: it.p,
  length: arcLength(it.p),
}));

/** 取一条路径。越界抛 —— 只可能来自投喂源写错，早炸早发现。 */
export function fishPath(pathId: number): FishPath {
  const p = PATHS[pathId];
  if (!p) throw new Error(`[mini-fish] 未知路径下标 ${pathId}（表里只有 0..${PATHS.length - 1}）`);
  return p;
}

/** 路径上 t∈[0,1] 处的点。 */
export function pointAt(p: FishPath, t: number): { x: number; y: number } {
  return { x: bezier(p.p, t, 0), y: bezier(p.p, t, 1) };
}

/**
 * 路径上 t 处的**朝向**（弧度，+x 为 0）。用贝塞尔导数解析求，不做有限差分 ——
 * 差分在 t=1 处要往外采样，落到定义域外面。
 */
export function angleAt(p: FishPath, t: number): number {
  const u = 1 - t;
  const d = (i: number): number =>
    3 * u * u * (p.p[i + 2] - p.p[i]) +
    6 * u * t * (p.p[i + 4] - p.p[i + 2]) +
    3 * t * t * (p.p[i + 6] - p.p[i + 4]);
  const dx = d(0);
  const dy = d(1);
  // 三个控制点重合时导数退化为 0 —— 现表里没有，但别让将来加的路径静默变成 NaN。
  return dx === 0 && dy === 0 ? 0 : Math.atan2(dy, dx);
}

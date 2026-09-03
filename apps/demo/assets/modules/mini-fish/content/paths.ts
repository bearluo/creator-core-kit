/**
 * 鱼的游动路径 —— 一条**分段三次贝塞尔链**。
 *
 * 数据是一维 `6n+2` 个数：第 k 段吃下标 `6k..6k+7`，于是相邻两段**共享接点那一对坐标**
 * （段 k 的 P3 就是段 k+1 的 P0，是同一份数字）。位置连续因此是**结构保证**的，不可能裂开，
 * 也就不需要为它写闸。`n=1` 正好 8 个数 —— 单段路径天然合法，改造时一条旧数据都不用动。
 *
 * **直线也是贝塞尔**（四个控制点共线），全表只有一套求值代码：`pointAt` + `angleAt`，
 * 没有「直线分支 / 曲线分支」。切线在接点处**允许不连续**（折角）——「鱼沿屏幕边跑一段再拐进来」
 * 是常见鱼阵，强制平滑就画不出直角；要平滑是编辑器拖手柄时镜像的事，不是数据格式的事。
 *
 * ## 鱼按**真弧长**恒速，不是按贝塞尔参数
 *
 * 贝塞尔参数 `t` 跟弧长不成正比：同样 `Δt`，曲率大的地方走得远、平缓处走得近。改造之前
 * 运行时推的是 `t += speed × dt / length`（把 t 当弧长比例）而 `pointAt` 按参数求值，于是
 * `loop-left` 那条鲨鱼实测**快慢比 4.01×** —— 最快时是最慢的四倍，而文档一直写着「恒速」。
 *
 * 现在建表时沿整条路径采样出一张「**累计弧长 → 全局参数**」查找表（{@link buildLut}），
 * 运行期按已走弧长二分查表 + 线性插值拿到参数再求值。`pointAt` / `angleAt` 的入参因此是
 * **已走弧长比例 `s ∈ [0,1]`**，不是贝塞尔参数。⚠️ 两者类型一样、签名一样，**编译器不会替你
 * 发现用错了** —— 调用点只有 `pathSystem` / `feedSystem` / 编辑器画曲线三处。
 *
 * 查找表和弧长都是**派生量**，载入时算，不进 `content.ts`：将来整份由服务端下发时也只发几何，
 * 两份采样实现的浮点一漂，同一条鱼在不同客户端就位置不同。
 *
 * 坐标系：**屏心为原点**的横屏设计像素，x∈[-960,960]、y∈[-540,540]。控制点故意伸到屏外
 * （±1160 / ±740）：鱼从画面外游进来、从画面外游出去，玩家看不到「凭空出现」。
 *
 * 路径**数据**住 `content.ts`（编辑器导出的那份），本文件只留几何计算。
 */
import { CONTENT } from './content';

/** 横屏玩法场地（设计像素，屏心为原点）。 */
export const FIELD = { width: 1920, height: 1080 } as const;
/** 出了这个范围就算离场（子弹销毁用）。比场地宽一圈，免得贴边就没。 */
export const FIELD_MARGIN = 120;

/**
 * 手柄离它锚点的**最小距离**（设计像素）。
 *
 * 不许为零：P1 压在 P0 上时导数 `3(P1−P0)` 退化成 0，{@link angleAt} 的守卫返回 0 ⇒
 * 鱼游到那儿**突然朝右**，不崩不报错。编辑器拖拽时夹紧，`content.test.ts` 再兜一道
 * （人手贴回的文件，坏数据可能从编辑器之外进来）。
 *
 * 60px 相对 2300px 的典型路径长度是 2.6%，对形状几乎没有约束；同时保证手柄在编辑器画布上
 * 跟锚点分得开、抓得住。
 */
export const MIN_HANDLE = 60;

/** 「累计弧长 → 全局参数」查找表。`d[i]` 是走到第 i 个采样点的累计弧长，`g[i]` 是它对应的全局参数。 */
interface ArcLut {
  readonly d: readonly number[];
  readonly g: readonly number[];
}

/** 一条路径：`6n+2` 个控制点 + 载入时算出来的派生量。 */
export interface FishPath {
  readonly p: readonly number[];
  /** 采样弧长（设计像素）。恒速前进靠它换算。 */
  readonly length: number;
  readonly lut: ArcLut;
}

/**
 * 每段的弧长采样数。
 *
 * 是**每段** 128 不是全路径 128 —— 后者误差会随段数线性变大。实测最弯那条（`loop-left`）
 * 采样后的快慢比：32 段 → 1.093× · 64 段 → 1.041× · **128 段 → 1.017×** · 256 段 → 1.006×。
 * 取 128 是给 `content.test.ts` 里 ≤1.05 那道闸留三倍余量：64 也能过，但随便加一条更弯的
 * 路径就会翻红。代价是每条路径多存 `128n+1` 对数（八条路径约 2KB，载入时算一次）。
 */
const SAMPLES_PER_SEG = 128;

/** 段数。`6n+2` 个数 ⇒ n 段。 */
export function segmentCount(p: readonly number[]): number {
  return (p.length - 2) / 6;
}

/** 第 k 段在 t 处的坐标分量（`i` 为 0=x / 1=y）。 */
function bez(p: readonly number[], k: number, t: number, i: number): number {
  const b = k * 6 + i;
  const u = 1 - t;
  return u * u * u * p[b] + 3 * u * u * t * p[b + 2] + 3 * u * t * t * p[b + 4] + t * t * t * p[b + 6];
}

/** 第 k 段在 t 处的导数分量。解析求，不做有限差分 —— 差分在 t=1 处要往定义域外采样。 */
function dbez(p: readonly number[], k: number, t: number, i: number): number {
  const b = k * 6 + i;
  const u = 1 - t;
  return (
    3 * u * u * (p[b + 2] - p[b]) + 6 * u * t * (p[b + 4] - p[b + 2]) + 3 * t * t * (p[b + 6] - p[b + 4])
  );
}

/** 折线逼近，逐段累加，顺带记下「累计弧长 → 全局参数」的对照表。 */
function buildLut(p: readonly number[]): { lut: ArcLut; length: number } {
  const n = segmentCount(p);
  const d: number[] = [0];
  const g: number[] = [0];
  let total = 0;
  for (let k = 0; k < n; k++) {
    let px = bez(p, k, 0, 0);
    let py = bez(p, k, 0, 1);
    for (let i = 1; i <= SAMPLES_PER_SEG; i++) {
      const t = i / SAMPLES_PER_SEG;
      const x = bez(p, k, t, 0);
      const y = bez(p, k, t, 1);
      total += Math.hypot(x - px, y - py);
      px = x;
      py = y;
      d.push(total);
      g.push(k + t); // 全局参数：整数部分是段号、小数部分是段内 t
    }
  }
  return { lut: { d, g }, length: total };
}

/** 从控制点造一条路径（算好弧长与查找表）。编辑器画曲线时也用它。 */
export function makeFishPath(p: readonly number[]): FishPath {
  const { lut, length } = buildLut(p);
  return { p, length, lut };
}

/**
 * 运行期的路径表：`CONTENT.paths` 的顺序 + 载入时算出的派生量。
 *
 * **下标只是运行期的事**（`PathFollow.pathId[eid]` 只装得下数字），存档格式是 `content.ts` 里的
 * **字符串 id**；id → 下标的转换发生在 `waveFeeder` 载入内容那一刻。所以改 `content.paths` 的
 * 顺序不再会让鱼阵静默走错路 —— 引用不到会当场抛。
 */
export const PATHS: readonly FishPath[] = CONTENT.paths.map((it) => makeFishPath(it.p));

/** 取一条路径。越界抛 —— 只可能来自投喂源写错，早炸早发现。 */
export function fishPath(pathId: number): FishPath {
  const p = PATHS[pathId];
  if (!p) throw new Error(`[mini-fish] 未知路径下标 ${pathId}（表里只有 0..${PATHS.length - 1}）`);
  return p;
}

/**
 * 已走弧长比例 `s ∈ [0,1]` → 全局参数 `g ∈ [0,n]`。二分查表 + 线性插值。
 *
 * 这一步就是「恒速」的全部实现：外面按像素推进度，这里把像素换算回参数。
 */
function locate(path: FishPath, s: number): number {
  const { d, g } = path.lut;
  const target = Math.max(0, Math.min(1, s)) * path.length;
  let lo = 0;
  let hi = d.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (d[mid] <= target) lo = mid;
    else hi = mid;
  }
  const span = d[hi] - d[lo];
  const f = span === 0 ? 0 : (target - d[lo]) / span;
  return g[lo] + f * (g[hi] - g[lo]);
}

/** 全局参数 → 段号 + 段内 t。落在接点上时取**右段起点**（确定性的：折角处鱼瞬间转头，那正是折角的定义）。 */
function split(path: FishPath, s: number): { k: number; t: number } {
  const g = locate(path, s);
  const k = Math.min(segmentCount(path.p) - 1, Math.floor(g));
  return { k, t: g - k };
}

/**
 * 路径上 `s` 处、**离中线 `offset` 像素**的位姿（`offset` 正 = 前进方向的左手边）。
 * ⚠️ `s` 不是贝塞尔参数，见文件头。
 *
 * 侧向偏移是**队形的一半实现**：一群鱼共用一条路径，靠它岔开成两列 / 楔形 / 一簇；
 * 另一半是进场延迟 —— 队形的纵深（沿路径那一维）在 `waveFeeder` 里换算成秒数，
 * 因为路径起点之前没有路可站。
 *
 * `angle` **不带偏移** —— 整群朝向都取中线的切线：偏在旁边那条鱼不该斜着游，
 * 它跟领队是平行的。
 *
 * 一次定位同时给点和朝向：{@link pointAt} / {@link angleAt} 都走它，全表只有一份求值代码，
 * 鱼是每帧每条都要算的，少一次二分查表不亏。
 */
export function poseAt(path: FishPath, s: number, offset = 0): { x: number; y: number; angle: number } {
  const { k, t } = split(path, s);
  const dx = dbez(path.p, k, t, 0);
  const dy = dbez(path.p, k, t, 1);
  // 手柄压在锚点上时导数退化为 0。`MIN_HANDLE` + `content.test.ts` 那道闸让它不该出现，
  // 但真出现时别静默变成 NaN —— 朝右总比 NaN 强。
  const angle = dx === 0 && dy === 0 ? 0 : Math.atan2(dy, dx);
  return {
    // 法线 = 切线转 +90°（世界 y 向上 ⇒ 正的 offset 在左手边）
    x: bez(path.p, k, t, 0) - Math.sin(angle) * offset,
    y: bez(path.p, k, t, 1) + Math.cos(angle) * offset,
    angle,
  };
}

/**
 * `s` 越出 `[0,1]` 时**沿端点切线外推**，不夹紧。给 {@link bodyPoseAt} 用：鱼刚进场时尾尖
 * 还在路径起点之外，夹紧会把尾巴按在起点上 ⇒ 鱼一进场先被压扁再"长"出来。
 */
function edgePoseAt(
  path: FishPath,
  s: number,
  offset: number,
): { x: number; y: number; angle: number } {
  if (s >= 0 && s <= 1) return poseAt(path, s, offset);
  const end = s < 0 ? 0 : 1;
  const q = poseAt(path, end, offset);
  const d = (s - end) * path.length;
  return { x: q.x + Math.cos(q.angle) * d, y: q.y + Math.sin(q.angle) * d, angle: q.angle };
}

/**
 * 一条**长 `body` 像素的鱼**摆在路径上的位姿：鼻尖压在 `s + 半身`、尾尖压在 `s − 半身`，
 * 位置取两端中点、朝向取**两端连线**（不是中点处的切线）。
 *
 * ## 为什么不直接用切线
 *
 * 用切线等于把整条鱼钉在一个点上原地转：路径一弯，500 像素长的鲨鱼就绕着**自己肚子**旋，
 * 尾巴往前甩、头往后扫 —— 转弯看着僵硬的根就在这儿，跟帧动画没关系。真鱼转弯是头先走、
 * 身子跟上，**位置和朝向分别由身体两端决定**。
 *
 * 把鱼当一根两端都压在路径上的棍子，这件事就自动成立了，而且不用存任何状态：
 *
 * - 转弯速率**按体长自动低通**。弯道比身子短，大鱼就跨过去、不理会；小鱼身子短，
 *   跟得贴。于是"大鱼转得稳、小鱼灵活"是几何给的，不是又一列参数。
 * - 位置被拉向弯道内侧（矢高 ≈ `体长² / 8R`），这是对的 —— 一根刚性的棍子过弯，
 *   中点本来就不可能还在弧上。
 * - 仍是 `s` 的纯函数：编辑器拖走带、将来跟服务端逐行对照，都还成立。
 *
 * 侧向偏移 `offset` 两端各按各的法线加 —— 同心弧上的两点转过同样的角度，连线方向跟中线
 * 那条一致，所以"偏在旁边那条鱼跟领队平行"这条规矩没被破坏。
 */
export function bodyPoseAt(
  path: FishPath,
  s: number,
  offset: number,
  body: number,
): { x: number; y: number; angle: number } {
  if (body <= 0) return poseAt(path, s, offset);
  const half = body / (2 * path.length);
  const a = edgePoseAt(path, s - half, offset);
  const b = edgePoseAt(path, s + half, offset);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  // 身子长到把整条路绕回原处时两端会重合（现有路径不会，但别静默变 NaN）
  if (dx === 0 && dy === 0) return poseAt(path, s, offset);
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, angle: Math.atan2(dy, dx) };
}

/** 路径上「已走弧长比例 `s`」处的点。⚠️ `s` 不是贝塞尔参数，见文件头。 */
export function pointAt(path: FishPath, s: number): { x: number; y: number } {
  const q = poseAt(path, s);
  return { x: q.x, y: q.y };
}

/** 路径上 `s` 处的**朝向**（弧度，+x 为 0）。⚠️ `s` 不是贝塞尔参数，见文件头。 */
export function angleAt(path: FishPath, s: number): number {
  return poseAt(path, s).angle;
}

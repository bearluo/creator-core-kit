/**
 * 鱼种表 —— 这一款的全部「内容」。倍率取自 CCFish 的 `fishconfig.json` 的 `gold` 列
 * （见 `docs/design/2026-08-28-mini-fish-design.md` §8）；它的 `hp` 列**丢掉不用**：那是血量制的
 * 产物，本款是概率制（决策 C），鱼没有血量。
 *
 * 倍率 `m` 同时是三件事的输入：赔付（`payout = level × m`）、击杀概率（`p = RTP / (N × m)`）、
 * 投喂权重（`∝ 1/m`，大鱼罕见）。改一个数，三处一起动 —— 这是有意的，倍率就是这条鱼的全部身份。
 */

/** 一种鱼。`id` 是图集里的帧名前缀（`<id>_run_<i>` / `<id>_dead_<i>`）。 */
export interface FishKind {
  readonly id: string;
  readonly name: string;
  /** 游动序列帧数（`<id>_run_0..frames-1`）。死亡序列**恒为 4 帧**，全表一致，不单列。 */
  readonly frames: number;
  /** 倍率。见类注释。 */
  readonly m: number;
  /**
   * 判定半径（设计像素）= 图集里 `<id>_run_0` 那帧**短边的一半**。
   * 取短边而不是长边：鲨鱼 499×205 按长边算，判定圈会大到把它身后一整片海都算进网里。
   */
  readonly r: number;
  /** 炸弹鱼：死的时候把周围一起炸（决策 D3）。全表只有河豚一条。 */
  readonly bomb: boolean;
}

/** 下标即 `Fish.kind[eid]`，**顺序就是存档格式**，只许往后加、不许插队。 */
export const FISH_KINDS: readonly FishKind[] = [
  { id: 'fish_red', name: '红鱼', frames: 4, m: 10, r: 28, bomb: false },
  { id: 'fish_denglongyu', name: '灯笼鱼', frames: 8, m: 10, r: 61, bomb: false },
  { id: 'fish_yellow', name: '黄鱼', frames: 4, m: 10, r: 17, bomb: false },
  { id: 'fish_bigred', name: '大红鱼', frames: 4, m: 20, r: 26, bomb: false },
  { id: 'fish_fuyi', name: '蝠鲼', frames: 8, m: 20, r: 73, bomb: false },
  { id: 'fish_gui', name: '鬼鱼', frames: 6, m: 30, r: 79, bomb: false },
  { id: 'fish_hailuoshuimu', name: '海螺水母', frames: 8, m: 30, r: 38, bomb: false },
  { id: 'fish_hetun', name: '河豚', frames: 4, m: 40, r: 44, bomb: true },
  { id: 'fish_jinshayu', name: '金鲨', frames: 8, m: 40, r: 107, bomb: false },
  { id: 'fish_shayu', name: '鲨鱼', frames: 8, m: 50, r: 102, bomb: false },
  { id: 'fish_shuimu', name: '水母', frames: 6, m: 50, r: 41, bomb: false },
];

/** 炸弹鱼死了以后，以它为心炸这么大一圈（设计像素）。 */
export const BOMB_RADIUS = 260;

/** 全表最大判定半径。空间哈希是**粗筛**，查询半径得按最大的鱼放，否则大鱼会被漏掉。 */
export const MAX_FISH_R = FISH_KINDS.reduce((max, k) => Math.max(max, k.r), 0);

/** 取一种鱼。下标越界抛 —— 越界只可能来自投喂源写错，早炸早发现。 */
export function fishKind(kind: number): FishKind {
  const k = FISH_KINDS[kind];
  if (!k) throw new Error(`[mini-fish] 未知鱼种下标 ${kind}（表里只有 0..${FISH_KINDS.length - 1}）`);
  return k;
}

/** 死亡序列帧数。全表一致（图集里每条鱼都是 4 帧），所以是常量不是表列。 */
export const DEAD_FRAMES = 4;

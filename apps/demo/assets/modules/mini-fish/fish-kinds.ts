/**
 * 鱼种表 —— 这一款的全部「内容」。倍率取自 CCFish 的 `fishconfig.json` 的 `gold` 列
 * （见 `docs/design/2026-08-28-mini-fish-design.md` §8）；它的 `hp` 列**丢掉不用**：那是血量制的
 * 产物，本款是概率制（决策 C），鱼没有血量。
 *
 * 倍率 `m` 同时是三件事的输入：赔付（`payout = level × m`）、击杀概率（`p = RTP / (N × m)`）、
 * 投喂权重（`∝ 1/m`，大鱼罕见）。改一个数，三处一起动 —— 这是有意的，倍率就是这条鱼的全部身份。
 */

/** 一种鱼。`id` 是图集里的帧名前缀，第二刀切序列帧用。 */
export interface FishKind {
  readonly id: string;
  readonly name: string;
  /** 倍率。见类注释。 */
  readonly m: number;
  /** 判定半径（设计像素）。第二刀对着图集实测再调。 */
  readonly r: number;
  /** 炸弹鱼：死的时候把周围一起炸（决策 D3）。全表只有河豚一条。 */
  readonly bomb: boolean;
}

/** 下标即 `Fish.kind[eid]`，**顺序就是存档格式**，只许往后加、不许插队。 */
export const FISH_KINDS: readonly FishKind[] = [
  { id: 'fish_red', name: '红鱼', m: 10, r: 34, bomb: false },
  { id: 'fish_denglong', name: '灯笼鱼', m: 10, r: 34, bomb: false },
  { id: 'fish_yellow', name: '黄鱼', m: 10, r: 34, bomb: false },
  { id: 'fish_bigred', name: '大红鱼', m: 20, r: 46, bomb: false },
  { id: 'fish_fuyi', name: '蝠鲼', m: 20, r: 46, bomb: false },
  { id: 'fish_gui', name: '鬼鱼', m: 30, r: 56, bomb: false },
  { id: 'fish_hailuoshuimu', name: '海螺水母', m: 30, r: 56, bomb: false },
  { id: 'fish_hetun', name: '河豚', m: 40, r: 64, bomb: true },
  { id: 'fish_jinshayu', name: '金鲨', m: 40, r: 72, bomb: false },
  { id: 'fish_shayu', name: '鲨鱼', m: 50, r: 88, bomb: false },
  { id: 'fish_shuimu', name: '水母', m: 50, r: 80, bomb: false },
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

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
  /**
   * 体长（设计像素）= 图集里 `<id>_run_0` 那帧的**宽** —— 鱼头一律朝 +x，宽就是沿身子那一维。
   * 鱼是**一根有长度的棍子**摆在路径上（鼻尖与尾尖各压在路径上一点，见 `paths.bodyPoseAt`），
   * 不是钉在一个点上原地转，所以这一列直接决定它转得有多稳：身子越长，弯道越被它自己抹平。
   */
  readonly body: number;
  /** 炸弹鱼：死的时候把周围一起炸（决策 D3）。全表只有河豚一条。 */
  readonly bomb: boolean;
  /**
   * 摆幅倍率（群游用，见 `ecs/schoolSystem.ts`）。稳态摆幅 = `基准 × (r / 参照体型) × sway`
   * —— **体型那一份自动给**，这一列只说性格：水母飘、鲨鱼稳。1 = 按体型该有的样子。
   */
  readonly sway: number;
  /**
   * 守位倍率：回槽弹簧的倍数。大 = 老实待在队形里、被挤开也很快回去；
   * 小 = 松垮爱游离。**它同时决定摆动的快慢** —— 弹簧硬则频率高，正是小鱼碎、大鱼缓那回事。
   */
  readonly hold: number;
}

/** 下标即 `Fish.kind[eid]`，**顺序就是存档格式**，只许往后加、不许插队。 */
export const FISH_KINDS: readonly FishKind[] = [
  { id: 'fish_red', name: '红鱼', frames: 4, m: 10, r: 28, body: 72, bomb: false, sway: 1, hold: 1 },
  { id: 'fish_denglongyu', name: '灯笼鱼', frames: 8, m: 10, r: 61, body: 170, bomb: false, sway: 0.8, hold: 1.1 },
  { id: 'fish_yellow', name: '黄鱼', frames: 4, m: 10, r: 17, body: 52, bomb: false, sway: 1.3, hold: 0.9 },
  { id: 'fish_bigred', name: '大红鱼', frames: 4, m: 20, r: 26, body: 68, bomb: false, sway: 0.9, hold: 1.1 },
  { id: 'fish_fuyi', name: '蝠鲼', frames: 8, m: 20, r: 73, body: 146, bomb: false, sway: 0.7, hold: 1.2 },
  { id: 'fish_gui', name: '鬼鱼', frames: 6, m: 30, r: 79, body: 166, bomb: false, sway: 0.5, hold: 1.3 },
  { id: 'fish_hailuoshuimu', name: '海螺水母', frames: 8, m: 30, r: 38, body: 89, bomb: false, sway: 1.2, hold: 0.55 },
  { id: 'fish_hetun', name: '河豚', frames: 4, m: 40, r: 44, body: 90, bomb: true, sway: 0.7, hold: 1.2 },
  { id: 'fish_jinshayu', name: '金鲨', frames: 8, m: 40, r: 107, body: 514, bomb: false, sway: 0.5, hold: 1.4 },
  { id: 'fish_shayu', name: '鲨鱼', frames: 8, m: 50, r: 102, body: 499, bomb: false, sway: 0.5, hold: 1.4 },
  { id: 'fish_shuimu', name: '水母', frames: 6, m: 50, r: 41, body: 82, bomb: false, sway: 1.3, hold: 0.5 },
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

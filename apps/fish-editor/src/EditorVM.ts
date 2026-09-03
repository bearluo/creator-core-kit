/**
 * 鱼阵编辑器的逻辑层 —— **零 `cc`，node 直跑**。设计见
 * `docs/design/2026-08-31-mini-fish-content-editor.md` §4。
 *
 * View（`main.ts`）只管 DOM 与画布：建绑定、把屏幕坐标转成世界坐标后转发、把 `draft` 画出来。
 * **命中判定和拖拽落点算逻辑不算 View** —— 它们是世界坐标上的纯数学，放 View 里就没法在 node
 * 里问「点这儿抓不抓得到把手」。
 *
 * **收成一个 VM 而不是三个**（PathListVM / WaveVM / DraftVM）：编辑器的状态互相牵连 ——
 * 删一条路径要让引用它的 group 进未解析态，拆开就得在 VM 之间再造一套同步，而那正是最容易
 * 出错的一处。
 *
 * ⚠️ **预览不在这里**：「编的是什么」归本 VM，「它长什么样」归 `FishVM`（直接跑游戏本体那套
 * system，见 §5）。混进来本 VM 就得认识 ECS 世界，而它本该只是一坨纯数据操作。
 */
import { signal, type Signal } from '@cck/core';
import type { FishContent, FishGroup } from '@game/content/content-types';
import { FISH_KINDS } from '@game/content/fish-kinds';
import { MIN_HANDLE, segmentCount } from '@game/content/paths';

/** 草稿态的一条路径。跟 {@link FishContent} 的区别只有一个：可变。 */
export interface DraftPath {
  id: string;
  p: number[];
}

/** 草稿态的一群鱼。跟 {@link FishGroup} 的区别只有一个：可变。 */
export interface DraftGroup {
  at: number;
  path: string;
  kind: string;
  speed: number;
  /** 队形槽位 `[dx0, dy0, …]`，至少一条鱼。含义见 {@link FishGroup.formation}。 */
  formation: number[];
}

/**
 * 队形模板 —— 「一键摆成这样」。**一个字节都不进数据**：存下来的永远是每条鱼的槽位。
 *
 * 存模板（形状 + 条数 + 间距）会省一半字节，但那样就没法单独拖一条鱼了 —— 而「这一条往外挪
 * 一点」正是编队形的人真正在做的事。模板只是起手，不是格式。
 */
export type FormationShape = 'line' | 'row' | 'wedge' | 'cluster';

export const FORMATION_SHAPES: readonly { readonly id: FormationShape; readonly name: string }[] = [
  { id: 'line', name: '一列' },
  { id: 'row', name: '横排' },
  { id: 'wedge', name: '雁阵' },
  { id: 'cluster', name: '一簇' },
];

/** 黄金角。撒点用它，任意条数都不会撞成放射状的行列。 */
const GOLDEN = 2.39996;

/**
 * 取整，且**把 `-0` 变回 `0`**。`Math.round(-0)` 还是 `-0`，而它 `join(', ')` 出来就是
 * 字面量 `-0` —— 导出的 `content.ts` 里冒出个 `-0` 谁看谁疑惑，往返闸也对不上。
 */
const r0 = (v: number): number => Math.round(v) || 0;

/**
 * 按模板摆 `n` 条鱼，间距 `spacing` 像素。局部坐标（`dx` 沿路径、负 = 靠后；`dy` 垂直）。
 *
 * 四种覆盖到的观感：鱼贯而入、并肩推进、雁阵、一团。**都保证任意两条不近于 `spacing`** ——
 * 内容闸要求同群槽位不重叠（`content.test.ts`），模板生的东西不该一出来就是红的。
 */
export function formationOf(shape: FormationShape, n: number, spacing: number): number[] {
  const count = Math.max(1, Math.round(n));
  const sp = Math.max(1, spacing);
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    if (shape === 'row') {
      out.push(0, r0((i - (count - 1) / 2) * sp));
    } else if (shape === 'wedge') {
      // 领队在尖上，两侧交替往后排。最后一条落单是真雁阵的样子，不强行对称
      const k = Math.ceil(i / 2);
      out.push(r0(-k * sp * 0.8), i === 0 ? 0 : (i % 2 === 1 ? 1 : -1) * k * sp);
    } else if (shape === 'cluster') {
      const r = sp * Math.sqrt(i);
      out.push(r0(r * Math.cos(i * GOLDEN)), r0(r * Math.sin(i * GOLDEN)));
    } else {
      out.push(r0(-i * sp), 0);
    }
  }
  return out;
}

/**
 * 这种鱼的槽位最近能挨多近 = **判定半径和**，跟 `schoolSystem` 的分离半径、`content.test.ts`
 * 那道闸是同一个数。比这更近，弹簧和分离力会打起来，一群鱼在原地哆嗦。
 */
export function minSpacing(kind: string): number {
  return 2 * (FISH_KINDS.find((k) => k.id === kind)?.r ?? 20);
}

export interface DraftWave {
  id: string;
  groups: DraftGroup[];
}

export interface Draft {
  rev: number;
  paths: DraftPath[];
  waves: DraftWave[];
}

/** 一个 group 的 `path` 解析不到（引用的路径被删了）。View 据此标红。 */
export interface UnresolvedRef {
  readonly wave: number;
  readonly group: number;
  readonly path: string;
}

/**
 * 草稿落盘的接缝。**没给就整个不落盘** —— node 单测和没有 `localStorage` 的宿主都能跑。
 *
 * key 由 View 传（`scopedKey('cck.fishEditorDraft')`，带 `appId` 前缀：Web / 小游戏同域名共用
 * 一份 `localStorage`，不隔离两个马甲会串）。VM 自己不认识 `appId`，也就不必依赖地基。
 */
export interface EditorStorage {
  read(key: string): string | null;
  write(key: string, value: string): void;
  clear(key: string): void;
}

/** 内存实现。单测用，也是「没有真存储时不要崩」的兜底。 */
export function memoryEditorStorage(): EditorStorage {
  const map = new Map<string, string>();
  return {
    read: (k) => map.get(k) ?? null,
    write: (k, v) => void map.set(k, v),
    clear: (k) => void map.delete(k),
  };
}

export interface EditorVMOptions {
  storage?: EditorStorage;
  storageKey?: string;
  /** 注入时钟：草稿的 `savedAt` 要可断言。 */
  now?: () => number;
}

/** 草稿在存储里的形状。`rev` 是**基线**（存的时候草稿处在哪一版），不是导出后的新值。 */
interface StoredDraft {
  rev: number;
  savedAt: number;
  draft: Draft;
}

const DEFAULT_KEY = 'cck.fishEditorDraft';

/** 起个不撞车的 id：`a` → `a-2` → `a-3`。 */
function uniqueId(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const id = `${base}-${n}`;
    if (!taken.has(id)) return id;
  }
}

function toDraft(content: FishContent): Draft {
  return {
    rev: content.rev,
    paths: content.paths.map((it) => ({ id: it.id, p: it.p.slice() })),
    waves: content.waves.map((w) => ({
      id: w.id,
      groups: w.groups.map((g) => ({
        at: g.at,
        path: g.path,
        kind: g.kind,
        speed: g.speed,
        formation: g.formation.slice(),
      })),
    })),
  };
}

export class EditorVM {
  /** 每次改动 +1。View 订阅它整体重画 —— 编辑器不是每帧刷新的东西，细粒度绑定不值那个代码量。 */
  readonly changed: Signal<number> = signal(0);
  /** 编辑中的内容。View 直接读（同一个包，深拷贝防护不划算）；改它只许经本类的方法。 */
  draft: Draft;
  selectedPath = 0;
  selectedWave = 0;

  /**
   * 编辑中的第几段。**读出来一定合法** —— `selectedPath` 是 View 直接写的公开字段，
   * 换到一条更短的路径上时这个段号会越界；夹在读的这一刻，谁改路径都不用记得同步。
   */
  get selectedSegment(): number {
    return Math.min(this.segment, Math.max(0, this.segments() - 1));
  }
  set selectedSegment(v: number) {
    this.segment = Math.max(0, v);
  }

  private segment = 0;

  /**
   * 画布上**正在摆队形**的是第几群。读出来一定合法 —— 换个阵、删掉一群之后这个下标会越界，
   * 夹在读的这一刻，谁改鱼阵都不用记得同步（同 {@link selectedSegment}）。
   */
  get selectedGroup(): number {
    const n = this.draft.waves[this.selectedWave]?.groups.length ?? 0;
    return Math.min(this.groupCursor, Math.max(0, n - 1));
  }
  set selectedGroup(v: number) {
    this.groupCursor = Math.max(0, v);
  }

  private groupCursor = 0;

  private readonly source: FishContent;
  private readonly storage?: EditorStorage;
  private readonly key: string;
  private readonly now: () => number;

  constructor(source: FishContent, options: EditorVMOptions = {}) {
    this.source = source;
    this.draft = toDraft(source);
    this.storage = options.storage;
    this.key = options.storageKey ?? DEFAULT_KEY;
    this.now = options.now ?? Date.now;
    // ⚠️ **不自动恢复草稿**：最坏的失败不是丢数据，是人以为在看仓库里那份、其实在改三天前的
    //    草稿，导出后把别人贴回的内容整份盖掉。恢复要人点（View 出一条横幅）。
  }

  // —— 路径 ————————————————————————————————————————————————————————

  /** 新路径从选中那条**复制**起手：空白起手要先猜一条曲线，复制永远给一个能看的初值。 */
  copyPath(): void {
    const from = this.draft.paths[this.selectedPath];
    if (!from) return;
    const taken = new Set(this.draft.paths.map((it) => it.id));
    this.draft.paths.push({ id: uniqueId(from.id, taken), p: from.p.slice() });
    this.selectedPath = this.draft.paths.length - 1;
    this.bump();
  }

  /**
   * 删选中那条路径。引用它的 group **原样留着那个 id** —— 于是它进未解析态（{@link unresolved}），
   * View 标红等人去改。换成下标的话这里会静默变成「指向下一条」，鱼照游、只是走错路。
   */
  removePath(): void {
    if (this.draft.paths.length <= 1) return; // 一条都不剩就没法编了
    this.draft.paths.splice(this.selectedPath, 1);
    this.selectedPath = Math.min(this.selectedPath, this.draft.paths.length - 1);
    this.bump();
  }

  /** 解析不到的引用。空数组 = 这份内容自洽。 */
  unresolved(): UnresolvedRef[] {
    const known = new Set(this.draft.paths.map((it) => it.id));
    const out: UnresolvedRef[] = [];
    this.draft.waves.forEach((w, wave) => {
      w.groups.forEach((g, group) => {
        if (!known.has(g.path)) out.push({ wave, group, path: g.path });
      });
    });
    return out;
  }

  // —— 控制点 ——————————————————————————————————————————————————————

  /** 选中路径有几段。 */
  segments(): number {
    const p = this.draft.paths[this.selectedPath]?.p;
    return p ? segmentCount(p) : 0;
  }

  /** 第 `index` 个控制点属于哪一段 —— 第 k 段吃下标 `3k..3k+3`，末锚点夹回最后一段。 */
  segmentOf(index: number): number {
    return Math.max(0, Math.min(this.segments() - 1, Math.floor(index / 3)));
  }

  /**
   * 在**尾巴**接一段，顺着末端切线接出去 ⇒ 新接点两侧切线共线，**天然平滑**。
   * 接完选中新那段：加段的下一个动作十有八九是调它。
   */
  addSegment(): void {
    const p = this.draft.paths[this.selectedPath]?.p;
    if (!p) return;
    const n = p.length;
    const ax = p[n - 2];
    const ay = p[n - 1];
    const vx = ax - p[n - 4];
    const vy = ay - p[n - 3];
    const len = Math.hypot(vx, vy) || 1;
    for (const k of [260, 520, 780]) {
      p.push(Math.round(ax + (vx / len) * k), Math.round(ay + (vy / len) * k));
    }
    this.selectedSegment = segmentCount(p) - 1;
    this.bump();
  }

  /** 删末段。**少于 2 段不许删** —— 删空了这条路径就不存在了，那是 {@link removePath} 的活。 */
  removeSegment(): void {
    const p = this.draft.paths[this.selectedPath]?.p;
    if (!p || segmentCount(p) < 2) return;
    p.length -= 6;
    this.bump();
  }

  /**
   * 每个**折角**接点的段号与度数（0 度 = 平滑，不报）。View 拿它标红。
   *
   * 折角是**允许**的（决策：接点处切线可以不连续），报出来只为「不是手滑弄出来的」——
   * 位置连续由数据结构保证（相邻两段共享接点坐标），切线连续则要人自己看着办。
   */
  corners(): { seg: number; deg: number }[] {
    const p = this.draft.paths[this.selectedPath]?.p;
    const out: { seg: number; deg: number }[] = [];
    if (!p) return out;
    for (let k = 1; k < segmentCount(p); k++) {
      const i = k * 6; // 接点在 p 里的下标
      const ax = p[i] - p[i - 2];
      const ay = p[i + 1] - p[i - 1]; // 进：前一段 P2 → 接点
      const bx = p[i + 2] - p[i];
      const by = p[i + 3] - p[i + 1]; // 出：接点 → 后一段 P1
      const la = Math.hypot(ax, ay);
      const lb = Math.hypot(bx, by);
      if (la < 1e-6 || lb < 1e-6) continue;
      const cos = (ax * bx + ay * by) / (la * lb);
      if (cos < 0.999) {
        out.push({ seg: k, deg: Math.round((Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI) });
      }
    }
    return out;
  }

  /**
   * 选中路径上离 `(x, y)` 最近的控制点，超出 `tol` 返回 `null`。
   * 世界坐标进世界坐标出 —— 屏幕坐标的换算是 View 的事（它才知道画布多大）。
   */
  hitTest(x: number, y: number, tol: number): number | null {
    const path = this.draft.paths[this.selectedPath];
    if (!path) return null;
    let best = -1;
    let bestD = tol;
    for (let i = 0; i < path.p.length / 2; i++) {
      const d = Math.hypot(x - path.p[i * 2], y - path.p[i * 2 + 1]);
      if (d <= bestD) {
        best = i;
        bestD = d;
      }
    }
    return best < 0 ? null : best;
  }

  /**
   * 把选中路径的第 `index` 个控制点挪到 `(x, y)`。三条规矩全在这儿，View 一条都不重复：
   *
   * - 拖**锚点**：两侧手柄刚性跟随（相对位置不变），否则挪一下整段就变形了。
   * - 拖**手柄**：接点对面那个只对齐方向、**保留原长** —— 拖这一段不该把另一段也拉变形。
   *   `mirror: false`（View 按 Alt）就只动这一个，那正是**故意折角**的做法。
   * - 手柄离锚点不许近于 {@link MIN_HANDLE}：贴上去导数 `3(P1−P0)` 退化成 0，`angleAt`
   *   那道守卫返回 0 ⇒ 鱼游到那儿**突然朝右**，不崩不报错，只能在这里挡住。
   */
  dragPoint(index: number, x: number, y: number, options: { mirror?: boolean } = {}): void {
    const path = this.draft.paths[this.selectedPath];
    if (!path) return;
    const p = path.p;
    const count = p.length / 2;
    if (index < 0 || index >= count) return;

    if (index % 3 === 0) {
      const dx = x - p[index * 2];
      const dy = y - p[index * 2 + 1];
      p[index * 2] = x;
      p[index * 2 + 1] = y;
      for (const j of [index - 1, index + 1]) {
        if (j < 0 || j >= count) continue;
        p[j * 2] += dx;
        p[j * 2 + 1] += dy;
      }
      this.bump();
      return;
    }

    const anchor = index % 3 === 1 ? index - 1 : index + 1;
    const ax = p[anchor * 2];
    const ay = p[anchor * 2 + 1];
    let vx = x - ax;
    let vy = y - ay;
    let d = Math.hypot(vx, vy);
    if (d < MIN_HANDLE) {
      if (d < 1e-6) {
        // 正好落在锚点上 ⇒ 方向未定义。沿用它**原来**的方向，别凭空造一个
        vx = p[index * 2] - ax;
        vy = p[index * 2 + 1] - ay;
        d = Math.hypot(vx, vy);
        if (d < 1e-6) {
          vx = 1;
          vy = 0;
          d = 1;
        } // 连原来都退化了（旧数据修复）
      }
      x = Math.round(ax + (vx / d) * MIN_HANDLE);
      y = Math.round(ay + (vy / d) * MIN_HANDLE);
      vx = x - ax;
      vy = y - ay;
      d = MIN_HANDLE;
    }
    p[index * 2] = x;
    p[index * 2 + 1] = y;

    if (options.mirror !== false) {
      const opp = index % 3 === 1 ? anchor - 1 : anchor + 1;
      if (opp >= 0 && opp < count) {
        // 对面保持原长，但同样不许短于最小值 —— 一旦塌到零就再也回不来（长度恒为 0，
        // 镜像每次都把它算回锚点上）
        const len = Math.max(MIN_HANDLE, Math.hypot(p[opp * 2] - ax, p[opp * 2 + 1] - ay));
        p[opp * 2] = Math.round(ax - (vx / d) * len);
        p[opp * 2 + 1] = Math.round(ay - (vy / d) * len);
      }
    }
    this.bump();
  }

  // —— 鱼阵 ————————————————————————————————————————————————————————

  addWave(): void {
    const taken = new Set(this.draft.waves.map((w) => w.id));
    this.draft.waves.push({ id: uniqueId('wave', taken), groups: [this.newGroup()] });
    this.selectedWave = this.draft.waves.length - 1;
    this.bump();
  }

  removeWave(): void {
    if (this.draft.waves.length === 0) return;
    this.draft.waves.splice(this.selectedWave, 1);
    this.selectedWave = Math.max(0, Math.min(this.selectedWave, this.draft.waves.length - 1));
    this.bump();
  }

  addGroup(): void {
    this.draft.waves[this.selectedWave]?.groups.push(this.newGroup());
    this.bump();
  }

  removeGroup(index: number): void {
    this.draft.waves[this.selectedWave]?.groups.splice(index, 1);
    this.bump();
  }

  patchGroup(index: number, patch: Partial<DraftGroup>): void {
    const g = this.draft.waves[this.selectedWave]?.groups[index];
    if (!g) return;
    Object.assign(g, patch);
    this.bump();
  }

  // —— 队形 ————————————————————————————————————————————————————————

  /** 这一群有几条鱼。**是算出来的**（槽位数），不是另存一份会漂的 count。 */
  groupSize(index: number): number {
    return (this.group(index)?.formation.length ?? 0) / 2;
  }

  /**
   * 加 / 减到 `n` 条。
   *
   * 加是**照着最后两条的间距往后接**（同 {@link addSegment} 的路数：接出去的那条天然接得上，
   * 一列继续成列、一簇继续散开），减是从队尾拿掉 —— 队尾是最靠后那条，删它最不打眼。
   * 至少留一条：零条鱼的群等于这一群不存在，那是「删掉这群」的活。
   */
  setGroupSize(index: number, n: number): void {
    const g = this.group(index);
    if (!g) return;
    const target = Math.max(1, Math.min(60, Math.round(n)));
    const f = g.formation;
    const min = minSpacing(g.kind);
    while (f.length / 2 > target) f.length -= 2;
    while (f.length / 2 < target) {
      const k = f.length / 2;
      // 只有一条时没有「趋势」可续，就往正后方接
      let x = k === 1 ? f[0] - min - 6 : 2 * f[(k - 1) * 2] - f[(k - 2) * 2];
      let y = k === 1 ? f[1] : 2 * f[(k - 1) * 2 + 1] - f[(k - 2) * 2 + 1];
      [x, y] = this.pushOut(f, -1, x, y, min);
      f.push(x, y);
    }
    this.bump();
  }

  /** 按模板整群重排。间距不许小于判定半径和 —— 那样摆出来的队形一出生就在自己跟自己打架。 */
  reshapeGroup(index: number, shape: FormationShape, spacing: number): void {
    const g = this.group(index);
    if (!g) return;
    const n = g.formation.length / 2;
    g.formation = formationOf(shape, n, Math.max(minSpacing(g.kind), Math.round(spacing)));
    this.bump();
  }

  /**
   * 队形的锚点：路径**起点**的位置与切线（队形就是绕着它摆的）。
   *
   * 故意不走 `makeFishPath` —— 那会为每次命中判定建一张 128 采样的弧长表，而起点的位置和
   * 切线直接读控制点就有：点是 P0，导数是 `3(P1−P0)`（取角度时那个系数无所谓）。
   */
  groupPose(index: number): { x: number; y: number; angle: number } | null {
    const g = this.group(index);
    const p = g && this.draft.paths.find((it) => it.id === g.path)?.p;
    if (!p) return null;
    return { x: p[0], y: p[1], angle: Math.atan2(p[3] - p[1], p[2] - p[0]) };
  }

  /** 第 `slot` 条鱼在**世界**里的位置（局部槽位绕锚点转到路径方向上）。 */
  slotWorld(index: number, slot: number): { x: number; y: number } | null {
    const g = this.group(index);
    const pose = this.groupPose(index);
    if (!g || !pose || slot < 0 || slot * 2 + 1 >= g.formation.length) return null;
    const c = Math.cos(pose.angle);
    const s = Math.sin(pose.angle);
    const dx = g.formation[slot * 2];
    const dy = g.formation[slot * 2 + 1];
    return { x: pose.x + dx * c - dy * s, y: pose.y + dx * s + dy * c };
  }

  /** 离 `(x, y)` 最近的那条鱼，超出 `tol` 返回 `null`。世界坐标进世界坐标出，同 {@link hitTest}。 */
  hitTestSlot(index: number, x: number, y: number, tol: number): number | null {
    let best = -1;
    let bestD = tol;
    for (let i = 0; i < this.groupSize(index); i++) {
      const w = this.slotWorld(index, i);
      if (!w) continue;
      const d = Math.hypot(x - w.x, y - w.y);
      if (d <= bestD) {
        best = i;
        bestD = d;
      }
    }
    return best < 0 ? null : best;
  }

  /**
   * 把第 `slot` 条鱼拖到世界坐标 `(x, y)`：转回局部再写。
   *
   * **落点会被推开到不跟别的鱼重叠**（判据同 `schoolSystem` 的分离半径）。挡在这儿而不是
   * 事后报错，是因为重叠的槽位不会报任何错，只会让那一群在原地哆嗦 —— 跟 {@link MIN_HANDLE}
   * 那条一个道理：能在源头夹住的，别留给人去发现。
   */
  dragSlot(index: number, slot: number, x: number, y: number): void {
    const g = this.group(index);
    const pose = this.groupPose(index);
    if (!g || !pose || slot < 0 || slot * 2 + 1 >= g.formation.length) return;
    const c = Math.cos(pose.angle);
    const s = Math.sin(pose.angle);
    const vx = x - pose.x;
    const vy = y - pose.y;
    const [dx, dy] = this.pushOut(
      g.formation,
      slot,
      vx * c + vy * s,
      -vx * s + vy * c,
      minSpacing(g.kind),
    );
    g.formation[slot * 2] = dx;
    g.formation[slot * 2 + 1] = dy;
    this.bump();
  }

  /**
   * 槽位挨得比判定半径和还近的群。空数组 = 这份内容摆得开。
   *
   * 拖拽和模板都会夹紧，所以正常编不出来 —— 这条留给**另一条进来的路**：旧格式的草稿、
   * 人手改过的 `content.ts`、合并冲突解错。让编的人在导出**之前**看见，比 CI 红了再回来强。
   */
  crowded(): { wave: number; group: number; a: number; b: number; gap: number }[] {
    const out: { wave: number; group: number; a: number; b: number; gap: number }[] = [];
    this.draft.waves.forEach((w, wave) => {
      w.groups.forEach((g, group) => {
        const min = minSpacing(g.kind);
        const f = g.formation;
        for (let i = 0; i < f.length / 2; i++) {
          for (let j = i + 1; j < f.length / 2; j++) {
            const d = Math.hypot(f[i * 2] - f[j * 2], f[i * 2 + 1] - f[j * 2 + 1]);
            if (d < min) out.push({ wave, group, a: i, b: j, gap: Math.round(d) });
          }
        }
      });
    });
    return out;
  }

  // —— 导出 ————————————————————————————————————————————————————————

  /** 当前草稿的纯数据投影。**不动 `rev`** —— 预览用它，预览不是发布。 */
  toContent(): FishContent {
    return {
      rev: this.draft.rev,
      paths: this.draft.paths.map((it) => ({ id: it.id, p: it.p.slice() })),
      waves: this.draft.waves.map((w) => ({
        id: w.id,
        groups: w.groups.map(
          (g): FishGroup => ({
            at: g.at,
            path: g.path,
            kind: g.kind,
            speed: g.speed,
            formation: g.formation.slice(),
          }),
        ),
      })),
    };
  }

  /**
   * 导出 `content.ts` 的**全文**，顺手把 `rev` +1 —— 它是「这份内容被**发布**过一次」的编号。
   * 于是两个人同时编，两份都是同一个 `rev`，**贴回时 git 直接冲突而不是静默覆盖**：
   * 并发交给 git，编辑器不长合并逻辑。
   */
  exportText(): string {
    this.draft.rev += 1;
    this.bump();
    const q = (v: string): string => `'${v}'`;
    // 一群一行。队形长了这行会很长（八条鱼 = 16 个数），但它是**一张表**：
    // 折行反而让「这一群」在 diff 里散成好几处
    const group = (g: DraftGroup): string =>
      `{ at: ${g.at}, path: ${q(g.path)}, kind: ${q(g.kind)}, speed: ${g.speed}, ` +
      `formation: [${g.formation.join(', ')}] }`;
    const lines: string[] = [];
    lines.push('/**');
    lines.push(' * 捕鱼的内容数据：路径几何 + 鱼阵编排。');
    lines.push(' *');
    lines.push(' * ⚠️ **这个文件是编辑器导出的全文**（`apps/fish-editor`：复制 → 人 `Ctrl+V` 覆盖 → `git diff`');
    lines.push(' * 看得见改了什么）。别往里写说明或手写代码 —— 下一次导出会整份盖掉。字段含义、为什么这么设计、');
    lines.push(' * 联网之后怎么办，都在 `content-types.ts` 和');
    lines.push(' * `docs/design/2026-08-31-mini-fish-content-editor.md`。');
    lines.push(' *');
    lines.push(' * `rev` 只在**导出**时 +1：它是「这份内容被发布过一次」的编号，不是操作计数。');
    lines.push(' */');
    lines.push("import type { FishContent } from './content-types';");
    lines.push('');
    lines.push('export const CONTENT = {');
    lines.push(`  rev: ${this.draft.rev},`);
    lines.push('  paths: [');
    for (const it of this.draft.paths) lines.push(`    { id: ${q(it.id)}, p: [${it.p.join(', ')}] },`);
    lines.push('  ],');
    lines.push('  waves: [');
    for (const w of this.draft.waves) {
      lines.push('    {');
      lines.push(`      id: ${q(w.id)},`);
      lines.push('      groups: [');
      for (const g of w.groups) lines.push(`        ${group(g)},`);
      lines.push('      ],');
      lines.push('    },');
    }
    lines.push('  ],');
    lines.push('} as const satisfies FishContent;');
    return lines.join('\n') + '\n';
  }

  // —— 草稿 ————————————————————————————————————————————————————————

  /** 存一份草稿（防崩，不参与发布）。View 在改动后 debounce 调它。 */
  saveDraft(): void {
    const stored: StoredDraft = { rev: this.draft.rev, savedAt: this.now(), draft: this.draft };
    this.storage?.write(this.key, JSON.stringify(stored));
  }

  /**
   * 有没有草稿、基于哪一版、什么时候存的。View 拿它出那条横幅。
   * **存坏了当没有** —— 一行脏数据不许把编辑器卡死（同 `persistentWallet` 的判据）。
   */
  draftInfo(): { rev: number; savedAt: number } | null {
    const stored = this.readDraft();
    return stored ? { rev: stored.rev, savedAt: stored.savedAt } : null;
  }

  /** 人点了「恢复」才走这一步。 */
  restoreDraft(): void {
    const stored = this.readDraft();
    if (!stored) return;
    this.draft = stored.draft;
    this.selectedPath = Math.min(this.selectedPath, Math.max(0, this.draft.paths.length - 1));
    this.selectedWave = Math.min(this.selectedWave, Math.max(0, this.draft.waves.length - 1));
    this.bump();
  }

  discardDraft(): void {
    this.storage?.clear(this.key);
  }

  /** 回到源码那份（放弃当前编辑）。 */
  reload(): void {
    this.draft = toDraft(this.source);
    this.selectedPath = 0;
    this.selectedWave = 0;
    this.bump();
  }

  // —— 私有 ————————————————————————————————————————————————————————

  private newGroup(): DraftGroup {
    const path = this.draft.paths[this.selectedPath]?.id ?? this.draft.paths[0]?.id ?? '';
    const kind = 'fish_yellow';
    return { at: 0, path, kind, speed: 120, formation: formationOf('line', 4, minSpacing(kind) + 20) };
  }

  private group(index: number): DraftGroup | undefined {
    return this.draft.waves[this.selectedWave]?.groups[index];
  }

  /**
   * 把 `(x, y)` 推到「离表里每一条都不近于 `min`」的地方，返回取整后的落点。
   *
   * 逐轮找**最挤的**那条、沿两点连线推出去，最多八轮 —— 推开一条可能挤到另一条，但每轮都
   * 严格离开当前最近的那个，实际队形（几十条、间距同量级）一两轮就收敛。真推不开就维持
   * 当前落点，交给 {@link crowded} 去报，不硬塞。`self` 传 -1 表示这是条新鱼、还不在表里。
   */
  private pushOut(
    f: readonly number[],
    self: number,
    x: number,
    y: number,
    min: number,
  ): [number, number] {
    let px = x;
    let py = y;
    for (let pass = 0; pass < 8; pass++) {
      let worst = -1;
      let worstD = min;
      for (let i = 0; i < f.length / 2; i++) {
        if (i === self) continue;
        const d = Math.hypot(px - f[i * 2], py - f[i * 2 + 1]);
        if (d < worstD) {
          worst = i;
          worstD = d;
        }
      }
      if (worst < 0) break;
      let vx = px - f[worst * 2];
      let vy = py - f[worst * 2 + 1];
      let d = Math.hypot(vx, vy);
      if (d < 1e-6) {
        // 正好压在别人身上 ⇒ 方向没定义。往正后方退，那是队形里最不打眼的空位
        vx = -1;
        vy = 0;
        d = 1;
      }
      px = f[worst * 2] + (vx / d) * min;
      py = f[worst * 2 + 1] + (vy / d) * min;
    }
    return [r0(px), r0(py)];
  }

  private readDraft(): StoredDraft | null {
    const raw = this.storage?.read(this.key);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as StoredDraft;
      if (!parsed || typeof parsed.rev !== 'number' || !parsed.draft) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  private bump(): void {
    this.changed.value += 1;
  }
}

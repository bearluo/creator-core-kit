/**
 * 内容编辑器的逻辑层 —— **零 `cc`，node 直跑**。设计见
 * `docs/design/2026-08-31-mini-fish-content-editor.md` §4。
 *
 * View（`FishEditor.ts`）只做仓规允许的四件事：instantiate prefab、建绑定、把屏幕坐标转成
 * 世界坐标后转发、转发生命周期。**命中判定和拖拽落点算逻辑不算 View** —— 它们是世界坐标上的
 * 纯数学，放 View 里就没法在 node 里问「点这儿抓不抓得到把手」。
 *
 * **收成一个 VM 而不是三个**（PathListVM / WaveVM / DraftVM）：编辑器的状态互相牵连 ——
 * 删一条路径要让引用它的 group 进未解析态，拆开就得在 VM 之间再造一套同步，而那正是最容易
 * 出错的一处。
 *
 * ⚠️ **预览不在这里**：「编的是什么」归本 VM，「它长什么样」归 `FishVM`（直接跑游戏本体那套
 * system，见 §5）。混进来本 VM 就得认识 ECS 世界，而它本该只是一坨纯数据操作。
 */
import { signal, type Signal } from '@cck/core';
import type { FishContent, FishGroup } from '../mini-fish/content/content-types';

/** 草稿态的一条路径。跟 {@link FishContent} 的区别只有一个：可变。 */
export interface DraftPath {
  id: string;
  p: number[];
}

/** 草稿态的一个 group。`gap` 在这里**一定有值**（载入时补 0），View 不必到处 `?? 0`。 */
export interface DraftGroup {
  at: number;
  path: string;
  kind: string;
  count: number;
  gap: number;
  speed: number;
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
        count: g.count,
        gap: g.gap ?? 0,
        speed: g.speed,
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

  /**
   * 选中路径上离 `(x, y)` 最近的控制点，超出 `tol` 返回 `null`。
   * 世界坐标进世界坐标出 —— 屏幕坐标的换算是 View 的事（它才知道画布多大）。
   */
  hitTest(x: number, y: number, tol: number): number | null {
    const path = this.draft.paths[this.selectedPath];
    if (!path) return null;
    let best = -1;
    let bestD = tol;
    for (let i = 0; i < 4; i++) {
      const d = Math.hypot(x - path.p[i * 2], y - path.p[i * 2 + 1]);
      if (d <= bestD) {
        best = i;
        bestD = d;
      }
    }
    return best < 0 ? null : best;
  }

  /** 把选中路径的第 `index` 个控制点挪到 `(x, y)`。 */
  dragPoint(index: number, x: number, y: number): void {
    const path = this.draft.paths[this.selectedPath];
    if (!path || index < 0 || index > 3) return;
    path.p[index * 2] = x;
    path.p[index * 2 + 1] = y;
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

  // —— 导出 ————————————————————————————————————————————————————————

  /** 当前草稿的纯数据投影。**不动 `rev`** —— 预览用它，预览不是发布。 */
  toContent(): FishContent {
    return {
      rev: this.draft.rev,
      paths: this.draft.paths.map((it) => ({ id: it.id, p: it.p.slice() })),
      waves: this.draft.waves.map((w) => ({
        id: w.id,
        groups: w.groups.map((g) => this.trimGroup(g)),
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
    const group = (g: DraftGroup): string => {
      const t = this.trimGroup(g);
      const gap = t.gap === undefined ? '' : `, gap: ${t.gap}`;
      return `{ at: ${t.at}, path: ${q(t.path)}, kind: ${q(t.kind)}, count: ${t.count}${gap}, speed: ${t.speed} }`;
    };
    const lines: string[] = [];
    lines.push('/**');
    lines.push(' * 捕鱼的内容数据：路径几何 + 鱼阵编排。');
    lines.push(' *');
    lines.push(' * ⚠️ **这个文件是编辑器导出的全文**（`mini-fish-editor`：复制 → 人 `Ctrl+V` 覆盖 → `git diff`');
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
    return { at: 0, path, kind: 'fish_yellow', count: 4, gap: 0.3, speed: 120 };
  }

  /** `gap` 为 0 就不写进数据 —— 默认值不该占一行 diff。 */
  private trimGroup(g: DraftGroup): FishGroup {
    const base = { at: g.at, path: g.path, kind: g.kind, count: g.count, speed: g.speed };
    return g.gap === 0 ? base : { ...base, gap: g.gap };
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

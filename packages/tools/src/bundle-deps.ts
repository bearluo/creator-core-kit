/**
 * bundle 归属漂移检查 —— 跨包**资源**依赖只许指向**声明过的**共享仓。
 *
 * Creator 把「被多包引用的资源」判给**优先级最高**的引用者，其余包降级成 `cc.config` 的
 * `deps` + `redirect`（「去那个包拿」）。归属因此随引用关系漂移，而漂移是**静默**的：
 * 构建全绿、manifest 正常、热更下发成功，直到运行时在 `redirect` 指向的包里找不到资源。
 *
 * 两种漂法都在 demo 真实产物里出过（2026-08-20）：
 * - **漂进 AOT**：`boot`（→`main`，priority 7）与 6 个皮包共用一张内置图 → 图归 `main`，
 *   皮包变成 `deps:["main"]`。而 `main` 只随 APK 更新 —— 热更下去的皮包引用一个旧 APK 的
 *   `main` 里没有的 uuid，界面一开就挂。改的还不是那个皮包，是 boot。
 * - **跨马甲漂**：两个马甲的地基皮包同为 priority 2、都引用它 → Creator 挑了
 *   `skin-default-foundation`，于是 `skin-vest-lobby`/`skin-vest-mail` 依赖 default 马甲的包，
 *   马甲隔离直接破掉。
 *
 * 能二值化的规则：跨包**资源**依赖只许指向 `shared` 白名单里的包。能进白名单的条件是它的
 * priority **严格高于**所有引用者 —— 同级会被抢（上面第二种漂法），所以**仓可以有多个**。
 * demo 只有 `resources`（priority 8 是工程里最高的，谁也抢不走 → 归属钉死）。
 * 要共用一张 Creator 内置图，就在共享仓里放一个**钉子 prefab** 引用它一次 —— 仓的优先级最高，
 * 归属被它吸走后谁也抢不动，而工程各处照常引用 `db://internal`、一行都不用改。
 *
 * 本模块管**三道闸**，各拦一类：
 * - **产物侧** {@link collectBundleDeps} + {@link findDepViolations}：出 manifest 前扫 `cc.config`，
 *   已经漂了的一律拒发。
 * - **源码侧** {@link scanAssetRefs} + {@link findUnpinnedRefs}：扫 `assets/`，引用了外部资源却没钉
 *   的直接报。产物侧漏得掉这一类 —— 一个外部资源**只被一个包**引用时不产生 `deps`，当场看不出问题，
 *   等哪天第二个包也用它才漂。源码侧不用构建就能查，适合挂进提交前的门控。
 * - **拓扑侧** {@link scanCodeEdges} + {@link findEdgeViolations}：扫 `assets/` 的 `import`，
 *   跨包代码边只许指向**优先级更高**的包。上面两道都只看**资源** —— Creator 的 `cc.config.deps`
 *   压根不记脚本依赖（demo 实测：`modules/lobby` import 了 4 处地基，产物里 `deps: []`），
 *   循环依赖与「主包 import 地基」这类倒挂在那两道闸下面是隐形的。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** 一个 bundle 借了谁。 */
export interface BundleDeps {
  /** bundle 名（`assets/` 下的目录名）。 */
  name: string;
  /** 被借的包 → 借过去的 uuid 列表（`deps` 里有、`redirect` 没提到的记空数组）。 */
  borrows: Record<string, string[]>;
}

/** 违规的一条跨包依赖。 */
export interface DepViolation {
  bundle: string;
  dep: string;
  uuids: string[];
}

/** 默认允许被借的共享仓。`resources` 在 Creator 里 priority 8，工程内最高、抢不走。 */
export const DEFAULT_SHARED_BUNDLES: readonly string[] = ['resources'];

/**
 * 从 native/web 构建产物读出每个 bundle 的跨包依赖。
 *
 * 读的是 `assets/<bundle>/cc.config[.<md5>].json` 的 `deps` + `redirect`：
 * `redirect` 是 `[uuid, depIndex, uuid, depIndex, …]` 的扁平表，`depIndex` 索引进 `deps`。
 * 没有 `cc.config` 的目录（不是 bundle）与读不动的文件一律跳过 —— 这是发布前的守卫，
 * 不该因为产物里多了个无关目录就炸。
 */
export function collectBundleDeps(dataRoot: string): BundleDeps[] {
  const dir = join(dataRoot, 'assets');
  if (!existsSync(dir)) return [];
  const out: BundleDeps[] = [];
  for (const name of readdirSync(dir).sort()) {
    let files: string[];
    try {
      files = readdirSync(join(dir, name));
    } catch {
      continue; // 不是目录
    }
    const cfg = files.find((f) => f.startsWith('cc.config') && f.endsWith('.json'));
    if (cfg === undefined) continue;
    let parsed: { deps?: unknown; redirect?: unknown };
    try {
      parsed = JSON.parse(readFileSync(join(dir, name, cfg), 'utf8')) as typeof parsed;
    } catch {
      continue;
    }
    const deps = Array.isArray(parsed.deps) ? parsed.deps.map((d) => String(d)) : [];
    if (deps.length === 0) continue;
    const borrows: Record<string, string[]> = {};
    for (const d of deps) borrows[d] = [];
    const red = Array.isArray(parsed.redirect) ? parsed.redirect : [];
    for (let i = 0; i + 1 < red.length; i += 2) {
      const dep = deps[Number(red[i + 1])];
      if (dep === undefined) continue; // 索引越界的脏表，忽略这一条
      borrows[dep].push(String(red[i]));
    }
    out.push({ name, borrows });
  }
  return out;
}

/** 挑出目标不在 `shared` 里的跨包依赖。空数组 = 归属没漂。 */
export function findDepViolations(
  list: readonly BundleDeps[],
  shared: readonly string[] = DEFAULT_SHARED_BUNDLES,
): DepViolation[] {
  const ok = new Set(shared);
  const out: DepViolation[] = [];
  for (const b of list)
    for (const [dep, uuids] of Object.entries(b.borrows))
      if (!ok.has(dep)) out.push({ bundle: b.name, dep, uuids });
  return out;
}

/** 源码期扫出来的引用关系（`scanAssetRefs` 的产物，喂给 `findUnpinnedRefs`）。 */
export interface AssetRefs {
  /** 工程自己拥有的 uuid：每份 `.meta` 的 `uuid` 加它 `subMetas` 里的（`<uuid>@<id>` 形态）。 */
  owned: string[];
  /** 每个资产文件引用到的 uuid。`file` 是相对 `assets/` 的 POSIX 路径。 */
  refs: { file: string; uuids: string[] }[];
}

/** 引用了却没被钉进共享仓的外部资源。 */
export interface UnpinnedRef {
  uuid: string;
  /** 引用它的文件（相对 `assets/`，已排序去重）。 */
  files: string[];
}

/** 会被扫的资产文件后缀 —— 只有这些格式里会出现 `__uuid__` 引用。 */
const REF_BEARING = ['.prefab', '.scene', '.material', '.anim', '.mtl', '.plist'];

const posix = (p: string): string => p.split(sep).join('/');

function walk(dir: string, base: string, out: string[]): void {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, base, out);
    else out.push(posix(relative(base, p)));
  }
}

/**
 * 扫工程的 `assets/` 目录：谁拥有哪些 uuid、谁引用了哪些 uuid。
 *
 * 「拥有」看 `.meta`（含 `subMetas`，因为 `20835ba4-…@f9941` 这种子资源 uuid 才是被引用的那个）；
 * 「引用」只认 {@link REF_BEARING} 那几种文本资产里的 `"__uuid__": "…"`。
 * 目录不存在返回空结果，读不动的文件跳过 —— 它是门控，不该被一个脏文件掀翻。
 */
export function scanAssetRefs(assetsRoot: string): AssetRefs {
  if (!existsSync(assetsRoot)) return { owned: [], refs: [] };
  const files: string[] = [];
  walk(assetsRoot, assetsRoot, files);

  const owned: string[] = [];
  const refs: { file: string; uuids: string[] }[] = [];
  for (const f of files) {
    let text: string;
    try {
      text = readFileSync(join(assetsRoot, f), 'utf8');
    } catch {
      continue;
    }
    if (f.endsWith('.meta')) {
      let m: { uuid?: unknown; subMetas?: Record<string, unknown> };
      try {
        m = JSON.parse(text) as typeof m;
      } catch {
        continue;
      }
      if (typeof m.uuid === 'string') owned.push(m.uuid);
      for (const s of Object.values(m.subMetas ?? {})) {
        const u = (s as { uuid?: unknown } | null)?.uuid;
        if (typeof u === 'string') owned.push(u);
      }
      continue;
    }
    if (!REF_BEARING.some((ext) => f.endsWith(ext))) continue;
    const uuids = Array.from(text.matchAll(/"__uuid__"\s*:\s*"([^"]+)"/g), (x) => x[1]);
    if (uuids.length > 0) refs.push({ file: f, uuids });
  }
  return { owned, refs: refs.sort((a, b) => a.file.localeCompare(b.file)) };
}

/**
 * 挑出「引用了外部资源、但共享仓没钉」的 uuid。
 *
 * 外部 = 被引用却不在 `owned` 里 —— 也就是 Creator 内置库（`db://internal` 等）的资源。
 * 钉住 = 共享仓（`pinPrefix` 下的任何资产，demo 是 `resources/internal-pin.prefab`）也引用了它：
 * 仓的 bundle 优先级最高，被它引用的资源归属就落在仓里、谁也抢不动。
 *
 * 没钉的那些归属由「谁优先级高」决定，会随引用关系漂 —— 漂进 AOT 就热更不了，
 * 漂到别的马甲就破了隔离。判据与实况见模块文档。
 */
export function findUnpinnedRefs(scan: AssetRefs, pinPrefix = 'resources/'): UnpinnedRef[] {
  const owned = new Set(scan.owned);
  const external = (u: string): boolean => !owned.has(u);
  const pinned = new Set(
    scan.refs.filter((r) => r.file.startsWith(pinPrefix)).flatMap((r) => r.uuids).filter(external),
  );
  const byUuid = new Map<string, Set<string>>();
  for (const r of scan.refs) {
    if (r.file.startsWith(pinPrefix)) continue;
    for (const u of r.uuids) {
      if (!external(u) || pinned.has(u)) continue;
      const files = byUuid.get(u) ?? new Set<string>();
      files.add(r.file);
      byUuid.set(u, files);
    }
  }
  return Array.from(byUuid.entries())
    .map(([uuid, files]) => ({ uuid, files: Array.from(files).sort() }))
    .sort((a, b) => a.uuid.localeCompare(b.uuid));
}

// ─────────────────────────────────────────────────────────────────────────────
// 第三道闸：跨包**代码**边的拓扑单调
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 一个 bundle 在拓扑里的位置。`priority` 直接用 Creator 的 bundle 优先级 ——
 * 不另立一套排名，免得同一件事有两个真相源。
 */
export interface BundleNode {
  /** bundle 名（目录 meta 里 `bundleName` 覆盖过就用覆盖的）。 */
  name: string;
  /** 相对 `assets/` 的 POSIX 目录路径。主包是 `''`：没被任何 bundle 目录圈住的都归它。 */
  dir: string;
  /** Creator 的 bundle 优先级，越大越底层。 */
  priority: number;
}

/** 一条跨包代码边：`file` 里的 `import` 落在了别的包。 */
export interface CodeEdge {
  from: string;
  to: string;
  /** 引用发生在哪个文件（相对 `assets/`）。 */
  file: string;
  /** 被引到的路径（相对 `assets/`，不带扩展名）。 */
  target: string;
}

/** 违反拓扑单调的一条边。 */
export interface EdgeViolation extends CodeEdge {
  fromPriority: number;
  toPriority: number;
}

/**
 * 主包。`assets/` 下没被任何 bundle 目录圈住的脚本（demo 的 `boot/`）都归它，
 * priority 7 是 Creator 给内置 `main` 的固定值。
 */
export const MAIN_BUNDLE: BundleNode = { name: 'main', dir: '', priority: 7 };

/** 扫 `assets/` 的目录 meta，读出整张拓扑。永远含主包，按优先级从高到低排。 */
export function readBundles(assetsRoot: string): BundleNode[] {
  const out: BundleNode[] = [MAIN_BUNDLE];
  if (!existsSync(assetsRoot)) return out;
  const files: string[] = [];
  walk(assetsRoot, assetsRoot, files);
  for (const f of files) {
    if (!f.endsWith('.meta')) continue;
    let m: { userData?: Record<string, unknown> };
    try {
      m = JSON.parse(readFileSync(join(assetsRoot, f), 'utf8')) as typeof m;
    } catch {
      continue;
    }
    const u = m.userData;
    if (u?.isBundle !== true) continue;
    const dir = f.slice(0, -'.meta'.length);
    const named = typeof u.bundleName === 'string' && u.bundleName !== '' ? u.bundleName : undefined;
    out.push({
      name: named ?? (dir.split('/').pop() as string),
      dir,
      priority: typeof u.priority === 'number' ? u.priority : 1,
    });
  }
  return out.sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));
}

/** 一个文件归哪个包 —— 最长目录前缀说了算（`skins/default/mail` 赢过 `skins/default`）。 */
export function bundleOf(file: string, bundles: readonly BundleNode[]): BundleNode {
  let best = MAIN_BUNDLE;
  for (const b of bundles)
    if (b.dir !== '' && file.startsWith(`${b.dir}/`) && b.dir.length > best.dir.length) best = b;
  return best;
}

/**
 * `import x from '…'` / `export … from '…'` / `import '…'`，跳过纯类型的那两种。
 *
 * `[^;]*?` 让多行 import 也能匹配，同时挡住「本条没有 from、扫进下一条」。
 * `import { type A } from` 仍算值引用 —— 判不准的一律当真边，宁可多报。
 */
const IMPORT_FROM = /(?:^|\n)[ \t]*(?:import|export)[ \t]+(?!type[ \t{])[^;]*?from[ \t]*['"]([^'"]+)['"]/g;
const IMPORT_BARE = /(?:^|\n)[ \t]*import[ \t]*['"]([^'"]+)['"]/g;

/** 把相对 specifier 解成相对 `assets/` 的路径；爬出 `assets/` 的返回 undefined。 */
function resolveRel(fromFile: string, spec: string): string | undefined {
  const out: string[] = [];
  for (const p of fromFile.split('/').slice(0, -1).concat(spec.split('/'))) {
    if (p === '' || p === '.') continue;
    if (p === '..') {
      if (out.pop() === undefined) return undefined;
      continue;
    }
    out.push(p);
  }
  return out.join('/');
}

/**
 * 扫 `assets/` 下的 `.ts`，收出所有**跨包**代码边。
 *
 * 只认相对路径的 import：`cc` / `@cck/*` / npm 包都在 AOT 里，不构成包间边。
 * 纯类型 import 编译期就擦掉了，不是运行时依赖，跳过 —— demo 主包拿地基正是靠这个缝
 * （`boot/foundation-api.ts`）。
 */
export function scanCodeEdges(
  assetsRoot: string,
  bundles: readonly BundleNode[] = readBundles(assetsRoot),
): CodeEdge[] {
  if (!existsSync(assetsRoot)) return [];
  const files: string[] = [];
  walk(assetsRoot, assetsRoot, files);
  const out: CodeEdge[] = [];
  for (const f of files) {
    if (!f.endsWith('.ts') || f.endsWith('.d.ts')) continue;
    let text: string;
    try {
      text = readFileSync(join(assetsRoot, f), 'utf8');
    } catch {
      continue;
    }
    const from = bundleOf(f, bundles);
    const specs = Array.from(text.matchAll(IMPORT_FROM), (m) => m[1]).concat(
      Array.from(text.matchAll(IMPORT_BARE), (m) => m[1]),
    );
    for (const spec of specs) {
      if (!spec.startsWith('.')) continue;
      const target = resolveRel(f, spec);
      if (target === undefined) continue;
      const to = bundleOf(target, bundles);
      if (to.name === from.name) continue;
      out.push({ from: from.name, to: to.name, file: f, target });
    }
  }
  return out.sort((a, b) => a.file.localeCompare(b.file) || a.target.localeCompare(b.target));
}

/**
 * 挑出违反拓扑单调的边：**依赖只许指向优先级更高的包**。
 *
 * 严格递增就意味着拓扑序天然存在 —— **循环依赖不可能成立**，不需要另跑环检测。
 * 顺带拦住两类已经踩过的：同级互引（两个马甲 / 两个模块彼此拽住，一起卸不掉），
 * 以及倒挂（主包 import 地基的值 → 地基被判给 AOT，热更当场失效）。
 * 认不出的包按主包算 —— 拓扑外的东西不该被默默放行。
 */
export function findEdgeViolations(
  edges: readonly CodeEdge[],
  bundles: readonly BundleNode[],
): EdgeViolation[] {
  const rank = new Map(bundles.map((b) => [b.name, b.priority]));
  const out: EdgeViolation[] = [];
  for (const e of edges) {
    const fromPriority = rank.get(e.from) ?? MAIN_BUNDLE.priority;
    const toPriority = rank.get(e.to) ?? MAIN_BUNDLE.priority;
    if (toPriority > fromPriority) continue;
    out.push({ ...e, fromPriority, toPriority });
  }
  return out;
}

/** 把拓扑画成 mermaid —— 图由源码生成，不手工维护，也就不会过期。 */
export function toMermaid(bundles: readonly BundleNode[], edges: readonly CodeEdge[]): string {
  const id = (n: string): string => n.replace(/[^A-Za-z0-9_]/g, '_');
  const lines = ['graph BT'];
  for (const b of bundles) lines.push(`  ${id(b.name)}["${b.name} · ${b.priority}"]`);
  const seen = new Set<string>();
  for (const e of edges) {
    const key = `${e.from}>${e.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(`  ${id(e.from)} --> ${id(e.to)}`);
  }
  return lines.join('\n');
}

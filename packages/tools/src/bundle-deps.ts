/**
 * bundle 归属漂移检查 —— 跨包依赖只许指向**一个**共享仓。
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
 *   `skin-base-foundation`，于是 `skin-vest-lobby`/`skin-vest-mail` 依赖 base 马甲的包，
 *   马甲隔离直接破掉。
 *
 * 唯一能二值化的规则：**共享资源只能有一个仓**。跨包依赖只许指向 `shared` 里的包
 * （demo 用 `resources` —— priority 8 是工程里最高的，谁也抢不走 → 归属钉死）。
 * 要共用一张 Creator 内置图，就在共享仓里放一个**钉子 prefab** 引用它一次 —— 仓的优先级最高，
 * 归属被它吸走后谁也抢不动，而工程各处照常引用 `db://internal`、一行都不用改。
 *
 * 本模块管**两道闸**，缺一不可：
 * - **产物侧** {@link collectBundleDeps} + {@link findDepViolations}：出 manifest 前扫 `cc.config`，
 *   已经漂了的一律拒发。
 * - **源码侧** {@link scanAssetRefs} + {@link findUnpinnedRefs}：扫 `assets/`，引用了外部资源却没钉
 *   的直接报。产物侧漏得掉这一类 —— 一个外部资源**只被一个包**引用时不产生 `deps`，当场看不出问题，
 *   等哪天第二个包也用它才漂。源码侧不用构建就能查，适合挂进提交前的门控。
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

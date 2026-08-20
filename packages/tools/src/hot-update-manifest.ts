/**
 * 热更 manifest 生成/校验（出包期 node 工具，零 cc）。
 * 格式严格对齐 Cocos 官方 version_generator.js：crypto md5(hex) + stat.size + .zip→compressed，
 * key = 相对 root 的正斜杠 + encodeURI 路径；version.manifest = 删 assets + searchPaths。
 * 产物由 engine 半的 native.AssetsManager 后端消费（见 packages/core/docs/modules/hotupdate-service.md）。
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';

/** manifest 里单个文件条目。 */
export interface AssetEntry {
  size: number;
  md5: string;
  compressed?: boolean;
}

/** Cocos 标准 project.manifest 结构。 */
export interface Manifest {
  packageUrl: string;
  remoteManifestUrl: string;
  remoteVersionUrl: string;
  version: string;
  assets: Record<string, AssetEntry>;
  searchPaths: string[];
}

/** version.manifest = Manifest 去掉 assets + searchPaths。 */
export type VersionManifest = Omit<Manifest, 'assets' | 'searchPaths'>;

export interface ManifestOptions {
  /** native 构建数据根目录（含 src/ assets/ [jsb-adapter/]）。 */
  root: string;
  /** 远程资源根 URL；内部确保以 / 结尾。 */
  packageUrl: string;
  version: string;
  /** 遍历子目录，默认 ['src','assets','jsb-adapter']（不存在的跳过）。 */
  dirs?: string[];
  /**
   * 额外收进来的**散文件**，相对 root（不存在的跳过）。给产物根上那些不在任何子目录里、
   * 却必须随 base 一起更新的文件用 —— 目前只有 AOT 入口 `application.<md5>.js`
   * （`main.js` 经 `src/cck-aot.json` 指针找到它，见 hotupdate-pipeline「AOT 入口」一节）。
   *
   * ⚠️ 别把 `main.js` 放进来：它跑在搜索路径还原**之前**，还原本身就是它干的，下发了也没人读。
   */
  files?: readonly string[];
  /** 远程 manifest 文件名，默认 'project.manifest'。 */
  manifestFilename?: string;
  /** 远程 version 文件名，默认 'version.manifest'。 */
  versionFilename?: string;
  /** 搜索路径，默认 []。 */
  searchPaths?: string[];
}

export interface WriteResult {
  projectPath: string;
  versionPath: string;
  manifest: Manifest;
}

export type VerifyIssue = {
  path: string;
  reason: 'missing' | 'size-mismatch' | 'md5-mismatch';
};

const DEFAULT_DIRS = ['src', 'assets', 'jsb-adapter'];

/** 保证末尾恰好一个 /。 */
function withSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

/** 递归收集目录下全部文件绝对路径；跳过隐藏项（basename 以 . 开头，对齐官方）。 */
function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.')) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walkFiles(full));
    else if (st.isFile()) out.push(full);
  }
  return out;
}

/** 单文件 → md5(hex) + size（+ .zip 标 compressed）。全文件读取，构建期非热路径。 */
function hashFile(file: string): AssetEntry {
  const buf = readFileSync(file);
  const entry: AssetEntry = {
    size: buf.length,
    md5: createHash('md5').update(buf).digest('hex'),
  };
  if (extname(file) === '.zip') entry.compressed = true;
  return entry;
}

/** asset key：相对 root、正斜杠、URI 编码（对齐官方 version_generator）。 */
function assetKey(root: string, file: string): string {
  return encodeURI(relative(root, file).split(sep).join('/'));
}

/** 遍历 root/dirs 算 md5+size，产出完整 project manifest 对象（读 fs 不落盘）。 */
export function buildManifest(opts: ManifestOptions): Manifest {
  const dirs = opts.dirs ?? DEFAULT_DIRS;
  const packageUrl = withSlash(opts.packageUrl);
  const manifestFilename = opts.manifestFilename ?? 'project.manifest';
  const versionFilename = opts.versionFilename ?? 'version.manifest';

  const assets: Record<string, AssetEntry> = {};
  for (const d of dirs) {
    const abs = join(opts.root, d);
    if (!existsSync(abs)) continue;
    for (const f of walkFiles(abs)) assets[assetKey(opts.root, f)] = hashFile(f);
  }
  for (const f of opts.files ?? []) {
    const abs = join(opts.root, f);
    if (!existsSync(abs) || !statSync(abs).isFile()) continue;
    assets[assetKey(opts.root, abs)] = hashFile(abs);
  }

  return {
    packageUrl,
    remoteManifestUrl: packageUrl + manifestFilename,
    remoteVersionUrl: packageUrl + versionFilename,
    version: opts.version,
    assets,
    searchPaths: opts.searchPaths ?? [],
  };
}

/** 派生精简版本清单（删 assets + searchPaths）。 */
export function toVersionManifest(m: Manifest): VersionManifest {
  return {
    packageUrl: m.packageUrl,
    remoteManifestUrl: m.remoteManifestUrl,
    remoteVersionUrl: m.remoteVersionUrl,
    version: m.version,
  };
}

/** 落一对 project/version manifest 到 outDir。 */
function writePair(outDir: string, manifest: Manifest, projFile: string, verFile: string): WriteResult {
  const projectPath = join(outDir, projFile);
  const versionPath = join(outDir, verFile);
  writeFileSync(projectPath, JSON.stringify(manifest, null, 2));
  writeFileSync(versionPath, JSON.stringify(toVersionManifest(manifest), null, 2));
  return { projectPath, versionPath, manifest };
}

/** buildManifest + toVersionManifest 后写两份到 outDir（默认 = root）。 */
export function writeManifests(opts: ManifestOptions & { outDir?: string }): WriteResult {
  return writePair(
    opts.outDir ?? opts.root,
    buildManifest(opts),
    opts.manifestFilename ?? 'project.manifest',
    opts.versionFilename ?? 'version.manifest',
  );
}

/**
 * 归入 base 的 `assets/<name>/`：Cocos native 产物里的主包与内置包，和 `src/` 同属「换了要重启」层，
 * 本就该跟 base 同批更新。其余 `assets/<name>/` 各自成包。
 */
/** 归 AOT 的内建包：随主包走，不独立成热更单元（native 归 base manifest，web 不进版本表）。 */
export const DEFAULT_AOT_BUNDLES = ['main', 'internal', 'resources'];

/**
 * 与引擎绑死、或名字被 `main.js` 写死的产物 —— **一个都不下发**（见 {@link SplitManifestOptions.contentHashed}）。
 * key 是相对 data 根的正斜杠路径。
 */
const ENGINE_BOUND: readonly RegExp[] = [
  /^src\/cocos-js\//, // 引擎 JS，与 libcocos.so 是同一次构建的两半
  /^src\/effect\.bin$/, // 引擎 UBO / descriptor 布局表，且固定名无 md5
  /^jsb-adapter\//, // JS 侧 native 绑定层
  /^src\/system\.bundle(\.[^/.]+)?\.js$/, // main.js 里 require 的字面量
  /^src\/polyfills(\.[^/.]+)?\.js$/, // 同上
  /^src\/import-map(\.[^/.]+)?\.json$/, // 同上 + 兼任引擎身份凭据（imports.cc）
];

/** 这个 asset key 是不是「与引擎绑死 / 名字写死」那一类。 */
export function isEngineBound(key: string): boolean {
  return ENGINE_BOUND.some((re) => re.test(key));
}

export interface SplitManifestOptions extends ManifestOptions {
  /** 归入 base 的 assets 子目录名。默认 {@link DEFAULT_AOT_BUNDLES}。 */
  aotBundles?: readonly string[];
  /**
   * **上一次发布**的 manifest 所在目录（通常就是 CDN 目录）。给了之后，内容与上一版逐字节相同的
   * manifest **沿用上一版的 version**，只有真改了的包才涨版本 → 没动的 bundle 客户端直接
   * ALREADY_UP_TO_DATE，不再空跑一轮「下载 0 个文件」。
   *
   * ⚠️ 必须指向**紧邻的上一次发布**，不能是更早的历史版本：内容比对只看一版。若指向两版之前、
   * 而本次内容恰好与那一版相同，就会发出一个比客户端手里更旧的版本号，客户端判定 up-to-date
   * 而停在中间那版的内容上。
   */
  prevDir?: string;
  /**
   * 产物是**内容寻址**的（Creator 构建开了 `md5Cache`）。开了之后 base manifest 丢掉
   * {@link isEngineBound} 那几类 —— **只丢引擎那一半，AOT 照发**。
   *
   * AOT 之所以发得出去，是因为 `main.js` 不再写死入口名：它读固定名指针 `src/cck-aot.json`
   * 拿到 `application.<md5>.js`，而那一段跑在搜索路径**还原之后**。于是
   * `application.<md5>.js` → `settings.<md5>.json` → `chunks/**` + `assets/{main,resources,internal}`
   * 整条链都随 base 更新走、重启生效。见 `docs/design/2026-08-20-aot-hotupdate-unlock-proposal.md`。
   *
   * 丢掉的那几类**一个都不许下发**，理由分两种：
   *
   * - `src/cocos-js/**`、`src/effect.bin`、`jsb-adapter/**` —— 与 `libcocos.so` 里的 C++ 是
   *   **同一次引擎构建的两半**：换引擎版本或改模块勾选，两边一起变、`.so` 必须重编。单独下发
   *   新 JS 配旧 `.so` 就是崩在绑定层，而它想修的东西本来也只能随包发。
   * - `src/system.bundle.*.js`、`src/polyfills.*.js`、`src/import-map*.json` —— 名字写死在
   *   `main.js` 里（`require("src/system.bundle.<md5>.js")`），新文件下下来没人念。`import-map`
   *   还兼任引擎身份凭据（`imports.cc` → `engineHash()`），能热更就等于版本闸可伪造，**故意不解**。
   *
   * 不开这个开关（同名不同内容的老产物）时 base 照收全表，行为不变。
   *
   * 模块 bundle 不受影响：它们的 `index.<md5>.js` 由客户端显式传 version 加载
   * （版本从这张 manifest 自己反推，见 core 的 `bundleVersionFromAssetKeys`）。
   */
  contentHashed?: boolean;
}

export interface SplitManifests {
  base: Manifest;
  /** 键 = bundle 名；空目录不产出。 */
  bundles: Record<string, Manifest>;
}

export interface SplitWriteResult {
  base: WriteResult;
  bundles: Record<string, WriteResult>;
}

/** 读上一版已发布的 manifest；不存在 / 读不动 / 不是 JSON → undefined（当没有上一版，照常用新版本号）。 */
function readPrevManifest(dir: string, file: string): Manifest | undefined {
  const p = join(dir, file);
  if (!existsSync(p)) return undefined;
  try {
    const m = JSON.parse(readFileSync(p, 'utf8')) as Manifest;
    return typeof m.version === 'string' && m.assets ? m : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 内容是否与上一版完全一致——**只比资产表**（key + md5 + size + compressed），`packageUrl` /
 * `searchPaths` 一概不看。
 *
 * **口径必须与引擎的 `Manifest::genDiff` 一致，这是硬约束不是取舍**：引擎判断"要不要下载"时也只比
 * 资产表。凡是我们判"改了"而引擎判"没改"的字段，产出的都是「版本号涨了、引擎却算出空 diff」——
 * 而 `AssetsManagerEx` 在那个状态下会崩：`prepareUpdateAsync` 的 worker 线程任务体里遇
 * `diffMap.empty()` 就地 `updateSucceed()`，绕开本该把回调弹回主线程的 `prepareFinished`，
 * `UPDATE_FINISHED` 于是在非主线程进 JS VM → `se::AutoHandleScope` SIGSEGV。
 *
 * 换 CDN 地址因此**不该**、也**不需要**涨版本：客户端查更新用的是本地 manifest 里烘的地址
 * （`AssetsManagerEx.cpp:580/623`），老地址死了涨版本也救不回来；而本框架的客户端一律经 dispatcher
 * 下发的 `cdn_url` 自取 remote manifest 并改写基址（engine 的 `startCheck`），包内烘的那个地址
 * 根本没人读。换址只改服务端配置。
 */
function sameContent(a: Manifest, b: Manifest): boolean {
  const ka = Object.keys(a.assets).sort();
  const kb = Object.keys(b.assets).sort();
  if (ka.length !== kb.length) return false;
  return ka.every((k, i) => {
    if (k !== kb[i]) return false;
    const x = a.assets[k];
    const y = b.assets[k];
    return x.md5 === y.md5 && x.size === y.size && !!x.compressed === !!y.compressed;
  });
}

/**
 * 切分成「base 一份 + 每个模块 bundle 一份」，供 native 分包热更（一 bundle 一 AssetsManager）。
 *
 * **所有 manifest 的 asset key 一律相对 data 根**（`assets/shop/index.js`），bundle manifest 只是全表的
 * 子集——下载落盘后相对各自 storagePath 的目录结构必须与包内一致，搜索路径前缀一挂才解析得到；
 * key 若相对 bundle 目录，引擎按 `assets/shop/index.js` 查会直接 miss。
 */
export function buildSplitManifests(opts: SplitManifestOptions): SplitManifests {
  const whole = buildManifest(opts);
  const aot = new Set(opts.aotBundles ?? DEFAULT_AOT_BUNDLES);
  const packageUrl = withSlash(opts.packageUrl);

  const baseAssets: Record<string, AssetEntry> = {};
  const byBundle = new Map<string, Record<string, AssetEntry>>();
  for (const [key, entry] of Object.entries(whole.assets)) {
    // 只有 assets/<name>/… 才可能独立成包；assets/ 下的散文件与其它顶层目录归 base。
    const name = /^assets\/([^/]+)\//.exec(key)?.[1];
    if (name !== undefined && !aot.has(name)) {
      let table = byBundle.get(name);
      if (!table) byBundle.set(name, (table = {}));
      table[key] = entry;
      continue;
    }
    // 内容寻址产物：只把引擎那一半挡在外面，AOT 照发。见 contentHashed。
    if (opts.contentHashed && isEngineBound(key)) continue;
    baseAssets[key] = entry;
  }

  const mk = (assets: Record<string, AssetEntry>, projFile: string, verFile: string): Manifest => {
    const m: Manifest = {
      packageUrl,
      remoteManifestUrl: packageUrl + projFile,
      remoteVersionUrl: packageUrl + verFile,
      version: opts.version,
      assets,
      searchPaths: opts.searchPaths ?? [],
    };
    // 内容没动 → 沿用上一版的 version（见 prevDir 注释）。版本号只在内容变时前进，仍单调递增，
    // 因此不碰引擎默认的 cmpVersion（它 sscanf "%d.%d.%d.%d" 逐段比，非数字才退化成 strcmp）。
    const prev = opts.prevDir === undefined ? undefined : readPrevManifest(opts.prevDir, projFile);
    return prev && sameContent(m, prev) ? { ...m, version: prev.version } : m;
  };

  const bundles: Record<string, Manifest> = {};
  for (const [name, assets] of byBundle) {
    bundles[name] = mk(assets, `${name}.manifest`, `${name}.version.manifest`);
  }
  return {
    base: mk(baseAssets, opts.manifestFilename ?? 'project.manifest', opts.versionFilename ?? 'version.manifest'),
    bundles,
  };
}

/** buildSplitManifests 后逐份落盘到 outDir（默认 = root）。 */
export function writeSplitManifests(opts: SplitManifestOptions & { outDir?: string }): SplitWriteResult {
  const outDir = opts.outDir ?? opts.root;
  const { base, bundles } = buildSplitManifests(opts);
  const out: SplitWriteResult = {
    base: writePair(
      outDir,
      base,
      opts.manifestFilename ?? 'project.manifest',
      opts.versionFilename ?? 'version.manifest',
    ),
    bundles: {},
  };
  for (const [name, m] of Object.entries(bundles)) {
    out.bundles[name] = writePair(outDir, m, `${name}.manifest`, `${name}.version.manifest`);
  }
  return out;
}

/** CDN 根下某一版 manifest 的归档目录。 */
function releaseDir(cdnDir: string, version: string): string {
  return join(cdnDir, 'releases', version);
}

/** CDN 根（或归档目录）下的所有 manifest 文件名，含 `*.version.manifest`。 */
function manifestFiles(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.manifest')) : [];
}

/**
 * 把刚发布的这一版 manifest 归档到 `<cdnDir>/releases/<version>/`，返回归档的文件名。
 *
 * 只归档 manifest，不归档内容文件——内容是**内容寻址**的（`index.<md5>.js`），叠加式发布下
 * 历史各版本的字节本来就都还躺在 CDN 上。所以「回到上一版」= 把那一版的 manifest 重新发出去，
 * 见 {@link rollbackManifests}。
 */
export function archiveManifests(cdnDir: string, version: string): string[] {
  const out = releaseDir(cdnDir, version);
  mkdirSync(out, { recursive: true });
  const files = manifestFiles(cdnDir);
  for (const f of files) copyFileSync(join(cdnDir, f), join(out, f));
  return files;
}

/**
 * 回滚：把归档的 `releases/<release>/` 那一版 manifest 重新发布成 `version` 这个**更大**的版本号。
 *
 * ## 为什么是「改号重发」而不是「把旧号发回去」
 *
 * 引擎默认的版本比较（`cmpVersion`，逐段 `sscanf "%d.%d.%d.%d"`）判定「远端号更小 = 本地已最新」，
 * 直接把旧号发回去会被**静默跳过**：不下载、不报错、什么也不发生。
 *
 * 而注入 `setVersionCompareHandle` 改掉比较规则是**陷阱**——同一个 handle 还服务
 * `loadLocalManifest` 的另一处语义（包内 manifest 比缓存新 → 清掉旧热更缓存，
 * `AssetsManagerEx.cpp:213/287`），改了它会让新装的 APK 被上一版热更缓存盖住。
 *
 * 所以发布侧守「版本号只增」，回滚表达为「发一版号更大、内容是旧的」。内容文件不用重传：
 * 内容寻址 + 叠加式发布，旧 md5 的字节还在 CDN 上，客户端 diff 出来照样下得到。
 *
 * ⚠️ `version` 必须**大于当前在发的那一版**，否则客户端判 up-to-date、回滚无声失败。
 *
 * ## 只动内容真的变了的包
 *
 * 一次回滚通常只想退掉一两个包，但归档目录里躺着**全部** manifest。给没变的那些也涨版本号会
 * 触发和 `--prev` 同一个崩溃：客户端判 NEW_VERSION_FOUND、`genDiff` 却算出空表，
 * `AssetsManagerEx::prepareUpdateAsync` 于是在 **worker 线程**里就地 `updateSucceed()` →
 * `UPDATE_FINISHED` 在非主线程进 JS VM → SIGSEGV（真机实测，见 {@link sameContent}）。
 *
 * 所以逐份与**当前在发的那版**比资产表，一致就原样不动。`*.version.manifest` 没有资产表，
 * 跟随它对应的主 manifest 的决定。
 */
export function rollbackManifests(opts: {
  /** CDN 根（含 `releases/`）。 */
  cdnDir: string;
  /** 要回到的那一版（`releases/` 下的目录名）。 */
  release: string;
  /** 新版本号，必须比当前在发的大。 */
  version: string;
}): { changed: string[]; skipped: string[]; from: string } {
  const src = releaseDir(opts.cdnDir, opts.release);
  const files = manifestFiles(src);
  if (files.length === 0) throw new Error(`${src} 下没有 manifest —— 这一版没归档过？`);

  const isVer = (f: string): boolean => f === 'version.manifest' || f.endsWith('.version.manifest');
  const mainOf = (f: string): string =>
    f === 'version.manifest' ? 'project.manifest' : f.replace(/\.version\.manifest$/, '.manifest');

  const publish = (f: string): void => {
    const m = JSON.parse(readFileSync(join(src, f), 'utf8')) as Record<string, unknown>;
    writeFileSync(join(opts.cdnDir, f), JSON.stringify({ ...m, version: opts.version }, null, 2));
  };

  const changed = new Set<string>();
  const skipped: string[] = [];
  for (const f of files.filter((x) => !isVer(x))) {
    const m = JSON.parse(readFileSync(join(src, f), 'utf8')) as Manifest;
    const live = readPrevManifest(opts.cdnDir, f);
    if (live && sameContent(m, live)) {
      skipped.push(f);
      continue;
    }
    publish(f);
    changed.add(f);
  }
  for (const f of files.filter(isVer)) {
    if (changed.has(mainOf(f))) publish(f);
  }

  archiveManifests(opts.cdnDir, opts.version);
  return { changed: Array.from(changed), skipped, from: src };
}

/** 自校验：读回 project.manifest，对 root 下每条 asset 重算 md5/size 比对，返回不符项。 */
export function verifyManifest(manifestPath: string, root: string): VerifyIssue[] {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
  const issues: VerifyIssue[] = [];
  for (const [key, entry] of Object.entries(manifest.assets)) {
    const file = join(root, decodeURI(key));
    if (!existsSync(file)) {
      issues.push({ path: key, reason: 'missing' });
      continue;
    }
    const actual = hashFile(file);
    if (actual.size !== entry.size) issues.push({ path: key, reason: 'size-mismatch' });
    else if (actual.md5 !== entry.md5) issues.push({ path: key, reason: 'md5-mismatch' });
  }
  return issues;
}

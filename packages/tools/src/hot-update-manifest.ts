/**
 * 热更 manifest 生成/校验（出包期 node 工具，零 cc）。
 * 格式严格对齐 Cocos 官方 version_generator.js：crypto md5(hex) + stat.size + .zip→compressed，
 * key = 相对 root 的正斜杠 + encodeURI 路径；version.manifest = 删 assets + searchPaths。
 * 产物由 engine 半的 native.AssetsManager 后端消费（见 packages/core/docs/modules/hotupdate-service.md）。
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
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
const DEFAULT_AOT_BUNDLES = ['main', 'internal', 'resources'];

export interface SplitManifestOptions extends ManifestOptions {
  /** 归入 base 的 assets 子目录名。默认 {@link DEFAULT_AOT_BUNDLES}。 */
  aotBundles?: readonly string[];
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
    if (name === undefined || aot.has(name)) {
      baseAssets[key] = entry;
      continue;
    }
    let table = byBundle.get(name);
    if (!table) byBundle.set(name, (table = {}));
    table[key] = entry;
  }

  const mk = (assets: Record<string, AssetEntry>, projFile: string, verFile: string): Manifest => ({
    packageUrl,
    remoteManifestUrl: packageUrl + projFile,
    remoteVersionUrl: packageUrl + verFile,
    version: opts.version,
    assets,
    searchPaths: opts.searchPaths ?? [],
  });

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

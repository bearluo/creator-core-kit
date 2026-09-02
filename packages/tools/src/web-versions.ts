/**
 * web 热更版本表 —— 出包期从构建产物抽 bundle md5，落成一张 core `RemoteVersions` 认的 JSON。
 *
 * ## 与 native manifest 的分工
 *
 * native 要自己下载文件，所以 manifest 里有每个文件的 md5 与大小；**web 什么都不用下**——
 * 引擎按 `assets/<bundle>/index.<md5>.js` 取，浏览器自己会拉。所以这里只需要一张
 * 「bundle → md5」的表，客户端 `setVersions` 一盖，之后 load 到的就是新那份。
 * 新旧文件名天然不同、可共存，这正是**免重启换代码**成立的前提（ADR-0010）。
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeCoreApiHash } from './api-stamp';
import { DEFAULT_BASE_BUNDLES } from './hot-update-manifest';

/** 版本表内容。字段对齐 core 的 `RemoteVersions`（tools 不依赖 core，形状一致即可）。 */
export interface WebVersions {
  /** bundle 名 → 出包 md5。**不含 base 包**。 */
  readonly bundles: Record<string, string>;
  readonly version: string;
  readonly coreApiHash?: string;
  readonly minAppVersion?: string;
}

export interface WebVersionsOptions {
  readonly version: string;
  /** core 的 d.ts 目录或文件；给了就现算 `coreApiHash`（必须与 app 戳同源，见 compat-stamp）。 */
  readonly core?: string;
  readonly minAppVersion?: string;
  /** 不进版本表的包。默认 {@link DEFAULT_BASE_BUNDLES}。 */
  readonly baseBundles?: readonly string[];
}

/**
 * 从 web 构建产物读 bundle → md5。Creator 把它写在 `src/settings.<md5>.json` 的
 * `assets.bundleVers`（settings 自己的文件名也带 md5，所以只能按前缀找）。
 */
export function readBundleVers(root: string): Record<string, string> {
  const dir = join(root, 'src');
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => /^settings.*\.json$/.test(f)) : [];
  if (files.length === 0)
    throw new Error(
      `找不到 ${dir}/settings*.json —— root 要指向 web 构建产物根（含 index.html 的那一层）`,
    );
  // 上一次构建的残留会让「挑第一个」静默取到旧版本 → 生成一张指向旧 md5 的表，客户端加载即 404。
  if (files.length > 1)
    throw new Error(`${dir} 下有 ${files.length} 份 settings*.json（${files.join(' / ')}）—— 先清干净再构建`);

  const j = JSON.parse(readFileSync(join(dir, files[0]), 'utf8')) as {
    assets?: { bundleVers?: Record<string, string> };
  };
  const vers = j.assets?.bundleVers;
  if (!vers || Object.keys(vers).length === 0)
    throw new Error(
      `${files[0]} 的 assets.bundleVers 是空的 —— 构建配置的 md5Cache 没开。换文件名就是 web 的版本机制，关了它热更无从谈起`,
    );
  return vers;
}

/** 造版本表：抽 `bundleVers`、剔掉 base 包、盖上版本与兼容戳。 */
export function buildWebVersions(root: string, opts: WebVersionsOptions): WebVersions {
  const base = new Set(opts.baseBundles ?? DEFAULT_BASE_BUNDLES);
  const bundles: Record<string, string> = {};
  for (const [name, md5] of Object.entries(readBundleVers(root))) {
    // base 包的版本由页面自己的 settings.json 说了算：客户端换不动（换了只会去拉一个不存在的
    // 文件名），要换只能重新加载页面。
    if (!base.has(name)) bundles[name] = md5;
  }
  return {
    bundles,
    version: opts.version,
    // 不给就不写：闸对 coreApiHash 单边缺失恒放行，塞个空串等于谎报「我声明了」。
    ...(opts.core ? { coreApiHash: computeCoreApiHash(opts.core) } : {}),
    ...(opts.minAppVersion ? { minAppVersion: opts.minAppVersion } : {}),
  };
}

/** 落盘。 */
export function writeWebVersions(outPath: string, v: WebVersions): WebVersions {
  writeFileSync(outPath, JSON.stringify(v, null, 2));
  return v;
}

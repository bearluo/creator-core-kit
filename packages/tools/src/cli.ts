/**
 * cck-manifest CLI（node:util.parseArgs，零依赖）——native 热更出包期工具。
 *   生成 manifest: cck-manifest --root <dir> --url <packageUrl> --version <v> [--out <dir>] [--dirs a,b] [--search-paths ...]
 *                  加 --split 则切成 base + 每个模块 bundle 一份（[--aot-bundles main,internal,resources]）
 *                  再加 --prev <上次发布目录> 则内容未变的包沿用旧版本号（只有真改了的包才涨版本）
 *   校验 manifest: cck-manifest verify --root <dir> [--manifest <path>]
 *   打戳:          cck-manifest stamp --core <core-dist-或-index.d.ts> --version <v> [--min-app-version <v>] --out <path>
 *   兼容校验:      cck-manifest verify-compat --app-stamp <path> (--core <dist> | --update-stamp <path>) [--min-app-version <v>]
 *   web 版本表:    cck-manifest web-versions --root <web构建产物根> --version <v> [--core <dist>] [--min-app-version <v>] --out <path>
 */
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { computeCoreApiHash, readStamp, verifyCompat, writeStamp } from './api-stamp';
import { verifyManifest, writeManifests, writeSplitManifests, type WriteResult } from './hot-update-manifest';
import { buildWebVersions, writeWebVersions } from './web-versions';

function die(msg: string): never {
  console.error(`cck-manifest: ${msg}`);
  process.exit(1);
}

function main(): void {
  const argv = process.argv.slice(2);
  const sub = argv[0] && !argv[0].startsWith('-') ? argv[0] : '';
  const args = sub ? argv.slice(1) : argv;

  const { values } = parseArgs({
    args,
    options: {
      root: { type: 'string' },
      url: { type: 'string' },
      version: { type: 'string' },
      out: { type: 'string' },
      dirs: { type: 'string' },
      'search-paths': { type: 'string' },
      manifest: { type: 'string' },
      core: { type: 'string' },
      'min-app-version': { type: 'string' },
      'app-stamp': { type: 'string' },
      'update-stamp': { type: 'string' },
      split: { type: 'boolean' },
      'aot-bundles': { type: 'string' },
      prev: { type: 'string' },
    },
  });

  if (sub === 'stamp') {
    const core = values.core ?? die('stamp 需要 --core（core dist 目录或 index.d.ts）');
    const version = values.version ?? die('stamp 需要 --version');
    const out = values.out ?? die('stamp 需要 --out（兼容戳落盘路径）');
    const stamp = writeStamp(out, {
      version,
      minAppVersion: values['min-app-version'],
      coreApiHash: computeCoreApiHash(core),
    });
    console.log(`✅ 打戳 ${out}：version=${stamp.version} coreApiHash=${stamp.coreApiHash}${stamp.minAppVersion ? ` minAppVersion=${stamp.minAppVersion}` : ''}`);
    return;
  }

  if (sub === 'web-versions') {
    const root = values.root ?? die('web-versions 需要 --root（web 构建产物根，含 index.html 那层）');
    const version = values.version ?? die('web-versions 需要 --version');
    const out = values.out ?? die('web-versions 需要 --out（版本表落盘路径）');
    const v = writeWebVersions(
      out,
      buildWebVersions(root, {
        version,
        core: values.core,
        minAppVersion: values['min-app-version'],
        aotBundles: values['aot-bundles'] ? values['aot-bundles'].split(',') : undefined,
      }),
    );
    const names = Object.keys(v.bundles);
    console.log(`✅ 版本表 ${out}：version=${v.version} ${names.length} 个 bundle${v.coreApiHash ? ` coreApiHash=${v.coreApiHash}` : ''}`);
    return;
  }

  if (sub === 'verify-compat') {
    const appStampPath = values['app-stamp'] ?? die('verify-compat 需要 --app-stamp（已部署 app 的兼容戳）');
    const app = readStamp(appStampPath);
    const update = values['update-stamp']
      ? readStamp(values['update-stamp'])
      : {
          version: values.version ?? app.version,
          minAppVersion: values['min-app-version'],
          coreApiHash: computeCoreApiHash(values.core ?? die('verify-compat 需要 --core 或 --update-stamp')),
        };
    const r = verifyCompat(app, update);
    if (r.ok) {
      console.log(`✅ 兼容校验通过：热更可安全应用（app ${app.coreApiHash} == 更新 ${update.coreApiHash}）`);
      return;
    }
    die(`兼容校验失败：${r.reason}`);
  }

  if (sub === 'verify') {
    const root = values.root ?? die('verify 需要 --root');
    const manifestPath = values.manifest ?? join(root, 'project.manifest');
    const issues = verifyManifest(manifestPath, root);
    if (issues.length === 0) {
      console.log(`✅ manifest 校验通过：${manifestPath}`);
      return;
    }
    for (const i of issues) console.error(`  ✗ ${i.path} — ${i.reason}`);
    die(`${issues.length} 处不符`);
  }

  const root = values.root ?? die('需要 --root（native 构建数据目录）');
  const packageUrl = values.url ?? die('需要 --url（远程资源根 URL）');
  const version = values.version ?? die('需要 --version');

  const common = {
    root,
    packageUrl,
    version,
    outDir: values.out,
    dirs: values.dirs ? values.dirs.split(',') : undefined,
    searchPaths: values['search-paths'] ? values['search-paths'].split(',') : undefined,
  };
  const report = ({ projectPath, versionPath, manifest }: WriteResult, label: string): void => {
    // 版本号取 manifest 自己的：--prev 命中时它会沿用上一版，与 --version 不同。
    const carried = manifest.version !== version ? '（内容未变，沿用旧版本）' : '';
    console.log(`✅ ${label}（${Object.keys(manifest.assets).length} 个资源，version=${manifest.version}）${carried}`);
    console.log(`   ${projectPath}`);
    console.log(`   ${versionPath}`);
  };

  if (values.split) {
    const { base, bundles } = writeSplitManifests({
      ...common,
      aotBundles: values['aot-bundles'] ? values['aot-bundles'].split(',') : undefined,
      prevDir: values.prev,
    });
    report(base, '生成 base manifest');
    for (const [name, r] of Object.entries(bundles)) report(r, `生成 bundle manifest '${name}'`);
    return;
  }

  report(writeManifests(common), '生成 manifest');
}

main();

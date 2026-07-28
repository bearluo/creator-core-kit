/**
 * cck-manifest CLI（node:util.parseArgs，零依赖）。
 *   生成: cck-manifest --root <dir> --url <packageUrl> --version <v> [--out <dir>] [--dirs a,b] [--search-paths ...]
 *   校验: cck-manifest verify --root <dir> [--manifest <path>]
 */
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { verifyManifest, writeManifests } from './hot-update-manifest';

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
    },
  });

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

  const { projectPath, versionPath, manifest } = writeManifests({
    root,
    packageUrl,
    version,
    outDir: values.out,
    dirs: values.dirs ? values.dirs.split(',') : undefined,
    searchPaths: values['search-paths'] ? values['search-paths'].split(',') : undefined,
  });
  console.log(`✅ 生成 manifest（${Object.keys(manifest.assets).length} 个资源，version=${version}）`);
  console.log(`   ${projectPath}`);
  console.log(`   ${versionPath}`);
}

main();

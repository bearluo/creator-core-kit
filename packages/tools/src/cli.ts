/**
 * cck-manifest CLI（node:util.parseArgs，零依赖）——native 热更出包期工具。
 *   生成 manifest: cck-manifest --root <dir> --url <packageUrl> --version <v> [--out <dir>] [--dirs a,b] [--files a.js,b.js] [--search-paths ...]
 *                  加 --split 则切成 base + 每个模块 bundle 一份（[--base-bundles main,internal,resources]）
 *                  再加 --prev <上次发布目录> 则内容未变的包沿用旧版本号（只有真改了的包才涨版本）
 *                  产物开了 md5Cache 时加 --md5：base manifest 丢掉与引擎绑死 / 名字被 main.js 写死的那几类
 *                  --files 收产物根上的散文件（base 入口 application.<md5>.js 要它，子目录遍历够不着）
 *                  --split 会顺带查资源归属漂移：跨包依赖只许指向共享仓（默认 resources，用 --allow-deps 改）
 *   校验 manifest: cck-manifest verify --root <dir> [--manifest <path>]
 *   打戳:          cck-manifest stamp --core <core-dist-或-index.d.ts> --version <v> [--root <native产物根，打引擎指纹>] [--min-app-version <v>] --out <path>
 *   兼容校验:      cck-manifest verify-compat --app-stamp <path> (--core <dist> | --update-stamp <path>) [--min-app-version <v>]
 *   钉子门控:      cck-manifest check-pins --assets <工程 assets 目录> [--pin-dir resources/]
 *                  工程引用到的外部资源（Creator 内置库）必须都被共享仓钉住，否则归属会漂
 *   拓扑门控:      cck-manifest check-graph --assets <工程 assets 目录> [--mermaid]
 *                  跨包 import 只许指向优先级更高的包（严格递增 ⇒ 不可能成环）；--mermaid 打印拓扑图
 *   web 版本表:    cck-manifest web-versions --root <web构建产物根> --version <v> [--core <dist>] [--min-app-version <v>] --out <path>
 *   部署:          cck-manifest deploy --root <native产物根> --cdn <CDN根>   （只叠加，引擎层不拷）
 *   归档:          cck-manifest archive --cdn <CDN根> --version <v>        （落 releases/<v>/，出包流程自动调）
 *   回滚:          cck-manifest rollback --cdn <CDN根> --release <旧版本> --version <新版本号，必须更大>
 */
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { computeCoreApiHash, readEngineHash, readStamp, verifyCompat, writeStamp } from './api-stamp';
import {
  collectBundleDeps,
  findDepViolations,
  findEdgeViolations,
  findUnpinnedRefs,
  readBundles,
  scanAssetRefs,
  scanCodeEdges,
  toMermaid,
} from './bundle-deps';
import {
  archiveManifests,
  deployToCdn,
  rollbackManifests,
  verifyManifest,
  writeManifests,
  writeSplitManifests,
  type WriteResult,
} from './hot-update-manifest';
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
      files: { type: 'string' },
      'search-paths': { type: 'string' },
      manifest: { type: 'string' },
      core: { type: 'string' },
      'min-app-version': { type: 'string' },
      'app-stamp': { type: 'string' },
      'update-stamp': { type: 'string' },
      split: { type: 'boolean' },
      'base-bundles': { type: 'string' },
      prev: { type: 'string' },
      md5: { type: 'boolean' },
      cdn: { type: 'string' },
      release: { type: 'string' },
      'allow-deps': { type: 'string' },
      assets: { type: 'string' },
      'pin-dir': { type: 'string' },
      mermaid: { type: 'boolean' },
    },
  });

  if (sub === 'stamp') {
    const core = values.core ?? die('stamp 需要 --core（core dist 目录或 index.d.ts）');
    const version = values.version ?? die('stamp 需要 --version');
    const out = values.out ?? die('stamp 需要 --out（兼容戳落盘路径）');
    // `--root` 给了就一并打**引擎指纹**（native 构建产物根）。app 戳打不上——它在 Creator 构建
    // 之前就得写好；更新戳打得上，客户端那端由 engine 的 `engineHash()` 运行时取。
    const stamp = writeStamp(out, {
      version,
      minAppVersion: values['min-app-version'],
      coreApiHash: computeCoreApiHash(core),
      engineHash: values.root === undefined ? undefined : readEngineHash(values.root),
    });
    console.log(`✅ 打戳 ${out}：version=${stamp.version} coreApiHash=${stamp.coreApiHash}${stamp.engineHash ? ` engineHash=${stamp.engineHash}` : ''}${stamp.minAppVersion ? ` minAppVersion=${stamp.minAppVersion}` : ''}`);
    return;
  }

  if (sub === 'deploy') {
    const root = values.root ?? die('deploy 需要 --root（native 构建产物根，含 src/ assets/）');
    const cdn = values.cdn ?? die('deploy 需要 --cdn（CDN 根目录）');
    const skipped = deployToCdn(root, cdn);
    console.log(`✅ 同步 ${root} → ${cdn}（只叠加），引擎层跳过 ${skipped.length} 项：${skipped.join(' ') || '(无)'}`);
    return;
  }

  if (sub === 'archive') {
    const cdn = values.cdn ?? die('archive 需要 --cdn（CDN 根目录）');
    const version = values.version ?? die('archive 需要 --version');
    const files = archiveManifests(cdn, version);
    console.log(`✅ 归档 ${files.length} 份 manifest → ${cdn}/releases/${version}/`);
    return;
  }

  if (sub === 'rollback') {
    const cdn = values.cdn ?? die('rollback 需要 --cdn（CDN 根目录）');
    const release = values.release ?? die('rollback 需要 --release（要回到的那一版，releases/ 下的目录名）');
    // 回滚 = 「发一版号更大、内容是旧的」。号发小了客户端判 up-to-date，无声失败。
    const version = values.version ?? die('rollback 需要 --version（新版本号，必须大于当前在发的那版）');
    const { changed, skipped, from } = rollbackManifests({ cdnDir: cdn, release, version });
    console.log(`✅ 回滚 ${from} → ${cdn}`);
    console.log(`   退回 ${changed.length} 个包（version=${version}）：${changed.join(' ') || '(无)'}`);
    // 内容没变的**必须**保持旧版本号：涨了会让客户端 NEW_VERSION + 空 diff → worker 线程 SIGSEGV。
    console.log(`   内容与当前在发的一致、原样不动：${skipped.length} 个`);
    console.log('   内容文件不用重传——内容寻址 + 叠加式发布，旧 md5 的字节还在 CDN 上。');
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
        baseBundles: values['base-bundles'] ? values['base-bundles'].split(',') : undefined,
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

  if (sub === 'check-pins') {
    // 源码期的归属门控。产物侧那道闸（--split 扫 cc.config）只在**两个以上**包引用同一资源时
    // 才触发；只被一个包引用时当场看不出问题，等第二个包也用它才漂。这一道不用构建就能查。
    const assets = values.assets ?? die('check-pins 需要 --assets（工程的 assets 目录）');
    const scan = scanAssetRefs(assets);
    const unpinned = findUnpinnedRefs(scan, values['pin-dir']);
    if (unpinned.length === 0) {
      console.log(`✅ ${scan.refs.length} 个资产文件的外部引用全部钉在共享仓`);
      return;
    }
    for (const u of unpinned) {
      console.error(`  ✗ ${u.uuid}`);
      for (const f of u.files.slice(0, 5)) console.error(`      ← ${f}`);
      if (u.files.length > 5) console.error(`      … 另 ${u.files.length - 5} 处`);
    }
    die(
      `${unpinned.length} 个外部资源没被共享仓钉住 —— 归属会随引用关系漂（漂进 base 就热更不了，` +
        '漂到别的马甲就破了隔离）。修法：在共享仓的钉子 prefab 里给每个资源挂一个节点引用一次，' +
        '工程各处的引用不用改',
    );
  }

  if (sub === 'check-graph') {
    // 跨包**代码**边的门控。Creator 的 `cc.config.deps` 只记资源依赖 —— 模块 import 地基的函数
    // 在产物里一条边都看不见，那道闸对循环依赖是瞎的。规则：依赖只许指向优先级更高的包，
    // 严格递增 ⇒ 拓扑序天然存在 ⇒ 成不了环。
    const assets = values.assets ?? die('check-graph 需要 --assets（工程的 assets 目录）');
    const bundles = readBundles(assets);
    const edges = scanCodeEdges(assets, bundles);
    if (values.mermaid === true) {
      console.log(toMermaid(bundles, edges));
      return;
    }
    const bad = findEdgeViolations(edges, bundles);
    if (bad.length === 0) {
      console.log(`✅ ${bundles.length} 个包、${edges.length} 条跨包代码边，全部指向更高优先级（无环）`);
      return;
    }
    for (const v of bad)
      console.error(`  ✗ ${v.from}(${v.fromPriority}) → ${v.to}(${v.toPriority})  ${v.file} → ${v.target}`);
    die(
      `${bad.length} 条跨包依赖倒挂或同级 —— 依赖只许指向优先级更高的包。` +
        '倒挂会把被依赖的包判给上层（地基进 base = 热更失效），同级互引则两个包彼此拽住、一起卸不掉。' +
        '修法：把共用的东西下沉到更高优先级的包，或改走事件/接口而不是直接 import',
    );
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
    files: values.files ? values.files.split(',') : undefined,
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
    // 发包前先查归属漂移。Creator 把共用资源判给优先级最高的引用者，其余包降级成
    // `deps` + `redirect`；漂进 base 或漂到别的马甲，都要到运行时才炸。见 bundle-deps.ts。
    const drift = findDepViolations(
      collectBundleDeps(root),
      values['allow-deps']?.split(','),
    );
    if (drift.length > 0) {
      for (const d of drift)
        console.error(`  ✗ ${d.bundle} → ${d.dep}（${d.uuids.length} 个资源）`);
      die(
        `${drift.length} 处跨包依赖没指向共享仓 —— 资源归属漂移了，热更会在运行时找不到资源。` +
          '修法：在共享仓的钉子 prefab 里给每个共用资源挂一个节点引用一次（工程各处的引用不用改）；' +
          '接入方的共享仓不叫 resources 就用 --allow-deps 声明',
      );
    }
    const { base, bundles } = writeSplitManifests({
      ...common,
      baseBundles: values['base-bundles'] ? values['base-bundles'].split(',') : undefined,
      prevDir: values.prev,
      contentHashed: values.md5,
    });
    report(base, '生成 base manifest');
    for (const [name, r] of Object.entries(bundles)) report(r, `生成 bundle manifest '${name}'`);
    return;
  }

  report(writeManifests(common), '生成 manifest');
}

main();

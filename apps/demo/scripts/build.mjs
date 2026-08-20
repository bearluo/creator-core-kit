#!/usr/bin/env node
/**
 * 按固化配置跑 Creator 构建（可选顺带 gradle 出 APK）。
 *
 *   node scripts/build.mjs boot                    # Creator 构建，起始场景 Boot
 *   node scripts/build.mjs boot --manifest --apk   # 再夹一步热更 manifest + 同步 CDN
 *   node scripts/build.mjs boot --vest vest --apk  # 换马甲
 *
 * 配置来自 `build-configs/<name>.json`（构建意图，进 git）叠加 `build-configs/local.json`
 * （本机 SDK/NDK/JDK 与 Creator 路径，gitignore）。命令行模式**不读 Creator 的偏好设置**，
 * 所以那几个路径必须由 local.json 提供，否则构建在 `android:onAfterInit` 报
 * 「找不到 Android NDK/SDK 路径」——而且进程退出码仍是 0，只能从日志判定。
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEMO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIGS = join(DEMO, 'build-configs');
const TEMP = join(DEMO, 'temp', 'build-configs');

const argv = process.argv.slice(2);
const name = argv.find((a) => !a.startsWith('--'));
const flag = (k) => argv.includes(`--${k}`);
const opt = (k) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

if (!name || flag('help')) {
  const avail = existsSync(CONFIGS)
    ? readFileSync(join(CONFIGS, 'README.md'), 'utf8')
        .split('\n')
        .filter((l) => l.startsWith('| `') && l.includes('.json`'))
        .map((l) => l.split('`')[1].replace(/\.json$/, ''))
    : [];
  console.log(`用法: node scripts/build.mjs <${avail.join('|') || 'name'}> [--manifest] [--apk] [--vest <马甲>] [--dispatcher <url>] [--min-app-version <v>]`);
  process.exit(name ? 0 : 1);
}

/** 深合并：对象递归，其余后者覆盖。 */
const merge = (a, b) => {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && typeof a[k] === 'object'
      ? merge(a[k], v)
      : v;
  }
  return out;
};

const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const basePath = [join(CONFIGS, `${name}.json`), join(CONFIGS, `android-${name}.json`)].find(existsSync);
if (!basePath) throw new Error(`没有这份配置：build-configs/${name}.json`);
const localPath = join(CONFIGS, 'local.json');
if (!existsSync(localPath))
  throw new Error(`缺 ${localPath} —— 复制 local.example.json 并填本机 SDK/NDK/JDK 与 Creator 路径`);

const local = read(localPath);
const { creatorPath, cdnUrl, cdnDir, webDir, ...localOpts } = local;
let cfg = merge(read(basePath), localOpts);

// —— 命令行覆盖（马甲等正交维度不另存配置文件）——
const vest = opt('vest');
if (vest) cfg.packages['cck-build'].vest = vest;
const dispatcher = opt('dispatcher');
if (dispatcher) cfg.packages['cck-build'].dispatcherUrl = dispatcher;

// `startScene` 只认 **uuid**。传 `db://…` 那种 url 不会报错，会**静默回退到项目当前的默认起始
// 场景**——表现就是配置写着一个场景、出来的包却从另一个启动。所以在这里查 `.meta` 换成 uuid。
const sceneUrl = cfg.startScene;
const metaPath = join(DEMO, `${sceneUrl.replace(/^db:\/\//, '')}.meta`);
if (!existsSync(metaPath)) throw new Error(`起始场景不存在：${sceneUrl}（找不到 ${metaPath}）`);
cfg.startScene = read(metaPath).uuid;

// —— 先挡一道：出包吃的是 @cck/* 的 **dist**，不是 src ——
//
// dist 陈旧不会有任何报错，只会打出一个「改的代码没生效」的包。而且**戳也照样一致**：两枚戳
// 都从同一份陈旧 dist 算，coreApiHash 闸对此完全无感（它比的是 app 与更新包，不是 dist 与 src）。
// 一次白跑的构建 + 一轮白跑的 e2e 就是这么来的。
const PKGS = join(DEMO, '..', '..', 'packages');
const newestMtime = (dir) => {
  let m = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '__tests__') continue; // 改测试不影响 dist
    const f = join(dir, e.name);
    m = Math.max(m, e.isDirectory() ? newestMtime(f) : statSync(f).mtimeMs);
  }
  return m;
};
for (const pkg of ['core', 'engine']) {
  const dts = join(PKGS, pkg, 'dist', 'index.d.ts');
  const fix = '先 pnpm -F @cck/' + pkg + ' build';
  if (!existsSync(dts)) throw new Error(`packages/${pkg}/dist 还没构建 —— ${fix}`);
  if (newestMtime(join(PKGS, pkg, 'src')) > statSync(dts).mtimeMs)
    throw new Error(`packages/${pkg}/src 比 dist 新 —— ${fix}，否则出的包跑的是旧代码`);
}

// 兼容戳（版本闸的两端之一）。**必须在 Creator 构建之前**：戳是 `assets/resources/` 下的一个
// JsonAsset，要被 Creator 导入才进得了包。内容每次重写、uuid 与 .meta 不动，所以只有 core 的公开
// API 真变了才会产生 git 改动——那正是该被看见的信号。
//
// 戳里的 `version` 会**覆盖** `AppConfig.version`（core 的 platform 步是 `j.version ?? ctx.config.version`），
// 所以它必须与运行时读到的版本同源 → 取构建插件那一份，空着就报错而不是猜。
const CLI = join(DEMO, '..', '..', 'packages', 'tools', 'dist', 'cli.cjs');
const CORE_DTS = join(DEMO, '..', '..', 'packages', 'core', 'dist');
const appVersion = cfg.packages['cck-build'].version;
if (!appVersion)
  throw new Error(`${basePath} 的 packages['cck-build'].version 是空的 —— 打戳要它，且它必须与运行时 AppConfig.version 同源`);

const makeStamp = (out, version, extra = []) => {
  const r = spawnSync(process.execPath, [CLI, 'stamp', '--core', CORE_DTS, '--version', version, ...extra, '--out', out], {
    encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error(`打戳失败：${r.stderr || r.stdout}`);
  return read(out);
};

const appStampPath = join(DEMO, 'assets', 'resources', 'cck-app-compat.json');
const { coreApiHash } = makeStamp(appStampPath, appVersion);
console.log(`▶ app 戳 assets/resources/cck-app-compat.json（version=${appVersion} coreApiHash=${coreApiHash}）`);

mkdirSync(TEMP, { recursive: true });
const cfgPath = join(TEMP, `${name}.merged.json`);
writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));

console.log(`▶ Creator 构建 '${name}'`);
console.log(`  起始场景 ${sceneUrl}`);
console.log(`  马甲     ${cfg.packages['cck-build'].vest || '(默认 base)'}`);

// 判据取产物本身：Creator 命令行构建**失败时退出码照样是 0**，日志里成功和失败
// 也都只打一行 `Finished in (…)`，唯一可靠的信号是 settings 有没有被重新写出来。
// ⚠️ 认**文件名前缀**不认全名：`md5Cache` 一开它就叫 `settings.<md5>.json`，盯死
// `settings.json` 会让每次 web 构建都被判成失败（而产物其实是好的）。
// 产物根：native 多一层 `data/`（gradle 把它整个塞进 APK 的 assets），web 就是输出目录本身。
const isNative = cfg.platform === 'android' || cfg.platform === 'ios';
const DATA = join(DEMO, 'build', cfg.outputName, ...(isNative ? ['data'] : []));
const OUT_REL = `build/${cfg.outputName}${isNative ? '/data' : ''}`;
const settingsMtime = () => {
  const dir = join(DATA, 'src');
  if (!existsSync(dir)) return 0;
  return readdirSync(dir)
    .filter((f) => /^settings.*.json$/.test(f))
    .reduce((m, f) => Math.max(m, statSync(join(dir, f)).mtimeMs), 0);
};
const before = settingsMtime();

const r = spawnSync(creatorPath, ['--project', DEMO, '--build', `configPath=${cfgPath}`], {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});
const log = `${r.stdout ?? ''}${r.stderr ?? ''}`;
const logPath = join(TEMP, `${name}.log`);
writeFileSync(logPath, log);

if (settingsMtime() === before) {
  // `[Assets] 构建插件 … 钩子函数执行失败` 只是外层包装，真正的原因在它后面那条。
  const why = log.match(/^Error: (?!\[Assets\]).+$/m)?.[0] ?? '(日志里没找到原因)';
  console.error(`✗ 构建失败：${why}\n  完整日志：${logPath}`);
  process.exit(1);
}
console.log(`✓ Creator 构建完成 → ${OUT_REL}`);

// —— AOT 入口指针：解开 L1-A 的那把钥匙 ——
//
// `main.js` 不再写死 `application.<md5>.js`，改读这个固定名文件（见 build-templates/native/index.ejs）。
// 它跟着 base manifest 热更下发 → AOT 整条链（application → settings → chunks →
// assets/{main,resources,internal}）都能换，重启生效。落 `src/` 下才进得了 manifest 的遍历集合。
// 必须夹在 Creator 构建与 manifest / gradle **之间**：Creator 每次清空 data/，gradle 打包 data/。
let aotEntry;
if (isNative) {
  aotEntry = readdirSync(DATA).find((f) => /^application\..+\.js$/.test(f)) ?? 'application.js';
  writeFileSync(join(DATA, 'src', 'cck-aot.json'), `${JSON.stringify({ application: `./${aotEntry}` }, null, 2)}\n`);
  console.log(`▶ AOT 入口指针 src/cck-aot.json → ./${aotEntry}`);
}

// 热更 manifest 必须夹在 Creator 构建与 gradle **之间**：Creator 每次都会清空 data/，
// gradle 又把 data/ 整个塞进 APK 的 assets。顺序错了 APK 里就一个 manifest 都没有，
// 而且是静默的——要等装到机器上，热更那步才报「loadRemoteManifest 拒收」。
if (flag('manifest') && !isNative) {
  // —— web：一张 bundle→md5 的表就是全部。没有要下载的文件，所以既不需要 packageUrl，
  // 也没有逐包版本号那一套（换文件名本身就是版本）。
  const version = opt('manifest-version') ?? '1.0.0';
  const vpath = join(DATA, 'cck-versions.json');
  const minApp = opt('min-app-version');
  const r = spawnSync(process.execPath, [CLI, 'web-versions', '--root', DATA, '--version', version,
    '--core', CORE_DTS, ...(minApp ? ['--min-app-version', minApp] : []), '--out', vpath], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`版本表生成失败：${r.stderr || r.stdout}`);
  const vt = read(vpath);
  if (vt.coreApiHash !== coreApiHash)
    throw new Error(`版本表与 app 戳的 coreApiHash 不一致（${vt.coreApiHash} ≠ ${coreApiHash}）`);
  console.log(`▶ 版本表 cck-versions.json（version=${version} ${Object.keys(vt.bundles).length} 个 bundle${minApp ? ` minAppVersion=${minApp}` : ''}）`);

  if (webDir) {
    // ⚠️ **只叠加，绝不清空**——这一条和 native 相反。老页面还在引用上一版的
    // `index.<旧md5>.js`，删了它们等于把线上正在跑的会话打断；文件名带 md5，新旧天然共存，
    // 「免重启换代码」正是靠这个（ADR-0010）。清历史版本是另一件事（按时间保留 N 版），不在出包流程里做。
    cpSync(DATA, webDir, { recursive: true });
    console.log(`✓ 版本表就位，产物已叠加到 ${webDir}`);
  } else {
    console.log('✓ 版本表就位（local.json 没配 webDir，跳过同步）');
  }
  process.exit(0);
}

if (flag('manifest')) {
  if (!cdnUrl) throw new Error('local.json 里缺 cdnUrl');
  const version = opt('manifest-version') ?? '1.0.0';
  console.log(`▶ 生成 manifest（version=${version} base=${cdnUrl}）`);
  // `--prev` 指向**当前线上那一版**（同步目录，此刻还没被下面的 cpSync 覆盖）：内容没变的包沿用
  // 旧版本号。这不只是整洁——**内容没变却涨版本号会让客户端崩**：AssetsManagerEx 在
  // `prepareUpdateAsync` 的 worker 线程任务体里遇 `diffMap.empty()` 直接调 `updateSucceed()`，
  // 绕开了本该把回调弹回主线程的 `prepareFinished`，UPDATE_FINISHED 于是在非主线程进 JS VM
  // → `se::AutoHandleScope` SIGSEGV。见 hotupdate-service.md「坑」。
  const prev = cdnDir && existsSync(cdnDir) ? ['--prev', cdnDir] : [];
  // 内容寻址产物（md5Cache）：base manifest 只丢与引擎绑死 / 名字被 main.js 写死的那几类
  // （cocos-js、effect.bin、jsb-adapter、system.bundle、import-map），AOT 照发 —— 入口名现在
  // 由 src/cck-aot.json 指针运行时解析，下发的新 AOT 有人念了。
  const md5 = cfg.md5Cache ? ['--md5'] : [];
  // `--files`：AOT 入口躺在产物**根**上，不在 src|assets|jsb-adapter 里，子目录遍历够不着它。
  const files = ['--files', aotEntry];
  spawnSync(process.execPath, [CLI, '--root', DATA, '--url', cdnUrl, '--version', version, '--split', ...prev, ...md5, ...files, '--out', DATA], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  // 更新戳：`hotupdate-backend` 在发现新版本时按 `packageUrl + compatFilename` 直接拉它，
  // 所以落 data/ 根（= CDN 根）即可。它不进任何 asset 表（manifest 只遍历 src|assets|jsb-adapter），
  // 也不需要——它是按 URL 取的，不是热更下发的。**base 和所有分包共用这一份**（大家 packageUrl 同根）。
  const upStamp = join(DATA, 'cck-update-compat.json');
  const minApp = opt('min-app-version');
  // `--root DATA` → 一并打**引擎指纹**（产物 `src/import-map*.json` 里 cc 的 md5）。app 戳打不上：
  // 它在 Creator 构建之前就要写进 assets/resources/，那时产物还不存在；客户端那一端由 engine 的
  // `engineHash()` 运行时从 SystemJS import map 取，两边比对挡住「热更来的 JS 配上另一个引擎」。
  const { coreApiHash: upHash, engineHash } = makeStamp(upStamp, version, [
    '--root', DATA,
    ...(minApp ? ['--min-app-version', minApp] : []),
  ]);
  console.log(`▶ 更新戳 cck-update-compat.json（version=${version} coreApiHash=${upHash}${engineHash ? ` engineHash=${engineHash}` : ''}${minApp ? ` minAppVersion=${minApp}` : ''}）`);
  if (cfg.md5Cache && !engineHash)
    throw new Error('开了 md5Cache 却读不到引擎指纹（src/import-map*.json 的 imports.cc）—— 引擎版本闸会静默休眠，先查产物');
  if (upHash !== coreApiHash)
    throw new Error(`更新戳与 app 戳的 coreApiHash 不一致（${upHash} ≠ ${coreApiHash}）—— 同一次构建不该出现，检查是不是中途重编了 core`);

  const baseManifest = read(join(DATA, 'project.manifest'));
  if (baseManifest.packageUrl !== cdnUrl) throw new Error(`manifest 基址不对：${baseManifest.packageUrl}`);
  // AOT 热更的两个必要条件，缺一就**静默失效**（构建全绿、下发成功、玩家跑的还是包内旧 AOT）：
  // 入口本体要下得来，指针要能被换掉。
  for (const k of [aotEntry, 'src/cck-aot.json']) {
    if (!baseManifest.assets[k])
      throw new Error(`base manifest 里没有 ${k} —— AOT 热更会静默失效，查 --files / --md5 的排除清单`);
  }
  if (cdnDir) {
    if (cfg.md5Cache) {
      // ⚠️ 内容寻址下**只叠加、绝不清空**（与 web 同理）：文件名带 md5，新旧天然共存，历史各版本的
      // 字节留在 CDN 上正是「回滚只换 manifest、不重传内容」成立的前提。清空等于把回滚路堵死，
      // 还会把正在更新中的老客户端要的文件抽走。清历史版本是另一件事（按时间保留 N 版）。
      cpSync(DATA, cdnDir, { recursive: true });
      const r = spawnSync(process.execPath, [CLI, 'archive', '--cdn', cdnDir, '--version', version], { encoding: 'utf8' });
      if (r.status !== 0) throw new Error(`manifest 归档失败：${r.stderr || r.stdout}`);
      console.log(`✓ manifest 就位，叠加到 ${cdnDir}，并归档 releases/${version}/`);
      console.log(`  回滚：node ${CLI} rollback --cdn ${cdnDir} --release <旧版本> --version <更大的号>`);
    } else {
      // 不开 md5：同名不同内容，历史版本留着只会让 CDN 上混着对不上任何 manifest 的孤儿文件。
      rmSync(cdnDir, { recursive: true, force: true });
      cpSync(DATA, cdnDir, { recursive: true });
      console.log(`✓ manifest 就位，并同步到 ${cdnDir}`);
    }
  } else {
    console.log('✓ manifest 就位（local.json 没配 cdnDir，跳过同步）');
  }
}

if (flag('apk') && !isNative) {
  console.error(`✗ --apk 只对 native 平台有意义（当前 platform=${cfg.platform}）`);
  process.exit(1);
}

if (!flag('apk')) {
  console.log('  （加 --apk 顺带跑 gradle 出安装包）');
  process.exit(0);
}

const proj = join(DEMO, 'build', 'android', 'proj');
console.log('▶ gradle assembleDebug');
// shell:true 是必须的 —— Node 20 起（CVE-2024-27980）不再直接 exec `.bat`/`.cmd`，
// 少了它会抛 EINVAL，而且抛在 spawn 那层、stdout 是空的，错误看着像「gradle 没输出」。
// 参数直接拼进命令串而不走 args 数组：shell:true 下传 args 会触发 DEP0190（不转义只拼接）。
const gradlew = JSON.stringify(join(proj, 'gradlew.bat'));
const g = spawnSync(`${gradlew} assembleDebug --console=plain`, {
  cwd: proj,
  shell: true,
  encoding: 'utf8',
  env: { ...process.env, JAVA_HOME: cfg.packages.android.javaHome },
  maxBuffer: 64 * 1024 * 1024,
});
if (g.status !== 0) {
  const out = `${g.stdout ?? ''}${g.stderr ?? ''}${g.error?.message ?? ''}`;
  console.error(`✗ gradle 失败（exit ${g.status}）\n${out.split('\n').slice(-25).join('\n')}`);
  process.exit(1);
}
console.log(`✓ APK → build/android/proj/build/demo/outputs/apk/debug/demo-debug.apk`);

#!/usr/bin/env node
/**
 * 按固化配置跑 Creator 构建（可选顺带 gradle 出 APK）。
 *
 *   node scripts/build.mjs boot                    # Creator 构建，起始场景 Boot
 *   node scripts/build.mjs boot --manifest --apk   # 再夹一步热更 manifest + 同步 CDN
 *   node scripts/build.mjs boot --vest vest --apk  # 换马甲
 *   node scripts/build.mjs probes                  # 探针场景
 *
 * 配置来自 `build-configs/<name>.json`（构建意图，进 git）叠加 `build-configs/local.json`
 * （本机 SDK/NDK/JDK 与 Creator 路径，gitignore）。命令行模式**不读 Creator 的偏好设置**，
 * 所以那几个路径必须由 local.json 提供，否则构建在 `android:onAfterInit` 报
 * 「找不到 Android NDK/SDK 路径」——而且进程退出码仍是 0，只能从日志判定。
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
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
        .filter((l) => l.startsWith('| `android-'))
        .map((l) => l.split('`')[1].replace(/^android-|\.json$/g, ''))
    : [];
  console.log(`用法: node scripts/build.mjs <${avail.join('|') || 'name'}> [--manifest] [--apk] [--vest <马甲>] [--dispatcher <url>]`);
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
const basePath = join(CONFIGS, `android-${name}.json`);
if (!existsSync(basePath)) throw new Error(`没有这份配置：${basePath}`);
const localPath = join(CONFIGS, 'local.json');
if (!existsSync(localPath))
  throw new Error(`缺 ${localPath} —— 复制 local.example.json 并填本机 SDK/NDK/JDK 与 Creator 路径`);

const local = read(localPath);
const { creatorPath, cdnUrl, cdnDir, ...localOpts } = local;
let cfg = merge(read(basePath), localOpts);

// —— 命令行覆盖（马甲等正交维度不另存配置文件）——
const vest = opt('vest');
if (vest) cfg.packages['cck-build'].vest = vest;
const dispatcher = opt('dispatcher');
if (dispatcher) cfg.packages['cck-build'].dispatcherUrl = dispatcher;

// `startScene` 只认 **uuid**。传 `db://…` 那种 url 不会报错，会**静默回退到项目当前的默认起始
// 场景**——表现就是配置写着 probes、出来的包却从 Boot 启动。所以在这里查 `.meta` 换成 uuid。
const sceneUrl = cfg.startScene;
const metaPath = join(DEMO, `${sceneUrl.replace(/^db:\/\//, '')}.meta`);
if (!existsSync(metaPath)) throw new Error(`起始场景不存在：${sceneUrl}（找不到 ${metaPath}）`);
cfg.startScene = read(metaPath).uuid;

mkdirSync(TEMP, { recursive: true });
const cfgPath = join(TEMP, `android-${name}.merged.json`);
writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));

console.log(`▶ Creator 构建 '${name}'`);
console.log(`  起始场景 ${sceneUrl}`);
console.log(`  马甲     ${cfg.packages['cck-build'].vest || '(默认 base)'}`);

// 判据取产物本身：Creator 命令行构建**失败时退出码照样是 0**，日志里成功和失败
// 也都只打一行 `Finished in (…)`，唯一可靠的信号是 settings.json 有没有被重新写出来。
const stamp = join(DEMO, 'build', 'android', 'data', 'src', 'settings.json');
const before = existsSync(stamp) ? statSync(stamp).mtimeMs : 0;

const r = spawnSync(creatorPath, ['--project', DEMO, '--build', `configPath=${cfgPath}`], {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});
const log = `${r.stdout ?? ''}${r.stderr ?? ''}`;
const logPath = join(TEMP, `android-${name}.log`);
writeFileSync(logPath, log);

if (!existsSync(stamp) || statSync(stamp).mtimeMs === before) {
  // `[Assets] 构建插件 … 钩子函数执行失败` 只是外层包装，真正的原因在它后面那条。
  const why = log.match(/^Error: (?!\[Assets\]).+$/m)?.[0] ?? '(日志里没找到原因)';
  console.error(`✗ 构建失败：${why}\n  完整日志：${logPath}`);
  process.exit(1);
}
console.log(`✓ Creator 构建完成 → build/android/data`);

const DATA = join(DEMO, 'build', 'android', 'data');

// 热更 manifest 必须夹在 Creator 构建与 gradle **之间**：Creator 每次都会清空 data/，
// gradle 又把 data/ 整个塞进 APK 的 assets。顺序错了 APK 里就一个 manifest 都没有，
// 而且是静默的——要等装到机器上，热更那步才报「loadRemoteManifest 拒收」。
if (flag('manifest')) {
  if (!cdnUrl) throw new Error('local.json 里缺 cdnUrl');
  const version = opt('manifest-version') ?? '1.0.0';
  console.log(`▶ 生成 manifest（version=${version} base=${cdnUrl}）`);
  const cli = join(DEMO, '..', '..', 'packages', 'tools', 'dist', 'cli.cjs');
  spawnSync(process.execPath, [cli, '--root', DATA, '--url', cdnUrl, '--version', version, '--split', '--out', DATA], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  const got = read(join(DATA, 'project.manifest')).packageUrl;
  if (got !== cdnUrl) throw new Error(`manifest 基址不对：${got}`);
  if (cdnDir) {
    rmSync(cdnDir, { recursive: true, force: true });
    cpSync(DATA, cdnDir, { recursive: true });
    console.log(`✓ manifest 就位，并同步到 ${cdnDir}`);
  } else {
    console.log('✓ manifest 就位（local.json 没配 cdnDir，跳过同步）');
  }
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

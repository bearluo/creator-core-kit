#!/usr/bin/env node
/**
 * 把本机端口转到跑着服务端的那台机器 —— **编辑器预览连远端服务的唯一办法**。
 *
 *   node apps/demo/scripts/tunnel.mjs             # 起隧道（前台，Ctrl+C 停）
 *   node apps/demo/scripts/tunnel.mjs --dry-run   # 只打印将要执行的命令，不连
 *   node apps/demo/scripts/tunnel.mjs --json      # 吐出 ssh 参数给调用方自己起（编辑器菜单用）
 *
 * 编辑器里也能开：**开发者 → 开启 SSH 隧道**（扩展 `extensions/cck-dev`，走的是 `--json`）。
 *
 * ## 为什么需要它
 *
 * **编辑器预览不走构建流程**（见 `assets/boot/build-config.ts`），`local.json` → 构建插件 →
 * `settings.json` 那条注入链对它无效，跑的就是源码里的 `127.0.0.1`。服务在别的机器上时，
 * 不碰源码的办法只有一个：把本机那几个端口转过去。隧道在的时候 `127.0.0.1` **就是**那台
 * 服务器，编辑器预览 / 浏览器预览 / `pnpm test` 的 `e2e-server.test.ts` 一起生效。
 *
 * **别改源码默认值来代替它**：改了迟早误提交，而那个默认值同时是别人 clone 下来的默认值。
 *
 * ## 配置从哪来
 *
 * 全在 `build-configs/local.json`（gitignored）—— 主机名与 IP 不进库。只需一个新字段
 * `tunnelHost`（`~/.ssh/config` 里的别名，或 `user@host`）；**端口不用另配**，直接从同一份
 * 文件里已有的 `dispatcherUrl` / `accountLoginUrl` 解析出来。加一个服务端地址时只改那边一行，
 * 这边自动跟上，不会出现「加了服务忘了加转发」的静默失败。
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const LOCAL = join(HERE, '..', 'build-configs', 'local.json');
const dryRun = process.argv.includes('--dry-run');
const asJson = process.argv.includes('--json');

if (!existsSync(LOCAL))
  throw new Error(`缺 ${LOCAL} —— 复制 build-configs/local.example.json 再填`);

const local = JSON.parse(readFileSync(LOCAL, 'utf8'));

const host = local.tunnelHost;
if (typeof host !== 'string' || host === '')
  throw new Error(
    'local.json 里缺 tunnelHost —— 填 ~/.ssh/config 里的别名或 user@host（例：' +
      '"tunnelHost": "my-dev-box"）。要免密，先 ssh-copy-id 推公钥。',
  );

/**
 * 要转发哪些端口：从服务端地址现解析，**不另立一张表**。
 *
 * 远端目标用 URL 里的 host 而不是写死 `127.0.0.1` —— 这样 `tunnelHost` 可以是跳板机，
 * 服务在它能到的第三台上照样转得过去。
 */
const cck = local.packages?.['cck-build'] ?? {};
const forwards = [];
for (const [key, raw] of Object.entries(cck)) {
  if (typeof raw !== 'string' || !raw.startsWith('http')) continue;
  const u = new URL(raw);
  // 已经指向本机 = 服务就在这台机器上，没什么可转的（转了反而占住端口、把服务挡掉）。
  if (u.hostname === '127.0.0.1' || u.hostname === 'localhost') continue;
  if (u.port === '') {
    console.warn(`⚠️ ${key} 没写端口（${raw}）—— 跳过，隧道只转显式端口`);
    continue;
  }
  forwards.push({ key, port: u.port, remote: `${u.hostname}:${u.port}` });
}

// 同一台机器上两个服务用同一个端口是不可能的，所以按本机端口去重即可。
const seen = new Set();
const unique = forwards.filter((f) => !seen.has(f.port) && seen.add(f.port));

/**
 * 本机这个端口是不是已经有人在听 —— **自己试着 bind 一下**，零外部命令、天然跨平台。
 * 只回答「占没占」，不回答「谁占的」（那个交给 `whoHasPort`，拿不到也不影响判断）。
 */
function portBusy(port) {
  return new Promise((resolve) => {
    const s = createServer();
    s.once('error', () => resolve(true));
    s.once('listening', () => s.close(() => resolve(false)));
    s.listen(Number(port), '127.0.0.1');
  });
}

/**
 * 谁占着这个端口（pid + 进程名）。**best-effort**：查不到就返回 undefined，
 * 上面那条「占没占」的判断不依赖它，只是提示里少一句人话。
 */
function whoHasPort(port) {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf8' });
      const line = out
        .split('\n')
        .find((l) => l.includes(`127.0.0.1:${port}`) && l.includes('LISTENING'));
      const pid = line?.trim().split(/\s+/).pop();
      if (!pid) return undefined;
      const tl = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH', '/FO', 'CSV'], {
        encoding: 'utf8',
      });
      return { pid, name: tl.split(',')[0]?.replace(/"/g, '').trim() || '?' };
    }
    const out = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-F', 'pc'], {
      encoding: 'utf8',
    });
    const pid = out.match(/^p(\d+)/m)?.[1];
    return pid ? { pid, name: out.match(/^c(.+)$/m)?.[1] ?? '?' } : undefined;
  } catch {
    return undefined; // netstat / lsof 不在、权限不够 —— 都不该拖垮主流程
  }
}

/** 占用者是不是 ssh（那基本就是上一条隧道还开着，而不是端口撞车）。 */
const isSsh = (name) => /^ssh(\.exe)?$/i.test(name ?? '');

// 起之前先看一眼：撞端口是日常（忘了上一条还开着 / 终端和编辑器菜单各开一条），
// 而 ssh 自己只会甩一句 `Address already in use`，占用者是谁得自己去 netstat 翻。
const busy = [];
for (const f of unique) {
  if (await portBusy(f.port)) busy.push({ ...f, by: whoHasPort(f.port) });
}

const args = ['-N', '-o', 'ExitOnForwardFailure=yes'];
for (const f of unique) args.push('-L', `127.0.0.1:${f.port}:${f.remote}`);
args.push(host);

// `--json` 给编辑器扩展用（`extensions/cck-dev`）：它拿着这份参数**自己** spawn ssh，
// 于是句柄就是 ssh 本身 —— 关菜单 / 关 Creator 时 kill 得掉。若让它 spawn 本脚本，
// kill 掉的只是这个 node 壳，底下的 ssh 会变成孤儿继续占着端口，下次起隧道报
// `Address already in use`，而那个错跟真实原因对不上。**必须排在所有人类可读输出之前。**
if (asJson) {
  console.log(
    JSON.stringify({ host, forwards: unique, busy, args: unique.length === 0 ? [] : args }),
  );
  process.exit(0);
}

if (unique.length === 0) {
  console.log('✓ 服务端地址都指向本机（或没配）—— 不需要隧道');
  process.exit(0);
}

for (const f of unique) console.log(`  127.0.0.1:${f.port} → ${f.remote}（${f.key}）`);

// 端口被占就**别去撞**：ssh 只会甩一句 `Address already in use` 然后 255，
// 谁占的、该怎么办，一个字都不说。这里替它说完。
if (busy.length > 0 && !dryRun) {
  const allSsh = busy.every((b) => isSsh(b.by?.name));
  const kill = (pid) => (process.platform === 'win32' ? `taskkill /PID ${pid} /F` : `kill ${pid}`);
  // 一条 ssh 通常同时占着两个端口 —— 按 pid 去重，别把同一条命令打印两遍。
  const owners = [...new Map(busy.filter((b) => b.by).map((b) => [b.by.pid, b.by])).values()];

  console.log('');
  for (const b of busy) {
    const who = b.by ? `${b.by.name}, pid ${b.by.pid}` : '查不到是谁';
    console.log(`⚠️ 127.0.0.1:${b.port} 已经被占（${who}）`);
  }
  console.log('');

  const stopHint = () => {
    for (const o of owners) console.log(`    ${kill(o.pid)}`);
    console.log('  （编辑器里起的那条，用菜单「开发者 → 停止 SSH 隧道」停更干净）');
  };

  if (allSsh && busy.length === unique.length) {
    // 全是 ssh 且一个不落 —— 上一条隧道还活着，目的已经达到了。**退 0**：
    // 让重复调用是幂等的（编辑器菜单点两次、脚本重跑，都不该报错）。
    console.log('✓ 已经有一条隧道在转发了，直接用就行，不必重开。');
    console.log('  要换目标 / 重开，先停掉它：');
    stopHint();
    process.exit(0);
  }

  if (allSsh) {
    // 占的全是 ssh，但**没占全** —— 上一条隧道转的端口不够，多半是它起来之后
    // `local.json` 里又加了服务端地址。这种必须停掉重开，否则新加的那个转不过去，
    // 而表现是「隧道明明开着，偏偏某个服务连不上」。
    const missing = unique.filter((f) => !busy.some((b) => b.port === f.port));
    console.log('⚠️ 已有的隧道**没转全**：');
    for (const m of missing) console.log(`    少了 127.0.0.1:${m.port}（${m.key}）`);
    console.log('  多半是它起来之后 local.json 又加了地址。停掉重开：');
    stopHint();
    process.exit(1);
  }

  console.log('占用者不是 ssh —— 两种可能：');
  console.log('  ① 本机真的跑着这个服务 → 那你不需要隧道，把 local.json 里的地址改成 127.0.0.1；');
  console.log('  ② 端口撞车 → 腾开它，或者换个服务端端口。');
  for (const o of owners) console.log(`    ${kill(o.pid)}   # ${o.name}`);
  process.exit(1);
}

console.log(`▶ ssh ${args.join(' ')}`);

if (dryRun) process.exit(0);

console.log('  连上之后没有任何输出是正常的（-N 不开远端 shell）。Ctrl+C 停。');
// 继承 stdio：首次连未知主机要确认指纹、没推公钥要输密码，都得让用户看得见、答得上。
const r = spawnSync('ssh', args, { stdio: 'inherit' });
if (r.error) throw r.error;
process.exit(r.status ?? 0);

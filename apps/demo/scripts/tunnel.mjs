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

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
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
      '"tunnelHost": "dev139"）。要免密，先 ssh-copy-id 推公钥。',
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

const args = ['-N', '-o', 'ExitOnForwardFailure=yes'];
for (const f of unique) args.push('-L', `127.0.0.1:${f.port}:${f.remote}`);
args.push(host);

// `--json` 给编辑器扩展用（`extensions/cck-dev`）：它拿着这份参数**自己** spawn ssh，
// 于是句柄就是 ssh 本身 —— 关菜单 / 关 Creator 时 kill 得掉。若让它 spawn 本脚本，
// kill 掉的只是这个 node 壳，底下的 ssh 会变成孤儿继续占着端口，下次起隧道报
// `Address already in use`，而那个错跟真实原因对不上。**必须排在所有人类可读输出之前。**
if (asJson) {
  console.log(JSON.stringify({ host, forwards: unique, args: unique.length === 0 ? [] : args }));
  process.exit(0);
}

if (unique.length === 0) {
  console.log('✓ 服务端地址都指向本机（或没配）—— 不需要隧道');
  process.exit(0);
}

for (const f of unique) console.log(`  127.0.0.1:${f.port} → ${f.remote}（${f.key}）`);
console.log(`▶ ssh ${args.join(' ')}`);

if (dryRun) process.exit(0);

console.log('  连上之后没有任何输出是正常的（-N 不开远端 shell）。Ctrl+C 停。');
// 继承 stdio：首次连未知主机要确认指纹、没推公钥要输密码，都得让用户看得见、答得上。
const r = spawnSync('ssh', args, { stdio: 'inherit' });
if (r.error) throw r.error;
process.exit(r.status ?? 0);

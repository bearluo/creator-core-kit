'use strict';

/**
 * 编辑器菜单：**开发者 → 开启 / 停止 / SSH 隧道状态**。
 *
 * ## 为什么要有它
 *
 * 预览**不走构建流程**，`build-configs/local.json` → 构建插件 → `settings.json` 那条注入链对它
 * 无效，跑的就是源码里的 `127.0.0.1`（见 `assets/boot/build-config.ts`）。服务在别的机器上时
 * 得先把端口转过去，否则 `dispatch` 步握手失败 → `abortLaunch` → **预览直接打不开**，而报错
 * 指向握手，不会告诉你「你没起隧道」。以前只能另开一个终端跑 `pnpm tunnel`，现在菜单点一下。
 *
 * ## 为什么是自己 spawn ssh，而不是 spawn 那个脚本
 *
 * `scripts/tunnel.mjs --json` 只负责**算出参数**（主机名与端口都在 gitignored 的 local.json 里，
 * 不进库），ssh 由这里亲自起 —— 于是 `proc` 握着的就是 ssh 本身，停止菜单和 `unload` 都 kill
 * 得掉。若改成 spawn 那个 node 脚本，kill 掉的只是 node 壳，**底下的 ssh 会变成孤儿继续占着
 * 9100/9103**，下次起隧道报 `Address already in use` —— 而那个错跟真实原因对不上，很费时间。
 *
 * ⚠️ 也**不能** `require('./scripts/tunnel.mjs')` 图省事：那个脚本靠 `process.exit` 收尾，
 * 在编辑器进程里跑会把整个 Creator 关掉。
 */

const { spawn, spawnSync } = require('node:child_process');
const { join } = require('node:path');

/** 当前隧道的 ssh 子进程；`null` = 没开。扩展跑在编辑器主进程里，模块级单例是安全的。 */
let proc = null;

const TAG = '[cck-dev]';

/** `Editor.Project.path` 指向工程根（`apps/demo`），脚本就在它下面。 */
function scriptPath() {
  return join(Editor.Project.path, 'scripts', 'tunnel.mjs');
}

/** 弹窗 + console 双份：弹窗给人看，console 留痕好回查。 */
function tell(kind, message, detail) {
  const line = detail ? `${TAG} ${message} —— ${detail}` : `${TAG} ${message}`;
  if (kind === 'error') console.error(line);
  else console.log(line);
  // Dialog 在某些无窗口场景（如自动化）不可用，别让提示失败拖垮功能本身。
  try {
    Editor.Dialog[kind === 'error' ? 'error' : 'info'](message, { detail: detail ?? '' });
  } catch {
    /* console 那份已经记下了 */
  }
}

exports.methods = {
  startTunnel() {
    // `exitCode !== null` = 已经死了但 exit 事件还没派发完，那种不算「开着」。
    if (proc && proc.exitCode === null) {
      tell('info', 'SSH 隧道已经开着了', '要换目标先「停止 SSH 隧道」再开');
      return;
    }

    // 参数现算：主机名与端口都住在 gitignored 的 local.json 里，这里一个地址都不硬编码。
    const r = spawnSync('node', [scriptPath(), '--json'], {
      cwd: Editor.Project.path,
      encoding: 'utf8',
      windowsHide: true,
    });
    if (r.status !== 0) {
      tell('error', '算不出隧道参数', (r.stderr || r.stdout || '').trim() || `退出码 ${r.status}`);
      return;
    }

    let plan;
    try {
      plan = JSON.parse(r.stdout.trim().split('\n').pop());
    } catch (e) {
      tell('error', '隧道参数不是合法 JSON', String(e));
      return;
    }

    if (!plan.args || plan.args.length === 0) {
      tell('info', '不需要隧道', '服务端地址都指向本机（或没配）');
      return;
    }

    // 端口被占就别去撞：ssh 只会甩一句 `Address already in use` 然后 255。脚本已经查好了
    // 是谁占的，这里直接说人话 —— 常见的是自己在终端里跑过 `pnpm tunnel` 忘了停。
    const busy = plan.busy ?? [];
    if (busy.length > 0) {
      const lines = busy.map(
        (b) => `127.0.0.1:${b.port} 被占（${b.by ? `${b.by.name}, pid ${b.by.pid}` : '查不到是谁'}）`,
      );
      const allSsh = busy.every((b) => /^ssh(\.exe)?$/i.test(b.by?.name ?? ''));
      if (allSsh && busy.length === plan.forwards.length) {
        // 已经有一条在转发了 —— 目的已达到，别报成错误（多半是终端里跑着 `pnpm tunnel`）。
        tell('info', '已经有一条隧道在转发了', `${lines.join('\n')}\n直接用就行，不必重开。`);
        return;
      }
      tell('error', '端口被占，隧道没起', `${lines.join('\n')}\n详见 Console`);
      console.warn(`${TAG} 占用详情：${JSON.stringify(busy)}`);
      return;
    }

    proc = spawn('ssh', plan.args, { cwd: Editor.Project.path, windowsHide: true });

    // ssh -N 连上之后一声不响，**失败才有输出**（端口占用、认证失败、主机不可达）。
    // 不转发出来的话，菜单点了没反应而预览照样连不上，查起来毫无线索。
    proc.stdout.on('data', (d) => console.log(`${TAG} ${String(d).trimEnd()}`));
    proc.stderr.on('data', (d) => console.warn(`${TAG} ssh: ${String(d).trimEnd()}`));
    proc.on('error', (e) => {
      tell('error', '起不来 ssh', `${e.message}（PATH 里有 ssh 吗？）`);
      proc = null;
    });
    proc.on('exit', (code) => {
      // 正常停止走 stopTunnel（那里已把 proc 置空），所以这里还拿得到 proc 就是**意外退出**。
      // ⚠️ 端口被占在 Windows 上可能报 **Permission denied** 而不是 Address already in use：
      // 对已被独占绑定的端口再 bind，Winsock 返回 WSAEACCES，msys 的 ssh 就翻成前者。
      // 同一个原因两种说法，搜错误信息时容易被带偏。
      if (proc && code !== 0)
        tell(
          'error',
          'SSH 隧道断了',
          `退出码 ${code}，详见 Console。端口被占是最常见的原因 —— ` +
            'Windows 上它可能报 Permission denied 而不是 Address already in use。',
        );
      proc = null;
    });

    // ⚠️ **spawn 成功 ≠ 转发建立成功**，ssh 是异步的。`ExitOnForwardFailure=yes` 让绑定失败
    // 当场退出，所以等一小会儿它还活着，基本就是真起来了。不等就报成功 = **谎报**：端口被占
    // 时先弹「已开」、再弹「断了」，人只会看见第一个，然后拿着一条没有转发的隧道去调预览。
    const started = proc;
    setTimeout(() => {
      if (proc !== started || started.exitCode !== null) return; // 已被停止 / 已经退出（exit 回调报错）
      const lines = plan.forwards.map((f) => `127.0.0.1:${f.port} → ${f.remote}（${f.key}）`);
      tell('info', `SSH 隧道已开（${plan.host}）`, lines.join('\n'));
    }, 1500);
  },

  stopTunnel() {
    if (!proc) {
      tell('info', 'SSH 隧道没有开着', '');
      return;
    }
    const p = proc;
    proc = null; // 先置空，免得 exit 回调把正常停止报成「断了」
    p.kill();
    tell('info', 'SSH 隧道已停', '端口已释放');
  },

  tunnelStatus() {
    const r = spawnSync('node', [scriptPath(), '--dry-run'], {
      cwd: Editor.Project.path,
      encoding: 'utf8',
      windowsHide: true,
    });
    const plan = (r.stdout || '').trim() || (r.stderr || '').trim();
    const live = proc && proc.exitCode === null;
    tell('info', live ? `SSH 隧道开着（pid ${proc.pid}）` : 'SSH 隧道没有开着', plan);
  },
};

exports.load = function () {
  console.log(`${TAG} loaded`);
};

/**
 * 关 Creator / 禁用扩展 / 重载扩展都会走到这里 —— **必须 kill**，否则 ssh 变孤儿继续占着端口，
 * 下次起隧道报 `Address already in use`，而那个错跟真实原因对不上。
 */
exports.unload = function () {
  if (proc) {
    proc.kill();
    proc = null;
    console.log(`${TAG} 扩展卸载 → 顺手关掉 SSH 隧道`);
  }
};

#!/usr/bin/env node
// 门槛：每个业务 VM / ECS system 必须有镜像路径的测试文件。
//
// 用存在性而不是覆盖率百分比——百分比高但没断言行为的 VM 一样没用，还容易变成刷数字的扯皮。
// 规则见 docs/design/testing-strategy-overview.md §5.2 / §6。
//
//   apps/<proj>/<源码根>/<路径>/<Name>VM.ts      →  apps/<proj>/test/<路径>/<Name>VM.test.ts
//   apps/<proj>/<源码根>/<路径>/<name>System.ts  →  apps/<proj>/test/<路径>/<name>System.test.ts
//
// 「源码根」是 `assets/`（Cocos 工程）或 `src/`（普通 TS 工程，如 apps/fish-editor）。
// 两种都认：闸管的是「逻辑有没有测」，跟这个工程用不用 Cocos 无关。
//
// 为什么 system 也要认（mini-fish 决策 D6）：ECS 把玩法拆成一串 system，逻辑不再收在一个
// `*VM.ts` 里。只认 VM 的话，一个装配用的门面 VM 有测试就全绿，而真正干活的七个 system
// 一个没测——闸绿了实际没测到，比没有闸更坏。

import { existsSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const APPS = 'apps';
const post = (p) => p.split(sep).join('/');
/** 要求镜像测试的文件名后缀。 */
const GATED = ['VM.ts', 'System.ts'];

function findGated(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) findGated(p, out);
    else if (GATED.some((suffix) => e.name.endsWith(suffix))) out.push(p);
  }
  return out;
}

const missing = [];
let checked = 0;

for (const proj of readdirSync(APPS, { withFileTypes: true })) {
  if (!proj.isDirectory()) continue;
  const root = ['assets', 'src']
    .map((d) => join(APPS, proj.name, d))
    .find((d) => existsSync(d));
  if (!root) continue;

  for (const src of findGated(root)) {
    checked++;
    const mirrored = relative(root, src).replace(/\.ts$/, '.test.ts');
    const expected = join(APPS, proj.name, 'test', mirrored);
    if (!existsSync(expected)) missing.push([post(src), post(expected)]);
  }
}

if (missing.length > 0) {
  console.error(`✗ ${missing.length}/${checked} 个 VM / system 缺测试：`);
  for (const [src, expected] of missing) console.error(`  ${src}\n    → 缺 ${expected}`);
  console.error('\n规则见 docs/design/testing-strategy-overview.md §5.2（测试目录镜像 assets）。');
  process.exit(1);
}

console.log(`✓ ${checked} 个 VM / system 全部有对应测试`);

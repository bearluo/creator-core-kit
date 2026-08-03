#!/usr/bin/env node
// 门槛：每个业务 VM 必须有镜像路径的测试文件。
//
// 用存在性而不是覆盖率百分比——百分比高但没断言行为的 VM 一样没用，还容易变成刷数字的扯皮。
// 规则见 docs/design/testing-strategy-overview.md §5.2 / §6。
//
//   apps/<proj>/assets/<路径>/<Name>VM.ts  →  apps/<proj>/test/<路径>/<Name>VM.test.ts

import { existsSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const APPS = 'apps';
const post = (p) => p.split(sep).join('/');

function findVMs(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) findVMs(p, out);
    else if (e.name.endsWith('VM.ts')) out.push(p);
  }
  return out;
}

const missing = [];
let checked = 0;

for (const proj of readdirSync(APPS, { withFileTypes: true })) {
  if (!proj.isDirectory()) continue;
  const assets = join(APPS, proj.name, 'assets');
  if (!existsSync(assets)) continue;

  for (const vm of findVMs(assets)) {
    checked++;
    const mirrored = relative(assets, vm).replace(/\.ts$/, '.test.ts');
    const expected = join(APPS, proj.name, 'test', mirrored);
    if (!existsSync(expected)) missing.push([post(vm), post(expected)]);
  }
}

if (missing.length > 0) {
  console.error(`✗ ${missing.length}/${checked} 个 VM 缺测试：`);
  for (const [vm, expected] of missing) console.error(`  ${vm}\n    → 缺 ${expected}`);
  console.error('\n规则见 docs/design/testing-strategy-overview.md §5.2（测试目录镜像 assets）。');
  process.exit(1);
}

console.log(`✓ ${checked} 个 VM 全部有对应测试`);

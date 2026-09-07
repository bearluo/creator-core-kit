#!/usr/bin/env node
/**
 * 闸：渠道表与能力目录必须对得上。
 *
 *   node apps/demo/scripts/check-channels.mjs
 *
 * 这道闸**替代不了**「CI 跑全 flavor 的 assemble」那条纪律（ADR-0021），它只是当下唯一
 * 跑得动的那一半：本仓 CI 是 `node:22-slim-git` 容器、**没有公网**，既没有 Android
 * SDK/NDK 也拉不到 Maven 依赖，编不了任何 APK。全 flavor 编译要等有 Android 镜像时补上。
 *
 * 它挡的是这套方案里最容易发生、且**静默**的那一类错：表里写了 `report: 'bugly'` 却没建
 * `src/cap-report-bugly/`。gradle 对不存在的 srcDir 不报错（照编、照出包），那个渠道的
 * `CckReport` 就这么消失了 —— 直到真机上崩溃了一条也报不出来才发现。
 * 反过来也挡：建了目录却没有任何渠道引用它，那是一份没人编译、正在悄悄腐烂的代码。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEMO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ANDROID = join(DEMO, 'native', 'engine', 'android');
const SRC = join(ANDROID, 'app', 'src');

const { channels } = JSON.parse(readFileSync(join(ANDROID, 'channels.json'), 'utf8'));
const errors = [];

/** 表 → 目录：每个声明了厂商的能力都必须有 java 源目录。 */
const referenced = new Set();
for (const [channel, caps] of Object.entries(channels)) {
  for (const [cap, vendor] of Object.entries(caps)) {
    if (vendor === 'none') continue;
    const dir = `cap-${cap}-${vendor}`;
    referenced.add(dir);
    if (!existsSync(join(SRC, dir, 'java')))
      errors.push(`渠道 '${channel}' 声明了 ${cap}=${vendor}，但没有 app/src/${dir}/java/ —— gradle 对不存在的 srcDir 不报错，这个渠道会静默地没有实现`);
  }
}

/** 目录 → 表：没人引用的能力目录不会被任何 flavor 编译。 */
for (const e of readdirSync(SRC, { withFileTypes: true }))
  if (e.isDirectory() && e.name.startsWith('cap-') && !referenced.has(e.name))
    errors.push(`app/src/${e.name}/ 没有任何渠道引用 —— 它不进任何 flavor，改了也编不到`);

if (errors.length) {
  console.error('✗ 渠道表与能力目录对不上：');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

const caps = Object.values(channels).flatMap((c) => Object.keys(c));
console.log(
  `✅ ${Object.keys(channels).length} 个渠道、${referenced.size} 份能力实现，表与目录一致` +
    `（能力：${[...new Set(caps)].join(' / ') || '无'}）`,
);

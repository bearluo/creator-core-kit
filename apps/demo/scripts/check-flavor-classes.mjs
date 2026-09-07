#!/usr/bin/env node
/**
 * 产物侧的闸：**每个 flavor 真的编出了它那份能力实现吗。**
 *
 * `pnpm check:channels` 只比对「表 ↔ 目录」，是**源码期**的检查；它看不见 gradle 到底把
 * 哪些文件喂给了 javac。而那一环出过一次真事故：`app/src` 被模板当成 main 的递归源根，
 * 三份 `cap-report-*` 被无差别编进每个 flavor。修掉之后又撞上 AGP 的**增量陈旧** ——
 * 任务报 UP-TO-DATE、构建全绿，产物里却一个 `CckReport.class` 都没有。
 *
 * 这两种都是**静默**的：包能装、能跑，只是崩溃一条也报不出去。CI 为了快特意保留
 * `apps/demo/build/`（`GIT_CLEAN_FLAGS: -ffd`），等于把增量陈旧的可能性一直留着，
 * 所以这道闸不是可选项。
 *
 * 跑在 gradle 之后：`node apps/demo/scripts/check-flavor-classes.mjs`
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEMO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHANNELS = JSON.parse(
  readFileSync(join(DEMO, 'native', 'engine', 'android', 'channels.json'), 'utf8'),
).channels;
const JAVAC = join(DEMO, 'build', 'android', 'proj', 'build', 'demo', 'intermediates', 'javac');

if (!existsSync(JAVAC)) {
  console.error(`✗ 没有 javac 产物：${JAVAC}\n  先跑一遍 gradle assembleDebug`);
  process.exit(1);
}

// 能力 → 那份实现里一定会出现的厂商标记。.class 的常量池是明文 ASCII，读字节找子串即可
// ——不用反编译，也不用 dex 工具。它同时答了两个问题：编出来了没、编进去的是不是**那一家**。
const VENDOR_MARK = {
  logcat: 'android/util/Log',
  bugly: 'com/tencent/bugly/crashreport/CrashReport',
  firebase: 'com/google/firebase/crashlytics/FirebaseCrashlytics',
};

const bad = [];
for (const [channel, caps] of Object.entries(CHANNELS)) {
  for (const [cap, vendor] of Object.entries(caps)) {
    if (vendor === 'none') continue;
    const variant = `${channel}Debug`;
    // 能力 → 类名的映射目前只有一条；多一种能力时这里跟着加一行。
    const cls = join(JAVAC, variant, 'classes', 'com', 'cck', 'report', 'CckReport.class');
    if (!existsSync(cls)) {
      bad.push(`${channel}: ${cap}=${vendor}，但 ${variant} 里没有 CckReport.class`);
      continue;
    }
    const mark = VENDOR_MARK[vendor];
    if (mark === undefined) {
      bad.push(`${channel}: 不认识的厂商 '${vendor}' —— 给 VENDOR_MARK 补一行`);
      continue;
    }
    if (!readFileSync(cls).includes(mark)) {
      bad.push(`${channel}: ${variant} 里的 CckReport 不是 ${vendor} 那份（常量池里找不到 ${mark}）`);
    }
  }
}

if (bad.length > 0) {
  console.error('✗ flavor 产物与渠道表对不上：');
  for (const b of bad) console.error(`  · ${b}`);
  console.error('\n  多半是 AGP 增量陈旧。先 rm -rf apps/demo/build/android/proj/build/demo/intermediates/javac 再编一遍。');
  process.exit(1);
}
const n = Object.keys(CHANNELS).length;
console.log(`✅ ${n} 个渠道的能力实现都编进了各自的 flavor，且厂商对得上`);

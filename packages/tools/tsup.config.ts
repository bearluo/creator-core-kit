import { defineConfig } from 'tsup';

// 纯 node CLI：只打 cli 一个入口成可执行 CJS bin（加 shebang）。
// dts:false——无人 import @cck/tools 的类型，省掉 engine 那套 composite/dts 折腾。
// node 内建（node:fs/crypto/path/util）在 cjs 下自动 external。
export default defineConfig({
  entry: ['src/cli.ts', 'src/cli-excel.ts'],
  format: ['cjs'],
  target: 'node20',
  dts: false,
  clean: true,
  banner: { js: '#!/usr/bin/env node' },
});

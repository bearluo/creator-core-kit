// 把扩展的烘焙源码（bake/src）打成场景进程用的 bake/dist/bake.js（cjs，cc 由编辑器提供）。产物入库。
// --check：只比对不写，产物和源码不同步时退出码 1。
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../extensions/spine-vat-importer/bake');
const outfile = resolve(root, 'dist/bake.js');
const result = await build({
  entryPoints: [resolve(root, 'src/index.ts')],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'es2020',
  external: ['cc'],
  write: false,
  logLevel: 'error',
});
const text = `// 生成物，勿手改：node tools/build-bake.mjs\n${result.outputFiles[0].text}`;

if (process.argv.includes('--check')) {
  let current = '';
  try { current = readFileSync(outfile, 'utf8'); } catch {}
  if (current.replace(/\r\n/g, '\n') !== text) {
    console.error('bake/dist/bake.js 与 bake/src 不同步，运行 pnpm build:spine-vat-bake');
    process.exit(1);
  }
} else {
  mkdirSync(dirname(outfile), { recursive: true });
  writeFileSync(outfile, text);
}

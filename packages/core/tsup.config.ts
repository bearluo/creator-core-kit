import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  // 发布构建专用 tsconfig（composite:false）；避免 tsup dts 步骤与 project-references
  // 的 composite 冲突（TS6307）。typecheck 仍走 tsconfig.json 的 composite。
  tsconfig: 'tsconfig.build.json',
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es2021',
});

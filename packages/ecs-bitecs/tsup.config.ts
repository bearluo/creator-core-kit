import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  // 发布构建专用 tsconfig（composite:false），避免 tsup dts 与 project-references 冲突（TS6307）。
  tsconfig: 'tsconfig.build.json',
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es2021',
  // 把 bitecs 打进 dist（tsup 默认把 dependencies external，故显式 noExternal 覆盖）：
  // ~5kb / 零依赖 / ESM，且 ECS 逻辑不跨 bundle → 无 core/cc 那种单例约束（ADR-0001），
  // 内联最省事，兑现「一站式，项目只引 @cck/ecs-bitecs 一个包即拿到全套 bitECS」（设计 TL;DR / 决策 #2）。
  noExternal: ['bitecs'],
});

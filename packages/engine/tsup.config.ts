import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  // 消费构建专用 tsconfig（composite:false）：避免 tsup 的 dts 步骤与
  // project-references 的 composite 冲突（TS6307）。typecheck 仍走 tsconfig.json。
  tsconfig: 'tsconfig.build.json',
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es2021',
  // cc 由宿主 Cocos 运行期提供；@cck/core 单独作 npm 包被 Cocos 解析（共享单实例，
  // 见 ADR-0001 全局注册表）。两者都 external —— dist 里保留 bare import，交给
  // Cocos QuickPack 解析（本机验证 engine 消费机制，见 ADR-0003 决策 #7）。
  external: ['cc', '@cck/core'],
});

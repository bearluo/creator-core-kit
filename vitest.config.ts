import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // engine 测试：cc → 测试替身（单一真源，见 packages/engine/test/mocks/cc.ts / ADR-0002）
      cc: fileURLToPath(new URL('./packages/engine/test/mocks/cc.ts', import.meta.url)),
      // engine 测试直跑 core 源码，免去「改完 core 必须先 build 才跑 engine 测」
      '@cck/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
      // 同理：apps/demo 的 mini-fish 直跑 ecs 包源码
      '@cck/ecs-bitecs': fileURLToPath(
        new URL('./packages/ecs-bitecs/src/index.ts', import.meta.url),
      ),
      // 鱼阵编辑器（apps/fish-editor，纯 web 工具）跟游戏共用的那份零 `cc` 逻辑。
      // 三处别名必须一致：这里、apps/fish-editor/vite.config.ts、apps/fish-editor/tsconfig.json。
      '@game': fileURLToPath(new URL('./apps/demo/assets/modules/mini-fish', import.meta.url)),
    },
  },
  // 固定 esbuild 的 TS 选项，**顺带关掉 tsconfig 自动查找**——apps/demo/tsconfig.json
  // extends 的是 Creator 生成的 temp/tsconfig.cocos.json（gitignore 里），本机有、
  // CI 上没有 → 转译 demo 的 VM 时 `Cannot find module './temp/tsconfig.cocos.json'`。
  // 给了 tsconfigRaw 就不再往上找 tsconfig，本机与 CI 行为一致。
  // experimentalDecorators 必须开：engine 薄壳（cck-ui-view / kit-context）带 @ccclass。
  // ⚠️ 必须是**字符串**：vite 只有 `typeof tsconfigRaw === 'string'` 才跳过查找，
  // 传对象它照样先读 tsconfig 再合并（vite 5.4 transformWithEsbuild），坑照踩。
  esbuild: {
    tsconfigRaw:
      '{"compilerOptions":{"experimentalDecorators":true,"useDefineForClassFields":false}}',
  },
  test: {
    // 业务侧测试在 assets 之外（Creator 会编译 assets 下所有 .ts 并打进包）——
    // 目录镜像 assets，见 docs/design/testing-strategy-overview.md §5。
    include: ['packages/*/src/**/*.{test,spec}.ts', 'apps/*/test/**/*.{test,spec}.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      // core 覆盖率是 CI 硬门槛（见 CLAUDE.md）；engine 用 cc mock 另测，不计入
      include: ['packages/core/src/**'],
      exclude: ['packages/core/src/**/__tests__/**', 'packages/core/src/index.ts'],
      reportsDirectory: './coverage',
      // **门要真的会拦**。此前只有 CI 的 `coverage:` 正则从文本报告里抓个数字给 GitLab 页面显示，
      // 掉到 60% 流水线照样绿——「以为有门其实没有」。
      // 取值贴着实测值下方（statements 99.36 / branches 97.30 / functions 98.36）留一点余量：
      // 这是**棘轮**，不是及格线。真要降门槛就连同原因一起改这里，别让它无声下滑。
      thresholds: { statements: 99, branches: 97, functions: 98, lines: 99 },
    },
  },
});

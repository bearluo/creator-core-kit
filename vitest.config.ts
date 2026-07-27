import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // engine 测试：cc → 测试替身（单一真源，见 packages/engine/test/mocks/cc.ts / ADR-0002）
      cc: fileURLToPath(new URL('./packages/engine/test/mocks/cc.ts', import.meta.url)),
      // engine 测试直跑 core 源码，免去「改完 core 必须先 build 才跑 engine 测」
      '@cck/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['packages/*/src/**/*.{test,spec}.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      // core 覆盖率是 CI 硬门槛（见 CLAUDE.md）；engine 用 cc mock 另测，不计入
      include: ['packages/core/src/**'],
      exclude: ['packages/core/src/**/__tests__/**', 'packages/core/src/index.ts'],
      reportsDirectory: './coverage',
    },
  },
});

import { defineConfig } from 'vitest/config';

export default defineConfig({
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

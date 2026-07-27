import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      'coverage/**',
      '**/*.tsbuildinfo',
      // spike 是不上传的实验工程；Cocos 生成物一并忽略
      'spike/**',
      '**/build/**',
      '**/library/**',
      '**/temp/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // 核心铁律：core 是纯逻辑层，禁止 import 'cc'（引擎能力走接口 + DI 注入）
    // 见 CLAUDE.md「核心铁律」/ ADR-0001
    files: ['packages/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'cc',
              message: "core 禁止 import 'cc'：引擎能力走 Core 定义的接口 + DI 注入（见 CLAUDE.md 核心铁律）。",
            },
          ],
          patterns: [
            {
              group: ['cc', 'cc/*', 'cc/**'],
              message: 'core 禁止依赖引擎（cc 及其子模块）。',
            },
          ],
        },
      ],
    },
  },
);

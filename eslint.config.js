import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/dist-types/**',
      '**/node_modules/**',
      'coverage/**',
      '**/*.tsbuildinfo',
      // spike 是不上传的实验工程；Cocos 生成物一并忽略
      'spike/**',
      '**/build/**',
      '**/library/**',
      '**/temp/**',
      // apps/* 是 Cocos Creator 工程（自带 Creator 编译基线 + 第三方编辑器扩展如
      // funplay-cocos-mcp 的 Node/CJS 代码），不进 monorepo 根 lint 契约；根 lint 只管
      // packages/core+engine 的铁律与风格。demo 脚本若需 lint，另在 apps/demo 自配。
      'apps/**',
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

import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/dist-types/**',
      '**/node_modules/**',
      // CI 把 pnpm store 放进仓库目录里做缓存（--store-dir .pnpm-store），git 依赖
      // 会在它的 tmp/ 下留一份契约仓的完整签出 —— 别人的源码不该被本仓的 lint 契约管。
      // 本机默认用全局 store，所以这条只在 CI 上生效（也只有 CI 会踩）。
      '.pnpm-store/**',
      'coverage/**',
      '**/*.tsbuildinfo',
      // spike 是不上传的实验工程；Cocos 生成物一并忽略
      'spike/**',
      '**/build/**',
      '**/library/**',
      '**/temp/**',
      // apps/demo 是 Cocos Creator 工程（自带 Creator 编译基线 + 第三方编辑器扩展如
      // funplay-cocos-mcp 的 Node/CJS 代码），不进 monorepo 根 lint 契约；根 lint 只管
      // packages/core+engine 的铁律与风格。demo 脚本若需 lint，另在 apps/demo 自配。
      // ⚠️ **逐个列 Cocos 工程**而不是 `apps/**`：apps/fish-editor 是普通 vite 工程，没有
      // Creator 那套基线，本来就该受根契约管（少维护一份 lint 配置）。以后新增的普通 TS 工程
      // 默认被管，是想要的；再来一个 Creator 工程才往这儿加一行。
      'apps/demo/**',
      'apps/ecs-lab/**',
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
  {
    // 仓库维护脚本（node ESM，不进游戏包，也不进 Cocos 构建）。
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { console: 'readonly', process: 'readonly' } },
  },
  {
    // 会被打进 Cocos 构建的运行时代码（测试只在 node 跑，不受此限）。
    files: ['packages/*/src/**/*.ts'],
    ignores: ['packages/*/src/**/__tests__/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ArrayExpression > SpreadElement',
          message:
            '禁止数组字面量展开：Cocos 构建（babel loose spread）把 `[...x]` 降级成 `[].concat(x)`，' +
            '对 Set/Map/Iterator 会把整个集合塞成单个元素，且预览不降级、只在构建产物里炸。' +
            '用 Array.from(x) 取快照，用 a.concat(b) 拼接。',
        },
      ],
    },
  },
);

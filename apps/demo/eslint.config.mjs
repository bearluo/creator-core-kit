// apps/demo 的 lint 契约（业务侧规则）。
//
// 为什么单独一份：根 `eslint.config.js` 把 `apps/**` 整个 ignore 了（Cocos 工程自带 Creator
// 编译基线 + 第三方编辑器扩展不进 monorepo 根契约）。业务规则加进根配置会**静默失效**
// ——不报错，也不生效。规则依据见 docs/design/testing-strategy-overview.md §4 / §6。
//
// ⚠️ 本文件的 files / ignores 写的是**仓库根相对路径**，必须从仓库根调用：`pnpm lint:demo`。
//    （从根调用同时保证 @eslint/js、typescript-eslint 从根 node_modules 解析——demo 自己没装。）

import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/** 受本契约管的业务代码：Creator 编译的 assets + assets 外的单测。 */
const BUSINESS = ['apps/demo/assets/**/*.ts', 'apps/demo/test/**/*.ts'];

export default tseslint.config(
  {
    ignores: [
      'apps/demo/extensions/**', // 第三方编辑器扩展（funplay-cocos-mcp，Node/CJS）
      'apps/demo/scripts/**', // 编辑器里一次性跑的生成脚本，不是游戏运行时代码
      'apps/demo/library/**',
      'apps/demo/temp/**',
      'apps/demo/build/**',
      'apps/demo/profiles/**',
      'apps/demo/native/**',
      'apps/demo/node_modules/**',
      // 契约仓的模块段产物（`pnpm proto:sync` 拷进来，别手改）。别人生成的代码不受本仓
      // 风格契约管——但 loose spread 那条硬规则得另行确保：pbjs 产物里没有数组展开，
      // 换生成器时要重查（`grep '\[\.\.\.'`），那个坑只在构建产物里炸、预览测不出。
      'apps/demo/assets/**/*-proto.ts',
    ],
  },
  {
    files: BUSINESS,
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
  },
  {
    files: BUSINESS,
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'ExportNamedDeclaration > VariableDeclaration > VariableDeclarator > NewExpression',
          message:
            '禁模块级单例：bundle 卸载不卸脚本、编辑器 stop→play 保留 JS 上下文、单 bundle 出包依赖内联，' +
            '三条都让它拿到脏的旧实例。要共享请注册进模块 DI scope（containerScoped），' +
            '生命周期绑作用域而不是模块加载。见 docs/design/testing-strategy-overview.md §4。',
        },
        {
          selector: 'PropertyDefinition[static=true][key.name=/^_?inst(ance)?$/]',
          message: '禁模块级单例：static 实例字段同上，改注册进模块 DI scope。',
        },
        {
          selector: "MethodDefinition[static=true][key.name=/^(instance|getInstance)$/]",
          message: '禁模块级单例：static instance()/getInstance() 同上，改从 DI 容器 resolve。',
        },
        {
          // 与根 eslint.config.js 对 packages/*/src 的同名规则一致——assets 同样被 Cocos 构建。
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

---
状态: 已接受
日期: 2026-07-27
依赖: docs/design/modules/monorepo-scaffold.md
---

# ADR-0003：Cocos 消费 core 走 workspace npm 包（node_modules 直连），非把 core 拷进 assets

## 背景

monorepo 里 `packages/core`（纯 TS、零 cc、可发 npm）要被 `apps/demo`（真实 Cocos Creator 3.8 工程）消费。骨架设计（`monorepo-scaffold.md` 决策 #3/#7、关键集成方案）给出三条候选，按优先级验证：

1. **npm 包**：demo 依赖 `@cck/core: workspace:*`，`.npmrc` 设 `node-linker=hoisted` 让它扁平落在 `apps/demo/node_modules/@cck/core`，Cocos 按第三方 npm 模块 `import from '@cck/core'`。
2. **源码映射**：把 `packages/core/src` symlink 进 `apps/demo/assets/core`，Cocos 当项目脚本编译（core 被编两次）。
3. **构建产物注入**：`tsup` 产物复制/注入 `apps/demo/assets`（最稳但有构建步骤）。

最大风险是「Cocos 3.8 的 packer 能否解析 workspace 链接的 npm 包」。早期一次试探因**加依赖后没重跑 `pnpm install`**（node_modules 里根本没有该包）而误判"不支持目录导入 / 消费不了 workspace 包"，并一度绕路走方案 3 的变体（把 tsup 单包当 `.ts` 注入 `assets/vendor`），引入编码坑与编辑器 QuickPack 陈旧状态。纠错后按方案 1 干净复验。

## 决策

1. **core → Cocos 的正式消费机制 = 方案 1（workspace npm 包，node_modules 直连）。**
   - demo `package.json` 依赖 `@cck/core: workspace:*`；根 `.npmrc` `node-linker=hoisted`。
   - `pnpm install` 后 `apps/demo/node_modules/@cck/core` 为指向 `packages/core` 的 symlink；Cocos QuickPack 按 core `package.json` 的 `main`→`dist/index.js` 解析 **bare specifier** `@cck/core`。
   - **不把 core 拷进 / 映射进 `assets`**（方案 2/3 仅作 symlink 不可用时的退路）。
2. **`dist/index.js` 由 `tsup` 独占产出**（ESM **自包含单包**，无内部相对 import）。**typecheck 的 `tsc -b` 必须 `emitDeclarationOnly`**，只出 `.d.ts`，绝不写 `.js` 进 `dist/`——否则 tsc 的多文件 `index.js` 会覆盖 tsup 单包，令 Cocos 消费到的产物随「build/typecheck 谁最后跑」漂移。
3. **打开 / 预览 Creator 前须先 `pnpm --filter @cck/core build`（或根 `pnpm build`）**，保证 `dist/` 是最新 tsup 产物。`dist/` 不入库（`.gitignore` 已覆盖）。
4. **demo `tsconfig.json` 不为 `@cck/core` 配 `paths`**：类型解析与运行期解析都走 node_modules（读 `dist/index.d.ts`），最忠于 Cocos 运行期实际行为。（配 paths→core src 会让 IDE/诊断按 Cocos 低 `lib` 基线编译 core 源码，误报 `Object.entries` 等 ES2017 缺失——假警报。）
5. **兜底（暂不启用）**：若某 Cocos 版本的 packer 认不了 node_modules 里的 bare specifier，则加工程根 `import-map.json` 显式指路 `"@cck/core": "./node_modules/@cck/core/dist/index.js"`，绕开 node 解析 / exports 强制。当前 3.8.7 无需。

## 理由

- **实证成立（真 cc，非纸面）**：`apps/demo`（Creator **3.8.7** + funplay MCP）里 `DemoBoot.ts` bare import `@cck/core`，gameView 预览打出全部 `[CCK-DEMO]` 行（i18n zh/en 切换 + `{name}` 插值、ConfigTable 主键查询、ObjectPool LIFO 复用），中文无乱码。**3.8.7 即认 workspace 链接包，无需 import-map、无需拷 core 进 assets。**
- **`node-linker=hoisted` 是关键**（决策表 #2 得证）：pnpm 默认深层 `.pnpm` symlink 疑似 Cocos packer 认不了；hoisted 扁平化后 `node_modules/@cck/core` 直连包目录，解析无碍——布局等同传统 npm workspace。
- **对齐姊妹项目**：bearluo/ccc-framework-monorepo（npm workspace、Creator 3.8.8）同样以 workspace npm 包（`@ccc/fw`，bare import，node_modules 解析）供 Cocos 消费，其 game-template 工程 `tsconfig.paths` 与 `import-map` 皆空、纯靠 node_modules——互为佐证。
- **不拷进 assets 的收益**：core 不落 prefab/场景、无双份源码维护、发 npm 结构天然成立；符合铁律「逻辑可脱离引擎、易多人协作」。

## 后果

- **正面**：消费路径与「core 可发 npm」同构；无同步脚本/无 assets 内产物噪声；IDE 与运行期解析一致。
- **代价 / 约束**：
  - 打开 Creator 前**必须先 build core**（dist 不入库）；应在开发/CI 流程固化这一步（后续可加 `predev` 脚本或 Creator 打开前钩子）。
  - `tsc -b` 的 `emitDeclarationOnly` 是隐性契约，改 tsconfig 时勿回退（否则 footgun 复现）。
  - 依赖变更后**务必 `pnpm install`** 让 node_modules 链接生效——本 ADR 的教训之一。
- **engine（决策 #7）不适用本 ADR**：engine 依赖 `cc`，只有工程内编译才有 `cc`，仍走 assets 源码 bundle 映射进 `apps/demo/assets/engine`，另行验证。

## 备选（未采纳）

- **方案 2 源码映射 / 方案 3 产物注入 assets**：core 被编两次或引入 assets 内产物/同步脚本；仅在 symlink 在某平台（如 Windows 无开发者模式）不可用时退化启用。
- **import-map.json 显式指路**：更强的兼容兜底（绕开 node 解析与 exports 强制），但当前 3.8.7 node_modules 直连已通，YAGNI，保留为兜底预案。

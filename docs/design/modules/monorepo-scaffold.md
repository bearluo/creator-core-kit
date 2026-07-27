---
模块: monorepo-scaffold
所在包: 根
状态: 已实现（骨架 4/4 验收通过；core 消费方案①在真 Cocos Creator 3.8.7 验证跑通）  # 草案 → 评审中 → 已定稿 → 已实现
摘要: monorepo 骨架——pnpm workspace(core/engine/demo) + vitest + TS project references + core 禁 import cc 的 lint 约束 + Cocos 消费集成。
何时读: 搭建/调整仓库骨架、加新包、排查 Cocos 吃不进 core、配置测试或依赖约束时。
日期: 2026-07-24
依赖: docs/design/2026-07-24-architecture-overview.md
---

# monorepo 骨架 设计文档

## TL;DR

用 pnpm workspace 立起 `packages/core`（纯 TS，vitest 在 node 测，可发 npm）、`packages/engine`（cc 适配，作为 demo `assets/` 下源码 bundle）、`apps/demo`（Cocos 3.8 工程）。根配 vitest + ESLint（**强制 core 不许 import `cc`**）+ TS project references。**唯一真实风险**：Cocos 3.8 能否解析 pnpm symlink 式 node_modules 里的 `@cck/core`——用 `.npmrc` 的 `node-linker=hoisted` 降风险，并以一个 spike（demo import core 函数并预览成功）作为骨架验收前置。

## Purpose（目标与定位）

- **做什么**：把空仓库变成可开发的 monorepo 骨架，让后续每个模块"逻辑进 core、薄壳进 engine、demo 里验证"有地方落。
- **验收即完成**：`pnpm i` 通过；`pnpm test` 能跑通 core 的一个示例单测；demo 工程能 import core 的一个函数并预览成功；lint 能拦住 core 里的 `import 'cc'`。
- **YAGNI**：首版不引 turborepo/nx（pnpm workspace 足够）、不做 CI（下一步单独加）、不发布 npm（只保证 core 结构上可发）。

## 目标结构

```
creator-core-kit/
├─ package.json                根 workspace（scripts: test/lint/build）
├─ pnpm-workspace.yaml          packages/* + apps/*
├─ .npmrc                       node-linker=hoisted（降低 Cocos 解析 symlink 风险）
├─ tsconfig.base.json           共享 compilerOptions
├─ vitest.config.ts            （或各包各自配）
├─ .eslintrc.cjs               含 no-restricted-imports 禁 core 里 'cc'
├─ packages/
│  ├─ core/
│  │  ├─ package.json           name @cck/core, exports, 可发 npm
│  │  ├─ tsconfig.json          extends base
│  │  ├─ src/index.ts
│  │  └─ src/__tests__/*.test.ts
│  └─ engine/
│     ├─ package.json           name @cck/engine, private
│     ├─ tsconfig.json          types 含 cocos（引用 demo 的 cc 声明）
│     └─ src/…                  cc 适配薄壳（不在 node 测）
└─ apps/
   └─ demo/                     Cocos Creator 3.8 工程
      ├─ assets/                含指向 core/engine 的接入点（方案见下）
      ├─ package.json           依赖 @cck/core（workspace:*）
      └─ tsconfig.json          Cocos 生成
```

## Key design decisions（决策表）

| # | 维度 | 选项 | 推荐默认 | 理由 |
|---|---|---|---|---|
| 1 | 包管理/工作区 | npm / yarn / **pnpm workspace** | **pnpm workspace** | 磁盘省、workspace:* 本地链、生态主流；CLAUDE.md 已定 |
| 2 | node_modules 布局 | 默认 symlink / **hoisted** | **`node-linker=hoisted`** | Cocos 解析器对 pnpm 深层 symlink 支持存疑，扁平化更像传统 npm，最大化 Cocos 兼容 |
| 3 | core 构建 | tsc / **tsup** / 不构建 | **tsup**（出 ESM 自包含单包 + d.ts） | core 要可发 npm；tsup 零配置出 ESM+类型；**`dist/` 由 tsup 独占**，typecheck 的 `tsc -b` 设 `emitDeclarationOnly` 只出 `.d.ts`（否则 tsc 的多文件 `index.js` 会覆盖 tsup 单包，令 Cocos 消费到的 `dist/index.js` 随「谁最后跑」漂移） |
| 4 | 测试 | jest / **vitest** | **vitest** | 已定；`--watch` 秒级反馈支撑"逻辑热重载" |
| 5 | TS 组织 | 各自独立 / **project references** | **project references** | 增量编译、跨包类型跳转、强制依赖方向 |
| 6 | core 禁 cc 强制 | 口头约定 / **eslint no-restricted-imports** / dependency-cruiser | **eslint no-restricted-imports**（首版） | 零新依赖、CI 可跑；不够再上 dependency-cruiser |
| 7 | engine 被 Cocos 消费 | npm 包 / **assets 下源码 bundle** | **assets 源码 bundle** | engine import 'cc'，只有工程内编译才有 cc，无法走 node_modules |

## 关键集成方案：Cocos 3.8 如何消费 core / engine（最大风险点）

**engine（依赖 cc）**：物理位置在 `packages/engine/src`，通过 **symlink 或 Cocos 多资源目录**映射到 `apps/demo/assets/engine`，由 Cocos 当项目脚本编译（从而拿到 `cc`）。跨项目复用 = 复制/submodule 这个目录。

**core（不依赖 cc）** 有三条路，按优先级验证：
1. **npm 包（首选，✅ 已在真 cc 3.8.7 验证）**：demo `package.json` 依赖 `@cck/core: workspace:*`，`node-linker=hoisted` 让它落在 `apps/demo/node_modules/@cck/core`（symlink→`packages/core`），Cocos QuickPack 按第三方 npm 模块 `import from '@cck/core'` 解析（走 package.json `main`→`dist/index.js`）。—— **实证成立**：DemoBoot bare import、预览打出 `[CCK-DEMO]` 全部 OK（详见实现记录 2026-07-27）。**Cocos 3.8.7 认 workspace 链接包（hoisted symlink），无需 import-map。**
2. **源码映射（备选）**：把 `packages/core/src` symlink 到 `apps/demo/assets/core`，Cocos 当项目脚本编译。规避 node_modules 解析问题，但 core 变成"被编两次"（node 测 + Cocos）。
3. **构建产物注入（兜底）**：`tsup` 产物复制到 `apps/demo/assets/core`（脚本自动化）。最稳但有构建步骤。

> **Windows 注意**：symlink 在 Windows 需开发者模式/管理员权限，git 跨平台也易踩坑。若 symlink 不稳，方案 2/1 退化为方案 3（复制）。

## Testable seams + 验收标准

骨架"已实现"的可验证标志（缺一不可）：
1. `pnpm i` 无错。
2. `packages/core/src/__tests__/hello.test.ts` 一个示例断言，`pnpm test` 通过（证明 core 在 node 环境可测、零 cc）。
3. **Spike**：demo 里写一个 Component，`import { hello } from '@cck/core'`（或映射路径），预览打印成功（证明 Cocos 能消费 core）。
4. `import { director } from 'cc'` 写进 `packages/core/src` 时，`pnpm lint` **报错**（证明依赖约束生效）。

## Open Questions（待你拍板 / 待 spike 验证）

1. ~~**core 被 Cocos 消费方案**：先按"方案 1 npm 包"试，失败即退方案 3 复制？~~ **已定（2026-07-27）：方案 1 npm 包在真 cc 3.8.7 跑通，采纳为正式机制。** 方案 2/3 仅作 symlink 不可用时的退路。姊妹项目 bearluo/ccc-framework-monorepo（npm workspace，3.8.8）同样走 npm 包直连，互为佐证。
2. **包名 scope**：`@cck/*` 是否 OK（creator-core-kit 缩写），还是换成 `@creator-core-kit/*` 或公司 scope？
3. **demo 工程谁来建**：我用 MCP/CLI 生成 Cocos 3.8 空工程，还是你在 Creator 里新建后我接管配置？（Cocos 工程结构最好由编辑器生成，避免手写 meta 出错。）
4. engine↔assets 用 symlink 还是 Cocos「多资源目录」配置——留到 spike 时按 Windows 实测定。

---

## 实现记录

- **骨架结构（已落地）**：根 `package.json`(workspace scripts) + `pnpm-workspace.yaml` + `.npmrc`(`node-linker=hoisted`) + `tsconfig.base.json` + 根 `tsconfig.json`(project references→core/engine) + `vitest.config.ts` + `eslint.config.js`(flat config, core 禁 `cc`)；`packages/core`(`@cck/core`, tsup 出 ESM+dts, 示例 `hello` + 单测)；`packages/engine`(`@cck/engine`, private, 依赖 `@cck/core` workspace:*, 占位)。`apps/demo` 待在 Creator 建后接入。
- **与设计偏差**：① ESLint 用 **flat config**（`eslint.config.js`）而非设计里的 `.eslintrc.cjs`（ESLint 9 默认 flat）；② pnpm 11 需在 `pnpm-workspace.yaml` 配 `allowBuilds: { esbuild: true }` 放行 esbuild 构建脚本。
- **验收结果**：① `pnpm install` ✅；② `pnpm test` **vitest 2 passed**（core node 单测、零 cc）✅；③ `pnpm typecheck`(tsc -b) ✅；④ `pnpm build`(tsup 出 `dist/index.js`+`index.d.ts`) ✅；⑤ `pnpm lint` ✅，且往 core 写 `import 'cc'` 被 `no-restricted-imports` **拦下报 error** ✅。**验收 4 条达成 3 条**，剩「demo import `@cck/core` 预览成功」待建 demo 工程验证。
- **遗留**：① demo 工程（在 Creator 建）→ 验证 core 消费方案 1（`node_modules/@cck/core`, hoisted）+ engine↔assets 映射；② pnpm workspace **symlink 场景** Cocos 认不认（骨架用 hoisted 复制，symlink 待 demo 阶段实测）；③ 尚未 commit（拟与 spike 实证文档一起提交）。

### 2026-07-27 · demo 消费 core 在真 cc 3.8.7 打通（验收第 3 条达成，骨架 4/4）

- **结果**：`apps/demo`（Creator 3.8.7 空工程 + funplay MCP）里 `DemoBoot.ts` 以 **bare `import { CCK_CORE_VERSION, createI18n, createTable, createPool } from '@cck/core'`** 消费 core；gameView 预览 `project.log` 打出全部 `[CCK-DEMO]` 行：`core version=0.0.0` / `i18n(zh)=你好 Cocos` / `i18n(en)=Hi Cocos` / `table.get(2).hp=200 size=2` / `pool LIFO reuse=OK` / `✅ core consumed & running under real cc`。i18n / ConfigTable / ObjectPool 三模块在**真 cc 运行时**跑通，中文无乱码。
- **消费机制（正式采纳 = 方案①）**：`pnpm install` 后 `apps/demo/node_modules/@cck/core` 是指向 `packages/core` 的 symlink（`node-linker=hoisted` 让布局扁平如 npm）；Cocos QuickPack 按 package.json `main`→`dist/index.js`（tsup **自包含单包**）解析 bare specifier。**3.8.7 即认 workspace 链接包，无需 import-map、无需把 core 拷进 assets。** demo 的 `tsconfig.json` **不配 `@cck/core` 的 paths**（类型与运行期都走 node_modules，最忠于运行期；与 bearluo game-template 一致）。
- **决策表 #2 得证**：`node-linker=hoisted` 是关键——pnpm 默认深层 `.pnpm` symlink 曾疑似 Cocos 认不了，hoisted 扁平化后 `node_modules/@cck/core` 直连包目录，解析无碍。
- **修掉一个 footgun**：`tsc -b`(typecheck) 与 `tsup`(build) 原本都往 `dist/` 写 `index.js`——tsc 的多文件版会覆盖 tsup 单包，令 Cocos 消费到的产物随执行顺序漂移。给 `packages/core/tsconfig.json` 加 `emitDeclarationOnly: true`：tsc 只出 `.d.ts`，`dist/index.js` 永远归 tsup。另给 core `package.json` exports 补 `default` 条件对齐通行做法。
- **踩坑纠错（重要）**：早先一度误判"Cocos 消费不了 workspace npm 包"——实为①给 `apps/demo` 加 `@cck/core` 依赖后**没重跑 `pnpm install`**（node_modules 里根本没有该包）、②转而绕路把 tsup 产物当 `.ts` 注入 `assets/vendor`、③中途删 `temp/programming` 把编辑器 QuickPack 状态搞乱。与消费机制本身无关。清理：删除 `assets/vendor/*`，重启编辑器清 QuickPack 陈旧入口后一次跑通。
- **eslint 扫描范围修正**：`apps/demo` 落地后 `eslint .` 扫进了 funplay 第三方扩展（Node/CJS 代码）报 796 个 `no-undef`/`no-require-imports`（flat config 不读 `.gitignore`）。给 `eslint.config.js` `ignores` 加 `'apps/**'`——Cocos 工程自带 Creator 编译基线、不属 monorepo 根 lint 契约（根 lint 只管 packages/core+engine）。修正后 lint 复绿。
- **全绿复验**：`pnpm typecheck` ✅ / `pnpm test` **192 passed（13 文件）** ✅ / `pnpm lint` ✅ / `pnpm build`（tsup 单包）✅。
- **engine 消费（决策 #7）仍待做**：engine 依赖 `cc`，按 assets 源码 bundle 映射进 `apps/demo/assets/engine`，下一阶段验证。

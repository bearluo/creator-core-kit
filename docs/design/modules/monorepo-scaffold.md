---
模块: monorepo-scaffold
所在包: 根
状态: 已实现（骨架 4/4 验收通过；core + engine 消费均在真 Cocos Creator 3.8.7 验证跑通）  # 草案 → 评审中 → 已定稿 → 已实现
摘要: monorepo 骨架——pnpm workspace(core/engine/demo) + vitest + TS project references + core 禁 import cc 的 lint 约束 + Cocos 消费集成。
何时读: 搭建/调整仓库骨架、加新包、排查 Cocos 吃不进 core、配置测试或依赖约束时。
日期: 2026-07-24
依赖: docs/design/2026-07-24-architecture-overview.md
---

# monorepo 骨架 设计文档

## TL;DR

用 pnpm workspace 立起 `packages/core`（纯 TS，vitest 在 node 测，可发 npm）、`packages/engine`（cc 适配，作为 workspace npm 包供 demo 消费，见决策 #7）、`apps/demo`（Cocos 3.8 工程）。根配 vitest + ESLint（**强制 core 不许 import `cc`**）+ TS project references。**唯一真实风险**：Cocos 3.8 能否解析 pnpm symlink 式 node_modules 里的 `@cck/core`——用 `.npmrc` 的 `node-linker=hoisted` 降风险，并以一个 spike（demo import core 函数并预览成功）作为骨架验收前置。

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
| 3 | core 构建 | tsc / **tsup** / 不构建 | **tsup**（出 ESM 自包含单包 + d.ts） | core 要可发 npm；tsup 零配置出 ESM+类型；**`dist/` 由 tsup 独占**（Cocos/其它包消费），**`tsc -b` 出 `.d.ts` 到独立的 `dist-types/`**（供 typecheck/composite），二者不共用 dist——否则 tsup 的 `clean` 抹掉 tsc 的子 `.d.ts`、tsc 增量又拒绝重生成，barrel 再导出全落空（footgun 变种，2026-07-27 修）。engine typecheck 用 `paths: @cck/core→core/src` 对最新源码，与 dist 解耦 |
| 4 | 测试 | jest / **vitest** | **vitest** | 已定；`--watch` 秒级反馈支撑"逻辑热重载" |
| 5 | TS 组织 | 各自独立 / **project references** | **project references** | 增量编译、跨包类型跳转、强制依赖方向 |
| 6 | core 禁 cc 强制 | 口头约定 / **eslint no-restricted-imports** / dependency-cruiser | **eslint no-restricted-imports**（首版） | 零新依赖、CI 可跑；不够再上 dependency-cruiser |
| 7 | engine 被 Cocos 消费 | **npm 包（cc/@cck/core external）** / assets 源码 bundle | **npm 包（同 core）** | ~~engine import 'cc' 无法走 node_modules~~ **实证纠正（2026-07-27，见 ADR-0004）**：node_modules 包 dist 里残留的 `import 'cc'` Cocos 3.8.7 QuickPack 能解析（tsup `external:['cc','@cck/core']` 保留 bare import）；与 core 统一路子。assets 映射降为兜底 |

## 关键集成方案：Cocos 3.8 如何消费 core / engine（最大风险点）

**engine（依赖 cc）——同 core 走 workspace npm 包（✅ 2026-07-27 真 cc 3.8.7 验证，见 ADR-0004）**：demo 依赖 `@cck/engine: workspace:*`，`node-linker=hoisted` 落在 `apps/demo/node_modules/@cck/engine`（symlink→`packages/engine`）。engine 用 tsup 出 ESM 自包含单包，`external: ['cc', '@cck/core']`——dist 里保留 bare `import from 'cc'` / `'@cck/core'`，交给 Cocos QuickPack 运行期解析（cc→真引擎，`@cck/core`→node_modules 里被 demo/engine 共享的同一实例）。**实证：node_modules 包 dist 内残留的 `cc` import，3.8.7 能解析**，故 engine 不必映射进 assets。兜底：若某 Cocos 版本认不了 node_modules 里的 `cc`，再退**assets 源码 bundle 映射**（symlink / 多资源目录把 `packages/engine/src` 映射进 `apps/demo/assets/engine`，工程内编译拿 cc）。

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
4. ~~engine↔assets 用 symlink 还是 Cocos「多资源目录」配置~~ **已定（2026-07-27）：engine 改走 workspace npm 包直连（同 core），不映射进 assets，见 ADR-0004。assets 映射仅作 `cc` 认不了时的兜底。**

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
- **engine 消费（决策 #7）→ 见下节**：原计划 assets 源码 bundle；实证后改走 workspace npm 包（同 core），记录见下节。

### 2026-07-27 · engine 薄壳在真 cc 3.8.7 验证（决策 #7 纠正为 npm 包，ADR-0004）

- **结果**：`DemoBoot.ts` 同时 bare import `@cck/core` 与 `@cck/engine`；gameView 预览 `project.log` 打出 engine 段全部行——`[ENGINE] createCcLogger → cc.log 打通` / `→ cc.warn 打通`（cc.warn 附栈是编辑器正常行为）、`bootCoreKit ok → modules = [logger, core, director-drive]`、`director 帧驱动 onFrame 已触发 3 帧 → engine driveWithDirector OK`、`✅ engine (cc 薄壳) consumed & running under real cc`。**cc-logger（LogSink→cc.log/warn）、Bootstrap 组合根、cc.director 帧驱动（EVENT_AFTER_UPDATE→driver.tick→ITimer.onFrame 真的在推进）三处适配层全部在真 cc 跑通。**
- **消费机制（决策 #7 纠正）**：engine 与 core **同路子**——workspace npm 包 + node_modules 直连。给 engine 配 tsup（`external: ['cc', '@cck/core']`）出自包含单包 `dist/index.js`，dist 里保留两个 bare specifier。demo 加 `@cck/engine: workspace:*`，`pnpm install` 后 `apps/demo/node_modules/@cck/engine`→symlink→`packages/engine`。**Cocos 3.8.7 QuickPack 能解析 node_modules 包 dist 内残留的 `import from 'cc'`**——这推翻了决策 #7 的旧依据「engine import cc 无法走 node_modules」（同 core 那次误判同源：想当然假设未实证）。`@cck/core` 也 external，故 demo 与 engine 共享 node_modules 里同一份 core（DI 容器 / KIT 单实例得证：DemoBoot 从 `kit.container` 取 TIMER 且 onFrame 生效）。
- **同 core 的两条隐性契约**：① engine `tsconfig.json` 加 `emitDeclarationOnly: true`（`tsc -b` 只出 `.d.ts`，`dist/index.js` 归 tsup，防 footgun）；② 打开 Creator 前须先 `pnpm build`（core→engine 拓扑序，dist 不入库）。
- **cc 类型来源**：engine dts 构建走 `tsconfig.build.json`（继承 `paths: { cc → test/mocks/cc.ts }` 供 tsc 解析 cc 类型）；tsup `external` 优先级高于 tsconfig paths，故 JS 产物仍是 bare `cc`（已 grep 复核：dist 无相对 import、无 mock 泄漏）。engine 公共 API 不暴露 cc 类型，dist/index.d.ts 只引用 `@cck/core` 类型。
- **新增/改动**：`packages/engine/{tsup.config.ts,tsconfig.build.json}`（新增）、`packages/engine/{package.json,tsconfig.json}`（加 main/exports/build 脚本 + emitDeclarationOnly）、`apps/demo/package.json`（加 `@cck/engine` 依赖）、`apps/demo/assets/scripts/DemoBoot.ts`（追加 engine 验证段）。
- **对齐 bearluo/ccc-framework-monorepo**：其 `@ccc/fw`（依赖 cc、rollup `external:['cc']`）同样作 workspace 包被 game-template 从 node_modules 消费（3.8.8）——互为佐证。
- **全绿复验**：`pnpm typecheck` ✅ / `pnpm test` **192 passed（13 文件）** ✅ / `pnpm build`（core+engine tsup 单包，engine dist 保留 bare `cc`/`@cck/core`）✅ / 真 cc 预览 ✅。

### 2026-07-27 · 修 dist footgun 变种：tsc `.d.ts` 迁出到 `dist-types/`（决策 #3 细化）

- **症状**：加 core 新模块（bundle/asset）后 `pnpm typecheck` 报 engine 侧 `@cck/core` **无任何导出**（连老的 `boot`/`LogSink` 都找不到）。
- **根因**：core 的 `dist/` 被 **tsup 与 tsc 共用**——`tsup --clean` 抹掉 dist 后写自包含单包；`tsc -b`（`emitDeclarationOnly`）又往 dist 写**多文件** `.d.ts`（`index.d.ts` barrel + 各子目录 `.d.ts`）。tsup 的 clean 删掉 tsc 的子 `.d.ts`，而 tsc 增量缓存以为「已 emit」故**拒绝重生成** → barrel `export * from './bootstrap'` 等指向**空子文件** → 消费方拿到空导出。`emitDeclarationOnly`（ADR-0003 决策 #2）只挡住 tsc 覆盖 `index.js`，没解决 `.d.ts` 的 clean↔增量冲突。
- **根治**：**tsc 的 `.d.ts` 出到独立目录 `dist-types/`**（core+engine 的 `tsconfig.json` 改 `outDir`/`tsBuildInfoFile`），`dist/` 由 tsup 独占，二者不再互踩。另给 engine `tsconfig.json` 加 `paths: { "@cck/core": ["../core/src/index.ts"] }`——typecheck 直接对 core **源码**（永远最新、完整），使 `pnpm typecheck` 不依赖「先 build core」；`tsconfig.build.json` 覆盖回该 path（构建时 `@cck/core` 走 node_modules/external，避免把 core 源码拉进 engine `rootDir` 触发 TS6059）。`.gitignore` / eslint `ignores` 补 `dist-types/`。
- **全绿复验**：`pnpm build` ✅（core/engine tsup 单包，engine dist 保留 4 处 bare `cc`/`@cck/core`）/ `pnpm typecheck` ✅ / `pnpm test` **232 passed（15 文件）** ✅ / `pnpm lint` ✅。

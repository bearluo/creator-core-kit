---
模块: monorepo-scaffold
所在包: 根
状态: 实现中（骨架 3/4 验收通过；demo 消费 core 待建 demo 验证）  # 草案 → 评审中 → 已定稿 → 已实现
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
| 3 | core 构建 | tsc / **tsup** / 不构建 | **tsup**（出 ESM + d.ts） | core 要可发 npm；tsup 零配置出 ESM+类型；源码仍供 Cocos/vitest |
| 4 | 测试 | jest / **vitest** | **vitest** | 已定；`--watch` 秒级反馈支撑"逻辑热重载" |
| 5 | TS 组织 | 各自独立 / **project references** | **project references** | 增量编译、跨包类型跳转、强制依赖方向 |
| 6 | core 禁 cc 强制 | 口头约定 / **eslint no-restricted-imports** / dependency-cruiser | **eslint no-restricted-imports**（首版） | 零新依赖、CI 可跑；不够再上 dependency-cruiser |
| 7 | engine 被 Cocos 消费 | npm 包 / **assets 下源码 bundle** | **assets 源码 bundle** | engine import 'cc'，只有工程内编译才有 cc，无法走 node_modules |

## 关键集成方案：Cocos 3.8 如何消费 core / engine（最大风险点）

**engine（依赖 cc）**：物理位置在 `packages/engine/src`，通过 **symlink 或 Cocos 多资源目录**映射到 `apps/demo/assets/engine`，由 Cocos 当项目脚本编译（从而拿到 `cc`）。跨项目复用 = 复制/submodule 这个目录。

**core（不依赖 cc）** 有三条路，按优先级验证：
1. **npm 包（首选）**：demo `package.json` 依赖 `@cck/core: workspace:*`，`node-linker=hoisted` 让它落在 `apps/demo/node_modules/@cck/core`，Cocos 按第三方 npm 模块 import。—— 需验证 Cocos 能否解析 workspace 链接包。
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

1. **core 被 Cocos 消费方案**：先按"方案 1 npm 包"试，失败即退方案 3 复制？还是你更倾向一步到位用方案 3（最稳但有构建步骤）？
2. **包名 scope**：`@cck/*` 是否 OK（creator-core-kit 缩写），还是换成 `@creator-core-kit/*` 或公司 scope？
3. **demo 工程谁来建**：我用 MCP/CLI 生成 Cocos 3.8 空工程，还是你在 Creator 里新建后我接管配置？（Cocos 工程结构最好由编辑器生成，避免手写 meta 出错。）
4. engine↔assets 用 symlink 还是 Cocos「多资源目录」配置——留到 spike 时按 Windows 实测定。

---

## 实现记录

- **骨架结构（已落地）**：根 `package.json`(workspace scripts) + `pnpm-workspace.yaml` + `.npmrc`(`node-linker=hoisted`) + `tsconfig.base.json` + 根 `tsconfig.json`(project references→core/engine) + `vitest.config.ts` + `eslint.config.js`(flat config, core 禁 `cc`)；`packages/core`(`@cck/core`, tsup 出 ESM+dts, 示例 `hello` + 单测)；`packages/engine`(`@cck/engine`, private, 依赖 `@cck/core` workspace:*, 占位)。`apps/demo` 待在 Creator 建后接入。
- **与设计偏差**：① ESLint 用 **flat config**（`eslint.config.js`）而非设计里的 `.eslintrc.cjs`（ESLint 9 默认 flat）；② pnpm 11 需在 `pnpm-workspace.yaml` 配 `allowBuilds: { esbuild: true }` 放行 esbuild 构建脚本。
- **验收结果**：① `pnpm install` ✅；② `pnpm test` **vitest 2 passed**（core node 单测、零 cc）✅；③ `pnpm typecheck`(tsc -b) ✅；④ `pnpm build`(tsup 出 `dist/index.js`+`index.d.ts`) ✅；⑤ `pnpm lint` ✅，且往 core 写 `import 'cc'` 被 `no-restricted-imports` **拦下报 error** ✅。**验收 4 条达成 3 条**，剩「demo import `@cck/core` 预览成功」待建 demo 工程验证。
- **遗留**：① demo 工程（在 Creator 建）→ 验证 core 消费方案 1（`node_modules/@cck/core`, hoisted）+ engine↔assets 映射；② pnpm workspace **symlink 场景** Cocos 认不认（骨架用 hoisted 复制，symlink 待 demo 阶段实测）；③ 尚未 commit（拟与 spike 实证文档一起提交）。

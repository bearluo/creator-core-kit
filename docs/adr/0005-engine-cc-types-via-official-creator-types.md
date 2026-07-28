---
状态: 已接受
日期: 2026-07-28
依赖: docs/adr/0002-engine-test-strategy-capped-cc-mock.md, docs/adr/0004-cocos-consumes-engine-via-npm-package-with-cc-external.md
---

# ADR-0005：engine 的 cc 类型源改用官方 `@cocos/creator-types`，cc mock 降为纯运行时行为替身

## 背景

补 engine 适配层撞上**第一个「重 cc 模块」**——AssetManager 的 engine 半（`IAssetSource` 的 cc 实现），要 `import { assetManager, resources, Prefab, ... } from 'cc'`。这正是 ADR-0002 决策 6 预留「撞上时再定」的时刻。

此前 engine 只写过 cc-logger / bootstrap，用的全是 cc mock 允许的**安全三类符号**（`log/warn`、`director/game` 常量与事件），所以「cc mock 同时兼任 typecheck 类型源 + 运行时行为替身」（ADR-0002 决策 4）一直够用。但 AssetManager 引的 `assetManager`/`Prefab`/`bundle.load` 是**真实引擎行为 API**——ADR-0002 决策 3 明令**禁止**它们进 mock。于是矛盾显现：

- 若为 typecheck 把这些 API 加进 mock → 违背决策 3、且要手抄大量 cc 类型、mock creep。
- 若不加 → engine `tsc -b` 因 mock 缺这些导出而**类型报错**，重 cc 模块无从 typecheck。

关键认知：**「typecheck 要全量真类型」与「运行时不 mock 引擎行为」并不冲突——把 cc mock 的两个身份拆开即可。** 官方发布了 `@cocos/creator-types`（编辑器外 TS 工程的 cc 类型包，含 3.8.7），正好作权威类型源。

## 决策

1. **engine 的 cc 类型源 = 官方 `@cocos/creator-types@3.8.7`**（engine devDependency）。两个 typecheck 配置 `packages/engine/tsconfig.json` 与 `tsconfig.build.json` 均：
   - 加 `"types": ["@cocos/creator-types/engine"]`（ambient `declare module 'cc'`，全量真类型）；
   - **移除** `paths: { "cc": ["./test/mocks/cc.ts"] }`——cc 不再解析到 mock。
2. **cc mock（`packages/engine/test/mocks/cc.ts`）降级为纯运行时行为替身**：只被根 `vitest.config.ts` 的 `resolve.alias` 引用（运行时），不再兼任类型源。其**防 creep 三类符号硬规矩（ADR-0002 决策 3）不变**——运行时仍只提供可安全 mock 的行为。手写的「逐字对齐 cc.d.ts」类型注释不再是类型权威，可后续精简（非必须）。
3. **重 cc 模块（AssetManager / 后续 UI / Audio…）的验证方式定型**（落实 ADR-0002 决策 6）：
   - **typecheck**：用 `@cocos/creator-types` 全量真类型校验 cc API 用对（签名、重载、构造函数类型）；
   - **运行时行为不 mock**：不写依赖真实加载/渲染/播放的 vitest（mock 里也没有这些行为）；端到端验证走 **apps/demo 真机（Creator 预览）**——符合 ADR-0002 决策 3/6，且**不扩张 cc mock**。
   - core 半的账（引用计数/去重/group…）仍在 core、用内存 fake 全单测覆盖，不受影响。
4. **修正前两条 ADR 的相关细则**（本 ADR 追加更新，不改原文）：
   - ADR-0002 决策 4「cc mock 单一真源、tsconfig paths 与 vitest alias 双指同一文件（类型与运行时一致）」→ **类型走 `@cocos/creator-types`、运行时走 mock，二者分离**（各司其职）。
   - ADR-0004 决策 3「engine dts 构建走 `tsconfig.build.json` 继承 `paths: { cc → mock }` 供 tsc 解析 cc 类型」→ **dts/typecheck 的 cc 类型改由 `@cocos/creator-types` 提供**；`external: ['cc']` 与「JS 产物仍是 bare `cc`」不变。

## 理由

- **官方权威、零手写漂移**：类型直接来自 Cocos 发布物，补齐 mock 缺的全部真实引擎 API；不再靠人肉抄 `cc.d.ts` 对齐（ADR-0002 负债项之一被消除）。
- **mock 更瘦**：不再承担类型职责，面进一步收窄，防 creep 更稳。
- **实证三绿**：切换后 `pnpm typecheck`（tsc -b）、`pnpm build`（tsup core+engine dist）、`pnpm test`（326 测试）全绿；`asset-source.ts` 的 cc 调用（`bundle.load` 重载 / `getDirWithPath` / `assetManager.loadRemote` / `getBundle` / `bundle.release` / token→构造函数映射）被官方类型**一次校验通过**，无签名返工。

## 后果

- **正面**：重 cc 模块可 typecheck + IDE 智能提示 + 类型零漂移；typecheck 与运行时职责清晰分离；mock 面更小。
- **代价 / 约束**：
  - engine 多一个 devDep `@cocos/creator-types`，**与 Creator 版本对齐 pin `3.8.7`**（升 Creator 时同步）。
  - 类型源（creator-types）与运行时替身（mock）分处两地——但各自单一职责，比原来「一个文件两副担子」更清晰。
  - 真实引擎行为模块仍**无 node 单测**（同 ADR-0002），验证靠 apps/demo 真机——可接受（其逻辑已在 core 半用 fake 接缝测过）。
- **落地**：`packages/engine/package.json`（devDep）、`packages/engine/tsconfig.json` 与 `tsconfig.build.json`（`types` + 去 `paths.cc`）、`vitest.config.ts`（alias 不变）、首个应用者 `packages/engine/src/asset-source.ts`。

---
状态: 已接受
日期: 2026-07-27
依赖: docs/adr/0003-cocos-consumes-core-via-npm-workspace-package.md, docs/design/modules/monorepo-scaffold.md
---

# ADR-0004：engine 也走 workspace npm 包消费（`cc` external），纠正决策 #7

## 背景

`packages/engine`（cc 适配层：cc 薄壳 + Core 接口的 cc 实现）要被 `apps/demo`（真实 Cocos Creator 3.8 工程）消费。

骨架决策表 #7 与 ADR-0003 的收尾都断言：**「engine `import 'cc'`，只有工程内编译才有 cc，无法走 node_modules，故必须把 `packages/engine/src` 映射进 `apps/demo/assets/engine` 当项目脚本编译」**。这条断言**从未实证**——它与 ADR-0003 里被纠正的那次 core 误判（想当然假设 Cocos 消费不了 workspace 包）同源：都是没跑就下的结论。

反证信号：姊妹项目 bearluo/ccc-framework-monorepo 的框架包 `@ccc/fw` **本身依赖 cc**（rollup `external: ['cc']`），却是作为 **workspace npm 包**被其 game-template 从 node_modules 消费的（Creator 3.8.8）。这意味着 node_modules 包 dist 里残留的 `import from 'cc'`，Cocos packer 是能解析的。

## 决策

1. **engine → Cocos 的正式消费机制 = workspace npm 包 + node_modules 直连，与 core（ADR-0003）同一条路子。** 决策 #7 从「assets 源码 bundle」**改为「npm 包」**。
   - engine 用 **tsup** 出 ESM 自包含单包 `dist/index.js`，`external: ['cc', '@cck/core']`——dist 里**保留** bare `import from 'cc'` 与 `import from '@cck/core'`，不打进包体。
   - demo `package.json` 依赖 `@cck/engine: workspace:*`；`pnpm install` 后 `apps/demo/node_modules/@cck/engine` 为指向 `packages/engine` 的 symlink（`node-linker=hoisted`）。
   - Cocos QuickPack 按 engine `package.json` 的 `main`→`dist/index.js` 解析 bare specifier `@cck/engine`，并进一步解析 dist 内残留的 `cc`（→真引擎）与 `@cck/core`（→node_modules 里被 demo 与 engine 共享的**同一实例**）。
   - **不把 engine 源码映射进 `assets`**（原方案降为兜底）。
2. **两条隐性契约同 core**：
   - engine `tsconfig.json` 设 `emitDeclarationOnly: true`——`tsc -b`(typecheck) 只出 `.d.ts`，`dist/index.js` 归 tsup 独占（防 ADR-0003 决策 #2 的 dist footgun）。
   - **打开 / 预览 Creator 前须先 `pnpm build`**（拓扑序 core→engine，`dist/` 不入库）。
3. **`cc` 类型来源与 external 优先级**：engine dts 构建走 `tsconfig.build.json`（继承 `paths: { cc → test/mocks/cc.ts }`，供 tsc 解析 cc 类型出 `.d.ts`）；tsup / esbuild 的 `external` 优先级**高于** tsconfig `paths`，故 JS 产物仍是 bare `cc`（不会误打进 mock）。engine 公共 API 不暴露任何 cc 类型，`dist/index.d.ts` 只引用 `@cck/core` 类型。
4. **兜底（暂不启用）**：若某 Cocos 版本的 packer 认不了 node_modules 包 dist 里的 `cc`，则退回**assets 源码 bundle 映射**——把 `packages/engine/src` 经 symlink / Cocos 多资源目录映射进 `apps/demo/assets/engine`，由工程内编译拿 `cc`（须排除 `__tests__` 与 `test/mocks`）。当前 3.8.7 无需。

## 理由

- **实证成立（真 cc，非纸面）**：`apps/demo`（Creator **3.8.7** + funplay MCP）里 `DemoBoot.ts` 同时 bare import `@cck/core` 与 `@cck/engine`。gameView 预览 `project.log` 打出 engine 段全部行：
  - `[ENGINE] createCcLogger → cc.log 打通` / `→ cc.warn 打通`（cc.warn 附调用栈是编辑器正常行为，非报错）——**cc-logger 的 `LogSink` 确实打到真 `cc.log` / `cc.warn`**；
  - `bootCoreKit ok → modules = [logger, core, director-drive]`——**Bootstrap 组合根在真 cc 启动**，三模块拓扑序正确；
  - `director 帧驱动 onFrame 已触发 3 帧 → engine driveWithDirector OK`——**`cc.director` 的 `EVENT_AFTER_UPDATE` → `driver.tick(dt)` → `ITimer.onFrame` 帧驱动链路真的在推进**；
  - `✅ engine (cc 薄壳) consumed & running under real cc`。
- **关键发现**：Cocos 3.8.7 QuickPack **能解析 node_modules 包 dist 内残留的 `import from 'cc'`**——决策 #7 旧依据「engine import cc 无法走 node_modules」被推翻。
- **单实例得证**：`@cck/core` 作 external 被 demo 与 engine 共享；`DemoBoot` 从 `bootCoreKit()` 返回的 `kit.container` 取 `TIMER` 并挂 `onFrame` 生效，说明 DI 容器 / `KIT` 是同一份（无 core 双实例），符合 ADR-0001 全局注册表设定。
- **收益**：engine 与 core **统一为一条消费机制**（少一套 assets 映射 / symlink / 多资源目录配置、无源码被编两次、engine 结构上可发 npm），维护面最小。
- **对齐姊妹项目**：与 bearluo/ccc-framework-monorepo 的 `@ccc/fw`（cc 依赖、workspace 包消费）一致，互为佐证。

## 后果

- **正面**：core / engine 消费同构，心智负担与配置面减半；`DemoBoot` 一处即可验证两层。
- **代价 / 约束**（同 ADR-0003）：
  - 打开 Creator 前**必须先 `pnpm build`**（`dist/` 不入库；拓扑序 core→engine）。
  - engine `tsc -b` 的 `emitDeclarationOnly` 是隐性契约，改 tsconfig 勿回退。
  - 依赖变更后**务必 `pnpm install`**，且**新增 node_modules 包后需重启 Creator**（QuickPack 启动时索引 node_modules，热添包不认——本次验证即因此重启一次）。
- **对 ADR-0003 的关系**：本 ADR **纠正并取代** ADR-0003 收尾「engine 不适用本 ADR、仍走 assets 源码 bundle」那一条；ADR-0003 关于 **core** 的决策不变。

## 备选（未采纳）

- **assets 源码 bundle 映射**：engine 源码经 symlink / 多资源目录进 `apps/demo/assets/engine`，工程内编译拿 cc。缺点：源码被编两次、需排除测试文件、跨项目复用靠复制/submodule、engine 不再天然可发 npm。仅作 `cc` 在 node_modules 里认不了时的兜底。

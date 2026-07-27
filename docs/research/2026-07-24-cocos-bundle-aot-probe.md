---
状态: 进行中（实验规格，结论待填）
摘要: 实测 Cocos 3.8 出包/AOT/bundle 真实行为，为 core 消费、全局注册表、热更策略定实证依据。
何时读: 定 core 怎么进 Cocos、设计跨 bundle 单例或热更策略、质疑相关结论时。
日期: 2026-07-24
依赖: docs/design/modules/monorepo-scaffold.md
---

# Cocos 3.8 Bundle / AOT 打包行为摸底

## 目的

Cocos 打包行为文档讲不清、版本有差异，纸面推演不可靠。起一个真实项目 `spike/bundle-probe`（不上传）实测，把 **core 消费方案、跨 bundle 单例、热更缺代码** 三件事落到实证，再回头定架构。

## 已知前提（来自领域经验，待实测确认）

- Cocos 有两种出包模式：**单 bundle 打包**（把该 bundle 自身引入的资源/代码全打进自身）、**普通出包**（共享代码按 bundle 优先级归属，不无脑复制）。
- **npm 代码打在 AOT / 主包共享层**，全局一份，不随业务 bundle 复制。
- **AOT 构建会 tree-shake 裁剪**；运行时加载**非同版本构建**的 bundle，可能引用到已被裁掉的 AOT 代码 → **AOT 代码缺失**。
- 官方：不同 bundle 脚本不应互相引用；共享需暴露到全局命名空间。

## 待验证问题

| # | 问题 | 怎么看 |
|---|---|---|
| Q1 | npm 包代码构建后落在哪（AOT/主包共享层 vs 各 bundle 内） | 看构建产物目录 / chunk |
| Q2 | 跨 bundle 单例是否唯一（A 写、B 读到同一实例？） | 运行时打印 |
| Q3 | 普通模式 vs 单 bundle 模式下 Q1/Q2 的差异 | 两种模式各构建对照 |
| Q4 | AOT 裁剪 + 跨版本 bundle → 是否 AOT 代码缺失 | 模拟热更：主包裁剪 → 后出新 bundle 引用被裁 API → 只替换 bundle → 跑 |

## 实验设计

- **探针 npm 包**（`@cck/core` 雏形或临时包）：
  - `Probe`：`static value` + 单例 `Probe.inst`（测 Q2）。
  - `rareApi()`：一个**仅被 bundle 引用、主包不直接引用**的导出（测 Q4 是否被 AOT 裁掉）。
- `assets/bundleA`：脚本 `Probe.inst.value = 1`，调 `rareApi()`。
- `assets/bundleB`：脚本读 `Probe.inst.value` 并打印。
- **主场景**：先加载 bundleA、再加载 bundleB，打印 B 读到的值。
- **出包**：普通模式、单 bundle 模式各构建一次对照；Q4 另做「先出主包 → 后单独出 bundle → 只替换 bundle」模拟热更。

## 环境

- `spike/bundle-probe`（Cocos Creator 3.8，已加入 `.gitignore`、不上传）。
- 结论回填本文档「结论」与「对设计的影响」两节。

## 实测记录（逐步累积）

探针包 `cck-probe`（ESM，`type:module`）已装进 `spike/bundle-probe/node_modules`（`--install-links` 真实复制目录，非 symlink）；`WriterA/ReaderB` 从 `cck-probe` import。`Probe.defId = Math.floor(random*1e6)`，每份「类定义副本」求值一次 → 跨 bundle 相同=单份共享，不同=各打一份分裂。

| # | 场景 | 平台 | Cocos 认 npm 包 | A.defId | B.defId | B 读到 | 判读 |
|---|------|------|----------------|---------|---------|--------|------|
| 1 | 编辑器预览（未构建分包） | 浏览器预览 | ✅ | 949059 | 949059 | 1 | 预览态所有脚本同一 JS 环境、共享一张 import map → **必然共享**；仅证明「链路通 + Cocos 能消费 ESM npm 包」，不能证明分包行为 |
| 2 | **普通模式**构建（正常出包） | web-mobile | ✅ | 970026 | 970026 | **1** | **单例唯一**：npm 代码提升到 AOT 共享 chunk 单份，A/B 引用同一模块 → 静态状态共享 |
| 3 | **单 bundle 模式**构建 | web-mobile | ✅ | 231654 | 799530 | **0** | **静态状态分裂**：npm 代码各自内联进 bundleA/B，两份独立 Probe，A 写 A 的、B 读 B 的（初始 0） |
| 4 | Q4：v1 旧主包 + v2 新 bundleB | web-mobile(混合) | ✅ | 515867 | 515867 | 1 | **调 `orphanApi()` 崩** `TypeError: u is not a function`＠`ReaderB.onLoad`：v1 AOT 裁掉 orphanApi、v2 bundleB 引用式拿到 undefined。同 bundle 里 Probe（v1 有）正常共享、orphanApi（v1 无）崩 → **缺代码按符号粒度、运行到调用点才炸**（加载/实例化都成功） |

**产物机制（web-mobile 实测，`Bash rg --no-ignore` 扒 `build/`）：**

- **普通模式**：跨 bundle 共享的 npm 代码被**提升到 AOT 共享 chunk** `src/chunks/bundle.js`，注册为全局 SystemJS 模块 `chunks:///_virtual/index.js`（cck-probe 的 index.js 桶），**单份**。`bundleA/index.js`、`bundleB/index.js` 里**无 Probe 定义**（无 `Math.random`），脚本 `WriterA.ts/ReaderB.ts` 的依赖 `["…","cc","./index.js"]` 解析到全局那份 → A、B 拿**同一个** Probe → defId 一致、状态共享。
- **单 bundle 模式**：`Math.random`（Probe 真身）计数 `bundleA/index.js:1`、`bundleB/index.js:1` —— 每个 bundle **各内联一份**，互不相干 → 分裂。
- 干扰项：`assets/shared/Probe.ts`（早期孤儿脚本）仍被编译进主包 `main/index.js`（注册为 `chunks:///_virtual/Probe.ts`，与 npm 的 `index.js` 是**两个不同模块**），不参与 A/B 共享链路但污染产物分析，**应在编辑器删除**。

> Q1（代码落点）不看运行时 defId，而是构建后用 `Bash rg --no-ignore` 直接 grep `build/` 产物里 `Probe`/`rareApi`/`defId` 出现在哪些 `index.js`（主包/AOT 层 vs 各 bundle 目录）。spike 被 `.gitignore` 挡住，内建 Glob/Grep 扫不到，须 `--no-ignore`。

## 结论

- **Q1（npm 代码落点）**：**普通模式** → 提升到 AOT 共享 chunk `src/chunks/bundle.js` 单份（全局 SystemJS 模块 `chunks:///_virtual/index.js`），业务 bundle 引用式不内联；**单 bundle 模式** → 复制进每个引用它的 bundle 的 `index.js`，各一份。
- **Q2（跨 bundle 单例）**：**普通模式唯一**（defId 970026 一致、B 读到 1）；**单 bundle 模式分裂**（defId 231654≠799530、B 读到 0）。
- **Q3（两模式差异）**：根因 = 单 bundle 模式为「自包含、可独立加载/热更」把依赖全内联，跨 bundle 共享的静态状态必然分裂；普通模式共享代码归 AOT 层单份。**⇒ 静态单例的跨 bundle 唯一性由构建模式决定，不可写进地基假设。**
- **Q4（AOT 裁剪 + 跨版本 → 缺代码）**：**成立且危险**。①无人引用的 `orphanApi` 被 v1 AOT tree-shake 裁光（build 产物零字节）；②把引用它的 v2 bundleB 挪到 v1 旧主包上跑 → `orphanApi()` 处 `TypeError: u is not a function`＠onLoad 崩溃。**缺代码是符号粒度**（同 bundle 里 Probe 正常、orphanApi 崩）、**运行到调用点才炸**（加载/实例化都成功），比整包失败更隐蔽。

## 对设计的影响

- **core 消费方案（npm / 复制 / 源码映射）**：npm 包被 engine/业务 bundle 引用**技术可行**（Cocos 认 ESM npm 包，普通模式落 AOT 层单份）。但 core 的**静态单例是否跨 bundle 唯一取决于构建模式** —— 普通模式天然单份、单 bundle 模式必然分裂，因此**不能把「core 单例天然唯一」当地基**。
- **全局注册表是否必需**：**必需，从「建议」升级为「铁律」**。理由：(a) 单 bundle 模式必然分裂；(b) 远程 bundle / 子游戏独立打包绕过 AOT 共享；(c) 热更跨版本可能 AOT 缺代码（Q4 待验）。⇒ DI 容器 / 服务单例**必须走 `globalThis` 注册表 + `Symbol.for()`/字符串 token + 接口交互**，禁止依赖 class identity 或 import 的 static 单例做跨 bundle 唯一性。→ 回写架构总纲 §DI + 立 ADR。
- **热更「防 AOT 缺代码」策略**：Q4 已证实危险且隐蔽。对策（按平台取舍）：①core 对外公共 API 建**强引用白名单** —— 在主包某处显式引用全部公开 API（如 `export const KEEP = [Probe, orphanApi, …]` 或副作用注册），阻止 tree-shake，让主包 AOT 恒含全量 core 表面；②热更包与主包**版本绑定校验** —— core API 版本号/hash 不匹配就拒绝加载该 bundle，宁可提示更新也不让它跑到一半崩；③或让热更粒度**含主包/AOT**（整包热更，而非只换业务 bundle）。→ 立 ADR。

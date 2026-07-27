---
状态: 已接受
日期: 2026-07-27
依赖: docs/research/2026-07-27-engine-bootstrap-and-cc-mock-survey.md
---

# ADR-0002：engine 层测试策略 —— 纯 JS 单测 + 封顶 cc mock，禁止 mock 引擎行为

## 背景

engine 层适配 `cc`。给 engine 写单测面临「怎么在没有 Creator 的 node 里替换 `cc`」的问题。历史经验（作者在 Godot 姊妹框架及本框架前期尝试）：**hand-mock 引擎会 creep —— 随着用到的引擎 API 变多，mock 越滚越大，最终「把整个 cc 搬过来」**，不可维护。可选路线：

- **A. 纯 JS + hand-mock cc**（node，快、可移植）——痛点是 mock creep。
- **B. 真起浏览器 / 真引擎跑测**（vitest browser mode + 取 web 构建 `cc.js` + 复刻 `import 'cc'` 解析）——高保真、无 creep，但：官方不发 `npm i cc`；web 构建不带 `.d.ts`（**tsc 类型问题照样存在**）；Cocos 无 Godot 式一等 `--headless`，需重型且版本耦合的 spike；而 engine 是薄壳，真引擎给不了额外单测价值。

关键认知：**creep 不是靠「换成真引擎」解决，而是靠「划一条线、不去 mock 该 mock 的东西」解决。** engine 按铁律是薄壳——逻辑全在 core（纯 JS 已测），engine 只「路由 Core 数据给 cc / 转发 cc 事件进 Core」，真正值得快单测的 cc 面很小且稳定。

## 决策

1. **core 永远纯 JS 单测、零 cc**（主体）。
2. **engine 单测走纯 JS（vitest node）+ 一个封顶小 cc mock**，不真起浏览器。
3. **防 creep 硬规矩** —— cc mock **只准**含三类符号：
   - 常量（如 `Director.EVENT_AFTER_UPDATE`）；
   - 无副作用的纯函数（如 `log/warn/error/debug`）；
   - 事件 `on/off/emit`。
   任何**需要真实引擎行为**的 cc API（渲染 `Node/Widget/Layout`、`assetManager` 加载、`AudioSource` 播放、布局计算……）**禁止进 mock**；对应 engine 模块的验证改走 **apps/demo 集成测（真 cc 编译 + 预览）**，不靠 mock。
4. **cc mock 单一真源**：一个带类型的 `packages/engine/test/mocks/cc.ts`；engine `tsconfig.json` `paths` 与根 `vitest.config` `resolve.alias` **双指同一文件**（类型与运行时一致）。签名逐字对齐 Creator 真 `cc.d.ts` 并标注来源行以降漂移。
5. **一致性权威把关下沉到集成层**：真 cc 类型 + 真运行时的最终校验由 **apps/demo**（Creator 编译 engine 源码 + 预览跑真引擎循环）承担——这是测试金字塔顶的少量集成检查，不是单测层的活。
6. **重 cc 模块（第 2 批 Asset/UI/Audio…）的测试方式**在撞上第一个此类模块时，按具体需求再定（apps/demo 集成 vs 值得单立「真引擎 headless/browser」spike），**不现在空推**；但无论如何**不得靠扩张 cc mock 解决**。

## 后果

- 正面：engine 单测快、确定性、可移植、与 core 同一套 vitest；mock 面被制度性封顶，杜绝「搬整个 cc」；类型与运行时单一真源。
- 负面/风险：engine 薄壳的单测是对着 mock（非真 cc），存在类型/行为漂移可能 —— 由「签名逐字抄真声明 + 面最小 + apps/demo 权威把关」三道兜底；重 cc 模块无法在 node 单测覆盖，须靠集成测（可接受：其逻辑已在 core 用 fake 接口测过）。
- 落地：见 `packages/engine/test/mocks/cc.ts`（含防 creep 头注释）、`packages/engine/tsconfig.json`（paths）、`vitest.config.ts`（alias）。

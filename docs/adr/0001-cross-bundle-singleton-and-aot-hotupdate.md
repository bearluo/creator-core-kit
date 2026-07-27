---
状态: 已接受
日期: 2026-07-24
依赖: docs/research/2026-07-24-cocos-bundle-aot-probe.md
---

# ADR-0001：跨 bundle 单例走全局注册表 + 热更防 AOT 缺代码

## 背景

Cocos 3.8 Asset Bundle 独立打包。`spike/bundle-probe` 实测（web-mobile，探针 npm 包 `cck-probe`，见 research 文档 Q1–Q4 实测记录）确认：

- **普通出包**：跨 bundle 共享的 npm/公共代码提升到 AOT 共享 chunk（`src/chunks/bundle.js`，注册为全局 SystemJS 模块 `chunks:///_virtual/index.js`）**单份**，业务 bundle 引用式共享 → 静态单例唯一（defId 970026 一致、A 写 B 读到 1）。
- **单 bundle 出包**：**无共享层**，依赖全内联进各 bundle → 同一个类被复制成多份，静态状态分裂（defId 231654≠799530、A 写 B 读到 0）。
- **AOT tree-shake**：构建时无任何入口引用的 core 导出（`orphanApi`）被彻底裁掉，产物零字节；被引用的（`rareApi`）才留在 AOT 共享层。
- **跨版本热更**：把「引用了某 API 的新 bundleB」挪到「该 API 已被裁的旧主包」上 → 运行到调用点 `TypeError: u is not a function`＠onLoad。**符号粒度**缺代码（同 bundle 里 Probe 正常、orphanApi 崩）、加载/实例化都不报错、跑到那行才崩，隐蔽。

核心结论：**静态单例的跨 bundle 唯一性由构建模式决定，不能当地基假设。**

## 决策

1. **全局单例 / DI 一律走 `globalThis` 注册表 + `Symbol.for()`（或稳定字符串）token + 接口交互。** 禁止依赖 `import` 的 static 单例、class identity、`instanceof` 做跨 bundle 唯一性判断。core 定义接口与 token，运行时从全局容器解析实现（`IAssetLoader / IAudioService / ITimer / INetwork / IStorage / ILogger / IPlatform` 等）。
2. **热更防 AOT 缺代码**（按平台取舍，至少其一）：
   - core 对外公共 API 建**强引用白名单** —— 主包某处显式引用全部公开符号（如常量数组或副作用注册），阻止 tree-shake，让主包 AOT 恒含全量 core 表面；
   - 热更包与主包**版本绑定校验** —— core API 版本号/hash 不匹配则拒绝加载该 bundle，宁可提示更新也不让它跑到一半崩；
   - 或热更粒度**含主包/AOT**（整包热更，而非只换业务 bundle）。

## 后果

- 正面：跨「普通 / 单 bundle / 远程 bundle / 子游戏独立打包 / 热更」各场景，公共服务与单例行为一致；热更不会跑到一半因缺代码崩。
- 负面：引入 DI 样板（token 定义、注册、解析）；需维护公共 API 强引用白名单与版本校验机制。

## 依据

`docs/research/2026-07-24-cocos-bundle-aot-probe.md` 实测数据点 1–4（含 web-mobile 产物 grep 证据与运行时 console）。

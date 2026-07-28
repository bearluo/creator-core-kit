# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase. **本仓采单上下文布局**（root `CONTEXT.md` + `docs/adr/`）。

## Before exploring, read these

- **`CONTEXT.md`** at the repo root（尚未创建——由 `/domain-modeling` 在术语/决策真正被敲定时懒创建，不必预先建）。
- **`docs/adr/`** — read ADRs that touch the area you're about to work in（本仓已有 `docs/adr/0001`–`0004`：跨 bundle 单例/AOT 热更、engine 测试策略、Cocos 消费 core/engine 机制）。
- 本仓另有渐进式披露文档体系（见根 `CLAUDE.md`「文档维护约定」）：入口 `docs/README.md`（文档地图）→ `docs/design/`（跨模块设计）→ `packages/<pkg>/docs/modules/<module>.md`（单模块设计随包）→ `docs/research/`（调研横评）→ `docs/progress.md`（模块状态看板）。探索前扫这些文档头部（统一 `状态/摘要/何时读/依赖`）判断相关性。

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## File structure（单上下文）

```
/
├── CONTEXT.md                              ← 懒创建（术语表 / ubiquitous language）
├── docs/
│   ├── README.md                           ← 文档地图（渐进式披露入口）
│   ├── adr/                                ← 重大 / 不可逆决策（0001…）
│   ├── design/                             ← 跨模块设计
│   ├── research/                           ← 调研横评（带日期，快照）
│   └── progress.md                         ← 模块状态看板
├── packages/<pkg>/docs/modules/<module>.md ← 单模块设计随包（core 发 npm 自带文档）
└── src/ (packages/*/src)
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids. 本仓已有稳定术语（core/engine 分层、DI token、接缝 seam、account-in-core/IO-in-engine、铁律「零 cc」等）——沿用，勿造同义词。

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0001 (跨 bundle 单例走全局注册表) — but worth reopening because…_

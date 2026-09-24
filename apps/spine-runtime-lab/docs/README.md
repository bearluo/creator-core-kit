# spine-runtime-lab 文档地图

状态：已实现
摘要：本工程文档入口，按「当前设计 → 阶段记录 → 调研」逐层深入。
何时读：第一次接触 Spine VAT 或要找某篇文档时。
依赖：工程 [README](../README.md)（目录、烘焙与测试怎么跑）

## 当前设计（现状）

- [design/spine-vat-overview.md](design/spine-vat-overview.md)：固定槽位 + GPU 剪裁 + 帧间插值的数据格式、烘焙规则、两个组件、真机结果。**先读这篇。**
- 组件安装与 API：[extensions/spine-vat-importer/README.md](../extensions/spine-vat-importer/README.md)

## 阶段记录（已实施、封存）

| 文档 | 内容 |
|---|---|
| [2026-09-23-spine-vat-tool-proposal](design/2026-09-23-spine-vat-tool-proposal.md) | 通用 Spine 转 VAT 工具的最初设计 |
| [2026-09-23-spine-vat-analyzer-m1](design/2026-09-23-spine-vat-analyzer-m1.md) | M1 Analyzer |
| [2026-09-23-spine-vat-compiler-m2](design/2026-09-23-spine-vat-compiler-m2.md) | M2 Compiler / Renderer（三角形汤时期） |
| [2026-09-23-spine-vat-player-m3](design/2026-09-23-spine-vat-player-m3.md) | M3 每实例播放与 GPU Instancing |

## 调研（快照）

| 文档 | 内容 |
|---|---|
| [2026-09-21-spine-runtime-vat-summary](research/2026-09-21-spine-runtime-vat-summary.md) | 官方 Runtime 与 VAT 验证汇总 |
| [2026-09-21-spine-runtime-findings](research/2026-09-21-spine-runtime-findings.md) | 官方 Runtime 结论 |
| [2026-09-21-spine-runtime-memory-flow](research/2026-09-21-spine-runtime-memory-flow.md) | 官方 Spine 源码级内存流程 |
| [2026-09-21-spine-vat-decision](research/2026-09-21-spine-vat-decision.md) | 水果机大厅 VAT 上线决策 |

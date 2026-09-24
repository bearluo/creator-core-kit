# spine-runtime-lab 文档地图

状态：已实现
摘要：本工程文档入口，按「总览 → 各环节设计 → 调研」逐层深入。
何时读：第一次接触 Spine VAT 或要找某篇文档时。
依赖：工程 [README](../README.md)（目录、烘焙与测试怎么跑）

## 总览

- [design/spine-vat-overview.md](design/spine-vat-overview.md)：固定槽位 + GPU 剪裁 + 帧间插值的数据格式、烘焙规则、两个组件、真机结果。**先读这篇。**
- 组件安装与 API：[extensions/spine-vat-importer/README.md](../extensions/spine-vat-importer/README.md)

## 各环节设计

| 文档 | 内容 |
|---|---|
| [spine-vat-tool-design](design/spine-vat-tool-design.md) | 工具整体分层：官方 Runtime 求值 + 自研编译打包与播放 |
| [spine-vat-analyzer](design/spine-vat-analyzer.md) | Analyzer：静态分析与逐帧 dry-run |
| [spine-vat-compiler](design/spine-vat-compiler.md) | Compiler：采样、编译、分页与 manifest |
| [spine-vat-player](design/spine-vat-player.md) | Player：每实例播放与 GPU Instancing |

## 调研（快照）

| 文档 | 内容 |
|---|---|
| [2026-09-21-spine-runtime-vat-summary](research/2026-09-21-spine-runtime-vat-summary.md) | 官方 Runtime 与 VAT 验证汇总 |
| [2026-09-21-spine-runtime-findings](research/2026-09-21-spine-runtime-findings.md) | 官方 Runtime 结论 |
| [2026-09-21-spine-runtime-memory-flow](research/2026-09-21-spine-runtime-memory-flow.md) | 官方 Spine 源码级内存流程 |
| [2026-09-21-spine-vat-decision](research/2026-09-21-spine-vat-decision.md) | 水果机大厅 VAT 上线决策 |

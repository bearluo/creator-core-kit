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
| [spine-vat-tool-design](design/spine-vat-tool-design.md) | 总体分层、官方能力调查、功能覆盖矩阵、未实现项 |
| [spine-vat-analyzer](design/spine-vat-analyzer.md) | 静态分析、逐帧 dry-run、兼容等级与估算 |
| [spine-vat-compiler](design/spine-vat-compiler.md) | 双骨骼采样、固定槽位、纹理布局、分页与 manifest |
| [spine-vat-player](design/spine-vat-player.md) | 播放状态机、3D / 2D 两个组件、合批与资源共享、事件与 socket |

## 改造提案

| 文档 | 内容 |
|---|---|
| [2026-09-24-spine-vat-bake-v2-proposal](design/2026-09-24-spine-vat-bake-v2-proposal.md) | 已实施：烘焙搬进扩展，编辑器里右键烘焙 |
| [2026-09-24-spine-vat-bake-panel-proposal](design/2026-09-24-spine-vat-bake-panel-proposal.md) | 已实施：烘焙参数面板（socket / 动画 / 帧率可选） |

## 调研（快照）

| 文档 | 内容 |
|---|---|
| [2026-09-21-spine-runtime-vat-summary](research/2026-09-21-spine-runtime-vat-summary.md) | 官方 Runtime 与 VAT 验证汇总 |
| [2026-09-21-spine-runtime-findings](research/2026-09-21-spine-runtime-findings.md) | 官方 Runtime 结论 |
| [2026-09-21-spine-runtime-memory-flow](research/2026-09-21-spine-runtime-memory-flow.md) | 官方 Spine 源码级内存流程 |
| [2026-09-21-spine-vat-decision](research/2026-09-21-spine-vat-decision.md) | 水果机大厅 VAT 上线决策 |

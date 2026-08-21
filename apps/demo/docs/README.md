---
状态: 活文档
摘要: demo 工程自己的文档地图 —— 只回答「**这个接入方工程是怎么组装的**」。kit 的模块怎么实现看 `packages/*/docs`，跨包决策看顶层 `docs/`。
何时读: 往 `assets/` 加东西、加一个模块、加一个马甲、发一次热更、出一次包之前。
依赖: [全仓文档地图](../../../docs/README.md)
---

# demo 工程文档

demo 是 **kit 的接入方样例**：它不实现框架能力，它演示「拿到 `@cck/core` + `@cck/engine`
之后，一个真实工程该怎么分层、怎么分包、怎么换皮、怎么发版」。所以这里的文档全是**装配视角**，
不重复 kit 的机制说明。

## 要做什么 → 读哪个

| 你的任务 | 打开 |
|---|---|
| **往 `assets/` 加目录 / 加一个功能模块** | [`bundle-layout.md`](bundle-layout.md) — 分层 × 分包总图、bundle 全表、优先级阶梯、归位判据 |
| **加一个马甲 / 给一个界面加换皮** | [`vest-and-skin.md`](vest-and-skin.md) — 马甲接缝、皮包边界、加一个马甲的清单 |
| **发一次热更 / 排查更新没生效** | [`hotupdate-pipeline.md`](hotupdate-pipeline.md) — 架构图、启动时序、发版流程、三档更新代价 |
| **出包时要改 VEST / 服务器地址 / 版本号** | [`build-plugin.md`](build-plugin.md) — `extensions/cck-build` 注入的六个打包期常量 |
| 出 Android 包（命令行） | skill `/demo-build` + [`../build-configs/README.md`](../build-configs/README.md) |
| 加场景 / 调相机 / 做横竖屏适配 | [`scene-and-camera-architecture.md`](scene-and-camera-architecture.md) |
| 做界面（配色、字号、间距） | [`ui-style-guide.md`](ui-style-guide.md)，效果图在 [`mockups/`](mockups/) |

## 什么归这里，什么不归

| 内容 | 去处 |
|---|---|
| demo 的分层 / 分包 / 马甲 / 发版**装配** | **本目录** |
| kit 某个模块的 API 与行为（`BundleManager`、`HotUpdateService`、`UIManager`…） | `packages/<pkg>/docs/modules/<module>.md` |
| API 精确签名 | `packages/core/docs/api/`（typedoc 生成，勿手改） |
| 跨包 / 不可逆的技术决策 | `docs/adr/NNNN-*.md` |
| 改造提案、调研横评（过程文档，一次性） | `docs/design/`、`docs/research/` |

本目录的文档是**现状**，不是编年史：打开读到的就是代码此刻的样子。改造动机、变更清单、决策沿革
在 `docs/design/*-proposal.md` 与 `docs/adr/` 里，沿革本身另有 git 历史。

# apps/demo — creator-core-kit 实测工程

真实 Cocos Creator 3.8.7 工程，作两件事：**给新项目看「怎么接入 kit」的样例**，以及**在真 cc 里逐模块验证 engine 适配层**。

## 两个场景

| 场景 | 用途 | 入口脚本 |
|---|---|---|
| **`scenes/Boot.scene`** | 🌱 **新项目接入样例**（先看这个） | `scripts/GameBoot.ts` + `scripts/CounterVM.ts` |
| `scenes/Demo.scene` | 🔬 逐模块验证探针（狂打 `[CCK-DEMO]` 日志，无可见 UI） | `scripts/DemoBoot.ts` |

## 接入样例怎么读（Boot.scene）

一个「点击计数器」，用最小代码把 kit 的招牌骨架跑通。照抄 `GameBoot.ts` 即可起步：

1. **`bootCoreKit({ modules })`** —— 组合根，一句话装配项目要用的 cc 适配模块（asset/storage/audio/ui/…，按需增删）。
2. **纯逻辑 ViewModel**（`CounterVM.ts`，零 `cc`）—— 状态与行为写在这，可直接 node/vitest 单测，不用开 Creator。这是铁律「逻辑可脱离引擎」的落地。
3. **代码化 UI + 数据绑定**（`bindText`）—— 把 VM 状态单向映射到 cc `Label`，signal 一变界面自动刷新。UI 与逻辑分离、数据驱动。

场景本身近乎空（Canvas + Camera + 一个挂 `GameBoot` 的空节点），UI 全在代码里建 —— 符合「一个空引导场景 + 代码化 UI 优先」的协作约定，从源头消灭 prefab/scene 合并冲突。复杂界面则改走 `UIManager.open(prefab)`（见 `DemoBoot.ts` 里的 UIManager 样例）。

> 代码建 UI 的坑：UI 节点必须落在 `Layers.Enum.UI_2D` 层，否则 UI 相机不渲染（黑屏）。见 `GameBoot.makeLabel`。

## 跑起来

用 Cocos Creator 3.8.7 打开本工程，双击 `Boot.scene`，点编辑器顶部 ▶ 预览。

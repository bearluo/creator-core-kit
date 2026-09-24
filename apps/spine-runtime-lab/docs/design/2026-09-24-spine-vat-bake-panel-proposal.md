# 改造提案：烘焙参数面板（socket / 动画 / 帧率可选）

状态：已实施
摘要：右键 Spine 资源由「直接烘焙」改为打开烘焙面板：可选 alpha 模式、帧率、要烘的动画、socket 骨骼和输出目录；上次的参数从已有的 `manifest.spinevat` 读回当默认值，不新增配置文件。
何时读：评审本改造，或实施时对照步骤。
依赖：[烘焙搬进扩展](2026-09-24-spine-vat-bake-v2-proposal.md)（已实施）、[Compiler](spine-vat-compiler.md)

## 1. 动机

现在右键烘焙的参数几乎全是写死的：

| 参数 | 现状 | 问题 |
|---|---|---|
| socket 骨骼 | 不传 `socketNames`，**一个都不烘** | 运行时 `socket()` 永远拿不到数据；要用挂点只能改代码 |
| 动画 | 全部 | 只用其中几段时白占贴图 |
| 帧率 | 固定 30 | 快动作要 60、慢循环 15 就够，没法调 |
| alpha 模式 | 两个菜单项二选一 | 能用，但和别的参数分散在两处 |
| 输出目录 | 固定同目录 `<名>-vat/` | 想直接出到 `resources/` 下要手动挪 |

编译器和 Analyzer 本来就支持这些参数（`SpineVatAnalyzerOptions.animations / frameRate / alphaMode`、`SpineVatCompileOptions.socketNames`），缺的只是入口。

## 2. 变更总览

| 项 | 现状 | 改后 |
|---|---|---|
| 右键菜单 | 「烘焙 Spine VAT（straight）」「（premultiplied）」 | 一项「烘焙 Spine VAT…」，打开面板并带上资源 uuid |
| 面板 | 无 | 新增 `panels.bake`（simple 面板，HTML + 原生 `ui-*` 控件，不引框架） |
| 参数来源 | 写死 | 面板提交 `SpineVatBakeOptions`；默认值见 §4 |
| `bakeSpineVat` | `(data, alphaMode)` | `(data, options: SpineVatBakeOptions)` |
| 场景进程 | `bake(uuid, alphaMode, outDir, sourceDir)` | 新增 `describeSpine(uuid)`（动画名、时长、骨骼名、Spine 版本）；`bake` 改收 options |
| 结果反馈 | 控制台 `[Spine VAT Bake]` | 面板里显示进度 / 摘要 / 原样报错，控制台照旧打 |

## 3. 目标 API

```ts
// bake/src/index.ts
export interface SpineVatBakeOptions {
  alphaMode: 'straight' | 'premultiplied';
  frameRate: number;              // 1..120
  animations: string[];           // 非空；按骨架里的顺序烘
  socketNames: string[];          // 可空
}
export function bakeSpineVat(data: sp.SkeletonData, options: SpineVatBakeOptions): Promise<BakedSpineVat>;

// 纯逻辑，node 可测：从已有 manifest 推上次的参数；读不到的字段回落到 fallback
export function bakeDefaultsFromManifest(
  manifest: unknown,
  fallback: SpineVatBakeOptions,
): SpineVatBakeOptions;
```

```js
// scene.js（场景进程）
describeSpine(uuid) -> { animations: Array<{ name, duration }>, bones: string[], spineVersion: string, runtimeOk: boolean }
bake(uuid, options, outDir, sourceDir) -> { manifest, summary }   // 写盘方式不变：先 .bin/PNG，manifest 由主进程最后写
```

## 4. 默认值与记忆

打开面板时：

1. 场景进程 `describeSpine` 给出动画列表和骨骼列表；`runtimeOk` 为假（工程不是 Spine 4.2）时面板直接显示现有的版本提示，烘焙按钮置灰。
2. 输出目录默认 `<名>-vat/`；该目录下已有 `manifest.spinevat` 就用 `bakeDefaultsFromManifest` 读回：`alphaMode` ← `manifest.alphaMode`，`frameRate` ← `clips[0].fps`，`animations` ← `clips[].name`，`socketNames` ← 各 clip `sockets[].name` 的并集。
3. 没有旧 manifest：straight、30、全部动画、不选 socket。
4. 旧 manifest 里有、但骨架里已经没有的动画 / 骨骼：丢弃并在面板提示一行。

改输出目录时重新按第 2 步读默认值。**不写 meta、不加 sidecar 文件**：产物本身就是参数记录，删掉产物等于重置。

## 5. 设计决策

| 决策 | 选择 | 理由 |
|---|---|---|
| 入口 | 右键打开面板 | 参数多了，菜单项组合不下去 |
| 面板技术 | `Editor.Panel.define` + 原生 `ui-checkbox / ui-num-input / ui-select`，模板字符串 | 不引 Vue，扩展零依赖、零构建 |
| 参数持久化 | 从产物 manifest 读回 | 不新增文件；参数和产物天然一致 |
| socket 候选 | 骨架全部骨骼，带搜索框 | 骨骼可能上百个；业务只挂少数几个 |
| 多皮肤 | 不做 | 编译器目前只支持单皮肤，另立题 |
| 批量烘焙 | 不做 | 真有需求再加「多选资源」 |

## 6. 测试计划

- **单测（vitest）**：`bakeDefaultsFromManifest`——无 manifest、字段缺失、socket 并集去重、fps 取值、非法值回落。
- **编辑器实测（MCP，空工程 + lab）**：
  - 选 2 段动画 + 1 个 socket 骨骼烘焙 → manifest 只含这 2 段，`clips[].sockets` 有该骨骼，运行时 `socket()` 取得到；
  - 再次打开面板，默认值等于上次的选择；
  - 帧率 60 烘焙 → `clips[].fps` 为 60，帧数翻倍；
  - Spine 3.8 模块的工程打开面板 → 显示版本提示、按钮置灰；
  - 全选动画、不选 socket、straight、30 → 产物与现在右键烘焙逐字节一致（回归）。

## 7. 实施步骤

1. `bake/src/index.ts`：`SpineVatBakeOptions`、`bakeDefaultsFromManifest`（先写单测）；`bakeSpineVat` 改收 options，透传给 Analyzer（`animations / frameRate / alphaMode`）与 Compiler（`socketNames`）；重新打包 `bake.js`。
2. `scene.js`：加 `describeSpine`，`bake` 改收 options。
3. 面板 `panels/bake.js` + `package.json` 注册；`assets-menu.js` 改成打开面板；主进程负责读旧 manifest、最后写 manifest 并刷新。
4. 按 §6 实测；扩展 README「烘焙」一节改写；[Compiler](spine-vat-compiler.md) 的入口描述更新；本提案标「已实施」。

## 8. 实施结果（2026-09-24）

- 按 §3 实现；与草案的出入：`bakeDefaultsFromManifest` 多收一个骨架信息参数并返回 `dropped`，放在不依赖 `cc` 的 `SpineVatBakeOptions.ts`；默认值在场景进程的 `describeBakeSource` 里算（面板是纯 JS，加载不了依赖 `cc` 的 `bake.js`）。面板自己完成烘焙调用、写 manifest 与刷新，主进程只转交目标资源。
- 编辑器实测（空工程）：读回默认值、选 2 段动画 + 1 根 socket 骨骼 + 60fps + premultiplied（manifest 只含 2 段、fps 60、每段 120 帧、socket 每帧都有）、再次读回与上次一致、不选动画被拒；straight / 30 / 全部 / 无 socket 与原产物 `.bin` 逐字节一致。
- 顺带修正：premultiplied 烘焙会多出一张全无用的 `dark-0.bin`（RGB 全 0，只有 alpha 是 PMA 标记 255），dark 通道改为只看 RGB，premultiplied 下不再输出。

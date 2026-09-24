# Spine VAT Analyzer

状态：已实现
摘要：烘焙前的第一步。先做静态分析，再用官方 Runtime 逐帧试跑（dry-run），给出兼容等级、Render Lane 与 GPU 数据量估算。Compiler 按它的结论决定烘哪些动画、拒绝哪些。
何时读：修改 Analyzer，或者排查某个资源为什么被判 `RUNTIME_FALLBACK` 时。
依赖：[工具设计](spine-vat-tool-design.md)

## 代码

| 文件 | 内容 |
|---|---|
| `extensions/spine-vat-importer/bake/src/SpineVatTypes.ts` | 报告（`SpineVatAnalysisReport`）与 manifest 的类型 |
| `extensions/spine-vat-importer/bake/src/SpineVatAnalyzerCore.ts` | 纯逻辑：解析 JSON / atlas、材质超序列、按动画估算与定级，不依赖 `cc`，可在 node 下单测 |
| `extensions/spine-vat-importer/bake/src/SpineVatAnalyzer.ts` | 入口 `analyzeSpineVatSkeletonData(parent, skeletonData, options)`：用引擎内置的 Spine wasm 逐帧试跑 |
| `test/extensions/spine-vat-importer/bake/SpineVatAnalyzerCore.test.ts` | 用真实资源测静态分析和超序列 |

由 `extensions/spine-vat-importer/bake/src/index.ts` 的 `bakeSpineVat` 调用：编辑器里在 Spine 资源上右键「烘焙 Spine VAT」，在场景进程里跑（见扩展 README）。结果摘要（动画数、纹理字节数、警告数）打在编辑器控制台，前缀 `[Spine VAT Bake]`。

## 选项

| 字段 | 默认 | 含义 |
|---|---|---|
| `alphaMode` | atlas 里的 `pma` 声明 | `straight` / `premultiplied`；atlas 各页的声明不一致或缺失时为 `unknown` |
| `frameRate` | 60 | 采样帧率；右键烘焙固定传 30 |
| `textureProfile` | `balanced` | 只影响估算。实际产物始终按 `exact`（RGBA32F）存 |
| `animations` | 全部 | 只分析其中几段 |
| `budget` | `maxRenderLanes 12` / `maxTextureBytes 64 MiB` / `maxTextureSize 4096` | 超出就判 `RUNTIME_FALLBACK` |

## 流程

1. **静态分析**（`analyzeSpineJson`）：
   - 统计 bone、slot、skin、animation、各类附件、weighted mesh、sequence、四类约束；
   - 检测 deform / attachment / drawOrder / event / two-color 时间轴与 slot 的 blend；
   - 解析 atlas 每页的 `pma`。
   - 只接受 JSON 格式的 SkeletonData，`.skel` 直接报错。
2. **逐帧试跑**：每段动画各建一个 REALTIME `sp.Skeleton`（`useTint`，关掉 batch），`setToSetupPose` 后从 setup pose 起步，`ceil(duration × fps)` 帧，每帧推进固定的 `1/fps`，第 0 帧推进 0（让 t=0 的关键帧也生效）。
   - 用 `_instance.updateAnimation` 推进，因为组件的 `updateAnimation` 在暂停时不动。
   - 每帧从 `updateRenderData()` 的 wasm 内存里读：顶点数、索引数、索引 hash、uv / light / dark 的 hash、light 是否恒白、dark 是否全零，以及合并相邻同材质后的材质段。
3. **按动画定级**（`buildClipAnalysis`）：
   - 判断拓扑是否稳定（顶点数、索引、材质段逐帧都相同）；
   - 用逐帧增量的最短公共超序列合并各帧材质序列，得到 lane 列表和每条 lane 的容量；
   - 估算纹理字节、页数、网格字节。
4. **汇总**：全部动画中最差的等级即整体等级；全部动画的 GPU 字节合计超预算时，整体判 `RUNTIME_FALLBACK`。另外对 JSON 与 atlas 文本做 SHA-256（不可用时退回 FNV-1a），写进 `source.hashes`。

## 等级

| 等级 | 条件 |
|---|---|
| `RUNTIME_FALLBACK` | Spine 版本不是 4.2 / alpha mode 为 `unknown` / lane 数或纹理字节超预算 |
| `HYBRID` | 有 event 时间轴 |
| `BAKED_VARIANT` | skin 多于一个 |
| `LOSSLESS_VAT` | 其余 |

Compiler 只看其中两处：整体为 `RUNTIME_FALLBACK` 时拒绝编译；单段动画为 `RUNTIME_FALLBACK` 时跳过这一段。

## 已知行为与坑

- **估算用的是剪裁后的输出**：Analyzer 读的是官方渲染器剪裁之后的几何，有剪裁时拓扑逐帧变化，报告里写的是 `triangle-soup-dynamic`，lane 与字节也按三角形汤估。实际产物是固定槽位（见 [总览](spine-vat-overview.md)），数据量通常小得多（原版水果机的 position 贴图：三角形汤 9.18 MB → 固定槽位 2.82 MB）。所以报告里的 `geometryMode`、lane 数和字节只能当保守上限。能不能走固定槽位，Analyzer 不判断，由 Compiler 判断。
- **`BAKED_VARIANT` 只是一个标记**：Compiler 只烘默认 skin，不会按 skin 分别采样。
- **Physics 约束没有预热（warm-up）**：从 setup pose 直接开始采样。
- **哈希范围**：只哈希 JSON 与 atlas 文本，不含 PNG。

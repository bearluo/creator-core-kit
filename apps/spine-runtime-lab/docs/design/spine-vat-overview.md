# Spine VAT：固定槽位 + GPU 剪裁 + 帧间插值

状态：已实现
摘要：VAT 数据格式为「每个附件顶点一个固定槽位 + 带索引 + shader 逐像素剪裁」，帧间插值可用、每帧顶点数约为三角形汤的 1/3；2D（`spinevat.UiSkeleton`）与 3D（`spinevat.Skeleton`）读同一份数据。过不了规则的动画烘焙时报错。
何时读：改 baker / compiler / 两个 VAT 组件 / 两个 effect 之前。
依赖：[Compiler](spine-vat-compiler.md)

## 为什么

早先烘的是官方 Runtime 剪裁后的输出：剪裁每帧重新切三角形，顶点数和顺序逐帧变化，只能存成三角形汤。后果：

- 同一个附件的顶点每帧落在不同槽位，帧间插值会插出裂纹；
- 三角形汤没有顶点共享，每帧顶点数约为带索引时的 3 倍。

## 方案

**baker**：同一动画、同一时刻并行跑两套骨骼：

1. 去掉全部剪裁附件的变体 → 渲染输出就是剪裁前的原始几何（Region 4 顶点 / Mesh `worldVerticesLength/2` 顶点，三角形是附件自带的，逐帧不变）；
2. 原骨骼 → 按官方渲染器的规则（`clipStart` / `clipEnd`，骨骼未激活跳过、没附件跳过）走一遍 drawOrder，得到每个 slot 当帧被哪个剪裁裁，以及剪裁多边形的世界坐标（`computeWorldVertices`）。

**compiler**：以 `(slot, 附件名)` 为键分配固定槽位，按绘制顺序排列、同材质相邻合成 lane，lane 带静态索引。某帧没出现的键：uv 写成 (-1,-1)、alpha 0（退化且与相邻帧 uv 不同 → 插值自动退回阶跃）。

每帧数据 = 顶点区 + 剪裁区（每个剪裁 `MAX_CLIP_VERTICES` 个 texel：`(x, y, 生效?, 顶点数)`）；另有一段静态区，每个顶点一个 texel 存它归哪个剪裁。

**shader**（`VAT_CLIP`）：VS 取所属剪裁当帧（插值时连同下一帧）的多边形，以 varying 传给 FS；FS 用奇偶交叉法判断像素中心在不在多边形里，不在就 discard。奇偶法直接支持凹多边形，不需要凸分解，与官方「凸分解后逐块裁」得到同一个区域。

## 规则（编译期检查）

任一段动画命中任一条 → 烘焙报错（`VAT 无法固定槽位烘焙：动画名（原因）`），需要改资源：

| 条件 | 原因 |
|---|---|
| 有 drawOrder 时间轴导致键顺序变化 | 静态索引和 lane 顺序失效 |
| 同一个键在不同帧归属不同剪裁 | 归属是静态区数据，只存一份 |
| 剪裁多边形顶点数 > `MAX_CLIP_VERTICES` | varying 和 FS 循环上限 |
| 同一键的三角形逐帧不同 | 静态索引失效 |

剪裁没生效的帧里键不归任何剪裁，不算冲突（剪裁附件激活切换因此能过）。

## 数据与运行时

- manifest 只有一个 layout `fixed`：lane 带内联 `indices`（lane 内局部号），layout 带 `clipCount` / `staticFrame`。运行时见到多个 layout 或缺 `indices` 就报错，要求重新烘焙。
- 寻址：`帧号 × frameStride + 顶点号`；所有 clip 的帧依次排列，最后多占一「帧」当静态区。
- 剪裁多边形不足 8 点用第 0 点补齐 → FS 固定查 8 条边（下标全是常量，GLSL ES 1.0 可编），补出的边长度为 0 不计数。
- 两个组件共用帧计算、插值、剪裁的 shader 逻辑（`spine-vat-ui.effect` / `spine-vat-v2.effect`，改一处要同步另一处；`test/extensions/spine-vat-importer/runtime/SpineVatPlayback.test.ts` 检查两边的帧计算写法）。差别只在逐实例参数：2D 放材质 UBO（每组 48 实例），3D 走 instanced attribute。
- 插值（`VAT_LERP`）是编译期宏，由两个组件的静态开关 `interpolate`（默认 true）决定，只影响之后创建的实例。
- 导入器把两个 effect 都挂成 `spinevat.SkeletonData` 的依赖（`effectAsset` / `uiEffectAsset`），组件只需要赋 `skeletonData`。
- bounds 只取官方（剪裁后）烘焙帧：剪裁前的原始几何会把包围盒撑大，人物被缩小。
- 坑：wasm 的 `updateAnimation` 不更新世界矩阵，baker 在取剪裁多边形前必须先 `updateRenderData()`，否则多边形停在上一次渲染的姿势（表现为剪裁边一圈错位）。
- 上限：VAT_CLIP 多用 5 个 varying（4 × vec4 + vec3），加上原有的共约 10 行；ES3 / WebGL2 保证 15 行够用，只支持 WebGL1（最少 8 行）的机器会编不过。

## 过渡混合（mix）

所有动画顶点一一对应，可以做淡入淡出（未实现，目前切动画是硬切）。

## 测试

- `tools/gen-clip-test-spine.mjs` 生成 `spine/nanwuzhe/letsparty_tuan_nanwuzhe_cliptest.json`：在 tigger 上分别叠加剪裁的激活切换（`clip_toggle`）、形变（`clip_deform`）、凹多边形（`clip_concave`）。
- 烘焙与真机测试流程见工程 README。
- 单测：`test/bake/SpineVatFixedLayout.test.ts`（槽位 / 退化 / 剪裁区 / 规则）、`test/bake/SpineVatCompilerV2.test.ts`（manifest 与静态区）、`test/extensions/spine-vat-importer/runtime/SpineVatRenderResources.test.ts`（3D 网格索引与材质宏）、同目录 `SpineVatSkeleton.test.ts` / `SpineVatUiSkeleton.test.ts`（两个组件的事件监听、socket、snapshot）。

以下对照数据来自三角形汤与固定槽位并存时期（2D 组件），「三角形汤」列是旧格式：

基线（三角形汤，web，1440×2560）：三段剪裁动画整帧 0 像素差；半帧阶跃 >48 最差 2.03%，插值最差 0.83%。

结果（fixed，同一套方法）：

| 项 | 三角形汤 | fixed |
|---|---|---|
| web 剪裁测试资源 整帧 / 阶跃 / 插值 | 0.00% / 2.03% / 0.83% | 0.05% / 2.03% / 0.06% |
| web 原版水果机 整帧 / 阶跃 / 插值 | 0.00% / 9.26% / — | 0.00% / 9.27% / 0.40% |
| position 贴图 | 9.18 MB（stride 3165） | 2.82 MB（stride 965 = 957 顶点 + 8 剪裁） |

真机（天玑 700，release，1080×2400，原版水果机）：

| 实例 | DC soup → fixed | CPU 周期/10s soup → fixed（插值 / 阶跃） | fps |
|---|---|---|---|
| 30 | 4 → 3 | 4.67G / 4.54G → 4.72G / 4.20G | 60 |
| 150 | 13 → 8 | 4.11G / 3.95G → 4.08G / 4.04G | 60 |
| 600 | 42 → 23 | 5.44G / 5.39G → 5.13G / 5.08G | 60 |

真机保真：整帧最差 0.55%（soup 同为 0.55%），半帧插值 0.57%，半帧阶跃 9.22%。遮挡探针 VAT_UI_LERP / SHARED_CACHE 前后两例全部 PASS。

### 当前版本真机结果（2D + 3D 组件，只有固定槽位格式）

天玑 700，release，1080×2400，原版水果机；每个实例一个节点，`addComponent` 后赋 `skeletonData`；CPU 周期是 `simpleperf stat --app` 采 10 秒。

| 实例 | 2D 插值 | 2D 阶跃 | 3D 插值 | 官方 SHARED_CACHE |
|---|---|---|---|---|
| 30 | 4.25G · 3 DC · 60fps | 4.24G · 3 DC | 4.49G · 6 DC · 60fps | 6.52G · 107 DC · 60fps |
| 150 | 4.09G · 8 DC · 60fps | 4.08G · 8 DC | 4.06G · 6 DC · 60fps | 21.98G · 529 DC · 60fps |
| 600 | 5.29G · 23 DC · 60fps | 5.43G · 23 DC | 5.03G · 6 DC · 60fps | 31.25G · 1995 DC · 24.7fps |

- 3D 的 DC 不随实例数增长（GPU instancing）；2D 每 48 个实例一组 UBO，DC 随实例数线性增长，但仍能和 Sprite 按兄弟顺序穿插。
- 保真（>48 像素占比最差值）：两个组件整帧都是 0.55%，半帧阶跃都是 9.22%，半帧插值 2D 0.57%。3D 在两轮测试里分别是 0.57% 和 1.20%；1.20% 那一轮只有一页异常，是官方那一侧截到了带闪光的帧，同一帧 2D 为 0.01%，按截图时机抖动处理。
- 遮挡探针 VAT_UI_LERP / SHARED_CACHE 前后两例全部 PASS。

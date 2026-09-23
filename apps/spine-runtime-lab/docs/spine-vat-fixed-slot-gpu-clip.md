# Spine VAT：固定槽位 + GPU 剪裁 + 帧间插值

状态：已实现（未提交）
摘要：把「CPU 剪裁后的三角形汤」换成「每个附件顶点一个固定槽位 + 带索引 + shader 逐像素剪裁」，让帧间插值可用、每帧顶点数下降；做不到的动画整段退回现有路径。
何时读：改 baker / compiler / VAT UI 运行时 / spine-vat-ui.effect 之前。
依赖：[spine-vat-compiler-m2.md](spine-vat-compiler-m2.md)

## 为什么

现有路径烘的是官方 Runtime 剪裁后的输出：剪裁每帧重新切三角形，顶点数和顺序逐帧变化，只能存成三角形汤。后果：

- 同一个附件的顶点每帧落在不同槽位，帧间插值会插出裂纹（`SpineVatUiSkeleton.interpolate` 因此默认关）；
- 三角形汤没有顶点共享，每帧顶点数约为带索引时的 3 倍。

## 方案

**baker**：同一动画、同一时刻并行跑两套骨骼：

1. 去掉全部剪裁附件的变体 → 渲染输出就是剪裁前的原始几何（Region 4 顶点 / Mesh `worldVerticesLength/2` 顶点，三角形是附件自带的，逐帧不变）；
2. 原骨骼 → 按官方渲染器的规则（`clipStart` / `clipEnd`，骨骼未激活跳过、没附件跳过）走一遍 drawOrder，得到每个 slot 当帧被哪个剪裁裁，以及剪裁多边形的世界坐标（`computeWorldVertices`）。

**compiler**：以 `(slot, 附件名)` 为键分配固定槽位，按绘制顺序排列、同材质相邻合成 lane，lane 带静态索引。某帧没出现的键：uv 写成 (-1,-1)、alpha 0（退化且与相邻帧 uv 不同 → 插值自动退回阶跃）。

每帧数据 = 顶点区 + 剪裁区（每个剪裁 `MAX_CLIP_VERTICES` 个 texel：`(x, y, 生效?, 顶点数)`）；另有一段静态区，每个顶点一个 texel 存它归哪个剪裁。

**shader**（`VAT_CLIP`）：VS 取所属剪裁当帧（插值时连同下一帧）的多边形，以 varying 传给 FS；FS 用奇偶交叉法判断像素中心在不在多边形里，不在就 discard。奇偶法直接支持凹多边形，不需要凸分解，与官方「凸分解后逐块裁」得到同一个区域。

## 退回规则（按动画整段决定，编译期定死）

任一条命中 → 这段动画走现有三角形汤 layout，不插值：

| 条件 | 原因 |
|---|---|
| 有 drawOrder 时间轴导致键顺序变化 | 静态索引和 lane 顺序失效 |
| 同一个键在不同帧归属不同剪裁 | 归属是静态区数据，只存一份 |
| 剪裁多边形顶点数 > `MAX_CLIP_VERTICES` | varying 和 FS 循环上限 |
| 同一键的三角形逐帧不同 | 静态索引失效 |

不按 lane 退回：同一骨骼里一部分插值、一部分阶跃，半帧时两部分会错开（被剪裁的内容大多挂在未剪裁的部件上）。退回的原因写进 manifest 的 `compatibility.warnings`。

## 数据与运行时

- 编译选项 `fixedSlots`（驱动 URL `fixed=1`）默认关；关着时产物与之前逐字节相同。
- manifest 可以有两个 layout：`default`（三角形汤）与 `fixed`（`geometryMode: indexed-stable`，lane 带内联 `indices`，layout 带 `clipCount` / `staticFrame`）。clip 的 `layout` 字段指明走哪个。
- 寻址公式不变（`帧号 × frameStride + 顶点号`）：`fixed` 区的起点补齐到它 stride 的整数倍，fixed clip 的 `frameOffset` 直接接在三角形汤后面；最后多占一「帧」当静态区。
- 剪裁多边形不足 8 点用第 0 点补齐 → FS 固定查 8 条边（下标全是常量，GLSL ES 1.0 可编），补出的边长度为 0 不计数。
- VAT UI 运行时每个 layout 建一组 lane 节点与材质，切 clip 时只启用对应那组。插值（`VAT_LERP`）只在全部 lane 为 `indexed-stable` 的 layout 上开，所以 `SpineVatUiSkeleton.interpolate` 默认 true；三角形汤 clip 始终阶跃。
- 旧 consumer（MeshRenderer 路径、workbench）只读 `layouts[0]`，不认 `fixed`——开 `fixedSlots` 的资源只给 VAT UI 运行时用。
- bounds 只取官方（剪裁后）烘焙帧：剪裁前的原始几何会把包围盒撑大，人物被缩小。
- 坑：wasm 的 `updateAnimation` 不更新世界矩阵，baker 在取剪裁多边形前必须先 `updateRenderData()`，否则多边形停在上一次渲染的姿势（表现为剪裁边一圈错位）。
- 上限：VAT_CLIP 多用 5 个 varying（4 × vec4 + vec3），加上原有的共约 10 行；ES3 / WebGL2 保证 15 行够用，只支持 WebGL1（最少 8 行）的机器会编不过。

## 过渡混合（mix）

两段都在 `fixed` layout 上时顶点一一对应，可以做淡入淡出（未实现）；涉及退回动画的组合只能硬切。

## 测试

- `tools/gen-clip-test-spine.mjs` 生成 `fruit-machine/letsparty_tuan_nanwuzhe_cliptest.json`：在 tigger 上分别叠加剪裁的激活切换（`clip_toggle`）、形变（`clip_deform`）、凹多边形（`clip_concave`）。
- 烘焙：web 构建 `?asset=cliptest&vatAnalyze=1&vatCompile=1&pma=straight&analyzeFps=30`，再调 `__SPINE_VAT_V2_EXPORT__()`，静态服务器落盘。
- 保真：`?asset=cliptest&vat2=1&fidelity=1&pma=straight`，截图后 `tools/check-fidelity.py`。

基线（现有路径，web，1440×2560）：三段动画整帧 0 像素差；半帧阶跃 >48 最差 2.03%，现有插值最差 0.83%。

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

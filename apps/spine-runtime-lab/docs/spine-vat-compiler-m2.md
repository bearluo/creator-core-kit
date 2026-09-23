# Spine VAT Compiler/Renderer M2 使用与实测

> Cocos Creator：3.8.7
>
> Spine worker：4.2.x
>
> 当前阶段：Web/WASM 离线烘焙 + Web GPU Instancing 播放

## 1. 本阶段结论

M2 已经把 M1 的兼容性分析接到可运行的通用视觉编译链：

```text
原始 SkeletonData
  -> Cocos 3.8.7 内置 Spine 4.2 Runtime 固定步长求值
  -> updateRenderData() 最终顶点/索引/材质段
  -> 公共 Render Lane 超序列
  -> 动态 triangle soup + 空 Lane 退化三角形
  -> 全 clip/全 Lane 共用线性 VAT 地址空间
  -> spine-vat-2 manifest + position/light/dark 分页
  -> MeshRenderer + GPU Instancing
```

与早期 `spine-vat-1` PoC 的关键区别是：M2 始终使用原始 `SkeletonData`，不调用 `createVatCompatibleSkeletonData()`，因此不会为固定拓扑而删除 clipping、draw order 或修补特定 slot。骨骼、weighted mesh、deform、constraint、attachment、draw order 和 clipping 都由官方 Runtime 先求出最终三角形，编译器只重新组织这些结果。

当前两个实测资产都使用 `pma=straight`。Straight/PMA 的八套混合 technique 已实现并通过 Creator effect 编译，但仍需要真实 PMA 资产做像素验收。

## 2. 代码与产物

| 文件 | 职责 |
| --- | --- |
| `assets/scripts/SpineVatCompilerV2.ts` | 多动画采样、Lane 编译、triangle soup、通道裁剪、分页和 manifest |
| `assets/scripts/SpineVatRendererV2.ts` | 创建数据纹理、静态 Lane mesh、材质和实例 population |
| `extensions/spine-vat-importer/assets/spine-vat-v2.effect` | 扩展只读挂载的四种 blend mode × Straight/PMA Effect、最多四页同步采样 |
| `assets/scripts/SpineLabDriver.ts` | `vat2` URL 入口、固定帧/切 clip/导出浏览器接口 |
| `test/SpineVatCompilerV2.test.ts` | Lane、分页、多 atlas、分片和 fallback 单测 |

manifest 的核心寻址是：

```text
linear = clip.frameOffset * layout.frameStride
       + frame * layout.frameStride
       + lane.vertexOffset
       + localVertexId

page  = floor(linear / pageTexels)
local = linear - page * pageTexels
```

所有 clip 和 Lane 共用同一组 position/light/dark 页，不会为每个 Lane 分配一整套纹理。`a_position.x` 只保存 `lane.vertexOffset + localVertexId`，实例世界矩阵由 Cocos 的 instancing attribute 提供。

## 3. Render Lane 与渲染顺序

编译器把每帧相邻且材质相同的 segment 合并，再对所有帧的有序材质序列执行确定性的公共超序列合并。重复材质不会错误合并成同一个 Lane，例如：

```text
frame 0: normal, additive, normal
frame 1:         additive, normal
layout : normal, additive, normal
```

第二帧的第一个 Lane 保持位置全零，形成零面积三角形。这样 multiply/screen 也不会因“只把 alpha 写 0”而污染目标颜色。

一个逻辑 Lane 超过 65535 个 triangle-soup 顶点时，会按三角形边界拆成连续物理 Lane；每个物理 Lane 的索引仍可使用 `Uint16`。Shader 线性地址限制为 `2^24` texel，避免高精度 float 无法精确表示整数 texel 地址。

Lane 顺序就是提交顺序，同一 Lane 的多个角色合成一个 instancing batch。透明实例在 batch 内仍不会逐角色排序；角色重叠或中间穿插其他 Renderer 时，必须按层拆 batch，Draw Call 也会随连续批次数增加。

## 4. 混合、PMA 与颜色通道

effect 按 Cocos 3.8.7 `spine/assembler/simple.ts` 的 blend factor 建立八个 technique：

| Alpha | normal | additive | multiply | screen |
| --- | --- | --- | --- | --- |
| Straight | `SRC_ALPHA / ONE_MINUS_SRC_ALPHA` | `SRC_ALPHA / ONE` | `DST_COLOR / ONE_MINUS_SRC_ALPHA` | `SRC_ALPHA / ONE_MINUS_SRC_COLOR` |
| PMA | `ONE / ONE_MINUS_SRC_ALPHA` | `ONE / ONE` | `DST_COLOR / ONE_MINUS_SRC_ALPHA` | `ONE / ONE_MINUS_SRC_COLOR` |

fragment two-color 公式与 Creator 内置 `builtin-spine.effect` 一致。所有帧 light 恒白时不生成 light 页，dark 恒零时不生成 dark 页；Renderer 分别绑定 1x1 白/黑占位纹理。空 Lane 是否安全不依赖颜色通道，而依赖零面积位置。

## 5. Web 实测

测试环境为 Headless Chromium 软件 GPU。它适合验证 Shader、像素和 GPU Instances 链路，不适合把 FPS 外推到移动真机。

### 5.1 `tuan42`

配置：30 FPS、Straight Alpha、1 个动画、60 帧。

| 指标 | 结果 |
| --- | ---: |
| 物理 Render Lane | 2 |
| exact 数据纹理 | 1,638,400 B（1.56 MiB） |
| 20 实例 GPU Instances | 40 |
| 20 实例整页 Draw Call | 6 |

官方 Runtime 在左、VAT v2 在右，固定帧截图按 RGBA 差值和大于 12 的阈值统计：

| 帧 | 超阈值像素占比 | 平均单通道绝对误差 |
| ---: | ---: | ---: |
| 0 | 0% | 0 |
| 15 | 0% | 0 |
| 30 | 0% | 0.0283 |
| 45 | 0.0364% | 0.0066 |

原始资源的 clipping 和变化拓扑没有被删除，最终画面与官方 Runtime 对齐。

### 5.2 水果机男舞者

配置：30 FPS、Straight Alpha、3 个动画，每个 60 帧，共 180 帧。

| 指标 | 结果 |
| --- | ---: |
| 物理 Render Lane | 4 |
| `frameStride` | 3,183 texel |
| exact 数据纹理 | 11,468,800 B（10.94 MiB） |
| 20 实例 GPU Instances | 80 |
| 20 实例整页 Draw Call | 8 |

三个动画各取第 0/15/30/45 帧，共 12 个同帧对照：

| 动画 | 第 0/15/30 帧 | 第 45 帧 | 最大平均单通道绝对误差 |
| --- | ---: | ---: | ---: |
| `letsparty_tuan_nanwuzhe_expect3x3` | 0% / 0% / 0% | 0% | 0.0387 |
| `letsparty_tuan_nanwuzhe_tigger` | 0% / 0% / 0% | 0.8567% | 0.4586 |
| `letsparty_tuan_nanwuzhe_tigger3x3` | 0% / 0% / 0% | 0.6889% | 0.3943 |

第 45 帧的差异集中在少量半透明/发光边缘。烘焙使用连续 45 次 `1/30` 更新，参考侧从 setup pose 一次推进 `45/30` 秒，浮点累计与渲染边缘会产生轻微差异。M4 仍应补齐统一时间推进、alpha 加权 PSNR、SSIM 和 heatmap，不能只凭本表宣称所有资源逐像素无损。

## 6. 运行方法

构建并启动静态服务后：

```text
/?vat2=1&count=20&pma=straight&analyzeFps=30
/?vat2=1&count=1&compare=1&pma=straight&analyzeFps=30
/?vat2=1&count=1&pma=straight&analyzeFps=30&clip=<动画名>
```

浏览器接口：

```js
window.__SPINE_VAT_V2__
window.__SPINE_VAT_V2_READY__
window.__SPINE_VAT_V2_SET_CLIP__('animation')
window.__SPINE_VAT_V2_SET_FRAME__(15)
window.__SPINE_VAT_V2_SET_FRAME__(null)
await window.__SPINE_VAT_V2_EXPORT__()
```

导出文件为 `manifest.spinevat`、`position-N.bin`，以及按需存在的 `light-N.bin` / `dark-N.bin`。`manifest.spinevat` 内部仍是可读 JSON，但用专用后缀避免 importer 冲突。导出目录由 `tools/static-server.mjs` 的第四个参数指定。

## 7. 保护条件

编译器遇到以下情况会失败而不是静默降质：

- Analyzer 整体为 `RUNTIME_FALLBACK`；
- Spine Runtime family 不是 4.2；
- Alpha mode 未明确；
- material texture id 无法映射 atlas page；
- segment 不是三角形列表，或索引逃出自己的顶点范围；
- 数据纹理超过 recipe 字节预算；
- 线性地址超过 float 精确整数范围；
- 数据页超过 Renderer 的四页限制。

## 8. 尚未完成

- M3 每实例 clip、相位、速度、颜色和状态 API；当前同一 population 的动画时间仍由材质 uniform 共享。
- `INDEXED_STABLE` 静态 UV/索引路径；M2 当前统一输出 `RGBA32F` dynamic triangle soup。
- `balanced` RGBA16F 和 `compact` 定点压缩、帧插值及误差自动升级。
- 多 skin variant、event、socket、碰撞和预烘焙 transition。
- 真实 PMA、真实多 atlas page、sequence、multiply/screen 独立测试资产。
- Creator Editor Analyze/Preview/Bake 面板、CI 批处理和增量 hash 缓存。
- Android Native 加载器与真机同帧/性能回归。

因此当前 M2 证明的是“通用视觉编译架构能保留官方 Runtime 最终画面并形成 GPU Instancing”，还不是可直接替换任意 `sp.Skeleton` API 的完整产品。

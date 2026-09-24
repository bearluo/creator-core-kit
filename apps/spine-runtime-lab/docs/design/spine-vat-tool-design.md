# 通用 Spine 转 VAT 工具设计

状态：已实现
摘要：通用 Spine 转 VAT 工具的整体分层：官方 Runtime 负责求值，自研部分负责编译、打包与播放。
何时读：想了解工具链为什么这样分层时；数据格式现状见 [spine-vat-overview.md](spine-vat-overview.md)。
依赖：无

> 目标版本：Cocos Creator 3.8.7，优先支持 Spine 4.2.x；3.8 通过独立适配器支持
>
> 设计原则：官方 Spine Runtime 负责动画求值，自研部分只负责编译最终渲染数据、打包和播放

## 1. 结论

截至本次核查，Spine 官方没有提供可直接接入 Cocos Creator 的 VAT 转换器或 VAT Runtime。官方 Spine Editor CLI 能导出 JSON、binary、atlas、图片序列和视频，但没有 VAT 导出类型；官方 `spine-runtimes` 4.2 分支也没有 VAT、GPU skinning 或 vertex-animation-texture 模块。

但不需要自己重新实现 Spine 动画算法。Cocos Creator 3.8.7 内置的 Spine 4.2 Runtime 已能计算：

- 骨骼动画、weighted mesh 和 deform；
- IK、Transform、Path 和 Physics constraint；
- region、mesh、linked mesh 和 sequence attachment；
- attachment timeline、draw order、slot color 和 two-color tint；
- clipping 后的最终三角形；
- normal、additive、multiply、screen 四种混合模式。

Cocos 的 `SpineSkeletonInstance.updateRenderData()` 返回已经完成上述计算的最终顶点、索引、纹理页和 blend mode。通用转换器应把它作为唯一的画面真值来源，不直接解释骨骼和约束来生成顶点。

VAT 能高保真保存“预先定义好的视觉结果”，但不能自动保留 Spine Runtime 的全部动态 API。任意换装、运行时 attachment、任意多轨混合、交互式物理、骨骼驱动逻辑等功能，需要编译成有限变体、使用轻量 CPU 辅助数据，或者回退官方 Runtime。

## 2. 官方能力调查

### 2.1 官方 Spine 提供什么

Spine Editor CLI 支持：

- 从 `.spine` 工程导出 JSON 或 binary；
- 同时打包 atlas；
- 导出 PNG/APNG/GIF 图片序列和 AVI/MOV；
- 固定 Spine Editor 版本执行批量、无界面导出；
- 图片/视频导出时设置 FPS、范围、skin、warm up 和最大边界。

它适合作为资产流水线的上游，但没有输出 GPU VAT 顶点纹理。PNG 序列可以作为极端复杂动画的备选后端，但会固定像素分辨率，并且透明背景上的 additive/multiply/screen 不能始终用单张普通 RGBA 完整还原。

### 2.2 Cocos 3.8.7 中可以直接复用什么

本机 Creator 3.8.7 源码确认：

- `spine-skeleton-instance.cpp:222` 在 `updateRenderData()` 中先执行官方 Runtime 的 world transform，再收集最终 mesh；
- `spine-skeleton-instance.cpp:394` 识别 `ClippingAttachment`，并在 `:425`、`:482` 输出裁剪后的顶点和三角形；
- `simple.ts:69` 给出了 Cocos 当前四种 Spine blend mode 的精确 blend factor；
- `MeshRenderer.setInstancedAttribute()` 支持自定义实例属性，可为每个 VAT 实例传独立动画、相位、速度和颜色。

因此转换器应运行在 Creator Editor/Web WASM 环境。Native 只加载烘焙结果，不负责烘焙。

### 2.3 不能直接复用 Cocos 3D 烘焙骨骼动画

Cocos 的 `BakedSkinningModel` 支持 GPU 骨骼动画和每实例动画帧，但它面向普通 3D skinned mesh，不能直接表达 Spine 的 attachment 切换、draw order、clipping、two-color tint 和 slot blend mode。因此可以借鉴其实例属性设计，不能把它当作 Spine VAT 转换器。

## 3. 功能覆盖定义

转换报告必须区分以下四个等级，不能只输出“支持/不支持”：

| 等级 | 含义 | 运行时行为 |
| --- | --- | --- |
| `LOSSLESS_VAT` | 在选定 skin、动画和播放条件下，视觉结果可按采样精度还原 | 纯 VAT |
| `BAKED_VARIANT` | 功能被编译成有限 skin、attachment 或混合变体 | VAT，运行时只能选择已烘焙变体 |
| `HYBRID` | 画面走 VAT，事件、socket、碰撞等保留轻量 CPU 数据 | VAT + 轻量播放器 |
| `RUNTIME_FALLBACK` | 无法在质量、内存或 Draw Call 预算内安全转换 | 官方 `sp.Skeleton` |

工具禁止默认删除 clipping、draw order 或 attachment timeline。任何近似或裁剪都必须是显式选项，并写入 manifest 和兼容性报告。

## 4. 总体架构

```text
.spine（可选）
  -> 官方 Spine CLI 导出 JSON/binary + atlas
  -> Creator 3.8.7 SkeletonData 导入
  -> 静态特征分析 + Runtime 逐帧探测
  -> 官方 Spine 4.2 Runtime 固定步长求值
  -> 最终顶点/索引/纹理页/blend 序列
  -> Render Lane 编译 + 纹理分页/量化
  -> spine-vat-2 manifest + binary + atlas pages
  -> SpineVatPlayer / GPU Instancing
                         \-> 不兼容动画回退 sp.Skeleton
```

建议拆成五个模块：

1. `SpineVatAnalyzer`：版本、资源和动态拓扑预检。
2. `SpineVatSampler`：驱动官方 Runtime，采集最终渲染帧。
3. `SpineVatCompiler`：生成固定 Render Lane、mesh 和纹理页。
4. `SpineVatImporter`：把 manifest/binary 导入 Creator 资产。
5. `SpineVatPlayer`：播放、实例属性、事件、socket 和回退。

### 4.1 两条几何编译路径

通用工具不应让所有资源都付出变化拓扑的最高内存成本。Analyzer 根据逐帧渲染签名自动选择：

| 编译路径 | 适用条件 | 数据组织 | 优点 |
| --- | --- | --- | --- |
| `INDEXED_STABLE` | lane、顶点语义和索引在整个 clip/variant 中稳定 | 静态 index/UV + 每帧 position/color | 顶点最少，是简单大厅动画的默认路径 |
| `TRIANGLE_SOUP_DYNAMIC` | attachment、draw order、clipping 或 sequence 导致拓扑/UV 改变 | 每帧展开最终 triangle soup，并按 lane 容量补齐 | 覆盖最终视觉结果，不要求原始顶点一一对应 |
| `RUNTIME_FALLBACK` | lane、纹理、误差或变体数量超预算 | 保留官方 `sp.Skeleton` | 不静默降质 |

同一 SkeletonData 可以按 clip 选择不同路径，但要进入同一个 GPU Instancing batch，必须共享同一 layout 和静态 mesh。工具可把多个稳定 clip 打包进一个共同 layout；动态 clip 若容量差异过大，应拆为不同 layout，避免所有动画都按最坏情况浪费显存。

“骨骼矩阵纹理 + GPU 蒙皮”不作为默认后端。它对纯 weighted mesh 更省数据，但仍要重新实现 deform、attachment、clipping、draw order、slot blend 和约束后的语义，覆盖面反而低于采集官方 Runtime 最终顶点。以后可以作为经过 Analyzer 严格证明的第四种专项优化路径。

## 5. 转换流水线

### 5.1 输入与版本锁定

第一阶段输入 Creator 已导入的 `sp.SkeletonData`，支持 JSON、atlas 和多张 atlas page。二进制输入后续通过 Runtime 反射补齐静态分析，但逐帧采样本身不依赖 JSON。

每个产物记录：

- Cocos Creator 版本；
- Spine Runtime 版本和源数据 `skeleton.spine` 版本；
- skeleton、atlas 和 PNG 内容 hash；
- 转换 recipe hash；
- alpha mode、采样率和设备档位。

Spine 数据版本和 Runtime 小版本不匹配时直接阻止转换。4.2 与 3.8 使用不同转换 worker，不在同一 worker 中混用。

### 5.2 Alpha/PMA 判定

判定优先级：

1. recipe 显式指定 `straight` 或 `premultiplied`；
2. atlas 的 `pma` 元数据；
3. Texture Packer/导入元数据；
4. PNG 半透明像素启发式检查；
5. 仍有歧义时阻止转换，要求人工选择。

最终 alpha mode 同时控制官方采样组件、烘焙颜色语义和四种 VAT blend state。不能只改 shader 混合而不重新烘焙颜色。

### 5.3 静态分析

分析器先枚举：

- animations、skins、slots、bones 和 atlas pages；
- region、mesh、linked mesh、clipping、path、point、bounding box、sequence；
- IK、Transform、Path、Physics constraint；
- deform、attachment、draw order、event 和颜色 timeline；
- slot blend mode 和 two-color tint；
- 需要导出的 socket/bone 与碰撞数据。

静态分析只用于预测风险。最终是否可编译，以 Runtime 采样得到的渲染签名为准。

### 5.4 确定性采样

每个 clip/variant 都创建新的 REALTIME `sp.Skeleton`：

1. 设置 alpha mode、skin 和 setup pose；
2. 清空 AnimationState 和 Physics 状态；
3. 按 recipe 设置动画、轨道或预定义 mix；
4. Physics 动画按固定 `dt` warm up；
5. 使用固定 `1 / fps` 调用官方 Runtime；
6. 每帧调用 `updateRenderData()`，复制最终顶点、索引和有序 material segment；
7. 同步采集 event、指定 bone/socket 和碰撞数据。

采样区间包含动画起点，不重复导出循环动画的尾帧。默认 60 FPS，可为静态/慢动画降到 30 FPS，并允许逐 clip 设置。

### 5.5 Render Lane 编译

每帧都有一个有序材质序列：

```text
(atlasPage, blendMode, alphaMode)
```

工具为所有帧生成一个公共 Render Lane 超序列，使每帧的材质序列都能按原顺序嵌入。示例：

```text
frame 0: normal, additive, normal
frame 1:         additive, normal
lanes:   normal, additive, normal
```

第二帧的第一个 lane 写透明退化三角形。这样固定三次 Draw Call 就能保留两个帧的 attachment、draw order 和 blend 顺序。

每个 lane：

- 固定 atlas page、blend mode 和 alpha mode；
- 容量取映射到该 lane 的最大三角形数量；
- 每帧按最终 index 展开成 triangle soup；
- 未使用容量写三个位置完全相同、颜色为零的退化三角形；
- 每个 lane 独立 mesh，因此可突破单 mesh 的 `Uint16` 顶点上限。

公共超序列不要求最短，但必须确定、可复现，并受 `maxRenderLanes` 预算约束。若 draw order 变化导致 lane 数过多，则改用预编译 layout variant；仍超预算就回退官方 Runtime。

不能只依赖 `alpha=0` 隐藏空 lane。Cocos 的 multiply 使用 `DST_COLOR / ONE_MINUS_SRC_ALPHA`，screen 使用 `ONE` 或 `SRC_ALPHA / ONE_MINUS_SRC_COLOR`；在 straight alpha 下，零 alpha 但非零 RGB 仍可能改变目标颜色。零面积三角形保证不产生 fragment，才对四种 blend 都无副作用。

公共超序列按有序 material key `(atlasPage, blendMode, alphaMode)` 构建。M1 先用确定性的逐帧增量合并算法，不追求 NP-hard 的全局最短超序列；每次合并后立即计算 lane 数、最大三角形数和预计字节数，超过 recipe 预算就拆 layout，而不是继续生成不可控的大产物。

### 5.6 纹理布局

`spine-vat-2` 不再假设 `textureWidth == vertexCount`。所有 texel 使用线性地址，再根据设备档位分页：

```text
linear = frameOffset + frame * frameStride + vertexId
x = linear % textureWidth
y = floor(linear / textureWidth)
```

低端档默认按最大纹理尺寸 4096 规划，构建时再校验实际设备能力。

推荐三种数据档位：

| 档位 | Position/UV | Color | 用途 |
| --- | --- | --- | --- |
| `exact` | `RGBA32F` | light/dark `RGBA8` | 对照与疑难资源 |
| `balanced` | `RGBA16F`，误差超限自动回退 32F | light/dark `RGBA8` | 默认移动端 |
| `compact` | bounds 归一化后的定点位置 + UNORM UV | 按需通道 | 大量简单入口 |

编译器还应做通道裁剪：

- UV 全程不变时写入静态 mesh，不进 VAT；
- light 恒白时不生成 light texture；
- dark 全零时不生成 dark texture；
- 无帧插值要求时使用 nearest；需要平滑时 shader 采样相邻帧并插值。

所有压缩模式必须先解码回 CPU，与 `exact` 数据计算最大位置/UV/颜色误差，超过 recipe 阈值自动升级格式。

## 6. Runtime 设计

### 6.1 每实例独立状态

M3 已把材质 uniform 的共享动画时间改为 Cocos 自定义 Instanced Attribute，使同材质实例可以保持合批并独立播放：

```glsl
#if USE_INSTANCING
  in vec4 a_vatAnim0; // frameOffset, frameCount, fps, anchorEngineTime
  in vec4 a_vatAnim1; // anchorFrame, speed, loopMode, manualFrame
  in vec4 a_vatColor;
#endif
```

脚本通过 `MeshRenderer.setInstancedAttribute()` 更新每个实例。相同 VAT asset、layout、material 和 mesh 的对象，即使动画、相位、速度和颜色不同，也能进入同一 instancing batch。

实例属性只在播放状态变化或低频更新时间时写入；正常播放由 shader 根据全局时间与实例起始时间计算帧，不允许每帧给所有实例上传新顶点。

### 6.2 对外 API

建议提供与常用 Spine API 对齐的有限接口：

```ts
player.play(animation, { loop, speed, startTime });
player.pause();
player.seek(seconds);
player.setColor(color);
player.setSkinVariant(name);
player.crossFade(nextAnimation, duration);
player.onEvent(callback);
player.getSocketTransform(name);
```

`setSkinVariant` 只能选择已烘焙变体。`crossFade` 只有两个 clip 使用兼容 layout 时才能在 shader 中双帧采样；否则使用预烘焙 transition clip，或切换官方 Runtime。

其中“兼容 layout”还不够：只有拓扑和每个顶点的语义映射都一致，才能直接插值两组 VAT 顶点。动态 triangle soup 的顶点顺序可能只代表当帧三角形展开顺序，不能跨 clip 随意插值。需要与 Spine pose mix 一致时，必须烘焙 transition clip；双 Draw 的画面淡入淡出只能标记为近似模式，且会增加 Draw Call，也不保证 multiply/screen 与官方 pose mix 等价。

### 6.3 批次和渲染顺序

批次 key 至少包含：

```text
VAT asset + layout + lane + atlas page + blend/PMA technique
+ layer + priority + material defines
```

中间插入其他 Cocos Renderer 时，连续批次会被拆开；例如一批 VAT 中间穿插粒子，就会变成两批 VAT Draw Call。这与普通 GPU Instancing 一致。

透明实例不能假设自动排序。Cocos 官方文档也明确指出，同一 instancing batch 内的透明模型不会逐实例排序。因此：

- 大厅入口互不重叠时可以安全合批；
- VAT 实例明显重叠时，按前后层拆 batch；
- 需要严格逐角色透明排序时，关闭跨角色 instancing 或回退官方 Runtime。

## 7. 功能覆盖矩阵

| Spine 功能 | 官方 Runtime 采样 | 通用 VAT 方案 | 运行时限制 |
| --- | --- | --- | --- |
| bone、weighted mesh | 完整计算 | `LOSSLESS_VAT` | 无法运行时改骨骼 |
| deform/FFD | 最终顶点已包含 | `LOSSLESS_VAT` | 仅已烘焙动画 |
| IK/Transform/Path constraint | 最终顶点已包含 | `LOSSLESS_VAT` | target 不能运行时交互 |
| Physics constraint | Runtime 4.2 可计算 | 固定步长 + warm up 烘焙 | 外力、根节点交互需回退 |
| region/mesh/linked mesh | 完整输出 | `LOSSLESS_VAT` | 无动态创建 attachment |
| sequence attachment | UV/纹理页变化已输出 | Render Lane/多页 atlas | 只支持已烘焙 sequence |
| attachment timeline | 每帧最终 mesh 已反映 | lane padding | app 动态切换需 variant/回退 |
| clipping | Runtime 已输出裁剪后 mesh | triangle soup + lane padding | 顶点和内存可能显著增加 |
| draw order | 输出顺序已反映 | 公共 lane 超序列 | lane 数超预算则回退 |
| normal/additive/multiply/screen | Cocos 有精确 blend state | 四套 PMA/straight technique | lane/Draw Call 增加 |
| slot/skeleton/attachment color | 顶点 light 已包含 | light texture | 实例整体色可额外相乘 |
| two-color tint | light/dark 已包含 | 可选 dark texture | dark 全零时自动省略 |
| skin | 官方 Runtime 可切换 | `BAKED_VARIANT` | 只支持导出的 skin 组合 |
| event/audio timeline | 可监听或读取 | `HYBRID` CPU event table | 不由 GPU 自动回调 |
| socket/bone follower | 可采样 bone world transform | `HYBRID` 压缩轨道 | 只导出指定 bone |
| bounding box/hitbox | 可读取 attachment | `HYBRID` 多边形/AABB 轨道 | 高频复杂碰撞可能不划算 |
| 多轨叠加和任意 mix | Runtime 可计算指定 recipe | 预烘焙组合/transition | 任意组合会指数膨胀 |
| 运行时换装/setAttachment | 官方 Runtime 支持 | 预编译 variant | 任意动态换装回退 |
| vertex effect | Cocos 4.2 路径不能假定完整支持 | 默认 `RUNTIME_FALLBACK` | 只有同帧对照验证通过的固定 effect 才允许烘焙 |

## 8. 双后端与自动回退

建议最终组件不是单一 `VatRenderer`，而是统一的 `SpineOptimizedPlayer`：

1. `AUTO`：读取兼容性报告，优先 VAT，不兼容时官方 Runtime。
2. `VAT`：只允许已验证 clip/variant，失败立即报错。
3. `RUNTIME`：始终使用 `sp.Skeleton`。
4. `FLIPBOOK`：可选的图片序列后端，只用于固定分辨率且材质语义允许的资源。

允许同一 SkeletonData 按动画选择后端。例如大厅 idle 使用 VAT，点击后需要换装、socket 或复杂混合的交互动画切回 Runtime。正式包可按资源决定是否保留源 SkeletonData，避免为了降级重复占用内存。

## 9. `spine-vat-2` Manifest 草案

```ts
interface SpineVatManifestV2 {
  format: 'spine-vat-2';
  source: SpineVatAnalysisReport['source'];
  alphaMode: 'straight' | 'premultiplied';
  textureProfile: 'exact' | 'balanced' | 'compact';
  channels: { light: boolean; dark: boolean };
  pageTexels: number;
  texturePages: Array<{
    semantic: 'position' | 'uv' | 'light' | 'dark';
    path: string;
    size: [number, number];
    format: string;
  }>;
  atlasPages: Array<{ id: string; path: string }>;
  layouts: Array<{
    id: string;
    frameStride: number;
    bounds: [number, number, number, number];
    lanes: Array<{
      atlasPage: number;
      textureId: string;
      blendMode: 'normal' | 'additive' | 'multiply' | 'screen';
      vertexOffset: number;
      vertexCapacity: number;
      logicalLane: number;
      geometryMode: 'indexed-stable' | 'triangle-soup-dynamic';
    }>;
  }>;
  variants: Array<{ name: string; skins: string[]; layout: string }>;
  clips: Array<{
    name: string;
    variant: string;
    fps: number;
    duration: number;
    frameOffset: number;
    frameCount: number;
    layout: string;
    events?: Array<{
      time: number;
      name: string;
      intValue?: number;
      floatValue?: number;
      stringValue?: string;
      audioPath?: string;
      volume?: number;
      balance?: number;
    }>;
    sockets?: Array<{
      name: string;
      frames: Array<[number, number, number, number, number, number]>;
    }>;
  }>;
  compatibility: {
    level: 'LOSSLESS_VAT' | 'BAKED_VARIANT' | 'HYBRID' | 'RUNTIME_FALLBACK';
    warnings: string[];
    estimatedGpuBytes: number;
    drawCallsPerBatch: number;
  };
}
```

Manifest 必须可独立判断运行条件，Native 不应再次解析 Spine JSON 才知道如何渲染。

## 10. 编辑器工具界面

建议作为 Creator 3.8.7 Editor Extension 提供三个步骤：

### Analyze

- 选择 SkeletonData；
- 显示版本、动画、skin、atlas page、PMA 和功能清单；
- 对每个 clip 输出 topology/material 签名、预计 lanes、纹理字节和兼容等级；
- 风险项必须给出具体动画和帧号。

### Preview

- 左侧官方 `sp.Skeleton`，右侧 VAT；
- 同一个帧滑块和同一背景；
- 切换 PMA、skin、clip 和设备纹理格式；
- 支持 difference heatmap、SSIM/PSNR 和透明边缘放大。

### Bake

- 选择动画、skin variant、FPS、socket、压缩档位和预算；
- 生成 `manifest.spinevat`、数据 bin、静态 mesh 和兼容性报告；
- 支持批量转换与 CI 命令；
- 源 hash 没变化时跳过重烘焙。

### Creator 资产导入

- Runtime 包只交付完整的 `spine-vat-importer` 扩展，扩展内提供 `spinevat.SkeletonData extends cc.Asset`、`spinevat.Skeleton extends MeshRenderer`、Importer、Inspector 和 Effect；
- 用户把完整导出目录拖入 `assets/` 后，只操作 `manifest.spinevat`，不再手工维护 bin 与 atlas 数组；
- importer 仅在 JSON 的 `format` 等于 `spine-vat-2` 时接管，普通 JSON 和 Spine Skeleton JSON 保持原 importer；
- Library 顶层必须序列化为 `__type__: "spinevat.SkeletonData"`，依赖字段使用 `BufferAsset`、`Texture2D` 与 `EffectAsset` UUID 引用，使编辑器预览、Web 和 Native 构建都能收集依赖；
- Creator 3.8.7 的项目扩展晚于 AssetDB worker 初始化，扩展需通过 worker bootstrap 同步注册 handler 和同名资产类；仅在主进程声明 `asset-handler` 不足以把已有 JSON 转成强类型资产；
- 一个 `spinevat.Skeleton` 对应当前节点上的一个实例，多 Lane 使用单 Mesh 的多个 SubMesh；相同 `SkeletonData` 的组件共享 GPU 资源并保留独立播放状态；
- 成功不能只看 importer/type，还必须确认 `imported=true` 且 Library 中存在 `.json`。缺少 manifest 引用文件时保留 `spinevat.SkeletonData imported=false` 并输出具体缺失路径。

## 11. 验收标准

### 画面

- 官方与 VAT 固定同帧截图，覆盖首帧、尾帧、所有 attachment/draw-order key 前后帧和均匀采样帧；
- 默认要求 alpha 加权 PSNR >= 40 dB、SSIM >= 0.995；阈值可按像素风/高清资源配置；
- normal/additive/multiply/screen、PMA/straight、clipping 和 two-color tint 分别有测试资源；
- Web 与 Android 至少各跑一次真实 GPU 对照。

### 数据

- 每帧材质序列都能嵌入 manifest layout；
- 未使用 lane 必须是零面积退化三角形，并同时把 light/dark 写为零；
- 纹理尺寸不超过设备 profile；
- 压缩误差、GPU 字节、Draw Call 和变体数量超预算时构建失败，而不是静默降质。

### 性能

- 独立相位的 20/30 实例仍产生真实 `GPU Instances`；
- Draw Call 约等于可见连续 VAT batch 数乘 lane 数；
- 对正式低端机记录 FPS、P95、CPU、Renderer/Present、PSS、温升和功耗；
- 同时与 `SHARED_CACHE + enableBatch` 对照，不能只与 REALTIME 比。

## 12. 实施顺序

### M1：Analyzer 与格式 v2

- [x] 4.2 JSON/atlas 多页分析；
- [x] PMA 声明判定与人工覆盖；
- [x] 全动画 Runtime dry-run；
- [x] 输出兼容性报告和内存/Draw Call 估算；
- [ ] PNG 半透明像素 PMA 启发式和 Creator Editor 面板；
- [ ] binary 静态反射、多 skin recipe 和 Physics warm-up。

### M2：通用视觉编译

- [x] Straight/PMA × normal/additive/multiply/screen 八套 technique；
- [x] 公共 Render Lane 超序列与重复材质 Lane；
- [x] 直接采集原始 SkeletonData，保留 clipping、attachment 和 draw order 的最终几何；
- [x] 多 atlas page 映射、线性纹理分页和可选 dark/light 通道；
- [x] `spine-vat-2` manifest/binary 导出与 Web Renderer；
- [x] `tuan42` 和水果机复杂 Spine 的固定帧像素对照；
- [ ] `INDEXED_STABLE`、RGBA16F/定点压缩、真实多 atlas/PMA 资产与 Native 真机回归。

### M3：通用播放器

- [x] 每实例动画、相位、速度和颜色；
- [x] play/pause/resume/seek/loop/manual frame；
- [x] 20 个实例独立状态下保持 GPU Instancing 的 Web 自动回归；
- [x] event 和指定 socket 的 HYBRID CPU 轨道；
- [x] 指定 socket 的 Web 与 Android Native 离线 manifest 回归；
- [ ] 真实 event 资产、socket follower 组件和二进制/量化压缩；
- layout 兼容的双帧 crossfade。

### M4：编辑器与自动回归

- Analyze/Preview/Bake 面板；
- 同帧截图和像素差测试；
- Web/Android 设备 profile；
- 官方 Runtime 自动回退。

### M5：扩展项

- Spine 3.8 独立 worker；
- binary 静态特征反射；
- skin 组合去重；
- flipbook 后端；
- 运行时按可见性、距离和性能预算切换后端。

## 13. 当前 PoC 迁移要求

现有 `createVatCompatibleSkeletonData()` 会删除 clipping 和 draw order，并修补特定 attachment，只能保留为实验兼容路径。通用工具必须：

- 默认使用原始 SkeletonData；
- 用 Runtime 最终顶点保留 clipping；
- 用 Render Lane 编译处理 draw order 和材质变化；
- 移除水果机资源名、slot 名和固定 bounds；
- [x] 将当前全局材质时间改为每实例属性；
- 从单 atlas、normal/additive 扩展到多 atlas 和四种混合；
- 用 manifest 驱动 shader，不在代码里硬编码帧数和裁剪框。

## 14. 资料

- [Spine 官方 Runtime 4.2 源码](https://github.com/EsotericSoftware/spine-runtimes/tree/4.2)
- [Spine 官方命令行说明](https://esotericsoftware.com/spine-command-line-interface)
- [Spine 官方导出说明](https://esotericsoftware.com/spine-export)
- [Spine Runtime Guide](https://esotericsoftware.com/spine-runtimes-guide)
- [Cocos Creator 3.8 GPU Instancing](https://docs.cocos.com/creator/3.8/manual/en/engine/renderable/model-component.html#instancing-batching)
- [Cocos Creator 3.8 自定义 Instanced Attributes](https://docs.cocos.com/creator/3.8/manual/en/shader/instanced-attributes.html)

# Spine 转 VAT 工具总体设计

状态：已实现
摘要：分工：官方 Spine Runtime 负责求值，自研部分负责编译、打包和播放。另含官方能力调查、兼容等级、功能覆盖矩阵，以及尚未实现的部分。
何时读：想了解工具链为什么这样分层、某个 Spine 功能能不能走 VAT 时。数据格式见 [总览](spine-vat-overview.md)。
依赖：无

> 目标：Cocos Creator 3.8.7 + Spine 4.2.x。官方 Spine Runtime 负责动画求值，自研部分只负责编译最终渲染数据、打包和播放。

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
Spine JSON + atlas（Creator 导入为 sp.SkeletonData）
  -> Analyzer：静态分析 + 官方 Runtime 逐帧试跑 → 兼容等级、估算
  -> Compiler：原骨骼 / 去剪裁骨骼同步采样 → 固定槽位 + 剪裁区 + 静态区 → 分页
  -> manifest.spinevat + position/light/dark-N.bin（+ 图集 PNG）
  -> 扩展导入器 → spinevat.SkeletonData
  -> spinevat.Skeleton（3D，GPU instancing）/ spinevat.UiSkeleton（2D，UI batch）
```

| 环节 | 位置 | 文档 |
|---|---|---|
| Analyzer | `assets/bake/SpineVatAnalyzer*.ts` | [spine-vat-analyzer](spine-vat-analyzer.md) |
| Compiler | `assets/bake/SpineVat{Baker,FixedBaker,FixedLayout,CompilerV2}.ts` | [spine-vat-compiler](spine-vat-compiler.md) |
| 导入器 + Player | `extensions/spine-vat-importer/` | [spine-vat-player](spine-vat-player.md) |

烘焙只在 Creator Web/WASM 里跑，由烘焙场景驱动，浏览器里导出结果；Native 端只加载产物。

「骨骼矩阵纹理 + GPU 蒙皮」不作为后端：对纯 weighted mesh 来说它的数据更省，但 deform、attachment、clipping、draw order、slot blend 和约束的语义都得重新实现一遍，能覆盖的功能反而比直接采集官方 Runtime 的最终顶点少。

## 5. 功能覆盖矩阵

| Spine 功能 | 现状 | 限制 |
| --- | --- | --- |
| bone、weighted mesh、deform/FFD | 支持（最终顶点已包含） | 只能播放烘焙过的动画 |
| IK / Transform / Path 约束 | 支持 | target 不能在运行时交互 |
| Physics 约束 | 按固定步长烘焙 | 没有预热；外力、根节点交互不支持 |
| region / mesh / linked mesh | 支持 | 不能动态创建附件 |
| sequence attachment | 同一 atlas page 内支持（每帧存 uv） | 换 page 属于「材质逐帧变化」，烘焙时报错 |
| attachment 时间轴 | 支持：一个 `(slot, 附件名)` 占一个固定槽位，没画出来的帧退化 | — |
| clipping | 支持：GPU 逐像素剪裁 | 多边形 ≤ 8 点；一个附件只能归一个剪裁 |
| draw order 时间轴 | 不支持，烘焙时报错 | 需要改资源 |
| normal / additive / multiply / screen | 支持：straight / PMA 各 4 套 technique；2D 的 normal 与 additive 合成一套 | — |
| slot / attachment 颜色 | light 贴图（RGB 恒白时只存 alpha） | 实例整体颜色可以再乘上去 |
| two-color tint | dark 贴图（全零时省掉） | — |
| skin | 只烘默认 skin | 不能运行时换装 |
| event | `HYBRID`：manifest 里存事件表，CPU 派发 | — |
| socket | `HYBRID`：指定骨骼的逐帧仿射矩阵 | 烘焙驱动还没提供参数 |
| bounding box / 碰撞 | 未实现 | — |
| 多轨叠加、mix / crossfade | 未实现，切动画是硬切 | — |
| vertex effect | 不支持 | — |

## 6. 未实现 / 开放问题

- **自动回退**：`RUNTIME_FALLBACK` 的资源或动画目前只是不烘，运行时不会自动改用官方 `sp.Skeleton`，由业务自己选组件。
- **压缩档位**：`balanced`（RGBA16F）和 `compact`（定点）只停留在 Analyzer 的估算里，产物一律是 `exact`。
- **多 skin**、`.skel` 输入、Physics 预热、PNG 半透明像素的 PMA 启发式判断。
- **crossfade**：固定槽位下各动画顶点一一对应，可以在 shader 里对两帧做混合。
- **编辑器面板**（Analyze / Preview / Bake）、CI 批量烘焙、按源文件 hash 做增量。
- **真实 PMA / 多 atlas / multiply / screen 资产的像素对照**：technique 都已实现，但只有 straight 单页的资源实测过。

## 7. 资料

- [Spine 官方 Runtime 4.2 源码](https://github.com/EsotericSoftware/spine-runtimes/tree/4.2)
- [Spine 官方命令行说明](https://esotericsoftware.com/spine-command-line-interface)
- [Spine 官方导出说明](https://esotericsoftware.com/spine-export)
- [Spine Runtime Guide](https://esotericsoftware.com/spine-runtimes-guide)
- [Cocos Creator 3.8 GPU Instancing](https://docs.cocos.com/creator/3.8/manual/en/engine/renderable/model-component.html#instancing-batching)
- [Cocos Creator 3.8 自定义 Instanced Attributes](https://docs.cocos.com/creator/3.8/manual/en/shader/instanced-attributes.html)

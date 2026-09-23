# Cocos Creator 3.8.7 Spine Runtime 与 VAT 验证汇总报告

> 日期：2026-09-20 至 2026-09-21  
> 目标场景：水果机大厅同屏约 20 个 Spine 入口  
> 验证版本：Cocos Creator 3.8.7、Spine 3.8.99 / 4.2.43  
> 当前状态：源码分析、PoC 和中低端实体机对照完成；VAT 已有条件立项依据，尚未达到正式上线条件

## 1. 结论摘要

| 问题 | 结论 |
| --- | --- |
| 3.8.7 的实例内存如何组成？ | `SkeletonData`、atlas 和 runtime 定义按资源共享；每个实例主要保留动画状态、姿态和 `RenderData`。轻量资源实测 20 个实例增加约 4.65-5.35 MB Native PSS，约 0.23-0.27 MB/实例。 |
| 缓存模式是否启动时按全部动画一次性开最大内存？ | 不是。`SHARED_CACHE` 按动画 clip 懒创建，并随实际播放进度逐帧生成缓存；已经播放过的多个 clip 会累积，因此最终可能接近“所有已缓存动画之和”。 |
| 渲染提交是否预先按最大顶点数开一块大数组？ | 稳定播放时会复用已经扩容的 `RenderData`/MeshBuffer，但不是按全部动画的理论最大值一次性预分配。缓存模式的主要新增内存是每个已缓存帧的顶点、索引、骨骼快照和分段信息。 |
| `enableBatch` 是否等于 GPU Instancing？ | 不是。它只控制 2D middleware 合批，仍然存在每实例动画更新或缓存帧复制，不会自动创建 instance buffer。 |
| VAT 是否有效？ | 有效。两台 OPPO 实体机均复现：20 个复杂实例中 `SHARED_CACHE` 约 54-55 FPS，VAT 约 60 FPS；VAT 稳定把平均 Draw Call 从约 23 降到 6，并在 30 实例压力点保持约 60 FPS。CPU 收益依设备差异较大，K9x 约下降 58%，CPH2823 约下降 14%。 |
| VAT 是否应该立即上线？ | 不能直接全量上线，但复杂固定拓扑资源已有专项立项依据。还需把真实大厅资源、UI/粒子/脚本负载、不同 VAT 纹理总量、功耗和温升纳入验收。 |

当前推荐方案：

```text
共享同一份 SkeletonData
  + SHARED_CACHE
  + enableBatch=true
  + 尽量统一 atlas / material / blend / layer
```

VAT 保留为专项优化方案：先用官方缓存路径测真实大厅；若 60 FPS/P95 或 CPU 余量不达标，并且资源满足固定拓扑约束，再进入 VAT 产品化。

## 2. 验证背景

本次验证面向水果机大厅约 20 个 Spine 入口，聚焦以下问题：

1. Creator 3.8.7 的 Spine 资源、实例状态、动画缓存和渲染缓冲分别如何分配与复用。
2. `REALTIME`、`SHARED_CACHE`、`PRIVATE_CACHE` 的 CPU、内存和功能差异。
3. 官方 Spine 的合批能否解决大厅约 20 个入口的问题。
4. 论坛 VAT 方案能否把骨骼计算迁出主线程，并通过 GPU Instancing 降低 CPU 和 Draw Call。
5. VAT 在什么条件下才值得承担开发与功能裁剪成本。

本报告只描述 Creator 3.8.7 的当前实现和测试结果。

## 3. Spine Runtime 的内存与播放原理

### 3.1 共享资源与独立实例

一组 Spine 实例可以拆成两层：

| 层级 | 内容 | 生命周期 |
| --- | --- | --- |
| 资源/定义层 | 骨骼、slot、skin、attachment、动画定义、atlas、纹理 | 同一份 `SkeletonData` 可共享 |
| 实例/状态层 | 当前轨道、混合时间、骨骼姿态、slot 颜色、当前 attachment、事件状态 | 每个可独立控制的实例各自持有 |

因此，创建 20 个 `sp.Skeleton` 不等于解析 20 份 JSON 或上传 20 份 atlas；但实时模式仍需为 20 个实例分别推进动画和生成顶点。

### 3.2 三种官方播放模式

| 模式 | 每帧工作 | 内存行为 | 适用场景 |
| --- | --- | --- | --- |
| `REALTIME` | 每实例计算 AnimationState、骨骼/约束、attachment 和顶点，再复制到 Cocos 渲染缓冲 | 不保存完整动画帧，CPU 与实例数近似线性增长 | 需要换装、混合、事件和完整 Spine 能力 |
| `SHARED_CACHE` | 第一次播放时按 60 FPS 烘焙；之后多个实例读取同一资源/动画的缓存帧 | 按 clip 懒创建、按播放进度增长；同资源实例共享 | 多个实例播放相同或少量简单动画 |
| `PRIVATE_CACHE` | 与缓存模式相同，但每个组件独占缓存 | 帧缓存按实例增长 | 必须独立 skin/缓存生命周期的特殊情况 |

`SHARED_CACHE` 的准确分配顺序是：

```text
第一次 setAnimation(clip)
  -> 为该 clip 创建空 AnimationCache
  -> 生成首帧
  -> 播放推进时继续追加帧
  -> 已播放 clip 的缓存继续常驻并供同 SkeletonData 实例共享
```

它不会在切换缓存模式时，把 `SkeletonData` 中全部动画一次性烘焙成一块总内存。但如果业务依次预热所有动画，最终常驻量确实会接近所有 clip 缓存之和：

```text
缓存内存 ≈ 帧数 ×（顶点数据 + 索引数据 + 骨骼快照 + draw segment 元数据）
```

### 3.3 渲染缓冲与 GPU 内存

`REALTIME` 的主要数据流：

```text
Spine Runtime 计算顶点/索引
  -> Cocos RenderData / MeshBuffer
  -> GPU vertex/index buffer
```

缓存模式在中间多出 `AnimationCache.frames[]`，每帧保存顶点、索引、骨骼快照和渲染分段。播放时仍需把当前缓存帧复制到组件的 `RenderData`。

`RenderData` 在容量不足时扩容，稳定后复用已有容量；没有发现“按所有动画中最大顶点数，为每个实例启动时一次性开满”的逻辑。atlas 纹理只要引用同一纹理资源即可共享，也不会按实例重复上传。

## 4. `enableBatch` 与 GPU Instancing 的区别

`sp.Skeleton` 属于 2D `UIRenderer` 路径。`enableBatch=true` 只是在纹理、材质、layer、mesh buffer 和索引连续等条件一致时合并提交：

- 可以减少 Draw Call 和状态切换；
- 不会省掉每实例的骨骼求值；
- 不会省掉实时顶点生成或缓存帧复制；
- 不会创建每实例 transform/time 的 instance buffer。

真正的 GPU Instancing 需要走自定义 `MeshRenderer + Material + Shader`：静态 mesh 保存 UV/索引，VAT 保存各动画帧的顶点数据，每个实例只提交 transform、时间、颜色等少量参数。

## 5. 测试资源与采集口径

### 5.1 资源

| 资源 | 用途 | 主要特征 |
| --- | --- | --- |
| `spineboy-pro` 3.8.99 | 基础 Runtime/缓存/合批基线 | 64 bones、52 slots、11 个动画 |
| `tuan` 4.2.43 | 复杂资源与 VAT 对照 | 26 bones、17 slots、46 attachments、4 meshes，含 IK/Transform/Path/Physics |

当前 `tuan42` VAT 数据：

- 120 帧、296 顶点、1200 索引；
- position/light/dark 纹理净数据 852,480 B，约 0.81 MB；
- normal/additive 两个渲染组；
- 20/30 个逻辑实例对应 40/60 个 GPU Instances。

### 5.2 指标

测试不只看瞬时 FPS，同时采集：

- 引擎 FPS、P50、P95、超过 25 ms 的帧占比；
- SurfaceFlinger 实际呈现帧间隔；
- Cocos Renderer、Present、Draw Call、GPU Instances、Triangles；
- Android 进程 CPU；
- Total PSS、RSS、Native PSS；
- GFX Texture/Buffer Memory、logcat 和可见截图。

Draw Call 同时记录当前值、5 秒平均值和5秒峰值，避免把某一帧的 HUD 或历史峰值误认为稳态值。

## 6. Android 测试结果

### 6.1 轻量资源：20 实例内存基线

低端 AVD 中，0 实例基线仍加载同一份 `SkeletonData` 和 atlas。创建 20 个轻量 Spine 后：

- Native PSS 增量约 4.65-5.35 MB；
- 平均约 0.23-0.27 MB/实例；
- GFX Texture Memory 约 3.72 MB；
- GFX Buffer Memory 约 2.44-2.47 MB；
- 实例增量与共享资源、动画状态和渲染数据的源码模型一致。

需要注意：PSS 是整个进程的比例集大小，包含引擎、V8、共享页、匿名映射和原生库，不能把整进程 PSS 直接除以 Spine 数量。

### 6.2 复杂资源：低端 AVD，20 实例

| 模式 | CPU | 引擎 FPS | 引擎 P95 | 峰值 Draw Call | Native PSS |
| --- | ---: | ---: | ---: | ---: | ---: |
| `REALTIME` | 57.8% | 39.03 | 42.62 ms | 44 | 44.8 MB |
| `SHARED_CACHE` | 43.7% | 59.03 | 18.90 ms | 44 | 50.3 MB |
| VAT | 41.6%-50.6% | 56.94-57.71 | 20.26-21.03 ms | 6 | 40.1-43.6 MB |

在该 AVD 中，`SHARED_CACHE` 已经接近 60 FPS，并且 FPS/P95 优于 VAT。VAT 的确定收益主要是提交量和部分 Native PSS，而不是 20 实例的帧率。

### 6.3 远端 ARM64/Mali 对照，20 实例

| 模式 | 引擎 FPS | 引擎 P95 | CPU | 5 秒平均 Draw Call | 峰值 | GPU Instances | Native PSS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `REALTIME` | 15.99-16.30 | 69.75-72.79 ms | 97.2%-98.6% | 22.60-25.71 | 44 | 0 | 53.2-60.6 MB |
| `SHARED_CACHE` | 37.72-39.34 | 36.80-38.15 ms | 76.6%-88.8% | 22.47-25.03 | 44 | 0 | 56.5-57.2 MB |
| VAT | 36.02-40.41 | 37.15-38.35 ms | 30.6%-30.8% | 5.95-6.00 | 6 | 40 | 51.6-52.1 MB |

该环境中的关键观察：

- `SHARED_CACHE` 相比 `REALTIME` 将 FPS 提高约 2.4 倍；
- VAT 与 `SHARED_CACHE` 的 FPS/P95 区间重叠，没有稳定帧率优势；
- VAT 将 CPU 降低约 46-58 个百分点；
- VAT 将平均 Draw Call 降低约 73%-76%，峰值降低约 86%；
- VAT 增加到 30 实例后仍为 6 Draw Call、60 GPU Instances、29.1% CPU，证明 instancing 路径生效；
- Renderer 约 6-8 ms、Present 约 13-25 ms，瓶颈已偏向 GPU/Present/云端合成，释放 CPU 没有稳定转化为更高 FPS。

该设备上报的 SoC 与 GPU 信息互相矛盾，温控使用测试传感器，疑似云手机或属性伪装环境。因此它可验证 ARM64/Mali/GLES 路径和相对差异，不能代替印度目标档实体低端机的绝对 FPS、功耗和温升数据。

### 6.4 OPPO K9x 5G 实体机对照

实体机为 Android 13、Dimensity 810、Mali-G57 MC2、约 8 GB RAM、1080x2400，应用运行时为 60 Hz。首次测试中 20 个 `tuan42` 实例各采两轮：

| 模式 | 引擎 FPS | 引擎 P95 | CPU | 5 秒平均 Draw Call | 峰值 | GPU Instances | Native PSS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `REALTIME` | 18.33-18.47 | 60.06-60.26 ms | 110.2%-112.6% | 22.80 | 44 | 0 | 61.4-63.8 MB |
| `SHARED_CACHE` | 54.91-54.94 | 19.01-20.75 ms | 116.0%-117.0% | 22.80-23.23 | 44 | 0 | 57.2 MB |
| VAT | 59.94-60.58 | 16.71-16.77 ms | 48.6%-50.6% | 6.00 | 6 | 40 | 44.0-48.4 MB |

30 实例压力点：

| 模式 | 引擎 FPS | 引擎 P95 | CPU | 5 秒平均 Draw Call | 峰值 | GPU Instances |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `SHARED_CACHE` | 40.48 | 28.17 ms | 113.0% | 32.19 | 64 | 0 |
| VAT | 60.37 | 16.76 ms | 53.8% | 6.00 | 6 | 60 |

这组实体机数据改变了模拟器阶段的判断：VAT 在复杂资源上不只是降低提交量，还能稳定补足帧率并显著释放 CPU。20 实例时 FPS 提升约 9.7%，CPU 降低约 57%；30 实例时 FPS 提升约 49%，而 Draw Call 仍固定为 6。`SHARED_CACHE` 的 CPU 高于 `REALTIME` 是因为它输出了约 3 倍帧数，不能解释为缓存路径每帧更重。

测试从 15% 电量、约 33.2 C 开始，到 23%、约 36.0 C 结束，全程 USB 充电且省电模式关闭。该温升混有充电影响，只能确认没有短时严重热降频，不能代替受控功耗/温升实验。

2026-09-21 又在 100% 电量、28.0 C 起始条件下复测，同一套有效样本从开始到结束仍为 100%，结束温度约 31.5 C。20 实例各两轮：

| 模式 | 引擎 FPS | 引擎 P95 | SF FPS | SF P95 | CPU | 平均 Draw Call | 峰值 | GPU Instances | Native PSS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `REALTIME` | 18.22-18.45 | 59.54-60.29 ms | 18.49-18.66 | 71.94-71.97 ms | 106.0%-106.2% | 22.38-25.33 | 44 | 0 | 58.1-58.2 MB |
| `SHARED_CACHE` | 54.52-54.78 | 19.30-19.72 ms | 54.49-54.85 | 33.23-33.25 ms | 117.2%-117.8% | 23.15-24.29 | 44 | 0 | 56.9-57.5 MB |
| VAT | 59.70-60.67 | 16.75-17.03 ms | 59.67-60.15 | 16.67 ms | 49.8% | 6.00 | 6 | 40 | 43.3-45.4 MB |

满电 30 实例压力点中，`SHARED_CACHE` 为 41.57 FPS / P95 26.74 ms / SF P95 33.27 ms，VAT 为 60.44 FPS / P95 16.81 ms / SF P95 16.68 ms。VAT 仍保持 6 Draw Call 和 60 GPU Instances。

满电与首次测试的 20 实例 FPS 差异不到约 1%，证明首次 15% 电量没有造成可测的结论偏差。满电两轮还进一步证明：`SHARED_CACHE` 的引擎 P95 虽约为 19.5 ms，但实际 SurfaceFlinger P95 稳定在约 33.24 ms；VAT 的 SurfaceFlinger P95 为约 16.67 ms，确实把周期性丢帧提升为稳定 60 Hz 呈现。

### 6.5 OPPO CPH2823 / Android 16 实体机复测

第二台实体机为 OPPO `CPH2823`，Android 16 / API 36、MediaTek MT6835、Mali-G57 MC2、约 3.53 GiB 可用内存、720x1570。桌面为 120 Hz，Cocos 应用运行时自动切到 60 Hz。使用与 K9x 完全相同 SHA-256 的两个 ARM64 APK，20 实例各两轮：

| 模式 | 引擎 FPS | 引擎 P95 | SF FPS | SF P95 | CPU | 平均 Draw Call | 峰值 | GPU Instances | Native PSS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `REALTIME` | 18.39-20.78 | 53.76-61.62 ms | 18.27-20.82 | 50.10-66.75 ms | 115.2%-116.0% | 22.04-22.14 | 44 | 0 | 45.3-52.0 MB |
| `SHARED_CACHE` | 54.02-55.03 | 19.86-20.15 ms | 55.27-55.68 | 33.17-33.24 ms | 136.2%-138.0% | 22.70-23.09 | 44 | 0 | 49.5-52.8 MB |
| VAT | 60.00-60.05 | 16.95-17.09 ms | 60.13-60.14 | 16.84-16.87 ms | 117.0%-118.6% | 6.00 | 6 | 40 | 37.9-38.4 MB |

30 实例压力点：

| 模式 | 引擎 FPS | 引擎 P95 | SF FPS | SF P95 | CPU | 平均 Draw Call | 峰值 | GPU Instances | Native PSS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `SHARED_CACHE` | 39.56 | 30.92 ms | 39.10 | 33.44 ms | 126.0% | 31.93 | 64 | 0 | 51.0 MB |
| VAT | 60.23 | 16.89 ms | 59.66 | 16.91 ms | 117.7% | 6.00 | 6 | 60 | 42.0 MB |

20 实例按两轮均值比较，VAT 相比 `SHARED_CACHE`：引擎 FPS 提升约 10.1%，P95 降低约 14.9%，进程 CPU 降低约 14.1%，平均 Draw Call 降低约 73.8%。30 实例时 FPS 提升约 52.2%，P95 降低约 45.4%，平均 Draw Call 降低约 81.2%，但 CPU 只下降约 6.6%。这说明 VAT 稳定解决了帧率和提交瓶颈，但 CPU 收益不能从 K9x 直接外推到所有 Mali-G57 设备。

Android 16 的 `SurfaceFlinger --list` 会把层名包装为 `RequestedLayerState{...}`；旧脚本只能得到刷新周期、拿不到呈现时间戳。本次已修复脚本并覆盖重采全部 8 个有效样本。所有样本均为 300 引擎帧，截图存在，错误日志扫描为空。测试从 100%、30.7 C 开始，到 100%、34.5 C 结束，全程 USB 连接；该温升仍不能代替电池供电下的功耗实验。

## 7. Web 对照结果

Web 构建在 Headless Chromium 软件 GPU 环境运行，只用于验证路径和相对趋势：

| 实例数 | 模式 | FPS | P95 | 峰值 Draw Call | GPU Instances |
| ---: | --- | ---: | ---: | ---: | ---: |
| 20 | `REALTIME` | 4.72 | 297.0 ms | 44 | 0 |
| 20 | `SHARED_CACHE` | 4.85 | 294.5 ms | 44 | 0 |
| 20 | VAT | 9.09 | 192.3 ms | 6 | 40 |
| 30 | `REALTIME` | 3.55 | 393.8 ms | 64 | 0 |
| 30 | `SHARED_CACHE` | 3.45 | 386.2 ms | 64 | 0 |
| 30 | VAT | 6.72 | 200.1 ms | 6 | 60 |

VAT 在软件渲染环境约为官方路径的 1.9 倍 FPS，说明离线数据、VAT 纹理、两个 blend 组和 GPU Instancing 链路能够运行。但软件 GPU 结果不能外推为移动真机收益。

### 7.1 水果机资源视觉还原复测（2026-09-21）

`FruitMachinePart` 男舞者 atlas 没有声明 `pma:true`，PNG 半透明像素也符合非预乘 Alpha 特征。因此本资源统一按非预乘路径处理：官方 `sp.Skeleton.premultipliedAlpha=false`，VAT 烘焙同样关闭预乘，VAT shader 的 normal 组使用 `SRC_ALPHA / ONE_MINUS_SRC_ALPHA`，additive 组使用 `SRC_ALPHA / ONE`。

重新烘焙后的数据为 120 帧、每帧 3165 个顶点，三张 VAT 纹理净数据共 9,115,200 字节；半透明顶点颜色保持非预乘语义，当前动画的 `dark.bin` 全 0。Web 对照页把官方 Spine 和 VAT 同时固定在第 0、30、60、90 帧检查，人物肤色、绿色背景、明暗变化和半透明边缘一致，未见灰暗、过曝或黑边，浏览器控制台也没有 shader/VAT 错误。

此前单张截图出现一边偏暗、一边偏亮，是 PMA 配置不一致与截图动画相位不一致共同造成，不能作为渲染错误或显存不足的证据。当前 PoC 只保证这套非预乘资源显示正确；PMA 自动识别、按 atlas 自动选择混合状态留到通用 VAT 阶段实现。

### 7.2 通用播放器 M3：每实例独立状态

M3 使用 Creator 3.8.7 的 `MeshRenderer.setInstancedAttribute()`，把动画、相位、速度、loop、manual frame 和整体色移入每实例数据。水果机 20 实例 Web 真运行中，实例轮流使用三个动画和不同相位/速度，其中 3 个暂停，共出现 20 个不同当前帧；渲染仍为 4 个 Render Lane、80 GPU Instances、8 Draw Call，没有退化为逐实例提交。

本轮浏览器使用 Intel 集显 D3D11 ANGLE，不是软件 GPU。自动回归同时验证播放实例在 500 ms 内推进、暂停实例保持原帧，截图没有全黑或破面。

同一份 `spine-vat-2` 离线数据随后构建为 Creator 3.8.7 Android x86_64 APK，在 Android 14 / GLES3 / Google SwiftShader 模拟器上运行。Native 结果仍为 20 个逻辑实例、4 个 Lane、80 GPU Instances、固定 8 Draw Call；暂停索引 `0 / 9 / 18` 两秒后帧号不变，其他实例独立推进。引擎窗口为 58.80 FPS / P95 18.75 ms，SurfaceFlinger 为 59.48 FPS / P95 18.268 ms；没有 VAT、JSB、shader 或 JavaScript 错误。

该模拟器的 95.2% 进程 CPU 包含 SwiftShader 软件光栅化，不能作为真机 CPU 收益。它证明的是 Native JSB 的自定义实例属性、离线数据加载和 GLES instancing 链路已跑通；早期 `spine-vat-1` 的 ARM64 真机性能数据不能直接冒充 M3 真机回归。完整实现与复现方法见 [Spine VAT Player M3](./spine-vat-player-m3.md)。

### 7.3 HYBRID event / socket

M3 已增加轻量 HYBRID 轨道：event 从 Spine JSON 编译进 clip，运行时支持正放、倒放、loop 和 seek 游标语义；指定 socket 在烘焙时保存骨骼的完整 2D 仿射矩阵，运行时按 GPU 当前离散帧读取，不重新求值骨骼。

水果机的 `r1_lian` socket 已在 Web 和 Android Native 真实运行验证。Web 的位置在 500 ms 内从 `(-9.51, -40.84)` 变到 `(13.92, -39.60)`；Native 两秒前后从 `(13.57, -16.64)` 变到 `(-22.82, -22.21)`，矩阵旋转/缩放分量也发生变化。两端仍保持 80 GPU Instances 和 8 Draw Call，说明 HYBRID 轨道没有拆散渲染批次。

这套水果机资源没有 authored event，所以事件结论目前来自自动测试，不冒充真实资产回归。另一个明确成本是 JSON 膨胀：单 socket 的原始矩阵约 4.22 KiB，但 manifest 从 3.6 KiB 增到 45.2 KiB；工程化前应改为二进制/量化轨道。

## 8. VAT 的收益、成本与边界

通用 VAT v2 已完成 Web 侧 M2 和 M3：它不再删除 clipping/draw order，而是直接烘焙官方 Runtime 的最终裁剪几何，并用公共 Render Lane 保留材质顺序；每实例动画、相位、速度和颜色通过 Instanced Attribute 独立控制。`tuan42` 和水果机三个动画的固定帧像素对照、20 实例独立播放和 GPU Instancing 均已跑通。以下“当前 PoC”限制仍指早期 `spine-vat-1` 专项实现，不应与 v2 混为一谈。

### 8.1 能移出主线程的工作

- AnimationState、骨骼 world transform 和约束求值；
- 每实例的 CPU 顶点生成；
- Spine Runtime 到 Cocos `RenderData` 的动态顶点复制；
- 大量实例的独立 draw segment 提交。

### 8.2 当前 PoC 的功能限制

- 固定皮肤和固定顶点拓扑；
- 不支持任意换装和动态 attachment 拓扑；
- 不支持通用 clipping；
- 不支持任意 draw order；
- 不完整支持动画混合、叠加轨道、socket/挂点和复杂事件；
- two-color tint、透明排序和不同 blend mode 需要按项目逐项验收。

原始 `tuan42` 存在 clipping、draw-order 和初始缺失 attachment，PoC 已通过裁剪功能、固定 setup attachment 等方式转成固定拓扑。因此当前数据证明的是“受限功能集 VAT”的效果，不是完整 Spine Runtime 的无损替代。

### 8.3 VAT 的内存交换

VAT 不是没有内存成本，而是把 CPU 动态计算/帧缓存换成 GPU 纹理和离线资产：

```text
REALTIME：CPU/WASM 每帧计算 + 动态 RenderData
SHARED_CACHE：CPU 保存共享动画帧 + 每实例 RenderData
VAT：GPU VAT 纹理 + 静态 mesh + 少量实例参数
```

同一份动画被 20 个实例复用时，约 0.81 MB VAT 纹理只需一份；如果 20 个入口是 20 份完全不同的 VAT，仅纹理净数据约为 16.2 MB，还未计 atlas、纹理对齐、驱动分配、静态 mesh 和包体。

## 9. 上线决策

### 9.1 当前决策

约 20 个大厅入口默认使用：

```text
SHARED_CACHE + enableBatch=true
```

原因：

1. 官方方案改动小、功能兼容性高；
2. 低端 AVD 上已达到约 59 FPS；
3. 两台 OPPO 实体机都证明：复杂资源在 20 实例时缓存路径约 54-55 FPS、VAT 稳定约 60 FPS；30 实例时缓存路径约 39-42 FPS、VAT 仍约 60 FPS；
4. 因此复杂固定拓扑资源可进入 VAT 专项开发，但不能把结论外推到所有入口资源；
5. VAT 的固定拓扑和功能裁剪仍会增加资源生产、测试和维护成本。

当前是“两级决策”，不是统一开关：

- 简单资源或 `SHARED_CACHE` 已满足 P95/CPU 预算：继续官方路径。
- 类似 `tuan42` 的复杂固定拓扑资源，且目标为稳定 60 FPS：进入 VAT 工程化和真实大厅 A/B。

### 9.2 VAT 进入正式开发的必要条件

以下条件应同时满足：

1. 真实大厅中，`SHARED_CACHE + enableBatch` 的 P95 已超过项目预算；
2. Profiler 确认瓶颈来自 Spine 更新、Renderer/Present 或 Draw Call，而不是脚本、布局、网络、粒子或其他 UI；
3. 资源能够锁定 skin、顶点拓扑、attachment 集合、draw order 和 blend 分组；
4. 产品接受不支持通用换装、clipping、动态 attachment、任意混合和 socket 驱动逻辑；
5. 印度目标档低端实体机或正式目标机连续至少三轮证明 VAT 的 P95、CPU、功耗和温升优于官方缓存路径。

### 9.3 Go / No-Go

`Go`：真实大厅在目标实体机上超预算，VAT 连续三轮改善 P95/CPU，且内存、功耗、温升和画面正确性可接受。

`No-Go`：`SHARED_CACHE` 已满足帧率和 CPU 余量；或入口使用大量不同 VAT 导致纹理累加；或依赖换装、clipping、draw order；或实体机收益无法在真实大厅复现。

### 9.4 构建裁剪与子 Bundle

Creator 3.8.7 的构建脚本会从场景入口和静态 import 图做代码裁剪；未被入口引用的模块不会自动进入该 Bundle。子 Bundle 不是“绕过裁剪”的特殊区域，而是独立的依赖图：只要资源、脚本或场景被该子 Bundle 引用，它们会被保留在子 Bundle 中，主 Bundle 不再重复收集。

本次 `android-fruitvat42-arm64` 构建（Creator 3.8.7，`19:32:37`）的调试场景入口是 `SpineLabDriver`。该脚本为了测试同时静态引用了 `SpineVatAnalyzer`、`SpineVatWorkbench`、Baker/Compiler、ZIP 工具和旧 Renderer，因此它们在 `data/assets/main/index.js` 中出现。这不是 Creator 裁剪失效，而是调试入口明确把这些代码标记为已使用；`main/index.js` 中可见 20 个 Spine/VAT 工具模块，大小约 269 KiB（未压缩）。

正式游戏应将转换器、分析器、Workbench、Benchmark 和测试驱动移出正式场景的静态依赖图：

1. 转换工具只保留在编辑器扩展或独立 Web 工具，不进入游戏 Bundle；
2. Benchmark/调试场景放入独立子 Bundle，按需加载后释放；
3. 正式主 Bundle 只静态引用 `spinevat.Skeleton`、`spinevat.SkeletonData`、VAT Renderer 和实际场景使用的资源；
4. 每次发布检查 `data/assets/<bundle>/index.js` 和 `cc.config.json`，确认 VAT manifest、Buffer、atlas Texture2D、Effect 与 Runtime 类在预期 Bundle，且分析器/转换器不在正式主包。

因此，APK 构建成功不能单独证明代码已裁剪；必须同时检查 Bundle 依赖图。当前调试 APK 可用于验证运行链路，但不能作为正式包体积或启动内存的代表。

### 9.5 2026-09-23 VAT APK 真机复测

修复 AssetDB worker 的自定义 Asset 注册顺序后，重新构建并安装了本次 APK：

- 配置：`android-fruitvat42-arm64`，Creator 3.8.7，Android arm64 / GLES3 / API 34。
- APK：`build/android-fruitvat42-arm64/proj/build/spine-runtime-lab/outputs/apk/debug/spine-runtime-lab-debug.apk`。
- 文件大小：46,078,883 bytes；SHA-256：`7AC526B36095C59AEADB6B18BE2D38AFE3920DB6D2AC82E24FAC8DE31807A38C`；构建时间：2026-09-23 10:01（本机时间）。
- 构建导入表已确认包含 `spinevat.SkeletonData` 的 `manifestJson`、`positionPages`、`lightPages`、`atlasPages` 字段；不再是 `unknown/unknown`，也没有回退到 `SHARED_CACHE`。

目标真机为 OPPO `PGCM10`（Android 13 / API 33，MediaTek `mt6833`，Mali-G57 MC2，1080x2400，60 Hz）。固定运行 `fruit-machine-vat` 场景，30 个 VAT 实例，连续采集 300 帧窗口：

| 指标 | 观测值 |
| --- | --- |
| VAT 状态 | `mode=VAT_EXT`，`gpuInstances=120` |
| 引擎 FPS | 59.29-60.22，绝大多数窗口约 60.15-60.22 |
| 帧时间 | P50 16.52-16.55 ms；P95 16.67-16.78 ms |
| >25 ms 帧 | 0.00%，单个窗口最高 0.33% |
| Draw Call | 8（平均 8.00，峰值 8） |
| 三角形 | 32,194 |
| VAT 纹理/Buffer 估算 | 27.09 MB / 2.34 MB |
| 进程 CPU | `top` 8 次采样 110-128%，均值约 114.6%（8 核设备，约 1.15 个核） |
| 进程 PSS | 231,366 KB（约 226 MB） |
| Native Heap PSS | 63,760 KB（约 62.3 MB） |
| Graphics PSS | 56,664 KB（约 55.3 MB） |

`dumpsys gfxinfo` 对 Cocos SurfaceView 只捕获到 Android ViewRoot 的 2 帧，不能代表 Cocos 渲染帧率；本次 FPS、P50/P95 和 Draw Call 以引擎内 `[SpinePerf]` 300 帧窗口为准。日志同时出现 `SpineVatExtension asset=fruit-machine-nanwuzhe42` 和 shader 编译成功，证明真机实际走的是 VAT 扩展路径。

### 9.6 普通图片穿插与遮挡：必须区分 Sprite 和 SpriteRenderer

2026-09-23 在同一台 PGCM10、30 个 VAT 实例下加入普通图片和前后遮挡负载。旧测试版本的普通图片使用 `Sprite`，VAT 使用 `MeshRenderer`，得到：

| 指标 | 纯 VAT | VAT + 普通图片（旧 Sprite 测试） |
| --- | ---: | ---: |
| 稳定引擎 FPS | 约 60.15-60.22 | 约 60.11-60.25 |
| P50 / P95 | 16.52-16.55 / 16.67-16.78 ms | 16.53-16.55 / 16.69-16.72 ms |
| Draw Call | 8 | 9 |
| GPU Instances | 120 | 120 |
| 三角形 | 32,194 | 32,218 |
| GFX Texture / Buffer | 27.09 / 2.34 MB | 27.11 / 2.34 MB |

截图中蓝色后置图和红色前置图的透明叠加视觉容易误判；更关键的是，10 个小图始终盖在 VAT 上。原因不是 `z=90/210` 失效，而是组件类型不同：`Sprite` 继承 `UIRenderer`，由 Canvas/UI batcher 在 UI 阶段提交；VAT 的 `MeshRenderer` 属于 `UI_3D`/透明模型队列。两条队列之间不会按节点 z 交错，所以普通 `Sprite` 在该组合下整体位于 VAT 之后。日志只记录节点 z，不能证明跨队列的实际绘制顺序。

由于目标游戏基本是 2D，不能把普通 `Sprite` 替换成 `SpriteRenderer` 来掩盖这个问题。修复方向改为在 VAT 每个 `MeshRenderer` 节点上添加 `UIMeshRenderer` wrapper，并让 VAT 节点继承 Canvas 的 2D layer；该 wrapper 会把模型从 3D 场景队列摘出，经 UI Batcher 的 `commitModel()` 提交，理论上才能与普通 Sprite/官方 Spine 按兄弟顺序排序。代码已加入此桥接，但需要重建 APK 后用真实 `Sprite(z90) < VAT(z100)`、`VAT(z200) < Sprite(z210)` 截图确认，同时检查 GPU instance 数是否仍为 120。当前旧 APK 的截图只能证明裸 MeshRenderer 与 Sprite 跨管线时图片始终在一侧，不能作为 2D VAT 交错已支持的证据。

## 10. 建议的后续验证

1. 把测试组件接入真实大厅，包含正式 UI、粒子、特效、网络和脚本负载。
2. 在正式目标机或印度目标档实体低端机上，对 `SHARED_CACHE` 和 VAT 各连续采集至少三轮；K9x 与 CPH2823 已有隔离场景数据，仍需真实大厅复测。
3. 同时记录 FPS、P50/P95、>25 ms、CPU、Renderer/Present、Draw Call 平均/峰值、PSS、功耗和温升。
4. 使用真实的 20 个入口资源统计“相同 VAT 复用数”和“不同 VAT 数量”，核算实际纹理/包体预算。
5. 若官方路径已满足预算，停止 VAT 产品化；若 CPU/提交仍是明确瓶颈，再补齐资源导出、版本校验、降级路径和兼容性测试。

## 11. 相关资料

- [Spine 播放与缓存的源码级内存流程](./spine-runtime-memory-flow.md)
- [Runtime 结论摘要](./spine-runtime-findings.md)
- [Android 完整测试数据](./android-test-results.md)
- [Web 对照数据](./spine-vat-web-results.md)
- [VAT 上线决策](./spine-vat-decision.md)
- [通用 Spine 转 VAT 工具设计](./general-spine-vat-tool-design.md)
- [Spine VAT Compiler/Renderer M2 使用与实测](./spine-vat-compiler-m2.md)
- [Spine VAT Player M3 每实例播放与 Web 实测](./spine-vat-player-m3.md)
- [性能测试计划与采集口径](./performance-test-plan.md)
- [Cocos 论坛 VAT 方案](https://forum.cocos.org/t/topic/176384)

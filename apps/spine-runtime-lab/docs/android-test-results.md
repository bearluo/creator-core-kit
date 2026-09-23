# Cocos Creator 3.8.7 Spine Android 模拟器实测

## 1. 测试范围

- 引擎：Cocos Creator 3.8.7。
- 基础资源：`spineboy-pro`，Spine 3.8.99。
- 场景：同一份 `SkeletonData`，20 个 `sp.Skeleton`，循环播放 `walk`。
- 对照项：`REALTIME` / `SHARED_CACHE`，`enableBatch=false/true`。
- 正式样本：冷启动后预热 30 秒，再采集 126 个 SurfaceFlinger 呈现间隔和 5 个 `top` CPU 样本。
- APK：debug、x86_64、GLES3/GLES2、Android API 34。

模拟器档位：

| 档位 | AVD | CPU | RAM | 分辨率 | GPU |
| --- | --- | ---: | ---: | ---: | --- |
| 低端 | `spine_runtime_low` | 2 核 | 2 GB | 720x1280 / 320 dpi | `host` |
| 中端 | `spine_runtime_mid` | 4 核 | 3 GB | 1080x1920 / 420 dpi | `host` |

## 2. 采集口径

本测试不只看 HUD 的瞬时 FPS：

- `SurfaceFlinger --latency`：实际呈现帧间隔、平均 FPS、P50、P95、超过 25 ms 的帧数。
- Cocos Profiler：`Frame time`、`Game Logic`、`Renderer`、`Present`、draw calls、triangles、GFX Texture/Buffer Memory。
- `dumpsys meminfo`：PSS、RSS、Native Heap PSS、Unknown PSS 和 mmap 分类。
- `top`：连续 5 秒的进程 CPU；Android `top` 中 100% 表示占满一个核。
- logcat：运行配置、GC、JS/native 错误和崩溃。

`dumpsys gfxinfo` 对 Cocos 使用的 `SurfaceView` 返回 0 帧，因此不能用它判断该项目的帧稳定性。本项目改用 SurfaceFlinger 的实际呈现时间戳。

## 3. 低端 AVD 正式结果

| 模式 | Batch | Draw calls | PSS (MB) | RSS (MB) | Native PSS (MB) | CPU 平均 | FPS | P50 (ms) | P95 (ms) | >25 ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0 实例基线 | on | - | 159.11 | 246.21 | 46.97 | 25.0% | 59.99 | 16.663 | 18.428 | 0 |
| REALTIME | off | 24 | 161.37 | 248.71 | 51.62 | 40.2% | 60.11 | 16.663 | 18.648 | 0 |
| REALTIME | on | 5 | 160.90 | 248.23 | 52.32 | 31.0% | 59.97 | 16.569 | 19.064 | 0 |
| SHARED_CACHE | off | 24 | 158.70 | 245.86 | 52.12 | 34.3% | 60.01 | 16.671 | 18.615 | 0 |
| SHARED_CACHE | on | 5 | 159.39 | 246.73 | 52.07 | 28.6% | 59.97 | 16.642 | 18.672 | 0 |

0 实例基线仍加载同一份 SkeletonData 和 atlas，只是不创建 20 个 `sp.Skeleton`，因此更接近“每实例运行态开销”的对照，而不是空白 Cocos 应用。

观察：

- 20 个实例增加的 Native Heap PSS 约为 4.65-5.35 MB，平均约 0.23-0.27 MB/实例。
- Total PSS 会受 V8 GC、匿名映射和共享页计费影响，单次样本可波动数 MB；逐实例开销应使用 0 实例基线与多实例样本的差值判断。
- `enableBatch` 将 draw calls 从 24 降到 5；低端 AVD 的 CPU 也从 40.2% 降到 31.0%（REALTIME），从 34.3% 降到 28.6%（SHARED_CACHE）。
- 四组均稳定在 60 FPS，P95 为 18.6-19.1 ms，126 个样本中没有超过 25 ms 的帧。
- `Instance Count` 始终为 0，说明 `sp.Skeleton` 的 2D middleware 路径没有使用引擎 GPU Instancing。
- 当前画面的 GFX Texture Memory 约 3.72 MB，GFX Buffer Memory 约 2.44-2.47 MB；共享 atlas 后纹理内存不会按实例复制。

## 4. 中端 AVD 交叉验证

| 模式 | Batch | Draw calls | PSS (MB) | RSS (MB) | Native PSS (MB) | CPU 平均 | FPS | P50 (ms) | P95 (ms) | >25 ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| REALTIME | on | 5 | 158.94 | 244.05 | 52.07 | 33.7% | 59.96 | 16.520 | 18.116 | 0 |
| SHARED_CACHE | off | 24 | 160.63 | 245.76 | 52.93 | 40.8% | 60.02 | 16.672 | 18.521 | 0 |
| SHARED_CACHE | on | 5 | 159.90 | 245.07 | 52.84 | 36.5% | 60.00 | 16.628 | 17.949 | 0 |

中端档位同样确认 batch 将 draw calls 从 24 降至 5，并维持稳定呈现。CPU 百分比受分辨率、宿主机调度和模拟器核数影响，不能跨档位直接按比例比较。

## 5. 当前结论

1. 对同屏约 20 个、共享 SkeletonData、只播简单循环动画的水果机大厅，3.8.7 原生 runtime 的 Native PSS 增量约为 0.23-0.27 MB/实例。
2. `enableBatch` 是当前最明确、风险最低的优化：显著减少 draw calls，并在低端 AVD 上降低进程 CPU。
3. `SHARED_CACHE` 在本资源上没有制造大额预分配；稳态内存与 REALTIME 相近，差异处于数 MB 量级。
4. 20 个实例已经稳定满 60 FPS，暂时没有证据支持为了这个数量直接投入 VAT。VAT 应在真机 profiler 证明骨骼求值或顶点生成是瓶颈后再做。
5. 模拟器使用宿主 GPU，不能代替印度低端真机的 GPU、带宽、温控和驱动验证；当前结果适合比较代码路径和相对差异，不适合作为真机绝对性能承诺。

## 6. Spine 4.2.43 复杂资源

用户提供的 `json4.2.43.zip` 包含 `tuan.json/.atlas/.png`：

| 指标 | tuan 4.2.43 | spineboy-pro 3.8.99 |
| --- | ---: | ---: |
| Bones | 26 | 64 |
| Slots | 17 | 52 |
| Attachments | 46 | 12 个显式 typed attachments |
| Meshes | 4 | 10 |
| 动画数 | 1 | 11 |
| IK / Transform / Path / Physics | 1 / 1 / 1 / 1 | 7 / 7 / 1 / 0 |
| Atlas | 1756x788 | 1534x529 |

该资源主要增加 Spine 4.2 physics、附件/序列帧和贴图压力，但骨骼、slot、mesh 和动画数量低于 spineboy-pro。测试报告会将它描述为“4.2 物理与附件型资源”，不把它泛化成所有维度都更复杂。

Creator 3.8.7 原生层明确限制 Spine 3.8 与 Spine 4.2 runtime 不能同时启用，因此 4.2 资源必须使用独立引擎模块配置和独立 APK 输出，不能与 3.8 资源混在同一个 native runtime 中比较。

## 7. Spine 4.2.43：20 个复杂实例

以下数据均使用同一份 `tuan42`、同一段 2 秒动画和共享资源。Draw Call 是 5 秒窗口峰值；VAT 的 20 个实例会提交 40 个 GPU Instances（normal/additive 两组）。

### 中端 AVD

| 模式 | CPU | 引擎 FPS | 引擎 P95 | SF P95 | 峰值 Draw Call | Native PSS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `REALTIME` | 93.0% | 57.59 | 19.29 ms | 22.83 ms | 44 | 46.5 MB |
| `SHARED_CACHE` | 39.1% | 59.57 | 17.82 ms | 22.62 ms | 44 | 50.7 MB |
| VAT | 36.1% | 59.82 | 17.84 ms | 21.77 ms | 6 | 40.5 MB |

中端档中 `SHARED_CACHE` 已把 CPU 从 93.0% 降到 39.1%；VAT 只再降低约 3 个百分点。VAT 最明确的额外收益是 5 秒窗口峰值 Draw Call 从 44 降到 6。

### 低端 AVD

| 模式 | CPU | 引擎 FPS | 引擎 P95 | SF P95 | 峰值 Draw Call | Native PSS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `REALTIME` | 57.8% | 39.03 | 42.62 ms | 35.50 ms | 44 | 44.8 MB |
| `SHARED_CACHE` | 43.7% | 59.03 | 18.90 ms | 22.23 ms | 44 | 50.3 MB |
| VAT（初测） | 50.6% | 56.94 | 21.03 ms | 24.40 ms | 6 | 40.1 MB |
| VAT（重建包复测） | 41.6% | 57.71 | 20.26 ms | 23.27 ms | 6 | 43.6 MB |

低端档中 `REALTIME` 已不合格；`SHARED_CACHE` 的 FPS、P95 和初测 CPU 都优于 VAT。对约 20 个复杂入口，当前应优先 `SHARED_CACHE`。

## 8. 低端 AVD：30 个复杂实例

| 模式 | CPU | 引擎 FPS | 引擎 P95 | SF P95 | 峰值 Draw Call | Native PSS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `SHARED_CACHE`（正式样本） | 41.6% | 58.15 | 19.21 ms | 23.30 ms | 64 | 52.3 MB |
| VAT（初测） | 47.8% | 58.55 | 18.90 ms | 23.17 ms | 6 | 40.5 MB |
| VAT（重建包复测 1） | 33.8% | 40.73 | 32.98 ms | 39.92 ms | 6 | 44.8 MB |
| VAT（重建包复测 2） | 34.0% | 41.77 | 32.37 ms | 35.96 ms | 6 | 44.8 MB |

重建后的 VAT 在画面可见、`gpuInstances=60`、峰值 Draw Call 为 6 的前提下连续两次只有约 40-42 FPS；同一 AVD、同一时段交叉复测 `SHARED_CACHE` 仍为 59.54 FPS。该差异说明模拟器的 host-GPU/驱动结果存在明显方差，不能拿 VAT 的单次最好值作为上线依据。

30 个实例时可以确认的只有：VAT 稳定把 Draw Call 从 64 降到 6，并减少约 8-12 MB Native PSS；帧率收益不稳定，重建包上反而出现退化。

## 9. 黑屏样本处理

模拟器曾出现 Cocos Surface 全黑，但 logcat 仍持续输出性能数据，并伴随 `freeAllBuffers` / `unknown buffer`。所有全黑截图样本均作废；冷重启 `spine_runtime_low`、使用 `-gpu host` 后重新采集可见画面。

`runtime42-low-30-shared-final` 和 `vat42-low-20-final` 属于黑屏诊断样本，不能作为正式结论。有效复测样本使用 `*-visible-*` 名称。

## 10. 复杂资源模拟器阶段结论

1. 在目标真机数据出现前，约 20 个大厅入口默认先使用 `SHARED_CACHE + enableBatch=true`。
2. 必须保留实时混合、换装等能力时：先测 `REALTIME`；低端机若超预算，再评估资源裁剪或 VAT，而不是假设实例数少就一定安全。
3. AVD 阶段只能确定 VAT 能降低 Draw Call 和部分 Native PSS，不能据此判断目标真机 FPS；实体机结论见第 12 节。
4. 只有真实大厅加入 UI、粒子、特效后出现 Renderer/Present 或提交瓶颈，且资源满足固定拓扑约束，才值得继续 VAT。
5. 模拟器不代表印度低端真机的 GPU、带宽、温控和厂商驱动。

## 11. 远端 ARM64 / Mali 设备对照

### 设备与可信度

- ADB：`192.168.170.190:5555`。
- Android 14 / API 34，`arm64-v8a`，1080x1920，当前 60 Hz。
- 系统上报 GPU 为 Mali-G610 / GLES 3.2。
- 系统属性同时上报 Xiaomi `2112123AG`、SM8250；SM8250 正常应使用 Adreno，与 Mali-G610 不一致。
- ThermalService 使用测试温度传感器，安全补丁日期为未来日期。该环境疑似云手机或经过属性伪装。

因此，这台设备可用于验证 ARM64 Native、Mali/GLES 路径和同机相对差异，但不能当作印度低端真机的绝对 FPS、功耗或温升结论。

### 构建与采集

- APK：Creator 3.8.7 debug、仅 `arm64-v8a`、API 34。
- 官方 Runtime 包：`com.corekit.spineruntimelab.tuan42`。
- VAT 包：`com.corekit.spineruntimelab.vat42`。
- 场景：Spine 4.2.43 `tuan42`；20 个实例时官方路径和 VAT 各采集两轮性能样本，并补采一轮 Draw Call 当前值/平均值/峰值。
- 每轮冷启动或重启进程后预热 20-25 秒，再采集引擎 300 帧滚动窗口、SurfaceFlinger、5 个 CPU 样本、PSS/RSS/Native PSS 和截图。

20 个实例的两轮区间：

| 模式 | 引擎 FPS | 引擎 P95 | CPU | Draw Call 当前范围 | 5 秒平均范围 | 5 秒峰值 | GPU Instances | Native PSS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `REALTIME` | 15.99-16.30 | 69.75-72.79 ms | 97.2%-98.6% | 5-44 | 22.60-25.71 | 44 | 0 | 53.2-60.6 MB |
| `SHARED_CACHE` | 37.72-39.34 | 36.80-38.15 ms | 76.6%-88.8% | 5-44 | 22.47-25.03 | 44 | 0 | 56.5-57.2 MB |
| VAT | 36.02-40.41 | 37.15-38.35 ms | 30.6%-30.8% | 6 | 5.95-6.00 | 6 | 40 | 51.6-52.1 MB |

VAT 30 个实例的单轮扩展样本：

| 模式 | 引擎 FPS | 引擎 P95 | CPU | 5 秒峰值 Draw Call | GPU Instances | Native PSS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| VAT | 35.34 | 37.73 ms | 29.1% | 6 | 60 | 48.1 MB |

解释：

- `SHARED_CACHE` 相比 `REALTIME` 将帧率提高约 2.4 倍，并降低 CPU，但仍只有约 38 FPS。
- `REALTIME` 和 `SHARED_CACHE` 的 Draw Call 都会随动画帧在 5-44 之间切换，5 秒平均约为 23-25；只看 HUD 瞬时值或只看峰值都会失真。
- VAT 与 `SHARED_CACHE` 的最终 FPS/P95 重叠，没有证明稳定的帧率优势；它将 CPU 从 76.6%-88.8% 降至约 30.7%，将平均 Draw Call 从约 23-25 降至 6、峰值从 44 降至 6。
- VAT 从 20 增至 30 个实例时，Draw Call 仍为 6，GPU Instances 从 40 增至 60，CPU 没有增长，证明 instancing 提交路径在 ARM64 Native 上生效。
- VAT 的截图 HUD 显示 Renderer 约 6-8 ms、Present 约 13-25 ms；该设备上瓶颈已经移到呈现/GPU/云端合成侧，因此降低主线程 CPU 后没有稳定转化成更高 FPS。
- VAT 和官方 `REALTIME` 都各有一张截图处于发白偏红的动画画面，而其他截图正常；该现象不是 VAT 专属。后续水果机 Web 对照把官方 Spine 与 VAT 固定在第 0、30、60、90 帧后，四组明暗和颜色均一致，进一步说明单张异步截图不能作为 Mali shader 或显存故障的证据。
- Total PSS 和 Native PSS 在不同进程启动间波动明显，30 实例的单轮 PSS 反而低于 20 实例，不能用这组单点数据推导逐实例内存；能确认的只是 VAT 没有随实例数复制 0.81 MB 的 VAT 纹理。

### 远端 ARM64 结论

1. 官方 Runtime 的 `SHARED_CACHE` 仍是最先启用的低风险优化，但该环境下 20 个复杂实例未达到 60 FPS。
2. VAT 已在 ARM64/Mali Native 上证明能大幅释放 CPU 和提交开销；这对真实大厅还要叠加 UI、粒子和脚本时有价值。
3. VAT 当前没有证明能绕过该环境约 35-40 FPS 的 Present/GPU 上限，不能仅凭 CPU 降低就宣布达到上线条件。
4. 最终 Go/No-Go 仍需印度目标档实体机，至少连续三轮采集 P95、CPU、功耗、温升和画面正确性。

## 12. OPPO K9x 5G 实体机对照

### 设备与采集条件

- 实体机：OPPO K9x 5G（`PGCM10`），Android 13 / API 33。
- SoC：MediaTek Dimensity 810（`MT6833V/PNZA`），6 x 2.0 GHz + 2 x 2.4 GHz。
- GPU：Mali-G57 MC2 / OpenGL ES 3.2。
- 内存：约 7.46 GiB；分辨率 1080x2400；测试时固定 60 Hz。
- APK：Creator 3.8.7 debug、仅 `arm64-v8a`、compile API 34。
- 场景：Spine 4.2.43 `tuan42`，`enableBatch=true`；每轮重启进程并预热 25 秒。
- 采集：引擎 300 帧滚动窗口、SurfaceFlinger、5 个 `top` CPU 样本、PSS/RSS/Native PSS、logcat 和截图。
- 测试开始时电量 15%、电池约 33.2 C；结束时电量 23%、约 36.0 C，全程 USB 充电且省电模式关闭。该温升包含充电影响，不能作为独立功耗结论。

20 个实例各两轮：

| 模式 | 引擎 FPS | 引擎 P95 | 进程 CPU | 5 秒平均 Draw Call | 峰值 | GPU Instances | Native PSS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `REALTIME` | 18.33-18.47 | 60.06-60.26 ms | 110.2%-112.6% | 22.80 | 44 | 0 | 61.4-63.8 MB |
| `SHARED_CACHE` | 54.91-54.94 | 19.01-20.75 ms | 116.0%-117.0% | 22.80-23.23 | 44 | 0 | 57.2 MB |
| VAT | 59.94-60.58 | 16.71-16.77 ms | 48.6%-50.6% | 6.00 | 6 | 40 | 44.0-48.4 MB |

30 个实例压力点：

| 模式 | 引擎 FPS | 引擎 P95 | 进程 CPU | 5 秒平均 Draw Call | 峰值 | GPU Instances | Native PSS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `SHARED_CACHE` | 40.48 | 28.17 ms | 113.0% | 32.19 | 64 | 0 | 57.4 MB |
| VAT | 60.37 | 16.76 ms | 53.8% | 6.00 | 6 | 60 | 44.9 MB |

### 满电复测（2026-09-21）

为排除首次测试开始时 15% 电量的影响，在同一设备、同一 APK、同一 60 Hz 应用显示模式下完成满电复测。系统屏幕超时为 30 秒且 OPPO 固件禁止 shell 修改常亮设置，因此采集期间使用无场景绑定的按键维持唤醒；所有有效样本均由日志确认模式/实例数未变化，并拿满 300 个引擎帧样本。一次仅得到 180 帧的休眠样本已作废。

测试从 100% 电量、约 28.0 C 开始，到 100%、约 31.5 C 结束；USB 保持连接、省电模式关闭。20 个实例各两轮：

| 模式 | 引擎 FPS | 引擎 P95 | SF FPS | SF P95 | CPU | 平均 Draw Call | 峰值 | GPU Instances | Native PSS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `REALTIME` | 18.22-18.45 | 59.54-60.29 ms | 18.49-18.66 | 71.94-71.97 ms | 106.0%-106.2% | 22.38-25.33 | 44 | 0 | 58.1-58.2 MB |
| `SHARED_CACHE` | 54.52-54.78 | 19.30-19.72 ms | 54.49-54.85 | 33.23-33.25 ms | 117.2%-117.8% | 23.15-24.29 | 44 | 0 | 56.9-57.5 MB |
| VAT | 59.70-60.67 | 16.75-17.03 ms | 59.67-60.15 | 16.67 ms | 49.8% | 6.00 | 6 | 40 | 43.3-45.4 MB |

30 个实例满电压力点：

| 模式 | 引擎 FPS | 引擎 P95 | SF FPS | SF P95 | CPU | 平均 Draw Call | 峰值 | GPU Instances | Native PSS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `SHARED_CACHE` | 41.57 | 26.74 ms | 40.10 | 33.27 ms | 113.2% | 32.40 | 64 | 0 | 59.0 MB |
| VAT | 60.44 | 16.81 ms | 60.15 | 16.68 ms | 55.4% | 6.00 | 6 | 60 | 45.8 MB |

满电复测结论：

- 20 实例三种模式的 FPS 与首次测试差异均不到约 1%，因此首次 15% 电量在 USB 供电、省电关闭条件下没有造成可测的性能降级。
- 满电两轮中，`SHARED_CACHE` 的引擎 P95 约 19.5 ms，但 SurfaceFlinger P95 稳定为约 33.24 ms，表示约 55 FPS 无法持续命中 60 Hz VSync，实际呈现会周期性丢帧。
- VAT 的 SurfaceFlinger P95 稳定为约 16.67 ms，20/30 实例都维持 60 Hz 呈现；收益不只是引擎内部计时和 Draw Call 数字。
- 20 实例按两轮均值比较，VAT 相比 `SHARED_CACHE`：引擎 FPS 提升约 10.1%，引擎 P95 降低约 13.4%，进程 CPU 降低约 57.6%，平均 Draw Call 降低约 74.7%。
- 30 实例时 VAT 相比 `SHARED_CACHE`：引擎 FPS 提升约 45.4%，P95 降低约 37.1%，CPU 降低约 51.1%，平均 Draw Call 降低约 81.5%。
- 约 3.5 C 的短时温升未出现持续降频迹象，但测试仍处于 USB 连接和隔离场景，不能替代电池供电下的长时间功耗/温升测试。

### 实体机解释

- `SHARED_CACHE` 把 20 实例从约 18.4 FPS 提升到约 54.9 FPS，说明缓存仍然是必须先开的低风险优化。
- `SHARED_CACHE` 的总 CPU 没有低于 `REALTIME`，是因为它在相同时间内输出了约 3 倍帧数；不能据此理解为缓存计算更重。按每个输出帧折算，其 CPU 成本已经显著下降。
- VAT 在 20 实例时把约 54.9 FPS 提到稳定 60 FPS，并把进程 CPU 从约 116.5% 降至约 49.6%，降低约 57%。
- VAT 在 20 实例时将平均 Draw Call 从约 23 降至 6、峰值从 44 降至 6；Native PSS 也低约 9-13 MB，但 PSS 是整进程采样，不能全部归因于 Spine。
- 30 实例时 `SHARED_CACHE` 降至约 40.5 FPS，而 VAT 仍为约 60.4 FPS；Draw Call 维持 6、GPU Instances 增至 60，证明 instancing 扩展路径在真实 Mali 设备上生效。
- 两个 VAT 20 实例样本和一个 VAT 30 实例样本均无崩溃、shader error 或 VAT 加载错误，截图中动画和 normal/additive 两个分组正常显示。
- 满电复测再次得到相同结论，并通过 SurfaceFlinger 证明 VAT 从约 55 FPS 的周期性丢帧提升到稳定 60 Hz 呈现。

### 实体机结论

1. 对 `tuan42` 这种复杂、固定拓扑且可重复复用的资源，VAT 已从“理论候选”提升为“有真机数据支持的专项优化候选”。
2. 约 20 个复杂实例且目标为稳定 60 FPS 时，`SHARED_CACHE` 已接近但未完全达标，并占用超过一个 CPU 核；VAT 能补足帧率并释放约半个以上 CPU 核的系统余量。
3. 这不代表所有 20 个大厅入口都应 VAT：如果正式资源更简单、目标为 30 FPS，或每个入口都需要独立 VAT 纹理，官方缓存路径仍可能更合适。
4. 当前是隔离场景、同一资源重复实例，尚未覆盖真实大厅 UI/粒子/网络脚本，也没有完成受控功耗测试；正式上线前仍需把真实入口资源接入并连续采集至少三轮。

## 13. OPPO CPH2823 / Android 16 实体机复测

### 设备与采集条件

- 实体机：OPPO `CPH2823`，Android 16 / API 36。
- SoC：MediaTek `MT6835`；GPU：Mali-G57 MC2 / OpenGL ES 3.2。
- 内存：约 3.53 GiB；分辨率：720x1570。
- 桌面刷新率为 120 Hz，Cocos 应用进入前台后系统自动切换到 60 Hz。
- APK 与 K9x 测试完全相同：官方包 SHA-256 为 `F49AE8B9F5CA954651A32CF753F09B14E9B346E6F49D2317CCBD3A418A6CAB23`，VAT 包为 `D31C58C8CBBDE3CB465BC07ACC5117CBAFBCAC15B402C8EDA7C132F8036F9A3C`。
- 每个有效样本均包含 300 个引擎帧，并采集 SurfaceFlinger、5 个 `top` CPU 样本、PSS/RSS/Native PSS、日志和截图。
- 测试开始时电量 100%、约 30.7 C；结束时仍为 100%、约 34.5 C。全程 USB 连接且省电模式关闭，温升不能等价为电池供电下的功耗结论。

20 个实例各两轮：

| 模式 | 引擎 FPS | 引擎 P95 | SF FPS | SF P95 | CPU | 平均 Draw Call | 峰值 | GPU Instances | Native PSS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `REALTIME` | 18.39-20.78 | 53.76-61.62 ms | 18.27-20.82 | 50.10-66.75 ms | 115.2%-116.0% | 22.04-22.14 | 44 | 0 | 45.3-52.0 MB |
| `SHARED_CACHE` | 54.02-55.03 | 19.86-20.15 ms | 55.27-55.68 | 33.17-33.24 ms | 136.2%-138.0% | 22.70-23.09 | 44 | 0 | 49.5-52.8 MB |
| VAT | 60.00-60.05 | 16.95-17.09 ms | 60.13-60.14 | 16.84-16.87 ms | 117.0%-118.6% | 6.00 | 6 | 40 | 37.9-38.4 MB |

20 实例两轮均值：

| 模式 | 引擎 FPS | 引擎 P95 | CPU |
| --- | ---: | ---: | ---: |
| `REALTIME` | 19.59 | 57.69 ms | 115.6% |
| `SHARED_CACHE` | 54.53 | 20.01 ms | 137.1% |
| VAT | 60.03 | 17.02 ms | 117.8% |

30 个实例压力点：

| 模式 | 引擎 FPS | 引擎 P95 | SF FPS | SF P95 | CPU | 平均 Draw Call | 峰值 | GPU Instances | Native PSS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `SHARED_CACHE` | 39.56 | 30.92 ms | 39.10 | 33.44 ms | 126.0% | 31.93 | 64 | 0 | 51.0 MB |
| VAT | 60.23 | 16.89 ms | 59.66 | 16.91 ms | 117.7% | 6.00 | 6 | 60 | 42.0 MB |

### Android 16 SurfaceFlinger 采集修复

Android 16 的 `SurfaceFlinger --list` 会返回 `RequestedLayerState{...SurfaceView[package/...](BLAST)#id parentId=...}`。旧采集脚本把整行直接传给 `SurfaceFlinger --latency`，只能得到刷新周期，拿不到呈现时间戳。

`tools/collect-android.ps1` 已改为从包装字符串中提取真实图层名，并在修复后覆盖重采全部 8 个有效样本。因此本节的 SF FPS/P95 来自有效呈现时间戳，不是引擎 FPS 的转抄。

### 复测结论

- 20 实例时，VAT 相比 `SHARED_CACHE` 的两轮均值：引擎 FPS 提升约 10.1%，P95 降低约 14.9%，CPU 降低约 14.1%，平均 Draw Call 降低约 73.8%。
- 30 实例时，VAT 的 FPS 提升约 52.2%，P95 降低约 45.4%，CPU 降低约 6.6%，平均 Draw Call 降低约 81.2%。
- `SHARED_CACHE` 20 的 SurfaceFlinger P95 为 33.17-33.24 ms，说明约 55 FPS 会周期性错过 60 Hz VSync；VAT 的 SF P95 为 16.84-16.87 ms，实际呈现稳定到 60 Hz。
- 第二台实体机再次确认，复杂固定拓扑资源在 20/30 实例时能从 VAT 获得稳定的帧率与 Draw Call 收益。
- CPU 收益存在明显设备差异：同为 Mali-G57 MC2，K9x 20 实例约下降 58%，CPH2823 约下降 14%。因此不能把单台设备的 CPU 百分比外推到所有目标机。
- 有效样本的错误扫描未发现崩溃、Shader error、VAT 加载失败、`TypeError` 或 `ReferenceError`。一轮误恢复到 0 实例的样本已经作废并覆盖重采。
- 本节仍是同一资源重复实例的隔离测试；约 3.8 C 的 USB 充电短时温升不能替代真实大厅、电池供电和长时间功耗/温控验收。

## 14. 通用 VAT v2 / M3 Android Native 验证

前述 Android VAT 数据来自早期 `spine-vat-1` 专项实现。本节单独验证通用 `spine-vat-2` 播放器的 Native 离线加载和每实例独立状态，二者不能混为同一版本。

### 环境与场景

- Creator 3.8.7 Debug APK，x86_64，包名 `com.corekit.spineruntimelab.fruitvat42`。
- Android 14 模拟器，2,534,120 KB RAM、1080x2400。
- GLES 3.0，GPU 为 Google SwiftShader 软件光栅化。
- 水果机男舞者，3 个动画、4 个 Render Lane、20 个逻辑实例。
- 每个实例使用不同动画、相位、速度和颜色；索引 `0 / 9 / 18` 暂停。
- VAT v2 离线数据 11,468,800 B（10.94 MiB），dark 通道全零并省略。

### 单轮结果

| 指标 | 结果 |
| --- | ---: |
| 引擎 FPS / P50 / P95 | 58.80 / 16.78 ms / 18.75 ms |
| SurfaceFlinger FPS / P50 / P95 | 59.48 / 16.689 ms / 18.268 ms |
| SF 超过 25 ms | 2 / 126 |
| Draw Call 当前 / 平均 / 峰值 | 8 / 8.00 / 8 |
| GPU Instances / Triangles | 80 / 21,584 |
| PSS / RSS | 153.99 / 244.71 MiB |
| Native Heap PSS | 51.27 MiB |
| GFX Texture / Buffer Memory | 19.24 / 2.35 MiB |
| 进程 CPU | 95.2% |

日志和截图确认：

- `80 = 20 × 4 Lane`，不同动画状态仍保持 GPU Instancing；
- 暂停的三个实例两秒后帧号不变，其余实例正常推进；
- Native shader 成功启用 `USE_INSTANCING1`；
- 没有 VAT/JSB/shader/JavaScript 错误，画面没有全黑或破面；
- 相隔约 0.8 秒的两张截图中，播放实例的姿势发生变化，不是静态贴图假通过。

CPU 约 95.2% 不能与前述 ARM64 真机数字横向比较：SwiftShader 会把 GPU 光栅化工作放到 CPU。该轮的结论只限于 Creator 3.8.7 Native/JSB/GLES3 功能链路和批次数正确；通用 M3 的 ARM64 真机性能仍需另行 A/B。

随后把 `r1_lian` 骨骼作为指定 socket 烘焙进同一离线 manifest 并增量重建 APK。Native 日志中的矩阵从：

```text
[0.13024, -0.19232, 0.19232, 0.13024, 13.57, -16.64]
```

变化为：

```text
[0.02275, -0.23848, 0.23848, 0.02275, -22.82, -22.21]
```

稳态仍为 59.75 FPS / P95 17.76 ms、80 GPU Instances、8 Draw Call，证明 Native 可以从 `spine-vat-2` manifest 读取与 GPU 帧同步的 socket，而不破坏 instancing。该样本没有 authored event；event 目前只有 22/22 自动测试中的逻辑覆盖，尚缺真实资源 Native 回归。

采集证据位于 `temp/android-run/m3-vat2-emulator-20260921/`。

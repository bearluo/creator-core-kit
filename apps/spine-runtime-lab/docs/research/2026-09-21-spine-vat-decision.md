# 水果机大厅 Spine VAT 上线决策

状态：已定稿（调研快照）
摘要：水果机大厅是否上线 Spine VAT 的决策与前提条件。
何时读：讨论上线范围与回退策略时。
依赖：[验证汇总](2026-09-21-spine-runtime-vat-summary.md)

## 结论

当前场景约 20 个入口，基础方案仍先使用：

```text
共享 SkeletonData
  + SHARED_CACHE
  + enableBatch=true
  + 统一 atlas / material / blend / layer
```

但决策已经不是统一的“不上 VAT”：两台 OPPO 实体机都证明，类似 `tuan42` 的复杂固定拓扑资源在 20 实例时，VAT 能把 `SHARED_CACHE` 的约 54-55 FPS 提到稳定 60 FPS；30 实例时缓存路径约 39-42 FPS，VAT 仍约 60 FPS。帧率和 Draw Call 收益可复现，但 CPU 收益有设备差异：K9x 约下降 58%，CPH2823 约下降 14%。因此复杂资源可进入 VAT 专项开发；简单资源或官方缓存路径已达标时仍不上 VAT。

## 数据依据

低端 AVD、20 个复杂 `tuan42`：

| 模式 | 引擎 FPS | 引擎 P95 | 峰值 Draw Call | Native PSS |
| --- | ---: | ---: | ---: | ---: |
| `REALTIME` | 39.03 | 42.62 ms | 44 | 44.8 MB |
| `SHARED_CACHE` | 59.03 | 18.90 ms | 44 | 50.3 MB |
| VAT | 56.94-57.71 | 20.26-21.03 ms | 6 | 40.1-43.6 MB |

中端 AVD、20 个实例中 VAT 与 `SHARED_CACHE` 都接近 60 FPS，VAT 只比缓存模式少约 3 个 CPU 百分点，但 5 秒窗口峰值 Draw Call 从 44 降到 6。

30 个实例中 VAT 的重建包出现 40-42 FPS，而同环境 `SHARED_CACHE` 仍接近 60 FPS；即使保留早期 VAT 58.55 FPS 的最好样本，也不能证明收益稳定。

远端 ARM64/Mali、20 个复杂 `tuan42`，每种模式两轮性能样本；Draw Call 来自额外一轮分项采集：

| 模式 | 引擎 FPS | 引擎 P95 | CPU | 5 秒平均 Draw Call | 5 秒峰值 | GPU Instances | Native PSS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `REALTIME` | 15.99-16.30 | 69.75-72.79 ms | 97.2%-98.6% | 22.60-25.71 | 44 | 0 | 53.2-60.6 MB |
| `SHARED_CACHE` | 37.72-39.34 | 36.80-38.15 ms | 76.6%-88.8% | 22.47-25.03 | 44 | 0 | 56.5-57.2 MB |
| VAT | 36.02-40.41 | 37.15-38.35 ms | 30.6%-30.8% | 5.95-6.00 | 6 | 40 | 51.6-52.1 MB |

该 ARM64 环境里，VAT 的 FPS/P95 与 `SHARED_CACHE` 重叠，但 CPU 约降低 46-58 个百分点。官方路径的瞬时 Draw Call 随动画帧在 5-44 间切换，VAT 则稳定为 6；按 5 秒窗口，VAT 将平均 Draw Call 降低约 73%-76%，峰值降低约 86%。VAT 30 实例仍为 6 Draw Call、60 GPU Instances、29.1% CPU，说明主线程和提交扩展性很好；HUD 同时显示 Present 约 13-25 ms，性能上限已经转移到呈现/GPU/云端合成侧。

这台设备的 SoC/GPU 属性互相矛盾，并使用测试温度传感器，疑似云手机。它增加了 ARM64/Mali 路径证据，但不能替代印度目标档实体机。

OPPO K9x 5G 实体机（Android 13、Dimensity 810、Mali-G57 MC2、60 Hz），20 个复杂 `tuan42` 各两轮：

| 模式 | 引擎 FPS | 引擎 P95 | CPU | 5 秒平均 Draw Call | 峰值 | GPU Instances | Native PSS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `REALTIME` | 18.33-18.47 | 60.06-60.26 ms | 110.2%-112.6% | 22.80 | 44 | 0 | 61.4-63.8 MB |
| `SHARED_CACHE` | 54.91-54.94 | 19.01-20.75 ms | 116.0%-117.0% | 22.80-23.23 | 44 | 0 | 57.2 MB |
| VAT | 59.94-60.58 | 16.71-16.77 ms | 48.6%-50.6% | 6.00 | 6 | 40 | 44.0-48.4 MB |

30 实例压力点中，`SHARED_CACHE` 为 40.48 FPS / P95 28.17 ms / CPU 113.0%，VAT 为 60.37 FPS / P95 16.76 ms / CPU 53.8%；前者平均/峰值 Draw Call 为 32.19/64，VAT 固定为 6，GPU Instances 为 60。

100% 电量复测再次得到相同结果。20 实例各两轮均值如下：

| 模式 | 引擎 FPS | 引擎 P95 | SF FPS | SF P95 | CPU | 平均 Draw Call | Native PSS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `REALTIME` | 18.34 | 59.92 ms | 18.58 | 71.96 ms | 106.1% | 23.85 | 58.16 MB |
| `SHARED_CACHE` | 54.65 | 19.51 ms | 54.67 | 33.24 ms | 117.5% | 23.72 | 57.18 MB |
| VAT | 60.18 | 16.89 ms | 59.91 | 16.67 ms | 49.8% | 6.00 | 44.36 MB |

满电 30 实例中，`SHARED_CACHE` 为 41.57 FPS / P95 26.74 ms / SF P95 33.27 ms，VAT 为 60.44 FPS / P95 16.81 ms / SF P95 16.68 ms。

这组数据说明：

- 20 个复杂实例已经到达 VAT 的收益区间，尤其当大厅还要叠加 UI、粒子和脚本时，缓存路径约 116.5% CPU 的余量不足。
- 30 实例时 VAT 的 FPS 提升约 49%，CPU 降低约 52%，收益不再只是 Draw Call 指标。
- `SHARED_CACHE` 仍必须作为第一层优化；它将 `REALTIME` 从约 18.4 FPS 提升到约 54.9 FPS，并保留更多 Spine 功能。
- 满电 SurfaceFlinger 数据证明 `SHARED_CACHE 20` 的实际呈现 P95 约为 33.24 ms，而 VAT 为约 16.67 ms；VAT 确实消除了无法命中 60 Hz VSync 的周期性丢帧。
- 满电与首次测试的 20 实例 FPS 差异不到约 1%，因此首次低电量没有导致结论偏差。
- 当前实体机测试是同一资源重复实例和隔离场景，不能替代真实大厅资源组合、受控功耗和长时间温升验收。

OPPO CPH2823 实体机（Android 16、MediaTek MT6835、Mali-G57 MC2、约 3.53 GiB、应用 60 Hz），20 个复杂 `tuan42` 各两轮：

| 模式 | 引擎 FPS | 引擎 P95 | SF FPS | SF P95 | CPU | 平均 Draw Call | GPU Instances | Native PSS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `REALTIME` | 18.39-20.78 | 53.76-61.62 ms | 18.27-20.82 | 50.10-66.75 ms | 115.2%-116.0% | 22.04-22.14 | 0 | 45.3-52.0 MB |
| `SHARED_CACHE` | 54.02-55.03 | 19.86-20.15 ms | 55.27-55.68 | 33.17-33.24 ms | 136.2%-138.0% | 22.70-23.09 | 0 | 49.5-52.8 MB |
| VAT | 60.00-60.05 | 16.95-17.09 ms | 60.13-60.14 | 16.84-16.87 ms | 117.0%-118.6% | 6.00 | 40 | 37.9-38.4 MB |

30 实例压力点中，`SHARED_CACHE` 为 39.56 FPS / P95 30.92 ms / CPU 126.0%，VAT 为 60.23 FPS / P95 16.89 ms / CPU 117.7%；平均 Draw Call 从 31.93 降到 6，GPU Instances 为 60。

第二台实体机复测带来两个关键修正：

- 帧率、P95 和提交量收益可在不同 Android 版本和不同内存档设备上复现；VAT 20 实例稳定命中 60 Hz，30 实例也没有掉出 60 FPS 档。
- CPU 百分比不能跨设备外推。K9x 的 20 实例 CPU 收益约为 58%，CPH2823 约为 14%；是否释放足够的 CPU 余量，必须在正式目标机单独验收。
- CPH2823 的 `SHARED_CACHE` SF P95 约为 33.2 ms，VAT 约为 16.85 ms，再次证明收益体现在实际呈现而不只是引擎内部 FPS。
- Android 16 SurfaceFlinger 图层解析问题已修复并覆盖重采全部 8 个有效样本；错误扫描没有发现崩溃、Shader error 或 VAT 数据加载异常。

## 什么时候需要 VAT

以下条件必须同时满足，才进入正式 VAT 开发：

1. 真实大厅而不是隔离场景中，`SHARED_CACHE + enableBatch` 的 P95 已超过项目目标。
2. Profiler 显示瓶颈位于 Spine 更新、Renderer/Present 或 Draw Call 提交，而不是脚本、网络、布局、粒子或其他 UI。
3. 目标资源能锁定皮肤、顶点拓扑、slot/attachment 集合、draw order 和 blend 分组。
4. 产品可以接受不支持通用 clipping、换装、动态 attachment、任意混合和 socket 驱动逻辑。
5. 正式目标机或印度目标档低端实体机连续至少三轮证明 VAT 的 P95、CPU、功耗和温升达到预算。两台 OPPO 已提供隔离场景证据，但 CPU 收益不一致，且尚未覆盖正式大厅、电池供电和受控功耗。

满足第 1、2 条但不满足第 3、4 条时，应继续使用官方 runtime，优先做分层更新、减少可见实例、资源拆分、对象池和动画简化。

## 资源内存门槛

当前一个动画资源的 VAT 纹理净数据约 0.81 MB。多个实例共享同一份 VAT 时只支付一次；如果 20 个入口是 20 份完全不同的 VAT，仅纹理净数据约为：

```text
0.81 MB x 20 = 16.2 MB
```

还未计 atlas、Texture2D 对齐、驱动分配、静态 mesh 和包体。因此“同一个动画重复 20 次”适合 VAT，“20 个完全不同的入口动画”未必适合。

## 功能验收清单

- 烘焙前检查每帧 vertex count、index count、indices 和 segment 列表完全一致。
- 明确每套 atlas 的 PMA 语义，并让官方组件、烘焙器和 VAT blend state 保持一致；`FruitMachinePart` 已按非预乘 Alpha 验证通过，通用 VAT 的自动识别后续实现。
- 明确 normal/additive/multiply/screen 的分组策略。
- 禁止或专门实现 clipping、draw-order、动态 attachment 和换装。
- Web/WASM 负责离线烘焙；Native 只加载二进制数据，不在启动时抓 Spine 顶点。
- 验证动画循环边界、颜色/two-color tint、透明排序和不同分辨率。
- 记录 VAT 纹理净字节、实际 GFX Texture Memory、Native PSS、Draw Call、GPU Instances、P50/P95 和温升。

## 下一阶段 Go/No-Go

`Go`：真实大厅低端真机上，官方缓存路径 P95 或 CPU 余量超预算，VAT 至少连续三轮稳定改善 P95/CPU，并且总内存、功耗和温升不恶化到不可接受。

`No-Go`：`SHARED_CACHE` 已满足帧率和 CPU 余量；或每个入口使用不同 VAT 导致纹理累加；或资源依赖 clipping/换装/draw-order；或真实大厅中收益不能复现。

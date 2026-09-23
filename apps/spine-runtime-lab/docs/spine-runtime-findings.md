# Cocos Creator 3.8.7 Spine Runtime 结论摘要

完整源码链路见 [spine-runtime-memory-flow.md](./spine-runtime-memory-flow.md)，VAT 是否上线见 [spine-vat-decision.md](./spine-vat-decision.md)。

## Runtime 模型

`sp.Skeleton` 是 `UIRenderer`，不是 `MeshRenderer`。每个组件拥有独立的动画状态、骨骼姿态、slot 颜色和当前 attachment；`sp.SkeletonData` 保存可复用的骨骼、slot、skin、attachment 和动画定义。因此多个实例共享一份 `SkeletonData` 是安全且优先级最高的资源优化。

| 模式 | 每帧工作 | 内存行为 | 功能限制 |
| --- | --- | --- | --- |
| `REALTIME` | 每帧计算骨骼/attachment 并生成顶点 | 不保存烘焙帧，但 CPU 与拷贝成本按实例增长 | 功能最完整 |
| `SHARED_CACHE` | 复用同一资源、同一动画的缓存帧 | 缓存按动画名、按帧懒创建，并按 `SkeletonData` 共享 | 不支持完整混合/叠加等实时能力 |
| `PRIVATE_CACHE` | 每个组件使用自己的缓存 | 缓存数据按组件增长，不是内存优化 | 与缓存模式相同的功能限制 |

`SHARED_CACHE` 不是一次性按全部动画最大值开辟，也不是 GPU Instancing。全部动画都实际播放并完成缓存后，内存才会逐渐接近所有 clip 缓存之和。

## 合批与 GPU Instancing

`enableBatch` 只影响 Spine 的 2D middleware 提交条件。它仍会为每个实例准备/复制 VB、IB，并不创建 instance buffer。

要做真正的 GPU Instancing，必须使用自定义 `MeshRenderer + Material + Shader` 路径：静态索引和 UV 放在 mesh，每帧顶点位置/颜色放在 VAT，每个实例只提交 transform、时间和少量参数。该方案适合固定皮肤、固定拓扑、少量短动画，不是官方 `sp.Skeleton` 的通用开关。

## 当前 PoC 边界

- 支持 Web/WASM 确定性离线烘焙，Android Native 加载烘焙后的二进制 VAT。
- 当前 `tuan42` 数据为 120 帧、296 顶点、1200 索引，VAT 纹理净数据 852,480 B（约 0.81 MB）。
- normal/additive 分成两个渲染组；20/30 个实例对应 40/60 个 GPU Instances，场景峰值 Draw Call 都是 6。
- 去掉 clipping attachment 和 draw-order 动画，并为初始缺失的 attachment 固定 setup 值；圆角裁剪只做 shader 近似。
- 不支持任意换装、动态 attachment 拓扑、通用 clipping、任意 draw order 和完整 Spine 混合语义。

## 实测决策

在低端 AVD 的 20 个复杂实例中，`REALTIME` 约 39 FPS，`SHARED_CACHE` 约 59 FPS；VAT 初测/重建复测约 57 FPS。模拟器里 VAT 把峰值 Draw Call 从 44 降到 6，但没有超过 `SHARED_CACHE` 的帧率表现。

OPPO K9x 5G 实体机给出了不同且更可信的结果：低电量和满电测试中，20 个 `tuan42` 的 `REALTIME` 都约 18.4 FPS，`SHARED_CACHE` 约 54.5-54.9 FPS，VAT 约 59.7-60.7 FPS；VAT 将进程 CPU 从缓存路径约 116%-118% 降至约 49%-51%，平均/峰值 Draw Call 从约 23-24/44 降至 6/6。满电 30 实例时 `SHARED_CACHE` 约 41.6 FPS，VAT 仍约 60.4 FPS、6 Draw Call、60 GPU Instances。SurfaceFlinger P95 也从缓存路径约 33.24 ms 降至 VAT 约 16.67 ms，确认实际呈现达到稳定 60 Hz。

因此当前顺序是：

1. 共享 `SkeletonData`。
2. 使用 `SHARED_CACHE + enableBatch=true`。
3. 在真实大厅加入 UI、粒子和特效后重新看 Renderer/Present、P95、Draw Call 与 PSS。
4. 类似 `tuan42` 的复杂固定拓扑资源若以 60 FPS 为目标，可进入 VAT 专项工程化；简单资源或缓存路径已达标时不引入 VAT。
5. 正式上线前仍需在真实大厅和目标市场设备上验证资源组合、功能正确性、纹理总量、功耗和长时间温升。

## 资料

- Cocos Creator 3.8 Spine 资源：<https://docs.cocos.com/creator/3.8/manual/zh/asset/spine.html>
- Cocos Creator 3.8 Skeleton 组件：<https://docs.cocos.com/creator/3.8/manual/zh/editor/components/spine.html>
- Cocos 论坛 VAT 方案：<https://forum.cocos.org/t/topic/176384>

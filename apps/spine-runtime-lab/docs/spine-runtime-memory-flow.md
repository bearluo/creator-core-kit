# Cocos Creator 3.8.7 中 Spine 播放的源码级内存流程

本文针对 Cocos Creator 3.8.7 的内置 `sp.Skeleton`，回答两个问题：

1. Spine 资源加载、创建实例、播放动画时，内存分别在哪里开辟、在哪里复用？
2. 用户提供的论坛方案（[Spine 动画 GPU 化实战：用 VAT 把骨骼计算挪出主线程](https://forum.cocos.org/t/topic/176384)）在“固定皮肤、简单动画、很少使用 slot 高级功能”的前提下，是否值得做？

## 1. 先给结论

- `SkeletonData` 是共享的资源层；它保存骨骼、slot、skin、attachment、draw order 和动画定义，不保存某个实例当前的姿态。多个 `sp.Skeleton` 可以引用同一个 `SkeletonData`。源码在 `cocos/spine/skeleton.ts:351-359`。
- 每个 `sp.Skeleton` 默认仍有自己的 `spine.SkeletonInstance`，其中包含当前动画状态、骨骼姿态、slot/attachment 状态和运行时渲染结果。构造函数见 `cocos/spine/skeleton.ts:331-344`。
- `REALTIME` 每帧调用 Spine WASM runtime 更新动画并生成顶点/索引；随后把 WASM HEAP 中的数据拷贝到 Cocos `RenderData`。这条路径功能最完整，但 CPU 更新和内存拷贝随实例数增长。
- `SHARED_CACHE` 不是 GPU instancing。它把相同 `SkeletonData` 的动画帧缓存放在全局 `SkeletonCache.sharedCache` 中，多个实例复用同一组帧数据，主要节省 CPU；缓存本身会增加内存。
- `PRIVATE_CACHE` 为每个组件创建独占缓存，适合不能共享缓存的特殊情况；它通常是性能选项，不是内存优化选项。
- `enableBatch` 只是 2D middleware 的合批条件开关，不会把 Spine 骨骼计算迁移到 GPU，也不会自动产生 instance buffer。
- 论坛 VAT 方案是另一条渲染路径：离线烘焙每一帧的顶点，把动画采样放到 shader。对固定皮肤、固定 slot 结构、少量简单动画的同屏单位，它有机会同时降低主线程骨骼计算和 draw call，但需要接受功能约束，并自行实现导出工具、shader、实例数据和批处理。

## 2. 源码版本与位置

以下行号来自本机安装的 Cocos Creator 3.8.7：

```text
C:\ProgramData\cocos\editors\Creator\3.8.7\resources\resources\3d\engine
```

主要文件：

| 文件 | 作用 |
| --- | --- |
| `cocos/spine/skeleton-data.ts` | Creator `SkeletonData` 资源到 Spine runtime 数据的转换和释放 |
| `cocos/spine/skeleton.ts` | `sp.Skeleton` 组件、缓存模式、播放、渲染提交和销毁 |
| `cocos/spine/skeleton-cache.ts` | `SHARED_CACHE`/`PRIVATE_CACHE` 的动画帧、骨骼快照和引用计数 |
| `cocos/spine/assembler/simple.ts` | 从 WASM 或缓存帧填充 Cocos 顶点/索引缓冲 |
| `cocos/2d/renderer/batcher-2d.ts` | `enableBatch` 最终能否合批的判断 |

本文中的行号用于定位实现，升级 Creator 版本后应重新核对；它们不是公共 API 契约。

## 3. 资源加载：`SkeletonData` 和 WASM runtime

### 3.1 Creator 资源层

`SkeletonData` 资源对象持有 JSON 或二进制原始数据、atlas 文本、纹理数组和纹理名称。它们是 JS/Creator 资源层的内存，纹理对象最终还会对应 GPU texture。runtime 句柄通过 `_skeletonCache` 懒加载保存。

入口是 `SkeletonData.getRuntimeData()`（`skeleton-data.ts:199-236`）：

1. 如果 `_skeletonCache` 已存在，直接返回（`199-202`），同一个资源不会重复解析。
2. 以 `mergedUUID()` 查询 WASM 侧按 UUID 注册的数据（`211-215`）。因此相同资源/内容可以复用已创建的 runtime `SkeletonData`。
3. JSON 资源调用 `createSpineSkeletonDataWithJson(...)`（`222-224`）。
4. 二进制资源先创建一块临时 WASM store memory，把 `_nativeAsset` 拷贝进去（`226-230`），调用 `createSpineSkeletonDataWithBinary(...)`（`231-232`），最后 `freeStoreMemory()`（`233`）。这块 store memory 是解析输入的临时内存，不是每帧动画缓存。
5. 创建后按 UUID 注册（`224`、`232`），后续组件共用该 runtime 数据。

因此，加载阶段至少会短暂存在：

```text
Creator/JS 资源（JSON 或 nativeAsset + atlas + 纹理引用）
        |
        +--> WASM runtime SkeletonData（解析后的骨骼/动画定义）
        |
        +--> GPU texture（atlas 页面，实际上传由纹理资源流程负责）
```

`SkeletonData.destroy()` 位于 `skeleton-data.ts:297-300`：先清理该 UUID 的缓存动画，再销毁 WASM runtime `SkeletonData`。这不是销毁某个 `sp.Skeleton` 实例；实例应走组件的 `onDestroy()`。

## 4. 创建 `sp.Skeleton`：共享定义，独立状态

构造函数 `skeleton.ts:331-344` 在非 native（JS/WASM）路径创建一个新的 `spine.SkeletonInstance`。随后设置时间倍率、缓存标记和附件工具。

源码注释明确说明（`skeleton.ts:351-359`）：

- `SkeletonData` 含绑定姿态、骨骼、slot、draw order、attachment、skin 和动画定义；
- `SkeletonData` 不持有实例状态；
- 多个 skeleton 可以共享同一份 skeleton data。

可以把一组实例拆成两层：

| 层 | 典型内容 | 是否应共享 |
| --- | --- | --- |
| 资源/定义层 | bones/slots/skins/attachments/animations、atlas 和纹理引用 | 应共享同一个 `SkeletonData` |
| 实例/状态层 | 当前动画轨道、混合时间、骨骼 world transform、slot 颜色、当前 attachment、事件状态 | 每个可独立控制的实例独有 |

所以“创建 200 个 Spine”并不等于“解析 200 份 JSON”；但如果每个实例需要不同姿态，实时模式仍然要做 200 次实例更新。

## 5. 三种播放模式的实际路径

### 5.1 `REALTIME`

`setSkeletonData()`（`skeleton.ts:830-870`）在非缓存模式下直接执行：

```ts
this._skeleton = this._instance!.initSkeleton(skeletonData);
this._state = this._instance!.getAnimationState();
```

每帧的入口是 `updateAnimation(dt)`（`skeleton.ts:1077-1107`）：

```text
SkeletonSystem
  -> Skeleton.updateAnimation(dt)
  -> spine.SkeletonInstance.updateAnimation(dt)
  -> SkeletonInstance.updateRenderData()
```

`Skeleton.updateRenderData()`（`skeleton.ts:1163-1171`）在实时模式调用 `_instance!.updateRenderData()`，返回包含顶点指针、索引指针、顶点数、索引数和分段材质/纹理信息的 runtime model。

随后 `assembler/simple.ts:152-208` 的 `realTimeTraverse()`：

1. 读取 WASM `HEAPU8` 中 `model.vPtr`/`model.iPtr` 指向的顶点和索引（`171-178`）；
2. 必要时扩大 `RenderData`、创建 `Uint16Array` 索引和顶点视图（`160-169`）；
3. 将 WASM 数据拷贝到 Cocos 的动态 vertex/index buffer（`177-180`）；
4. 按 draw segment 请求材质和纹理（`182-192`）；
5. `enableBatch` 时把顶点乘以节点 world matrix（`194-208`），以便跨组件合批。

这解释了实时模式的两类成本：

- **计算成本**：每个实例都在 WASM runtime 中推进 AnimationState、骨骼矩阵、slot/attachment 和三角形顶点；
- **拷贝/上传成本**：runtime 输出先在 WASM HEAP，再复制到 Cocos `RenderData`，最后由渲染器上传/提交。

它不会按动画时长预先保存所有帧，因此通常比缓存模式省内存，但每帧 CPU 工作更多。

### 5.2 `SHARED_CACHE`

`isAnimationCached()`（`skeleton.ts:1377-1380`）只要 cache mode 不是 `REALTIME` 就返回 true。

`setSkeletonData()` 在 `SHARED_CACHE` 下把组件指向全局 `SkeletonCache.sharedCache`（`skeleton.ts:830-840`），再通过 `createSkeletonInfo()` 获取该资源的共享 skeleton info（`skeleton.ts:846-860`）。`SkeletonCache.createSkeletonInfo()`（`skeleton-cache.ts:388-420`）维护：

- 一个缓存用 `spine.Skeleton`；
- 一个 listener；
- 该资源的 `animationsCache` 映射；
- `_sharedCacheMap` 引用计数（`388-399`）。

第一次播放某个动画时，`initAnimationCache()`（`skeleton-cache.ts:435-458`）创建 `AnimationCache`。它内部有一个专用 `SkeletonInstance`（`95-104`），然后按固定 60 FPS 逐帧烘焙：

```text
AnimationCache.updateToFrame(frameIdx)       skeleton-cache.ts:138-153
  -> instance.updateAnimation(1 / 60)
  -> instance.updateRenderData()
  -> updateRenderData(frameIndex, model)
```

每一帧 `updateRenderData()`（`166-218`）会分配/保存：

- `Uint8Array` 顶点数据（`170`、`185-189`）；
- `Uint16Array` 索引数据（`171`、`185-189`）；
- 每个 draw segment 的 `SpineDrawItem`（`191-200`）；
- 每根骨骼的 `FrameBoneInfo`（`202-217`），包含 `a/b/c/d/worldX/worldY`。

缓存上限是 `MaxCacheTime = 30` 秒、`FrameTime = 1 / 60`（`skeleton-cache.ts:32-33`）。实际缓存会在动画完成前或达到 30 秒时停止，而不是无界增长。

#### 不是一次性把全部动画分配出来

这里容易产生一个误解：Creator 3.8.7 **不会在切换到缓存模式时，把 `SkeletonData` 中的全部 animation 一次性烘焙并分配一块总内存**。

- `SkeletonCacheItemInfo.animationsCache` 初始是空对象（`skeleton-cache.ts:409-418`）。
- `Skeleton.setAnimation()` 先按动画名查询缓存；只有该 clip 不存在时才调用 `initAnimationCache(..., name)`（`skeleton.ts:959-967`）。
- `AnimationCache` 构造时 `frames` 只是空数组（`skeleton-cache.ts:76-104`）；`setAnimation()` 只计算 `_maxFrameIdex`，不会按最大帧数预分配所有 `AnimationFrame`（`121-136`）。
- `setAnimation()` 随后调用 `updateToFrame(0)` 生成首帧（`skeleton.ts:974-979`）；后续帧在实际播放到对应时间时由 `updateToFrame(frameIdx)` 追加/写入（`skeleton-cache.ts:138-153`）。

因此，缓存是“**按动画 clip 懒创建、按播放进度逐帧增长**”。但已经播放过的 clip 会留在 `animationsCache[animationName]` 中（`skeleton-cache.ts:441-455`），切换到下一个动画不会自动释放上一个 clip 的帧。一个资源最终播放过多个动画后，常驻内存可能接近：

```text
所有已经缓存的 clip 的帧内存之和
≈ Σ 每个 clip 的 min(动画时长, 30 秒) × 60 帧/秒 × 单帧数据量
```

这很可能就是“缓存模式按全部动画一起算一个上限”的观感来源：如果测试脚本依次预热了全部动画，最后看到的确实是多个 `AnimationCache` 的累加；但它不是进入缓存模式时一次性分配的单个大块。

`invalidAnimationFrames()` 会把 `frames.length` 置零（`skeleton-cache.ts:160-164`），shared cache 回收时还会把对象放入 pool（`349-379`）。这会解除帧数组的逻辑引用，但 JS/WASM/引擎分配器的实际 RSS/显存下降仍受垃圾回收和底层内存池时机影响，不能用一次采样立即判断已经归还给操作系统。

播放时，`Skeleton._updateCache()`（`skeleton.ts:1110-1151`）只推进缓存帧索引，并把当前帧的骨骼快照交给 `attachUtil`；`Skeleton.updateRenderData()`（`1163-1167`）返回当前帧的 `SpineModel`，不再调用当前组件的 runtime `updateRenderData()`。

`assembler/simple.ts:275-350` 的 `cacheTraverse()` 再把缓存帧的 `vData/iData` 拷贝到组件的 `RenderData`，处理节点颜色/预乘 Alpha，生成 draw data，并在需要时应用 world matrix。

因此 `SHARED_CACHE` 的准确含义是：

- 多个实例共用一个资源的缓存骨骼和动画帧；
- 每个组件仍有自己的节点、显示状态和控制对象；
- 首次播放/缓存失效时，仍由 CPU/WASM 烘焙缓存；
- 后续播放主要是按帧读取和拷贝，省掉了重复的骨骼动画计算。

### 5.3 `PRIVATE_CACHE`

`setSkeletonData()` 在 `PRIVATE_CACHE` 下创建新的 `SkeletonCache` 并调用 `enablePrivateMode()`（`skeleton.ts:835-837`）。后续 `createSkeletonInfo()`、`AnimationCache` 和帧数组只属于当前组件。

销毁时，`SkeletonCache.destroySkeleton()`（`skeleton-cache.ts:349-386`）在 private mode 对每个动画缓存调用 `animationCache.destroy()`（`369-372`），并销毁缓存 skeleton。shared mode 则把可复用的动画缓存清理后放回 pool（`365-379`），以减少下一次创建 TypedArray 的开销。

`PRIVATE_CACHE` 的适用前提是该实例需要自己的 skin/缓存生命周期，或者不能与同资源的其他实例共享；它的代价是缓存帧和缓存 skeleton 也按组件增加。

## 6. 渲染内存到底在哪里

### 6.1 实时模式

```text
Spine WASM HEAP
  model.vPtr / model.iPtr
       |
       | Uint8Array.set（每帧拷贝）
       v
Cocos RenderData / MeshBuffer
  vertex buffer + index buffer
       |
       | accessor.setDirty / renderer 提交
       v
GPU vertex/index buffer
```

对应源码是 `simple.ts:171-180`。当顶点数或索引数改变时，`RenderData.resize()` 和新的 `Uint16Array` 会在 `simple.ts:160-169` 创建；稳定后通常复用已分配容量。

### 6.2 缓存模式

缓存模式多了一份“按动画帧保存”的 CPU 数据：

```text
WASM HEAP（只在烘焙时读取）
       |
       v
AnimationCache.frames[]
  AnimationFrame
    -> SpineModel.vData / iData / meshes
    -> FrameBoneInfo[]
       |
       | 每帧播放时复制
       v
当前组件 RenderData -> GPU vertex/index buffer
```

注意：`AnimationCache.frames` 中的顶点和索引是 JS typed array，不是直接把 WASM 指针长期保存下来；源码在 `skeleton-cache.ts:166-189` 明确做了复制。因此缓存模式降低的是“重新计算”的 CPU 时间，不是把数据永远留在 WASM HEAP。

### 6.3 纹理、材质和 GPU 内存

- atlas PNG/JPG 由 Creator 纹理资源管理，最终占用 GPU texture 显存；多个 skeleton 只要引用同一纹理对象就能复用该显存。
- `RenderData`/`MeshBuffer` 保存动态顶点和索引，上传后对应 GPU buffer；它和 Spine atlas texture 是两种不同的 GPU 内存。
- material、blend mode、纹理页、裁剪和 draw order 会影响 draw segment 数，进而影响提交次数；它们不是 `SkeletonData` 帧缓存。

## 7. `enableBatch` 不是 GPU instancing

`Skeleton._render()`（`skeleton.ts:1186-1206`）逐个 draw item 调用 `batcher.commitMiddleware(...)`（`1195-1199`）。真正的合批条件在 `batcher-2d.ts:546-581`：

- `enableBatch` 为 true；
- middleware 使用同一个 mesh buffer；
- texture 相同；
- material hash 相同；
- index 在同一连续区间；
- layer 相同。

满足条件时只是把 index count 合并（`557-562`），否则先结束上一批并重置状态（`563-580`）。它减少的是 draw call/状态切换，不会消除 `spine.SkeletonInstance.updateAnimation()`，也不会创建每实例 attribute buffer。

另外，`simple.ts:194-208` 和 `275-350` 显示了开启 batch 时的一个代价：顶点要先乘节点 world matrix，以便把多个组件的顶点放进同一批次。

## 8. 销毁和回收链路

组件销毁 `Skeleton.onDestroy()`（`skeleton.ts:719-744`）依次做以下事情：

1. 移除事件监听、销毁 draw list 和 render data（`720-726`）；
2. 清空材质缓存、顶点/索引临时引用、附件和 socket 映射（`727-733`）；
3. 清理动画缓存引用，移除 `SkeletonSystem`（`734-736`）；
4. 销毁当前组件的 `SkeletonInstance`（`737-740`）；
5. 调用 `_destroySkeletonInfo()`（`741-742`），由所属 `SkeletonCache` 按 shared/private 规则减少引用或真正释放。

`SkeletonData.destroy()`（`skeleton-data.ts:297-300`）还会清理该 UUID 的缓存动画并调用 `destroySpineSkeletonDataWithUUID()`。所以场景切换/Bundle 卸载时，必须同时确认：

- 没有节点仍引用该 `SkeletonData`；
- 没有缓存模式实例仍持有对应的 `SkeletonCacheItemInfo`；
- atlas 纹理资源也在预期生命周期内释放。

## 9. 内存分类和增长方向

| 内存类别 | 实时模式 | `SHARED_CACHE` | `PRIVATE_CACHE` |
| --- | --- | --- | --- |
| Creator/JS 资源 | 1 份 `SkeletonData` + 纹理引用 | 同左 | 同左 |
| WASM runtime 定义 | 按 UUID 复用 | 按 UUID 复用 | 按 UUID 复用 |
| 实例姿态/AnimationState | 每个实例 1 份 | 组件控制状态仍按实例存在；缓存骨骼/帧可共享 | 按实例独占缓存 skeleton |
| 动画顶点/索引帧 | 不预存整段动画 | 资源/动画 1 份（共享） | 每实例 1 份 |
| Cocos RenderData | 每组件 1 份动态 buffer | 每组件 1 份，用于复制当前帧 | 每组件 1 份 |
| GPU texture | atlas 页共享 | atlas 页共享 | atlas 页共享 |
| GPU vertex/index buffer | 每组件/批次按需增长 | 同左 | 同左 |

缓存内存的近似增长方向是：

```text
缓存内存 ≈ 帧数 ×（顶点数 × 顶点步长 + 索引数 × 2）
          + 帧数 × 骨骼数 × FrameBoneInfo 大小
          + 帧数 × draw segment 元数据
```

实际布局和对象开销还受 JS typed array、数组容量、材质分段、是否使用 tint 等因素影响，不应只用三角形数量估算。

## 10. 论坛 VAT 方案和官方 runtime 的关系

论坛帖子报告的是自定义 VAT（Vertex Animation Texture），不是给官方 `sp.Skeleton` 打开一个 GPU instancing 选项。帖子给出的对比（以帖子原文为准）是：200 个相同 Spine、约 28,840 个三角面、连续采样 1,729 帧时，原生 Spine 平均帧时间 33.89 ms，VAT 4.88 ms；Render 29.98 ms 降到 4.40 ms，Draw Call 203 降到 5。这个结果的核心原因是：

1. 动画顶点提前离线烘焙，运行时不再对每个实例执行完整 Spine 骨骼求值；
2. 多实例使用同一套几何/纹理和 shader，通过实例参数或统一时间/帧索引采样；
3. draw call 从“多个动态 Spine draw segment”变成少量批次。

### 10.1 在用户限定场景下，VAT 可以省掉什么

如果单位满足“固定皮肤、固定 slot/attachment 结构、只播放少量简单 clip”，VAT 可以把以下工作移出主线程：

- AnimationState、骨骼 world transform 和约束求值；
- 每帧从 Spine runtime 生成 CPU 顶点；
- 每个实例把 WASM 顶点拷贝到 Cocos `RenderData`；
- 大量实例的独立 draw segment 提交。

GPU 侧只需要按 `instanceId + animationId + localTime` 采样 VAT，并叠加实例 transform、颜色和可选的简单参数。这正是它适合大量相同 NPC/特效的原因。

### 10.2 必须主动限制的能力

专用 VAT renderer 通常不能低成本保留以下官方 runtime 能力：

- 任意运行时换 skin、换 attachment、slot 动态显隐；
- 动画混合、叠加轨道和复杂事件回调；
- clipping attachment、动态裁剪和任意 draw order；
- 每个 slot 的独立 tint、顶点变形、IK/Transform/Path constraint；
- 需要 CPU 精确骨骼坐标的 socket、碰撞、挂点逻辑。

这些功能不是“再加一个 uniform”就能完整恢复；它们会改变烘焙顶点、纹理布局或实例数据模型。

### 10.3 VAT 的内存交换

VAT 并不是无内存成本，而是把内存从 CPU 动态计算/缓存转为离线资产和 GPU texture：

```text
官方 REALTIME：CPU/WASM 每帧计算 + RenderData/GPU buffer
官方 CACHE：CPU 保存多帧顶点/索引/骨骼快照 + RenderData/GPU buffer
VAT：GPU VAT texture 保存多帧顶点 + 少量静态 mesh/实例参数
```

VAT 纹理大小主要取决于：动画帧数、采样帧率、顶点数、每顶点通道数、纹理格式和压缩方式。它可能增加显存，但不一定明显增加总显存；需要用真实导出数据测量，不能直接套用帖子中的显存数字。

## 11. 当前 PoC 已验证的 Native 架构

Web/WASM 的 `skeleton.updateRenderData()` 会返回包含 `vPtr/iPtr/vCount/iCount` 的 model，因此可以从 WASM HEAP 确定性复制每帧顶点和索引。Creator 3.8.7 Native 则由 C++ 直接把渲染数据写入 `RenderEntity`，同名调用不会向 TypeScript 返回这些指针。

因此 Android 的正确链路不是“启动时再烘焙”，而是：

```text
Web/WASM 以 60 FPS 离线烘焙
  -> metadata + position/light/dark 二进制数据 + 静态索引
  -> 作为 resources 随包发布
  -> Android Native 创建 VAT 纹理和静态 mesh
  -> MeshRenderer GPU Instancing
```

当前 `tuan42` 烘焙结果为 120 帧、296 顶点、1200 索引，position/light/dark 纹理净数据为 852,480 B（约 0.81 MB）。normal 与 additive 分成两个渲染组。

## 12. 固定拓扑限制

原始 `tuan42` 不能直接作为通用 VAT：

- clipping 每帧重新裁三角形，顶点数和索引会变化；
- draw-order 会改变 packed vertex identity；
- 动画开头 additive attachment 缺失会改变顶点数；
- 动态换装、任意 attachment 切换和完整混合都可能破坏固定拓扑。

PoC 为此去掉 clipping attachment 和 draw-order 动画，给 speedline slot 固定 setup attachment，并用 shader 圆角矩形近似原裁剪。它适合“大厅简单动画、很少使用 slot 高级功能”，不能宣称兼容所有 Spine 资源。

## 13. 水果机同屏约 20 个元素的最终建议

复杂 `tuan42` 在低端 AVD 的 20 实例结果显示：`REALTIME` 约 39 FPS，`SHARED_CACHE` 约 59 FPS，VAT 初测/重建复测约 57 FPS。VAT 将峰值 Draw Call 从 44 降到 6，并降低部分 Native PSS，但没有带来稳定帧率优势。

因此当前决策是：

1. 共享同一份 `SkeletonData`。
2. 默认使用 `SHARED_CACHE + enableBatch=true`，而不是 `REALTIME` 或 `PRIVATE_CACHE`。
3. 不因“20 个入口”这个数量直接上 VAT。
4. 集成真实大厅后再测 Renderer/Present、P95、Draw Call、CPU 和 Native PSS；只有官方缓存路径在真实负载下超预算，才进入 VAT。
5. VAT 只接受固定皮肤、固定拓扑、短动画、无通用 clipping/draw-order/换装的资源。
6. 如果 20 个入口分别使用 20 份不同 VAT，当前规格仅 VAT 纹理净数据就约 16 MB；资源不共享时可能得不偿失。

完整门槛和 Android/Web 数据分别见 `spine-vat-decision.md`、`android-test-results.md` 和 `spine-vat-web-results.md`。

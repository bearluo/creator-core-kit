# Spine VAT Player

状态：已实现
摘要：运行时的两个组件：`spinevat.Skeleton`（3D，MeshRenderer + GPU instancing）和 `spinevat.UiSkeleton`（2D，UI batch）。两者共用同一套播放状态机和 shader 帧计算：每个实例的播放参数只在状态变化时上传，正常播放时 CPU 每帧零写入。
何时读：修改组件、播放 API、逐实例参数、合批或资源共享时。
依赖：[Compiler](spine-vat-compiler.md)；数据格式和真机结果见 [总览](spine-vat-overview.md)；安装与用法见 [扩展 README](../../extensions/spine-vat-importer/README.md)

## 代码（`extensions/spine-vat-importer/assets/runtime/`）

| 文件 | 内容 |
|---|---|
| `SpineVatSchema.ts` | manifest 类型 |
| `SpineVatSkeletonData.ts` | 资源类 `spinevat.SkeletonData`：manifest，以及 position / light / dark 页、atlas、两个 effect 的引用 |
| `SpineVatPlayback.ts` | 纯逻辑播放状态机：锚点、帧号、事件、socket、实例颜色打包 |
| `SpineVatRenderResources.ts` | 3D：共享的网格、材质、贴图（按引用计数），`SpineVatRenderHandle`；以及两个组件共用的 `compilePages` / `singleLayout` / `vatChannelDefines` |
| `SpineVatSkeleton.ts` | 3D 组件 `spinevat.Skeleton`（继承 `MeshRenderer`） |
| `SpineVatUiSkeleton.ts` | 2D 组件 `spinevat.UiSkeleton`：分槽位、分组、写入 UBO |
| `SpineVatUiLane.ts` | 2D 的 lane 提交：`UIRenderer` + 自定义 assembler |
| `../spine-vat-v2.effect`、`../spine-vat-ui.effect` | 3D / 2D shader。帧计算、插值、剪裁两边写法相同，改一处要同步另一处 |

导入器（`dist/asset-db.js`，扩展版本 1.5.0）把 `manifest.spinevat` 导入成 `spinevat.SkeletonData`，并把两个 effect 挂成它的依赖（`effectAsset` / `uiEffectAsset`），所以组件只需要赋 `skeletonData`。

## 播放状态机（`SpineVatPlayback`）

不累加每帧的 dt，只保存「时间锚点 + 浮点帧锚点」，由 shader 按引擎时间现算：

```text
rawFrame = anchorFrame + (cc_time.x - anchorTime) × fps × speed
frame    = manualFrame ≥ 0 ? manualFrame
         : loop ? mod(rawFrame, frameCount)
         : clamp(rawFrame, 0, frameCount - 1)
```

| API | 做法 |
|---|---|
| `play(name, { loop, speed, startTime })` | 换 clip，锚点重置为 `startTime × fps` |
| `pause()` / `resume()` | 暂停时把当前浮点帧存进锚点、speed 写 0；恢复时只重置时间锚点，从暂停时的亚帧位置继续 |
| `seek(seconds)` | 锚点帧改为 `seconds × fps`，并清掉手动帧 |
| `setTimeScale(speed)` | 先把旧速度下的当前帧存进锚点，再换速度，画面不跳 |
| `setLoop(loop)` | 只改标志 |
| `setManualFrame(frame \| null)` | 固定到某帧（可带小数，开启插值时 shader 会在两帧之间插值）；传 `null` 从固定帧继续播放 |
| `setColor([r, g, b, a])` | 实例整体颜色；premultiplied 资源会先把 rgb 乘上 a 再上传 |

每次调用都会把三个 vec4 写给 GPU：

| 字段 | x | y | z | w |
|---|---|---|---|---|
| `anim0` | clip.frameOffset | clip.frameCount | clip.fps | anchorTime |
| `anim1` | anchorFrame | speed（暂停为 0） | loop 1/0 | 手动帧（< 0 表示自动播放） |
| `color` | r | g | b | a |

shader 细节：

- 循环取模后再 `min(…, frameCount - 1)` 一次。GPU 上 `mod` 的商有误差，恰好是整数倍时可能返回 `frameCount`，落到下一段动画的第 0 帧，表现为每圈回绕闪一帧（Mali / Adreno 上出现过）。
- `VAT_LERP`：取相邻两帧插值；末帧循环时插回第 0 帧，不循环时不插。两帧 uv 不同（换了附件或是空槽）就退回阶跃。剪裁多边形用同一个 t 插值；剪裁生效状态切换的那一帧不插。

## 3D：`spinevat.Skeleton`

- 继承 `MeshRenderer`，一个组件就是一个实例；节点的变换就是实例的变换，组件不创建子节点。
- 同一份 `SkeletonData` 且插值开关相同的实例，共享同一个网格（每条 lane 一个 submesh，顶点 `a_position.x` = 帧内顶点号，索引取自 `lane.indices`）、每条 lane 一个材质（technique = alpha mode × blend，共 8 个），以及全部数据贴图。按引用计数，最后一个实例销毁时一起释放。
- 逐实例参数走 instanced attribute（`a_vatAnim0/1`、`a_vatColor`，`setInstancedAttribute`），所以不同动画、相位、速度、颜色的实例仍在同一个 instancing batch 里。天玑 700 实测 30 / 150 / 600 个实例的 DC 都是 6。
- 加载是异步的（`reload()`）。`await` 返回后，若组件已失效、禁用，或期间又发起了新的加载（代号 `loadGeneration` 变了），就丢弃这次的结果。
- 编辑器里 `Preview In Editor` 为真时直接预览。

## 2D：`spinevat.UiSkeleton`

- 挂在 UI 节点上，为每段「相邻、同材质、同 atlas」的 lane 各建一个 `spinevat.UiLane` 子节点（`DontSave` 不存进场景 / prefab，`HideInHierarchy` 不出现在层级面板），所以绘制顺序就是兄弟顺序，可以和 Sprite、`sp.Skeleton` 穿插、互相遮挡。组件禁用时拆掉这些子节点、释放槽位。
- 编辑器里 `Preview In Editor` 为真时直接预览（`executeInEditMode` + `playOnFocus`）。Inspector 改 `Loop` / `Time Scale` / `Preview In Editor` 和撤销不走 setter，`update` 里比对属性签名发现后重建。
- **分组**：每组一套材质，UBO 数组 `vatInstances` 里放 48 个实例，每个实例 5 个 vec4（anim0、anim1、color、2×2 变换、平移）。实例按创建顺序占槽，满 48 个再开新组；不同组的材质不同，组之间必然断批。插值开关不同的实例不会进同一组。某组最后一个实例释放时销毁这组的材质，最后一组也释放时再销毁贴图。
- **顶点**：每个顶点只有一个 float，`a_vatVertex = (槽位 + additive ? 64 : 0) × 16384 + 帧内顶点号`，只在建 chunk 时写一次；每帧 native 整块重传的 UI 顶点因此最小。单帧顶点数（`frameStride`）必须 ≤ 16384。
- **混合**：normal 和 additive 共用 merged technique（one / one_minus_src_alpha），additive 顶点在 FS 里把 a 置 0，结果为 rgb + dst。这和官方 Spine 让 additive 同批的做法相同。multiply 和 screen 各用自己的 technique。
- **上传**：
  - `lateUpdate` 只在世界矩阵真的变了时才标脏；组在 `EVENT_BEFORE_DRAW` 时整组 `setUniformArray` 一次。
  - web 端改写了这批 MeshBuffer 的 `uploadBuffers`，顶点、索引没变就不传。
  - native 在 dirty 标记上额外置一个高位。只有打了引擎补丁（`CCK_VAT_UI_STATIC_VB`，`native/engine/common/Classes/engine-patches/UIMeshBuffer.cpp`）的引擎才认这个高位；原版引擎行为不变。
- VAT 专用的 `StaticVBAccessor` 首次创建时，临时把 `BATCHER2D_MEM_INCREMENT` 调到 255 KB（65280 顶点）。默认的 144 KB 只装得下大约 11 个实例，一换 buffer 就断批。

## 事件与 socket

- `onVatEvent(cb)`：两个组件都在每帧的 `update` 里调用 `drainEvents`（没有监听时也照常推进游标，免得后加的监听一次补发积压的事件），派发上次检查位置到当前浮点帧之间的事件。支持正放、倒放、跨多圈循环、暂停/恢复。`seek` 和手动帧只移动游标，不补发跳过的事件。一次更新最多派发 4096 个，超出就抛错。
- `socket(name)`：按当前离散帧从 manifest 的 socket 轨道读取 `[a, b, c, d, worldX, worldY]`，不需要运行 Spine Runtime。
- `sockets` 属性（`SpineVatSocket.ts`，同官方 `sp.Skeleton` 的 Sockets）：每项是骨骼名 + 目标节点，`lateUpdate` 把该骨骼的矩阵写成目标节点的本地矩阵。骨骼矩阵在骨架空间，也就是 VAT 节点的本地空间，所以目标节点要放在 VAT 节点下面；骨骼的缩放也会带到目标节点上。骨骼没有烘焙 socket 数据时跳过，并在控制台警告一次。
- 两个组件都提供这两个接口和 `snapshot()`。监听挂在组件上，不随内部资源走：资源加载完成前就能注册，3D 的 `reload()`、2D 换 `skeletonData` / `initialClip` 重建都不会清掉，组件销毁时才清空。

## 插值开关

两个组件各有一个静态开关 `interpolate`（默认 true），对应编译期宏 `VAT_LERP`。开启后 VS 采样次数翻倍，CPU 开销不变。它只影响之后创建的实例，建议启动时按机型档位设定一次。

## 已知行为与坑

- 透明实例在一个 instancing batch 内不会逐实例排序（Cocos 的行为）。3D 实例重叠、又要求严格的前后关系时，要按层拆开；2D 靠兄弟顺序，没有这个问题。
- 2D 组件所在节点的 layer 必须在渲染它的相机的 visibility 里（通常是 UI_2D）。编辑器的场景视图所有层都看得见，放错层只会在预览 / 运行时看不见。lane 子节点每帧跟随父节点的 layer。
- 2D 每 48 个实例一组，DC 随实例数线性增长（天玑 700：30 / 150 / 600 实例分别是 3 / 8 / 23 个 DC）。
- 没有 crossfade，切动画是硬切。固定槽位下各动画的顶点一一对应，技术上可以直接做淡入淡出，但还没实现。
- 只能播放烘焙过的动画和默认 skin，不支持运行时换装或 `setAttachment`。
- `VAT_CLIP` 额外占用 5 行 varying，只支持 WebGL1 的机器可能编不过（见总览）。
- 实验室的 web 调试入口（`?vat2=1&count=…&independent=1`，`window.__SPINE_VAT_V2_*`）在 `assets/perf/SpineLabDriver.ts` 里，测试用的实例群在 `SpineVatRuntimePopulation.ts`，不属于组件 API。

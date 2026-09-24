# Spine VAT Compiler

状态：已实现
摘要：把 Analyzer 通过的动画烘成固定槽位 VAT：两套骨骼同步采样，分配槽位、切 lane，写入帧数据、剪裁区和静态区，分页后输出 `spine-vat-2` manifest 与各 `.bin`。
何时读：改采样、槽位分配、纹理布局、分页或 manifest 字段时。
依赖：[Analyzer](spine-vat-analyzer.md)；数据格式的设计理由见 [总览](spine-vat-overview.md)

## 代码

| 文件 | 内容 |
|---|---|
| `extensions/spine-vat-importer/bake/src/SpineVatBaker.ts` | 官方（剪裁后）输出的逐帧采样，以及 socket 骨骼矩阵 |
| `extensions/spine-vat-importer/bake/src/SpineVatFixedBaker.ts` | 去掉剪裁附件的 SkeletonData；逐帧列出画出来的附件和剪裁归属 |
| `extensions/spine-vat-importer/bake/src/SpineVatFixedLayout.ts` | 纯逻辑：检查规则、分配槽位、切 lane、写帧（`planFixedLayout` / `writeFixedFrame`） |
| `extensions/spine-vat-importer/bake/src/SpineVatCompilerV2.ts` | 入口 `bakeAndCompileSpineVatV2`，以及纯逻辑的 `compileSpineVatV2`：通道裁剪、分页、生成 manifest |
| `extensions/spine-vat-importer/bake/src/index.ts` | `bakeSpineVat(data, options)`：挂临时节点 → 分析 → 编译 → 返回 manifest 与各 `.bin`；`describeSpineVatSource` 给面板列动画 / 骨骼；由 `scene.js` 的 `bake` / `describeBakeSource` 调用 |
| `extensions/spine-vat-importer/bake/src/SpineVatBakeOptions.ts` | 纯逻辑：烘焙参数校验，从已有 manifest 读回上次的参数 |
| `extensions/spine-vat-importer/panels/bake.js` | 烘焙面板（资源右键打开）：选参数、调场景进程烘焙、最后写 manifest 并刷新导入 |
| `test/extensions/spine-vat-importer/bake/SpineVatFixedLayout.test.ts`、`SpineVatCompilerV2.test.ts` | 槽位、退化、剪裁区、规则；manifest 与静态区 |

## 采样

`bakeAndCompileSpineVatV2(parent, skeletonData, analysis, options)` 对每段非 `RUNTIME_FALLBACK` 的动画建两个 REALTIME `sp.Skeleton`，同步推进：

| 骨骼 | 数据 | 取什么 |
|---|---|---|
| 原骨骼 | 原 SkeletonData | 官方剪裁后的输出（只用于 bounds 和时长），`clipStart` / `clipEnd` 规则下每个 slot 的剪裁归属，生效剪裁的世界坐标多边形，socket 矩阵 |
| 去剪裁骨骼 | `createUnclippedSkeletonData`：删掉全部剪裁附件和它们的 deform 时间轴 | 剪裁前的原始几何（Region 4 顶点 / Mesh `worldVerticesLength/2` 顶点，三角形用附件自带的） |

- 帧数 `ceil(duration × fps)`，第 0 帧推进 0，之后每帧推进 `1/fps`，与 Analyzer 相同。
- 按官方渲染器的跳过规则（骨骼未激活、没有附件）遍历 drawOrder，把渲染输出切成 `(slot, 附件名)` 键的区间。数出的顶点数、索引数必须和渲染输出一致，否则报错。
- 取剪裁多边形之前先调一次 `updateRenderData()`。wasm 的 `updateAnimation` 不更新世界矩阵，不调的话多边形还是上一帧的姿势。

## 槽位与 lane（`planFixedLayout`）

1. 逐段动画检查[规则](spine-vat-overview.md#规则编译期检查)。任一段不过，`compileSpineVatV2` 就整体抛错 `VAT 无法固定槽位烘焙：动画名（原因）`。
2. 把各帧的键顺序并进一个全局顺序，出现矛盾（绘制顺序变了）就报错。
3. 按全局顺序给每个键分配一段连续的顶点槽。相邻且贴图、blend 都相同的键合成一条 lane；lane 超过 65535 顶点时另开一条，保证索引能用 `Uint16`。lane 的 `indices` 是 lane 内的局部号。
4. 剪裁表 `clipKeys` = 被引用到的剪裁附件键。`vertexClip[顶点]` 记录这个顶点归哪个剪裁，-1 表示不裁。

`frameStride = 顶点数 + clipKeys.length × MAX_CLIP_VERTICES(8)`。

## 纹理布局

```text
texel(帧, i) = (clip.frameOffset + 帧) × frameStride + i
帧内：[0, 顶点数)                → 顶点区：(x, y, u, v)
      [顶点数, frameStride)      → 剪裁区：每个剪裁 8 texel，(x, y, 生效 ? 1 : 0, 顶点数)
静态区 = 所有 clip 的帧之后多出的一「帧」（staticFrame）：texel.x = 该顶点所属剪裁序号
```

- 某帧没画出来的键：uv 写 (-1,-1)、alpha 写 0。这样三角形退化，且 uv 与相邻帧不同，shader 插值时会自动退回阶跃。
- 剪裁多边形不足 8 点的，用第 0 点补齐；剪裁当帧没生效时，整段写 0。
- 所有 clip 的帧依次排列在同一个线性地址空间里，manifest 的 `clip.frameOffset` 就是各段的起点。

## 通道与分页

| 通道 | 格式 | 何时生成 |
|---|---|---|
| position | `rgba32f`（x, y, u, v） | 总是 |
| light | `a8`（所有顶点的 RGB 都恒白，只存 alpha）或 `rgba8` | 总是（空槽 alpha 为 0，不会恒白） |
| dark | `rgba8` | tint black 的 RGB 不全为零时（alpha 不算：PMA 下运行时在 dark.a 写 255 作标记，dark.rgb 为 0 时它不影响结果） |

- 每页最多 `4096 × 4096` texel，最多 4 页（shader 固定绑 4 页），超了就报错。三个通道分页方式相同，文件名 `position-N.bin` / `light-N.bin` / `dark-N.bin`。
- 其他硬限制：总 texel 数 < 2^24（shader 里用 float 做整数寻址）；精确字节数不超过 recipe 的 `maxTextureBytes`；alpha mode 必须明确；Spine 版本必须是 4.2；lane 的贴图 uuid 要能对上 atlas page（完全相等 → 前缀匹配 → atlas 只有一页时取第 0 页）。

## manifest（`spine-vat-2`）

类型见 `extensions/spine-vat-importer/assets/runtime/SpineVatSchema.ts`（运行时）与 `extensions/spine-vat-importer/bake/src/SpineVatTypes.ts`（编译期），两边字段一致。要点：

- `layouts` 只有一个，`id: 'fixed'`，带 `frameStride` / `bounds` / `clipCount` / `staticFrame` / `lanes`（每条带 `indices`，`geometryMode` 恒为 `indexed-stable`）。
- `variants` 只有 `default`；`textureProfile` 恒为 `exact`。
- `bounds` 取官方剪裁后的输出，不算剪裁前被裁掉的部分（算进去会把包围盒撑大，UI 里的人物就被缩小了）。
- `clips[].events` 直接从 Spine JSON 的 event 时间轴读取，缺的字段用事件定义的默认值补上；`clips[].sockets` 仅在传入 `options.socketNames` 时生成，每帧存一个 `[a, b, c, d, worldX, worldY]`。有 event 或 socket 时，`compatibility.level` 写为 `HYBRID`。
- `compatibility.drawCallsPerBatch` = lane 数；`estimatedGpuBytes` = 纹理字节 + 每顶点 14 B。

## 已知行为与坑

- 烘焙面板里勾选的 Socket 骨骼会作为 `socketNames` 传入。
- socket 数据以 JSON 数字直接写进 manifest。多个 socket 或长动画会让 manifest 明显变大；需要时再改成二进制、量化存储。
- 图集 PNG 不在导出内容里，需要手动拷进导出目录（见工程 README）。

# Spine VAT Player：每实例独立播放与 GPU Instancing

状态：已实现（正文待按现状修订）
摘要：Player：每实例独立播放参数与 GPU Instancing。
何时读：改播放参数、实例属性或 instancing 时。
依赖：[Compiler](spine-vat-compiler.md)

> 待更新：正文部分内容（三角形汤、V1 渲染器、旧入口与路径）仍是早期实现，尚未按现状修订；数据格式与两个组件的现状以 [spine-vat-overview.md](spine-vat-overview.md) 为准。

> Cocos Creator：3.8.7  
> Spine 数据：4.2.43  
> 实测资源：`FruitMachinePart` 男舞者  
> 实测日期：2026-09-21

## 1. 本阶段解决的问题

M2 已经能把官方 Spine Runtime 的最终几何烘焙为 VAT，并让同一 Lane 的多个角色进入 GPU Instancing；但动画状态保存在材质 uniform 中，所有实例只能共享动画、相位和速度。

M3 把以下状态移到 Cocos 自定义 Instanced Attribute：

- 每实例动画和帧区间；
- 每实例起始相位、速度和循环方式；
- `play / pause / resume / seek / setSpeed / setManualFrame`；
- 每实例 RGBA 颜色；
- Straight Alpha 与 PMA 不同的实例颜色打包。

动画正常推进时由 vertex shader 使用 `cc_time.x` 计算当前帧。CPU 只在播放状态改变时更新实例属性，不会每帧上传动画顶点，也不需要每帧更新实例帧号。

## 2. 实例属性布局

每个逻辑角色的所有 Render Lane 使用相同的三组属性：

```glsl
in vec4 a_vatAnim0;
in vec4 a_vatAnim1;
in vec4 a_vatColor;
```

字段语义：

| 属性 | 分量 | 含义 |
| --- | --- | --- |
| `a_vatAnim0` | `x` | clip 的全局 `frameOffset` |
|  | `y` | clip 的 `frameCount` |
|  | `z` | clip 的 `fps` |
|  | `w` |本次播放段的引擎时间锚点 |
| `a_vatAnim1` | `x` | 时间锚点对应的 clip 内浮点帧 |
|  | `y` | 播放速度；暂停时写 0 |
|  | `z` | `1=loop`，`0=clamp` |
|  | `w` | 手动固定帧；小于 0 表示自动播放 |
| `a_vatColor` | `rgba` | 已按 Straight/PMA 语义打包的实例整体色 |

材质 uniform 只保留所有实例共享的布局：

```text
vatLayout = [frameStride, pageTexels, pageCount, reserved]
```

shader 的线性地址为：

```text
linear = (clip.frameOffset + frame) * frameStride
       + lane.vertexOffset
       + localVertexId
```

## 3. 播放状态为什么不会跳帧

播放器不累计每帧 `dt`，而是保存“时间锚点 + 浮点帧锚点”：

```text
rawFrame = anchorFrame
         + (engineTime - anchorTime) * clipFps * speed
```

- `pause()` 先把当前浮点帧固化到 `anchorFrame`，再把 GPU speed 写成 0；
- `resume()` 只重置 `anchorTime`，从暂停时的亚帧位置继续；
- `seek()` 把 `anchorFrame` 改为 `seconds * fps`；
- `setSpeed()` 先固化旧速度下的当前浮点帧，再切换速度；
- `setManualFrame(null)` 从最后固定帧继续自动播放，不跳回旧时间线。

loop 使用双重 `mod`，因此负速度越过第 0 帧也能正确回绕；非 loop 动画会限制在 `[0, frameCount - 1]`。

## 4. 对外 API

运行时类：

```ts
const instance = population.instances[0];

instance.play('animation-name', {
  loop: true,
  speed: 1.25,
  startTime: 0.4,
});
instance.pause();
instance.resume();
instance.seek(0.8);
instance.setSpeed(0.75);
instance.setLoop(false);
instance.setColor([1, 0.8, 0.7, 1]);
instance.setManualFrame(15);
instance.setManualFrame(null);
```

Web 调试页同时提供：

```js
window.__SPINE_VAT_V2_INSTANCES__
window.__SPINE_VAT_V2_STATES__()
window.__SPINE_VAT_V2_PLAY__(index, animation, options)
window.__SPINE_VAT_V2_PAUSE__(index)
window.__SPINE_VAT_V2_RESUME__(index)
window.__SPINE_VAT_V2_SEEK__(index, seconds)
window.__SPINE_VAT_V2_SPEED__(index, speed)
window.__SPINE_VAT_V2_LOOP__(index, loop)
window.__SPINE_VAT_V2_COLOR__(index, r, g, b, a)
window.__SPINE_VAT_V2_DEMO_INDEPENDENT__()
```

原有 population 级 `SET_CLIP` 和 `SET_FRAME` 接口仍保留，会把操作广播到全部实例。

## 5. 单元测试

`SpineVatPlayerCore.test.ts` 覆盖：

- loop 正向回绕、负速回绕和 non-loop clamp；
- clip 的 `frameOffset / frameCount / fps`；
- pause/resume 保留亚帧位置；
- seek 和改速不跳帧；
- manual frame 裁剪及恢复自动播放；
- Straight/PMA 实例颜色打包；
- 颜色范围保护。

加入 HYBRID event/socket 后，与 M1/M2 一起执行结果为 `22/22 PASS`。

## 6. Web 真运行验证

### 6.1 复现

先构建 `web-fruit42` 并启动服务器：

```powershell
node tools/static-server.mjs build/web-fruit42 18089
```

测试页：

```text
http://127.0.0.1:18089/?vat2=1&count=20&pma=straight&analyzeFps=30&independent=1
```

自动验证：

```powershell
node tools/verify-vat-m3.mjs
```

脚本会启动隔离的 Headless Edge，通过 CDP 读取浏览器状态，验证播放中的实例会前进、暂停实例不前进，并保存截图和完整结果。

### 6.2 环境

```text
ANGLE (Intel, Intel(R) Graphics (0x00007D67)
Direct3D11 vs_5_0 ps_5_0, D3D11)
```

本轮使用 Intel 集显 D3D11，不是 SwiftShader 软件 GPU。但 Headless 浏览器 FPS 仍只用于确认测试稳定运行，不作为 Android 性能结论。

### 6.3 结果

| 指标 | 结果 |
| --- | ---: |
| 逻辑实例 | 20 |
| 已烘焙动画 | 3 |
| Render Lane | 4 |
| GPU Instances | 80 |
| Draw Call | 8 |
| 不同当前帧 | 20 |
| 暂停实例 | 3 |
| VAT 精确纹理数据 | 11,468,800 B（10.94 MiB） |
| Cocos GFX Texture Memory | 19.25 MiB |
| Cocos GFX Buffer Memory | 0.119 MiB |

`80 = 20 实例 × 4 Lane`，说明不同动画、相位、速度、暂停状态和颜色没有破坏 GPU Instancing。Draw Call 仍是同一页面和 HUD 条件下的固定 8，没有退化成 `20 × Lane`。

截图中 20 个角色处于明显不同的动画姿态和缩放阶段，没有出现全黑、破面或所有实例同帧。产物位于：

```text
artifacts/vat-m3/independent-20.png
artifacts/vat-m3/result.json
```

## 7. Android Native 真运行验证

### 7.1 构建与环境

使用 Creator 3.8.7 构建独立的 x86_64 Debug APK：

```powershell
powershell -File tools/build-android.ps1 `
  -Profile low `
  -Asset fruitvat42 `
  -Abi x86_64 `
  -AllowExistingEditor
```

包名为 `com.corekit.spineruntimelab.fruitvat42`。测试设备为 Android 14 模拟器，2,534,120 KB RAM、1080x2400；Native 图形后端为 GLES 3.0，但渲染器是 `Android Emulator OpenGL ES Translator (Google SwiftShader)`。因此本节能验证 JSB、GLES、离线资源加载和实例属性路径，不能代表移动真机 GPU 的绝对 CPU/GPU 性能。

Native 不在设备上执行 Web/WASM 烘焙，而是从 `assets/resources/fruit-machine-vat-v2/` 加载 Web 导出的文件：

```text
manifest.spinevat  46,317 B（含 r1_lian socket；无 socket 时 3,641 B）
position-0.bin      9,175,040 B
light-0.bin         2,293,760 B
VAT 精确数据合计   11,468,800 B（10.94 MiB）
```

该样本的 dark 通道全零，因此 manifest 声明 `dark=false`，没有生成无意义的 `dark-0.bin`。

### 7.2 Native 结果

| 指标 | 结果 |
| --- | ---: |
| 逻辑实例 | 20 |
| 动画 / Render Lane | 3 / 4 |
| GPU Instances | 80 |
| Draw Call 当前 / 平均 / 峰值 | 8 / 8.00 / 8 |
| 引擎 FPS / P50 / P95 | 58.80 / 16.78 ms / 18.75 ms |
| SurfaceFlinger FPS / P50 / P95 | 59.48 / 16.689 ms / 18.268 ms |
| SurfaceFlinger 超过 25 ms | 2 / 126 |
| 进程 PSS / RSS | 153.99 / 244.71 MiB |
| Native Heap PSS | 51.27 MiB |
| GFX Texture / Buffer Memory | 19.24 / 2.35 MiB |
| 进程 CPU | 95.2% |

CPU 高的主要背景是 SwiftShader 软件光栅化，不能用该值判断 VAT 在真机上能节省多少 CPU。PSS/RSS 也是整个 Debug 进程，不是 VAT 独占内存；可精确归属给 VAT 的数据仍是 10.94 MiB 离线纹理净数据。

日志先后打印 `[SpineVatV2Demo]` 和两秒后的 `[SpineVatV2State]`：索引 `0 / 9 / 18` 的暂停实例保持原帧，其余 17 个实例按各自 clip、相位和速度推进。Native shader 编译包含 `USE_INSTANCING1`，没有出现 VAT 加载、JSB、shader、`TypeError` 或 `ReferenceError`。两张相隔约 0.8 秒的截图中，播放实例姿势明显变化，暂停实例保持原姿势，且没有全黑、破面或透明混合异常。

采集产物位于：

```text
temp/android-run/m3-vat2-emulator-20260921/summary.json
temp/android-run/m3-vat2-emulator-20260921/logcat.txt
temp/android-run/m3-vat2-emulator-20260921/screen.png
temp/android-run/m3-vat2-emulator-20260921/screen-second.png
```

结论：Creator 3.8.7 Native JSB 的 `MeshRenderer.setInstancedAttribute()` 在本测试中可正确传递三组自定义实例属性；每实例独立播放没有破坏 GPU Instancing，也没有把 20 个实例退化为逐实例 Draw Call。

## 8. HYBRID event / socket

### 8.1 event 轨道

编译器直接读取 Spine JSON 的事件定义和动画 event timeline，把以下字段写入对应 clip：

```text
time, name, intValue, floatValue, stringValue,
audioPath, volume, balance
```

播放器使用上次检查帧到当前浮点帧之间的开闭区间派发事件，支持正放、倒放、跨多个 loop、pause/resume；`seek()` 和 manual frame 只移动游标，不补发跳过区间。单次更新最多派发 4,096 个事件，防止后台恢复后的异常大时间跨度卡死主线程。

事件仍是轻量 CPU 逻辑，GPU 不可能主动调用 JavaScript。`SpineVatPopulationV2.updateHybrid()` 每帧只检查 manifest 中的事件表，不执行骨骼、约束或顶点计算。调用方式：

```ts
const off = instance.onEvent((event) => {
  console.log(event.clip, event.name, event.intValue);
});

population.updateHybrid();
off();
```

水果机样本本身没有 authored event，因此本轮用纯逻辑单测覆盖事件默认值、顺序、loop、倒放和 seek 语义；尚不能把它写成真实 event 资产回归通过。

### 8.2 指定 socket

Web 烘焙时通过 `socketNames` 显式选择骨骼，只导出需要的轨道。每帧保存 Spine world transform 的完整 2D 仿射矩阵：

```text
[a, b, c, d, worldX, worldY]
x' = a*x + b*y + worldX
y' = c*x + d*y + worldY
```

运行时 `instance.socket(name)` 使用与 GPU 当前离散帧相同的帧号读取矩阵，不重新运行 Spine Runtime。返回完整矩阵而不是强制分解为 position/rotation/scale，是为了不丢失 shear 和镜像语义。

浏览器测试参数：

```text
/?vat2=1&count=20&pma=straight&analyzeFps=30&independent=1&sockets=r1_lian
```

自动验证：

```powershell
node tools/verify-vat-m3.mjs `
  'http://127.0.0.1:18091/?vat2=1&count=20&pma=straight&analyzeFps=30&independent=1&sockets=r1_lian' `
  artifacts/vat-m4-hybrid `
  --socket=r1_lian
```

真实结果：

| 平台 | socket before | socket after | GPU Instances | Draw Call | 错误 |
| --- | --- | --- | ---: | ---: | ---: |
| Web / Intel D3D11 | `x=-9.51, y=-40.84` | `x=13.92, y=-39.60` | 80 | 8 | 0 |
| Android / GLES3 / SwiftShader | `x=13.57, y=-16.64` | `x=-22.82, y=-22.21` | 80 | 8 | 0 |

两端的 `a/b/c/d` 也同步变化，证明读取的是动画骨骼轨道，不是只更新位置的伪数据。启用 socket 不增加 VAT 纹理、GPU Instances 或 Draw Call。

当前每个矩阵使用 6 个 float。该样本为 `3 clip × 60 frame × 1 socket`，原始 float 数据约 4.22 KiB；直接嵌入 JSON 后 manifest 从 3,641 B 增至 46,317 B。少量大厅挂点可接受，但正式多 socket/长动画必须改为二进制轨道和量化，不能继续堆 JSON 数字。

## 9. CPU 上传量和边界

每次状态变化，每个实例每个 Lane 写三组 `vec4`，即 48 字节。水果机 4 Lane 时，一次实例状态更新写 192 字节；20 个实例全部改变状态时共 3,840 字节。正常播放不持续写这些属性。

这不等于播放器已经覆盖全部 Spine Runtime API：

- event 和指定 socket 已实现；真实 event 资产、socket follower 组件和二进制压缩仍待补齐；
- crossfade 尚未实现；
- clip 必须使用当前 renderer 的同一 layout，跨 layout 播放会明确报错；
- GPU Instancing 仍遵循 Cocos 的透明排序和连续批次规则，中间穿插其他 Renderer 会拆批；
- PMA shader/颜色路径已实现并有纯逻辑单测，但仍缺真实 PMA Spine 资产的固定帧/Web/Native 回归；
- Native 自定义实例属性已在 Android x86_64 / GLES3 / SwiftShader 上跑通；ARM64 实体机仍需用同一 `spine-vat-2` 包复测，不能拿早期 `spine-vat-1` 真机数据代替。

## 10. 当前判断

M3 已在 Web 和 Android Native 模拟器上证明“每实例独立播放”和“同批 GPU Instancing”可以同时成立。对于大厅约 20 个入口，不需要为了不同动画或错峰播放拆成 20 套材质，也不需要 CPU 每帧更新动画顶点。

下一步优先级应是：真实 PMA/多 atlas 资产回归、ARM64 真机 M3 A/B、真实 event 资产回归，以及 socket 二进制压缩/follower 组件；crossfade 只有在顶点语义兼容时才能直接双帧插值，否则必须使用预烘焙 transition clip 或回退官方 Runtime。

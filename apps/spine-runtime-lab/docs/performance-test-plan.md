# Spine Runtime Lab 性能测试配置

本测试统一使用 Cocos Creator 3.8.7，目标场景是水果机大厅同屏约 20 个简单 Spine 元素。Android 和 Web 使用同一套实例数、动画、预热时间和采样时间，避免把平台差异与测试参数差异混在一起。

## 基准场景

- 实例数：20
- 动画：`walk`（替换为业务短动画时保持所有平台一致）
- 预热：10 秒
- 采样：30 秒
- 模式：`REALTIME`、`SHARED_CACHE`
- 每种模式分别测试 `enableBatch=false/true`
- 每组至少重复 3 次，记录中位数

## Android 模拟器

已准备两个 AVD 配置，系统镜像为 `Android 34 google_apis x86_64`，使用 `-gpu host`，避免 SwiftShader 把 GPU 瓶颈误判成 Spine 瓶颈：

| 档位 | AVD | CPU | RAM | 分辨率 | 用途 |
| --- | --- | ---: | ---: | --- | --- |
| 低端基线 | `spine_runtime_low` | 2 核 | 2 GB | 720x1280 | 低端 Android 设备压力基线 |
| 中端基线 | `spine_runtime_mid` | 4 核 | 3 GB | 1080x1920 | 中端 Android 对照 |

说明：Android 14 x86_64 系统镜像会保留一部分 guest/runtime 开销，`/proc/meminfo` 看到的总内存可能略高于 AVD 的 `hw.ramSize`；这里的 RAM 是配置档位，不等同于真实手机的物理内存封顶。若后续需要严格复现 1 GB/2 GB 物理机，再增加 Android 29/30 系统镜像档位。

配置脚本：

```powershell
$env:ANDROID_SDK_ROOT = 'E:\android-sdk'
powershell -File apps/spine-runtime-lab/tools/configure-spine-avd.ps1 -Profile low
powershell -File apps/spine-runtime-lab/tools/configure-spine-avd.ps1 -Profile mid
```

启动低端 AVD：

```powershell
powershell -File apps/spine-runtime-lab/tools/configure-spine-avd.ps1 -Profile low -Start
```

启动后用 Creator 3.8.7 构建 Android debug 包，再安装到低端档 `emulator-5560`；中端档固定使用 `emulator-5562`。端口与现有的 `fortune_test` 隔离，测试时不要使用 `-gpu swiftshader`；模拟器黑屏时先检查 `-gpu host` 和 logcat。

构建脚本会检测是否已有同一工程的 Creator 实例，避免 CLI 静默撞锁：

```powershell
powershell -File apps/spine-runtime-lab/tools/build-android.ps1 -Profile low
```

如果确认要复用已打开的编辑器，再显式传 `-AllowExistingEditor`；构建结束必须在 `build/android-low` 或 `build/android-mid` 下找到 APK，不能只看 Creator 进程退出码。

Android 记录项：

- `adb shell dumpsys meminfo <package>`：Java/native/graphics/PSS；
- Creator/引擎日志：FPS、P50/P95、超过 25 ms 的比例、Game Logic、Renderer、Present、Draw Call、GPU Instances、Triangles、GFX Texture/Buffer Memory；
- `SurfaceFlinger --latency`：实际呈现 FPS、P50/P95 和超过 25 ms 的帧数；
- `top`：连续 CPU 样本；
- logcat：`cocos|jsb|FATAL|AndroidRuntime|ERROR|shader`。

`dumpsys gfxinfo` 对该 Cocos `SurfaceView` 路径返回 0 帧，不能作为本项目的帧稳定性依据。

## Web 基线

Web 不使用 Android AVD，而使用浏览器固定视口和 CPU throttling 模拟档位：

| 档位 | 视口 | CPU throttling | 网络 |
| --- | --- | ---: | --- |
| 低端基线 | 720x1280 | 4x slowdown | 加载后离线 |
| 中端基线 | 1080x1920 | 2x slowdown | 加载后离线 |

操作步骤：

1. 用 Creator 3.8.7 启动 browser preview，确认页面加载完成后再开始计时。
2. Chrome DevTools → Performance → CPU 选择 4x 或 2x slowdown；Network 只在资源加载完成后切 Offline。
3. 固定 `instanceCount=20`，依次运行 `REALTIME`、`SHARED_CACHE` 和 `enableBatch` 对照组。
4. 记录 Chrome Performance 的 Main、Rendering、GPU 和 FPS；不要只看浏览器窗口右上角的 FPS。

Web 额外记录：

- `performance.memory.usedJSHeapSize`（Chromium 非标准指标，仅作趋势）；
- Chrome Task Manager 的 GPU Memory；
- Canvas/WebGL draw call（通过 Cocos Profiler 或 WebGL Inspector）；
- 浏览器 console 是否有 WASM、shader、纹理上传错误。

## 判定顺序

1. 先比较 `REALTIME` 与 `SHARED_CACHE` 的 CPU 和内存曲线。
2. 再比较 `enableBatch` 对 draw call/Render 的影响。
3. 如果低端 Android 和低端 Web 都仍以 Spine CPU 更新为主要瓶颈，再制作 VAT PoC；否则不引入额外 GPU 管线。

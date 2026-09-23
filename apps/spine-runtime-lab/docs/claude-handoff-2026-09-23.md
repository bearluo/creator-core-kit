# Spine VAT / Cocos Creator 3.8.7 交接文档

更新时间：2026-09-23  
用途：交给 Claude 继续完成 2D 游戏中的 VAT、普通 Sprite 穿插、遮挡和 Android 真机验证。

## 1. 目标

在 Cocos Creator 3.8.7 中验证复杂 Spine 动画转换为 VAT 后的性能，并确认它在以 2D `Sprite`/官方 Spine 为主的水果机游戏中能否保持正确的渲染顺序。

当前重点不是继续扩展旧组件，而是完善新 VAT Asset、2D UI 渲染桥接和真机 A/B 数据。

## 2. 工作区与约束

- 项目：`E:/work/creator-core-kit/apps/spine-runtime-lab`
- Creator：3.8.7
- 目标真机：OPPO PGCM10，ADB 序列号 `6LG6ORL795IN7D5T`
- 设备：Android 13 / API 33，MediaTek mt6833，Mali-G57 MC2，1080x2400，60 Hz
- ADB：`E:/android-sdk/platform-tools/adb.exe`
- 文档和交接内容使用中文。
- 不操作物理鼠标。
- 不执行 `git reset --hard`、`git checkout --` 或删除用户文件。
- 不修改 `pnpm-lock.yaml`（当前它已有用户改动）。
- 当前 Creator 项目可能仍打开并持有 `temp/logs/project.log`；不要并发启动第二个 Creator 构建。

## 3. 已完成内容

### 3.1 自定义 Asset / AssetDB

新资源后缀为 `.spinevat`，Importer 名为 `spine-vat`，运行时 Asset 类型为 `spinevat.SkeletonData`。

已修复 Creator 3.8.7 的自定义 Asset 注册顺序：手动 decorator 必须先调用 `property(prototype, field)`，最后调用 `ccclass(name)(Class)`。worker 占位类已声明所有序列化字段：

- `manifestJson`
- `positionPages`
- `lightPages`
- `darkPages`
- `atlasPages`
- `effectAsset`

已确认 Builder import JSON 不再是 `unknown/unknown`，包含上述字段和 UUID 依赖。

相关代码：

- `extensions/spine-vat-importer/dist/asset-db.js`
- `extensions/spine-vat-importer/dist/worker-bootstrap-1.4.0.js`
- `extensions/spine-vat-importer/assets/runtime/SpineVatSkeletonData.ts`
- `extensions/spine-vat-importer/assets/spine-vat-v2.effect`

### 3.2 运行时与组件

- 新 Asset：`extensions/spine-vat-importer/assets/runtime/SpineVatSkeletonData.ts`
- 新组件/预览：`extensions/spine-vat-importer/assets/runtime/SpineVatSkeleton.ts`
- 运行时 VAT：`assets/scripts/SpineVatRuntimePopulation.ts`
- VAT Renderer：`assets/scripts/SpineVatRendererV2.ts`
- 测试驱动：`assets/scripts/SpineLabDriver.ts`

正式组件只负责当前节点实例；批量实例属于测试驱动/Population，不要把 `instanceCount` 等 benchmark 参数继续塞入正式组件。

### 3.3 技能沉淀

已更新：

- `.claude/skills/cocos-creator-extension-dev/SKILL.md`
- `.claude/skills/cocos-creator-extension-dev/references/validation.md`
- `.claude/skills/cocos-creator-extension-dev/references/asset-db-importer.md`
- `.claude/skills/cocos-creator-extension-dev/references/custom-inspectors.md`
- `.claude/skills/cocos-creator-extension-dev/references/custom-asset-serialization.md`

技能校验命令及结果：

```powershell
$env:PYTHONUTF8='1'
python C:\Users\Administrator\.codex\skills\.system\skill-creator\scripts\quick_validate.py .claude/skills/cocos-creator-extension-dev
# Skill is valid!
```

TypeScript 校验：

```powershell
pnpm exec tsc -p apps\spine-runtime-lab\tsconfig.json --noEmit
# 通过
```

## 4. 关键渲染问题：2D Sprite 与 VAT

### 4.1 旧问题

原测试中普通图片用 `Sprite`，VAT 用裸 `MeshRenderer`，即使节点设置：

```text
Sprite(z90) < VAT(z100)
VAT(z200) < Sprite(z210)
```

截图仍显示 10 张普通图片整体盖在 VAT 上方。

原因：

- `Sprite` 继承 `UIRenderer`，由 Canvas/UI Batcher 提交；
- VAT 裸 `MeshRenderer` 位于 `UI_3D`/模型队列；
- 两个队列之间不会按节点 z 交错；
- 日志只记录 z，不能证明实际绘制顺序。

因此不要为了“通过穿插测试”把普通 Sprite 改成 `SpriteRenderer`，那会改变真实 2D 游戏负载。

### 4.2 当前修复方向：UIMeshRenderer

Creator 3.8.7 内置 `UIMeshRenderer` 的源码位于 Creator 安装目录的 `resources/3d/engine/bin/native-preview/2d.js`：

- `UIMeshRenderer._render()` 调用 `MeshRenderer._collectModels()`；
- 调用 `MeshRenderer._detachFromScene()`；
- 调用 `render.commitModel(...)` 交给 UI Batcher；
- `Batcher2D.commitModel()` 使用模型的 InputAssembler、descriptor set 和材质创建 UI draw batch。

已修改 `SpineVatRendererV2.ts`：

```text
每个 VAT lane = MeshRenderer + UIMeshRenderer
VAT root / instance / lane = Layers.Enum.UI_2D
```

修改位置约为 `assets/scripts/SpineVatRendererV2.ts:393-426`。

这样才有机会让真实 2D `Sprite`、官方 Spine 和 VAT 在 Canvas UI 提交流程中按兄弟顺序排序。尚未通过新 APK 完成真机验证，必须继续确认：

- `Sprite -> VAT -> Sprite` 截图顺序；
- Draw Call 是否增加；
- `gpuInstances` 是否仍为 120（30 逻辑实例、4 lanes）；
- 是否出现 UI Batcher 材质拆批或整组排序。

## 5. 当前 shader 错误

用户看到的错误：

```text
VertexShader in '../spine-vat-v2|spine-vat-v2-vs:vert|spine-vat-v2-fs:frag|CC_RECEIVE_SHADOW1' compilation failed.
```

初步定位：加入 `UIMeshRenderer` 后，Creator 会在 `_fitUIRenderQueue()` 中对材质重编译并强制 forward；VAT Effect 没有明确关闭阴影接收，于是生成 `CC_RECEIVE_SHADOW1` 变体。VAT 顶点输入只有自定义位置/实例属性，没有标准模型接收阴影所需输入，导致 vertex shader 变体编译失败。

已做的修复（需要重新导入和构建验证）：

`extensions/spine-vat-importer/assets/spine-vat-v2.effect` 的 8 个 pass 增加：

```yaml
embeddedMacros: &vatMacros { CC_RECEIVE_SHADOW: false }
```

后续 pass 使用：

```yaml
embeddedMacros: *vatMacros
```

目前代码文件已改，但尚未完成新 APK 的 shader 编译验证。若错误仍出现，再检查生成的 shader variant 是否仍带 `CC_RECEIVE_SHADOW1`；必要时在 `UIMeshRenderer` 的材质重编译路径中显式传入 `CC_RECEIVE_SHADOW: false`，或确认 VAT Effect 使用的是本次最新 `.meta`/Library 产物。

## 6. 旧 APK 真机数据（可引用，但不是 UIMeshRenderer 修复后的数据）

APK：

```text
apps/spine-runtime-lab/build/android-fruitvat42-arm64/proj/build/spine-runtime-lab/outputs/apk/debug/spine-runtime-lab-debug.apk
```

设备日志（旧裸 MeshRenderer + Sprite 测试）稳定窗口：

```text
[SpinePerf] mode=VAT_EXT instances=30 fps=60.11 p50=16.55 p95=16.70 over25=0.33 samples=300 drawCalls=9 drawCallsAvg=9.00 drawCallsMax=9 gpuInstances=120 triangles=32218 textureMB=27.11 bufferMB=2.35
[SpinePerf] mode=VAT_EXT instances=30 fps=60.25 p50=16.53 p95=16.69 over25=0.00 samples=300 drawCalls=9 drawCallsAvg=9.00 drawCallsMax=9 gpuInstances=120 triangles=32218 textureMB=27.11 bufferMB=2.35
[SpinePerf] mode=VAT_EXT instances=30 fps=60.14 p50=16.55 p95=16.72 over25=0.00 samples=300 drawCalls=9 drawCallsAvg=9.00 drawCallsMax=9 gpuInstances=120 triangles=32218 textureMB=27.11 bufferMB=2.35
```

同一轮 `dumpsys meminfo`：

```text
TOTAL PSS: 218603 KB
Native Heap PSS: 61468 KB
Graphics PSS: 46196 KB
```

旧截图：

```text
apps/spine-runtime-lab/artifacts/sprite-mix-occlusion.png
```

该截图只能证明“裸 MeshRenderer 与 Sprite 跨管线时 Sprite 在整体一侧”，不能证明 2D VAT 已正确穿插。

## 7. 构建阻塞

尝试执行：

```powershell
.\apps\spine-runtime-lab\tools\build-android.ps1 -Profile low -Asset fruitvat42 -Abi arm64-v8a -AllowExistingEditor
```

失败原因：当前已有 Creator 实例打开同一个项目，锁住：

```text
apps/spine-runtime-lab/temp/logs/project.log
```

并发 Creator 导致 AssetDB 竞争，日志出现假性的：

```text
unknown/unknown
Library={}
```

不要删除 `project.log`，也不要并发启动 CLI Creator。正确流程：

1. 保存代码；
2. 关闭该项目的 Creator 实例；
3. 确认没有 `CocosCreator.exe --project ...spine-runtime-lab`；
4. 执行 Android 构建脚本；
5. 安装到 `6LG6ORL795IN7D5T`；
6. 先扫描 shader、AssetDB、JSB 错误，再采集性能。

## 8. 推荐继续操作命令

### 8.1 静态检查

```powershell
pnpm exec tsc -p apps\spine-runtime-lab\tsconfig.json --noEmit
node --check apps\spine-runtime-lab\extensions\spine-vat-importer\dist\asset-db.js
$env:PYTHONUTF8='1'
python C:\Users\Administrator\.codex\skills\.system\skill-creator\scripts\quick_validate.py .claude/skills/cocos-creator-extension-dev
```

### 8.2 Android 构建

```powershell
.\apps\spine-runtime-lab\tools\build-android.ps1 -Profile low -Asset fruitvat42 -Abi arm64-v8a
```

记录本次 APK 的修改时间、大小和 SHA-256，不要复用旧 APK。

### 8.3 安装与采集

```powershell
$adb='E:\android-sdk\platform-tools\adb.exe'
$serial='6LG6ORL795IN7D5T'
$pkg='com.corekit.spineruntimelab.fruitvat42'
& $adb -s $serial install -r <new-apk>
& $adb -s $serial shell am force-stop $pkg
& $adb -s $serial shell monkey -p $pkg 1
Start-Sleep -Seconds 20
& $adb -s $serial logcat -d -v threadtime | Select-String 'SpinePerf|SpineSpriteMix|SpineVatExtension|AndroidRuntime'
& $adb -s $serial shell dumpsys meminfo $pkg
& $adb -s $serial shell dumpsys gfxinfo $pkg
& $adb -s $serial shell top -b -n 1 -p ((& $adb -s $serial shell pidof $pkg) -join '').Trim()
```

至少拿 3 个稳定的 300 帧窗口。以 `[SpinePerf]` 为主，不要把 `dumpsys gfxinfo` 对 SurfaceView 的少量 ViewRoot 帧当成 Cocos FPS。

## 9. 最终验收标准

必须同时满足：

1. 不再出现 `CC_RECEIVE_SHADOW1`、`compilation failed`、`Missing class`、`missing or invalid`；
2. AssetDB/Builder 仍识别 `spinevat.SkeletonData`，字段和依赖 UUID 完整；
3. 2D Sprite 与 VAT 截图中的前后遮挡符合 z/兄弟顺序；
4. VAT 30 实例仍保持 `gpuInstances=120`，并记录 Draw Call、三角形和 P95；
5. 普通图片插入后，明确记录 Draw Call 是否拆成额外提交组；
6. 只有新 APK 的数据进入最终报告。

## 10. 相关文档

- 汇总报告：`apps/spine-runtime-lab/docs/spine-runtime-vat-summary-report.md`
- 内存原理：`apps/spine-runtime-lab/docs/spine-runtime-memory-flow.md`
- VAT 决策：`apps/spine-runtime-lab/docs/spine-vat-decision.md`
- 扩展技能：`.claude/skills/cocos-creator-extension-dev/SKILL.md`
- 自定义资源序列化参考：`.claude/skills/cocos-creator-extension-dev/references/custom-asset-serialization.md`

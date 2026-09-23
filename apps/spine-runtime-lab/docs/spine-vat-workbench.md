# Spine VAT Web 转换工作台

## 1. 工具形态

这是一个基于 Cocos Creator 3.8.7 Web/WASM Runtime 的静态 Web 工具。转换在浏览器本地完成，不需要上传素材到服务器；发布时只需把构建目录部署到任意静态文件服务。

工作台复用 Creator 内置 Spine 4.2 Runtime 逐帧求出约束、FFD、draw order、attachment、clipping 和混合后的最终几何，再生成 VAT。这样预览与目标 Creator Runtime 使用同一套 Spine 计算路径。

## 2. 构建和发布

在 `apps/spine-runtime-lab` 下执行：

```powershell
powershell -ExecutionPolicy Bypass -File tools/build-vat-workbench.ps1
```

产物位于：

```text
build/web-vat-workbench/
```

本地预览：

```powershell
node tools/static-server.mjs build/web-vat-workbench 18120
```

打开 `http://127.0.0.1:18120/` 即可，不需要手工添加查询参数。正式发布时，把 `build/web-vat-workbench/` 中的全部文件原样上传到 Nginx、OSS/CDN、GitLab Pages 或公司静态站点。

不要直接双击 `index.html` 使用 `file://` 打开；WASM 和资源加载需要 HTTP/HTTPS。

## 3. 上传资源

一次选择或拖入同一个 Spine 资源的全部文件：

- 一个 Spine 4.2 JSON；
- 一个 `.atlas`；
- atlas 引用的全部 PNG、JPG 或 WebP 页面。

当前只支持 Spine 4.2 JSON，不支持 `.skel` binary。工作台会校验版本、atlas 页面和图片是否完整，然后显示动画、bone、slot 和纹理页数量。

## 4. 转换参数

| 参数 | 作用 | 建议 |
| --- | --- | --- |
| 采样 FPS | 每秒烘焙帧数，直接影响动画精度和显存 | 大厅 idle 先用 30；快速运动再测试 60 |
| Alpha | Straight 或 PMA，影响采样颜色和最终 blend state | atlas 没有一致 `pma` 声明时必须手选，不能猜 |
| 最大纹理 | 单张 VAT 数据纹理边长 | 中低端 Android 默认 4096 |
| 纹理预算 MB | 分析阶段的资源预算上限 | 按同屏会常驻的 VAT 资源总量制定 |
| socket | 需要在运行时读取的骨骼名，逗号分隔 | 只导出真正用于挂点的骨骼 |
| 动画 | 本次写入资源包的动画 | 只选游戏实际会播放的动画 |

点击“分析并生成”后，页面左侧使用官方 `sp.Skeleton`，右侧使用 VAT。动画下拉框、暂停按钮和帧滑杆会同时控制两边，可直接做同帧视觉检查。

兼容等级含义：

- `LOSSLESS_VAT`：选定动画可按采样精度还原；
- `HYBRID`：画面走 VAT，event/socket 等走轻量 CPU 时间轴；
- `RUNTIME_FALLBACK`：当前 recipe 不适合 VAT，应继续使用官方 Spine Runtime。

## 5. 导出内容

点击“下载 Creator 包”会得到：

```text
<name>-vat/
├── manifest.spinevat
├── position-0.bin
├── light-0.bin
├── dark-0.bin          # 所有 dark tint 都为零时自动省略
├── atlas-page.png
├── USAGE.md
└── source/
    ├── source.json
    └── source.atlas
```

解压后，将整个 `<name>-vat` 文件夹拖进目标工程的 `assets/`。导入扩展会把其中的 `manifest.spinevat` 转换为强类型 `spinevat.SkeletonData`，并自动记录 bin、atlas 图片与扩展 Effect 依赖。专用后缀不会与 Creator 的普通 JSON 或 Spine JSON importer 竞争。

## 6. Creator 3.8.7 接入

转换工具页面提供“下载 CC 组件”按钮。下载 `spine-vat-runtime.zip` 后，只需将压缩包中的完整扩展复制到目标 Creator 3.8.7 工程的 `extensions/`。组件包包含：

```text
extensions/spine-vat-importer/assets/runtime/SpineVatSchema.ts
extensions/spine-vat-importer/assets/runtime/SpineVatPlayback.ts
extensions/spine-vat-importer/assets/runtime/SpineVatSkeletonData.ts
extensions/spine-vat-importer/assets/runtime/SpineVatRenderResources.ts
extensions/spine-vat-importer/assets/runtime/SpineVatSkeleton.ts
extensions/spine-vat-importer/assets/spine-vat-v2.effect
extensions/spine-vat-importer/dist/
extensions/spine-vat-importer/inspector/
```

正式 Runtime、资源类型、Importer、Inspector 和 Effect 全部位于 `extensions/spine-vat-importer`，目标工程不再复制任何 `assets/scripts/SpineVat*.ts`。VAT Effect 通过与官方 `shader-graph` 相同的 `asset-db.mount` 机制挂载为只读资源；Importer 会把它记录为 `spinevat.SkeletonData` 的隐藏依赖，Inspector 不增加 Shader 属性。

不写业务代码也可以使用：创建空节点并挂载 `Spine/VAT Skeleton`，然后只拖入主资源：

| Inspector 属性 | 应拖入的资源 | 顺序 |
| --- | --- | --- |
| `Skeleton Data` | 类型已显示为 `spinevat.SkeletonData` 的 `manifest.spinevat` | 单个 |
| `Initial Clip` | 赋值资源后直接从动画下拉列表选择 | 单个 |

一个组件只渲染一个 VAT 实例，位置、旋转和缩放完全由当前节点 Transform 控制，不创建实例根节点或 Lane 子节点。多个 Lane 合并为同一个 MeshRenderer 的多个 SubMesh。`Preview In Editor` 默认开启；禁用、删除组件或切换资源时会释放当前引用。相同 `Skeleton Data` 的多个组件共享 VAT Texture、Mesh 和 Material，但各自保留独立播放状态。

`spinevat.Skeleton` 继承 Creator 的 `Renderer` 体系。Creator 3.8.7 的 `Renderer` 基类带 `disallowMultiple`，因此它与 Sprite、MeshRenderer 等其他 Renderer 在同一节点上双向互斥。连续且渲染状态兼容的多个节点可以进入 GPU Instancing；若渲染顺序中穿插其他材质或效果，则按顺序拆成多个批次。

如果 `manifest.spinevat` 未显示为 `spinevat.SkeletonData`，先在扩展管理器确认 `spine-vat-importer` 已启用，再重新导入资源。如果类型正确但 `imported=false`，说明 manifest 引用的 bin、atlas 图片或扩展 Effect 缺失；控制台会给出具体路径。新类不兼容旧 `SpineVatComponent`，也不支持 `Resource Root`、手填资源数组或一次创建多个实例的布局参数。

加载拖入的资源：

```ts
import { SpineVatSkeleton } from 'db://spine-vat-importer/runtime/SpineVatSkeleton';

const skeleton = node.getComponent(SpineVatSkeleton)!;
skeleton.play('letsparty_tuan_nanwuzhe_tigger', {
  loop: true,
  speed: 1,
});
skeleton.setTimeScale(0.8);
skeleton.seek(0.5);
```

组件随节点生命周期自动释放资源，不需要业务代码手动 `destroy()` Runtime 对象。

## 7. 当前边界

- 工具使用 Creator 3.8.7 的 Spine 4.2 Runtime，仅接受 Spine 4.2 JSON；
- 已覆盖最终几何中的 mesh、FFD、约束、draw order、attachment、clipping、四种 slot blend 和 two-color tint；
- 任意运行时换装、动态 attachment、交互式骨骼控制和任意多轨混合不能由固定 VAT 自动保留；
- event 和指定 socket 可导出，socket 数量多时 manifest 会增大；
- 当前数据位置通道为 RGBA32F，低端机上线前必须按真实资源统计常驻显存、温升和加载时间；
- GPU Instancing 仍遵守 Creator 渲染顺序，批次中穿插其他 Renderer 会把 VAT 拆成多个连续批次。

## 8. 已验证样例

`FruitMachinePart` 男舞者在 30 FPS、Straight Alpha、4096 最大纹理、64 MB 预算和 `r1_lian` socket 下：

```text
兼容等级       LOSSLESS_VAT
动画数         3
Render Lane    4
VAT 数据       10.94 MB
ZIP 总大小     15.69 MB
```

浏览器实测完成上传、官方/VAT 双预览、动画切换、手动帧和 ZIP 下载。该资源 dark tint 全零，因此导出包只包含 `position-0.bin` 和 `light-0.bin`。

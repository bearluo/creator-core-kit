# Spine Runtime Lab（Cocos Creator 3.8.7）

Spine VAT 的转换工具与运行时性能测试工程。Spine 4.2 动画离线烘成顶点动画纹理（固定槽位 + GPU 剪裁 + 帧间插值），运行时两种渲染方式任选：

| 组件 | 提交流程 | 用途 |
|---|---|---|
| `spinevat.UiSkeleton`（`Spine/VAT UI Skeleton`） | UI batch（UIRenderer），和 Sprite / `sp.Skeleton` 按兄弟顺序穿插 | 2D UI 里的 Spine |
| `spinevat.Skeleton`（`Spine/VAT Skeleton`） | MeshRenderer + GPU instancing | 3D 场景里的 Spine |

两者读同一份 `spinevat.SkeletonData`（`manifest.spinevat` 导入后的资源），用法相同：挂组件 → 赋 `Skeleton Data` → 选 `Initial Clip`。组件和导入器都在 `extensions/spine-vat-importer`，安装与 API 见 [扩展 README](extensions/spine-vat-importer/README.md)。

## 目录

```
extensions/spine-vat-importer/   导入器 + 两个组件 + 两个 effect（可整体拷到别的工程）
assets/bake/                     转换：Analyzer / Baker / FixedBaker / FixedLayout / CompilerV2 + 烘焙场景与驱动
assets/perf/                     性能测试：保真 → A/B 性能 → 穿插/遮挡（场景 spine-vat-ui-ab + SpineLabDriver），只依赖扩展
assets/resources/spine/          源 Spine（nanwuzhe；_cliptest 是剪裁动画测试资源，tools/gen-clip-test-spine.mjs 生成）
assets/resources/vat/            烘焙产物（nanwuzhe、nanwuzhe-cliptest）
assets/resources/sprites/        穿插测试用图
tools/                           出包、静态服务器、保真 / 遮挡比对
test/                            vitest，路径镜像 assets/ 与扩展（仓库根目录 `npx vitest run apps/spine-runtime-lab/test`）
docs/                            文档，入口 docs/README.md
```

## 转换（烘焙）

用 Creator 构建 `build-configs/web-bake.json`（启动场景 `assets/bake/spine-vat-bake.scene`），然后：

```powershell
node tools/static-server.mjs build/web-bake 18093 assets/resources/vat/nanwuzhe
```

打开 `http://127.0.0.1:18093/`，状态显示完成后在控制台调用 `__SPINE_VAT_V2_EXPORT__()`，静态服务器把 `manifest.spinevat` 和各 `.bin` 写进导出目录（图集纹理手动拷一份进去）。URL 参数：`spine=spine/nanwuzhe/letsparty_tuan_nanwuzhe_cliptest`（换资源，导出目录相应换成 `vat/nanwuzhe-cliptest`）、`pma=straight|premultiplied`、`fps=30`、`profile=balanced|exact|compact`。过不了固定槽位规则的动画会让烘焙直接报错并写明原因（规则见 [设计文档](docs/design/spine-vat-overview.md)）。

## 性能测试

`tools/build-android.ps1 [-Release]` 出 `spine-vat-ui-ab` 场景的 arm64 包（先关掉本工程的 Creator）。启动后依次：

1. **保真**：2D、3D 各跑一遍，每页左 VAT / 右官方 REALTIME 同帧并排，打 `[SpineFidelity]` 行；截图后 `py tools/check-fidelity.py logcat.txt p0.png ... --out diff`。
2. **A/B**：实例数 30 / 150 / 600，每档轮换 2D 插值、2D 阶跃、3D 插值、官方 `SHARED_CACHE`，每阶段 20 秒，打 `[SpineAB]` / `[SpinePerf]` 行。
3. **穿插 / 遮挡**：2D 与官方各一轮，截图后 `py tools/check-occlusion.py shot.png logcat.txt --mode VAT_UI_LERP|SHARED_CACHE`。

测试里的实例都是按业务用法建的：`addComponent` → 赋 `skeletonData` / `initialClipIndex` / `loop`，每个实例一个节点。

## 文档

见 [docs/README.md](docs/README.md)。

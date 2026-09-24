# Spine Runtime Lab（Cocos Creator 3.8.7）

Spine VAT 的转换工具与运行时性能测试工程。Spine 4.2 动画离线烘成顶点动画纹理（固定槽位 + GPU 剪裁 + 帧间插值），运行时两种渲染方式任选：

| 组件 | 提交流程 | 用途 |
|---|---|---|
| `spinevat.UiSkeleton`（`Spine/VAT UI Skeleton`） | UI batch（UIRenderer），和 Sprite / `sp.Skeleton` 按兄弟顺序穿插 | 2D UI 里的 Spine |
| `spinevat.Skeleton`（`Spine/VAT Skeleton`） | MeshRenderer + GPU instancing | 3D 场景里的 Spine |

两者读同一份 `spinevat.SkeletonData`（`manifest.spinevat` 导入后的资源），用法相同：挂组件 → 赋 `Skeleton Data` → 选 `Initial Clip`。组件和导入器都在 `extensions/spine-vat-importer`，安装与 API 见 [扩展 README](extensions/spine-vat-importer/README.md)。

## 目录

```
extensions/spine-vat-importer/   转换（右键烘焙）+ 导入器 + 两个组件 + 两个 effect（可整体拷到别的工程）
assets/perf/                     性能测试：保真 → A/B 性能 → 穿插/遮挡（场景 spine-vat-ui-ab + SpineLabDriver），只依赖扩展
assets/resources/spine/          源 Spine（nanwuzhe；_cliptest 是剪裁动画测试资源，tools/gen-clip-test-spine.mjs 生成）
assets/resources/vat/            烘焙产物（nanwuzhe、nanwuzhe-cliptest）
assets/resources/sprites/        穿插测试用图
tools/                           出包、静态服务器、保真 / 遮挡比对
test/                            vitest，路径镜像 assets/ 与扩展（仓库根目录 `npx vitest run apps/spine-runtime-lab/test`）
docs/                            文档，入口 docs/README.md
```

## 转换（烘焙）

编辑器资源管理器里右键 Spine 的 `.json` →「烘焙 Spine VAT（straight / premultiplied）」，产物写到同目录的 `<名>-vat/` 并自动导入，用法见 [扩展 README](extensions/spine-vat-importer/README.md#烘焙)。本工程的 `assets/resources/vat/` 就是这样烘出来再挪过去的。

烘焙源码在 `extensions/spine-vat-importer/bake/src/`，改完在仓库根目录 `pnpm build:spine-vat-bake` 重新打包 `bake/dist/bake.js`（入库）；`pnpm check:spine-vat-bake` 检查两者是否同步。过不了固定槽位规则的动画会让烘焙直接报错并写明原因（规则见 [设计文档](docs/design/spine-vat-overview.md)）。

## 性能测试

`tools/build-android.ps1 [-Release]` 出 `spine-vat-ui-ab` 场景的 arm64 包（先关掉本工程的 Creator）。启动后依次：

1. **保真**：2D、3D 各跑一遍，每页左 VAT / 右官方 REALTIME 同帧并排，打 `[SpineFidelity]` 行；截图后 `py tools/check-fidelity.py logcat.txt p0.png ... --out diff`。
2. **A/B**：实例数 30 / 150 / 600，每档轮换 2D 插值、2D 阶跃、3D 插值、官方 `SHARED_CACHE`，每阶段 20 秒，打 `[SpineAB]` / `[SpinePerf]` 行。
3. **穿插 / 遮挡**：2D 与官方各一轮，截图后 `py tools/check-occlusion.py shot.png logcat.txt --mode VAT_UI_LERP|SHARED_CACHE`。

测试里的实例都是按业务用法建的：`addComponent` → 赋 `skeletonData` / `initialClipIndex` / `loop`，每个实例一个节点。

## 打包工程

`powershell -File tools/pack-project.ps1 [-Out <zip>]`：把工程打成 zip（默认 `build/spine-runtime-lab-<时间>.zip`），解压后 Creator 3.8.7 直接打开。内容是 git 视角的工程文件（含未提交改动），生成物和本机的 `localCfg.cmake` 不打。

`native/` 入库（引擎补丁在 `native/engine/common/Classes/engine-patches/`）；本机 native 配置从 `native/engine/common/localCfg.cmake.example` 复制成 `localCfg.cmake` 再改。

## 文档

见 [docs/README.md](docs/README.md)。

# 改造提案：烘焙搬进扩展（编辑器内右键烘焙）

状态：已实施
摘要：把 Spine → VAT 烘焙从「web 构建 + 静态服务器 + 控制台导出」搬进 `spine-vat-importer` 扩展，在编辑器场景进程里跑，资源右键一键出 `manifest.spinevat`。交付物收敛为一个扩展目录。
何时读：评审本改造，或实施时对照步骤。
依赖：[Analyzer](spine-vat-analyzer.md)、[Compiler](spine-vat-compiler.md)、扩展 [README](../../extensions/spine-vat-importer/README.md)

## 1. 动机

现在转换一份 Spine 要：用 `build-configs/web-bake.json` 构建 web 包 → `node tools/static-server.mjs` 起服务 → 浏览器打开等烘完 → 控制台调 `__SPINE_VAT_V2_EXPORT__()` → 手动拷图集 PNG → 回 Creator 导入。烘焙代码住在 lab 的 `assets/bake/`，别的工程要用得把整个 lab 带上。

目标：**别的工程只拷 `extensions/spine-vat-importer/`**，流程变成「装扩展 → 右键 Spine 资源烘焙 → 挂组件」。

可行性依据：扩展已有 `scene.js`（场景进程，能 `require('cc')`、用 `director` / `assetManager`）。烘焙依赖的只有 `sp.Skeleton`、`sp.SkeletonData`、`sp.spine.wasmUtil.wasm.HEAPU8`、`Node` 和 `crypto.subtle`，编辑器场景进程里都有（编辑器本身就在用同一份 Spine wasm 预览 `sp.Skeleton`）。

## 2. 变更总览

| 项 | 现状 | 改后 |
|---|---|---|
| 烘焙源码 | `assets/bake/*.ts`（lab 工程脚本） | `extensions/spine-vat-importer/bake/src/*.ts`（**不在挂载的 `assets/` 下**，不进游戏包） |
| 烘焙产物形态 | Creator web 构建 | esbuild 打成 `bake/dist/bake.js`（cjs，`cc` external），**入库**，使用方无需构建 |
| 触发 | 浏览器打开烘焙页 + 控制台 | 资源管理器里右键 `sp.SkeletonData`：「烘焙 Spine VAT（straight）」「烘焙 Spine VAT（premultiplied）」 |
| 运行位置 | 浏览器 | 编辑器场景进程（`scene.js` 暴露 `bake` 方法） |
| 写文件 | POST 给 `static-server.mjs` | 场景进程直接 `fs` 写；图集 PNG 一并拷贝 |
| 导入 | 手动 | 写完 `asset-db refresh-asset`，导入器自动接手 |
| 单测 | `test/bake/` 引 `assets/bake/` | 路径改引扩展的 `bake/src/`，测试文件移到 `test/extensions/spine-vat-importer/bake/`（镜像扩展） |
| lab 里的 web 烘焙 | 主流程 | 逐字节一致验证通过后删除：`assets/bake/`、`build-configs/web-bake.json`、`static-server.mjs` 的导出接口、README「转换」一节 |

## 3. 目标用法

1. 资源管理器右键 Spine 的 `.json`（`sp.SkeletonData`）→ 选 alpha 模式对应的菜单项。
2. 输出到同目录的 `<spine 名>-vat/`：`manifest.spinevat`、`position-N.bin`、`light-N.bin`、`dark-N.bin`（有才出）、图集 PNG。目录已存在则覆盖同名文件。
3. 控制台打 `[Spine VAT Bake]` 进度与结果；失败时报 Analyzer / Compiler 原样的错误（哪个动画、哪条固定槽位规则）。
4. 完成后刷新该目录，`manifest.spinevat` 被导入成 `spinevat.SkeletonData`。

参数只留 alpha 模式：`fps` 固定 30（目前没有别的值被用过），`textureProfile` 固定 `exact`（`balanced` / `compact` 只存在于 Analyzer 的估算，产物一律 exact，见 [工具设计 §6](spine-vat-tool-design.md#6-未实现--开放问题)）。要调再加参数面板。

## 4. 设计决策

| 决策 | 选择 | 理由 |
|---|---|---|
| 在哪个进程跑 | 场景进程 | 只有它有引擎和 Spine wasm；主进程没有 `cc` |
| 源码放哪 | 扩展下 `bake/src/`，不放 `assets/` | 挂载进 asset-db 的脚本会被当工程脚本编译并打进游戏包 |
| 构建产物入库 | 入库 `bake/dist/bake.js` | 使用方只拷目录就能用，不要求装 node 依赖；代价是改源码要记得重新打包，由单测外的一道检查兜（见 §6） |
| 打包工具 | 仓库根已装的 esbuild | 不新增依赖；`cc` 标 external，场景进程里 `require('cc')` 拿到的就是编辑器引擎 |
| 临时节点 | 挂在当前编辑场景下，`hideFlags = DontSave \| HideInHierarchy`，烘完销毁 | Analyzer / Compiler 需要一个激活的父节点来挂 `sp.Skeleton`；不存盘、不进层级面板 |
| 参数 UI | 两个菜单项，不做面板 | 目前只有 alpha 模式一个真参数 |
| 与 web 路径的关系 | 先并存，逐字节一致后删 web 路径 | web 路径是现成的对照组 |

## 5. 风险 / 开放问题

- **场景进程里 `sp.Skeleton` 的行为差异**：编辑器下 `EDITOR` 为真，`sp.Skeleton` 的 `updateRenderData`、`setAnimation` 路径可能和运行时不同（如编辑器不 tick、`_skeleton` 延迟创建）。实施第 1 步先做原型确认，若不一致需要在烘焙代码里显式驱动。
- **没打开场景时**：没有可挂临时节点的父节点。原型时确认能否用 `new Scene()` 临时场景或直接 `director.getScene()` 为空时报错提示「先打开任意场景」。
- **wasm 堆读取**：`HEAPU8` 在 wasm 内存增长后会换 buffer，现有代码每帧重新取，场景进程里同样适用，原型时顺带确认。
- **大资源耗时**：烘焙在场景进程主线程同步跑，期间编辑器场景面板会卡；现有代码每个动画后 `await Promise.resolve()` 让出，不足则改成 `setTimeout(0)`。

## 6. 测试计划

- **单测（vitest，node）**：现有 `test/bake/` 三个文件迁到 `test/extensions/spine-vat-importer/bake/`，改 import 路径，用例不变。
- **打包同步检查**：`bake/dist/bake.js` 与源码不同步时失败——lab 里加 `pnpm` 脚本 `bake:build`，检查方式为重新打包后 `git diff --exit-code`。
- **逐字节一致（一次性，实施验收）**：nanwuzhe 与 nanwuzhe-cliptest 两份资源，编辑器右键烘焙的 `manifest.spinevat` 与各 `.bin` 和 web 烘焙产物（即现在 `assets/resources/vat/` 下入库的那份）逐字节比对。manifest 里 `atlasPages[].id` 由导入器回填，比对前以 web 产物文件为准。
- **回归**：用新产物跑一次 lab 的保真检查（`tools/check-fidelity.py`），结果与现在一致。

## 7. 实施步骤

1. **原型**：在 `scene.js` 临时加一个方法，`require` 未打包的烘焙逻辑（先 esbuild 手打一份），对 nanwuzhe 跑通 analyze + compile，写到 scratch 目录，与入库产物逐字节比对。不一致就先解决 §5 的差异，解决不了本提案作废。
2. 搬源码到 `extensions/spine-vat-importer/bake/src/`，去掉 `SpineVatBakeDriver`（它的职责由 `bake/src/index.ts` 的 `bakeSpineVat(skeletonDataUuid, options)` 取代），加 esbuild 打包脚本；迁移单测。
3. `scene.js` 加 `bake` 方法；`browser.js` 加资源右键菜单（`contributions.assets.menu`，只对 `sp.SkeletonData` 显示），写完调 `refresh-asset`。
4. 验收：§6 的逐字节一致 + 保真回归。
5. 删 lab 的 web 烘焙路径；改写 [Analyzer](spine-vat-analyzer.md)、[Compiler](spine-vat-compiler.md) 的「代码」与入口描述、扩展 README 的「安装 / 使用」、lab README 的「转换」一节、[工具设计 §6](spine-vat-tool-design.md#6-未实现--开放问题) 去掉「编辑器面板」这一条；本提案标「已实施」。

## 8. 实施结果（2026-09-24）

- 原型与正式实现都在编辑器场景进程里跑通，编辑器下 `sp.Skeleton` 未见行为差异，不需要额外驱动；nanwuzhe 一份约 0.4 秒。
- 逐字节比对（nanwuzhe、nanwuzhe-cliptest）：`position-0.bin`、`light-0.bin`、图集 PNG 与 web 烘焙产物**完全一致**。manifest 只有 `source.hashes.skeletonJson` 不同：入库的旧值对不上当前 Spine 源文件，新值与在 node 下离线重算的一致，所以入库 manifest 换成了新产物。
- 数据未变，保真回归未重跑。
- 与提案的出入：`textureProfile` 仍按原驱动传 `balanced` 给 Analyzer（只影响估算，产物照旧是 `exact`），保证 manifest 与旧产物一致；`static-server.mjs` 除导出接口外没有别的用处，整个删除。
- 右键菜单要重启 Creator 才注册（编辑器缓存扩展的 `package.json`，disable/enable 不重读）；本次通过直接调用菜单处理函数验证，菜单外观待重启后确认。

# Spine VAT Runtime（Cocos Creator 3.8.7）

把 Spine 转成 VAT 并在 Cocos Creator 3.8.7 中播放所需的完整扩展：烘焙、运行时脚本、资源类型、Importer、Inspector 和 Effect 全部位于同一个扩展内，不需要再向工程复制任何脚本，也不需要别的工具。

## 安装

1. 解压后，将 `extensions/spine-vat-importer` 整个目录复制到目标 Creator 工程的 `extensions/`。
2. 重启 Creator（右键菜单在启动时注册），等待扩展和项目脚本编译完成。

## 烘焙

1. 资源管理器里右键 Spine 的 `.json`（`sp.SkeletonData`，需要同目录的 atlas 与图集 PNG），选「烘焙 Spine VAT（straight）」或「（premultiplied）」，按图集是否预乘 alpha 选。
2. 产物写到同目录的 `<名>-vat/`：`manifest.spinevat`、`position-N.bin`、`light-N.bin` / `dark-N.bin`（有才出）和图集 PNG，已存在的同名文件会被覆盖。写完自动导入，`manifest.spinevat` 成为 `spinevat.SkeletonData` 资源。
3. 进度与结果看控制台的 `[Spine VAT Bake]`。过不了固定槽位规则的动画会让烘焙报错并写明是哪个动画、哪条规则。
4. 烘焙需要编辑器里打开着一个场景（临时节点挂在它下面，不存盘、不显示）。帧率固定 30。

`<名>-vat/` 可以整体挪到别的目录，里面的文件用相对路径互相引用。烘焙代码在 `bake/`，不在扩展挂载的 `assets/` 下，不会进游戏包。

只安装扩展即可。不要再复制旧的 `SpineVatAsset.ts`、`SpineVatComponent.ts` 或 `SpineVatRendererV2.ts`，新运行时不兼容这些旧类。

## 使用

1. 新建一个节点。
2. 添加组件 `Spine/VAT Skeleton`，组件类型为 `spinevat.Skeleton`。
3. 将 `manifest.spinevat` 拖到 `Skeleton Data`。
4. 在 `Initial Clip` 下拉列表选择初始动画，并设置 `Loop`、`Time Scale` 和 `Preview In Editor`。
5. 直接修改该节点的 Position、Rotation 和 Scale；组件不会创建实例根节点或 Lane 子节点。

一个 `spinevat.Skeleton` 只表示一个 VAT 实例。同一个 `spinevat.SkeletonData` 可以赋给多个节点：运行时会共享 VAT Texture、Mesh 和 Material，每个节点仍保存独立的动画、速度、循环、暂停和颜色状态。连续且渲染状态兼容的节点可由 Creator 合并为 GPU Instancing 批次；中间穿插其他渲染内容时会按渲染顺序拆批。

`spinevat.Skeleton` 本身继承 `MeshRenderer`，因此同一节点不要再添加 Sprite、MeshRenderer 等其他 Renderer。多 Slot/Lane 已经由组件内部的多 SubMesh 提交，不需要手工配置 Renderer。

## 2D 版：`spinevat.UiSkeleton`

UI 界面里用 `Spine/VAT UI Skeleton`（`spinevat.UiSkeleton`）：挂在 UI 节点（Canvas 下、`UI_2D` 层）上，同样赋 `Skeleton Data`、选 `Initial Clip`、设 `Loop` / `Time Scale` / `Preview In Editor`。它走 UI batch，和 Sprite、`sp.Skeleton` 按兄弟顺序穿插和遮挡；同一份资源的相邻实例合成一批（每 48 个实例一组材质）。组件会在节点下建几个 lane 子节点（不存进场景、层级面板里隐藏），编辑器里可直接预览。

脚本接口与 3D 版相同：`play` / `pause` / `resume` / `seek` / `setLoop` / `setTimeScale` / `setColor` / `setManualFrame` / `socket` / `snapshot` / `onVatEvent`。

两个组件都有静态开关 `interpolate`（默认 true）：帧间插值，VS 多一倍采样、CPU 不变；低端机可在创建实例前关掉。

## 脚本接口

```ts
import { SpineVatSkeleton } from 'db://spine-vat-importer/runtime/SpineVatSkeleton';

const skeleton = node.getComponent(SpineVatSkeleton)!;
skeleton.play('idle', { loop: true, speed: 1 });
skeleton.pause();
skeleton.resume();
skeleton.seek(0.5);
skeleton.setTimeScale(0.8);
skeleton.setManualFrame(12); // 传 null 恢复按时间播放
```

还可以使用 `setColor()`、`socket()`、`snapshot()` 和 `onVatEvent()`。这些 API 操作当前组件实例，不会影响使用同一资源的其他节点。

## 限制

- 仅面向 Cocos Creator 3.8.7。
- 烘焙输入为 Spine 4.2 JSON、atlas 和对应纹理页，不支持 `.skel`。
- VAT 只能还原转换时烘焙的动画、皮肤组合和渲染 Lane。运行时换装、任意骨骼约束修改和未烘焙的动态附件不属于该运行时能力。
- 不再支持旧组件的 `Resource Root`、手填资源数组、`instanceCount`、`columns` 或批量布局参数。
- 启动时编辑器会提示 `contribution.importer 已在 3.8.3 版本废弃，请更换为 contribution.asset-handler`，可以忽略，**不要删 `package.json` 里的 `importer`**：在 3.8.7 上，工程扩展只声明 `asset-handler` 不会注册进资源数据库的工作进程，`manifest.spinevat` 会退回默认导入器（`*` / `cc.Asset`），组件拿不到资源。实测过（2026-09-24）。


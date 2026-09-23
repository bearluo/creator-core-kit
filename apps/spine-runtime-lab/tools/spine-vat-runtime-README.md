# Spine VAT Runtime（Cocos Creator 3.8.7）

该压缩包提供 Spine VAT 转换结果在 Cocos Creator 3.8.7 中使用所需的完整扩展。运行时脚本、资源类型、Importer、Inspector 和 Effect 全部位于同一个扩展内，不需要再向工程的 `assets/scripts` 复制任何脚本。

## 安装

1. 解压后，将 `extensions/spine-vat-importer` 整个目录复制到目标 Creator 工程的 `extensions/`。
2. 回到 Creator，等待扩展和项目脚本编译完成。
3. 将转换工具导出的完整资源目录拖入工程 `assets/`，其中必须包含 `manifest.spinevat`、所有 `.bin` 和图集纹理。
4. `manifest.spinevat` 导入成功后会成为 `spinevat.SkeletonData` 资源。

只安装扩展即可。不要再复制旧的 `SpineVatAsset.ts`、`SpineVatComponent.ts` 或 `SpineVatRendererV2.ts`，新运行时不兼容这些旧类。

## 使用

1. 新建一个节点。
2. 添加组件 `Spine/VAT Skeleton`，组件类型为 `spinevat.Skeleton`。
3. 将 `manifest.spinevat` 拖到 `Skeleton Data`。
4. 在 `Initial Clip` 下拉列表选择初始动画，并设置 `Loop`、`Time Scale` 和 `Preview In Editor`。
5. 直接修改该节点的 Position、Rotation 和 Scale；组件不会创建实例根节点或 Lane 子节点。

一个 `spinevat.Skeleton` 只表示一个 VAT 实例。同一个 `spinevat.SkeletonData` 可以赋给多个节点：运行时会共享 VAT Texture、Mesh 和 Material，每个节点仍保存独立的动画、速度、循环、暂停和颜色状态。连续且渲染状态兼容的节点可由 Creator 合并为 GPU Instancing 批次；中间穿插其他渲染内容时会按渲染顺序拆批。

`spinevat.Skeleton` 本身继承 `MeshRenderer`，因此同一节点不要再添加 Sprite、MeshRenderer 等其他 Renderer。多 Slot/Lane 已经由组件内部的多 SubMesh 提交，不需要手工配置 Renderer。

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
- 当前转换器输入为 Spine 4.2 JSON、atlas 和对应纹理页，不支持 `.skel`。
- VAT 只能还原转换时烘焙的动画、皮肤组合和渲染 Lane。运行时换装、任意骨骼约束修改和未烘焙的动态附件不属于该运行时能力。
- 不再支持旧组件的 `Resource Root`、手填资源数组、`instanceCount`、`columns` 或批量布局参数。


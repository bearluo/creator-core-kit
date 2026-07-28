---
状态: 草案（评审中）
摘要: 横评 Cocos 3.8 UI 管理（层级/窗口栈/生命周期）与音频服务（BGM/SFX/音量分类），为 IUIManager / IAudioService 定接口形状、core↔engine 拆分边界与可测接缝。
何时读: 设计 UI 打开/关闭/返回栈/模态、音频播放/停止/音量/静音，或质疑相关选型时。
日期: 2026-07-27
依赖: docs/design/2026-07-24-architecture-overview.md, packages/core/docs/modules/asset-manager.md, packages/core/docs/modules/save-manager.md
---

# UIManager / AudioService 横评

## 目的与范围

第 2 批设施收尾两块：**UIManager（层级/窗口栈/生命周期）** 与 **AudioService（`IAudioService`）**。两者都强依赖 cc（前者操作 `cc.Node` 树/prefab，后者操作 `cc.AudioSource`/`AudioClip`），是本仓「UI 与逻辑分离、逻辑可脱离引擎测试」铁律最吃紧的地方。本横评产出：

- Cocos 3.8 两块子系统的**事实基线**（原生 API、无内建栈/路由、Web autoplay 限制等）；
- 关键难点与坑；
- 姊妹/开源框架做法（oops-framework LayerManager/AudioManager、godot-core-kit、bearluo `@ccc/fw`）；
- **设计候选 + 倾向性建议**，并**显式列出需拍板的选型分歧**（尤其 UIManager 是否要 core 半），供后续两篇模块设计文档定稿。

> 铁律约束：接口（`IUIManager` 的可测导航逻辑、`IAudioService`）进 `core`；一切 cc 交互（节点树、prefab 实例化、`AudioSource` 播放）经 core 定义的接缝下沉到 `engine`。cc 类型（`Node`/`Prefab`/`AudioClip`）**不得进 core 接口签名**。

---

## A. AudioService

### A.1 Cocos 3.8 原生事实基线

- **`cc.audioEngine` 在 3.x 已移除**——不再有全局播放器单例。3.8 唯一正道是 **`AudioSource` 组件**（挂在 `Node` 上）。
- `AudioSource`：`clip`、`volume`(0..1)、`loop`、`play()`/`pause()`/`stop()`、`playOneShot(clip, volumeScale)`。
  - `play()`：走组件自身的 clip，**可 stop/pause**（一次一条，适合 BGM）。
  - `playOneShot(clip, scale)`：**fire-and-forget**，同一 AudioSource 可叠多条并发音效，但**无句柄、不可单独 stop**。
- `AudioClip` 是资源，经 `IAssetLoader`/bundle 加载（依赖已实现的 AssetManager）。
- **Web/小游戏 autoplay 限制**：浏览器策略要求音频必须在**用户手势**后才能起播；首帧自动播 BGM 会被静默拦截，需在首次 touch 时 resume。
- **切后台**：游戏隐藏时应 pause，回前台 resume（`game.on(Game.EVENT_HIDE/SHOW)`）——engine 事。

### A.2 难点

- **A-N1 BGM 单轨不变式**：同一时刻只应有一条 BGM；播新曲须停旧曲。可选淡入淡出（crossfade）。
- **A-N2 SFX 并发与可停止性**：`playOneShot` 省事但不可停；需要「可停止的音效」（如循环脚步声、可打断的语音）就得用**池化的 AudioSource**并返回句柄。
- **A-N3 音量分类 + 静音 + 持久化**：master / music / sfx（/voice）分档，各自音量 + 静音；有效音量 = master × 分类 ×（静音?0）。改音量要**实时作用到在播的源**。音量偏好要持久化（复用已实现 SaveManager/IStorage）。
- **A-N4 clip 归属**：core 不能持 `cc.AudioClip` 类型 → core 只认「名字/路径」，加载+播放原子地下沉到 engine 播放器；或 core 用 `IAssetLoader` 拿 `unknown` 再交给播放器（多一跳，收益低）。

### A.3 姊妹/开源框架

- **oops-framework `AudioManager`**：拆 `AudioMusic`（单条，包一个 AudioSource，管 BGM + 切换/循环）+ `AudioEffect`（包一个 AudioSource，`playOneShot` 放音效）。全局 `volume_music`/`volume_effect` + `switch_music`/`switch_effect`（静音开关），音量落 `localStorage`。**印证**：BGM 单轨、SFX 走 oneShot、音量分类 + 开关 + 持久化是行业标配。
- **godot-core-kit**：Godot 有 AudioServer bus 体系，kit 包 bus 音量 + play 助手；对标点是「分类音量总线」= 我们的 category 音量模型。

### A.4 设计候选 + 建议

- **core 半（`IAudioService` + 逻辑）**：持 category 音量/静音状态、BGM 当前句柄、活跃音效句柄表；算有效音量并实时下发；播放/停止/设音量经 `IAudioPlayer` 接缝下沉。**这是真正可测的逻辑**（音量数学、BGM 单轨、静音传播），值得建 core 半。
- **engine 半（`IAudioPlayer` cc 实现）**：`play(name, {loop,volume}) → handle`、`stop(handle)`、`setVolume(handle,v)`、`pause/resumeAll`；内部用 `IAssetLoader` 加载 `AudioClip` + 池化 AudioSource；处理 autoplay 解锁、切后台。
- **音量持久化**：AudioService 依赖 `IStorage`（已有）自持读写，比「暴露 get/set 交给上层」少一层胶水 → 建议自持，可关。

### A.5 需拍板分歧

- **Q-A1 SFX 句柄模型**：只 fire-and-forget（省事，覆盖 90% 音效）／可停止句柄（池化，支持循环音效/打断）／两者都给（`playOneShot` 便捷 + `playEffect` 返句柄）。
- **Q-A2 音量分类档数**：master/music/sfx（三档，够用）／再加 voice（四档，含语音）。

---

## B. UIManager

### B.1 Cocos 3.8 原生事实基线

- 只有 `cc.Node` 树 + `Canvas` + `cc.Widget`（自适应）+ prefab 实例化。**无内建 UI 栈/路由/层级管理**——全靠框架自建。
- 打开一个 UI = 加载 prefab（`IAssetLoader`）→ `instantiate` → 挂到某层 Node 下 → 播动画 → 生命周期回调。

### B.2 难点

- **B-N1 层级/z-order**：需固定层（如 Game/UI/PopUp/Dialog/Toast/Loading/Guide），各层一个容器 Node，按层归位避免 z 混乱。
- **B-N2 窗口栈 + 返回**：模态弹窗常需 back-stack（安卓返回键/返回上一屏）。是否要全局单栈？
- **B-N3 模态/遮罩**：弹窗要暗化背景 + 拦截穿透点击。
- **B-N4 异步打开竞态**：prefab 异步加载期间重复 open、加载中 close → 需去重/取消（对标 AssetManager 的 inflight 去重）。
- **B-N5 单例 vs 多实例 + 缓存**：同名窗口再开是聚焦已存在还是新建？关闭是销毁还是隐藏缓存（复用省加载）。
- **B-N6 生命周期 + 传参/回传**：onShow/onHide/onClose，打开传 args、关闭回传 result。
- **B-N7 自适应/安全区**：`cc.Widget`/safe-area——纯 engine。

### B.3 姊妹/开源框架

- **oops-framework `LayerManager`**：`LayerType` 枚举（Game/UI/PopUp/Dialog/System/Notify/Guide…），每层一个 `Node`；`open(prefabPath, uiid, params, callbacks)`，`UIMap` 缓存已加载 UI，走 `oops.res`（= IAssetLoader）加载。生命周期经组件回调。**印证**：层枚举 + 每层容器 Node + 按需加载 prefab + 缓存表是主流。
- **bearluo `@ccc/fw`**：同作者 Cocos 框架，UI 亦在 engine 层管 Node 树。

### B.4 设计候选：**core/engine 拆分是本模块的核心分歧**

- **候选 A（core 半 + engine 渲染 seam）**：core 持**可测导航状态机**——窗口栈、层归属、打开/关闭/返回/模态状态、inflight 去重、缓存策略决策；实际 `cc.Node` 实例化/挂载/销毁经 `IUIView` 接缝下沉 engine。优点：导航逻辑可脱引擎单测，贴合本仓铁律；缺点：接缝抽象成本，UI 大量价值本就在 engine（节点/widget/动画）。
- **候选 B（纯 engine，`progress.md` 现状标注）**：UIManager 整个进 engine，直接用 `IAssetLoader` 加载 + 操作 Node；无 core 半。优点：少一层间接、贴近 cc 现实；缺点：打开/关闭/返回栈逻辑不可脱引擎测试，违背「逻辑可测」主旨。

> 倾向：**候选 A 的「瘦 core 半」**——只把真正是逻辑的窗口栈/路由/去重/缓存**决策**放 core（可测），engine 只做 Node 的 show/hide/destroy 与 prefab 加载。与 SceneFlow（core 状态机 + engine 真切场景）同构。但 UI 的 engine 占比远高于其它模块，若判断 core 半过薄、间接大于收益，退候选 B 亦合理——**交用户拍板**。

### B.5 需拍板分歧

- **Q-U1 core/engine 拆分**：瘦 core 半（可测导航栈，候选 A，推荐）／纯 engine（候选 B，表格现状）。
- **Q-U2 栈/路由模型**（若走 core 半）：全局单 back-stack（统一返回键）／每层独立无全局返回（更简单，够多数手游）。

---

## 小结：待拍板项

| 编号 | 分歧 | 选项（含倾向） |
|---|---|---|
| Q-A1 | SFX 句柄模型 | oneShot 便捷 + `playEffect` 返句柄（都给，推荐）／只 oneShot／只句柄 |
| Q-A2 | 音量分类档数 | 三档 master/music/sfx（推荐）／四档加 voice |
| Q-U1 | UIManager 拆分 | 瘦 core 半（推荐）／纯 engine |
| Q-U2 | UI 栈模型 | 每层独立无全局返回（推荐，简单）／全局单 back-stack |

拍板后各出 `packages/core/docs/modules/{audio-service,ui-manager}.md` 定稿 → TDD。

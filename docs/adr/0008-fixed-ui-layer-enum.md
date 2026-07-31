---
状态: 已接受
日期: 2026-07-31
依赖: packages/core/docs/modules/ui-manager.md, packages/engine/docs/modules/camera-rig.md, docs/research/2026-07-31-ui-layer-management-survey.md
---

# ADR-0008：UI 层改为 10 档固定枚举，一次定死

## 背景

UIManager v1 的层是**任意字符串**，engine 侧 `cc-ui.ts` 按需懒建 `UILayer_<name>` 容器。两者叠加的后果是：

> **层的 z 序 = 各层容器首次被 open 的顺序。**

先弹 toast 再开 popup，popup 就盖住 toast；同一份代码在不同的用户操作路径下有不同的叠放结果，且没有任何报错。这是一个只在特定操作顺序下复现的偶发 bug，线上极难归因。

横评（2026-07-31）里四家实现无一例外都是「启动时按声明顺序把层建全」：oops-framework 在 `LayerManager` 构造函数里固定顺序 new 出 7 层；TEngine 用 `enum UILayer` × `LAYER_DEEP` 算 `sortingOrder`；godot-core-kit 的 UI 栈层次由节点树固定；社区单场景方案也是场景里预置层节点。

## 决策

1. **层名从任意 `string` 收敛为 10 档固定枚举** `UI_LAYERS`：`back, hud, ui, popup, dialog, guide, loading, system, notify, top`。**数组顺序即 z 序**（自下而上）。
2. **engine 启动时按该顺序把 10 个层容器一次建全**，不再懒建。
3. **一次给全 10 档，不做「先给 5 档，不够再加」**——此处 YAGNI 不适用（见理由）。
4. 层 → 相机层的映射（`back→uiBack`、`hud/ui/popup/dialog→ui`、其余 → `uiFront`）带**回退**：相机组没启用的层落回 `ui` root，层序仍由「一次建全」的顺序保证。业务代码与层枚举都不因相机配置而变。

## 理由

- **懒建顺序 = z 序是真 bug，不是风格问题**：修它必须让容器的建立顺序与打开顺序解耦，也就是启动时建全；而要建全，就必须先知道有哪些层——层名因此不能是任意字符串。这两件事是同一个决策的两面。
- **为什么一次给全而不是渐进加档**：层是**一次性定死**的东西。事后往中间插一档（比如在 `dialog` 与 `guide` 之间加 `tips`），会改变**所有既有界面的相对次序**——所有跨这两档的叠放关系全部重排，且同样没有报错。渐进添加在这里不是省事，是把一次性成本换成一次全局回归。10 档取自四家横评的并集，覆盖到「引导必须盖住弹窗」「公告必须盖住 loading」「toast 不阻断所以压在最上」这些真实存在的排序诉求。
- **代价可接受**：10 个空 Node，无 UITransform、无组件，建立成本可忽略；未用到的层就是 10 个空容器。
- **破坏性可控**：`open(uiId, opts)` → `open(uiId, args)` 的签名变更同期发生，当时全仓调用点只有一个探针 + 单测。

## 后果

- 项目**不能自定义层名**。确有需要时的出路是改 kit 的枚举（一次性、全局评审），而不是各项目自己传字符串——后者正是本 ADR 要消灭的东西。
- 层枚举此后属于**破坏性变更面**：往中间插档要按 ADR 重新评审，末尾追加（`top` 之后）相对安全。
- `UILayer` 是 core 的公开类型，engine 的层容器与相机层映射都以它为准；新增层需要 core + engine 同步改。

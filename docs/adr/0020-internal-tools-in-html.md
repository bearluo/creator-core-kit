---
状态: 已接受
日期: 2026-09-02
依赖: docs/design/2026-08-31-mini-fish-content-editor.md, docs/adr/0001-di-container-and-engine-interfaces.md
---

# ADR-0020：只在浏览器跑的内部工具用 HTML，不做进 Cocos

## 背景

鱼阵编辑器（路径 + 鱼阵的可视编辑）先按 Cocos 模块做了一版：`assets/modules/mini-fish-editor/`，
一个 bundle、五张 prefab、约 700 行 View、一张自己烘的九宫格底图。它能用，但**比先出的 HTML
原型难看、也难改**，于是重问一次「为什么它得在 Cocos 里」。

回答这个问题的关键事实是：**「跟游戏共用逻辑」跟 Cocos 一点关系都没有**。整个
`modules/mini-fish/` 加编辑器那棵树里，`import 'cc'` 的只有两个文件，两个都是 View：

```
FishVM / 七个 system / seams / content / paths / fish-kinds / render-map   零 cc
FishGame.ts（游戏 View）   ← import 'cc'
FishEditor.ts（编辑器 View）← import 'cc'
```

也就是说编辑器要复用的那部分**本来就是普通 TS 模块**，一个 vite 工程今天直接 `import` 就能吃，
零重构。留在 Cocos 里换来的只有两样东西：

1. **一个没有 CSS 的 UI 工具箱。** 能用的是一张九宫格图 + 乘算染色；hover / focus / 滚动条 /
   文本输入 / 光标 / 选区 / tooltip 全要手搓，每个都要一个节点加一段代码。原型里
   `.tabs button.on{background:var(--amber-soft); box-shadow:inset 0 0 0 1px var(--amber)}`
   一行的事，在那边做不出来 —— 一张图的描边和填充被锁死在 1 : 0.706 的比例上。
2. **一个只有策划用的工具，跟着产品一起下发给玩家。** 它是大厅清单里的一个 `kind:'game'` 条目，
   `devOnly` 删得掉入口，删不掉产物（Creator 按目录 meta 的 `isBundle` 收包，与可达性无关）。

## 决策

**分界线是「有没有 DOM」，不是「跟游戏有没有关系」。**

| | 用什么 | 为什么 |
|---|---|---|
| 只在浏览器跑的**工具** | HTML / vite（`apps/fish-editor/`） | 有 CSS、有原生控件、有剪贴板；不进任何游戏包 |
| 会进客户端的**任何界面** | Cocos prefab | native（Android / iOS）与微信小游戏**没有 DOM**，`document` 不存在 |

这条**不能推广到游戏界面**。游戏 UI 走 prefab 的约定（见 `CLAUDE.md`「多人协作」）原封不动。

### 一致性不靠宿主，靠「一处实现」

搬去 HTML 之后「编辑器里看到的跟游戏里一样吗」这个问题反而**变好回答了**，因为搬家时把
原本各写一份的映射抽成了共享模块 `modules/mini-fish/render-map.ts`（零 `cc`）：

| | 谁给的 | 搬家前的状态 |
|---|---|---|
| 出场时机 / 轨迹 / 恒速 / 离场 | `FishVM` + `pathSystem` + `waveFeeder`（同一份） | 已经是共用的 |
| 帧号（12fps，按鱼种回绕） | `render-map.fishFrame` | 游戏播序列帧，编辑器**永远停在 `_run_0`** |
| 朝向（切线 + 过 90° 上下翻） | `render-map.fishFacing` | 两边各写一份 |
| 场地缩放（cover） | `render-map.fieldScale` | 游戏 cover，编辑器 contain 还留白 |
| 鱼画多大 | 图集里那一帧自己的尺寸 | 游戏按美术原尺寸，编辑器**按判定半径 `r` 算框** |

也就是说：**不一致在搬家之前就存在**，来源是「两个 View 各写一份映射」，跟宿主无关。留在
Cocos 不会自动解决它，搬去 HTML 也不会制造它。

只有渲染管线本身进不了 DOM：水面后处理、海底、命中闪白。这三样**编辑器本来就不显示**
（2026-08-31 决定的：水效果妨碍看控制点）。

代价是 DOM 侧要自己解析 `textures.plist`（约 40 行，Cocos 侧是 `SpriteFrame` 白给的）。
这笔代价买回的是「同一张图、同一帧、同一尺寸」，比原先那个按 `r` 算的框准。

反过来还多了一样只有 DOM 才顺手做的：游戏是 `Math.max`（cover），**窄屏会把 `FIELD` 上下裁掉**，
而旧编辑器画的是完整场地框，等于在骗人。新的用 `render-map.visibleField` 叠一圈安全区
（1440 × 864，4:3 ~ 20:9 都看得见）。

## 影响

- `apps/fish-editor/`（vite，**没有自己的 package.json** —— monorepo 是 `nodeLinker: hoisted`，
  vite 在根 `node_modules` 里）。入口 `pnpm editor`，别名 `@game` → `apps/demo/assets/modules/mini-fish`。
- `assets/modules/mini-fish-editor/` 整个删除：一个 bundle、五张 prefab、`Editor.scene`、
  九宫格底图与 `gen:ui-slice`、`catalog.ts` 的那一行、大厅入口。
- `EditorVM.ts` 与它的 32 条测试搬去 `apps/fish-editor/`。`check-vm-tests.mjs` 认第二种源码根
  （`src/`，此前只认 `assets/`），闸照旧覆盖它。
- 根 `eslint.config.js` 的 ignore 从 `apps/**` 收窄成逐个列 Cocos 工程 —— 普通 TS 工程默认受
  根契约管，不再各配一份。
- `catalog.ts` 的 `devOnly` 暂时**没有条目在用**。字段保留：「开发工具进不进大厅」是接入方要的
  能力，不是这个编辑器的遗迹。

## 没有采纳的

- **中栏画布留在 Cocos、外壳用 DOM。** 两套坐标系、两套输入路由、z-order 互相压不住，
  两边的缺点全占。
- **留在 Cocos，把 UI 工具箱做厚**（烘一整套 sprite、写控件库）。那是在给一个不需要发布的工具
  造框架；发布形态本身就不要求它在引擎里。
- **HTML 里自己实现一份鱼的运动。** 那会正面违反编辑器存在的理由 —— 恒速、朝向、离场各有两份
  实现，迟早漂，而漂的那天你信的是编辑器、错的是游戏。

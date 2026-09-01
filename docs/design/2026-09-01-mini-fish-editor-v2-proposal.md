---
状态: 已定稿
日期: 2026-09-01
依赖: docs/design/2026-08-31-mini-fish-content-editor.md, docs/design/2026-08-28-mini-fish-design.md, docs/design/testing-strategy-overview.md, apps/demo/docs/ui-style-guide.md
---

# 鱼阵编辑器 v2：两个页签 + 多段路径 + 交互对齐

> 摘要：编辑器从「一屏 + 单段贝塞尔 + 缩水控件」改成「**两个页签 + 分段贝塞尔链 + 按原型对齐的完整交互**」。
> 顺带修掉一个**现存 bug**：`PathFollow.t` 被当弧长比例推、`pointAt` 却按贝塞尔参数求值，实测最弯那条路
> 快慢比 **4.01×** —— 文档里写的「恒速像素前进」对弯路一直不成立。
> 何时读：动 `mini-fish/content/` 或 `mini-fish-editor/` 之前；给编辑器加交互之前。
> 验收单是[**可交互原型**](../../apps/demo/docs/mockups/fish-editor-v2-prototype.html)（浏览器直接打开），不是本文。

**决策出处**：[图 · 鱼阵编辑器 v2](https://hlgit.5518game.com/luohao/creator-core-kit/-/issues/11)。
每条决策住在它自己的票里，本文只**引用**并补上「怎么落地」那一半 —— 改哪些文件、什么顺序、每步的闸。

---

## 动机

三条，前两条是人提的，第三条是做的过程中量出来的。

### 1. 上一版的交互是**缩水**，不是平台限制

[原型](https://hlgit.5518game.com/luohao/creator-core-kit/-/issues/5)定的 `<input type=number>` / `<select>` / 可拖进度条，实施时被换成了 ◀▶ 步进和裸 Label 按钮，没有底、没有边框、没有 hover。实测整个 `FishEditor.ts` 用了 **0 个 `Layout`、0 个 `EditBox`**，`Sprite` 六处还都是鱼的图不是 UI 底。

而 Cocos 这些**都有**：`EditBox`（web 端是真 DOM input）、`Slider`、`Button` 自带 COLOR transition、`Layout`、`ToggleContainer`；`packages/engine/src/reactive-bind.ts` 里 `bindEditBox` / `bindToggle` 已经写好了。唯一真没有原生等价物的是 `<select>` 下拉，而自绘弹层只要几十行。

⇒ 这不是「做不到」，是「没做」。

### 2. 一条路径只有一段三次贝塞尔，画不出 S 形、绕圈、长路径

四个控制点的表达力上限就在那儿。`loop-left` 已经是它能画出的最扭的形状了，而「鱼沿屏幕边跑一段再拐进来」这种常见鱼阵根本画不出来。

### 3. 「恒速像素前进」这句话对弯路一直是假的

运行时推的是 `PathFollow.t += speed * dt / path.length`（把 `t` 当**弧长比例**），而 `pointAt` 按**贝塞尔参数**求值。两者不是一回事：

| 路径 | t 均匀推进时每步走的像素（最慢 / 平均 / 最快） | 快慢比 |
|---|---|---|
| `cross-lr` | 22.8 / 23.2 / 23.4 | 1.03× |
| `wave-lr` | 23.3 / 25.5 / 34.9 | 1.50× |
| `loop-left` | 13.5 / 29.3 / 54.2 | **4.01×** |

`loop-left` 那条鲨鱼**现在就在忽快忽慢**，最快时是最慢的四倍。没人发现是因为只有那一条路够弯，其余是控制点等距的直路（参数 ≈ 弧长）。

多段会把它放大：段与段的长度差远大于单段内部的参数不均。所以借这次一起修 —— **不修的话，多段就是在一个坏底子上加倍**。

---

## 变更总览

| 文件 | 动什么 | 为什么 |
|---|---|---|
| `mini-fish/content/paths.ts` | `bezier` 改成吃「段」；新增 `locate()`；`arcLength` 逐段累加并建「弧长→参数」查找表 | 分段 + 真弧长参数化 |
| `mini-fish/content/content-types.ts` | `p` 的注释改成 `6n+2`，写清接点共享 | 数据形状 |
| `mini-fish/content/content.ts` | **一个字都不改** | `n=1` 正好 8 个数 ⇒ 现有 8 条路径天然合法 |
| `mini-fish/ecs/components.ts` · `pathSystem.ts` · `feedSystem.ts` | `PathFollow.t` **改名**（`s` / `progress`） | 名字说谎正是那个 4× bug 的根 |
| `mini-fish-editor/EditorVM.ts` | 多段编辑 + 镜像 + `MIN_HANDLE` 夹紧 | 编辑逻辑 |
| `mini-fish-editor/FishEditor.ts` | 拆成两页；平移缩放；控件换真控件 | 交互对齐 |
| `mini-fish-editor/*.prefab` | 拆五张（外壳 + 两页 + 两张列表项模板） | `EditorPanel` 已 155 条目，两页塞一张会到 300+ |
| `mini-fish-editor/art/panel.png` **新增** | 16×16 九宫格底图 | 面板 / 卡片 / 按钮底一张图染色搞定 |
| `apps/demo/scripts/gen-ui-slice.mjs` **新增** | 烘那张图 | 照抄 `gen-noise.mjs` |
| `test/.../content.test.ts` | 闸从**两条变三条** | 见测试计划 |
| `apps/demo/docs/ui-style-guide.md` | 补一节「内部工具不适用本风格」 | 它写着「不要：深色科技感」，而编辑器正是 |

**不动的**：`content.ts` 的数据、`rev`、`FishFeeder` 那道缝、`waveFeeder` 的行为、bundle 优先级（`mini-fish` 2 / 编辑器 1）。

---

## 目标 API

### `content/paths.ts`

```ts
/** 一条路径：`6n+2` 个数（第 k 段吃下标 6k..6k+7，相邻段共享接点坐标）+ 载入时算出的派生量。 */
export interface FishPath {
  readonly p: readonly number[];
  /** 采样弧长（设计像素）。 */
  readonly length: number;
  /** 「累计弧长 → 全局参数」查找表。派生量，不进 `content.ts`。 */
  readonly lut: { readonly d: readonly number[]; readonly g: readonly number[] };
}

/** 手柄离锚点的最小距离。**不许为零** —— 见「决策」第 3 条。 */
export const MIN_HANDLE = 60;

/** 已走弧长比例 s∈[0,1] → 全局参数 g∈[0,n]。二分 + 线性插值。 */
function locate(path: FishPath, s: number): number;

/** 两个都改吃**弧长比例**，签名不变、语义变了。 */
export function pointAt(path: FishPath, s: number): { x: number; y: number };
export function angleAt(path: FishPath, s: number): number;
```

⚠️ `pointAt` / `angleAt` 的**入参语义变了**（贝塞尔参数 → 已走弧长比例）。签名一样、类型也一样，所以
**编译器不会报错** —— 所有调用点都要人眼过一遍。现有调用点只有三处：`pathSystem`、`feedSystem`、
`FishEditor`（画曲线），都在本次改动范围内。

### `mini-fish-editor/EditorVM.ts`

```ts
selectedSegment: number;

/** 顺着末端切线接一段，天然平滑。 */
addSegment(): void;
/** 少于 2 段不许删。 */
removeSegment(): void;

/**
 * 拖第 `i` 对坐标。
 * - 锚点：两侧手柄**刚性跟随**（否则形状会被拽变）。
 * - 手柄：`mirror` 时把接点对面那个**只对齐方向、保留原长**；首尾锚点没有对面。
 * - 一律 `MIN_HANDLE` 夹紧；落点正好压在锚点上时**沿用该手柄原来的方向**推出去。
 */
dragPoint(i: number, x: number, y: number, options?: { mirror?: boolean }): void;

/** 每个折角接点的段号与夹角（度）。给 View 标红用。 */
corners(): readonly { seg: number; deg: number }[];
```

**留在 View 不进 VM**：`dragging`（瞬态指针状态）、镜像修饰键（输入）、显影集合与名称筛选
（视图状态，**不许进导出**）、视野的平移缩放。

---

## 决策

一行一条，详情在票里。**本文不复述决议** —— 决策住在票里，一处一份。

| # | 决策 | 一句话 |
|---|---|---|
| [#12](https://hlgit.5518game.com/luohao/creator-core-kit/-/issues/12) | 数据形状 | 一维 `6n+2` 拼接，相邻段共享接点 ⇒ 位置连续是**结构保证**的；`n=1` 即 8 个数 ⇒ **零迁移、`rev` 不跳** |
| [#12](https://hlgit.5518game.com/luohao/creator-core-kit/-/issues/12) | `t` 语义 | 真弧长参数化，**每段 128 采样**（32→1.093× / 64→1.041× / **128→1.017×**；取 128 是给 ≤1.05 的闸留三倍余量） |
| [#12](https://hlgit.5518game.com/luohao/creator-core-kit/-/issues/12) | 接点连续性 | **允许折角**（鱼沿屏边跑再拐进来是常见鱼阵），镜像是编辑器的事；`angleAt` 在接点取右段切线 |
| [#12](https://hlgit.5518game.com/luohao/creator-core-kit/-/issues/12) | `MIN_HANDLE = 60` | 手柄归零 ⇒ 导数 `3(P1−P0)=0` ⇒ `angleAt` 守卫返回 0 ⇒ **鱼突然朝右，不崩不报错**。夹紧在 VM |
| [#13](https://hlgit.5518game.com/luohao/creator-core-kit/-/issues/13) | 页签划分 | 画布**共用一块**；走带**只在鱼阵页**（路径页不跑运行时，「恒速」由单测闸担保不靠肉眼） |
| [#13](https://hlgit.5518game.com/luohao/creator-core-kit/-/issues/13) | `EditorVM` **不拆** | 「删路径 ⇒ group 标红」这条跨表关系现在**跨页签**，拆了反而要造同步 |
| [#13](https://hlgit.5518game.com/luohao/creator-core-kit/-/issues/13) | prefab 拆五张 | 切页签用 `active` 不换 prefab（同包内动态加载省不了下载、只换来闪烁） |
| [#14](https://hlgit.5518game.com/luohao/creator-core-kit/-/issues/14) | 框 = 一张 16×16 九宫格 | 圆角 6px、1px 描边、**灰底 180 + 白边 255** ⇒ 染色后边比底亮 43%，一个节点拿到深底亮边 |
| [#14](https://hlgit.5518game.com/luohao/creator-core-kit/-/issues/14) | 控件对应物 | 下拉自绘弹层 · hover 统一走 `Button`（**列表行也是 Button**）· 数字 `EditBox` **夹紧不拒绝** · 进度条 `Slider` · 不塞等宽字体 · `Layout` 只用在一维列表 |
| [#15](https://hlgit.5518game.com/luohao/creator-core-kit/-/issues/15) | 验收单 = 原型 | 存在 `apps/demo/docs/mockups/fish-editor-v2-prototype.html`，**少一样就是偏差** |
| [图 Notes 4](https://hlgit.5518game.com/luohao/creator-core-kit/-/issues/11) | 视觉风格 | **不跟** `ui-style-guide.md` 的明亮卡通 —— 内部工具，深色才看得清曲线；要在风格文档里补上这个边界 |

### 原型试用逮到的四条，必须带进实施

它们全是「本机快、数据小」时看不出来的那类，靠规则不靠运气：

1. **手柄拖到锚点上会永久塌陷** —— 镜像方向未定义（零向量）+「保留原长」而原长已是 0 ⇒ 每次镜像都把它算回锚点，抓不出来。⇒ `MIN_HANDLE` 夹紧 + 方向退化时沿用原方向。
2. **控制点被拖到视野外就够不着** —— 视野写死。⇒ 空格/中键平移 + 滚轮缩放（光标下的点不动）+ 「适应内容」，且**命中半径要屏幕恒定**（否则放大后极难点中）。
3. **整批重建列表项会丢滚动位置** —— 「加一队鱼」之后视图跳回顶部、新那队在下面看不见，看起来像没反应。⇒ `ScrollView` 重建前后存 / 还原 `getScrollOffset()`，加一项后 `scrollToBottom()`。
4. **弹层被滚动容器裁掉** —— Cocos 的 `ScrollView` 带 `Mask`，跟浏览器 `overflow` 同理。⇒ 弹层挂**更高层节点**，不放列表项里。

---

## 测试计划

### 闸从两条变三条（`test/modules/mini-fish/content/content.test.ts`）

| | 断言 | 挡的是什么 |
|---|---|---|
| ① | `(p.length - 2) % 6 === 0 && p.length >= 8` | 段数不合法。`as const` 和 `typecheck` 都挡不住 |
| ② | 每条路径按弧长均匀采样 200 点，相邻点距离**快慢比 ≤ 1.05** | **直接测「恒速」这个性质本身**。那个 4× 能活到今天，就是因为担保它的只有一行注释 |
| ③ | 每个手柄到它锚点的距离 ≥ `MIN_HANDLE` | 编辑器夹紧只挡住「编辑器造不出坏数据」，挡不住「坏数据被人手贴进来」 |

三条闸的共同前提：`content.ts` 是**人手贴回**的文件，坏数据完全可能从编辑器之外进来（手改、合并冲突改错）。

**不加**的两条：接点位置连续（结构保证，闸挡的是不会发生的事）；C1 连续（明确允许折角）。

### `EditorVM` 单测（镜像路径，`pnpm check:vm-tests` 强制）

原型试出来的那组数直接当用例：

- 拖手柄到锚点上 ⇒ 夹到 **60**，对面保持原长 **560**，**再往外拖能拽回来**（塌陷版在第二步卡死）。
- 镜像只转方向不改对面长度：拖 `(760,−240)→(989,−305)`，对面 `(200,−460)→(296,−774)`，到锚点距离仍是 560。
- `Alt` 打断时对面纹丝不动。
- 加段：`2 → 3 → 2`，段数与 `p.length` 同步；少于 2 段删不掉。
- 折角识别：直线接 90° 弯 ⇒ `corners()` 返回 `[{ seg: 1, deg: 90 }]`。

### 启动 smoke / e2e

**web 真产物**：Boot → 游客登录 → 大厅 → 编辑器 → 两个页签都进 → 多段曲线拖得动 → 鱼按弧长恒速游 → 导出文本对得上。

⚠️ **必须用真鼠标**（Playwright `page.mouse`）。合成 DOM 事件打不进 Cocos 输入 —— 上一轮据此得出过「按钮全都点不动」的**假结论**，查到 `hitTest` 返回 true 才定位到是测试手段的问题。

---

## 实施步骤

一刀一票，顺序即依赖：

| 刀 | 票 | 内容 | 完成判据 |
|---|---|---|---|
| ① | 本文（[#16](https://hlgit.5518game.com/luohao/creator-core-kit/-/issues/16)） | 提案定稿 | 本文标「已定稿」+ 现状文档加 `改造中:` 指针 |
| ② | [#17](https://hlgit.5518game.com/luohao/creator-core-kit/-/issues/17) | 分段贝塞尔 + 弧长参数化 + 三条闸 + `PathFollow.t` 改名 | `pnpm test` 全绿，`loop-left` 快慢比从 4.01× 降到 ~1.02× |
| ③ | [#18](https://hlgit.5518game.com/luohao/creator-core-kit/-/issues/18) | `EditorVM` 多段编辑、镜像、夹紧 | `check:vm-tests` 绿，上面那组用例全过 |
| ④ | [#19](https://hlgit.5518game.com/luohao/creator-core-kit/-/issues/19) | 九宫格图 + 五张 prefab + 两页 + 控件 + 平移缩放 | **逐条对照原型** |
| ⑤ | [#20](https://hlgit.5518game.com/luohao/creator-core-kit/-/issues/20) | 八道门 + e2e + 文档收尾 | 抵达终点 |

**先写测试**（仓规 TDD）。②③ 的逻辑都零 `cc`、node 直跑，测试写起来没有借口。

⚠️ 造 prefab 的两个已知坑（都在 `docs/progress.md`）：`create_prefab_from_node` 产出的 prefab
**缺 `PrefabInfo`**，运行时能 `instantiate` 但编辑器一打开就崩 `reading 'instance'`；
`node.destroy()` **延迟到帧末**，重跑生成脚本时同名新旧节点并存会抓错源，要用临时名 + `rootName`。

---

## 不做什么

| | 为什么 |
|---|---|
| **撤销 / 重做** | 原型定稿里没有它，而**验收单即范围**。误操作靠「拖回去」和 `MIN_HANDLE` 兜底 |
| **触屏 / 移动端** | 内部工具，只管桌面 web（沿用上一张图） |
| **鱼种数值编辑**（`FISH_KINDS`） | 那是表格，业界也是 Excel 配的（沿用上一张图） |
| **重编现有 8 条路径** | 有了多段能力它们可能有更好的画法，但那是**内容工作**，拿着新编辑器编过才估得出，在终点之后 |
| **改 `content.ts` 的数据 / 跳 `rev`** | 零迁移是数据形状选出来的结果，不是要额外做的事 |
| **下发协议 / 服务端编排** | 别的仓（`kit-proto` / `server-core-kit`），本仓会话不许动 |

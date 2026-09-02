---
状态: 已实现（2026-09-02 · 搬去 apps/fish-editor，纯 web）
日期: 2026-08-31
依赖: docs/design/2026-08-28-mini-fish-design.md, docs/design/testing-strategy-overview.md, docs/adr/0020-internal-tools-in-html.md
---

# mini-fish 内容编辑器：路径 + 鱼阵

> 摘要：一个「**路径 + 鱼阵**」的可视编辑器 —— 拖分段贝塞尔控制点、在路径上摆一队鱼、
> 当场按**游戏本体的规则**预览，编完把 `content.ts` 全文复制回仓库。它同时把捕鱼从
> 「一个随机投喂器」推进到「**有编排的内容**」：`waveFeeder` 播人编的阵，`randomFeeder` 压低密度当背景。
> **数据格式是照着「将来整份由服务端下发」设计的**，客户端这套是离线默认内容。
> 何时读：要动这个编辑器、要给别的子游戏做同类内容工具、或要接服务端下发鱼群时。

> 决策沿革不在本文，在 [wayfinder map #1](https://hlgit.5518game.com/luohao/creator-core-kit/-/issues/1)
> 与 [#11](https://hlgit.5518game.com/luohao/creator-core-kit/-/issues/11) 的 ticket 里。本文只描述**现状**。

## TL;DR

| | 现状 |
|---|---|
| **编辑什么** | 路径（分段三次贝塞尔）+ 鱼阵（一条路径上一队同种鱼的组合）。**鱼种数值表不进编辑器** —— 那是 Excel 的活 |
| **产物形态** | **源码往返**：导出 `content.ts` 全文 → 人 `Ctrl+V` 贴回仓库 → `git diff` 看得见改了什么。不做运行时配置覆盖 |
| **宿主** | **纯 web 内部工具**（`apps/fish-editor/`，vite），**不进任何游戏包**。为什么不在 Cocos 里见 [`ADR-0020`](../adr/0020-internal-tools-in-html.md) |
| **预览** | 直接跑 `FishVM`（`aiAgents: []` ⇒ 无炮、无子弹、无结算，只有鱼在游），**不自己写一份插值** |
| **一致性** | 帧号 / 朝向 / 场地裁剪收在 `mini-fish/render-map.ts`（零 `cc`），游戏 View 和编辑器读**同一份** |
| **入口** | 仓库根 `pnpm editor` |
| **闸** | 八道门一道都不用改；`check:vm-tests` 认第二种源码根（`src/`）后照旧覆盖 `EditorVM` |

---

## 1. 范围

**编**：路径几何、鱼阵编排。

**不编**：`FISH_KINDS`（倍率 / 半径 / 图集帧前缀）—— 业界也是 Excel 配的表格，做成可视化编辑器只是把表格画成表格。

**不编**：出鱼权重、控分参数、库存 —— 那是**策略**不是**内容**，将来住服务端自己的配置。策略混进内容表，编辑器就得开始显示它编不了的字段。

## 2. 数据格式（[#3](https://hlgit.5518game.com/luohao/creator-core-kit/-/issues/3)、[#12](https://hlgit.5518game.com/luohao/creator-core-kit/-/issues/12)）

```ts
// assets/modules/mini-fish/content/content.ts —— 编辑器导出的就是这个文件的全文
export const CONTENT = {
  rev: 1,
  paths: [
    { id: 'cross-lr', p: [-1160, 0, -400, 0, 400, 0, 1160, 0] },
  ],
  waves: [
    { id: 'yellow-cross', groups: [
      { at: 0,   path: 'cross-lr', kind: 'fish_yellow', count: 8, gap: 0.3, speed: 120 },
      { at: 1.2, path: 'arc-up',   kind: 'fish_hetun',  count: 1,           speed: 80  },
    ] },
  ],
} as const;
```

| 字段 | 含义 |
|---|---|
| `rev` | 整份内容的版本，**一个 `rev` 盖住两张表**。只在导出时 +1（§6） |
| `paths[].id` | **稳定字符串 id**，鱼阵靠它引用 |
| `paths[].p` | **分段**三次贝塞尔的控制点，`6n+2` 个数（n 段）。相邻段**共享接点坐标** ⇒ C0 连续是结构保证的，不是靠人对齐 |
| `groups[].at` | 相对本阵开始的秒数 |
| `groups[].count` / `gap` | 一队几条、每条隔几秒进场（`gap` 可省，默认 0） |
| `groups[].speed` | 整队同速（像素/秒）。同速才保得住队形 |

**不在数据里**：`length`（弧长，载入时按每段 128 采样算）· 时间线 · 调度元数据（`weight` / `cooldown`）· 阵型几何偏移 · 服务端策略字段。

四条为什么：

- **用 id 不用下标**：错位是**静默**的，越界是**响**的。删掉第 3 条路径，后面全部前移，引用它们的鱼阵会指向**另一条完全合法的路径** —— 不抛异常，只是这队鱼走错了路。id 把防线放在数据结构上，而不是「编辑器会记得同步改引用」这个承诺上。
  **分工：id 给人和编辑器，下标给机器和线上。** 载入时建一次 `Map<id, index>`，`PathFollow.pathId` 仍存下标（bitECS 的 SoA 只装数字，没得选）。
- **一个文件、一个 `rev`**：鱼阵引用路径 id，两张表必须一致；拆开就有两个版本号，而「wave 表新、path 表旧」这个组合一定会在某次热更或下发里出现。
- **仓库只放 TS，不放 JSON**：`as const` 之后 `pnpm typecheck` 就是内容的一道闸；JSON 什么都不检。要给服务端时**编辑器另导一份**（同一份内存数据的第二种投影），仓库不存第二份。
- **`6n+2` 的扁平数组，不是嵌套的段对象**：接点只存一次 ⇒ 两段之间**不可能**对不齐；老的四点单段路径天然是 `n=1`，**零迁移**。代价是「第 k 段吃 `6k..6k+7`」这条索引规则要记住，它写在 `paths.ts` 的注释里。

## 3. 宿主：纯 web，不进游戏包（[`ADR-0020`](../adr/0020-internal-tools-in-html.md)）

编辑器**不在 Cocos 工程里**，在 `apps/fish-editor/`（vite，`pnpm editor` 跑）。

判据一句话：**只在浏览器跑的工具用 HTML；会进客户端的界面才用 prefab**（native 与小游戏没有 DOM）。
理由与代价见 ADR，这里只记边界：

```
apps/fish-editor/          纯 web 工具，不进任何游戏包
  ├─ src/EditorVM.ts       逻辑层，零 cc
  ├─ src/main.ts           View：DOM + canvas
  ├─ src/atlas.ts          plist 解析（DOM 侧唯一要补的东西，约 40 行）
  └─ test/                 镜像测试，跟仓库根 `pnpm test` 一起跑
        ↓ 只 import 这些（别名 @game）
apps/demo/assets/modules/mini-fish/
  content/{content,content-types,paths,fish-kinds}.ts   零 cc
  render-map.ts   帧号 / 朝向 / 场地裁剪                零 cc
  FishVM.ts + ecs/* + seams/*                           零 cc
  FishGame.ts     ← 唯一 import 'cc' 的，编辑器不碰
```

**能这么直接吃，是因为要复用的那部分本来就零 `cc`** —— 复用逻辑从来不需要 Cocos。

### 一致性靠「一处实现」，不靠宿主

| | 谁给的 |
|---|---|
| 出场时机 / 轨迹 / 恒速 / 离场 | `FishVM` + `pathSystem` + `waveFeeder` |
| 帧号（12fps，按鱼种回绕） | `render-map.fishFrame` |
| 朝向（切线 + 过 90° 上下翻） | `render-map.fishFacing` |
| 场地缩放（cover）与可见区 | `render-map.fieldScale` / `visibleField` |
| 鱼画多大 | 图集里那一帧自己的尺寸（**两边都不许自己发明**） |

`render-map.ts` 是搬家时抽出来的：在那之前后三行**游戏和编辑器各写一份**，且实测已经漂了
（编辑器永远停在 `_run_0`、按判定半径 `r` 算框、场地用 contain 还留白）。**不一致的来源是
「两个 View 各写一份映射」，跟宿主无关。**

进不了 DOM 的只有渲染管线本身：水面后处理、海底、命中闪白 —— 这三样编辑器本来就不显示
（它们妨碍看控制点）。

## 4. 分层

```
EditorVM.ts（零 cc，node 直跑，32 条镜像测试）
  当前 content（草稿态）· 选中的路径/段/group · 增删改复制
  控制点命中判定与拖拽落点（世界坐标的纯数学）· 分段接续与折角检测
  rev · 草稿序列化与基线比对 · 导出文本拼装

main.ts（View）
  DOM 结构与事件 · canvas 画曲线与控制点 · 屏幕坐标→世界坐标后转发
```

**收成一个 VM 而不是三个**，因为编辑器的状态互相牵连：**删一条路径要让引用它的 group 标红**
（稳定 id 换来的东西），拆开就得在 VM 之间再造一套同步。

⚠️ **预览不进 `EditorVM`**：「编的是什么」归 `EditorVM`，「它长什么样」归 `FishVM`，两者只在一处
接缝 —— 编辑器改动后重建 feeder。混进去 `EditorVM` 就得认识 ECS 世界。

⚠️ **命中判定和拖拽落点算逻辑不算 View**：它们是世界坐标上的纯数学，放 View 里就没法在 node 里
问「点这儿抓不抓得到把手」。

**手柄不许贴到锚点上**（`MIN_HANDLE = 60`）：P1 压在 P0 上时贝塞尔导数 `3(P1−P0)` 退化成 0，
`angleAt` 的守卫返回 0 ⇒ 鱼游到那儿**突然朝右**，不崩不报错。镜像时对面那根同样有下限 ——
少了它一旦塌到零就再也回不来（长度恒为 0，镜像永远把它算回锚点）。

## 5. 预览与交互形态（[#4](https://hlgit.5518game.com/luohao/creator-core-kit/-/issues/4)、[#13](https://hlgit.5518game.com/luohao/creator-core-kit/-/issues/13)）

**预览直接跑 `FishVM`，且这么做成本是零**：

```ts
new FishVM({ feeder: waveFeeder(content, { order: [编辑中那条], loop: false }), aiAgents: [] })
```

`aiAgents: []` ⇒ 只剩玩家那门炮，而它**不 `aim()` 就永远不开火**（`manualAgent` 没被瞄过返回 `null`）
⇒ `fireFrom` / `spawnBullet` / `arbiter.fire` 全程不跑。也就是说这已经是一个「无 AI、无子弹、
无结算、只有鱼在游」的世界，**不需要抽最小世界，不需要改一行装配**。

**不自己写插值**：编辑器存在的理由就是「编完知道游戏里长什么样」，自己写一份恒速 / 朝向 / 离场
的实现正好把这个理由抵消 —— 三处行为各有两份实现迟早漂，而漂的那天你信的是编辑器、错的是游戏。

**形态**：

- **只管桌面 web，不管触屏** —— 内部工具、用的人有鼠标。悬停 / 右键 / 拖拽 / 剪贴板都能放心用。
- **两个页签共用一张画布**：路径页编几何，鱼阵页编编排。**走带只在鱼阵页** —— 路径页不跑运行时。
  选中态跨页签保留；鱼阵页每队上的 `↗` 是「去改这条路」，切到路径页并选中它，反向不做。
- 三栏：列表 · 画布 · 属性面板。列表与属性栏各自竖向滚动。
- 控制点直接拖：拖锚点两侧手柄刚性跟随；拖手柄**默认镜像对面**（拉出平滑），按住 `Alt` 打断、故意折。
  折角接点画成**红方块**并在右栏点名度数 —— 允许折，但别让人折了自己不知道。
- **平移缩放**：空格 / 中键拖 = 平移，滚轮 = 缩放，且**光标底下那个世界点保持不动**（否则想看的
  东西会自己跑出屏幕）。命中半径按屏幕像素恒定，放大之后不该更难点中。
- 每条路径一个**显影眼睛**（按 id 记不按下标）；鱼阵页只画这一阵用到的路线，别的全是干扰。
- **弧长刻点**：画布上等距的青色小点就是恒速的可视证据。段长再不均、曲线再弯，鱼也不忽快忽慢。
- **走带是手动的**：播放 / 暂停 · ⏮ 回开头 · ±0.1s 步进 · 可拖进度条 · `场上 N 条` 读数。
  **不自动播、不循环、放到头停在头** —— 编内容要问的是「这两条鱼的间距对不对」，那得**停在某一帧**上看。
  ⚠️ 拖进度条是**从头重跑到那儿**（ECS 世界没有倒带）。
- **预览时长 = 最后一条「跑完」的鱼**：逐条取 `max(at + i×gap + 弧长/speed)`，**不是最后出生那条**。
  各 group 路径长短与速度不同，后生的短路径可能先跑完；按最后出生算会把主队伍的后半程砍掉。
  弧长取**草稿**的几何（`makeFishPath(draft.p).length`），不是 `content.ts` 里烘好的那份 ——
  否则刚把路径拖长，走带还按旧长度收尾。
- **可见区叠加**：游戏的场地缩放是 cover（`Math.max`），**窄屏会把 `FIELD` 上下裁掉**。点「▣ 可见区」
  叠一圈虚线（1440 × 864，4:3 ~ 20:9 都看得见），摆在它外面的鱼在某些手机上进不了画面。
  旧版画的是完整场地框，等于在骗人。
- 删掉被引用的路径 ⇒ 那个 group 的 `path` **标红**，不静默改指别处。

## 6. 内容怎么落回仓库（[#8](https://hlgit.5518game.com/luohao/creator-core-kit/-/issues/8)）

```
编辑器里改  →  debounce 写一份草稿进 localStorage（防崩，不参与发布）
点「复制」  →  rev = 源码rev + 1，content.ts 全文进剪贴板
Ctrl+V      →  覆盖 assets/modules/mini-fish/content/content.ts
git diff    →  改了哪几条路径、哪几个 group，逐行看得见
```

**关掉页面只丢最后一次 debounce 内的几秒**；没点过「复制」也不会丢，下次打开有横幅问要不要恢复。

- ⚠️ **`navigator.clipboard` 只在 secure context 可用**：`localhost:5174` ✅，换成局域网 IP 打开 ❌。
  所以**复制失败必须明确提示**（按钮文字改成「⚠ 复制不了 → 看下面」），静默失败的话人会粘出
  上一次剪贴板里的东西。兜底是页面底部那个**常驻只读文本框**，里面永远是同一份全文，全选手动复制。
- **不做 `<a download>`**（多一步搬运，还多一份忘在下载目录里的旧版本）；**不做 POST 写回本机服务**
  （要 token、要一条只在 dev 跑的后端命，且把「源码往返」偷偷变成运行时覆盖）。
- **草稿默认永不自动恢复**：顶部横幅「有一份未导出的草稿（基于 `rev 7`，12 分钟前）· 恢复 / 丢弃」。
  自动恢复最坏的失败不是丢数据，是**拿三天前的草稿盖掉别人贴回的内容**。草稿记基线 `rev`。
- **`rev` 只在导出时 +1** —— 它是「这份内容被**发布**过一次」的编号，不是操作计数。于是两个人同时编，
  两份都是 `rev 8`，**贴回时 git 直接冲突而不是静默覆盖**：并发交给 git，编辑器不长合并逻辑。

## 7. 鱼阵接进游戏本体（[#6](https://hlgit.5518game.com/luohao/creator-core-kit/-/issues/6)）

```ts
combineFeeders(
  waveFeeder(CONTENT, { order: 全部阵, loop: true }),
  randomFeeder({ interval: 1.0, batch: 1 }),
)
```

**合流在装配点**（落地在 `FishVM` 的默认投喂 `defaultFeeder(rand)` —— 底噪要的 `rand` 在那儿，
放到 `FishGame` 就得让 View 层自己持有一个随机源），`waveFeeder` 保持成纯粹的表播放器。决定性理由
是编辑器要的正是「只放鱼阵、不要底噪」—— 不合流就完事；反过来把 `randomFeeder` 塞进 `waveFeeder`
内部，编辑器就得多一个 `noise:false` 开关，而一旦漏关，编的人会以为那些随机鱼是自己摆的。

**底噪密度是算出来的，不是拍的**。鱼是流，稳态同屏数 = 投喂率 × 平均寿命：

```
8 条路径平均弧长 2387，速度 90~190 ⇒ 平均寿命 17.0 s
旧 interval 0.6 / batch 2 = 3.33 条/秒 → 稳态 57 条
新 interval 1.0 / batch 1 = 1.00 条/秒 → 稳态 17 条
```

判据是**总量守恒**：玩家已经认过 57 条这个密度，鱼阵进来后把其中三分之二让给阵。底噪一旦超过
总量的三分之一，眼睛就分不出「这是一队」还是「碰巧游到一起」，鱼阵的钱就白花了。

**调度取最笨的一种**：`waveFeeder(content, { order, loop })`，游戏按表序循环、**不注入 `rand`**；
编辑器单阵不循环。不做可换的 picker、权重、冷却 —— `FishFeeder` 本身就是联网时要换掉的那道缝，
这套调度是纯离线兜底代码，**不在要扔的东西里再开第二道缝**。

**接续判据是「上一阵投喂完毕 + 间隔」，不是等清场**：投喂器不动已在场的鱼，下一阵开始不截断任何
东西；等清场则每阵之间空出十几秒（一队 8 条 `gap 0.3` 的阵 2.1 秒投完、19 秒才游干净）。

> ⚠️ 「清场」判据只属**编辑器预览窗口**（§5），别把它搬进投喂器。

**id → 下标的转换点就在 `waveFeeder` 载入 `content` 那一刻**：建 `paths[].id → index` 与
`FISH_KINDS[].id → index` 两张 Map。**引用不到的 id 当场抛**，不许静默跳过 —— 静默跳过就是
「这一阵少了两条鱼」，找起来极贵。

## 8. 测试

| 文件 | 测什么 | 谁保证它存在 |
|---|---|---|
| `apps/fish-editor/test/EditorVM.test.ts` | 增删改复制 · 命中判定与拖拽落点 · 多段接续与折角 · **删路径后引用它的 group 进未解析态** · `rev` 只在导出时 +1 · 草稿基线比对 | `check:vm-tests`（认 `src/` 源码根） |
| `apps/fish-editor/test/atlas.test.ts` | plist 解析（含**旋转帧**）· **`fishFrame` 吐的每个名字图集里都真有** | 人 |
| `apps/demo/test/modules/mini-fish/render-map.test.ts` | 帧号回绕 · 12fps 是钉死的数 · 过 90° 上下翻 · **cover 不是 contain** · 可见区裁多少 | 人 |
| `apps/demo/test/modules/mini-fish/content/content.test.ts` | 内容自检：`path`/`kind` 解析得到 · id 唯一 · `p` 长度合法 · `count >= 1` / `gap >= 0` / `speed > 0` | 人 |
| `apps/demo/test/modules/mini-fish/seams/feeder.test.ts` | **时刻表**（`{at:0,count:3,gap:0.5}` 在 0 / 0.5 / 1.0 秒各吐一条）· **大 dt 等价** | 人 |

- `content.ts` **不配 `--check` 生成物闸**：判据是「源在不在仓里」，而这里源和产物是**同一个文件**，
  闸挡的是不会发生的事（同 `mini-hop` 的 `level.ts`）。挡不住的是**跨表引用**和**数值范围** ——
  那正是 `as const` + `typecheck` 覆盖不到、而人手贴回最容易坏的两样，所以用一条断言而不是一道闸。
- 阵与阵接续的**间隔**不单测 —— 那是数值手感，改一次动一次测试。
- 编辑器的 DOM 层不单测（同仓规对 View 的处理），靠 `pnpm editor` 打开看。

## 9. 联网之后

D2 定的外挂防线：**客户端自己随机 = 外挂能预知下一波、能自瞄大鱼**。所以联网后投喂（鱼阵 + 底噪）
**和路径表**都由服务端下发。本仓能担保的只有两条（**下发协议与服务端编排在 `kit-proto` /
`server-core-kit`，不在本仓**）：

1. **缝就是 `FishFeeder`**，一行不用改：联网时整块换 `serverFeeder`，`waveFeeder` / `randomFeeder`
   双双下线。两者的注释里把身份写死成**离线默认内容**，免得有人往里加服务端字段。
2. **`waveFeeder` 是可搬走的纯函数**：零 `cc`、不碰 DI、不调 `Math.random`、时间**只从 `dt` 来**。
   将来这套逻辑要在服务端（Go）重写一遍，**确定性是能不能逐行对照的前提**。

由此三条硬约束（[#3](https://hlgit.5518game.com/luohao/creator-core-kit/-/issues/3) 决策 4）：

- **只发几何、不发派生量**：弧长 `length` 客户端收到控制点后自己算。两份采样实现的浮点一漂，
  同一条鱼在不同客户端就位置不同。
- **表要带版本，`pathId` 相对于版本解释**：换表瞬间在途的鱼会瞬移，除非 spawn 绑定表的 `rev`。
- **`content.ts` 是「离线默认内容」**，不能删（node 单测 / 单机 / 断线兜底要它），但不再是唯一真相源。

## 10. 已知边界与坑

- **`navigator.clipboard` 要 secure context**（§6）—— 换局域网 IP 打开时走文本框兜底。
- **图集里 167 帧有 65 帧是转着存的**（鱼占 39 帧，`fish_yellow_run_0` 就是）。DOM 侧自己解析 plist
  时不处理 `textureRotated` 会看到一堆侧躺的鱼。另外 **TRIMMED 尺寸是逐帧变的**（同一条黄鱼
  `_run_3` 52×31、`_run_0` 52×34），必须逐帧读矩形，不能取一个固定尺寸。
- **鱼画多大不许自己发明**：一律用图集里那帧自己的尺寸。旧版按判定半径 `r` 算框，于是编辑器里
  的鱼跟游戏里根本不是一个大小 —— 这类偏差不报错、只让人照着假画面摆鱼。
- **`[...set]` 会被 Cocos 构建降级成 `[].concat(set)`**（集合塞成单元素）：`combineFeeders` 用
  `flatMap`，别写数组字面量展开。**这条只约束 `apps/demo/assets`**，编辑器那边不过 Cocos 构建。
- **阵型几何偏移（圆环、心形）不做**：曲线路径上的一列鱼已经够用；将来加一个**可选** `offset`
  字段就能长出来，不破坏已有数据。
- **七个 `kind:'game'` 子游戏的界面目前全是代码建的**，补 prefab 是欠账，见
  [#10](https://hlgit.5518game.com/luohao/creator-core-kit/-/issues/10)。

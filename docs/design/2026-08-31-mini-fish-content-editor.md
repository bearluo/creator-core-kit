---
状态: 已实现（2026-09-01 · web 真产物 e2e 通过）
改造中: docs/design/2026-09-01-mini-fish-editor-v2-proposal.md（两个页签 + 多段路径 + 交互对齐）
日期: 2026-08-31
依赖: docs/design/2026-08-28-mini-fish-design.md, docs/design/testing-strategy-overview.md, docs/design/lobby-modular-framework-overview.md, docs/adr/0014-foundation-bundle-and-priority-sharing.md, docs/adr/0009-bundle-layering-criterion.md
---

> ⚠️ **正在改造**，本文描述的仍是**当前**现状（单段贝塞尔、一屏布局）。改造后的目标见上面那份提案；
> 提案实施完成后本文会整体重写为新现状。

# mini-fish 内容编辑器：路径 + 鱼阵

> 摘要：在 `mini-fish` 之上再开一个 bundle，做「**路径 + 鱼阵**」的运行时可视编辑器——拖贝塞尔控制点、
> 在路径上摆一队鱼、当场按游戏本体的规则预览，编完把 `content.ts` 全文复制回仓库。它同时把捕鱼从
> 「一个随机投喂器」推进到「**有编排的内容**」：`waveFeeder` 播人编的阵，`randomFeeder` 压低密度当背景。
> **数据格式是照着「将来整份由服务端下发」设计的**，客户端这套是离线默认内容。
> 何时读：要动这个编辑器、要给别的子游戏做同类内容工具、或要接服务端下发鱼群时。

> 决策沿革不在本文，在 [wayfinder map #1](https://hlgit.5518game.com/luohao/creator-core-kit/-/issues/1)
> 及其八张已关闭的 ticket 里（本文各节标注了出处）。本文只描述**现状定稿**。

## TL;DR

| | 定稿 |
|---|---|
| **编辑什么** | 路径（三次贝塞尔四控制点）+ 鱼阵（一条路径上一队同种鱼的组合）。**鱼种数值表不进编辑器**——那是 Excel 的活 |
| **产物形态** | **源码往返**：编辑器导出 `content.ts` 全文 → 人 `Ctrl+V` 贴回仓库 → `git diff` 看得见改了什么。不做运行时配置覆盖 |
| **分包** | `mini-fish` 优先级 `1 → 2`，编辑器包留 `1`；资源**动态**取，`deps` 保持为空 |
| **预览** | 直接跑 `FishVM`（`aiAgents: []` ⇒ 无炮、无子弹、无结算，只有鱼在游），**不自己写一份插值** |
| **界面** | `kind:'game'` + 自带 `Editor.scene`；界面走 prefab 三张；逻辑全在一个 `EditorVM` |
| **入口** | `MODULE_CATALOG` 加一行 + `env` / `VEST` 门控 ⇒ 正式马甲**看不见入口**。⚠️ 门控删的是入口不是产物：包照打（实测），native 要等「按包选是否随 APK」才不进产物 |
| **闸** | 八道门**一道都不用改**；新增一条内容自检单测 |

---

## 1. 范围

**编**：路径几何、鱼阵编排。

**不编**：`FISH_KINDS`（倍率 / 半径 / 图集帧前缀）——业界也是 Excel 配的表格，做成可视化编辑器只是把表格画成表格。

**不编**：出鱼权重、控分参数、库存——那是**策略**不是**内容**，将来住服务端自己的配置。策略混进内容表，编辑器就得开始显示它编不了的字段。

## 2. 数据格式（[#3](https://hlgit.5518game.com/luohao/creator-core-kit/-/issues/3)）

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
| `paths[].p` | 三次贝塞尔四控制点共 8 个数，屏心为原点的横屏设计像素 |
| `groups[].at` | 相对本阵开始的秒数 |
| `groups[].count` / `gap` | 一队几条、每条隔几秒进场（`gap` 可省，默认 0） |
| `groups[].speed` | 整队同速（像素/秒）。同速才保得住队形 |

**不在数据里**：`length`（弧长，载入时用 `arcLength` 采 32 段算）· 时间线 · 调度元数据（`weight` / `cooldown`）· 阵型几何偏移 · 服务端策略字段。

三条为什么：

- **用 id 不用下标**：错位是**静默**的，越界是**响**的。删掉第 3 条路径，后面全部前移，引用它们的鱼阵会指向**另一条完全合法的路径**——不抛异常，只是这队鱼走错了路。id 把防线放在数据结构上，而不是「编辑器会记得同步改引用」这个承诺上。
  **分工：id 给人和编辑器，下标给机器和线上。** 载入时建一次 `Map<id, index>`，`PathFollow.pathId` 仍存下标（bitECS 的 SoA 只装数字，没得选）。
- **一个文件、一个 `rev`**：鱼阵引用路径 id，两张表必须一致；拆开就有两个版本号，而「wave 表新、path 表旧」这个组合一定会在某次热更或下发里出现。
- **仓库只放 TS，不放 JSON**：`as const` 之后 `pnpm typecheck` 就是内容的一道闸；JSON 什么都不检。要给服务端时**编辑器另导一份**（同一份内存数据的第二种投影），仓库不存第二份。

## 3. 分包与优先级（[#2](https://hlgit.5518game.com/luohao/creator-core-kit/-/issues/2)）

跨包 `import` 的规则是 `priority(被依赖) > priority(依赖方)`，**严格大于**（`findEdgeViolations`）。编辑器要 import `mini-fish`，两个包同为 1 就直接违规，所以：

```
mini-fish          priority 1 → 2
mini-fish-editor   priority 1
```

**抬 `mini-fish` 零风险**：读过 web 真产物里 22 个包的 `config.*.json`，全工程只有 `resources`（priority 8）一个共享仓，`mini-fish` 整包自给自足（图集在自己目录下），**没有任何资源可被抢** ⇒ 归属仲裁根本不会发生。

**资源动态取，不写静态引用**：`--allow-deps` 是**全局白名单**（`findDepViolations` 的 `shared` 参数不分包对），开一次等于谁都能借 mini-fish 的图。编辑器用 `assets.load(path, { bundle: 'mini-fish' })` 拿图集，`deps` 保持为 `[]`，产物闸永远不响；边界改由 `foundation/bundles.ts` 的 `BUNDLE_GRAPH.needs` 声明（那张表**一表两用**：装它之前先装谁 + 它能碰谁的资源）。

**入口**：`MODULE_CATALOG` 加一行 + `env` / `VEST` 门控 ⇒ 正式马甲**看不见入口、进不去**。

⚠️ **门控删的是入口，不是产物。** 实测（2026-09-01，web 构建）：`build/web-mobile/assets/mini-fish-editor/`
照样在（`index.js` 17.8 KB + `config.json` 371 B），而那时它**连 `MODULE_CATALOG` 那行都还没写**。
Creator 是按**目录 meta 的 `isBundle`** 收 bundle 的，与「有没有人引用」无关。代价按平台分：

| 平台 | 代价 |
|---|---|
| web / 小游戏 | 产物目录里多一个文件。模块**按需下载**，玩家不开编辑器就不 fetch ⇒ **实际流量 0**，首包一个字节不多 |
| native | 目前 APK 的 `data/assets/` 里**每个 bundle 都在** ⇒ 占**安装包**几十 KB。等出包期「按包选择是否随 APK」（远程包）做了就不进 APK 产物 —— 那是分包层本来该有的能力，不是为编辑器开的特例 |

## 4. 装配（[#7](https://hlgit.5518game.com/luohao/creator-core-kit/-/issues/7)、[#9](https://hlgit.5518game.com/luohao/creator-core-kit/-/issues/9)）

**登记成 `kind:'game'`，自带 `Editor.scene`**：它要整屏、要自己那台相机、要跑 `FishVM`——这三件事是 game 的形状；panel 是叠在大厅上的一张脸，塞不下。白拿 `getGameHost().exit()` 当「返回大厅」，跟别的子游戏一条路。

**界面走 prefab 三张**（照仓规「UI 一律走 prefab」，**不开豁免口子**）：

| prefab | 装什么 | 为什么单独一张 |
|---|---|---|
| `EditorPanel` | 三栏外框 + 工具条 + 走带 | 界面骨架 |
| `PathItem` | 路径列表的一行 | **单独一张才 `instantiate` 得了** |
| `GroupItem` | 一个 group 的一块（五个旋钮 + 删除） | 同上，且是最常改的一块脸 |

首次创建**用脚本生成**（`apps/demo/scripts/prefab-gen/`：`.prefab.json` 描述 → `build-prefab.js` 经编辑器 `create-prefab` 消息产出；⚠️ **不裸序列化 `Node`**，缺 `PrefabInfo` 运行时能 instantiate 但编辑器一打开就崩），**改已有走 MCP**。prefab 放编辑器包自己，不进 `skins/`——编辑器没有马甲。

**逻辑分层**：

```
EditorVM.ts（零 cc，node 直跑）
  当前 content（草稿态）· 选中的路径/group · 增删改复制
  控制点命中判定与拖拽落点（世界坐标的纯数学）
  rev · 草稿序列化与基线比对 · 导出文本拼装

FishEditor.ts（cc.Component，只做仓规允许的四件事）
  instantiate 三张 prefab · 建绑定 · 屏幕坐标→世界坐标后转发 · 转发生命周期
  曲线与控制点用 Graphics 画（绘制不是逻辑）
```

**收成一个 VM 而不是三个**，因为编辑器的状态互相牵连：**删一条路径要让引用它的 group 标红**（稳定 id 换来的东西），拆开就得在 VM 之间再造一套同步。

⚠️ **预览不进 `EditorVM`**：「编的是什么」归 `EditorVM`，「它长什么样」归 `FishVM`，两者只在一处接缝——编辑器改动后重建 feeder。混进去 `EditorVM` 就得认识 ECS 世界。

## 5. 预览与交互形态（[#4](https://hlgit.5518game.com/luohao/creator-core-kit/-/issues/4)、[#5](https://hlgit.5518game.com/luohao/creator-core-kit/-/issues/5)）

**预览直接跑 `FishVM`，且这么做成本是零**：

```ts
new FishVM({ feeder: waveFeeder(content, { order: [编辑中那条], loop: false }), aiAgents: [] })
```

`aiAgents: []` ⇒ 只剩玩家那门炮，而它**不 `aim()` 就永远不开火**（`manualAgent` 没被瞄过返回 `null`）⇒ `fireFrom` / `spawnBullet` / `arbiter.fire` 全程不跑。也就是说这已经是一个「无 AI、无子弹、无结算、只有鱼在游」的世界，**不需要抽最小世界，不需要改一行装配**。

**不自己写插值**：编辑器存在的理由就是「编完知道游戏里长什么样」，自己写一份恒速 / 朝向 / 离场的实现正好把这个理由抵消——三处行为各有两份实现迟早漂，而漂的那天你信的是编辑器、错的是游戏。

**View 自己写，不复用 `FishGame`**：那是 585 行绑死在 HUD / 炮台 / 水面上的 `cc.Component`；编辑器只要 `syncFish` 那三十行，外加游戏里一个都不要的控制点手柄 / 切线 / `t` 刻度。纯逻辑 `ecs/reconcile.ts` 照常复用。

**形态**（原型定稿，[原型链接](https://claude.ai/code/artifact/106f1950-a44c-4fb7-87ab-d1a1eec68683)）：

- **只管桌面 web，不管触屏**——内部工具、用的人有鼠标、门控后不进正式包。悬停 / 右键 / 拖拽 / 剪贴板都能放心用。
- 三栏：路径 & 鱼阵列表 · 画布 · 属性面板。1920×1080 横屏下画布仍占约 3/4 宽。
- 控制点直接拖（p0/p3 端点、p1/p2 把手，虚线连着），**不做对称把手**——鱼路要的是不对称的甩尾。
- 新路径**从选中那条复制**起手：空白起手要先猜一条曲线，复制永远给一个能看的初值。
- **走带是手动的**：播放 / 暂停 · ⏮ 回开头 · ±0.1s 步进 · 可拖进度条 · `场上 N 条` 读数。**不自动播、不循环、放到头停在头**——编内容要问的是「这两条鱼的间距对不对」，那得**停在某一帧**上看。
- **预览时长 = 最后一条「跑完」的鱼**：逐条取 `max(at + i×gap + 弧长/speed)`，**不是最后出生那条**。各 group 路径长短与速度不同，后生的短路径可能先跑完；按最后出生算会把主队伍的后半程砍掉（`cross-lr` 弧长 2320px、120px/s 要 19.3 秒）。
- 删掉被引用的路径 ⇒ 那个 group 的 `path` **标红**，不静默改指别处。

## 6. 内容怎么落回仓库（[#8](https://hlgit.5518game.com/luohao/creator-core-kit/-/issues/8)）

```
编辑器里改  →  debounce 写一份草稿进 localStorage（防崩，不参与发布）
点「复制」  →  rev = 源码rev + 1，content.ts 全文进剪贴板
Ctrl+V      →  覆盖 assets/modules/mini-fish/content/content.ts
git diff    →  改了哪几条路径、哪几个 group，逐行看得见
```

**关掉页面只丢最后一次 debounce 内的几秒**；没点过「复制」也不会丢，下次打开有横幅问要不要恢复。

- ⚠️ **`navigator.clipboard` 只在 secure context 可用**：Creator 预览的 `localhost:7456` ✅，web 产物挂在 `172.25.50.135:8082` 上 ❌。所以**复制失败必须明确提示**（按钮文字改成「⚠ 复制不了 → 看控制台」），静默失败的话人会粘出上一次剪贴板里的东西。
  兜底不是「页面底部常驻只读文本框」而是**控制台**：导出时无论成败都 `console.log` 全文。Cocos 场景里没有可选中的文本框，硬做一个要么自绘选区、要么叠一层 DOM —— 而编辑器只在桌面 web 上用，浏览器控制台本来就在手边，那才是这个宿主里等价的东西。
- **不做 `<a download>`**（多一步搬运，还多一份忘在下载目录里的旧版本）；**不做 POST 写回本机服务**（要 token、要一条只在 dev 跑的后端命，且把「源码往返」偷偷变成运行时覆盖）。
- 读用静态 `import`（优先级 2 > 1，合法；`as const` 顺带把类型对上）。
- **草稿默认永不自动恢复**：顶部横幅「有一份未导出的草稿（基于 `rev 7`，12 分钟前）· 恢复 / 丢弃」。自动恢复最坏的失败不是丢数据，是**拿三天前的草稿盖掉别人贴回的内容**。草稿记基线 `rev`，key 带 `appId` 前缀（Web / 小游戏同域名共用 `localStorage`）。
- **`rev` 只在导出时 +1**——它是「这份内容被**发布**过一次」的编号，不是操作计数。于是两个人同时编，两份都是 `rev 8`，**贴回时 git 直接冲突而不是静默覆盖**：并发交给 git，编辑器不长合并逻辑。

## 7. 鱼阵接进游戏本体（[#6](https://hlgit.5518game.com/luohao/creator-core-kit/-/issues/6)）

```ts
combineFeeders(
  waveFeeder(CONTENT, { order: 全部阵, loop: true }),
  randomFeeder({ interval: 1.0, batch: 1 }),
)
```

**合流在装配点**（落地在 `FishVM` 的默认投喂 `defaultFeeder(rand)` —— 底噪要的 `rand` 在那儿，
放到 `FishGame` 就得让 View 层自己持有一个随机源），`waveFeeder` 保持成纯粹的表播放器。决定性理由是编辑器要的正是「只放鱼阵、不要底噪」——不合流就完事；反过来把 `randomFeeder` 塞进 `waveFeeder` 内部，编辑器就得多一个 `noise:false` 开关，而一旦漏关，编的人会以为那些随机鱼是自己摆的。

**底噪密度是算出来的，不是拍的**。鱼是流，稳态同屏数 = 投喂率 × 平均寿命：

```
8 条路径平均弧长 2387，速度 90~190 ⇒ 平均寿命 17.0 s
旧 interval 0.6 / batch 2 = 3.33 条/秒 → 稳态 57 条
新 interval 1.0 / batch 1 = 1.00 条/秒 → 稳态 17 条
```

判据是**总量守恒**：玩家已经认过 57 条这个密度，鱼阵进来后把其中三分之二让给阵。底噪一旦超过总量的三分之一，眼睛就分不出「这是一队」还是「碰巧游到一起」，鱼阵的钱就白花了。

**调度取最笨的一种**：`waveFeeder(content, { order, loop })`，游戏按表序循环、**不注入 `rand`**；编辑器单阵不循环。不做可换的 picker、权重、冷却——`FishFeeder` 本身就是联网时要换掉的那道缝，这套调度是纯离线兜底代码，**不在要扔的东西里再开第二道缝**。

**接续判据是「上一阵投喂完毕 + 间隔」，不是等清场**：投喂器不动已在场的鱼，下一阵开始不截断任何东西；等清场则每阵之间空出十几秒（一队 8 条 `gap 0.3` 的阵 2.1 秒投完、19 秒才游干净）。

> ⚠️ 「清场」判据只属**编辑器预览窗口**（§5），别把它搬进投喂器。

**id → 下标的转换点就在 `waveFeeder` 载入 `content` 那一刻**：建 `paths[].id → index` 与 `FISH_KINDS[].id → index` 两张 Map。**引用不到的 id 当场抛**，不许静默跳过——静默跳过就是「这一阵少了两条鱼」，找起来极贵。

## 8. 测试计划（[#9](https://hlgit.5518game.com/luohao/creator-core-kit/-/issues/9)）

| 文件 | 测什么 | 谁保证它存在 |
|---|---|---|
| `test/modules/mini-fish-editor/EditorVM.test.ts` | 增删改复制 · 命中判定与拖拽落点 · **删路径后引用它的 group 进未解析态** · `rev` 只在导出时 +1 · 草稿基线比对 | `check:vm-tests`（自动，脚本不用改） |
| `test/modules/mini-fish/content/content.test.ts` | 内容自检：`path`/`kind` 解析得到 · id 唯一 · `p` 长度为 8 · `count >= 1` / `gap >= 0` / `speed > 0` | 人（新增） |
| `test/modules/mini-fish/seams/feeder.test.ts` | **时刻表**（`{at:0,count:3,gap:0.5}` 在 0 / 0.5 / 1.0 秒各吐一条，逐字段对）· **大 dt 等价**（`tick(5)` 一步 == 300 步 `1/60`） | 已存在 |
| `test/modules/mini-fish/FishVM.test.ts` | **稳态带**：底噪跑 60 秒，同屏鱼数落在 12~24 | 已存在 |

- `check:vm-tests` 扫 `apps/*/assets` **全树**，编辑器包按命名走就自动生效。
- `content.ts` **不配 `--check` 生成物闸**：判据是「源在不在仓里」，而这里源和产物是**同一个文件**，闸挡的是不会发生的事（同 `mini-hop` 的 `level.ts`）。挡不住的是**跨表引用**和**数值范围**——那正是 `as const` + `typecheck` 覆盖不到、而人手贴回最容易坏的两样，所以用一条断言而不是一道闸。
- **八道门一道都不用改**：`check:pins` / `check:graph` 因为编辑器包动态取资源、且代码边指向更高优先级（2 > 1）而天然合法；`check:masks` 与本包无关。
- 阵与阵接续的**间隔**不单测——那是数值手感，改一次动一次测试。
- View + prefab + 装配照仓规由**启动 smoke** 兜底。

## 9. 联网之后

D2 定的外挂防线：**客户端自己随机 = 外挂能预知下一波、能自瞄大鱼**。所以联网后投喂（鱼阵 + 底噪）**和路径表**都由服务端下发。本仓能担保的只有两条（**下发协议与服务端编排在 `kit-proto` / `server-core-kit`，不在本仓**）：

1. **缝就是 `FishFeeder`**，一行不用改：联网时整块换 `serverFeeder`，`waveFeeder` / `randomFeeder` 双双下线。两者的注释里把身份写死成**离线默认内容**，免得有人往里加服务端字段。
2. **`waveFeeder` 是可搬走的纯函数**：零 `cc`、不碰 DI、不调 `Math.random`、时间**只从 `dt` 来**。将来这套逻辑要在服务端（Go）重写一遍，**确定性是能不能逐行对照的前提**——同一份 `content` + 同一串 `dt` 必须吐出同一串 spawn，否则「服务端跟客户端表现不一致」这类 bug 没有对照物可查。

由此三条硬约束（[#3](https://hlgit.5518game.com/luohao/creator-core-kit/-/issues/3) 决策 4）：

- **只发几何、不发派生量**：弧长 `length` 客户端收到控制点后自己算。两份采样实现的浮点一漂，同一条鱼在不同客户端就位置不同。
- **表要带版本，`pathId` 相对于版本解释**：换表瞬间在途的鱼会瞬移，除非 spawn 绑定表的 `rev`。
- **`content.ts` 是「离线默认内容」**，不能删（node 单测 / 单机 / 断线兜底要它），但不再是唯一真相源。

## 10. 已知边界与坑

- **`navigator.clipboard` 要 secure context**（§6）——8082 上跑要走文本框兜底。
- **代码建的 UI 节点必须显式置 `UI_2D` 层，否则黑屏**（本仓踩过）。画布上的 `Graphics` 与控制点是代码建的，逃不掉这一条。
- **`--allow-deps` 是全局白名单**：为编辑器开一次，等于全工程任何包都能借 mini-fish 的资源。所以编辑器只动态取。
- **`[...set]` 会被 Cocos 构建降级成 `[].concat(set)`**（集合塞成单元素）：`combineFeeders` 用 `flatMap`，别写数组字面量展开。
- **阵型几何偏移（圆环、心形）不做**：曲线路径上的一列鱼已经够用；将来加一个**可选** `offset` 字段就能长出来，不破坏已有数据。
- **七个 `kind:'game'` 子游戏的界面目前全是代码建的**，补 prefab 是欠账不是先例，另见 [#10](https://hlgit.5518game.com/luohao/creator-core-kit/-/issues/10)。

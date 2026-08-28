---
状态: 已定稿
日期: 2026-08-28
依赖: docs/design/lobby-modular-framework-overview.md, docs/design/testing-strategy-overview.md, packages/ecs-bitecs/docs/modules/ecs.md, packages/ecs-bitecs/docs/modules/spatial.md, docs/adr/0019-npm-package-aot-vs-assets-boundary.md, docs/adr/0014-foundation-bundle-and-priority-sharing.md
---

# mini-fish：捕鱼，也是 ECS 进 demo 的第一个消费者

> 摘要：demo 的第七款子游戏。它跟前六款有三处**质变**——① 是**经济型**游戏（子弹花钱、打鱼赚钱，
> 「成绩」是持久余额而不是最高分，`GameHost.submit(score)` 装不下）；② 是 `@cck/ecs-bitecs` 的
> **第一个真消费者**（那个包 node 全测已久，`apps/demo` 一行没用过，`progress.md` 两处挂着
> 「demo 的 cc 渲染场景留后续」）；③ 是第一款**横屏**、第一款**上量**（100~200 实体）、第一款
> **带图集**的模块。玩法单机，但**四道接缝一开始就留**，将来换服务端时 system 与单测一行不改。
> 何时读：动 mini-fish、给 kit 接 ECS、要在这个仓里做经济型玩法、或想知道「哪些代码该住 npm 包
> 哪些该住 assets」时。

## TL;DR

- **玩什么**：横屏捕鱼。屏幕下方四门炮（1 个玩家 + 3 个 AI 陪打），点屏幕开炮，子弹飞到命中点
  张开一张网，**网内每条鱼各判一次生死**，死了按倍率赔金币。
- **怎么分层**：鱼 / 子弹 / 网走 **ECS**（bitECS SoA，复用 `@cck/ecs-bitecs` 的 `Position` /
  `Velocity` / `Circle` / `SpatialHash`）；炮台（4 个）与经济（钱包）走**普通对象**——为 4 个实体
  付 SoA 的仪式感不值。
- **四道接缝**：裁决 · 钱包 · 炮台指令源 · 鱼池投喂源。单机各有一份本地实现，联网时各换一份。
- **RTP 恒 0.95**，且与网内鱼数、鱼种、炮倍率**全无关**——靠 `p = RTP / (N × m)` 这一个式子
  （推导见 §5），一万局模拟可在 vitest 里精确验。
- **不做**：充值、技能道具、BOSS（血量制）、多人同池、spine 骨骼动画。理由各见决策表。

---

## 1. Purpose：这一款给 kit 验什么

前六款验的是「模块怎么装配」。这一款验的是四块**从没走过的路**：

| 空白 | 现状 | 这一款怎么填 |
|---|---|---|
| **ECS 没有消费者** | `@cck/ecs-bitecs` node 全测，`apps/demo` 零引用；`progress.md` 挂着「demo cc 渲染场景留后续」「独立 Creator 工程渲染验证留下一步」 | 鱼 / 子弹 / 网跑在 bitECS 上，`Position → cc.Node` 那座桥第一次真架 |
| **横屏没验过** | `resolution.ts` 会检测方向并灌进 `UIVariant`，但 `prefabLand` 只对 `kind:'panel'` 生效；**没有一款横屏游戏** | 第一款横屏 `kind:'game'`，顺带补「场景怎么接方向变化」这条空白 |
| **图集没打过** | 现有六款全是散 PNG（45K~576K），一图一 draw call | 2MB 图集进 bundle：怎么打、怎么随 bundle 卸干净、归属会不会漂 |
| **上量没压过** | 最多十几个活动节点 | 100~200 条鱼 + 几十发子弹 / 网，**真机量帧率** |

**不在范围内**：native 热更下发这个新包（是独立的老账，跟捕鱼没有因果关系，该有自己的一刀）。

---

## 2. 领域模型

```
鱼池 FishPool ── 投喂源 FishFeeder ──> 鱼 Fish{种类, 路径, 进度}
   │                                      │
   │  SpatialHash（范围查询）              │ 沿路径游动，出界即销毁
   ▼                                      ▼
炮台 Cannon×4 ──> 子弹 Bullet ──命中──> 网 Net{半径 ∝ 炮倍率}
   │  指令源 CannonAgent                   │
   │  （本地触摸 / AI / 将来网络）           │ 罩住 N 条鱼
   ▼                                      ▼
钱包 FishWallet <──扣费/入账── 裁决 FishArbiter ──> 结算 Settlement[]
                                          │
                                     炸弹鱼死了 → 范围查询 → 再裁决一轮（连锁）
```

**概念表**

| 概念 | 是什么 | 住哪 |
|---|---|---|
| **鱼 Fish** | 一个 ECS 实体：种类 + 路径 + 进度。**没有血量**（我们是概率制，见决策 C） | ECS world |
| **炮台 Cannon** | 四门中的一门：倍率档位 1~7 + 指令源。**只有 4 个，普通对象** | 普通对象 |
| **子弹 Bullet** | 飞行中的一发，带发射者与档位 | ECS world |
| **网 Net** | 子弹命中处张开的圆，半径随档位增大。**一网只判一次**，随后消亡 | ECS world |
| **裁决 FishArbiter** | 唯一知道「死没死、赔多少、算谁的」的东西 | 接缝 ①，注入 |
| **钱包 FishWallet** | 账户余额（不是这一款的私房钱，见决策 B） | 接缝 ②，注入 |
| **结算 Settlement** | 一次裁决的结果：哪条鱼、死没死、赔多少 | 值对象 |

**归属（算谁的）不单列**——它天然收在裁决里：一次 `resolve` 属于一个 ticket，ticket 记着是哪门炮
开的。两张网同时罩住同一条鱼是**顺序**问题，按 ticket 先后串行处理，先判死的先得。

---

## 3. 四道接缝

**这是这份设计的核心。** 单机今天只写左边那列，联网时只换右边那列，**system 与单测一行不改**。

| # | 接缝 | 单机实现（今天写） | 联网实现（将来） | 为什么必须是缝 |
|---|---|---|---|---|
| ① | **裁决** `FishArbiter` | 本地概率（注入 `rand`） | 服务端下发 | 客户端权威 = 随便刷钱 |
| ② | **钱包** `FishWallet` | 本地 `IStorage`（账户级 key） | 服务端账户 | 真捕鱼里钱是账户的 |
| ③ | **炮台指令源** `CannonAgent` | 本地触摸 / AI | 网络下发 | 三个 AI 就是本地的三个假玩家，**接缝天天在跑** |
| ④ | **鱼池投喂源** `FishFeeder` | 本地随机生成器 | 服务端下发鱼群 | **外挂防线在这儿**——客户端自己生成 = 能预知鱼群、能自瞄大鱼 |

④ 还带一条免费的好处：鱼池不自己随机 ⇒ 鱼群完全由投喂序列决定 ⇒ **单测可以逐条摆鱼**，
「这条鱼走到第 3 秒时网罩不罩得住」在 vitest 里问得死（跟 `mini-hop` 的 `level.ts` 同一个路数）。

### 接缝怎么注入：工厂闭包，不搞正式的命令缓冲

`@cck/ecs-bitecs` 在这个仓的既有姿势就是**工厂函数捕获外部依赖**
（`createSeekSystem(targetEid, speed)` / `createCollisionSystem(hash, iterations)`）。沿用它：

```ts
createNetSystem(hash, arbiter, tickets, events)   // 而不是往 world 里塞命令队列
```

**钱的进出全在裁决里**（`fire` 扣、`resolve` 入账），system 不认识钱包 —— 否则联网那版
「服务端说了算」的钱又得在 system 里再走一遍。`tickets` 是一张 `eid → 票根` 的表：
子弹**带着票飞**，命中时把票转给网，网判完就撕。票不塞进组件是因为 SoA 只装数字，
而联网那版的票会带服务端流水号。

只有**输出侧**留一个缓冲：system 产出的表现事件（鱼死了、金币飞、播哪个动画）进一个
**每帧清空的数组**，View 读完即弃。输入侧上正式命令缓冲在这个规模上是过度设计。

---

## 4. 架构：ECS 吃哪一半

### 进 ECS 的

复用 `@cck/ecs-bitecs` 已有的规范组件（它们在 AOT 里，白拿）：`Position` / `Velocity` /
`Circle` / `SpatialHash` / `movementSystem` / `spatialIndexSystem`。

⚠️ **`spatial` 那五个 system 只用得上两个**。`FlowField` / `seek` / `separation` / `collision`
全是给「**涌向玩家的群体**」（肉鸽 / 幸存者）设计的，而捕鱼的鱼**不涌向任何人**、走的是投喂进来的
预设路径，鱼之间也不需要推开（互相穿过是这个品类的正常观感）。别指望整套复用。

本模块自己的组件（住 `assets/modules/mini-fish/`，理由见 [`ADR-0019`](../adr/0019-npm-package-aot-vs-assets-boundary.md)）：

```ts
Fish       { kind: ui8 }                          // 种类下标，倍率查表
PathFollow { pathId: ui16, t: f32, speed: f32 }
Angle      { v: f32 }                             // 朝向，pathSystem 算好给 View
Bullet     { cannon: ui8, level: ui8 }
Net        { cannon: ui8, level: ui8 }
Bomb       {}                                     // tag：炸弹鱼（河豚）
```

`Net` **只活一帧**：`bulletSystem` 建它、同帧 `netSystem` 判完就销毁。网张开多久是**表现**，
由 View 收到 `hit` 事件自己播 —— 所以它不需要 `life` 字段。

### 不进 ECS 的

炮台（4 个）、钱包、裁决器、余额 UI、结算流程。**为 4 个实体付 SoA 的仪式感，query 开销比
对象字段还大**，纯负担。

### system 流水线（按序）

| system | 干什么 |
|---|---|
| `feedSystem` | 问 `FishFeeder` 要这一帧的 spawn，建实体 |
| `pathSystem` | 推进 `PathFollow.t`，算出 `Position` 与朝向 |
| `movementSystem` | 包里现成的：`Position += Velocity × dt`（子弹用） |
| `spatialIndexSystem` | 包里现成的：重建 `SpatialHash` |
| `bulletSystem` | 子弹飞行、出界销毁、碰到鱼 → 在该处建 `Net`、销毁子弹 |
| `netSystem` | 范围查询罩住谁 → 调裁决 → 入账 → 产出表现事件 → 炸弹鱼连锁再来一轮 → 网消亡 |
| `despawnSystem` | 游出界的鱼销毁 |

---

## 5. 数值：RTP 恒 0.95 的那个式子

### 鱼种表（11 种，倍率取自 CCFish 的 `gold` 列）

| 鱼 | 倍率 `m` | | 鱼 | 倍率 `m` |
|---|---|---|---|---|
| `fish_red` 红鱼 | 10 | | `fish_gui` 鬼鱼 | 30 |
| `fish_denglong` 灯笼鱼 | 10 | | `fish_hailuoshuimu` 海螺水母 | 30 |
| `fish_yellow` 黄鱼 | 10 | | `fish_hetun` 河豚 **← 炸弹鱼** | 40 |
| `fish_bigred` 大红鱼 | 20 | | `fish_jinshayu` 金鲨 | 40 |
| `fish_fuyi` 蝠鱝 | 20 | | `fish_shayu` 鲨鱼 | 50 |
| | | | `fish_shuimu` 水母 | 50 |

CCFish 的 `hp` 列**丢掉不用**——它是血量制的产物，我们是概率制（决策 C）。

### 击杀概率

一发炮弹消耗 `level`（档位 1~7），网罩住 `N` 条鱼，第 i 条：

```
击杀概率  p_i      = RTP / (N × m_i)
赔付      payout_i = level × m_i
```

**期望赔付** = Σ p_i × level × m_i = Σ (RTP / (N × m_i)) × level × m_i = N × RTP × level / N
= **RTP × level** ＝ 0.95 × 消耗。

于是 **RTP 恒等于 0.95，与网内鱼数、鱼种组合、炮倍率全部无关**。这不只是数学上的漂亮——它让
「RTP 到底是不是 0.95」变成一个能在 vitest 里跑一万局模拟精确断言的命题，而不是靠调参手感。

⚠️ `p_i` 恒 < 1（`RTP=0.95`，最小 `m=10`，`N≥1`）。

### 其余数字

- 初始金币 **10000**；破产（余额 < 最小档位）白送 **1000** 保底。
  ⚠️ 保底是**白送的钱，会破坏 RTP**——它是 demo 的便利，不是经济设计的一部分，模拟 RTP 时要关掉。
- 炮台 **7 档**，消耗 = 档位；网半径随档位增大。
- **不做充值**（要支付通道 + 合规，且那一半在 `server-core-kit`，本会话不碰别的仓）。

---

## 6. 目标 API

```ts
// ── 接缝①：裁决 ────────────────────────────────────────────
export interface FireTicket { readonly cannon: number; readonly level: number }

export interface Settlement {
  readonly eid: number;
  readonly dead: boolean;
  readonly payout: number;   // 死了才 > 0
}

export interface FishArbiter {
  /** 开一炮：扣钱开票。余额不足返回 null——这一炮打不出去。 */
  fire(cannon: number, level: number): FireTicket | null;
  /** 一张网罩住这些鱼 → 谁死了、各赔多少。炸弹鱼连锁是第二次调用。 */
  resolve(ticket: FireTicket, caught: readonly { eid: number; kind: number }[]): readonly Settlement[];
}

// ── 接缝②：钱包（零依赖，单测塞 memoryWallet） ──────────────
export interface FishWallet {
  balance(): number;
  spend(amount: number): boolean;   // 余额不足返回 false 且不扣
  earn(amount: number): void;
}
export function memoryWallet(initial?: number): FishWallet;

// ── 接缝③：炮台指令源 ──────────────────────────────────────
export interface CannonAgent {
  /** 每帧问一次：朝这个角度开炮，还是这一帧不开（null）。 */
  update(dt: number, view: PoolView): number | null;
}

// ── 接缝④：鱼池投喂源 ──────────────────────────────────────
export interface FishSpawn {
  readonly kind: number;
  readonly pathId: number;
  readonly speed: number;
}
export interface FishFeeder {
  /** 这一帧要放哪些鱼进来。 */
  next(dt: number): readonly FishSpawn[];
}
```

`memoryWallet` 与 `memoryScoreboard`（`foundation/game/scoreboard.ts`）是同一个套路：**不落盘，
实例一没就清零**——它不是「忘了接钱包也能用」的兜底，而是「这个 VM 现在没接任何外部世界」的诚实表示。

---

## 7. 决策表

| # | 决策 | 选了 | 为什么不选别的 |
|---|---|---|---|
| A | 谁裁决「这一炮打死没打死」 | **VM 不自己裁，裁决源注入** | 客户端自裁 = 将来接服务端要重写整个 VM；直接做服务端 = 那一半在别的仓 |
| B | 金币属于谁 | **属于账户**（key 走账户级），实现先住模块 | 属于这一款 = 打鱼赚的钱在商城花不了；直接建地基钱包 = 商城是空壳、没有第二个用户 |
| C | 裁决机制 | **纯概率** `m × p` | 控分池必须服务端且是博彩机制；纯血量手感是打靶不是捕鱼 |
| D1 | 一池几门炮 | **单机四人**（1 玩家 + 3 AI） | 单人一池验不到接缝 ③；真多人同池要服务端。**AI 陪打把接缝逼出来了**，不是装饰 |
| D2 | 鱼池归谁 | **可外部投喂** | 客户端自己生成 = 外挂能预知鱼群、自瞄大鱼，真上线守不住 |
| D3 | 特殊鱼 | **普通鱼 + 1 种炸弹鱼**（河豚） | 只做普通鱼 → 裁决接口会长成 `resolve(fishId)→{死,赔}`，加炸弹鱼时要推倒重来；做 4 种是重复付第一种付过的钱。**BOSS 明确不做**：血量制与概率制是两套世界观 |
| D4 | 炮弹命中之后 | **渔网**（网内各判一次） | 单发命中一条浪费了 D3 刚付过的「一组结算」形状。**技能道具不做**（纯 buff 内容） |
| D5 | ECS 吃多少 | **混合**：鱼 / 子弹 / 网走 ECS，炮台与经济走对象 | 全 ECS = 为 4 门炮付 SoA 仪式感；不用 ECS = 用户明确要 ECS，且它是这仓挂最久的欠账 |
| D6 | ECS 那半怎么被闸住 | **扩 `check-vm-tests.mjs` 认 `*System.ts`** | 硬套 `*VM.ts` 名不副实；收成门面 → 门面测试测不到单个 system，闸绿了实际没测到 |
| E | 鱼的表现 | **静态 PNG + 代码游动** | spine 是**另一件事**（新资源类型 + 新运行时 + 释放路径没验过），混进来会让「捕鱼跑通了」说不清是哪件事跑通了 |
| F | 横屏怎么办 | **横屏玩法 + 靠玩家转手机**，竖屏时「请横屏」 | 竖屏捕鱼等于 F 白验；给 kit 加强制方向 = 扩 kit 边界（`resolution.ts` 明确表过态不做），且 web / native / 小游戏三套坑 |
| G | 规模 | **100~200 条鱼** | 30~50 条 ECS 是纯仪式；1000+ 不是这个品类的密度，且必然要上自定义渲染，那是另一个课题 |
| H | 玩法代码住哪 | **`assets/modules/mini-fish/`** | 判据见 [`ADR-0019`](../adr/0019-npm-package-aot-vs-assets-boundary.md)：npm 包 = AOT（重启生效），玩法字段恰恰最常改 |
| I | 验到哪算做完 | **web e2e + 真机帧率** | 只做 web e2e ⇒ ECS 的性能主张一字没验；再加 native 热更下发是独立老账，绑一起会互相拖延 |
| J | 美术来源 | **CCFish 的图集** | 见 §8 —— 授权表如实标注，**不标 CC0** |
| K | 档位 | **全用**：11 种鱼 + 7 级炮 + 7 级网 | 鱼种多是纯换图换数、逻辑零增量；素材现成不用白不用 |
| L | 怎么切 | **三刀**，见 §10 | 一刀做完中间没有可验的点；第三刀的失败模式（性能 / 平台）跟前两刀（逻辑）完全不同，混一起会互相掩护 |

---

## 8. 美术素材：来源与授权

素材取自 GitHub **`fylz1125/CCFish`**（Cocos Creator 2.2.2 工程）：

| 拿什么 | 说明 |
|---|---|
| `textures.png` (2.09 MB) + `textures.plist` | 主图集。plist 是 cocos2d / TexturePacker 通用格式，**3.8 直接认**，导入自动切 SpriteFrame |
| `cointextures` / `timer` | 两个小图集 |
| `game_bg.jpg` / `bg_buyu2.jpg` / `startbg.jpg` | 背景 |
| 11 种鱼 × (run + die) 的帧名 | 从 `.anim` 里读帧序列；`.anim` 本身是 2.x 格式，**不移植**，序列帧由代码切 |
| `fishconfig.json` 的 `gold` 列 | 当倍率 `m`；`hp` 列丢掉 |

⚠️ **授权状况必须如实记录**：该仓**没有 LICENSE 文件**，README 明写是「仿照官方在线游戏」，
无任何素材来源说明——图集里的鱼、炮台、UI 大概率源自商业捕鱼游戏。

**因此 `apps/demo/README.md` 的「素材来源与授权」表里，这一行写：**

> 来源：GitHub `fylz1125/CCFish`（仓内无 LICENSE），**原始版权归属不明** —— 不标 CC0。

标签准确了，那张表对其余五款的 CC0 声明才还算数。

**不移植的**：`.anim` / prefab / scene（2.2.2 格式，与 3.8 不通）、`Fish.ts` / `Bullet.ts` /
`Net.ts`（围着血量制写的，跟决策 C 是两条路）。它们只当**领域参考**读。

---

## 9. 测试计划

遵循 `testing-strategy-overview.md` 四条硬规则：逻辑全在零 `cc` 层、View 只做四件事、
测试放 `apps/demo/test/` 镜像路径、`await` 回来先确认自己还在。

| 层 | 测什么 | 怎么测 |
|---|---|---|
| **数值** | **RTP 一万局模拟落在 0.95±ε**（关掉破产保底）；`p_i < 1` 恒成立；余额不足开不出炮 | 纯 node，固定 `rand` 序列 |
| **裁决** | 一组进一组出；炸弹鱼连锁是第二次调用；两张网罩同一条鱼时先判死的先得 | 纯 node |
| **钱包** | `spend` 余额不足返回 false 且**不扣**；`earn` 累加；账户级 key 隔离 | `memoryWallet` |
| **鱼池** | 逐条摆鱼（投喂序列写死）：这条鱼第 3 秒在哪、网罩不罩得住、出界销毁 | 纯 node |
| **各 system** | 逐个主路径 + 边界 | 镜像 `test/modules/mini-fish/*System.test.ts` |
| **闸** | `check-vm-tests.mjs` 扩认 `*System.ts` 后，漏测的 system 必须报红 | 故意漏一个验红 |
| **View** | 不单测。启动 smoke + web e2e 兜底 | — |
| **真机** | 200 条鱼 + 若干网时的帧率 | Android，兑现 I |

⚠️ **`FishGame.ts`（View）import `cc`，进不了 vitest** —— 跟 `LobbyHost` 同一类。它只做取组件 /
建绑定 / 转发事件 / 转发生命周期，写到第五件就下沉到 system。

---

## 10. 实施步骤（三刀）

### 第一刀「能打死鱼」——零美术、零 `cc`、零场景 ✅ 已完成（2026-08-28）

投喂 → 路径游动 → 炮台 → 子弹 → 网 → 裁决 → 钱包，全套 system + 四道接缝的本地实现 + 全套单测。
**整刀在 vitest 里跑完**，「RTP 是不是 0.95」用 30 万局模拟问死（容差 0.03 ≈ 3.2σ，是算出来的
不是试出来的）。同刀改 `scripts/check-vm-tests.mjs` 扩认 `*System.ts`（D6）。

落地清单：`assets/modules/mini-fish/` 12 个文件（`fish-kinds` / `paths` / `components` / `events` /
`economy` / `feeder` / `agent` / 五个 `*System` / `FishVM`）+ `test/modules/mini-fish/` 10 份镜像测试
（78 例）。八道门全绿。⚠️ 此刻这些脚本还**没有 bundle meta**，Creator 会把它们编进主包 ——
第二刀建 bundle 时归位。

### 第二刀「能看见」 ✅ 已完成（2026-08-28）

图集导入（`.plist` → 3.8）→ `FishGame.ts` + `Fish.scene` → `catalog.ts` 加一行 → 横屏提示 →
落盘钱包（接缝 ② 的单机实现）→ 八道门 → **web 真产物 e2e**。

三条实测结论：

- **`.plist` 图集 3.8 直接认**：Creator 生成 `importer: "sprite-atlas"` 的 meta + 167 个
  `sprite-frame` subMeta（帧名**不带 `.png`**，`atlas.getSpriteFrame('fish_red_run_0')`）。
  本仓只需把 `.png` / `.plist` 丢进 `art/`，meta 由 Creator 首次构建时现生成。
- **`BUNDLE_GRAPH` 不用改**：模块段按 `MODULE_CATALOG` 现推，而 `@cck/ecs-bitecs` 是 npm 依赖
  （落 AOT chunk），不是 bundle —— 所以加 `mini-fish` 真的只改 `catalog.ts` 一行。
- **e2e 走的是「竖屏大厅 → 进游戏看提示 → 转横屏开打」**：横屏大厅列表放不下第 10 个入口
  （**这是本刀撞出来的既有 UI 问题，不是捕鱼的**，见 §11 开放项 7）。

### 第三刀「量得准」

三个 AI 陪玩 → 压到 200 条鱼 → **Android 真机量帧率**。
量完再决定要不要动渲染（见 §11 开放项 4）。

---

## 11. Open Questions / 已知的坑

1. **鱼的路径类型未定**。打算参考 CCFish 的 `Fish.ts` 写法后定（直线 / 贝塞尔 / 环绕）。
   路径数据是否要像 `mini-hop` 的 `level.ts` 那样烘成生成物，取决于**源在不在仓里**——
   这里没有外部源，那就当手写文件维护，**不配 `--check` 闸**。
2. **AI 陪玩的瞄准行为未定**（随机挑一条鱼？挑最大的？）。它只影响观感，不影响任何接缝。
3. ~~**图集归属会不会漂**~~ —— **已实测：没漂**（2026-08-28）。产物里 `mini-fish` 的
   `deps` / `redirect` 都是空，2MB 图集整个归自己那个包；`check:pins` / `check:graph` 照过。
   判据跟 `mini-plane` 那批散图一样：**资源在模块目录下、有自己的 `.meta`，就天然归这个包**
   —— 钉子治的是没有工程 `.meta` 的 `db://internal`，跟图集是两回事。
4. **200 条鱼真机跑不动怎么办**——路子已经查清但**先不做**：Cocos 3.8.7 有
   `UIRenderer` + 自定义 `IAssembler`（`createData` / `updateRenderData` / `fillBuffers`），
   可以一个节点画 200 条鱼、1 个 draw call、零 Node 树遍历。
   **ECS 的 SoA 布局恰好就是顶点流最想要的输入**（`Position.x` 就是个 `Float32Array`，连续扫内存），
   所以这个转换只动 `FishGame.ts` 一个文件，system / 裁决 / 钱包 / 单测一行不改。
   ⚠️ `IAssembler` 与 `UIRenderer.Assembler` 在官方 `.d.ts` 里标着 **`@internal`**——半公开接缝，
   跨小版本可能变。**现在不预留、不抽象，量完帧率再决定**。
5. **`GameHost` 那四件事（`player` / `exit` / `best` / `submit`）装不下经济型游戏**。本款不用
   `submit`（它没有「最高分」）。要不要把 `GameHost` 扩成更通用的形状，是这一款暴露出来的问题，
   **本设计不解决**，留作后续议题。
6. **破产保底会破坏 RTP**，模拟时必须关掉（§5）。
7. **横屏大厅放不下 10 个入口** —— `LobbyPanel` 是一列纵向按钮、没有滚动，横屏（1920×1080）下
   第 10 条掉到屏外。**这是既有 UI 的问题，不是捕鱼的**：第 9 个入口时就已经贴边了。
   要么给大厅加滚动，要么横屏改多列 —— 本设计不解决，但它是下一个加模块的人一定会撞上的墙。
8. **AI 档位固定 3 级**（`AI_LEVEL`）。第三刀压量时再说要不要让它们变档。

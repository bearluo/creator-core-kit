---
状态: 已定稿
摘要: 面向 bullet-heaven / survivors 类（Vampire Survivors / Brotato / Halls of Torment）的「大量圆形实体涌向玩家」场景，横评三块高性能能力——寻路 / 碰撞 / 群体避让——的成熟方案，带一手来源。结论均偏「hand-roll 短代码」而非引库：**寻路**开阔场用纯 seek（1 行）、有障碍用手写 flow field（BFS 洪泛，一场一次全 agent 共享）；**碰撞** broad-phase 用手写 uniform spatial hash grid（同尺寸均匀分布的最优解，胜过 quadtree/R-tree）、narrow-phase 圆-圆平方距离，需多边形再 wrap detect-collisions；**群体避让**用 positional de-overlap 硬推开（+ 可选 boids 分离）。**ORCA/RVO2 不要**（swarm 涌向单目标不需互避的 LP 解；实测 survivors 克隆与原作都只做推开/不做怪-怪碰撞）。三者皆纯数值、SoA 友好、node 可测，契合 @cck/ecs-bitecs；引 OOP 库（yuka）会与 bitECS 实体模型打架。
何时读: 要给 @cck/ecs-bitecs 接寻路/碰撞/避让 system、质疑「要不要上物理引擎 / ORCA / navmesh」、或找可照抄的 mass-entity 工程实现时。
日期: 2026-07-29
依赖: packages/ecs-bitecs/docs/modules/ecs.md（本包 bitECS v0.3 SoA、纯 TS node 测、逻辑不跨 bundle、后续接寻路/碰撞/ORCA）；docs/research/2026-07-28-ecs-survey.md（选型定 bitECS，性能优先）；平台硬约束（微信/抖音小游戏：无 SharedArrayBuffer / 无多线程 / WASM 加载受限）
---

# 寻路 / 碰撞 / 群体避让 横评（bullet-heaven / survivors 类）

## 目的与范围

`@cck/ecs-bitecs` 定案后（bitECS v0.3、SoA/TypedArray、纯 TS 可 node 测、逻辑不跨 bundle，见 [ecs.md](../../packages/ecs-bitecs/docs/modules/ecs.md)）下一步要接**寻路 / 碰撞 / 群体避让**三块高性能 system。本文为动工前的横评，锁定目标场景：

> **bullet-heaven / 幸存者类**（Vampire Survivors / Brotato / Halls of Torment）：**几百~几千个近似圆形的实体，绝大多数每帧朝单一目标（玩家）移动**，玩家在移动，敌人之间需要「不重叠成一坨」但不需要精细礼让。

本包硬约束（每个候选都按此打分）：① 运行时 bitECS **SoA**（组件是 TypedArray，按 `eid` 索引）；② **纯 TS、node/vitest 直测**（不碰 cc/DOM/Canvas）；③ 目标平台含**微信/抖音小游戏** → **不能用 SharedArrayBuffer / 多线程**，**WASM 方案要标风险**（小游戏 wasm 有加载格式/体积限制）；④ 实体近似圆、分布相对均匀、数百~数千。

调研维度（每候选）：repo/npm 链接、维护状态与最近更新、star 量级、License、复杂度/性能量级、**与 bitECS SoA 的契合度**（OOP 库自带 entity 模型会不会冲突）、能否 node 测、小游戏可用性。

> star/version 为**量级**参考（附 repo 供核；npm 版本经 registry 核实），run-to-run 无绝对意义，只表梯队。

---

## 零、先判场景性质（贯穿全文的前置结论）

三块能力的选择，全被「涌向单一目标的同尺寸圆」这个场景性质决定，先给判断，后面各节回填证据：

1. **寻路**：目标只有一个（玩家）且在动。开阔场（经典 VS/Brotato，无墙）→ 敌人方向就是 `normalize(player - self)`，**纯 seek 即最优**，连寻路都不需要。有障碍（Halls of Torment 有墙体）→ 用 **flow field**：从玩家格子做一次 BFS/Dijkstra 洪泛得整张向量场，**所有敌人共享、每 agent O(1) 采样**，而不是每敌人各跑一次 A*。
2. **碰撞**：实体**尺寸相近、分布相对均匀** → **uniform spatial hash grid** 是教科书最优（cell≈2× 半径，O(n) 近邻），比 quadtree/R-tree 更快更简（后两者的自适应是为**尺寸悬殊/聚簇**准备的，本场景用不上）。narrow-phase 全是圆 → 平方距离比半径和，连 SAT 都不必。
3. **群体避让**：敌人只是「别叠在一起地涌向玩家」，不是两股人流对穿。→ **硬推开（positional de-overlap）** 就够；要更自然叠一层 **boids 分离**。**ORCA/RVO2 是杀鸡用牛刀**（详见 §C 结论）。

一句话：**这三块的正解都是几十行 hand-roll 的纯数值代码，直接在 bitECS 的 SoA 数组上算**；引第三方库（尤其 OOP 的 yuka、WASM 的 recast/rapier）多半是负收益。下面逐块给证据与候选对比。

---

## A. 寻路 pathfinding

| 方案 | 代表实现 | 机制 | 复杂度/量级 | bitECS 契合 | node 测 | 小游戏 | 维护/License |
|---|---|---|---|---|---|---|---|
| **纯 seek** | 自写 1 行 | `dir = normalize(player - pos)` | O(n)，最便宜 | 完美（直接写 SoA） | ✓ | ✓ | 自有 |
| **Flow field / vector field** | 自写 ~80 行（[howtorts](https://howtorts.github.io/2014/01/04/basic-flow-fields.html) / [Game AI Pro ch.23](https://www.gameaipro.com/GameAIPro/GameAIPro_Chapter23_Crowd_Pathfinding_and_Steering_Using_Flow_Field_Tiles.pdf)） | 从目标 BFS/Dijkstra 洪泛→整数距离场→每格取最小邻居方向=向量场；全 agent 共享 | 一场一次 O(cells)，agent 采样 O(1) | 完美（场是 TypedArray，eid→cell 索引） | ✓ | ✓ | 概念级，自写 |
| **grid A\*** | [pathfinding.js](https://github.com/qiao/PathFinding.js)（qiao，~万级 star，MIT，**2015 后基本停更**）、[EasyStar.js](https://github.com/prettymuchbryce/easystarjs)（~千级 star，MIT，异步 `iterationsPerCalculation` 限流） | 每 agent 每次各求一条路 | **每 agent 一次 A\***，千单位每帧不可行 | 差（返回路径对象/数组，非 SoA） | ✓ | ✓ | pathfinding.js 停更 |
| **Navmesh (recast/detour)** | [recast-navigation-js](https://github.com/isaac-mason/recast-navigation-js)（isaac-mason，~千级 star，MIT，活跃，npm `recast-navigation` v0.43.x）、[three-pathfinding](https://github.com/donmccurdy/three-pathfinding) | WASM 版 Recast/Detour，含 `Crowd`(dtCrowd) 局部避让 | 重；建网格+查询 | 差（WASM 边界、非 SoA、entity 由 dtCrowd 自管） | 勉强（需 init WASM，无 DOM 但要 emscripten glue） | **风险**（WASM 加载/体积；小游戏需转格式） | 活跃 |

**小结（寻路）**：

- **首选：开阔场纯 seek，有障碍手写 flow field。** survivors 的经典形态是开阔竞技场、敌人无脑追玩家——`normalize(player - pos)` 就是数学上的正解，寻路问题根本不存在。**纯 seek 的适用边界**：地图无墙/障碍稀疏、允许敌人被地形卡住（或用碰撞层挡）时永远够用；一旦要绕**成片墙体**（Halls of Torment 式），才升级到 flow field。
- **flow field 的关键账**：目标唯一 → 一整张场服务所有敌人，成本从「N 敌 × 各一条 A\*」摊成「一次全图洪泛 + N 次 O(1) 采样」（[howtorts](https://howtorts.github.io/2014/01/04/basic-flow-fields.html)：Dijkstra 洪泛生成距离场，再逐格取最小邻居方向成向量场，agent「采样当前格向量」即走；[Game AI Pro, Emerson, Supreme Commander 2](https://www.gameaipro.com/GameAIPro/GameAIPro_Chapter23_Crowd_Pathfinding_and_Steering_Using_Flow_Field_Tiles.pdf) 即此法的原始出处，专为「大群 agent 奔同一目的地」而生）。玩家在动 → 每 N 帧或玩家跨格时重建一次即可（摊薄）。**无成熟且 SoA 友好的 npm「flow field 库」值得引**——它就是一个网格 BFS，~80 行 hand-roll，直接吃 bitECS 的 TypedArray，比引任何库都省。
- **A\* 库（pathfinding.js / EasyStar.js）**：是**逐 agent 逐路**模型，千单位每帧各跑一次 A\* 不可行；且返回路径对象/节点数组，与 SoA 逻辑割裂。仅适合「少量单位、偶发寻路」（如个别 boss 绕路），不适合 swarm。pathfinding.js 虽 star 高但 2015 后基本停更。
- **Navmesh（recast-navigation-js）**：工业级但对本场景 **overkill**——它是 WASM 端口，`Crowd`/dtCrowd 自带一套 agent 管理与 RVO 式避让（[docs](https://docs.recast-navigation-js.isaacmason.com/)），会**抢走 bitECS 的 entity 所有权**、数据出 SoA、且 WASM 在微信/抖音小游戏有加载与体积风险。仅当你要**3D/复杂多边形地形上的精确路由**时才考虑，survivors 用不上。

---

## B. 碰撞 collision

分 broad-phase（快速筛出可能碰撞的对）与 narrow-phase（精确判定）。

### B.1 broad-phase

| 方案 | 代表实现 | 适配「同尺寸·均匀分布」 | 复杂度 | bitECS 契合 | 维护/License |
|---|---|---|---|---|---|
| **Uniform spatial hash grid** | 自写 ~40 行（[kirbysayshi hierarchical hash grid gist](https://gist.github.com/kirbysayshi/1760774) 可参考） | **最优**：cell≈2×半径，均匀分布下每格 O(1) 邻居 | 建/查 O(n) | 完美（`Int32` 桶数组按 eid 存） | 概念级，自写 |
| **Quadtree** | npm 多个（如 [`@timohausmann/quadtree-ts`](https://github.com/timohausmann/quadtree-ts)，~百级 star，MIT） | 一般：自适应是为**聚簇/尺寸悬殊**准备，均匀场反而多花树维护 | 建 O(n log n) | 中（多为对象节点） | 活跃 |
| **R-tree** | [rbush](https://github.com/mourner/rbush)（mourner，~千级 star，ISC，稳定；被 detect-collisions 内部使用） | 一般：强在**静态/异形/范围查询**，动态每帧重插入代价高 | 建 O(n log n)，重插入贵 | 中（节点是对象 `{minX..}`） | 稳定 |
| **静态打包 R-tree** | [flatbush](https://github.com/mourner/flatbush)（mourner，~千级 star，ISC，TypedArray 底层） | 差：**只读静态**，每帧动的实体不适用 | 建极快、不可增删 | 好（TypedArray）但不支持动态 | 稳定 |
| **物理引擎自带 broadphase** | 见 B.3 | — | 连带整套物理 | 差 | — |

### B.2 narrow-phase

| 形状 | 判定 | 现成库 | 说明 |
|---|---|---|---|
| **圆-圆** | `dx²+dy² < (r1+r2)²`（平方距离，免开方） | 自写 1 行 | **本场景 99% 就这一种**，最便宜 |
| AABB | 区间重叠 | 自写 | 矩形 hitbox 时 |
| SAT（凸多边形） | 分离轴 | [detect-collisions](https://github.com/Prozi/detect-collisions)（Prozi，~百级 star，MIT，**活跃 2025**，`sat`+`rbush`）、[collisions](https://www.npmjs.com/package/collisions)（Sinova，BVH+SAT，维护放缓） | 仅当 hitbox 是异形多边形才需要 |

**小结（碰撞）**：

- **首选：手写 uniform spatial hash grid（broad）+ 圆-圆平方距离（narrow）。** 本场景的两个前提——**实体尺寸相近、分布相对均匀**——正是均匀网格的最佳工况：cell 取约 2× agent 半径，每个实体只需查自身格 + 8 邻格，均匀分布下每格常数个实体，整体 O(n)。quadtree / R-tree 的自适应细分是为**尺寸悬殊或强聚簇**设计的，本场景那套树维护成本纯属浪费（碰撞 broad-phase 基准横评见 [0fps: Collision detection benchmarks](https://0fps.net/2015/01/23/collision-detection-part-3-benchmarks/)——网格在均匀密集场景对树结构有稳定优势）。narrow-phase 全是圆 → 平方距离比半径和，连 SAT/开方都省。
- **要不要引 detect-collisions**：它是维护良好的 BVH/R-tree(rbush) + SAT 组合，node 可跑、MIT、支持 Circle/Box/Polygon/Point（[npm](https://www.npmjs.com/package/detect-collisions)，描述 "2d collision detection for circles, polygons, and points (with SAT and BVH)"）。但它**自管一套 body 对象**（`system.insert(body)`），与 bitECS SoA 两套数据、要来回同步 `Comp.x[eid]↔body.x`。**仅当你后续真的需要多边形/异形 hitbox 的 SAT** 时才 wrap 它；纯圆的 survivors 用不上，手写网格更省且天然吃 SoA。
- **rbush / flatbush**：rbush 强在静态数据与范围查询、flatbush 是只读 TypedArray 打包树——都不适合「每帧全员移动」的动态 broad-phase（rbush 动态重插入是其文档明说的最贵操作）。略过。

### B.3 引整个物理引擎的代价（planck.js / box2d-wasm / matter.js / rapier2d / p2.js）

| 引擎 | 形态 | 小游戏可用 | 对本场景 |
|---|---|---|---|
| [planck.js](https://github.com/piqnt/planck.js) | **纯 JS** 重写 Box2D，MIT，~千级 star，动态树 broadphase | ✓（纯 JS，无 WASM/SAB） | overkill：要的是刚体动力学，survivors 不需要 |
| [box2d-wasm](https://github.com/Birch-san/box2d-wasm) / box2d.js | Box2D 的 **WASM** 端口 | **风险**（WASM 加载/体积） | overkill + WASM 风险 |
| [matter.js](https://github.com/liabru/matter-js) | 纯 JS，~万级 star，但**维护放缓**、AoS/OOP body | ✓（纯 JS） | OOP body 与 SoA 割裂，重 |
| [@dimforge/rapier2d](https://github.com/dimforge/rapier) | Rust→**WASM**（wasm_bindgen），~千级 star，Apache-2.0 | **风险**（WASM；小游戏需转格式，见 [minigame wasm](https://github.com/wechat-miniprogram/minigame-unity-webgl-transform)） | 性能强但 WASM 边界 + 非 SoA |
| [p2.js](https://github.com/schteppe/p2.js) | 纯 JS，MIT，**已停更** | ✓ | 停更，别选 |

**结论**：survivors 类**只要 broad+narrow 两阶段的重叠检测 + 推开**，**不需要**刚体、关节、摩擦、连续碰撞这些物理引擎的正戏。引整套引擎（哪怕纯 JS 的 planck.js）是拿一栋楼换一间房——多几百 KB、多一套自管 body/world、SoA 数据还要双向同步。**唯一可能引物理引擎的理由**是玩法真需要真实物理（击退连锁、堆叠、斜坡），survivors 通常不需要。若哪天需要且要上小游戏，**优先纯 JS 的 planck.js**（无 WASM/SAB 风险），WASM 系（box2d-wasm / rapier2d）留作端游/H5 且必须实测小游戏加载。

---

## C. 群体避让 crowd avoidance

| 方案 | 代表实现 | 每帧开销 | 效果 | bitECS 契合 | 维护/License |
|---|---|---|---|---|---|
| **硬推开 positional de-overlap** | 自写 ~10 行 | 复用碰撞对，O(碰撞对) | 够用：不叠一坨 | 完美（直接改 SoA pos） | 自有 |
| **Boids 分离 separation** | 自写（邻域反比推开）；[yuka](https://github.com/Mugen87/yuka) 有现成但 OOP | O(近邻)，复用网格 | 更自然的散开 | 自写完美；**yuka 冲突**（见下） | yuka MIT，~千级 star，**最后发版 2022** |
| **ORCA / RVO2** | [rvo2-js](https://github.com/palmerabollo/rvo2-js)（**alpha、研究用、非商用许可、未维护**）、[RVO2-TS](https://littlegauze.github.io/RVO2-TS-Demo/)、recast 的 dtCrowd | **贵**：每 agent 对邻居解 LP（线性规划）求无碰撞速度 | 平滑双向互避（人流对穿） | 差（自管 agent、非 SoA、LP 每帧） | 端口多为 alpha/停更 |

**yuka 冲突说明**：yuka 是 OOP Game AI 库（`Vehicle`/`GameEntity` + 一套自己的实体、`EntityManager` 调度、`Vector3` 对象、steering behaviors 含 seek/flee/separation/flocking，MIT、零依赖、[官网](https://mugen87.github.io/yuka/)）。但它**自带一套实体与向量对象模型**，与 bitECS 的「eid + TypedArray」是两个宇宙——用 yuka 等于在 SoA 之外再养一群堆对象，每帧同步、GC 压力、性能梯队掉回对象级。它的 steering 公式（分离/群集）本身**只是几行向量数学**，照着抄进 bitECS system 即可，**不该把整个 OOP 库拖进来**。

**ORCA 要不要——明确结论：不要。**

依据（一手）：

1. **实测：survivors 克隆用纯推开、根本不上 ORCA。** [ECS Survivors（Flecs 实现的 VS 克隆）Part IV: Collision](https://blog.ptidej.net/ecs-survivors-part-iv/) 明说重叠处理就是 **push-apart de-overlap**：算合半径与实距的重叠量、归一化方向、各推一半，改 pos/vel——"No ORCA/RVO mentioned, purely impulse-based separation"；broad-phase 甚至因为「~300 实体」而直接 O(n²) 都不虚（"There's no way I need more than 4800 entities on screen at the same time, right?"）。
2. **原作更极端：怪物之间根本不做碰撞。** [Vampire Survivors 社区讨论](https://steamcommunity.com/app/1794680/discussions/0/3425564948157515863/) 指出 VS 无 monster-to-monster 碰撞（boss 除外），2D 轴对齐矩形 hitbox，「无需任何空间划分算法就能处理」——连推开都省了，靠海量涌入的视觉盖过去。
3. **ORCA 的适用面不匹配。** ORCA/RVO2（原始论文 [van den Berg et al., *Reciprocal n-body Collision Avoidance*](https://gamma.cs.unc.edu/RVO2/)；工作原理见 [Game AI Pro 3, ch.19, Sunshine-Hill](https://www.gameaipro.com/GameAIPro3/GameAIPro3_Chapter19_RVO_and_ORCA_How_They_Really_Work.pdf)）是为**双向/多向人流互相礼让、不抖动地穿行**设计的，代价是**每 agent 对每个邻居构造 ORCA 半平面、解一次线性规划**——千单位每帧是实打实的开销。survivors 是**单向 swarm 涌向一个目标**，没有「对穿礼让」需求，ORCA 的收益（平滑互避）在这里几乎看不见，成本却全付。
4. **JS 端口不堪用。** [rvo2-js](https://github.com/palmerabollo/rvo2-js) 自述 alpha、research purposes、not for production，且带 UNC 研究许可（商用受限）、久未维护；native 的 [`rvo2` npm](https://www.npmjs.com/package/rvo2) 是 node-gyp C++ 绑定（编译依赖、跨平台/小游戏无望）。真要 ORCA 只能从已 Apache-2.0 的上游 C++/C# 重新移植——不值。

**避让首选：硬推开（positional de-overlap）**，复用碰撞 broad-phase 已经算出的重叠对，各推一半，~10 行、纯 SoA、node 可测。要更自然的散开，叠一层 **boids 分离**（邻域内按距离反比累加推力，同样复用网格近邻）。**ORCA 只保留为「未来若出现两股敌人对穿、且要平滑礼让」的理论备选**，当前不实现。

---

## D. bitECS 生态 & 工程实践

**现成可照抄的 bitECS starter？** 有限——bitECS 官方 examples 偏基础；社区最实用的是 ourcade 的 [phaser3-bitecs-getting-started](https://github.com/ourcade/phaser3-bitecs-getting-started) 与 [phaser3-matterjs-bitecs](https://github.com/ourcade/phaser3-matterjs-bitecs)（用 bitECS + Matter 物理）。但它们示范的是「bitECS 怎么组织 system」，**没有**现成的 flow field / spatial grid / 避让 system 可整段抄；这三块得自写（好在都短）。**更值得照抄的是算法级实现**（见下工程拆解），而非某个 bitECS 专用 demo。

**真实 mass-entity 工程拆解（移动 / 碰撞 / 避让 分别怎么做）：**

| 工程 | 移动/寻路 | 碰撞 broad-phase | 群体避让 |
|---|---|---|---|
| **ECS Survivors**（Flecs 实现的 VS 克隆，[博客系列](https://blog.ptidej.net/ecs-survivors-part-iv/)，**最值得照抄的一手拆解**） | seek 向玩家 | 试过 5 种方案，最终选**单例里存碰撞记录列表**（比 relationship 快 2× 以上）；因 ~300 实体，O(n²) 就够，spatial hash 备而未用 | **push-apart de-overlap**（重叠量各推一半），无 ORCA |
| **Vampire Survivors**（原作，[社区讨论](https://steamcommunity.com/app/1794680/discussions/0/3425564948157515863/)） | 敌人朝玩家直线 | 2D 轴对齐矩形，**怪-怪不碰撞**（boss 除外）→ 无需空间划分 | 无（靠数量淹没） |
| **RTS flow field 群体**（[Supreme Commander 2, Game AI Pro ch.23](https://www.gameaipro.com/GameAIPro/GameAIPro_Chapter23_Crowd_Pathfinding_and_Steering_Using_Flow_Field_Tiles.pdf) / [howtorts 教程](https://howtorts.github.io/2014/01/04/basic-flow-fields.html)） | **flow field**（一场一张场，全 agent 共享采样） | 网格 | 场内叠 steering（分离/避障） |

**给本包的直接启示**：survivors 这一档「几百实体」其实连精巧结构都可以先不上（ECS Survivors 用 O(n²) + 单例列表跑通、原作干脆不做怪-怪碰撞）；**先按最省的 hand-roll 落地，量级真上千再换 uniform grid**。三块能力都能作为 `@cck/ecs-bitecs` 内的独立 system 增量接入，每接一个即一份「高性能纯数值 system 接入 kit」样板（对齐 ecs.md 的 Open Questions #2）。

---

## 决策建议总表

| 块 | 首选 | 备选 | hand-roll or wrap | 一句话理由 | 对本包约束契合 |
|---|---|---|---|---|---|
| **A 寻路** | 开阔场**纯 seek**（`normalize(player-pos)`）；有障碍**手写 flow field**（目标格 BFS 洪泛→向量场，全 agent 共享 O(1) 采样） | 少量单位偶发绕路可 wrap EasyStar.js | **hand-roll**（~80 行洪泛，直接吃 SoA） | 目标唯一 → 一张场服务全体，比逐 agent A\* 便宜几个量级；纯 seek 在无墙场就是数学正解 | 纯数值/SoA/node 可测；无 WASM/SAB。navmesh(recast-WASM) 与 A\* 库皆非 SoA、overkill |
| **B 碰撞** | **手写 uniform spatial hash grid**（cell≈2×半径）+ **圆-圆平方距离** | 需异形多边形 hitbox 时 wrap **detect-collisions**（rbush+SAT，MIT，活跃） | **hand-roll**（网格 ~40 行 + narrow 1 行）；仅多边形才 wrap | 同尺寸·均匀分布正是均匀网格最佳工况，胜过 quadtree/R-tree 的自适应开销；全圆连 SAT 都省 | 桶用 Int32Array、pos 读 SoA，node 可测；**不引物理引擎**（planck.js/box2d-wasm/rapier2d 皆 overkill，WASM 系还有小游戏加载风险） |
| **C 群体避让** | **硬推开 positional de-overlap**（复用碰撞对，各推一半） | 要更自然散开叠一层 **boids 分离**（邻域反比推力，公式抄 yuka，不引库） | **hand-roll**（~10 行，改 SoA pos） | swarm 涌向单目标只需「别叠一坨」，推开即达标；实测 VS 克隆与原作都这么干 | 纯 SoA/node 可测；**不引 yuka**（OOP 实体模型与 bitECS 冲突、掉回对象梯队） |
| **ORCA?** | **不要** | 仅「未来两股敌人对穿且需平滑礼让」才理论备选 | — | 单向 swarm 无对穿礼让需求，ORCA 每 agent 解 LP 是纯付费无收益；JS 端口(rvo2-js)还是 alpha/非商用/停更 | 不满足性能与许可，且非 SoA |

**总纲一句话**：三块正解都是**几十行 hand-roll 的纯数值 system，直接在 bitECS SoA 数组上算**——寻路（seek/flow field）、碰撞（grid + 圆-圆）、避让（推开）。**别引 OOP 库（yuka）、别引物理引擎（planck/rapier）、别引 navmesh（recast）、别上 ORCA**；它们要么与 SoA 割裂、要么是为别的场景（异形/聚簇/对穿人流/真实物理）设计的过度工程。落地次序建议 **seek → uniform grid 碰撞 → 推开避让 →（按需）flow field**，每步一份接入样板。

---

## 来源清单（一手）

**A 寻路**
- Flow field 原始出处：Elijah Emerson, "Crowd Pathfinding and Steering Using Flow Field Tiles"（Supreme Commander 2），Game AI Pro ch.23 <https://www.gameaipro.com/GameAIPro/GameAIPro_Chapter23_Crowd_Pathfinding_and_Steering_Using_Flow_Field_Tiles.pdf>
- Flow field 实操教程（RTS）：howtorts "Basic Flow Fields" <https://howtorts.github.io/2014/01/04/basic-flow-fields.html>
- pathfinding.js（qiao，grid A\*，2015 后停更）<https://github.com/qiao/PathFinding.js> ；EasyStar.js <https://github.com/prettymuchbryce/easystarjs>
- recast-navigation-js（WASM navmesh + Crowd/dtCrowd）<https://github.com/isaac-mason/recast-navigation-js> ；docs <https://docs.recast-navigation-js.isaacmason.com/> ；npm <https://www.npmjs.com/package/recast-navigation> ；three-pathfinding <https://github.com/donmccurdy/three-pathfinding>

**B 碰撞**
- uniform / hierarchical spatial hash grid 参考实现（kirbysayshi gist）<https://gist.github.com/kirbysayshi/1760774>
- broad-phase 基准横评：0fps "Collision detection (part 3): Benchmarks" <https://0fps.net/2015/01/23/collision-detection-part-3-benchmarks/>
- detect-collisions（Prozi，rbush+SAT，活跃）<https://github.com/Prozi/detect-collisions> ；npm <https://www.npmjs.com/package/detect-collisions> ；collisions（Sinova，BVH+SAT）<https://www.npmjs.com/package/collisions>
- rbush（R-tree）<https://github.com/mourner/rbush> ；flatbush（静态打包 R-tree）<https://github.com/mourner/flatbush> ；quadtree-ts <https://github.com/timohausmann/quadtree-ts>
- 物理引擎：planck.js（纯 JS Box2D）<https://github.com/piqnt/planck.js> ；box2d-wasm <https://github.com/Birch-san/box2d-wasm> ；matter.js <https://github.com/liabru/matter-js> ；rapier <https://github.com/dimforge/rapier> ；p2.js <https://github.com/schteppe/p2.js> ；微信小游戏 wasm 约束参考 <https://github.com/wechat-miniprogram/minigame-unity-webgl-transform>

**C 群体避让**
- ORCA/RVO2 原始论文与库：van den Berg et al., *Reciprocal n-body Collision Avoidance*，UNC RVO2 <https://gamma.cs.unc.edu/RVO2/> ；工作原理 Game AI Pro 3 ch.19（Sunshine-Hill）<https://www.gameaipro.com/GameAIPro3/GameAIPro3_Chapter19_RVO_and_ORCA_How_They_Really_Work.pdf>
- JS 端口：rvo2-js（alpha/研究/停更）<https://github.com/palmerabollo/rvo2-js> ；RVO2-TS demo <https://littlegauze.github.io/RVO2-TS-Demo/> ；native 绑定 rvo2 npm <https://www.npmjs.com/package/rvo2>
- yuka（OOP steering，seek/separation/flocking，最后发版 2022）<https://github.com/Mugen87/yuka> ；官网 <https://mugen87.github.io/yuka/>

**D 生态 & 工程实践**
- ECS Survivors（Flecs 版 VS 克隆）Part IV Collision <https://blog.ptidej.net/ecs-survivors-part-iv/> ；Part V Gameplay <https://blog.ptidej.net/ecs-survivors-part-v-gameplay/>
- Vampire Survivors 碰撞/空间划分社区讨论 <https://steamcommunity.com/app/1794680/discussions/0/3425564948157515863/>
- bitECS + Phaser starter：ourcade phaser3-bitecs-getting-started <https://github.com/ourcade/phaser3-bitecs-getting-started> ；phaser3-matterjs-bitecs <https://github.com/ourcade/phaser3-matterjs-bitecs>
- 内部依据：`packages/ecs-bitecs/docs/modules/ecs.md`、`docs/research/2026-07-28-ecs-survey.md`
</content>
</invoke>

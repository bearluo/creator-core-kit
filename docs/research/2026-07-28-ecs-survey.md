---
状态: 草案（评审中）
摘要: 开源 TS/JS ECS 库横评（bitECS / miniplex / becsy / koota / @esengine/ecs-framework 深挖，ecsy/ape-ecs/wolf-ecs/thyseus 等略提），从扩展性/易用性(DX·类型安全)/性能三维带一手来源对比。结论：选 **bitECS**（性能优先，SoA 契合后续寻路/碰撞/ORCA），作独立扩展包 `@cck/ecs-bitecs` 一站式接入 kit——ECS 不进 core、作「第三方高性能扩展接入 kit」的范例，其游戏逻辑不跨 bundle（消解组件 identity 顾虑）。不自己从 0 写。
何时读: 要给可选 ECS 模块选底层库、质疑 ECS 选型、或评审集成形态（npm 依赖 vs vendor 内嵌）时。
日期: 2026-07-28
依赖: docs/design/2026-07-24-architecture-overview.md（默认范式=分层+DI+事件+数据驱动UI，ECS 可选）；docs/adr/0001-cross-bundle-singleton-and-aot-hotupdate.md（跨 bundle 身份/单例铁律）；docs/research/2026-07-27-cc-di-survey.md（装饰器在 Cocos 的坑 + token 用 Symbol.for/稳定字符串）
---

# 开源 TS/JS ECS 库横评与选型

## 目的与范围

用户定调：**ECS 不从 0 自己写，迁移/基于/借鉴开源项目，先定用哪一个**。本文放弃上一版「自己设计 map ECS」的方向（已作废，本文覆盖之），改为在现有 TS/JS ECS 库里选一个**适配本仓**的方案。适配约束（来自 CLAUDE.md 铁律 + ADR-0001）：

- **纯 TS、零 `cc` 依赖、node/vitest 可直接测**（`packages/core` 铁律）。
- **可 tree-shake、ESM**（AOT 缺代码风险，ADR-0001）。
- **跨 Asset Bundle 身份友好**：组件标识若靠 class 构造函数 / 模块级对象 identity，跨 bundle 复制会分裂（ADR-0001 实证：单 bundle 出包各内联一份 → `instanceof`/class identity 不可靠）。
- **DX / 类型安全 > 裸性能**：ECS 是**可选模块、不进默认地基**，性能不是本框架首要目标，但要「够用 + 存储可后期换」。

> **定位澄清（2026-07-28 评审后，覆盖上面部分约束）**：经用户确认，本模块定位调整——
> 1. **ECS 不进 `packages/core`**，作**独立扩展包 `@cck/ecs-bitecs`**，示范「第三方高性能能力如何接入 kit」；项目要用只引这一个包（bitECS + kit 接入胶水都在包内）。故 core 的「零 cc」铁律不直接约束它（仍纯 TS、可 node 测）。
> 2. **ECS 核心游戏逻辑不跨 bundle** → 上列「跨 Asset Bundle 身份友好」约束**对本模块失效**（组件定义同 bundle 内、identity 天然一致），bitECS/koota 的对象 identity 隐患不成立。
> 3. **性能升为首要**：浏览器 CPU 预算低，且后续要接**高性能寻路 / 碰撞 / ORCA**（每帧大量 agent、数值密集）——SoA/TypedArray 是对的数据布局。取向从「DX>裸性能」改为**性能优先**。
>
> 下列 §一~§三横评为事实基线不变；§四结论已按新定位改写。

评判三维：**扩展性 / 易用性(DX·类型安全) / 性能**。

---

## 一、ECS 存储形态谱系（方法面）

ECS 的一切权衡都落在「组件数据怎么存」上。四种主流形态：

| 形态 | 代表 | 查询/迭代速度 | 增删组件成本 | cache 友好 | 实现复杂度 | 内存 | 数据形状限制 |
|---|---|---|---|---|---|---|---|
| **archetype（原型）** | miniplex、becsy、koota、bitECS(v0.4)、thyseus、Unity DOTS | 极快（按组件组合分桶，连续迭代） | **较高**（增删组件 = 原型迁移，跨桶搬数据） | 好 | 高（位掩码 + 迁移） | 桶碎片 | 低 |
| **sparse-set** | wolf-ecs、piecs | 快 | **低**（sparse+dense 双数组，O(1) 增删） | dense 数组好 | 中 | 中 | 低 |
| **SoA / TypedArray** | bitECS、becsy、thyseus、koota(schema trait) | **最快**（并行 typed 数组，零 GC，线性扫 cache line） | 中 | 最好 | 高 | 紧凑 | **高**（偏数值/定长 schema，string/对象字段别扭） |
| **map / OOP** | ecsy、ape-ecs、geotic | 慢（指针追逐、`Map` 遍历） | 低 | 差（对象散落堆上，cache miss） | **最低** | 高（每实体一堆对象、GC 压力） | 无（任意形状） |

> 注：archetype 与 SoA 常叠加——archetype 决定「哪些实体在一起」，SoA 决定「一个组件字段怎么排」。miniplex 是 archetype 但每实体仍是**普通 JS 对象**（AoS/对象存储），换取 DX；bitECS/becsy 把组件字段拆进 TypedArray（SoA），换取速度但牺牲数据自由度。

**为什么高性能库走 archetype/SoA、易用库走 map/对象**：SoA + 连续内存让 CPU 按 cache line 线性扫、零逐实体对象分配、无 GC 抖动，是「每帧海量实体」场景的物理上限；代价是组件必须是定长数值 schema、增删组件要迁移、代码复杂。map/对象反过来——组件就是普通对象、任意形状、增删随手改属性、类型系统天然套得上，代价是 cache 不友好、GC 压力、查询慢。**本框架「可选、够用、DX 优先」的定位天然偏后者或折中的 archetype-of-objects（miniplex 式）。**

来源：[noctjs/ecs-benchmark 方法与结果](https://github.com/noctjs/ecs-benchmark)、各库文档（下）。

---

## 二、逐库深挖（一手来源核实）

### 2.1 bitECS（NateTheGreatt/bitECS）

- **存储**：数据导向，**SoA + TypedArray**（v0.4 也支持 AoS）。实体是整数 `eid`，组件是按 `eid` 索引的数组，`Position.x[eid]`。来源：[README](https://github.com/NateTheGreatt/bitECS)。
- **API（v0.4 函数式）**：
  ```typescript
  const world = createWorld({ components: {
    Position: { x: [], y: [] },
    Velocity: { x: new Float32Array(1e5), y: new Float32Array(1e5) },
  }})
  const eid = addEntity(world)
  addComponent(world, eid, Position)
  for (const eid of query(world, [Position, Velocity])) {
    Position.x[eid] += Velocity.x[eid] * world.time.delta
  }
  ```
  经典 v0.3 API 另有 `defineComponent({ x: Types.f32 })` / `defineQuery` / `defineSystem` / `Types`。来源：[README](https://github.com/NateTheGreatt/bitECS)。
- **类型安全 & DX**：TS 原生，但组件是**并行数组**，无「实体对象」概念，类型体操集中在手动索引 `Comp.field[eid]`——**类型安全弱**（数值 SoA 天生难套结构类型），学习曲线偏数据导向思维。组件**不要求是 class**（是普通数组/TypedArray）。
- **打包**：README 自称 **`~5kb` minzipped、zero dependencies**、ESM、tree-shake 友好。来源：[README](https://github.com/NateTheGreatt/bitECS)。
- **node/无 DOM**：纯数据，天然 node 可跑（README 示例用 `setInterval`）。
- **性能**：**最快梯队**。[noctjs/ecs-benchmark](https://github.com/noctjs/ecs-benchmark)：packed iteration **335,064 ops**、fragmented **431,207 ops**（仅次于 wolf-ecs）。
- **维护**：MPL-2.0，约 **1.5k stars**，npm `dist-tags.latest` = **0.4.0**（[registry](https://registry.npmjs.org/bitecs)）；v0.4 是一次[非平凡重写](https://github.com/NateTheGreatt/bitECS/blob/main/docs/RELEASE_NOTES_0.4.0.md)（API 变了，v0.3 是长期使用的稳定版）。
- **跨 bundle 身份风险**：v0.3 `defineComponent` 返回**模块级对象**作为查询 key → 跨 bundle 复制会分裂（同 class identity 隐患，ADR-0001）。v0.4 把组件塞进 `createWorld({components})` **世界内**，身份随 world 走、缓解此问题，但共享组件仍需靠约定。

### 2.2 miniplex（hmans/miniplex）

- **存储**：**archetype 查询 + 普通 JS 对象**（对象存储，非 TypedArray）。实体就是普通对象，组件是它的属性。来源：[README](https://github.com/hmans/miniplex)。
- **API**：
  ```typescript
  type Entity = { position: { x: number; y: number }; velocity?: { x: number; y: number } }
  const world = new World<Entity>()
  const entity = world.add({ position: { x: 0, y: 0 }, velocity: { x: 10, y: 0 } })
  const moving = world.with("position", "velocity")     // archetype
  for (const { position, velocity } of moving) {
    position.x += velocity.x; position.y += velocity.y
  }
  ```
  另有 `world.without()` / `world.where()` / `addComponent` / `removeComponent` / `onEntityAdded`。来源：[README](https://github.com/hmans/miniplex)。
- **类型安全 & DX**：**本梯队最佳**。「Written in TypeScript, for TypeScript」，整个世界由**一个 `Entity` 类型**描述，组件是可选属性，编辑期/编译期全类型提示。组件是**普通对象（甚至可以是 class 实例）**，**不要求 class**。**无泛型体操**——`world.with("position")` 直接收窄类型。来源：[README](https://github.com/hmans/miniplex)。
- **系统调度**：**故意不内置 system**——「write simple functions, integrate with your own scheduler」。来源：[README](https://github.com/hmans/miniplex)。← 正好交给本仓自己的 update 循环 / DI。
- **打包**：MIT，README 标 "tiny"（bundlephobia 徽章）。React glue 拆成独立包 `miniplex-react`（vanilla 核心零 React 依赖）。来源：[Miniplex 2.0.0 讨论](https://github.com/hmans/miniplex/discussions/300)。
- **node/无 DOM**：框架无关，任意 JS 环境可跑，vanilla 包零 DOM 依赖。
- **性能**：**中游**。[noctjs/ecs-benchmark](https://github.com/noctjs/ecs-benchmark)：packed **109,296 ops**、simple iteration **36,316 ops**（约为 bitecs 的 1/3）。对「数百–数千实体的可选模块」足够。
- **维护**：MIT，约 **1.0k stars**，npm latest = **2.0.0**（[registry](https://registry.npmjs.org/miniplex)），2.0 是[完整重写](https://github.com/hmans/miniplex/discussions/300)。
- **跨 bundle 身份风险**：**组件用字符串 key 标识**（`"position"`），**不靠 class/构造函数身份**——字符串跨 bundle 天然稳定，**正对 ADR-0001 的胃口**（该 ADR 推荐 `Symbol.for()`/稳定字符串）。**本梯队唯一无 identity 隐患者。**

### 2.3 becsy（LastOliveGames/becsy）

- **存储**：**SoA / TypedArray（ArrayBuffer）**，三种策略 `sparse` / `packed` / `compact`；支持 **SharedArrayBuffer 多线程**。来源：[components 文档](https://lastolivegames.github.io/becsy/guide/architecture/components)。
- **API（装饰器 + class）**：
  ```typescript
  @component class Position {
    @field.float64.vector(['x','y','z']) declare location: [number, number, number];
  }
  @system class MovementSystem {
    query = this.query(q => q.using(Position).write);
    execute() { for (const e of this.query.current) { e.write(Position).location.x += 1; } }
  }
  world.build(sys => sys.createEntity(Position, { location: [10,20,30] }));
  ```
  来源：[components 文档](https://lastolivegames.github.io/becsy/guide/architecture/components)。
- **类型安全 & DX**：TS，但**重装饰器 + `declare` 字段 + typed field schema**，仪式感重、组件**强制 class**。
- **多线程**：卖点，但依赖 **SharedArrayBuffer → 需 COOP/COEP 跨源隔离响应头**，Web/小游戏平台普遍受限，**在 Cocos 全平台落地成本高**。
- **打包**：MIT，`@lastolivegames/becsy`，偏重。node 可跑（Node 支持 SharedArrayBuffer）。
- **性能**：单线程 [noctjs](https://github.com/noctjs/ecs-benchmark)：packed **103,417 ops**、fragmented **61,296 ops**（对象梯队，多线程收益不体现在单线程 bench）。
- **维护**：MIT，约 **297 stars**，npm latest = **0.15.5**（[registry](https://registry.npmjs.org/@lastolivegames/becsy)）。
- **跨 bundle 身份风险**：**class + 装饰器元数据** → 双重踩 ADR-0001（class identity）+ cc-di-survey 记的**装饰器在 Cocos 的坑**（3.3.x 构造函数装饰器 SyntaxError、`reflect-metadata` 不利 tree-shake）。**与本仓「砍装饰器」取向相冲。**

### 2.4 koota（pmndrs/koota）

- **存储**：schema trait 用 **SoA**，callback trait 用 **AoS**。来源：[README](https://github.com/pmndrs/koota)。
- **API（trait 工厂，无 class）**：
  ```typescript
  const Position = trait({ x: 0, y: 0 })            // schema trait
  const Mesh = trait(() => new THREE.Mesh())        // callback trait
  const player = world.spawn(Position, Velocity)
  world.query(Position, Velocity).updateEach(([position, velocity]) => {
    position.x += velocity.x * delta
  })
  const ChildOf = relation()                        // 关系
  ```
  来源：[README](https://github.com/pmndrs/koota)。
- **类型安全 & DX**：全 TS 泛型，DX 好；trait 由工厂定义（近似 token）。**不要求 class**（`trait()` 工厂）。带 React hooks（`useQuery`/`useTrait`/`WorldProvider`），但**核心 vanilla 可脱 React**。
- **打包**：ISC，ESM、tree-shake 支持；node 可跑。来源：[README](https://github.com/pmndrs/koota)。
- **性能**：定位「performant real-time state management for games and XR」，但**太新、未进 noctjs 基准**，暂无第三方一手数字；pmndrs 背书 + SoA 底子。
- **维护**：ISC，约 **706 stars**，npm latest = **0.6.6**（[registry](https://registry.npmjs.org/koota)）；**pre-1.0，API 仍在动**，pmndrs 活跃。
- **跨 bundle 身份风险**：trait 由 `trait()` 返回的**模块级对象**作身份 → 与 bitecs v0.3 组件对象 / class identity 同类隐患，需靠共享注册表或「每 feature 自带 trait」约定收敛。

### 2.5 @esengine/ecs-framework

- **存储**：文档未明说底层（有 reactive query + `Matcher`，疑似位掩码/组件匹配）。来源：[README](https://github.com/esengine/ecs-framework)。
- **API（装饰器 + class）**：`@ECSComponent('Position') class Position extends Component`、`@ECSSystem(...) class ... extends EntitySystem`，核心 `Core`/`Scene`/`Entity`/`Matcher`/`Time`。来源：[README](https://github.com/esengine/ecs-framework)。
- **最大卖点**：**显式为 Cocos Creator 2.x/3.x + Laya 设计**（还兼 Phaser/PixiJS/纯 JS），CLI 自动识别 Cocos/Laya/Node 工程类型。中文社区（README_CN）。← 五个候选里**唯一为 Cocos 而生**。
- **类型安全 & DX**：TS + 装饰器 + class 继承范式。
- **维护**：MIT，约 **899 stars**，npm latest = **2.11.1**（[registry](https://registry.npmjs.org/@esengine/ecs-framework)），活跃。无公开 benchmark 数字。
- **跨 bundle 身份风险**：**class 继承 + 装饰器** → 同踩 ADR-0001 + 装饰器坑。**唯一缓解点**：`@ECSComponent('Position')` 带**显式字符串名**，若框架以该名（而非 class identity）为键，则 identity 可控——**需 cross-check 源码确认**（未在本轮核实）。

### 2.6 略提（过时/玩具/niche，一句话带过）

- **ecsy**（Mozilla/PlayCanvas 系）：map 式、易用性的老参照，**已停更**，别选。
- **ape-ecs**：map/对象、功能全（refs/序列化），维护放缓，基准中偏慢。
- **geotic**：小巧对象式、受 ape-ecs 启发，业余规模。
- **wolf-ecs**：sparse-set + 位掩码，[noctjs](https://github.com/noctjs/ecs-benchmark) **packed 最快（378,471 ops）、fragmented 535,362**，但**实验性、文档/DX 差、维护稀**。
- **piecs**：sparse-set，基准 packed 364,652，niche。
- **tick-knock**：小型 TS ECS、class 式，活跃度低。
- **javelin**：偏多人网络同步 ECS，较重、维护放缓（[noctjs](https://github.com/noctjs/ecs-benchmark) packed 65,990）。
- **thyseus**：Bevy 风、SoA archetype + SharedArrayBuffer、class+schema 组件，有野心但 niche、活跃度一般，多线程同 becsy 的跨源隔离约束。

---

## 三、benchmark 一手数字（noctjs/ecs-benchmark）

来源：[noctjs/ecs-benchmark](https://github.com/noctjs/ecs-benchmark)（Node v17.8.0；作者注**「run-to-run 方差 1–4%，差几个百分点视为等同」**）。摘录（ops/sec，越高越快）：

| 库 | 存储 | packed iteration (5 queries) | fragmented iteration | 备注 |
|---|---|---|---|---|
| wolf-ecs | sparse-set | **378,471** | 535,362 | 最快但玩具级 |
| piecs | sparse-set | 364,652 | — | (entity cycle 64,075) |
| **bitecs** | SoA | **335,064** | 431,207 | 生产级最快梯队 |
| **miniplex** | archetype/对象 | **109,296** | — | (simple 36,316) |
| **becsy** | SoA | 103,417 | 61,296 | 单线程；多线程收益不在此 |
| javelin-ecs | — | 65,990 | 121,207 | |

> koota、thyseus、@esengine **未进该基准**，无第三方一手数字。数字只表**梯队**（SoA/sparse-set 第一梯队 ≫ 对象梯队约 3–5×），非绝对；且用的是各库当时版本（bitecs/miniplex 为旧版本）。对本框架「数百–数千实体、可选模块」，**对象梯队（miniplex ~10 万 ops/帧级迭代）绰绰有余**。

---

## 四、结论与建议（按 2026-07-28 新定位）

### 4.1 选型：bitECS（定案）

新定位下（性能优先 · 逻辑不跨 bundle · 独立扩展包 · 后续接寻路/碰撞/ORCA），bitECS 逐条命中：

1. **性能最快梯队**：SoA + TypedArray、零 GC、连续内存线性扫（§三，packed 335,064 ops，约对象梯队 3×）。浏览器 CPU 预算紧 + 后续 ORCA/碰撞/寻路每帧大量 agent 数值密集——SoA 正是这类系统的物理最优布局，`Comp.x[eid]` 在此不是别扭、是正解。
2. **跨 bundle 顾虑消解**：ECS 游戏逻辑不跨 bundle → 组件定义同 bundle 内、identity 天然一致，之前给 bitECS 扣的「模块级对象 identity 分裂」分作废。v0.4 组件随 `createWorld({components})` 走，进一步把身份收在 world 内。
3. **体积小、零依赖、ESM**：~5kb minzipped、tree-shake 友好（§2.1），适合作可选扩展包按需引入。
4. **纯 TS、node 可测**：纯数据结构，天然 node/vitest 直接测（虽不进 core，仍守「逻辑可脱引擎测」）。
5. DX/类型安全弱是已知代价，但对「寻路/碰撞/ORCA 这类数值系统」影响小（它们本就在数组上算）；上层业务若要更友好的实体视图，可在扩展包内加薄 helper。

**放弃 miniplex 的原因**：它的两大优势在新前提下贬值——string-key 免 identity 顾虑（identity 顾虑已因「不跨 bundle」消失）、对象式 DX（AoS 恰恰挡了 ORCA/碰撞要的 SoA 性能）。miniplex 仍是「纯逻辑建模、数百实体、DX 优先」场景的更优解，但那不是本模块的定位。

### 4.2 集成形态：独立扩展包 `@cck/ecs-bitecs`（定案）

- **包**：`packages/ecs-bitecs`（npm name `@cck/ecs-bitecs`——npm 包名须小写，沿用 `@cck/core`·`@cck/engine` 惯例；目录同名小写）。
- **一站式**：包内含 bitECS 依赖 + kit 接入胶水（经 kit 的 DI / 生命周期 / bundle 接入点挂载）。**项目要用 ECS 只加这一个依赖**，不直接碰 bitECS，也不改 core。
- **范例价值**：这个「第三方库 + kit 接入点」的封装本身就是样板——示范「外部高性能能力如何接入 creator-core-kit」。
- **不 vendor 内嵌**：直接 npm 依赖 bitECS；逻辑不跨 bundle 后无需改其身份机制，vendor 无收益。
- **demo**：`apps/demo` 加一个能压性能的 ECS 场景（大量 agent 移动），后续 寻路 → 碰撞 → ORCA 逐个增量接，每接一个即一份「高性能系统接入 kit」样板。

### 4.3 待拍板 / 已定

| 编号 | 项 | 结论 |
|---|---|---|
| Q1 | 选哪个库 | **bitECS（定案，性能优先）** |
| Q2 | bitECS 大版本 | **待定**：v0.4（latest、组件随 world 贴合封装、面向未来）／v0.3（长期稳定、第三方寻路/碰撞/ORCA 集成示例多为 v0.3 写法、做「范例」更好照抄）。**倾向 v0.3**（范例要稳+能抄）。 |
| Q3 | 集成形态 | **独立扩展包 `@cck/ecs-bitecs`，一站式、不进 core（定案）** |
| Q4 | system 调度 | bitECS 无强制内置调度；扩展包内自定义 update 序列 + kit 生命周期驱动（倾向） |
| Q5 | demo 玩法 | 大量 agent 移动起步，增量接 寻路/碰撞/ORCA；具体玩法（群体避障/弹幕/RTS 小兵）待定 |

拍板 Q2 后：出 `packages/ecs-bitecs/docs/modules/ecs.md`（定稿含最终 API + kit 接入点 + 测试计划）→ TDD/实现。

---

## 来源清单（一手）

- bitECS：<https://github.com/NateTheGreatt/bitECS> ；v0.4 release notes <https://github.com/NateTheGreatt/bitECS/blob/main/docs/RELEASE_NOTES_0.4.0.md> ；npm <https://registry.npmjs.org/bitecs>
- miniplex：<https://github.com/hmans/miniplex> ；2.0.0 讨论 <https://github.com/hmans/miniplex/discussions/300> ；npm <https://registry.npmjs.org/miniplex>
- becsy：<https://github.com/LastOliveGames/becsy> ；components 文档 <https://lastolivegames.github.io/becsy/guide/architecture/components> ；npm <https://registry.npmjs.org/@lastolivegames/becsy>
- koota：<https://github.com/pmndrs/koota> ；npm <https://registry.npmjs.org/koota>
- @esengine/ecs-framework：<https://github.com/esengine/ecs-framework> ；npm <https://registry.npmjs.org/@esengine/ecs-framework>
- benchmark：noctjs/ecs-benchmark <https://github.com/noctjs/ecs-benchmark>
- 内部依据：`docs/adr/0001-cross-bundle-singleton-and-aot-hotupdate.md`、`docs/research/2026-07-27-cc-di-survey.md`（装饰器在 Cocos 的坑 + token 用 Symbol.for/稳定字符串）

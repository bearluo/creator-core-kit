---
模块: spatial
所在包: packages/ecs-bitecs
状态: 已定稿          # 草案 → 评审中 → 已定稿 → 已实现
摘要: 给 @cck/ecs-bitecs 接「大量圆形实体涌向玩家」(肉鸽/幸存者/bullet-heaven)的高性能 system 组:空间哈希基座 + seek/flow field 寻路 + 圆-圆碰撞硬推开 + boids 分离。全是几十行 hand-roll 纯数值、直接吃 bitECS SoA、node 可测、无第三方/无 WASM/无 SAB。ORCA 明确不做。
何时读: 要给 mass-entity(刷刷/肉鸽)接寻路/碰撞/避让 system、或质疑「要不要上物理引擎/ORCA/navmesh」时。
日期: 2026-07-29
依赖: @cck/ecs-bitecs 底座(EcsWorld/EcsSystem/createEcsRunner,见 modules/ecs.md);bitECS(defineComponent/defineQuery/SoA);选型依据见 docs/research/2026-07-29-pathfinding-collision-crowd-survey.md
---

# 空间与群体运动系统(@cck/ecs-bitecs · spatial)设计文档

## TL;DR

- **是什么**:`@cck/ecs-bitecs` 内的一组**可选高性能 system**,专打「几百~几千个近似圆形实体、大多每帧朝单一目标(玩家)移动、彼此不叠成一坨」的 bullet-heaven/肉鸽场景。
- **五块**:① `SpatialHash`(均匀网格,broad-phase 基座,纯结构)② `createSeekSystem`(开阔场直奔目标)③ `FlowField` + `createFlowFollowSystem`(有墙寻路,一张场全体共享)④ `createCollisionSystem`(圆-圆检测 + 硬推开去重叠)⑤ `createSeparationSystem`(boids 分离,更自然散开)。
- **取向**:全部 **hand-roll 纯数值**、直接读写 bitECS 的 SoA 数组,**不引任何第三方**(不上物理引擎/navmesh/ORCA/yuka)——选型全过程见 [survey](../../../../docs/research/2026-07-29-pathfinding-collision-crowd-survey.md)。纯 TS、node/vitest 直测、无 WASM/无 SharedArrayBuffer,微信/抖音小游戏通吃。
- **给谁用**:做大量实体刷刷游戏的项目;同时作「高性能纯数值 system 如何接入 kit」的样板(承 ecs.md Open Questions #2)。

## Purpose(目标与定位)

- **做什么**:在 ECS 底座(`createEcsRunner` 的 `tick(dt)` 帧驱动)之上,提供 mass-entity 群体运动的可组合 system;宿主把它们塞进 runner 的 systems 数组,每帧按序跑。
- **定位**:`@cck/ecs-bitecs` 的**内部增量子模块**,不是新包;不进 core。与 ecs.md 底座的关系是**补充**(底座给 world/time/runner,本模块给具体 system)。
- **为何全 hand-roll**(survey 结论,逐条对齐决策表):目标唯一 → 一张 flow field 服务全体,比逐 agent A* 省几个量级;实体同尺寸均匀分布 → uniform grid 是最佳工况,胜 quadtree/R-tree 的自适应开销;实体近似圆 → 平方距离免开方免 SAT;swarm 涌向单目标 → 硬推开/分离即达标,**ORCA 每 agent 解线性规划是纯付费无收益**。引第三方(OOP 的 yuka、WASM 的 recast/rapier、整套物理引擎)要么与 SoA 割裂、要么小游戏有 WASM 加载风险。
- **YAGNI(首版砍)**:
  - **ORCA/RVO2** → 不做(单向 swarm 无对穿礼让需求;JS 端口 alpha/非商用/停更)。只在 Open Questions 记为「两股敌人对穿才考虑」的理论备选。
  - **per-entity 速度** → 首版 seek/flowFollow 用**统一 speed 参数**;enemy 类型多时加 `Speed{value}` 组件(标 `ponytail:`)。
  - **异形多边形 hitbox** → 只做圆(survivors 99% 是圆);真要多边形再 wrap `detect-collisions`。
  - **flow field 每帧重建** → 不做;`field.build()` 由宿主在玩家跨格/每 N 帧时调一次(摊薄)。
  - **分帧/时间片预算** → 首版全量每帧跑;只暴露 `cellSize`/`strength` 等 knob,压测真上千再谈 interleave。
  - **渲染同步/真机** → `Position→cc.Node` 归 engine/`apps/demo`,本模块纯逻辑不涉 cc(承 ecs.md Minors)。

## Public API(TypeScript 精确签名)

> 均从 `@cck/ecs-bitecs` 导出。`SpatialHash`/`FlowField` 是**不依赖 bitECS 的纯结构**(可脱 ECS 复用、独立单测);`create*System` 返回 `EcsSystem`,读写下列**包内规范组件**。

```ts
import type { EcsWorld, EcsSystem } from './world'

// ---- 规范组件(bitECS defineComponent;系统直接读写。项目可用,或抄 ~20 行自定义) ----
export const Position: { x: Float32Array; y: Float32Array }  // 世界坐标
export const Velocity: { x: Float32Array; y: Float32Array }  // 每秒速度(秒制,对齐 world.time.delta)
export const Circle:   { r: Float32Array }                   // 碰撞/分离半径
export const Seeker: Record<string, never>                   // tag:标记「会朝目标移动」的实体(seek/flowFollow 只处理它)
export const Static: Record<string, never>                   // tag:宿主手控/静态障碍(玩家/圆柱):碰撞不推它、分离/位移排除它

// ---- ① 空间哈希:broad-phase 基座(纯结构,均匀网格) ----
export interface SpatialHash {
  clear(): void                                         // 每帧重建前清空所有桶
  insert(id: number, x: number, y: number): void        // 实体按世界坐标落桶
  /**
   * 回调 (x,y) 半径 r 覆盖到的桶内所有 id(自身格 + 邻格,扫 ceil(r/cellSize) 圈)。
   * 粗筛:回调可能含圈外 id,narrow-phase 再精判;可能回调自身 id,调用方自行跳过。
   */
  queryNeighbors(x: number, y: number, r: number, cb: (id: number) => void): void
}
/** cellSize 建议 ≈ 2× 实体半径(均匀分布下每格常数个实体 → O(n))。 */
export function createSpatialHash(cellSize: number): SpatialHash

// ---- ③ 流场:有墙寻路(纯结构;目标唯一 → 一张场全 agent 共享 O(1) 采样) ----
export interface FlowField {
  readonly cols: number
  readonly rows: number
  /**
   * 从 targets 格做 BFS 洪泛生成整数距离场,再逐格取「距离更小的邻居」方向 → 单位向量场。
   * blocked(cx,cy)=true 的格视为墙(不参与洪泛、不可通行)。玩家跨格/每 N 帧重建一次即可。
   */
  build(targets: ReadonlyArray<readonly [number, number]>, blocked?: (cx: number, cy: number) => boolean): void
  /** 采样世界坐标 (x,y) 的流向单位向量写入 out=[dx,dy];墙/不可达/目标格 → [0,0]。 */
  dirAt(x: number, y: number, out: [number, number]): void
}
/** cols×rows 网格,格边 cellSize;世界原点 (originX,originY) 对齐格 (0,0) 角。 */
export function createFlowField(
  cols: number, rows: number, cellSize: number, originX?: number, originY?: number,
): FlowField

// ---- 系统(EcsSystem = (world) => world) ----

/** 每帧重建空间索引:hash.clear() + 遍历 Position 实体 insert。碰撞/分离的前置,应排在它们之前。 */
export function createSpatialIndexSystem(hash: SpatialHash): EcsSystem

/**
 * 开阔场 seek(覆盖写):Velocity = 单位(target-self) * v。arrive-to-ring:stopRadius 内 v=0 站定,
 * stop..arrive 线性升速,之外全速。死区不注入向心速度 → 消中心 churn(默认 0/0 = 纯 seek)。
 */
export function createSeekSystem(targetEid: number, speed: number, arriveRadius?: number, stopRadius?: number): EcsSystem
// ponytail: 统一 speed + 单 targetEid;enemy 多速度时加 Speed{value} 组件、多目标时改 Target tag 查询

/** 有墙寻路:每个 Seeker 实体 Velocity = field.dirAt(Position[eid]) * speed(覆盖写)。field 由宿主按需 build。 */
export function createFlowFollowSystem(field: FlowField, speed: number): EcsSystem

/**
 * boids 分离(叠加写):每个动态 Circle 查 hash 近邻,按距离反比累加「远离邻居」向量,Velocity += sep * strength。
 * perception>1 时 reach=(r1+r2)·perception,接触前就避让(主动维持间距,主间距担当;拧它而非 strength)。
 * 依赖同帧前置系统(seek/flowFollow)已设基础 Velocity,否则分离力会逐帧累积(见数据流)。
 */
export function createSeparationSystem(hash: SpatialHash, strength: number, perception?: number): EcsSystem

/** 位移积分:每个 Position+Velocity 实体 Position += Velocity * world.time.delta(秒制)。 */
export function movementSystem(world: EcsWorld): EcsWorld

/**
 * 硬碰撞去重叠(稀发兜底,主间距交 separation):hash 粗筛近邻对,圆-圆重叠沿法线推开(改 Position;
 * Static 方不动、动态方独吞)。iterations=每帧松弛趟数;slop=容差(重叠 ≤ slop 不推,免微抖)。
 */
export function createCollisionSystem(hash: SpatialHash, iterations?: number, slop?: number): EcsSystem
```

## Behavior & data flow(行为与数据流)

**典型一帧 pipeline**(宿主组进 `createEcsRunner(world, [...])`,每帧 `runner.tick(dt)` 按序跑):

```
spatialIndex → seek | flowFollow → separation → movement → collision
   建索引        设基础速度(覆盖)   叠分离力(+=)   积分位置      硬去重叠(改位置)
```

1. **spatialIndex**:`hash.clear()`,遍历 `Position` 实体 `hash.insert(eid, x, y)` —— 后面碰撞/分离都查这份当帧索引。
2. **seek 或 flowFollow**(项目按有无墙二选一):**覆盖写** `Velocity = dir * speed`。seek 的 `dir=normalize(玩家-自己)`(读 `Position[targetEid]`,玩家移动自动跟随);flowFollow 的 `dir=field.dirAt(pos)`。**覆盖写是关键**——它每帧重置 Velocity,使下面 separation 的叠加不跨帧累积。
3. **separation**:**叠加写** `Velocity += 分离力`。查 hash 近邻,对每个邻居按 `1/dist` 反比累加远离向量。软转向,让 swarm 散开而非挤成一条线。
4. **movement**:`Position += Velocity * dt`(秒制,`dt=world.time.delta`)。
5. **collision**:硬兜底。hash 粗筛近邻对,圆-圆重叠则沿法线**各推开 overlap/2**,直接改 `Position`(不动 Velocity)—— 保证任何两圆最终不重叠,即使 separation 没完全分开。

**去重的对称处理**:collision 里一对 (a,b) 会被 a、b 各查到一次;推开时只需保证「各推一半」的净效果正确(可用 `a<b` 去重只处理一次,或两次各推 overlap/2 但幅度减半)。实现时择一,测试验「推开后 dist ≥ r1+r2」。

**core vs engine 归属**:本模块**全是纯逻辑**(结构 + system,零 cc)。唯一引擎接触点仍是 ecs.md 已有的 `runner.tick(dt)` 接缝 + engine 侧一个把 `Position.x[eid]` 同步到 `cc.Node` 的 render system(在 demo/engine,本模块不涉)。

**组件 identity**:规范组件在本包模块级 `defineComponent` 一次、全局 SoA 唯一;ECS 逻辑不跨 bundle(用户定),identity 天然一致(同 ecs.md,ADR-0001 不适用)。

## Key design decisions(决策表)

| # | 维度 | 选项 | 推荐默认 | 一句话理由(引 survey) |
|---|---|---|---|---|
| 1 | 寻路 | 逐 agent A* / navmesh / **seek + flow field** | seek(开阔)+ flow field(有墙) | 目标唯一→一张场服务全体,比逐 A* 省几个量级;A*库停更/非SoA,navmesh WASM 小游戏有风险(§A) |
| 2 | broad-phase | O(n²) / **uniform grid** / quadtree / R-tree / 物理引擎 | uniform spatial hash | 同尺寸均匀分布是均匀网格最佳工况,胜自适应树;不引物理引擎(overkill + WASM 风险)(§B) |
| 3 | narrow-phase | **圆-圆平方距离** / AABB / SAT | 圆-圆平方距离 | 实体近似圆,免开方免 SAT(§B.2) |
| 4 | 避让 | **硬推开** / boids 分离 / ORCA | 硬推开 + boids 分离叠加 | swarm 只需不叠一坨;实测 VS 克隆与原作都只推开/不做怪-怪碰撞(§C) |
| 5 | ORCA | 做 / **不做** | 不做 | 单向 swarm 无对穿礼让需求,每 agent 解 LP 纯付费;JS 端口 alpha/非商用/停更(§C 结论) |
| 6 | 算法归属 | 纯结构 + 薄 system / 全写进 system | **纯结构(Hash/Field)+ 薄 system** | 结构脱 ECS 可复用 + 好单测,system 只做 SoA 读写 |
| 7 | 组件 | BYO / **包内规范组件** | 规范 Position/Velocity/Circle/Seeker | 系统直接读写;项目可换,copy ~20 行 |
| 8 | 速度 | **统一参数** / Speed 组件 | 统一参数(首版) | ponytail;enemy 类型多时加 Speed 组件 |
| 9 | flow field 重建 | 每帧 / **跨格按需** | 玩家跨格或每 N 帧 build 一次 | 摊薄;每帧重建浪费(§A) |

## Platform considerations(全平台 / 小游戏兼容)

- **纯 TypedArray + 普通数组**,无 `SharedArrayBuffer`/多线程/WASM → 无 COOP/COEP 约束,微信/抖音小游戏、原生、Web 通吃(这正是弃 recast/rapier/box2d-wasm 的关键落地理由,§A/§B.3)。
- **node 可测**:纯数据结构 + 纯函数 system,vitest 直接跑,不需 Creator/DOM/Canvas。
- **三种热**:随本扩展包整包版本化更新,不涉跨 bundle 组件共享。

## Testable seams + test plan(可测接缝 + vitest 用例)

- **可测性**:全模块零 `cc`;纯结构直接构造断言,system 经 `runner.tick(dt)` 注入假 dt(确定性)。
- **纯结构单测**:
  1. **SpatialHash**:insert 三点 → `queryNeighbors` 命中同格 + 邻格的、漏掉远处的;`clear()` 后查空;跨 cell 边界点归对格。
  2. **FlowField**:无墙 build 朝目标 → `dirAt` 各处指向目标格(点积 > 0);中间放一堵墙 → 墙后格方向**绕行、不穿墙**;目标格 / 墙格 / 不可达格 → `[0,0]`。
- **系统行为测**:
  3. **spatialIndexSystem**:跑后 `hash.queryNeighbors` 能查到已 insert 的实体。
  4. **seekSystem**:一个 Seeker + 一个 target 实体,tick 后 Velocity ≈ `normalize(target-pos)*speed`;非 Seeker 实体 Velocity 不变。
  5. **flowFollowSystem**:field 指向目标 → Seeker 的 Velocity 跟随场方向(与 `dirAt` 同向)。
  6. **separationSystem**:两个重叠 Circle → tick 后二者 Velocity 沿相反方向(互推);孤立实体 → Velocity 不变。
  7. **collisionSystem**:两个重叠圆 → 推开后 `dist ≥ r1+r2`(不再重叠);本不重叠的 → Position 不动。
  8. **movementSystem**:`Position += Velocity*dt`(秒制,复用 ecs.md 已验模式)。
  9. **集成 pipeline**:`[spatialIndex, seek, separation, movement, collision]` 跑 N 帧,一群 agent 朝 target 聚拢**且两两最小距离 > 0**(既追玩家又不完全重叠)。
- **覆盖率**:本包非 CI 硬门槛(coverage.include 仅 core);目标覆盖自有逻辑(结构 + 各 system 主路径 + 边界)。

## Open Questions → 评审定稿决议(2026-07-29)

1. **速度** → 首版**统一 speed 参数**(对齐「核心 MVP + 玩法后议」);enemy 类型多时再加 `Speed{value}` 组件(`ponytail:` 标升级)。
2. **flow field 重建** → **交宿主**调 `field.build`(玩家跨格/每 N 帧),不做 helper system。
3. **分帧预算** → 首版全量每帧跑,**先给 knob**(cellSize/strength),压测后再定 interleave。
4. **验证载体** → **新建独立 Cocos Creator 工程**(不在 apps/demo)承载渲染验证;具体玩法后议。
5. **墙体数据源** → 后续由项目提供 `blocked` 回调;首版**自行造墙体数据**验证 flow field 绕墙。

---

## 实现记录(2026-07-29)

- **最终 API 与设计偏差**:与设计**一致,无偏差**。5 结构/系统 + 4 组件全部落地——`src/spatial/{components,hash,flow-field,systems}.ts`,从 `@cck/ecs-bitecs` 导出。`SpatialHash`/`FlowField` 纯结构(零 bitECS import),`create*System` 返回 `EcsSystem`。flow field 用 4-邻 BFS 距离场 + 8-邻向量场(设计已注)。
- **ponytail 保留项(均标注升级路径)**:① `SpatialHash` 用 `Map<number,number[]>` 每帧重建 + 整数哈希(碰撞多筛不漏,narrow-phase 精判)→ 真上千换连续 TypedArray 桶;② `collisionSystem` 帧初索引(movement 后位置略变)+ 多趟 Gauss-Seidel 松弛(`iterations` knob)→ 残留穿透下帧修;③ flow field 8-邻向量场未防对角穿墙角;④ 统一 speed 参数 → enemy 多速度加 `Speed` 组件。
- **真机验证补出的两处改动(2026-07-29,`apps/ecs-lab` 实测暴露)**:
  1. **`d≈0` 退化 bug(真修复)**:`separation`/`collision` 旧实现用 `if (d2 > 0 && …)` **静默跳过精确重合**(法线 `(dx,dy)/d = 0/0`)→ 几百实体涌向同一点时中心对**永远推不开**。修:`d²<EPS2`(1e-6)时用 **id 哈希取确定性角度**兜底推开(确定性=可测、按 pair 变化避免整团同向平移)。补 1 用例(精确重合 tick 后 `dist≥r1+r2`)。**纯单测用温和布点没暴露,真机满速砸点才现形**——印证「留校准 knob」:极端密度是模型看不见的物理。
  2. **`collisionSystem(hash, iterations=1)` 松弛趟数 knob**:单趟对稀疏够用,密堆(几百实体压一点)残留大;调高趟数逼近无重叠。默认 1 不动既有测试。

### 中心「闪烁/churn」调查 + boids-vs-碰撞定案(2026-07-29,实测 + 调研)

`apps/ecs-lab` 实体数一多,现象:① **手控 target 闪烁跳动**;② **中心出现一整块持续抖动区**(外围赶路的不抖,只有挤在目标附近争抢同一点的那团逐帧震荡)。**根因**:seek 每帧**覆盖式全速回灌向心速度** × collision **只改位置**逐帧 snap 消重叠 → 两者对顶。配套调研见 [`docs/research/2026-07-29-swarm-separation-vs-collision.md`](../../../../docs/research/2026-07-29-swarm-separation-vs-collision.md)(Reynolds steering / PBD / RVO / continuum crowds + Vampire Survivors 类实践)。

补出 **4 个机制,全部向后兼容 knob(默认不改旧行为)**:

1. **`Static` 组件(新 tag)**:宿主手控/静态障碍(玩家、圆柱)。碰撞里**不被推、只推开动态对方**;分离/位移查询用 `Not(Static)` 排除。修「手控位置被物理系统抢写」的 target 闪烁。
2. **seek arrive-to-ring 死区**(`createSeekSystem(t, speed, arriveRadius=0, stopRadius=0)`):`stopRadius` 内 **v=0 站定**,`stop..arrive` 线性升速。关键是**死区不注入向心速度**——本管线 seek 每帧覆盖 Velocity,故「碰撞回写速度」那套**在此无效**(会被下一帧 seek 擦掉),唯有从源头停灌才消 churn。
3. **separation `perception` 半径**(`createSeparationSystem(h, strength, perception=1)`):`reach=(r1+r2)·perception`,`>1` 在**接触前**就避让 → 主动维持间距,把硬碰撞触发压到极低。
4. **collision `slop` 容差**(`createCollisionSystem(h, iterations=1, slop=0)`):重叠量 ≤ slop 不推,免密堆逐帧微抖。碰撞职责重定位为**稀发兜底**(主间距交带 perception 的 separation)。

**实测定案(800 实体,MCP 驱动读 minPair,直径 12)**:

| 配置 | minPair | avg | |
|---|---|---|---|
| boids perc1 无死区(旧) | 2.83 | 112 | 基线 |
| boids perc1.5 + 死区40 | 3.85 | 128 | 间距 +36% |
| boids perc2.0 + 死区40 | **5.06** | 139 | +79%,**单调、零过冲** |
| 稀硬 iter2+slop1 | 0.67 | 156 | **更差 + snap 抖回来** |

- **perception 是对的杠杆**(1→1.5→2 间距单调升,无过冲);**拧 strength 会过冲反更抖**(sep 60→150→300:minPair 2.83→0.27→0.23)。
- **单点 swarm 下加硬碰撞适得其反**(minPair 掉且重引 snap)——与 Vampire Survivors 怪-怪**不做碰撞**一致。**默认 = boids 主间距(seek arrive-to-ring → separation perception → movement),硬碰撞降级为可选**(lab 默认 `collisionIterations=0`)。
- 残留重叠(perc2 仍 minPair 5.06<12)是 **800 圆吸进一个盘的几何必然**;要更松调大 `stopRadius/arriveRadius` 铺开,knob 已给。

- **测试结果 / 覆盖率**:`src/spatial/__tests__/spatial.test.ts` **16 用例全绿**(+退化重合/Static/arrive/stopRadius/perception/slop)。**四门全绿**:test **385** / typecheck 0 / lint 0 / build OK(dist 41.73KB 自包含,d.ts 5.05KB)。
- **真机验证(`apps/ecs-lab`,funplay MCP 驱动已挂载组件,非预览)**:`@cck/ecs-bitecs` 在真 Cocos 脚本系统**成功解析加载**(组件挂载 + 驱动 + 数值随代码变);seek 收敛(移动 target 紧随);boids 主间距 + 死区消掉中心 churn(见上表)。
  - 注:编辑器自身的 Node CJS `require('@cck/ecs-bitecs')` 会撞 dist 的 ESM `export`(SyntaxError)——那是编辑器 CJS 加载器,**非** Cocos 游戏运行时模块系统;真解析走后者(组件成功挂载即证)。
- **commit / PR**:待授权。
- **遗留 Minors**:flow field 重建触发交宿主(决议 #2);分帧 interleave 压测(决议 #3);flow field 绕墙的真机可视化(seek 已验,flow 模式待截图);`Position→cc.Node` 正式 render system(lab 用 Graphics 直画 debug 视图,非产品渲染)。

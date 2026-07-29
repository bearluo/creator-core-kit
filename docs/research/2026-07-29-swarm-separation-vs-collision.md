---
状态: 已定稿
摘要: 针对「@cck/ecs-bitecs spatial 实测：几百实体涌向玩家时中心一团逐帧闪烁/抖动」这个具体现象，深挖「软 steering 分离(boids separation，改速度) vs 硬碰撞去重叠(position 投影，改位置)」的取舍与消抖手段，带一手来源(Reynolds / Müller-Macklin PBD·XPBD·Small Steps / Catto Box2D / van den Berg ORCA / Treuille continuum crowds / 真实 survivors 游戏)。核心结论：**中心 churn 的根因是「seek 每帧全速回灌向心速度」×「collision 每帧只投影位置、不回写速度」两者对顶的过约束**；纯 boids 天生不 snap/不闪，因为它是速度级连续力经积分+限速自然阻尼，代价是**只渐近减少重叠、永不保证零重叠**(高压 sink 处必然堆叠)。真实 survivors(VS 干脆不做怪-怪碰撞；ECS Survivors 用 push-apart **同时改 pos 和 vel**、单趟、无 ORCA)佐证「允许重叠 + 软推」才是主流。落地：**把带 perception 半径的软分离升为主间距手段、seek 用 arrive-to-ring/dead-zone、硬碰撞降级为带速度回写+限位移+容许小重叠的稀发兜底**。ORCA/continuum crowds 对单目标 swarm 仍是过度工程(呼应姊妹 survey)。
何时读: 现有 spatial pipeline 出现中心抖动/闪烁、要在 seek/separation/collision 三个 system 上调参或改结构、或质疑「能不能干脆用 boids 取代硬碰撞」时。
日期: 2026-07-29
依赖: packages/ecs-bitecs/docs/modules/spatial.md(现有 pipeline: spatialIndex→seek|flowFollow→separation→movement→collision;已加 arrive + 玩家 Static);docs/research/2026-07-29-pathfinding-collision-crowd-survey.md(上游横评,已定「硬推开+可选 boids、不做 ORCA」,本文是其「避让」一节针对实测抖动的深挖续篇);src/spatial/systems.ts(被诊断的实现)
---

# 软分离(boids) vs 硬碰撞去重叠：收敛点抖动的成因与治理

## 目的与范围

姊妹横评 [pathfinding-collision-crowd-survey](2026-07-29-pathfinding-collision-crowd-survey.md) 已定「避让首选硬推开(positional de-overlap)+ 可选 boids 分离，ORCA 不做」，spatial 模块据此落地。但 `apps/ecs-lab` 真机实测暴露一个具体病：

> **实体一多，玩家附近(收敛点)出现一块持续「闪烁/抖动」区域**——外围赶路的实体不抖，只有挤在中心争抢同一点的那团在逐帧震荡。

用户的判断(经本文核实成立)：① 每个实体无论离目标多近都**全速内挤**(seek 不减速)，与 ② 硬碰撞每帧**直接投影位置**消重叠，两者对顶 → 过约束堆逐帧投影 = 视觉闪烁。已加的缓解：`arrive`(到达减速，`arriveRadius`)+ 把玩家设 `Static`(不被推)。用户问：**能不能干脆用 boids/flocking 取代硬碰撞来维持间距？**

本文只回答这一个避让子问题，比上游 survey 深一层：**软 steering 分离 vs 硬碰撞去重叠的机理级取舍、jitter 成因与成熟消除手段、PBD/XPBD 的启示、真实 survivors 游戏到底怎么做**，落到 `@cck/ecs-bitecs` 现有三个 system(`createSeekSystem` / `createSeparationSystem` / `createCollisionSystem`) 的具体参数与结构建议。约束不变：**bitECS SoA、纯 TS node 可测、无 WASM/无 SharedArrayBuffer、单目标 swarm、不引第三方库**。

---

## TL;DR(结论先行)

1. **别二选一，用「主软 + 稀硬」分层。** 纯 boids 分离(改速度)天生不 snap、不闪，但**只渐近减少重叠、永不保证零重叠**——在玩家这种高压 sink，向心力超过分离力，实体必然堆叠(允许多少重叠取决于力配比)。纯硬碰撞(改位置)保证不重叠，但在过约束堆里逐帧投影 = 闪烁。**正解是软分离当主力维持间距、硬碰撞降级为稀发兜底**。

2. **中心 churn 的真正根因是「速度与位置在打架」，不是碰撞本身。** 现 pipeline 里 `seek` 每帧**覆盖写**全速向心 Velocity，`collision` 每帧**只改 Position、绝不碰 Velocity**——被推开的实体下一帧仍带满速内灌速度，积分又冲回，再被投影推出……逐帧循环即闪烁。这是**位置投影不回写速度**的经典 PBD 反面教材(见 §三)。

3. **消抖最有效的 3 个手段**(按性价比排)：
   - **① seek 侧 arrive-to-ring / dead-zone**：不是「减速到一个点」，而是「在玩家外一圈半径就停止内挤」——从源头撤掉向心压强(研究明确：多个 agent 想同时「arrive 到单点 + 分离」必然不稳，改成「arrive 到一个半径/环」即解 [howtorts/steering 社区共识])。
   - **② 碰撞投影回写速度(PBD 式)**：de-overlap 改位置的同时，把修正量按 `Δx/dt` 反映到 Velocity(或至少扣掉法向内灌分量)——让位置修正和速度不再对顶。**真实 VS 克隆 ECS Survivors 正是同时改 pos 和 vel**(见 §五)。
   - **③ 软分离给足 perception 半径 + 容许小重叠**：让实体在**接触前**就开始互让(现实现只在已重叠时才推，等于没有预避让，见 §一诊断)，把硬碰撞的触发频率压到极低。

4. **真实 survivors 的做法**：Vampire Survivors **怪-怪根本不做碰撞**(boss 除外)，靠数量淹没视觉；ECS Survivors(Flecs 版 VS 克隆)做 **push-apart de-overlap，同时改 pos+vel、各让一半、单趟、无 ORCA/无 boids/无多迭代**。两者共同点：**允许重叠或只软推，绝不每帧硬 snap-to-非重叠**。这直接支持我们「硬碰撞降级/容许小重叠」。

5. **一句话建议**：默认 pipeline 保持 `spatialIndex → seek(改 arrive-to-ring)→ separation(给 perception 半径、升为主间距)→ movement → collision(降级：容许小重叠 + 限单帧位移 + 速度回写、`iterations=1`)`；**boids 为主、硬碰撞为兜底**，别指望硬碰撞在 sink 处每帧压到零重叠——那正是闪烁之源。

---

## 一、软 steering 分离 vs 硬碰撞去重叠：机理横评

| 维度 | **软分离 (boids separation)** | **硬碰撞去重叠 (positional de-overlap)** |
|---|---|---|
| 改什么 | **速度**(`Velocity += 分离力`)，下游 movement 才积分成位置 | **位置**(`Position ±= 法向×overlap/2`)，直接搬 |
| 连续性 | **C0/C1 连续**：力→加速度→速度→位置，逐层积分平滑；限速(max speed)钳制天然当阻尼器 | **位置有跳变**：每帧 snap 到非重叠构型，过约束时构型逐帧跳 = 视觉闪烁 |
| 会不会 snap/闪 | **天生不 snap**：没有位置层的离散修正，无从产生逐帧跳变 | 稀疏场不闪；**密堆(涌向单点)过约束 → 逐帧投影震荡** |
| 重叠保证 | **无**：只渐近把重叠往下压；sink 处向心力>分离力时**允许无界堆叠** | **有**(单趟近似、多趟逼近)：硬保证任意两圆最终 `d ≥ r1+r2` |
| 成本 | O(近邻)，复用空间索引；只累加向量 | O(碰撞对)，复用索引；密堆要多趟松弛才收敛，趟数↑成本↑ |
| 参数敏感度 | 中：`strength/perception/dt` 配不好会 overshoot 或散不开 | 高：满速恒定 seek 砸静点 + 强 collision 会外胀成「大而不叠的云」(lab 实测已记 spatial.md) |
| 本质 | Reynolds steering：**期望速度 - 当前速度 = 转向力**，`acceleration = force/mass`，靠限速收敛 [Reynolds GDC99] | 约束投影：把违反 `非穿透` 约束的位置直接拉回可行域(Gauss-Seidel 逐对松弛) |

**为什么纯 boids 天生不 snap、不闪**：Reynolds 的 steering 是**速度级连续控制**——分离对每个近邻算「远离方向 × 按距离衰减的幅度」累加成转向力，转向力经 `acceleration = steering_force / mass` 变加速度、积分进速度、再被 `max_speed` 钳制([Reynolds, *Steering Behaviors For Autonomous Characters*, GDC99](https://www.red3d.com/cwr/steer/gdc99/))。整条链没有任何「把位置瞬间搬到某处」的离散步骤，限速本身充当阻尼，所以运动是平滑的、不会逐帧跳。

**代价——允许多少重叠**：正因为它从不强制位置，boids **只能渐近地把重叠压小，永远给不出「零重叠」保证**。在玩家这种所有实体都往里涌的 sink，向心 seek 力是恒定输入、分离力随重叠增大而增大，两者在某个重叠量达到平衡——**这个平衡重叠量就是你要付的代价**，force 配比越偏向 seek，中心叠得越狠(极端就是叠成一坨)。这不是 bug，是软方法的定义性权衡：**用「不保证间距」换「绝不闪烁」**。

**诊断我们当前的实现(两处关键，直接对上病灶)**：

1. **`createSeparationSystem` 没有 perception 半径——它只在「已经重叠」时才推。** 代码里查近邻后的判据是 `if (d2 < rr * rr)`(`rr = er + Circle.r[other]` = 半径和)，即**两圆已经相交才施力**。这不是 Reynolds 的分离(分离应有个**大于接触距离**的感知半径，在碰上之前就开始互让)，而是**硬碰撞的软版本**——作用条件与 collision 完全同域。后果：实体一路全速冲到贴脸才第一次感到分离，没有「接触前平滑让开」的缓冲，等于把所有间距活儿都堆给了下游硬碰撞。**这是中心特别爱抖的结构性原因之一。**

2. **`createCollisionSystem` 只改 Position、从不碰 Velocity。** 而 `createSeekSystem` 每帧**覆盖写** `Velocity = normalize(target-pos) × speed`(满速向心)。于是：collision 把实体沿法向推出 → 下一帧 seek 无视这次推开、再次覆盖成满速内灌 → movement 积分冲回原位 → collision 再推出……**位置修正与速度输入逐帧对顶**。这正是用户判断的「两者对顶」，而且比他说的更精确：**问题核心是投影不回写速度**(见 §三 PBD)。

> 小结：现实现里「separation 退化成只在重叠时推」+「collision 不回写速度」两点叠加，把本该由软分离在接触前化解的压力，全部压成了 sink 处每帧的硬投影震荡。修这两点比在软/硬之间二选一更对症。

---

## 二、jitter/churn 成因与成熟消除手段

### 2.1 成因链(密堆抖动 = 过约束 + 离散投影 + 速度错配)

```
seek 恒定满速向心(输入不减)
   └→ 所有实体挤向同一点 → 局部约束数 ≫ 自由度(过约束/over-constrained)
         └→ collision 每帧把位置投影回非重叠(离散、不回写速度)
               └→ 下帧 seek 再灌满速内向速度 → 冲回 → 再投影
                     └→ 构型逐帧在几个近似解之间跳 = 中心闪烁
```

外围不抖是因为那里约束稀疏(每个实体邻居少)、单趟投影一次到位、且向心速度还没被「墙」顶住；只有 sink 处约束密度爆炸才显形。

### 2.2 消除手段横评(哪些对「密堆抖动」真有效)

| 手段 | 出处 | 机理 | 对**密堆 churn** 有效性 | 我们用不用 |
|---|---|---|---|---|
| **Arrive / arrive-to-ring**(到达减速，甚至到一个半径就停) | [Reynolds GDC99](https://www.red3d.com/cwr/steer/gdc99/);「arrive 到单点+分离必不稳，改 arrive 到半径」是社区共识 | 从**源头撤掉向心压强**：sink 处输入力↓→过约束程度↓ | **最高**：不治标治本，压强没了就不用硬投影去顶 | **要**(现有 arrive 升级为 ring/dead-zone) |
| **投影回写速度 (PBD velocity update)** | [Müller PBD 2007];ECS Survivors 实战 | de-overlap 后 `v ← (x_new-x_old)/dt`，让位置修正与速度一致，不再对顶 | **最高**：直接消掉「投影vs速度打架」这条根因 | **要**(collision 补速度回写) |
| **软分离给 perception 半径 + 平滑 falloff** | [Reynolds GDC99] | 接触前就互让，把硬碰撞触发频率压到极低 | **高**：减少硬投影发生次数 | **要**(separation 加感知半径) |
| **容许小重叠 (slop / 不追零重叠)** | [Catto, Box2D];真实 VS/ECS Survivors | 给约束留一个松弛量，重叠 < slop 就不动 → 消除「为最后 1px 反复投影」 | **高**：churn 常来自追求精确零重叠 | **要**(collision 加 `slop`) |
| **限制单帧位移 (clamp correction)** | 物理引擎通用(max linear correction) | 每帧最多推 `maxΔ`，把大跳变摊成几帧 → 无大 snap | **中高**：把闪烁幅度直接压小 | **要**(collision 加位移上限) |
| **速度阻尼 / 摩擦 (damping)** | [Reynolds];[Catto 软约束=mass-spring-damper] | 残余分离/碰撞能量逐帧衰减，而非无损来回弹 | **中**：抑制 ring/overshoot | **可选**(轻微全局 damping) |
| **软约束 (soft constraint, 指定频率+阻尼比)** | [Catto, *Soft Constraints*, GDC](https://box2d.org/publications/) | 把硬非穿透换成弹簧-阻尼(Baumgarte 的进化)，按 Hz+阻尼比调，天然不硬 snap | **中**：本质是「把硬碰撞软化」，与软分离殊途同归 | 借思想(我们的软分离≈其平替) |
| **子步 substepping ＞ 多迭代** | [Macklin et al, *Small Steps in Physics Simulation*, 2019](https://mmacklin.com/smallsteps.pdf) | **n 个 Δt/n 子步各 1 次投影 比 1 大步 n 次迭代更稳**、约束误差与阻尼都更小 | **中**：若必须硬压零重叠，子步优于堆迭代 | 记为**上限手段**(先别做，压不住再上) |
| **Warm-starting**(用上帧冲量作本帧初值) | [Catto, *Sequential Impulses*, GDC06](https://box2d.org/publications/) | 堆叠场景收敛更快更稳，减少迭代内抖 | **中**：主要提速+稳堆，需存 per-pair 状态 | 暂不(增状态，收益不抵复杂度) |
| **确定性求解顺序 + 对称分摊** | Gauss-Seidel 惯例;[Catto] | 固定 pair 处理序、各推一半 → 不引入方向偏置、结果可复现 | **中**：减少无序带来的额外 churn | **已有**(现 collision `other<=e` 跳过=`a<b` 去重 + `/2` 对称) |
| **Sleeping / deactivation**(净位移 < ε 的实体休眠) | [Catto, Box2D 有 sleeping] | 已 settle 的实体跳过碰撞，不再被微扰动唤醒来回推 | **中**：减 churn 兼省算力，但 sink 处实体一直在动、休眠命中率低 | 可选(外围收益大、sink 处不灵) |

**读表要点**：真正治**密堆 churn** 的是**前四行**——它们要么撤压强(arrive-to-ring)、要么消对顶(速度回写)、要么减触发(perception 分离)、要么去精确性洁癖(容许 slop)。后面的 substepping/warm-starting/sleeping 是物理引擎为「精确稳定堆叠」准备的重武器，我们这种「允许叠、只要别闪」的小游戏用不到那么重(YAGNI，先上前四行)。

---

## 三、PBD / XPBD：为什么「约束迭代 + 速度回写」比「每帧硬 snap」稳

[Position Based Dynamics(Müller, Heidelberger, Hennix, Ratcliff, 2007)](https://matthias-research.github.io/pages/publications/posBasedDyn.pdf) 的核心循环，和我们「每帧硬 snap 位置」的**关键差别就在最后一步**：

```
PBD 一帧:
  1. 预测位置  x_pred = x + v·dt              (先按速度积分)
  2. 投影约束  x* = solveConstraints(x_pred)   (Gauss-Seidel 逐约束把位置拉回可行域，可多次迭代)
  3. 速度回写  v ← (x* - x) / dt   ; x ← x*     ← 关键！位置怎么被改的，速度就怎么更新
```

我们现在的 `collision` 做了第 2 步(投影)、**漏了第 3 步(速度回写)**，而 `seek` 又在下一帧第 1 步之前把速度**整个覆盖**成满速向心——等于每帧都把 PBD 辛苦算出的「一致速度」丢掉、重灌一个与约束对着干的速度。**这就是闪烁的机理级根因**。PBD 之所以对「大量圆盘稳定堆叠」稳，正是因为它**让速度始终等于位置实际的变化率**，位置修正不会和速度打架；再叠 XPBD 的 compliance 让「软硬」可按物理量(而非迭代次数)调，堆叠不会因迭代数变化而忽软忽硬([XPBD: Macklin, Müller, Chentanez, 2016](https://matthias-research.github.io/pages/publications/XPBD.pdf))。

**值不值得为此引 PBD/XPBD 库**：**不值，但要借它两条思想**。理由同姊妹 survey——引整套约束求解器(或物理引擎)对「圆-圆 + 单目标 swarm」是过度工程，且我们要的不是精确刚体堆叠而是「别闪」。要落地的只有两行思想：**(a) 投影后回写速度**(§二第 2 行)、**(b) 容许一点 compliance/slop 而非追求硬零重叠**(§二第 4 行)——这两条各是几行代码，直接加进现有 `collisionSystem`，无需库。[Small Steps](https://mmacklin.com/smallsteps.pdf) 的「子步 > 多迭代」留作**万一软化后仍压不住**时的上限手段。

---

## 四、RVO / ORCA / continuum crowds / density：为什么单目标 swarm 可以不用

这些是「群体避让」的重武器，姊妹 survey 已定「不做 ORCA」，此处只补清它们各解决什么、以及为何我们这个场景可以不碰(诚实说清边界)：

| 方案 | 解决的问题 | 机理 | 对「单目标 swarm」为何过度 |
|---|---|---|---|
| **RVO → ORCA** [van den Berg et al.](https://gamma.cs.unc.edu/ORCA/) | **双向/多向人流互相礼让、不抖动地穿行** | 每 agent 对每个邻居构造速度障碍→ORCA 半平面，解一个**低维线性规划**求最近可行速度；「各担一半责任」且**证明无振荡**(修好了纯 RVO 的「reciprocal dance」互让抖动) | 我们是**单向**涌向一个点，没有「对穿谁让谁」的博弈；ORCA 每 agent 每帧解 LP 是为化解对穿抖动付的费，我们这里**既无对穿、收益为零，成本全付**;JS 端口还是 alpha/非商用/停更(见姊妹 survey §C) |
| **Continuum Crowds** [Treuille, Cooper, Popović, SIGGRAPH 2006](https://grail.cs.washington.edu/projects/crowd-flows/continuum-crowds.pdf) | **超大稠密人群**的整体流动 | 把人群当连续介质，用一个**动态势场**同时编码全局导航+动态避让，**无需显式的逐对碰撞避让**，人群自然分流 | 架构是**网格上解 PDE**的重家伙，为「成千上万、稠密、要真实人群美学」设计;我们几百~几千、只要「别闪」，杀鸡用牛刀。**但它给了一条哲学佐证**:稠密群体用「共享场 + 密度压强」就能免掉逐对碰撞 churn——这**正是我们「flow field(共享场)+ 允许重叠」在小尺度上的同款思路** |
| **density / pressure 模型** | 稠密处减速、稀疏处加速，避免对穿踩踏 | 用局部密度调制期望速度 | 对我们是「加分项」而非必需:真要更顺，可在 seek 里让「前方密度高就减速」——但那本质又回到 arrive/减压强这条线，先做 arrive-to-ring 即可 |

**结论**：三者都在解「**智能体之间要聪明地互相避让/不踩踏**」，而我们的敌人只需要「**别叠成一坨地涌向玩家**」——低了一个数量级的需求。**continuum crowds 的势场思想我们其实已经在用**(flow field 就是共享势场)；ORCA 的对穿礼让我们不需要。维持「不做 ORCA、不上 continuum solver」。

---

## 五、真实 survivors 游戏怎么做(最关键的实践证据)

这条直接决定我们默认要不要硬碰撞。证据一致指向**「允许重叠 / 只软推 / 绝不每帧硬 snap-to-非重叠」**：

| 游戏 / 实现 | 怪-怪之间到底做什么 | 一手依据 |
|---|---|---|
| **Vampire Survivors**(原作,Luca Galante/poncle) | **怪-怪根本不做碰撞**(boss 除外);2D 轴对齐矩形 hitbox,靠海量涌入的视觉盖过重叠。也有社区把「上千敌人**互相**碰撞、蝙蝠潮把狼人推向玩家」当作其观感核心——即便如此,其做法也是**允许穿插+群体推挤的涌动感,而非精确不重叠** | [Steam 社区讨论:VS 无 monster-to-monster 碰撞](https://steamcommunity.com/app/1794680/discussions/0/3425564948157515863/);[itch.io 关于「敌人是否互相碰撞、如何保持性能」的讨论串](https://zedtix.itch.io/vampire-survivors/comments) |
| **ECS Survivors**(Flecs 版 VS 克隆,最值得照抄的一手技术拆解) | **push-apart de-overlap**:算重叠量→沿法线**同时改 Position(各 ±overlap/2)和 Velocity(各 ∓move)**,**单趟、无多迭代、无 boids、无 ORCA**。enemy-enemy 只跳过「伤害反应」,物理分离照做 | [ECS Survivors Part IV: Collision](https://blog.ptidej.net/ecs-survivors-part-iv/)(原文实现:`self.set<Velocity2D>(v - move); other.set<Velocity2D>(v + move); self.set<Position2D>(mypos - move/2); other.set<Position2D>(otherPos + move/2)`) |
| **社区复刻(GameMaker/Construct/UE 教程群)** | 主流做法是**朝目标 seek + 简单互推**,推力温和;力度过猛/AI 在被推时仍追玩家会「打架抖动」,常见解法是被击退期间**临时关掉互相碰撞** | [UE 论坛:how to make VS-like enemy collisions](https://forums.unrealengine.com/t/how-to-make-vampire-survivors-like-enemies-collisions/2033856);[1upIndie:VS remake 敌人推挤/闪现 devlog](https://1upindie.com/enemy-blink-weapon-push-8-vampire-survivors-remake-in-gamemaker/) |

**三条一致结论**：

1. **没有一个在收敛点每帧把重叠硬压到零**——要么不做怪-怪碰撞(VS),要么软推且**改速度不只改位置**(ECS Survivors)。我们「collision 只改位置 + 追零重叠」是个异类,难怪会闪。
2. **ECS Survivors 那份是我们的直接对照组**:它的 de-overlap **同时写 pos 和 vel**,恰好就是 §三 PBD 说的「速度回写」——这是把「不闪」做对的实战范例,照抄即可。
3. **被外力(击退)干扰时临时关碰撞**是社区常识——印证「硬碰撞是可临时降级/关闭的兜底,不是不可撤的地基」。

---

## 六、对 `@cck/ecs-bitecs` spatial 的落地建议(含具体参数/结构)

**总方针**：**boids 软分离升为主间距手段、seek 撤压强、硬碰撞降级为稀发兜底**。三个 system 的具体改法(均是在现有几十行上加参数,不引库、不改架构):

### 6.1 `createSeekSystem` —— 撤掉 sink 处的向心压强

现状:`arriveRadius>0` 时线性减速到点。**升级为 arrive-to-ring + dead-zone**:

```
createSeekSystem(targetEid, speed, arriveRadius = 0, stopRadius = 0)
  len = dist(self, target)
  if len <= stopRadius:      v = 0                         // dead-zone:够近就完全不内挤(核心止血)
  elif len <  arriveRadius:  v = speed * (len-stopRadius)/(arriveRadius-stopRadius)  // 环形减速带
  else:                      v = speed
```

- **`stopRadius` 建议 ≈ 玩家半径 + 1~2× 敌人半径**:让最内圈实体停在贴着玩家的一圈上、不再往圆心挤——**这一条是止住中心闪烁最省力的单点改动**(研究共识:arrive 到一个环而非一个点,即解单点收敛不稳)。
- `arriveRadius` 建议 ≈ `stopRadius + 3~6× 敌人半径`(减速带宽一点更顺)。
- 站定的内圈实体此后只受 separation 微调位置——正是我们想要的「围住玩家而不在圆心打架」。

### 6.2 `createSeparationSystem` —— 加 perception 半径,升为主间距

现状:只在 `d2 < (r1+r2)²`(已重叠)时才推,等于没有预避让。**加一个大于接触距离的感知半径 + 平滑 falloff**:

```
createSeparationSystem(hash, strength, perceptionMul = 2.0)
  perc = (er + or) * perceptionMul         // 感知半径 > 接触距离,接触前就开始让
  查近邻(半径取 perc):
    if d < perc:                            // 注意:不是 d < r1+r2,而是 d < 感知半径
      falloff = 1 - d/perc                  // 平滑衰减(近1远0);或按 Reynolds 用 1/d
      sep += normalize(self-other) * falloff
  Velocity += sep * strength
  // 可选:先 normalize(sep) 再乘 strength,避免多邻居时合力爆炸
```

- **`perceptionMul` 建议 2.0~2.5**(接触距离的 2~2.5 倍开始互让);太大→远处也互斥、群散不拢,太小→退回「贴脸才让」。
- **falloff**:`1 - d/perc`(线性,便宜)即可;Reynolds 原文用 `1/d` 衰减并注明「1/r 只是经验值、非本质」([GDC99](https://www.red3d.com/cwr/steer/gdc99/)),两者都行,线性更稳不易在近距爆炸。
- 依旧**只作用于 `Not(Static)` 动态体**(现已如此)、依旧**覆盖写在 seek 之后叠加**(现 pipeline 顺序正确,保证不跨帧累积)。
- 这一步做实后,**大部分间距由软分离在接触前化解**,硬碰撞触发频率骤降。

### 6.3 `createCollisionSystem` —— 降级为「容许小重叠 + 限位移 + 速度回写」的稀发兜底

现状:改位置、不碰速度、`iterations` 松弛。**三处小改**(每处几行):

```
createCollisionSystem(hash, iterations = 1, slop = 0.5, maxCorrection = Infinity)
  overlap = rr - d
  if overlap <= slop: continue                       // ① 容许 slop 内的小重叠,不追精确零重叠
  corr = min(overlap - slop, maxCorrection)           // ② 单帧最多推 maxCorrection,大跳变摊几帧
  各推 corr/2(静/动分摊规则不变)
  // ③ 速度回写(PBD):把这次位置修正反映进法向速度,别让下帧 seek 再对顶
  Velocity[e]     -= n * (corr/2) / dt     (仅扣法向内灌分量,或整体按 Δx/dt)
  Velocity[other] += n * (corr/2) / dt
```

- **① `slop` 建议 ≈ 0.5~1 px(或 5~10% 半径)**:消除「为最后 1px 反复投影」的 churn(Box2D 同款做法)。
- **② `maxCorrection`**:密堆时限制单帧位移,把闪烁幅度直接压小;稀疏场 overlap 本就小、不触上限。
- **③ 速度回写是消「投影 vs 速度对顶」的关键**——对照 ECS Survivors(同时改 pos+vel)。`dt = world.time.delta`,注意除零保护。若嫌整体回写太猛,**至少扣掉法向内灌分量**(把「继续往里冲」的那部分速度削掉)。
- `iterations` **保持默认 1**:软化+撤压强后,单趟兜底足矣;真压不住再调趟数或上 §三 substepping(先别做,YAGNI)。

### 6.4 默认 pipeline(顺序不变,职责重配)

```
spatialIndex → seek(arrive-to-ring+dead-zone) → separation(perception 半径,主间距) → movement → collision(slop+限位移+速度回写,稀发兜底)
   建索引          撤中心压强、内圈站定            接触前平滑让开                积分        只兜漏网重叠、不追零、不对顶速度
```

**参数起点(供 ecs-lab 压测调)**:设敌人半径 `r`、玩家半径 `R`:

| system | 参数 | 起始值 | 调参方向 |
|---|---|---|---|
| seek | `stopRadius` | `R + 1.5r` | 中心还挤→调大;围太松→调小 |
| seek | `arriveRadius` | `stopRadius + 4r` | 逼近时顿挫→调大(减速带更宽) |
| separation | `perceptionMul` | `2.2` | 群散不拢→调小;贴脸才让→调大 |
| separation | `strength` | 与 speed 同量级起,压测细调 | 抖/overshoot→调小;叠太狠→调大 |
| collision | `slop` | `0.1r` | 还闪→调大(更容忍重叠);肉眼可见穿插→调小 |
| collision | `maxCorrection` | `0.5r`/帧 | 闪烁幅度大→调小 |
| collision | `iterations` | `1` | 兜底不干净且已软化到位→再考虑↑ |

### 6.5 要不要「干脆用 boids 取代硬碰撞」(直接回答用户)

**不建议完全取代,建议「主软 + 稀硬」。** 纯 boids 能根治闪烁(不 snap),但**放弃了重叠保证**——sink 处会叠、且叠多少取决于力配比,肉眼可能糊成一坨;真实 VS 干脆不做怪-怪碰撞也接受了这点。若你的美术能接受中心适度重叠(很多 survivors 就这样),**纯软分离 + arrive-to-ring 是最省的选择,可直接把 collision 关掉**。若要「围住玩家的那圈清晰相切、不糊」,就保留降级后的硬碰撞当兜底(§6.3)。**两条路都比现状(全速 seek + 只改位置的硬碰撞)强**,区别只在「能否容忍中心重叠」这一个产品决策。

---

## 参考文献(一手)

**Steering / boids(软分离、arrive)**
- Craig W. Reynolds, *Steering Behaviors For Autonomous Characters*, GDC 1999 —— arrive 减速公式、separation 的 `1/r` 衰减、`steering = desired_velocity - velocity`、`acceleration = steering_force / mass`。PDF <https://www.red3d.com/cwr/papers/1999/gdc99steer.pdf> ;在线版(含 Arrival/Separation 详解)<https://www.red3d.com/cwr/steer/gdc99/> ;项目页 <https://www.red3d.com/cwr/steer/>
- RTS 群体 steering 实战(cohesion/separation 配重、收敛问题)：howtorts, "Steering Behaviours: Flocking" <https://howtorts.github.io/2014/01/03/steering-flocking.html>

**PBD / XPBD / substepping(为何投影要回写速度、软硬与迭代解耦、子步>多迭代)**
- Matthias Müller, Bruno Heidelberger, Marcus Hennix, John Ratcliff, *Position Based Dynamics*, 2007 <https://matthias-research.github.io/pages/publications/posBasedDyn.pdf>
- Miles Macklin, Matthias Müller, Nuttapong Chentanez, *XPBD: Position-Based Simulation of Compliant Constrained Dynamics*, MIG 2016 <https://matthias-research.github.io/pages/publications/XPBD.pdf> ;教学版 <https://matthias-research.github.io/pages/tenMinutePhysics/09-xpbd.pdf>
- Miles Macklin et al., *Small Steps in Physics Simulation*, SCA 2019(n 个子步各 1 迭代 优于 1 大步 n 迭代)<https://mmacklin.com/smallsteps.pdf>

**约束求解稳定性(warm-starting、软约束、sequential impulses、sleeping、堆叠)**
- Erin Catto(Box2D)技术分享合集 <https://box2d.org/publications/> ；其中 *Soft Constraints*(mass-spring-damper、按 Hz+阻尼比调)、*Modeling and Solving Constraints* GDC2009、*Fast and Simple Physics using Sequential Impulses* GDC2006(warm starting)、*Solver2D*(sub-stepping + soft constraints)<https://box2d.org/posts/2024/02/solver2d/>

**ORCA / RVO / continuum crowds(重武器,单目标 swarm 不需要)**
- Jur van den Berg, Stephen J. Guy, Ming Lin, Dinesh Manocha, *Reciprocal n-body Collision Avoidance*(ORCA)——LP、各担一半责任、无振荡。项目页 <https://gamma.cs.unc.edu/ORCA/> ;论文 PDF <https://gamma.cs.unc.edu/ORCA/publications/ORCA.pdf> ;RVO2 库 <https://gamma.cs.unc.edu/RVO2/>
- Adrien Treuille, Seth Cooper, Zoran Popović, *Continuum Crowds*, SIGGRAPH 2006——动态势场、无显式逐对避让 <https://grail.cs.washington.edu/projects/crowd-flows/continuum-crowds.pdf>

**真实 survivors 游戏实践**
- ECS Survivors(Flecs 版 VS 克隆)Part IV: Collision——push-apart 同时改 pos+vel、单趟、无 ORCA <https://blog.ptidej.net/ecs-survivors-part-iv/>
- Vampire Survivors 无 monster-monster 碰撞(社区讨论)<https://steamcommunity.com/app/1794680/discussions/0/3425564948157515863/> ;敌人是否互相碰撞/性能讨论 <https://zedtix.itch.io/vampire-survivors/comments>
- 社区复刻实践：UE 论坛 VS-like 敌人碰撞 <https://forums.unrealengine.com/t/how-to-make-vampire-survivors-like-enemies-collisions/2033856> ；1upIndie GameMaker VS remake 敌人推挤/闪现 devlog <https://1upindie.com/enemy-blink-weapon-push-8-vampire-survivors-remake-in-gamemaker/>

**内部依据**
- `packages/ecs-bitecs/docs/modules/spatial.md`(现有 pipeline + 已加 arrive/Static + 实现记录里的 d≈0 退化修复与 iterations knob)
- `docs/research/2026-07-29-pathfinding-collision-crowd-survey.md`(上游横评:硬推开+可选 boids、不做 ORCA)
- `packages/ecs-bitecs/src/spatial/systems.ts`(被诊断的 seek/separation/collision 实现)

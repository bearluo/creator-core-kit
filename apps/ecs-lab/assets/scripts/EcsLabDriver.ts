import { _decorator, Component, Graphics, Color } from 'cc';
import {
  createEcsWorld,
  createEcsRunner,
  createSpatialHash,
  createFlowField,
  addEntity,
  addComponent,
  Position,
  Velocity,
  Circle,
  Seeker,
  Static,
  createSpatialIndexSystem,
  createSeekSystem,
  createFlowFollowSystem,
  createSeparationSystem,
  createCollisionSystem,
  movementSystem,
} from '@cck/ecs-bitecs';
import type { EcsWorld, EcsRunner, SpatialHash, FlowField } from '@cck/ecs-bitecs';

const { ccclass, property, requireComponent } = _decorator;

/**
 * spatial system 组的真机 debug 视图:一个 Graphics 每帧画出所有 agent。
 * 挂在带 Graphics 的 node 上(建议全屏、锚点居中、位置 (0,0),使 Position 世界坐标 = 屏幕坐标)。
 *   - useFlowField=false:开阔场,target(大圆)圆周运动,一群 agent seek 它 + 分离 + 碰撞去重叠。
 *   - useFlowField=true :造一道中列墙(留缺口),agent 沿 flow field 绕墙奔中心 + 分离 + 碰撞。
 * 纯逻辑已 node 全测(packages/ecs-bitecs/src/spatial),本脚本只验渲染观感 + kit 帧驱动接线。
 */
@ccclass('EcsLabDriver')
@requireComponent(Graphics)
export class EcsLabDriver extends Component {
  @property({ tooltip: 'agent 数量' }) agentCount = 400;
  @property({ tooltip: 'agent 半径(px)' }) radius = 6;
  @property({ tooltip: '移动速度(px/s)' }) speed = 160;
  @property({ tooltip: '分离强度' }) separation = 60;
  @property({ tooltip: '分离感知半径倍数(>1 接触前就避让,主动维持间距;拧这个而非强度)' }) perception = 1.5;
  @property({ tooltip: '到达减速半径(px):进入后线速衰减' }) arriveRadius = 120;
  @property({ tooltip: '站定死区半径(px):内圈 v=0 不再内挤,消中心 churn。<arriveRadius' }) stopRadius = 40;
  @property({ tooltip: '硬碰撞松弛趟数。0=纯 boids 分离(刷子虫群推荐,顺滑不闪);>0=额外硬去叠(会 snap 抖)' })
  collisionIterations = 0;
  @property({ tooltip: '硬碰撞容差(px):重叠 ≤ 此值不推,免微抖(仅 collisionIterations>0 时生效)' }) collisionSlop = 1;
  @property({ tooltip: '开=有墙 flow field 寻路;关=开阔场 seek' }) useFlowField = false;

  private gfx!: Graphics;
  private wallGfx: Graphics | null = null;
  private world!: EcsWorld;
  private runner!: EcsRunner;
  private hash!: SpatialHash;
  private field: FlowField | null = null;
  private target = 0;
  private agents: number[] = [];
  private walls: Array<[number, number]> = [];

  // 世界坐标网格(屏幕中心原点),供 flow field 用。
  private readonly cell = 40;
  private readonly cols = 30;
  private readonly rows = 18;
  private get originX(): number {
    return -(this.cols * this.cell) / 2;
  }
  private get originY(): number {
    return -(this.rows * this.cell) / 2;
  }

  start(): void {
    this.gfx = this.getComponent(Graphics)!;
    this.world = createEcsWorld();
    this.hash = createSpatialHash(this.radius * 2);

    this.target = this.spawn(0, 0, this.radius * 2, false); // target(大圆)不带 Seeker
    addComponent(this.world, Static, this.target); // 宿主手控 → 静态体:碰撞不推它,虫群绕它 packed(不再被挤得抖)
    for (let i = 0; i < this.agentCount; i++) {
      const ang = (i / this.agentCount) * Math.PI * 2;
      const r = 260 + (i % 40) * 3; // 环形铺开,错开半径避免初始重合
      this.agents.push(this.spawn(Math.cos(ang) * r, Math.sin(ang) * r, this.radius, true));
    }

    const systems = [createSpatialIndexSystem(this.hash)];
    if (this.useFlowField) {
      this.field = createFlowField(this.cols, this.rows, this.cell, this.originX, this.originY);
      this.buildWalls();
      this.wallGfx = this.node.addComponent(Graphics);
      this.drawWalls();
      systems.push(createFlowFollowSystem(this.field, this.speed));
    } else {
      systems.push(createSeekSystem(this.target, this.speed, this.arriveRadius, this.stopRadius));
    }
    systems.push(
      createSeparationSystem(this.hash, this.separation, this.perception),
      movementSystem,
      createCollisionSystem(this.hash, this.collisionIterations, this.collisionSlop),
    );
    this.runner = createEcsRunner(this.world, systems);
  }

  private spawn(x: number, y: number, r: number, seeker: boolean): number {
    const e = addEntity(this.world);
    addComponent(this.world, Position, e);
    addComponent(this.world, Velocity, e);
    addComponent(this.world, Circle, e);
    if (seeker) addComponent(this.world, Seeker, e);
    Position.x[e] = x;
    Position.y[e] = y;
    Circle.r[e] = r;
    return e;
  }

  private buildWalls(): void {
    const wcx = Math.floor(this.cols / 2);
    const gapCy = Math.floor(this.rows / 2);
    this.walls = [];
    for (let cy = 0; cy < this.rows; cy++) {
      if (cy !== gapCy) this.walls.push([wcx, cy]); // 中列墙,中间留一格缺口验绕行
    }
    const blocked = (bx: number, by: number): boolean => bx === wcx && by !== gapCy;
    const tcx = Math.floor((0 - this.originX) / this.cell);
    const tcy = Math.floor((0 - this.originY) / this.cell);
    this.field!.build([[tcx, tcy]], blocked);
  }

  update(dt: number): void {
    if (!this.useFlowField) {
      const t = this.world.time.elapsed;
      Position.x[this.target] = Math.cos(t * 0.6) * 200; // target 圆周运动,看群体追移动目标
      Position.y[this.target] = Math.sin(t * 0.6) * 200;
    }
    this.runner.tick(Math.min(dt, 1 / 30)); // 夹 dt,防卡顿单帧爆冲
    this.draw();
  }

  /**
   * 验证钩子:返回当前群体的平均到目标距离与最近一对间距(px)。
   * 编辑态可手动 start()+多次 update() 后调用,读收敛数值验 pipeline(见 docs/modules/spatial.md 实现记录)。
   */
  stats(): { n: number; avgToTarget: number; minPair: number } {
    const a = this.agents;
    let s = 0;
    for (const e of a) s += Math.hypot(Position.x[e] - Position.x[this.target], Position.y[e] - Position.y[this.target]);
    let m = Infinity;
    for (let i = 0; i < a.length; i++)
      for (let j = i + 1; j < a.length; j++) {
        const d = Math.hypot(Position.x[a[i]] - Position.x[a[j]], Position.y[a[i]] - Position.y[a[j]]);
        if (d < m) m = d;
      }
    return { n: a.length, avgToTarget: Math.round(s / a.length), minPair: Math.round(m * 100) / 100 };
  }

  /** 墙静态,只在 start 画一次(单独一个 Graphics,避免与 agents 的 fill 混色)。 */
  private drawWalls(): void {
    const g = this.wallGfx!;
    g.clear();
    g.fillColor = new Color(70, 70, 90, 255);
    for (const [cx, cy] of this.walls) {
      g.rect(this.originX + cx * this.cell, this.originY + cy * this.cell, this.cell, this.cell);
    }
    g.fill();
  }

  /** agents + target 每帧重画(同色 fill;target 靠更大半径辨识 —— ponytail: 要多色再加一个 Graphics)。 */
  private draw(): void {
    const g = this.gfx;
    g.clear();
    g.fillColor = new Color(80, 200, 255, 255);
    for (const e of this.agents) {
      g.circle(Position.x[e], Position.y[e], Circle.r[e]);
    }
    g.circle(Position.x[this.target], Position.y[this.target], Circle.r[this.target]);
    g.fill();
  }
}

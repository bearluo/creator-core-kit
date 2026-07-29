/**
 * @cck/ecs-bitecs 的 kit 接入胶水 —— bitECS v0.3 没有、而 kit 约定需要的三件事：
 *   ① world.time 秒制初始化（对齐 kit ITimer/dt，偏离 bitECS README 的毫秒示例）；
 *   ② 一组 system 组成 pipeline；
 *   ③ 每帧驱动接缝 tick(dt)——不自持时钟，由宿主（engine 帧回调 / ITimer / 测试）喂时间步。
 * 其余 bitECS API（defineComponent/defineQuery/addEntity/pipe/…）由 index.ts 直接 re-export。
 * 设计见 docs/modules/ecs.md。
 */
import { createWorld } from 'bitecs';
import type { IWorld } from 'bitecs';

/**
 * kit 约定的 world：在裸 IWorld 上挂 time。单位一律为**秒**——
 * system 里 `Position.x[eid] += Velocity.x[eid] * world.time.delta` 得到「每秒速度 × 秒」。
 */
export interface EcsWorld extends IWorld {
  time: { delta: number; elapsed: number };
}

/** bitECS system 契约：接收并返回 world（返回值供需要 pipe 串联的项目使用；本 runner 忽略）。 */
export type EcsSystem = (world: EcsWorld) => EcsWorld;

/** createEcsRunner 的句柄：持 world + 每帧驱动入口。 */
export interface EcsRunner {
  readonly world: EcsWorld;
  /** 宿主每帧调：设 world.time.delta=dtSec、累加 elapsed，然后按注册序跑各 system。 */
  tick(dtSec: number): void;
}

/** createWorld() + 初始化 world.time={delta:0,elapsed:0}。 */
export function createEcsWorld(): EcsWorld {
  return createWorld<EcsWorld>({ time: { delta: 0, elapsed: 0 } });
}

/**
 * 极薄接入胶水：把一组 system 交给宿主每帧驱动。
 * 内部用有序 loop 顺序跑 system（等价于 bitECS `pipe(...systems)(world)`、但类型安全、
 * 空数组天然安全）；想要 pipeline 组合的项目可直接用 re-export 的 `pipe`。
 */
export function createEcsRunner(world: EcsWorld, systems: EcsSystem[]): EcsRunner {
  return {
    world,
    tick(dtSec: number): void {
      world.time.delta = dtSec;
      world.time.elapsed += dtSec;
      for (const system of systems) system(world);
    },
  };
}

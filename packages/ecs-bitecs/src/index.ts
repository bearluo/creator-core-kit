/**
 * @cck/ecs-bitecs 入口：可选的高性能 ECS 扩展包（不进 core，纯 TS/纯数据，可 node/vitest 直测）。
 * 示范「第三方高性能能力如何接入 creator-core-kit」。选型见 docs/research/2026-07-28-ecs-survey.md，
 * 设计见 docs/modules/ecs.md。
 */

// 透传 bitECS v0.3 全套（createWorld / defineComponent / Types / defineQuery / addEntity /
// addComponent / removeComponent / hasComponent / removeEntity / enterQuery / exitQuery /
// Not / Changed / pipe / defineSerializer / defineDeserializer …）——
// 项目只引 @cck/ecs-bitecs 即拿到全部 bitECS API，不必再单独依赖 bitecs：运行时经 tsup noExternal 把
// bitecs 打进 dist（自包含）；类型经 dist/index.d.ts 的 `export * from 'bitecs'` 走 bitecs 传递依赖解析
// （bitecs 是本包 pinned dependency，随本包一并装入，故 TS 侧同样只需 @cck/ecs-bitecs）。
export * from 'bitecs';

// kit 接入胶水：world.time 秒制 + 每帧驱动接缝。
export { createEcsWorld, createEcsRunner } from './world';
export type { EcsWorld, EcsSystem, EcsRunner } from './world';

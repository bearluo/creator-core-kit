/**
 * @cck/core 内核层入口。纯 TypeScript，零 cc 依赖。
 * 引擎能力一律走 Core 定义的接口 + DI 注入（见 CLAUDE.md 核心铁律 / ADR-0001）。
 */

/** 骨架自检用常量：证明 core 可被 node/vitest 与 Cocos 消费。第 1 批地基落地后移除。 */
export const CCK_CORE_VERSION = '0.0.0';

// —— 第 1 批 · 地基 ——
export * from './di';
export * from './logging';
export * from './eventbus';
export * from './timer';
export * from './bootstrap';

// —— 第 2 批 · 核心设施 ——
export * from './pool';
export * from './sceneflow';
export * from './save';

/** 骨架示例纯函数：可脱离 Creator 在 node 环境单测的最小证明。第 1 批地基落地后移除。 */
export function hello(name: string): string {
  return `hello, ${name} from @cck/core`;
}

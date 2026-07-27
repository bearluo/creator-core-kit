/**
 * @cck/engine 适配层入口。cc 薄壳 + Core 接口的 cc 实现（见 CLAUDE.md）。
 * 作为 Cocos assets 下源码 bundle 被工程编译（从而拿到真 cc）。
 */

// —— 第 1 批 · 地基（Bootstrap engine 半）——
export { createCcLogger, ccSink } from './cc-logger';
export { driveWithDirector, loggerModule, bootCoreKit } from './bootstrap';

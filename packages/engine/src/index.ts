/**
 * @cck/engine 适配层入口。cc 薄壳 + Core 接口的 cc 实现（见 CLAUDE.md）。
 * 作为 Cocos assets 下源码 bundle 被工程编译（从而拿到真 cc）。
 */

// —— 第 1 批 · 地基（Bootstrap engine 半）——
export { createCcLogger, ccSink } from './cc-logger';
export { driveWithDirector, loggerModule, bootCoreKit } from './bootstrap';

// —— 第 2 批 · 设施（AssetManager engine 半：IAssetSource 的 cc 实现）——
export { createCcAssetSource, ccAssetModule } from './asset-source';

// —— 第 2 批 · 设施（BundleManager engine 半：IBundleSource 的 cc 实现）——
export { createCcBundleSource, ccBundleModule } from './bundle-source';

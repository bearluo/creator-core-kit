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

// —— 第 2 批 · 设施（SaveManager engine 半：IStorage 的 cc.sys.localStorage 实现）——
export { createCcStorage, ccStorageModule } from './cc-storage';

// —— 第 2 批 · 设施（AudioService engine 半：IAudioPlayer 的 cc.AudioSource 实现）——
export { createCcAudioPlayer, ccAudioModule } from './cc-audio';

// —— 第 2 批 · 设施（UIManager engine 半：IUIView 的 cc 渲染实现）——
export { createCcUIView, ccUIModule } from './cc-ui';

// —— 第 2 批 · 设施（SceneFlow engine 半：director 切场景 promisify）——
export { loadScene, preloadScene } from './scene-loader';

// —— 第 2 批 · 设施（i18n engine 半：翻译表经 IAssetLoader 加载 + 语言持久化）——
export { loadLocaleTable, setupLocalePersistence } from './i18n-loader';

// —— 第 2 批 · 设施（ConfigTable engine 半：配表 JSON 经 IAssetLoader 加载并注册）——
export { loadTable } from './config-loader';

// —— 第 3 批 · 进阶（HotUpdateService engine 半：native.AssetsManager 后端，仅原生）——
export { createCcHotUpdateBackend, ccHotUpdateModule } from './hotupdate-backend';
export type { CcHotUpdateOptions } from './hotupdate-backend';

// —— 第 3 批 · 进阶（Network engine 半：ISocket 的 WebSocket 实现）——
export { createWebSocketSocket, ccNetworkModule } from './net-socket';

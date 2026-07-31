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

// —— 第 2 批 · 设施（UIManager engine 半：IUIView 的 cc 渲染实现 + 界面契约）——
export { createCcUIView, ccUIModule } from './cc-ui';
export { CCKUIView } from './cck-ui-view';

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

// —— 第 3 批 · 进阶（reactive engine 半：把响应式值绑到 cc 节点属性 + BindingScope）——
export { bindText, bindProp, bindEditBox, bindToggle, BindingScope } from './reactive-bind';

// —— DI engine 半（KitContext：core 层级容器绑定到 cc.Node 场景树，of/resolve/provide）——
export { KitContext } from './kit-context';

// —— 渲染骨架（常驻相机组 + 横竖屏适配；纯决策逻辑在 render-policy，零 cc 可单测）——
export {
  CAMERA_PRIORITY,
  CCK_LAYERS,
  computeCameraCenter,
  computeOrthoHeight,
  createClearOwnership,
  pickDesignResolution,
} from './render-policy';
export type {
  CameraRigLayer,
  ClearFlagsHolder,
  ClearOwnership,
  ClearOwnershipDeps,
  DesignResolution,
  Orientation,
  OrthoHeightInput,
} from './render-policy';
export { CAMERA_RIG, cameraRigModule, createCameraRig, getCameraRig } from './camera-rig';
export type { CameraRig, CameraRigOptions } from './camera-rig';
export { resolutionModule } from './resolution';
export type { ResolutionOptions } from './resolution';

// —— App 层 · 启动编排的引擎半（平台重启 + bundle 脚本失效接缝）——
export { appModule, createCcBundleReloader } from './app-module';

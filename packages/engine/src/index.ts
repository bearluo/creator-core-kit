/**
 * @cck/engine 适配层入口。
 *
 * 定位（见 CLAUDE.md）：继承 cc.Component 的薄壳 + Core 接口
 * （IAssetLoader / IAudioService / ITimer / INetwork / IStorage / ILogger / IPlatform）
 * 的 cc 实现；只做「渲染 Core 数据 + 转发引擎事件」，不含业务逻辑。
 * 作为 Cocos assets 下的源码 bundle 被工程编译（从而拿到 cc）。
 *
 * 骨架占位：第 1 批地基（Bootstrap + DI 把 cc 实现注入 Core）落地后填充。
 */
export {};

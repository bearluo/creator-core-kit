import { assetManager, director } from 'cc';

/**
 * SceneFlow 的「引擎半」：把 cc.director 的场景切换 promisify，供 FlowState 在 onEnter/钩子里发起真实切场景。
 * SceneFlow（core）是纯状态机、零 cc；「加载哪个 cc 场景」这类副作用由状态自身调用本 helpers。
 * 无 DI token——切场景是 engine 直接行为，core 不持有其接缝（对齐 sceneflow.ts 设计：状态自发副作用）。
 */

/**
 * 切换场景。成功 resolve；未找到 / 出错 reject。
 * - 默认（无 bundle）：`director.loadScene`——切到主包/build「包含场景」列表里的场景。
 * - `opts.bundle`：从已加载的自定义 bundle 里切它自带的场景（大厅子游戏框架 `kind:'game'` 模块场景）。
 *   走官方两步：`bundle.loadScene`（只加载 SceneAsset、不运行）→ `director.runScene`（帧末切换）。
 *   ponytail: bundle 分支的 loadScene→runScene 链路待 apps/demo 真机复验（ADR-0002 引擎行为不 mock）。
 */
export function loadScene(name: string, opts?: { bundle?: string }): Promise<void> {
  const bundleName = opts?.bundle;
  if (bundleName) {
    return new Promise<void>((resolve, reject) => {
      const bundle = assetManager.getBundle(bundleName);
      if (!bundle) {
        reject(new Error(`loadScene('${name}', {bundle:'${bundleName}'})：bundle 未加载（先经 BundleManager.load 加载该 bundle）`));
        return;
      }
      bundle.loadScene(name, (err, sceneAsset) => {
        if (err) reject(err);
        else director.runScene(sceneAsset, undefined, () => resolve());
      });
    });
  }
  return new Promise<void>((resolve, reject) => {
    const started = director.loadScene(name, (err) => {
      if (err) reject(err);
      else resolve();
    });
    if (!started) {
      reject(new Error(`loadScene('${name}')：场景未找到（检查 build 设置是否包含该场景）`));
    }
  });
}

/** 预加载场景（不切换），后续 loadScene 即时生效。加载出错 reject。 */
export function preloadScene(name: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    director.preloadScene(name, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

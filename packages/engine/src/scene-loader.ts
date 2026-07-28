import { director } from 'cc';

/**
 * SceneFlow 的「引擎半」：把 cc.director 的场景切换 promisify，供 FlowState 在 onEnter/钩子里发起真实切场景。
 * SceneFlow（core）是纯状态机、零 cc；「加载哪个 cc 场景」这类副作用由状态自身调用本 helpers。
 * 无 DI token——切场景是 engine 直接行为，core 不持有其接缝（对齐 sceneflow.ts 设计：状态自发副作用）。
 */

/** 切换到已在 build 设置里的场景。成功 resolve；场景未找到 / 加载出错 reject。 */
export function loadScene(name: string): Promise<void> {
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

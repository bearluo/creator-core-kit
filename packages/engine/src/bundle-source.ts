import { assetManager } from 'cc';
import { BUNDLE_SOURCE } from '@cck/core';
import type { IBundleSource, BundleLoadOptions, KitModule } from '@cck/core';

/**
 * IBundleSource 的 cc 实现 —— BundleManager 的「引擎半」薄壳：只做「真加载 / 真释放 / 是否就绪」
 * 三原子操作，零 account。引用计数 / 并发去重 / 失败回滚全在 core 的 BundleManager。
 * name = BundleManager 统一决定的注册名；opts.url 存在则从该远程 url 取、否则按本地 name 取。
 */
export function createCcBundleSource(): IBundleSource {
  return {
    loadBundle(name: string, opts?: BundleLoadOptions & { url?: string }): Promise<void> {
      const target = opts?.url ?? name; // 远程有 url 从 url 取，本地按 name
      // ponytail: onProgress 忽略——cc.assetManager.loadBundle 不暴露 bundle 级进度回调（只 options.version）。
      //           需要进度时改走第 3 批 HotUpdateService 的 AssetsManager backend。
      const options = opts?.version ? { version: opts.version } : null;
      return new Promise<void>((resolve, reject) => {
        assetManager.loadBundle(target, options, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },

    releaseBundle(name: string): void {
      const bundle = assetManager.getBundle(name);
      if (!bundle) return; // 未就绪 → no-op（core 归零才调此，正常不会命中）
      bundle.releaseAll(); // 释放该 bundle 全部资源
      assetManager.removeBundle(bundle); // 再从 assetManager 注销 bundle 本身
    },

    hasBundle(name: string): boolean {
      return !!assetManager.getBundle(name);
    },
  };
}

/** KitModule：注册 `BUNDLE_SOURCE → cc 实现`（本层未注册时）。放模块数组里，BundleManager 自动拾取。 */
export function ccBundleModule(): KitModule {
  return {
    name: 'bundle-source',
    install(ctx) {
      if (!ctx.container.hasLocal(BUNDLE_SOURCE)) {
        ctx.container.register(BUNDLE_SOURCE, { useValue: createCcBundleSource() });
      }
    },
  };
}

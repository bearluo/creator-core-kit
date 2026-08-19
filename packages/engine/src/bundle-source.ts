import { assetManager, js } from 'cc';
import { BUNDLE_SOURCE } from '@cck/core';
import type { IBundleSource, BundleLoadOptions, KitModule } from '@cck/core';
import { dropBundleModules } from './system-registry';
import type { SystemLike } from './system-registry';

/** 每个 bundle 上次加载用的版本；用来判断「这次 load 是不是换了 md5」。 */
const loadedVersions = new Map<string, string | undefined>();

/**
 * 让下一次 loadBundle **真正重新求值**该 bundle 的脚本：把它在 SystemJS 里的模块记录
 * （连同 declare 缓存）删掉，并把它注册进 cc 的类注销掉。返回是否真的清了。
 *
 * 为什么两样都要清（2026-07-31 web-mobile 真构建实测）：
 * - 只删模块不注销类 → 新模块虽然重新求值，但 `js.setClassName` 撞名不覆盖 `_registeredClassIds`，
 *   prefab 是按 **classId** 反序列化的 → 拿到的还是旧类，表现为「类换了、界面没换」。
 * - 只注销类不删模块 → `System.import` 命中缓存的 load 记录，declare 根本不再执行，类永远回不来
 *   （反而比不清更糟：prefab 反序列化报 `Can not find class`，组件被静默丢弃）。
 *
 * ⚠️ **只在 md5（version）真的变了时调**。cc 的 `downloadScript` 按 **URL** 缓存已下载的脚本
 * （引擎内模块私有的 `downloaded[url]`，外部够不到）：同 URL 再加载不会重新插 `<script>`，
 * 清了缓存就再也执行不到那段代码，`System.import` 两张表都落空 → 加载直接失败。
 * native 没有这层 DOM 脚本缓存，热更覆盖同名文件后可以无条件清。
 */
export function invalidateBundleScripts(name: string): boolean {
  const classes = dropBundleModules((globalThis as { System?: SystemLike }).System, name);
  if (!classes) return false;
  if (classes.length) (js.unregisterClass as (...c: unknown[]) => void)(...classes);
  return true;
}

/**
 * IBundleSource 的 cc 实现 —— BundleManager 的「引擎半」薄壳：只做「真加载 / 真释放 / 是否就绪」
 * 三原子操作，零 account。引用计数 / 并发去重 / 失败回滚全在 core 的 BundleManager。
 * name = BundleManager 统一决定的注册名；opts.url 存在则从该远程 url 取、否则按本地 name 取。
 */
export function createCcBundleSource(): IBundleSource {
  return {
    loadBundle(name: string, opts?: BundleLoadOptions & { url?: string }): Promise<void> {
      const target = opts?.url ?? name; // 远程有 url 从 url 取，本地按 name
      // 换了 md5 = 换了脚本 URL = 有新代码可求值 → 先清掉上一版的模块与类，免重启换代码。
      // 版本没变时**绝不能清**（见 invalidateBundleScripts 的 downloadScript URL 缓存说明）。
      if (loadedVersions.has(name) && loadedVersions.get(name) !== opts?.version) {
        invalidateBundleScripts(name);
      }
      // ponytail: onProgress 忽略——cc.assetManager.loadBundle 不暴露 bundle 级进度回调（只 options.version）。
      //           需要进度时改走第 3 批 HotUpdateService 的 AssetsManager backend。
      const options = opts?.version ? { version: opts.version } : null;
      return new Promise<void>((resolve, reject) => {
        assetManager.loadBundle(target, options, (err) => {
          if (err) reject(err);
          else {
            loadedVersions.set(name, opts?.version);
            resolve();
          }
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

import { sys } from 'cc';
import { createApp, getHotUpdateService, APP, BUNDLE_RELOADER } from '@cck/core';
import type { AppConfig, IBundleReloader, KitModule, LaunchStep } from '@cck/core';
import { invalidateBundleScripts } from './bundle-source';

/**
 * App 的「引擎半」：接上两件平台相关的事——**怎么重启**、**能不能让 bundle 脚本失效**——
 * 然后 `createApp` 并注册进容器。启动序列本身是 core 的纯逻辑。
 *
 * 本模块只造不跑：进度/失败订阅要在启动前挂上，所以 `launch()` 由调用方在 `bootCoreKit` 之后显式发起。
 */
export function appModule(config: AppConfig, opts?: { steps?: readonly LaunchStep[] }): KitModule {
  return {
    name: 'app',
    install(ctx) {
      if (!ctx.container.hasLocal(BUNDLE_RELOADER)) {
        ctx.container.register(BUNDLE_RELOADER, { useValue: createCcBundleReloader() });
      }
      const app = createApp(config, { steps: opts?.steps, deps: { restart: platformRestart } });
      ctx.container.register(APP, { useValue: app });
    },
  };
}

/**
 * 重启应用。
 * - native：走 `HotUpdateService.restart()`（backend 内是 `game.restart`，同进程、PID 不变）。
 * - web：**必须整页 reload**——`game.restart()` 只重启引擎、不重新拉脚本，而 web 的新代码在
 *   `index.<md5>.js` 这个新 URL 里，不重新拉就还是旧的。
 */
function platformRestart(): void {
  if (sys.isNative) {
    getHotUpdateService().restart();
    return;
  }
  // 不依赖 DOM lib 的写法（engine 的类型源是 @cocos/creator-types，不含 dom）。
  (globalThis as { location?: { reload(): void } }).location?.reload();
}

/**
 * `IBundleReloader` 的 cc 实现（语义见 core 侧接口注释）：清掉该 bundle 在 SystemJS 里的
 * 模块记录 + 注销它注册的 cc 类，使下一次 loadBundle 重新求值脚本。
 *
 * **web 的 md5 换版路径不需要显式调它**——`createCcBundleSource().loadBundle` 发现版本变了会自动清。
 * 本接口留给「文件被原地覆盖、版本号看不出变化」的场景（native 热更）：调用方在热更落盘后显式调一次。
 */
export function createCcBundleReloader(): IBundleReloader {
  return { invalidate: (bundle: string) => invalidateBundleScripts(bundle) };
}

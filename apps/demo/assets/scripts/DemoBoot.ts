import { _decorator, Component, JsonAsset } from 'cc';
import {
  CCK_CORE_VERSION,
  createI18n,
  createTable,
  createPool,
  getAssetLoader,
  ASSET_SOURCE,
  getBundleManager,
  BUNDLE_SOURCE,
  TIMER,
  type ITimer,
  type Kit,
} from '@cck/core';
import { createCcLogger, bootCoreKit, ccAssetModule, ccBundleModule } from '@cck/engine';

const { ccclass } = _decorator;

/**
 * demo 集成验证薄壳：在真实 Cocos Creator 运行时里同时消费
 *  - @cck/core（纯 TS、零 cc）——证明 Creator 能从 workspace symlink 的 node_modules 解析并编译 core；
 *  - @cck/engine（cc 薄壳，dist 里 cc / @cck/core 均为 external）——证明 node_modules 包 dist 里残留的
 *    `import from 'cc'` 也能被 Cocos QuickPack 解析（决策 #7 实证），且 cc 适配层（cc-logger / director 帧驱动）真跑得起来。
 * 只做 console 输出，不含业务逻辑（符合 engine 薄壳约定）。
 */
@ccclass('DemoBoot')
export class DemoBoot extends Component {
  private kit?: Kit;
  private frames = 0;
  private reported = false;

  async start() {
    const tag = '[CCK-DEMO]';

    // —— core（纯 TS，node_modules 直连）——
    console.log(`${tag} core version = ${CCK_CORE_VERSION}`);

    // i18n：查表 + {name} 插值 + 语言切换
    const i18n = createI18n({
      locale: 'zh',
      tables: { zh: { 'demo.hi': '你好 {name}' }, en: { 'demo.hi': 'Hi {name}' } },
    });
    console.log(`${tag} i18n(zh) = ${i18n.t('demo.hi', { name: 'Cocos' })}`);
    i18n.setLocale('en');
    console.log(`${tag} i18n(en) = ${i18n.t('demo.hi', { name: 'Cocos' })}`);

    // ConfigTable：按主键索引 + 查询
    const heroes = createTable('hero', [
      { id: 1, name: 'A', hp: 100 },
      { id: 2, name: 'B', hp: 200 },
    ]);
    console.log(`${tag} table.get(2).hp = ${heroes.get(2)?.hp} / size = ${heroes.size}`);

    // ObjectPool：LIFO 复用
    const pool = createPool<{ n: number }>({ factory: () => ({ n: 0 }) });
    const a = pool.acquire();
    a.n = 42;
    pool.release(a);
    const b = pool.acquire();
    console.log(`${tag} pool LIFO reuse = ${b === a && b.n === 42 ? 'OK' : 'FAIL'}`);

    // —— engine（cc 薄壳，node_modules 直连；dist 里 cc / @cck/core 为 external）——
    // cc-logger：ILogger 的 LogSink 换成 cc 版，输出打到真 cc.log / cc.warn
    const clog = createCcLogger({ tag: 'ENGINE' });
    clog.info('createCcLogger → cc.log 打通');
    clog.warn('createCcLogger → cc.warn 打通');

    // Bootstrap engine 半：组合根 + cc logger + director 帧驱动一键启动
    this.kit = await bootCoreKit({ modules: [ccAssetModule(), ccBundleModule()] });
    console.log(`${tag} bootCoreKit ok → modules = [${this.kit.modules.join(', ')}]`);

    // 验证 director 帧驱动确实在 tick：从容器取 TIMER（bootCoreKit 内那只被 director 驱动的实例），挂 onFrame 计帧
    const timer: ITimer | undefined = this.kit.container.tryResolve(TIMER);
    if (timer) {
      timer.onFrame(() => {
        this.frames++;
      });
    } else {
      console.error(`${tag} TIMER 未注册 —— bootCoreKit 异常`);
    }

    // —— AssetManager engine 半（IAssetSource 的 cc 实现，经 ccAssetModule 注册 ASSET_SOURCE）——
    // registered=true 即证明 DI 接入链路通：getAssetLoader 背后是 cc source 而非 memory fallback。
    console.log(`${tag} ASSET_SOURCE (cc) registered = ${this.kit.container.has(ASSET_SOURCE)}`);
    const loader = getAssetLoader(); // 先 boot 再取，确保拾取到已注册的 cc source
    try {
      const cfg = await loader.load<JsonAsset>('test-config', { type: 'json' });
      console.log(`${tag} ✅ 真加载 resources/test-config.json via cc AssetSource:`, cfg.json);
      loader.release('test-config', { type: 'json' });
    } catch (e) {
      console.warn(
        `${tag} （可选真加载）resources/test-config.json 不存在，已跳过；放个该 json 后预览即验证真加载：`,
        (e as Error).message,
      );
    }

    // —— BundleManager engine 半（IBundleSource 的 cc 实现，经 ccBundleModule 注册 BUNDLE_SOURCE）——
    // 端到端：load 具名 bundle → 在其内加载资源（顺带验 AssetSource 具名 bundle 分支）→ release，全生命周期。
    console.log(`${tag} BUNDLE_SOURCE (cc) registered = ${this.kit.container.has(BUNDLE_SOURCE)}`);
    const bundleMgr = getBundleManager();
    try {
      await bundleMgr.load('probe-bundle');
      console.log(`${tag} ✅ 真加载 bundle 'probe-bundle' via cc BundleSource: isLoaded = ${bundleMgr.isLoaded('probe-bundle')}`);
      const probe = await loader.load<JsonAsset>('probe', { bundle: 'probe-bundle', type: 'json' });
      console.log(`${tag} ✅ 具名 bundle 内真加载资源（验 AssetSource 具名分支）:`, probe.json);
      loader.release('probe', { bundle: 'probe-bundle', type: 'json' });
      bundleMgr.release('probe-bundle');
      console.log(`${tag} bundle release 后 isLoaded = ${bundleMgr.isLoaded('probe-bundle')}（应为 false）`);
    } catch (e) {
      console.warn(
        `${tag} （可选）bundle 'probe-bundle' 验证跳过（未配置该 bundle）：`,
        (e as Error).message,
      );
    }
  }

  update(): void {
    // 攒几帧后报告一次：frames>0 证明 cc.director(EVENT_AFTER_UPDATE) → driver.tick(dt) → ITimer.onFrame 链路在真 cc 下通
    if (!this.reported && this.frames >= 3) {
      this.reported = true;
      const tag = '[CCK-DEMO]';
      console.log(`${tag} director 帧驱动 onFrame 已触发 ${this.frames} 帧 → engine driveWithDirector OK`);
      console.log(`${tag} ✅ engine (cc 薄壳) consumed & running under real cc`);
      void this.kit?.shutdown(); // 收尾：逆序 stop（解绑帧驱动）、注销 KIT
    }
  }
}

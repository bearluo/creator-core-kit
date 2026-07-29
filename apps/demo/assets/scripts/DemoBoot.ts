import { _decorator, Component, JsonAsset, sys } from 'cc';
import {
  CCK_CORE_VERSION,
  createI18n,
  createTable,
  createPool,
  getAssetLoader,
  ASSET_SOURCE,
  getBundleManager,
  BUNDLE_SOURCE,
  getSaveManager,
  STORAGE,
  AUDIO_PLAYER,
  UI_VIEW,
  getI18n,
  getAudioService,
  getUIManager,
  createNetwork,
  NETWORK_SOCKET,
  getHotUpdateService,
  createHotUpdateService,
  HOTUPDATE_BACKEND,
  HOTUPDATE_SERVICE,
  TIMER,
  type ITimer,
  type AppInfo,
  type Kit,
} from '@cck/core';
import {
  createCcLogger,
  bootCoreKit,
  ccAssetModule,
  ccBundleModule,
  ccStorageModule,
  ccAudioModule,
  ccUIModule,
  ccNetworkModule,
  ccHotUpdateModule,
  loadLocaleTable,
  loadTable,
  loadScene,
} from '@cck/engine';

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

    // 热更验证锚点：v1 构建为 'v1'，v2 构建改成 'v2'。原生热更 restart 后 logcat 再现本行 = 'v2' 即证热更生效。
    const BUILD_TAG = 'v1';
    console.log(`${tag} 🏷️ BUILD_TAG = ${BUILD_TAG}`);

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
    this.kit = await bootCoreKit({
      modules: [
        ccAssetModule(),
        ccBundleModule(),
        ccStorageModule(),
        ccAudioModule(),
        ccUIModule(),
        ccNetworkModule(),
        ccHotUpdateModule({ manifestUrl: 'project.manifest', compatFilename: 'cck-update-compat.json' }),
      ],
    });
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

    // —— 第 2 批设施 · engine 半批量验证（Save / Audio / UI / i18n / Config / SceneFlow）——
    // DI 接入：3 个 token-backed cc 接缝均应 registered=true（证明拾取 cc 实现而非 memory fallback）
    console.log(
      `${tag} STORAGE/AUDIO_PLAYER/UI_VIEW registered = ` +
        `${this.kit.container.has(STORAGE)}/${this.kit.container.has(AUDIO_PLAYER)}/${this.kit.container.has(UI_VIEW)}`,
    );

    // SaveManager（IStorage → cc.sys.localStorage）：真 KV 往返
    try {
      const save = getSaveManager();
      await save.save('demo', { level: 7, name: 'CCK' });
      const back = await save.load('demo');
      console.log(
        `${tag} ✅ SaveManager 真存档 via cc.sys.localStorage: load = ${JSON.stringify(back)}, list = ${JSON.stringify(await save.list())}`,
      );
      await save.delete('demo');
      console.log(`${tag} SaveManager delete 后 has('demo') = ${await save.has('demo')}（应 false）`);
    } catch (e) {
      console.warn(`${tag} SaveManager 验证异常：`, (e as Error).message);
    }

    // i18n（loadLocaleTable：翻译表 JSON 经 cc AssetLoader 真加载 → addTable）
    try {
      await loadLocaleTable('en', 'i18n-en');
      console.log(
        `${tag} ✅ i18n loadLocaleTable via cc AssetLoader: t('greet.hello') = ${getI18n().t('greet.hello', { name: 'Cocos' })}`,
      );
    } catch (e) {
      console.warn(`${tag} i18n loadLocaleTable 跳过（缺 resources/i18n-en.json）：`, (e as Error).message);
    }

    // ConfigTable（loadTable：配表 JSON 数组经 cc AssetLoader 真加载 → register）
    try {
      const heroes = await loadTable<{ id: number; name: string; hp: number }>('hero', 'heroes');
      console.log(
        `${tag} ✅ ConfigTable loadTable via cc AssetLoader: size = ${heroes.size}, get(2).name = ${heroes.get(2)?.name}`,
      );
    } catch (e) {
      console.warn(`${tag} ConfigTable loadTable 跳过（缺 resources/heroes.json）：`, (e as Error).message);
    }

    // AudioService（ccAudioModule 注册 cc.AudioSource 播放器）：真出声待 audioClip 资产，这里验 no-throw
    try {
      getAudioService().playOneShot('__no_such_clip__');
      console.log(`${tag} AudioService playOneShot 未抛（真出声待 audioClip 资产；AUDIO_PLAYER 已 registered）`);
    } catch (e) {
      console.warn(`${tag} AudioService 验证异常：`, (e as Error).message);
    }

    // UIManager（ccUIModule 注册 cc 渲染层）：真渲染待 prefab 资产，这里验缺 prefab 优雅失败（open→false，不崩）
    try {
      const opened = await getUIManager().open('__no_such_ui__');
      console.log(`${tag} UIManager open(缺prefab) = ${opened}（应 false，不崩；真渲染待 prefab 资产；UI_VIEW 已 registered）`);
    } catch (e) {
      console.warn(`${tag} UIManager 验证异常：`, (e as Error).message);
    }

    // SceneFlow（loadScene：director 切场景 promisify）：真切场景待第二场景，这里验未知场景优雅 reject
    try {
      await loadScene('__no_such_scene__');
      console.warn(`${tag} SceneFlow loadScene 未按预期 reject（异常）`);
    } catch (e) {
      console.log(`${tag} ✅ SceneFlow loadScene 未知场景优雅 reject: ${(e as Error).message}`);
    }

    // —— 第 3 批设施 · engine 半批量验证（Network / HotUpdate）——
    // Network：ccNetworkModule 注册 NETWORK_SOCKET → WebSocket 实现（registered=true 证明拾取 cc 壳而非 memory socket）
    console.log(
      `${tag} NETWORK_SOCKET (WebSocket) registered = ${this.kit.container.has(NETWORK_SOCKET)}` +
        ` / WebSocket 全局可用 = ${typeof WebSocket !== 'undefined'}`,
    );
    try {
      // 真 echo 往返：连本地 jmalloc/echo-server（docker run -p 9099:8080 jmalloc/echo-server）。
      // createNetwork 不传 socket → 取 DI 注册的真 WebSocket 适配器；request 带 seq，echo 原样回显 → seq 匹配 → resolve。
      // 关重连/心跳避免验证噪声；echo-server 首条问候语非 JSON，decode 失败被忽略，无害。
      const net = createNetwork({
        url: 'ws://localhost:9099/',
        reconnect: { enabled: false },
        heartbeat: { enabled: false },
      });
      const body = await new Promise<unknown>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('echo 超时（ws echo 服务器未起？）')), 5000);
        net.onState((s) => {
          if (s !== 'open') return;
          net.request('echo', { n: 42, s: 'cck' }, { timeoutSec: 4 }).then(
            (msg) => { clearTimeout(t); resolve(msg.body); },
            (e) => { clearTimeout(t); reject(e as Error); },
          );
        });
        net.connect();
      });
      const ok = !!body && (body as { n?: number }).n === 42;
      console.log(`${tag} ✅ Network 真 echo 往返 via WebSocket 适配器: body = ${JSON.stringify(body)} → ${ok ? 'OK' : 'MISMATCH'}`);
      net.close();
    } catch (e) {
      console.warn(`${tag} Network echo 验证跳过/失败（需 ws echo 服务器在 localhost:9099）：`, (e as Error).message);
    }

    // —— 戳的运行时读入（app 侧）：读 app 戳 → AppInfo → 注册带 app 的 HotUpdateService，激活 coreApiHash 闸 ——
    // app 戳 resources/cck-app-compat.json 由 tools 的 `cck-manifest stamp --core <core-dist> --version <appVer>` 出包期生成。
    // 缺戳 → 用默认 AppInfo{appVersion:'0.0.0'}，闸对 coreApiHash 休眠（单边缺失恒放行，不阻断）。
    try {
      const stamp = await loader.load<JsonAsset>('cck-app-compat', { type: 'json' });
      const j = stamp.json as { version: string; coreApiHash: string };
      const app: AppInfo = { appVersion: j.version, coreApiHash: j.coreApiHash };
      this.kit.container.register(
        HOTUPDATE_SERVICE,
        { useValue: createHotUpdateService({ app }) },
        { allowOverride: true },
      );
      console.log(`${tag} 🏷️ app 戳读入 → AppInfo: appVersion=${app.appVersion} coreApiHash=${app.coreApiHash}（coreApiHash 闸已激活）`);
      loader.release('cck-app-compat', { type: 'json' });
    } catch (e) {
      console.warn(`${tag} app 戳未读到（缺 resources/cck-app-compat.json），coreApiHash 闸休眠：`, (e as Error).message);
    }

    // HotUpdate：ccHotUpdateModule 用 sys.isNative 守门——web 预览下 no-op（HOTUPDATE_BACKEND 不注册），
    // HotUpdateService 回退空后端 → check() 恒 up-to-date（web 不触碰 native.AssetsManager 不崩）。
    // 原生下走「全流程驱动」：check → update(带进度) → apply → restart，真机验证热更闭环。
    console.log(
      `${tag} sys.isNative = ${sys.isNative} → HOTUPDATE_BACKEND registered = ${this.kit.container.has(HOTUPDATE_BACKEND)}（web 应 false）`,
    );
    try {
      const hu = getHotUpdateService();
      const outcome = await hu.check();
      console.log(`${tag} 🔎 HotUpdateService.check() = ${JSON.stringify(outcome)}`);
      if (sys.isNative && outcome.kind === 'update-available') {
        console.log(
          `${tag} ⬇️ 发现新版本 v${outcome.info.version}（${outcome.info.totalBytes ?? '?'} 字节），开始下载...`,
        );
        const up = await hu.update((p) => {
          console.log(
            `${tag} ⏳ 热更进度 ${p.filesDone}/${p.filesTotal} 文件 · ${p.bytesDone}/${p.bytesTotal} 字节`,
          );
        });
        console.log(`${tag} 📦 HotUpdateService.update() = ${JSON.stringify(up)}`);
        if (up.kind === 'ready') {
          console.log(`${tag} ✅ 热更就绪 → 2 秒后 restart 加载新版本（重启后应见 BUILD_TAG = v2）`);
          setTimeout(() => hu.restart(), 2000);
          return; // 等重启，不继续 shutdown
        }
      }
    } catch (e) {
      console.warn(`${tag} HotUpdate 驱动异常：`, (e as Error).message);
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

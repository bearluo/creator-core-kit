import { _decorator, Component, Prefab, director, js } from 'cc';
import { EDITOR } from 'cc/env';
import {
  createBundleUpdater,
  createHotUpdateService,
  defaultLaunchSteps,
  getApp,
  getBundleManager,
  getI18n,
  getRootContainer,
  deviceTierModule,
  setUIVariant,
  APP_INFO,
  BUNDLE_UPDATER,
  DEVICE_PROFILE,
  DEVICE_TIER,
  DISPATCH,
  HOTUPDATE_SERVICE,
  KIT,
  type AppInfo,
  type DispatchResult,
  type LaunchFailure,
  type LaunchStep,
} from '@cck/core';
import {
  appModule,
  bootCoreKit,
  cameraRigModule,
  ccAssetModule,
  ccAudioModule,
  ccBundleModule,
  ccHotUpdateModule,
  ccHttpModule,
  ccNetworkModule,
  ccStorageModule,
  ccUIModule,
  deviceProfileModule,
  getSafeAreaInsets,
  installCrashReporter,
  loadLocaleTable,
  packagedBaseEntry,
  runningBaseEntry,
  baseStamp,
  resetCcHotUpdateOnAppChange,
  resolutionModule,
} from '@cck/engine';
import { APP_CONFIG, VEST } from './app-config';
import {
  FOUNDATION_BUNDLE,
  FOUNDATION_CLASS,
  foundationPlayerId,
  type FoundationApi,
} from './foundation-api';
import { createLaunchOverlay } from './LaunchOverlay';

const { ccclass, property } = _decorator;
const TAG = '[CCK-BOOT]';

/**
 * 启动序列 = kit 默认四步 + 项目自己的三步。
 * 这正是 `LaunchStep` 可插拔的用途：登录、SDK 初始化、公告、隐私协议都插在这里，kit 不预设。
 *
 * `onCdnUrl` 把握手下发的内容基址回传给调用方（喂 `ccHotUpdateModule.cdnUrl`）——
 * 热更后端在 kit 装配期就安装了，那时握手还没跑，只能这样惰性接上。
 */
function launchSteps(onCdnUrl: (url: string) => void): readonly LaunchStep[] {
  const steps = Array.from(defaultLaunchSteps()); // 别用 [...x]：Cocos 构建会降级成 [].concat(x)
  const globalI18n: LaunchStep = {
    name: 'demo-i18n',
    phase: 'shared',
    async run() {
      // 先预埋空表再 setLocale，避免「设 locale 时该表尚未加载」的启动告警
      getI18n().addTable('zh', {});
      getI18n().setLocale('zh');
      await loadLocaleTable('zh', 'shared-i18n', { bundle: 'shared' });
      console.log(`${TAG} 全局 i18n 就绪（来自 shared bundle）`);
    },
  };
  /**
   * dispatcher 的判定落点：wsUrl（按本客户端版本路由到的那个部署单元）、cdnUrl（热更内容基址）、
   * serverTimeMs（权威时间，本地时钟玩家可改）。**不建连接** —— 连接归地基层，它要等 hotupdate
   * 跑完才加载。这一步留在这里是因为 cdnUrl 是热更自己要用的，跑不掉。
   *
   * 顺带把**分包热更**接上（注册 `BUNDLE_UPDATER`，`BundleManager.load` 会在真加载前用它把包更到
   * 最新）。排在这里是因为它要的两样东西恰好都在手上：`APP_INFO`（platform 步读出的 app 戳，
   * 喂版本闸）与 `cdnUrl`（内容托管在哪由服务端说了算，换 CDN 只改服务端配置、不发新包）。
   * **必须早于任何 `load()`** —— 最早的是 shared 步。
   *
   * ⚠️ 少了这段注册，加载前更新整条链是**关的**：base 热更把 `cck.vest` 翻成新马甲、重启回来，
   * 新马甲的皮包永远不会被下下来 —— 而 `skin-<马甲>-foundation` 在 `APP_CONFIG.shared` 里，
   * shared 步没有 try/catch，直接就是启动失败，且重试与重装都好不了。
   */
  const netInfo: LaunchStep = {
    name: 'demo-net-info',
    phase: 'dispatch',
    run(ctx) {
      const d = ctx.bag.get(DISPATCH) as DispatchResult | undefined;
      console.log(`${TAG} dispatcher 放行：ws=${d?.wsUrl} cdn=${d?.cdnUrl} t=${d?.serverTimeMs}`);
      if (d?.cdnUrl) onCdnUrl(d.cdnUrl);
      getRootContainer().register(
        BUNDLE_UPDATER,
        {
          useValue: createBundleUpdater({
            app: ctx.bag.get(APP_INFO) as AppInfo | undefined,
            // 报进度用当前阶段：分包更新多半发生在 shared（地基与皮）与 lobby（大厅包）步里，
            // 启动界面据此把进度条在本段内插值，别让整包下载看起来像卡死。
            onProgress: (b, p) => {
              console.log(`${TAG} ⏳ bundle '${b}' 更新 ${p.filesDone}/${p.filesTotal} 文件`);
              ctx.report({
                phase: getApp().phase,
                ratio: p.bytesTotal > 0 ? p.bytesDone / p.bytesTotal : undefined,
                messageKey: 'cck.launch.downloading',
              });
            },
          }),
        },
        { allowOverride: true }, // Game View 停止再播放不重载 JS，根容器里可能还留着上一轮的
      );
      // **base 那条也要拿到同一份 app 戳**。不注册的话 `getHotUpdateService()` 会兜底成
      // `createHotUpdateService()`（无 opts）→ 闸拿到的是 `{ appVersion: '0.0.0' }`、没有
      // coreApiHash → minAppVersion 恒不满足才拒、coreApiHash 单边缺失恒放行，等于整道闸对
      // base 是关的。分包那条由上面的 BUNDLE_UPDATER 带 app，两条路这才走同一道闸。
      // 排这里同样是因为 APP_INFO 已就位，且早于 core 的 hotupdate 步（platform → dispatch → hotupdate）。
      getRootContainer().register(
        HOTUPDATE_SERVICE,
        { useValue: createHotUpdateService({ app: ctx.bag.get(APP_INFO) as AppInfo | undefined }) },
        { allowOverride: true },
      );
      return Promise.resolve();
    },
  };
  /**
   * 地基层 —— 本文件里唯一一处「主包 → 地基」的接触点，**也是唯一允许的一处**。
   *
   * 排在 `hotupdate` **之后**（phase 'shared'）：地基是热更内容，先更新再加载，
   * 拿到的才是新版本。协议 / 登录 / 认证跟着后移到这里，就是这个排序的直接后果。
   *
   * 取类而不是 `import`：主包 import 地基的任何值，都会让那段代码被判给主包（优先级
   * 最高者赢）→ 地基进 base → 热更失效。`@ccclass` 在 bundle 加载执行脚本时已把类注册
   * 进 cc 类表，`js.getClassByName` 是引擎原生的跨 bundle 通道。类型走 `import type`，
   * 编译期擦除，产物里不留痕迹。
   */
  const foundation: LaunchStep = {
    name: 'demo-foundation',
    phase: 'shared',
    async run(ctx) {
      await getBundleManager().load(FOUNDATION_BUNDLE);
      const C = js.getClassByName(FOUNDATION_CLASS) as (new () => FoundationApi) | undefined;
      if (!C) {
        // 地基 bundle 加载了但类没注册 → 十有八九是热更包与本 base 不兼容（构建裁掉了它
        // 引用的符号，ADR-0001），或者 `@ccclass` 名字改了没同步。这条错误值得响亮。
        throw new Error(`地基入口 '${FOUNDATION_CLASS}' 未注册 —— bundle '${FOUNDATION_BUNDLE}' 是否与当前 base 兼容？`);
      }
      await new C().boot(ctx);
    },
  };
  // 按名字定位而不是写死下标——kit 以后往默认序列里加步骤时这里不会错位
  steps.splice(
    steps.findIndex((s) => s.name === 'hotupdate'),
    0,
    netInfo,
  );
  steps.splice(
    steps.findIndex((s) => s.name === 'lobby'),
    0,
    foundation,
    globalI18n,
  );
  return steps;
}

/** 失败原因摊成一行可读文本（各分类携带的字段不同，见 `LaunchFailure`）。 */
function failureDetail(f: LaunchFailure): string {
  switch (f.kind) {
    case 'network':
    case 'fatal': {
      const e = f.error as Error | undefined;
      return e?.stack ?? e?.message ?? String(f.error);
    }
    case 'needFullUpdate':
      return f.reason;
    case 'maintenance':
      return f.notice;
  }
}

/**
 * Boot.scene 唯一的脚本 —— **只做启动**：装配 kit（含常驻相机组 + 横竖屏适配）→ 交给 App 跑启动序列。
 *
 * Boot 除应用重启外**不二次进入**：返回大厅走 `loadScene('Lobby', {bundle:'lobby'})`，不回 Boot。
 * 也不该往 Boot.scene 里加任何内容——它加载完就被换掉。
 *
 * 设计见 apps/demo/docs/scene-and-camera-architecture.md §1 与
 * docs/design/2026-07-31-app-layer-and-bundle-lifecycle-proposal.md。
 */
@ccclass('Bootstrap')
export class Bootstrap extends Component {
  /**
   * 启动界面 prefab。**序列化引用随 Boot.scene 一起进 main 包**，启动第一帧就在手上——
   * 不用路径加载、不依赖任何 bundle，正好覆盖「`shared` 都还没加载」的这段空窗。
   */
  @property(Prefab)
  launchOverlay: Prefab | null = null;

  async start(): Promise<void> {
    // 崩溃上报 —— **第一件事**，这样启动序列自己抛的异常也报得出去。
    // Android 以外整个 no-op（web / 小游戏 / 编辑器预览都不进这条路）。
    //
    // 上下文是**现取**的：这个箭头函数在每次上报时才跑，所以不需要谁在登录成功 / 切场景 /
    // 热更完之后记得来通知它 —— 那种 `setUser()` 式的 API 忘了调就是静默少一块信息。
    // ⚠️ `apk` 与 `base` 是**两个问题、两个字段**，别合并：
    //   `apk`  = 包内 base 入口名（`__cckBaseEntry`）→「这是哪个 APK」，只有发新包才变；
    //   `base` = 这一次实际加载的入口（`__cckBaseRunning`）→「现在跑的是哪一版 base」，
    //            每次 base 热更都变。**堆栈里的行号对的是它**，sourcemap 要按它去查
    //            （`grep releases/` → `source.json` → `cck-manifest symbolicate`）。
    // base 热更之后两者分叉；没热更过时它俩相同。
    installCrashReporter(() => ({
      vest: VEST,
      channel: APP_CONFIG.channel,
      ver: APP_CONFIG.version,
      apk: baseStamp(packagedBaseEntry()) ?? '-',
      base: baseStamp(runningBaseEntry()) ?? '-',
      // 「这是谁」——问地基要，走的还是 `js.getClassByName` 那条唯一接缝（登录态在地基层，
      // 主包 import 不得）。地基没装 / 没登录 / 重连后正在重认证都会是空串，**那是正常状态**：
      // 早于登录的崩溃照样要报出去，只是少这一块。
      player: foundationPlayerId() || '-',
      scene: director.getScene()?.name ?? '-',
    }));

    // 开发期守卫：Creator 的 Game View 停止再播放**不重载 JS 上下文**，模块级状态（含挂在
    // globalThis 上的 DI 根容器）会活着 → 二次 bootCoreKit 抛 'already booted'。
    // 这里 shutdown 后走同一条重启路径（而不是「跳过 boot」）——因为场景已被重置，
    // 上一轮的常驻节点（CCKRig 等）已随之销毁，容器里留的句柄全是失效引用。
    //
    // 用 cc 的编译期常量 EDITOR 圈住：它的语义是「跑在编辑器进程内（含 Game View）」，
    // 正是 JS 上下文会存活的唯一环境；浏览器预览刷新页面、真机进程全新，都用不上。
    // 构建时该常量被内联为 false，整段随之剔除，不进包体。
    // ⚠️ 别改用 PREVIEW：预览引擎包里 `PREVIEW = !EDITOR`，Game View 下它是 false。
    if (EDITOR) {
      const stale = getRootContainer().tryResolve(KIT);
      if (stale) {
        console.log(`${TAG} 检测到上一轮 kit（Game View 重播不重载 JS）→ shutdown 后重启`);
        await stale.shutdown();
      }
    }
    // APK 换了（覆盖安装 / 降级 / 换渠道包）就把上一版攒下的热更缓存整个作废。
    // **必须在 bootCoreKit 之前** —— `ccHotUpdateModule` 一装，`AssetsManagerEx.create()` 就把
    // storagePath 前插进搜索路径了，那之后再删就是在拆一条已经挂上的链。
    // 判据是 `main.js` 烘进来的包内 base 入口名（`window.__cckBaseEntry` → `baseStamp`），没换 /
    // 没开 md5Cache 时原样不动。**不能用运行时 settings.bundleVers** —— base 现在可热更，那个
    // 每更新一次就翻一次，会把刚下好的缓存当成「上一版 APK 的」删掉，死循环（ADR-0017 决策 6）。
    // 少了这段，装了**更旧**的包时引擎那道 `versionGreater` 会判「缓存更新」→ 旧 base 配着
    // 为新 base 编译的模块代码跑，而 coreApiHash 闸救不了（缓存 = 远端 → check 判 up-to-date，
    // 压根不去拉更新戳）。表现就是「装完启动报错，清数据才好」。
    for (const d of resetCcHotUpdateOnAppChange()) console.log(`${TAG} 热更缓存作废 ${d}`);

    // 「跑的是哪个包、哪一版代码」——一行日志，跟上报上下文里那两个字段同源。
    // 没热更过时两者相同；base 热更并重启之后 `base` 变而 `apk` 不变，那正是这两个字段
    // 必须分开的理由。有它才能在 logcat 里当场看出「这台机器现在跑的是哪一版 base」，
    // 不必先造一条崩溃去后台翻。
    console.log(
      `${TAG} 代码版本 | apk=${baseStamp(packagedBaseEntry()) ?? '-'} base=${baseStamp(runningBaseEntry()) ?? '-'}`,
    );

    // 内容基址 —— dispatcher 握手才下发（内容托管在哪由服务端说了算），而热更后端在下面
    // 这一行就装好了，只能惰性接。**base 与分包共用**：两边 check 时都自取 remote manifest
    // 再把基址改到这里；拉不到就退回包内烘的地址。
    let cdnUrl = '';
    const kit = await bootCoreKit({
      modules: [
        // 顺序有意义：先定好设计分辨率，相机组建出来时首次 syncCameras 才拿到正确的 view 状态。
        resolutionModule({
          shortSide: 1080,
          longSide: 1920,
          // 安全区跟着方向变，所以**搭 resolutionModule 这一趟车报**，不另订一份 orientation-change。
          // 这个回调在 apply() 末尾调，设计分辨率已经换完 —— 此刻读到的内缩量才是新方向的那份。
          onOrientationChange: (o) =>
            console.log(
              `${TAG} 方向 → ${o}（设计分辨率已按锁短边重设；竖屏 1080x1920/FIXED_WIDTH、横屏 1920x1080/FIXED_HEIGHT）｜${safeAreaLine()}`,
            ),
        }),
        cameraRigModule(), // 常驻 bg + ui 相机；此后场景一律不自带相机
        ccAssetModule(),
        ccBundleModule(),
        ccHttpModule(), // IHttp（XHR）—— dispatch 启动步要它打握手请求
        ccNetworkModule(), // ISocket（WebSocket）—— 缺了它 createNetwork 会静默回退到空 socket
        // 热更后端。**只在 native 生效**（模块内 `sys.isNative` 守门，web / 预览下不注册 →
        // 启动序列的 `hotupdate` 步走空后端、恒 up-to-date）。
        // - `manifestUrl` 用**裸文件名**：`project.manifest` 放在构建产物 `data/` 根 = APK 内
        //   `assets/` 根 = fileUtils 默认搜索路径，`AssetsManager.create` 直接解析得到（ADR-0006 决策 4）。
        // - 管的是 **base 包**（`src/` + `assets/{main,internal,resources}`，含 `settings.json`）——
        //   换了要重启，`hotupdate` 步 apply 完直接 `restart()` 并 halt 掉本轮启动。
        //   模块 bundle 是另一套（一包一 manifest、加载前更新、免重启），由 BundleManager 那条路走。
        // ⚠️ **热更服务器不可达 = 启动失败**（`ERROR_DOWNLOAD_MANIFEST` → reject → 这一步 throw
        //   → LaunchFailure，可重试）。离线要能进游戏的话得把「检查失败」降级成「无更新」，
        //   那是 core 启动序列的语义改动，没需求前不动。
        ccHotUpdateModule({
          manifestUrl: 'project.manifest',
          compatFilename: 'cck-update-compat.json',
          cdnUrl: () => cdnUrl,
        }),
        ccStorageModule(),
        ccAudioModule(),
        ccUIModule(),
        // 设备画像：启动时读一次的快照。engine 侧按平台取值，Android 上再多走一趟
        // `com.cck.device.CckDevice.readProfile()`（那份 Java 在 native/ 里，跟渠道无关）。
        // 装不装它跟分不分档无关 —— 只想给崩溃上报补设备信息的项目也可以只装这一个。
        deviceProfileModule(),
        // 分档。**demo 的打分策略写在这里，kit 一行经验值都不送** —— 门槛值是项目的事。
        // 没配 `fetchTier`：demo 没有判档服务端，走「本地算 + 缓存」那条路。
        deviceTierModule({
          scoreTier: (p) => {
            // ⚠️ 这几个数字是 **demo 自己的经验值**，不是框架推荐值。
            // 也刻意演示了三个不同来源的信号各怎么用：
            if (p.lastExitReason === 'lowMemory') return 'low'; // 上次是被 OOM 杀的，最硬的证据
            if (p.lowRamDevice === true) return 'low'; // 系统自己认定的低内存机
            const heap = p.processMemoryLimitBytes; // 进程堆上限（Android 独有的稳定常量）
            if (heap !== undefined) return heap < 192 * 1024 * 1024 ? 'low' : 'high';
            // web 上没有堆上限，改看设备总内存（`navigator.deviceMemory`）。
            // ⚠️ 门槛跟上面那条**不是一把尺**：那是进程能用多少，这是整机有多少 —— 所以两条
            // 分支各有各的数字，不能共用常量。而且这一项**只在 HTTPS 下有**，http 页面恒缺席。
            const ram = p.deviceTotalMemoryBytes;
            if (ram !== undefined) return ram < 4 * 1024 ** 3 ? 'low' : 'high';
            // 一个数都没读到（http 下的 H5 / iOS / 没装 CckDevice）→ 不猜，落默认档。
            return 'default';
          },
        }),
        // 只造不跑，launch 在下面显式发起
        appModule(APP_CONFIG, { steps: launchSteps((u) => (cdnUrl = u)) }),
      ],
    });
    console.log(`${TAG} kit 就绪[${kit.modules.join(', ')}] → app.launch()`);
    logDeviceProfile(); // 画像在 install 时就读好了，不必等 launch —— 云端真机上启动会失败
    console.log(`${TAG} ${safeAreaLine()}`);

    // 马甲皮 —— 必须在 `launch()` **之前**定好：第一个界面（登录闸门）就要按它解析包。
    // 之后不再改（换皮是换包，不是运行时切换），转屏那一维由 resolutionModule 自己灌。
    await setUIVariant({ skin: VEST });
    console.log(`${TAG} 马甲皮 → skin='${VEST}'（登记了换皮的界面从 skin-${VEST}-<跟随者> 包取 prefab）`);

    // 进度 / 失败订阅必须在 launch 之前挂上，否则漏掉前几个阶段。
    // 界面在 LaunchOverlay.prefab（kit 只出事件，样式归项目）：一条进度条 + 按失败分类给出路
    //（network→重试 / needFullUpdate→去商店 / fatal→重启），跑到 running 自毁。
    const app = getApp();
    const overlay = createLaunchOverlay(app, this.launchOverlay);
    app.onProgress((p) => {
      console.log(
        `${TAG} 启动阶段 → ${p.phase}${p.ratio === undefined ? '' : ` ${Math.round(p.ratio * 100)}%`}`,
      );
      overlay.onProgress(p);
    });
    app.onFailure((f) => {
      // 摊平成一行字符串：Cocos native 把 JS console 转发到 logcat 时，对象参数一律打成
      // `[object Object]` —— 真机上唯一能看到的失败信息，不能是这个。
      console.error(`${TAG} 启动失败：${f.kind} —— ${failureDetail(f)}`);
      overlay.onFailure(f);
    });
    await app.launch();
    logDeviceTier();
  }
}

/**
 * 安全区探针 —— 确认「这台机器到底缩了多少」的唯一手段。桌面 / 编辑器预览恒返回整屏，
 * 所以只能在设备上问；**模拟器算数**（`cmd overlay enable ...cutout.emulation.hole` 能造挖孔，
 * 实测走的就是同一条 `DisplayCutout` 链路）。全 0 有两种含义（非异形屏 / 平台不给），
 * 分不开也不必分 —— 两种都意味着「不用缩」。
 *
 * ⚠️ 这只是**报数**。按安全区排版是界面自己的事（在界面根上挂引擎内置 `cc.SafeArea`），
 * 业务代码永远不该拿这几个数去手写「往下挪 60 像素」。
 */
function safeAreaLine(): string {
  const i = getSafeAreaInsets();
  return `安全区内缩 上${i.top} 下${i.bottom} 左${i.left} 右${i.right}（设计单位，全 0 = 不用缩）`;
}

/**
 * 把设备画像打进日志。**真机验证靠它** —— 这条链上大半环节（JNI 桥、`/sys` 读不读得到、
 * 厂商 ROM 收没收紧）本机单测一条都覆盖不到，只能到真机上看。
 *
 * ⚠️ **调用点必须在 `boot()` 之后、`launch()` 之前**：画像是 `deviceProfileModule.install()`
 * 时就读好的，跟启动序列毫无关系。挂在 `launch()` 之后看着也能出，但那要赌「启动失败之后
 * 还能往下走到这一行」—— 而**云端真机连不到内网的 dispatcher，启动必然失败**，云测跑一次
 * 就废一次。放这儿，启动成不成功都照打。
 *
 * 摊平成一行：Cocos native 把 JS console 转发到 logcat 时，对象参数一律打成 `[object Object]`。
 */
function logDeviceProfile(): void {
  const p = getRootContainer().tryResolve(DEVICE_PROFILE);
  if (!p) {
    console.log(`${TAG} 设备画像未装（没注册 deviceProfileModule）`);
    return;
  }
  const mb = (n?: number): string => (n === undefined ? '-' : `${Math.round(n / 1024 / 1024)}MB`);
  console.log(
    `${TAG} 设备画像 | 堆上限=${mb(p.processMemoryLimitBytes)} 总内存=${mb(p.deviceTotalMemoryBytes)} ` +
      `可用=${mb(p.availableMemoryBytes)} lowRam=${p.lowRamDevice ?? '-'} ` +
      `核数=${p.cpuCores ?? '-'} 主频=${p.cpuMaxFreqKHz ?? '-'}kHz dpi=${p.densityDpi ?? '-'} ` +
      `屏幕=${p.screenWidthPx ?? '-'}x${p.screenHeightPx ?? '-'}`,
  );
  console.log(
    `${TAG} 设备画像 | ${p.brand ?? '-'}/${p.model ?? '-'} soc=${p.socModel ?? '-'} abis=${p.abis ?? '-'} ` +
      `os=${p.osVersion ?? '-'} gpu=${p.gpuRenderer ?? '-'} astc=${p.supportsAstc ?? '-'} ` +
      `etc2=${p.supportsEtc2 ?? '-'} maxTex=${p.maxTextureSize ?? '-'} 上次退出=${p.lastExitReason ?? '-'}`,
  );
  // ⭐ 这一行最要紧：**无值且在清单里 = 本该读到却没读到**，那正是「某批机型上打分静默降级了」
  // 的唯一信号。空清单才是好消息。
  console.log(`${TAG} 设备画像 | readFailures=[${p.readFailures.join(', ')}]`);
}

/**
 * 档位。**这个才必须等 `launch()`** —— 判档是启动序列的 `tier` 步做的，
 * 启动没跑到那一步（比如热更失败）时它恒为 `default/default/skipped`，那也是如实的。
 */
function logDeviceTier(): void {
  const t = getRootContainer().tryResolve(DEVICE_TIER);
  if (!t) {
    console.log(`${TAG} 分档未装（没注册 deviceTierModule）`);
    return;
  }
  console.log(`${TAG} 档位 → ${t.tier}（来源 ${t.source}，服务器 ${t.serverOutcome}）`);
}

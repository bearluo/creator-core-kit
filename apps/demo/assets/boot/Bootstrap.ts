import { _decorator, Component, Prefab, js } from 'cc';
import { EDITOR } from 'cc/env';
import {
  defaultLaunchSteps,
  getApp,
  getBundleManager,
  getI18n,
  getRootContainer,
  setUIVariant,
  DISPATCH,
  KIT,
  type DispatchResult,
  type LaunchStep,
} from '@cck/core';
import {
  appModule,
  bootCoreKit,
  cameraRigModule,
  ccAssetModule,
  ccAudioModule,
  ccBundleModule,
  ccHttpModule,
  ccNetworkModule,
  ccStorageModule,
  ccUIModule,
  loadLocaleTable,
  resolutionModule,
} from '@cck/engine';
import { APP_CONFIG, VEST } from './app-config';
import { FOUNDATION_BUNDLE, FOUNDATION_CLASS, type FoundationApi } from './foundation-api';
import { createLaunchOverlay } from './LaunchOverlay';

const { ccclass, property } = _decorator;
const TAG = '[CCK-BOOT]';

/**
 * 启动序列 = kit 默认四步 + 项目自己的三步。
 * 这正是 `LaunchStep` 可插拔的用途：登录、SDK 初始化、公告、隐私协议都插在这里，kit 不预设。
 */
function launchSteps(): readonly LaunchStep[] {
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
  // dispatcher 的判定落点：wsUrl（按本客户端版本路由到的那个部署单元）、cdnUrl（热更内容
  // 基址）、serverTimeMs（权威时间，本地时钟玩家可改）。**只打日志不建连接** —— 连接归地基层，
  // 它要等 hotupdate 跑完才加载。这一步留在这里是因为 cdnUrl 是热更自己要用的，跑不掉。
  const netInfo: LaunchStep = {
    name: 'demo-net-info',
    phase: 'dispatch',
    run(ctx) {
      const d = ctx.bag.get(DISPATCH) as DispatchResult | undefined;
      console.log(`${TAG} dispatcher 放行：ws=${d?.wsUrl} cdn=${d?.cdnUrl} t=${d?.serverTimeMs}`);
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
   * 最高者赢）→ 地基进 AOT → 热更失效。`@ccclass` 在 bundle 加载执行脚本时已把类注册
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
        // 地基 bundle 加载了但类没注册 → 十有八九是热更包与本 AOT 不兼容（构建裁掉了它
        // 引用的符号，ADR-0001），或者 `@ccclass` 名字改了没同步。这条错误值得响亮。
        throw new Error(`地基入口 '${FOUNDATION_CLASS}' 未注册 —— bundle '${FOUNDATION_BUNDLE}' 是否与当前 AOT 兼容？`);
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
    const kit = await bootCoreKit({
      modules: [
        // 顺序有意义：先定好设计分辨率，相机组建出来时首次 syncCameras 才拿到正确的 view 状态。
        resolutionModule({
          shortSide: 1080,
          longSide: 1920,
          onOrientationChange: (o) =>
            console.log(
              `${TAG} 方向 → ${o}（设计分辨率已按锁短边重设；竖屏 1080x1920/FIXED_WIDTH、横屏 1920x1080/FIXED_HEIGHT）`,
            ),
        }),
        cameraRigModule(), // 常驻 bg + ui 相机；此后场景一律不自带相机
        ccAssetModule(),
        ccBundleModule(),
        ccHttpModule(), // IHttp（XHR）—— dispatch 启动步要它打握手请求
        ccNetworkModule(), // ISocket（WebSocket）—— 缺了它 createNetwork 会静默回退到空 socket

        ccStorageModule(),
        ccAudioModule(),
        ccUIModule(),
        appModule(APP_CONFIG, { steps: launchSteps() }), // 只造不跑，launch 在下面显式发起
      ],
    });
    console.log(`${TAG} kit 就绪[${kit.modules.join(', ')}] → app.launch()`);

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
      console.error(`${TAG} 启动失败：${f.kind}`, f);
      overlay.onFailure(f);
    });
    await app.launch();
  }
}

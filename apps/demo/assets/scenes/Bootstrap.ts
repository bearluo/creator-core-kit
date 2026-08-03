import { _decorator, Component, Prefab } from 'cc';
import { EDITOR } from 'cc/env';
import {
  defaultLaunchSteps,
  getApp,
  getI18n,
  getRootContainer,
  KIT,
  type AppConfig,
  type LaunchStep,
} from '@cck/core';
import {
  appModule,
  bootCoreKit,
  cameraRigModule,
  ccAssetModule,
  ccAudioModule,
  ccBundleModule,
  ccStorageModule,
  ccUIModule,
  loadLocaleTable,
  loadScene,
  resolutionModule,
} from '@cck/engine';
import { createLaunchOverlay } from './LaunchOverlay';

const { ccclass, property } = _decorator;
const TAG = '[CCK-BOOT]';

/**
 * 应用配置 —— 版本 / 渠道 / 环境 / 包分层集中在这一处。
 *
 * 包分层（判据是「启动期加载且被跨模块持有引用」，不是「哪个包」）：
 * - **重启层**：引擎 + AOT chunks（@cck/core、@cck/engine 全部框架代码）、main 包（本文件 + Boot.scene）
 * - **启动期换**：`shared`、`lobby` —— 启动序列 load 时用的就是新版本，更新天然生效
 * - **运行期换**：按需业务 bundle（shop / mini-clicker / mini-dodge）
 */
const APP_CONFIG: AppConfig = {
  appId: 'cck-demo',
  version: '1.0.0',
  channel: 'dev',
  env: 'dev',
  shared: ['shared'],
  lobby: {
    bundle: 'lobby',
    // core 不持场景接缝（切场景是 engine 直接行为）→ 进大厅这一下由这里给。
    enter: () => loadScene('Lobby', { bundle: 'lobby' }),
  },
  // versionUrl 不配：demo 的热更走 native AssetsManager 那条已 e2e 验证的路径（ADR-0006）。
  // web 版本表要真 CDN 才有意义，接入方按 env 拼自己的地址。
};

/**
 * 启动序列 = kit 默认四步 + 项目自己的一步。
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
  // 按名字定位而不是写死下标——kit 以后往默认序列里加步骤时这里不会错位
  steps.splice(
    steps.findIndex((s) => s.name === 'lobby'),
    0,
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
        ccStorageModule(),
        ccAudioModule(),
        ccUIModule(),
        appModule(APP_CONFIG, { steps: launchSteps() }), // 只造不跑，launch 在下面显式发起
      ],
    });
    console.log(`${TAG} kit 就绪[${kit.modules.join(', ')}] → app.launch()`);

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

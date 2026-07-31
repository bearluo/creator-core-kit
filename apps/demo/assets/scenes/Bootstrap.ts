import { _decorator, Component } from 'cc';
import { EDITOR } from 'cc/env';
import { getI18n, getRootContainer, KIT } from '@cck/core';
import {
  bootCoreKit,
  cameraRigModule,
  ccAssetModule,
  ccAudioModule,
  ccBundleModule,
  ccStorageModule,
  ccUIModule,
  loadScene,
  resolutionModule,
} from '@cck/engine';

const { ccclass, property } = _decorator;
const TAG = '[CCK-BOOT]';

/**
 * Boot.scene 唯一的脚本 —— **只做启动**：初始化 kit（含常驻相机组 + 横竖屏适配）后切到配置的第一个场景。
 *
 * Boot 除应用重启外**不二次进入**：返回大厅走 `loadScene('Lobby')`，不回 Boot。
 * 也不该往 Boot.scene 里加任何内容——它加载完就被换掉。
 *
 * 设计见 apps/demo/docs/scene-and-camera-architecture.md §1。
 */
@ccclass('Bootstrap')
export class Bootstrap extends Component {
  @property({ tooltip: 'kit 初始化完成后进入的第一个场景（主场景 / 返回目标）' })
  firstScene = 'Lobby';

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
      ],
    });
    // 'zh' 作基准 locale；先预埋空表再 setLocale，避免「设 locale 时该表尚未加载」的启动告警。
    getI18n().addTable('zh', {});
    getI18n().setLocale('zh');
    console.log(`${TAG} kit 就绪[${kit.modules.join(', ')}] → loadScene('${this.firstScene}')`);
    await loadScene(this.firstScene);
  }
}

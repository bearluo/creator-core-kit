import { _decorator, Component } from 'cc';
import { loadHud, releaseGameArt, wireHud } from '../../foundation/game/stage';

const { ccclass } = _decorator;
const TAG = '[CCK-DODGE]';

/** 本模块的 bundle 名（= `modules/mini-dodge` 目录名），也是这张 prefab 的释放组。 */
const BUNDLE = 'mini-dodge';

/**
 * mini-dodge · game 类全屏子游戏样例（kind:'game'）——演示「模块自带 .scene + 切场景 + 常驻框架存活 + 返回」。
 *
 * 挂在 mini-dodge bundle 自带的 `Dodge.scene` 里。host 经 `bundle.loadScene('Dodge')` 切到本场景（gap#4）。
 * **本场景不自带相机、不套 Canvas**：kit 的常驻相机组（`cameraRigModule`）跨场景存活，只要内容在 `UI_2D` 层
 * 就会被它的 ui 相机渲染；本场景根节点自带 `RenderRoot2D` 作 2D 渲染入口。见 apps/demo/docs/scene-and-camera-architecture.md。
 *
 * 这一款**没有玩法**，所以整个场景就是那张 `Hud.prefab`（标题三行字 + 返回），
 * 本文件只剩「装上它、给返回接线」两句 —— 界面一个字都不在代码里。
 *
 * 「返回大厅」走 `foundation/game` 的 {@link wireHud} —— 里头一句 `getGameHost().exit()`。
 * 本文件既不 import 主包、也不认识 EventBus：子游戏跟外面的往来只经那一份契约。
 *
 * 真游戏玩法非本样例重点（重点是分包场景 + 栈式导航 + 跨场景常驻），能玩的看 mini-plane /
 * mini-brick / mini-shooter / mini-hop。
 */
@ccclass('DodgeGame')
export class DodgeGame extends Component {
  async start(): Promise<void> {
    // 挂在自身节点（本节点即场景渲染根 RenderRoot2D）——随场景销毁而回收，不碰 kit 常驻挂载点。
    const hud = await loadHud(this.node, BUNDLE);
    if (!hud) return; // 加载期间被切走了
    wireHud(hud);
    console.log(`${TAG} Dodge.scene 启动（mini-dodge bundle 自带场景；kit 常驻相机组渲染本场景内容）`);
  }

  onDestroy(): void {
    releaseGameArt(BUNDLE);
  }
}

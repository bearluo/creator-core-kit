import { _decorator, Color, Component, Label } from 'cc';
import { exitButton, gameLabel } from '../../foundation/game/stage';

const { ccclass } = _decorator;
const TAG = '[CCK-DODGE]';

/**
 * mini-dodge · game 类全屏子游戏样例（kind:'game'）——演示「模块自带 .scene + 切场景 + 常驻框架存活 + 返回」。
 *
 * 挂在 mini-dodge bundle 自带的 `Dodge.scene` 里。host 经 `bundle.loadScene('Dodge')` 切到本场景（gap#4）。
 * **本场景不自带相机、不套 Canvas**：kit 的常驻相机组（`cameraRigModule`）跨场景存活，只要内容在 `UI_2D` 层
 * 就会被它的 ui 相机渲染；本场景根节点自带 `RenderRoot2D` 作 2D 渲染入口。见 apps/demo/docs/scene-and-camera-architecture.md。
 *
 * 「返回大厅」走 `foundation/game` 的 {@link exitButton} —— 里头一句 `getGameHost().exit()`。
 * 本文件既不 import 主包、也不认识 EventBus：子游戏跟外面的往来只经那一份契约。
 *
 * 真游戏玩法非本样例重点（重点是分包场景 + 栈式导航 + 跨场景常驻），能玩的看 mini-plane /
 * mini-brick / mini-shooter / mini-hop；这里只放标题 + 返回按钮。
 */
@ccclass('DodgeGame')
export class DodgeGame extends Component {
  start(): void {
    console.log(`${TAG} Dodge.scene 启动（mini-dodge bundle 自带场景；kit 常驻相机组渲染本场景内容）`);
    // 在自身节点建 UI（本节点即场景渲染根 RenderRoot2D）——随场景销毁而回收，不碰 kit 常驻挂载点。
    const parent = this.node;
    at(gameLabel(parent, 'Title', 44, new Color(255, 180, 120), [620, 56]), 140, '🎮 mini-dodge');
    at(
      gameLabel(parent, 'Line1', 22, new Color(180, 185, 195), [620, 34]),
      70,
      '这是 mini-dodge 自己 bundle 里的 Dodge.scene（kind:game）',
    );
    at(
      gameLabel(parent, 'Line2', 20, new Color(140, 160, 180), [620, 32]),
      30,
      '本场景无相机无 Canvas——kit 常驻相机组在渲染它',
    );
    const back = exitButton(parent, { fontSize: 34, box: [340, 64] });
    back.node.setPosition(0, -70, 0);
  }
}

/** 摆一行字（尺寸已由 {@link gameLabel} 定好，这里只填内容和位置）。 */
function at(label: Label, y: number, text: string): void {
  label.string = text;
  label.node.setPosition(0, y, 0);
}

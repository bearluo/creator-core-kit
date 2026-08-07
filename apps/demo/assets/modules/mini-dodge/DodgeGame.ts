import { _decorator, Component, Node, Label, UITransform, Layers, Color } from 'cc';
import { getEventBus } from '@cck/core';
import { LOBBY_EVENTS, type LobbyEventMap } from '../../foundation/events';

const { ccclass } = _decorator;
const TAG = '[CCK-DODGE]';

/**
 * mini-dodge · game 类全屏子游戏样例（kind:'game'）——演示「模块自带 .scene + 切场景 + 常驻框架存活 + 返回」。
 *
 * 挂在 mini-dodge bundle 自带的 `Dodge.scene` 里。host 经 `bundle.loadScene('Dodge')` 切到本场景（gap#4）。
 * **本场景不自带相机、不套 Canvas**：kit 的常驻相机组（`cameraRigModule`）跨场景存活，只要内容在 `UI_2D` 层
 * 就会被它的 ui 相机渲染；本场景根节点自带 `RenderRoot2D` 作 2D 渲染入口。见 apps/demo/docs/scene-and-camera-architecture.md。
 * 「返回大厅」不 import 主包：走 core EventBus emit `lobby:back` 通知 host → host `sceneflow.pop()` → 切回 Lobby + release bundle。
 * 真游戏玩法非本样例重点（重点是分包场景 + 栈式导航 + 跨场景常驻）；这里只放标题 + 返回按钮。
 */
@ccclass('DodgeGame')
export class DodgeGame extends Component {
  start(): void {
    console.log(`${TAG} Dodge.scene 启动（mini-dodge bundle 自带场景；kit 常驻相机组渲染本场景内容）`);
    // 在自身节点建 UI（本节点即场景渲染根 RenderRoot2D）——随场景销毁而回收，不碰 kit 常驻挂载点。
    const parent = this.node;
    makeLabel(parent, '🎮 mini-dodge', 140, 44, new Color(255, 180, 120));
    makeLabel(parent, '这是 mini-dodge 自己 bundle 里的 Dodge.scene（kind:game）', 70, 22, new Color(180, 185, 195));
    makeLabel(parent, '本场景无相机无 Canvas——kit 常驻相机组在渲染它', 30, 20, new Color(140, 160, 180));
    const back = makeLabel(parent, '← 返回大厅', -70, 34, new Color(120, 220, 160));
    back.getComponent(UITransform)!.setContentSize(340, 64);
    back.node.on(Node.EventType.TOUCH_END, () => {
      console.log(`${TAG} 点返回 → emit '${LOBBY_EVENTS.back}'（不 import 主包，走 core EventBus 解耦）`);
      getEventBus<LobbyEventMap>().emit(LOBBY_EVENTS.back);
    });
  }
}

function makeLabel(parent: Node, text: string, y: number, fontSize: number, color: Color): Label {
  const node = new Node('Label');
  node.layer = Layers.Enum.UI_2D;
  parent.addChild(node);
  node.setPosition(0, y, 0);
  node.addComponent(UITransform).setContentSize(620, fontSize + 12);
  const label = node.addComponent(Label);
  label.string = text;
  label.fontSize = fontSize;
  label.lineHeight = fontSize + 8;
  label.color = color;
  return label;
}

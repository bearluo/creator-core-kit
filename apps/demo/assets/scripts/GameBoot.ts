import { _decorator, Component, Node, Label, UITransform, Canvas, Color, Layers, director } from 'cc';
import {
  bootCoreKit,
  ccAssetModule,
  ccStorageModule,
  ccAudioModule,
  ccUIModule,
  bindText,
  BindingScope,
} from '@cck/engine';
import type { Kit } from '@cck/core';
import { CounterVM } from './CounterVM';

const { ccclass, property } = _decorator;

/**
 * 新项目「怎么接入 creator-core-kit」的最小样例（是样例，不是测试）。
 *
 * 全流程三步，正是 kit 的用法骨架：
 *   1) bootCoreKit —— 组合根，一句话装配你项目需要的 cc 适配模块（asset/storage/audio/ui/...）；
 *   2) 纯逻辑 ViewModel（CounterVM，零 cc、可单测）承载状态与行为；
 *   3) 代码化 UI + 数据绑定（bindText）把 VM 状态单向映射到 cc 节点 —— UI 与逻辑分离、数据驱动。
 *
 * 挂在 Boot.scene 的一个空节点上；UI 全部在代码里建（符合「一个空引导场景 + 代码化 UI 优先」协作约定，
 * prefab 冲突从源头消灭）。复杂界面则改走 UIManager.open(prefab)（见 DemoBoot 的 UIManager 样例）。
 */
@ccclass('GameBoot')
export class GameBoot extends Component {
  /** 场景里的 Canvas；不填则自动找场景第一个 Canvas。真实项目在 Inspector 里拖一个进来即可。 */
  @property(Node)
  uiRoot: Node | null = null;

  private kit?: Kit;
  private readonly binds = new BindingScope();

  async start(): Promise<void> {
    // —— 第 1 步：启动 kit（挑你项目要用的 cc 适配模块，按需增删）——
    this.kit = await bootCoreKit({
      modules: [ccAssetModule(), ccStorageModule(), ccAudioModule(), ccUIModule()],
    });
    console.log(`[GameBoot] kit 启动 → modules = [${this.kit.modules.join(', ')}]`);

    // —— 第 2 步：纯逻辑 ViewModel（零 cc）——
    const vm = new CounterVM();

    // —— 第 3 步：代码化 UI + 数据绑定 ——
    const root = (this.uiRoot?.isValid && this.uiRoot) || this.findCanvas();
    if (!root) {
      console.error('[GameBoot] 场景里没有 Canvas，UI 无处挂载');
      return;
    }
    this.makeLabel(root, 'creator-core-kit 接入样例', 130, 30, new Color(120, 200, 255));
    const countLabel = this.makeLabel(root, '', 40, 44, Color.WHITE);
    this.makeButton(root, '＋1', -50, () => vm.increment());
    this.makeButton(root, '重置', -130, () => vm.reset());

    // 单向数据流：VM.display 变 → countLabel 文本自动刷新。首帧同步刷一次，之后随 signal 变化自动跟。
    this.binds.add(bindText(countLabel, () => vm.display.value));
  }

  onDestroy(): void {
    this.binds.dispose(); // 一行解绑所有 binding（照抄进你的界面组件 onDestroy）
    void this.kit?.shutdown();
  }

  /** 场景第一个 Canvas 节点（UI 挂它下面，才有 UI 相机渲染）。 */
  private findCanvas(): Node | null {
    return director.getScene()?.getComponentInChildren(Canvas)?.node ?? null;
  }

  /** 代码建一个居中文本节点。UI 节点必须落在 UI_2D 层，否则 UI 相机不渲染（代码建 UI 最常见的坑）。 */
  private makeLabel(parent: Node, text: string, y: number, fontSize: number, color: Color): Label {
    const node = new Node('Label');
    node.layer = Layers.Enum.UI_2D;
    parent.addChild(node);
    node.setPosition(0, y, 0);
    node.addComponent(UITransform).setContentSize(520, fontSize + 12);
    const label = node.addComponent(Label);
    label.string = text;
    label.fontSize = fontSize;
    label.lineHeight = fontSize + 8;
    label.color = color;
    return label;
  }

  /** 纯文本按钮：无需 Sprite 背景，直接监听节点触摸区（UITransform 定 hit box）。 */
  private makeButton(parent: Node, text: string, y: number, onClick: () => void): void {
    const label = this.makeLabel(parent, text, y, 32, new Color(255, 220, 120));
    label.getComponent(UITransform)!.setContentSize(220, 60);
    label.node.on(Node.EventType.TOUCH_END, onClick, this);
  }
}

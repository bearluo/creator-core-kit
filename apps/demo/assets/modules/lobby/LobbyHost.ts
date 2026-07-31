import { _decorator, Color, Component, Label, Layers, Node, UITransform } from 'cc';
import {
  createBundleScope,
  createSceneFlow,
  getBundleManager,
  getEventBus,
  getRootContainer,
  getUIManager,
  KIT,
  type Disposer,
  type Kit,
  type SceneFlow,
} from '@cck/core';
import { loadScene } from '@cck/engine';
import { MODULE_CATALOG, registerCatalogUIs, type CatalogEntry } from './module-catalog';
import type { ModuleContext } from './ModuleContext';
import { LOBBY_EVENTS, type LobbyEventMap } from './lobby-events';

export { LOBBY_EVENTS } from './lobby-events';

const { ccclass } = _decorator;
const TAG = '[CCK-LOBBY]';
/** 主场景 / 返回目标。返回大厅是重进本场景，不回 Boot。 */
const LOBBY_SCENE = 'Lobby';
/** 大厅自己就是一个 bundle（可热更、可替换）——场景也在包内，切回来要带 bundle 名。 */
const LOBBY_BUNDLE = 'lobby';

/**
 * 大厅导航大脑（module-level 单例）——按 catalog 导航、按需 load→mount→release 模块。
 *
 * 状态分两类：
 * - **跨场景常驻**（`flow` / `backSub` / `pendingGame`）：只初始化一次。Lobby.scene 会被 game 场景
 *   顶掉再重新加载，但 JS 模块不随 loadScene 重载，所以单例活着。
 * - **场景内节点**（`lobbyPanel`）：随 Lobby.scene 销毁重建，不做常驻。模块面板不在此列——
 *   它们由 UIManager 挂进 kit 常驻相机组的层容器（跨场景存活），host 只持 `openPanel` 这份账。
 *
 * 相机 / 屏幕适配**不在这里** —— kit 的常驻相机组（`cameraRigModule`）在 Boot 阶段建好并跨场景存活。
 * 设计见 apps/demo/docs/scene-and-camera-architecture.md。
 */
class LobbyNav {
  private static _inst?: LobbyNav;
  static instance(): LobbyNav {
    return (LobbyNav._inst ??= new LobbyNav());
  }

  private flow?: SceneFlow;
  private backSub?: Disposer;
  private pendingGame?: CatalogEntry;
  /** 导航状态是绑在哪个 Kit 上建的——kit 换了（预览重播 shutdown→reboot）就得整套重建。 */
  private navKit?: Kit;

  private lobbyPanel?: Node;
  private openPanel?: { entry: CatalogEntry; ctx: ModuleContext };

  /** Lobby.scene 每次加载都调用：在场景里重建大厅 UI；导航常驻状态只初始化一次。 */
  enterLobby(root: Node): void {
    registerCatalogUIs(); // 清单 → UIManager 注册表（幂等，重复登记覆盖）
    this.buildLobbyUI(root);
    const kit = getRootContainer().tryResolve(KIT);
    if (!kit) {
      // 直接播放 Lobby.scene（预览起始场景取「当前打开场景」）会走到这：没经过 Boot →
      // 没有 kit、没有相机组，画面全黑且模块打不开。给一条能照着做的错误，别让人瞎找。
      console.error(`${TAG} 未初始化 kit：本场景要求先经 Boot.scene 启动（编辑器里请打开 Boot.scene 再播放）`);
    }
    if (this.flow && this.navKit === kit) {
      console.log(`${TAG} Lobby.scene 重新加载 → 大厅 UI 已重建（导航状态跨场景常驻）`);
      return;
    }
    // kit 变了：上一轮的 EventBus/SceneFlow 都已随 shutdown 作废，旧订阅永远收不到事件。
    this.backSub?.();
    this.navKit = kit;
    this.flow = createSceneFlow();
    this.flow
      .add({ name: 'lobby', onResume: () => void this.returnedFromGame() })
      .add({ name: 'game', onEnter: () => void this.enterGameScene() });
    this.flow.start('lobby');
    this.backSub = getEventBus<LobbyEventMap>().on(LOBBY_EVENTS.back, () => void this.onGameBack());
    console.log(`${TAG} 首次进入大厅：SceneFlow + 返回事件订阅就绪`);
  }

  // —— 大厅导航 UI（数据驱动：只吃 MODULE_CATALOG）——
  private buildLobbyUI(root: Node): void {
    // 大厅内容全挂在场景自己的渲染根下（随场景回收）。模块面板不再自建挂载层——
    // 交给 UIManager 挂进 kit 常驻相机组的对应层容器（z 序由层枚举顺序定，不由打开顺序定）。
    this.lobbyPanel = new Node('LobbyPanel');
    this.lobbyPanel.layer = Layers.Enum.UI_2D;
    root.addChild(this.lobbyPanel);

    const panel = this.lobbyPanel;
    makeLabel(panel, '大厅 · Lobby', 200, 40, new Color(120, 200, 255));
    makeLabel(panel, '点下面任一功能 → 按需加载它的 bundle', 150, 22, new Color(150, 160, 180));
    let y = 60;
    for (const entry of MODULE_CATALOG) {
      const tag = entry.kind === 'game' ? '🎮' : '🧩';
      makeButton(panel, `${tag} ${entry.title}`, y, () => void this.openModule(entry));
      y -= 80;
    }
  }

  /** 打开一个 catalog 模块（panel 挂本场景；game 走 SceneFlow 切自带场景）。 */
  async openModule(entry: CatalogEntry): Promise<void> {
    if (this.openPanel || this.pendingGame) {
      console.warn(`${TAG} 已有模块打开，忽略 openModule('${entry.id}')`);
      return;
    }
    console.log(`${TAG} openModule('${entry.id}') kind=${entry.kind} → load('${entry.bundle}')`);
    await getBundleManager().load(entry.bundle);
    if (entry.kind === 'game') {
      this.pendingGame = entry;
      this.flow!.push('game'); // → 'game'.onEnter → enterGameScene
    } else {
      await this.mountPanel(entry);
    }
  }

  // —— panel：建 bundle 作用域 → UIManager.open（prefab/层来自注册表，界面脚本随 prefab 一起被 instantiate）——
  private async mountPanel(entry: CatalogEntry): Promise<void> {
    const container = getRootContainer().createScope(`module:${entry.id}`);
    const scope = createBundleScope(entry.bundle);
    scope.add(() => container.dispose()); // DI 子作用域也挂进同一条回收链，别让调用点记两笔账
    const ctx: ModuleContext = {
      container,
      bundle: entry.bundle,
      scope,
      args: undefined,
      close: () => void this.closePanel(),
    };
    this.openPanel = { entry, ctx };
    if (this.lobbyPanel?.isValid) this.lobbyPanel.active = false; // 面板占屏时收起大厅
    // ctx 就是 args：UIManager 透传给界面的 onShow(args, state)
    const ok = await getUIManager().open(entry.id, ctx);
    if (!ok) {
      console.error(`${TAG} 模块 '${entry.id}' 打开失败（prefab 缺失或未注册）→ 回滚`);
      this.openPanel = undefined;
      await scope.dispose(); // 回滚也走同一条链：子作用域 + release(bundle) 一并撤
      if (this.lobbyPanel?.isValid) this.lobbyPanel.active = true;
      return;
    }
    console.log(`${TAG} 模块 '${entry.id}' 打开完成（i18n/prefab 已随 bundle 就绪）`);
  }

  private async closePanel(): Promise<void> {
    const o = this.openPanel;
    if (!o) return;
    this.openPanel = undefined;
    // 一行全撤：closeByBundle（先销毁界面实例——换版本后旧类实例即成孤儿）→ 逆序回收登记项
    //（i18n / 配表 / 资源 / DI 子作用域）→ 最后 release(bundle)。顺序由 kit 的 BundleScope 保证。
    await o.ctx.scope.dispose();
    if (this.lobbyPanel?.isValid) this.lobbyPanel.active = true;
    console.log(
      `${TAG} 模块 '${o.entry.id}' 关闭：scope.dispose 一行全撤 → isLoaded=${getBundleManager().isLoaded(o.entry.bundle)}`,
    );
  }

  // —— game：SceneFlow push/pop + bundle 自带场景；相机由 kit 常驻相机组统一提供 ——
  private async enterGameScene(): Promise<void> {
    const e = this.pendingGame!;
    console.log(`${TAG} 进入 game 场景 '${e.scene}'（bundle 内自带场景；相机走 kit 常驻相机组，无需切换）`);
    await loadScene(e.scene!, { bundle: e.bundle }); // gap#4：bundle.loadScene → runScene
  }

  private async onGameBack(): Promise<void> {
    if (!this.pendingGame) return;
    this.flow!.pop(); // → 'lobby'.onResume → returnedFromGame
  }

  private async returnedFromGame(): Promise<void> {
    const e = this.pendingGame;
    this.pendingGame = undefined;
    await loadScene(LOBBY_SCENE, { bundle: LOBBY_BUNDLE }); // 重进主场景（LobbyHost.start → enterLobby 重建大厅 UI）
    if (e) getBundleManager().release(e.bundle); // 场景换完才卸 bundle（它自带的场景还在跑时不能卸）
    console.log(`${TAG} 返回大厅：loadScene('${LOBBY_SCENE}') + release('${e?.bundle}')`);
  }
}

/**
 * Lobby.scene 的宿主组件 —— 挂在场景渲染根（`UITransform` + `RenderRoot2D` + 满屏 `Widget`）上。
 * 每次加载 Lobby.scene 都会新建本组件实例；导航状态在 module-level 的 `LobbyNav` 单例里跨场景常驻。
 */
@ccclass('LobbyHost')
export class LobbyHost extends Component {
  start(): void {
    LobbyNav.instance().enterLobby(this.node);
  }
}

// —— 代码化 UI 小工具（仅大厅导航用；模块面板走各自 bundle 的 prefab）——
// UI 节点必须置 UI_2D 层，否则 ui 相机 visibility 不含 DEFAULT → 不可见（见记忆 cocos-codeui-and-scene-authoring）。
function makeLabel(parent: Node, text: string, y: number, fontSize: number, color: Color): Label {
  const node = new Node('Label');
  node.layer = Layers.Enum.UI_2D;
  parent.addChild(node);
  node.setPosition(0, y, 0);
  node.addComponent(UITransform).setContentSize(560, fontSize + 12);
  const label = node.addComponent(Label);
  label.string = text;
  label.fontSize = fontSize;
  label.lineHeight = fontSize + 8;
  label.color = color;
  return label;
}

function makeButton(parent: Node, text: string, y: number, onClick: () => void): void {
  const label = makeLabel(parent, text, y, 34, new Color(255, 220, 120));
  label.getComponent(UITransform)!.setContentSize(360, 66);
  label.node.on(Node.EventType.TOUCH_END, onClick);
}

import { _decorator, Component, Label, Node, instantiate, type Prefab } from 'cc';
import {
  createBundleScope,
  createSceneFlow,
  createToken,
  getAssetLoader,
  getBundleManager,
  getEventBus,
  getRootContainer,
  getUIManager,
  KIT,
  type Disposer,
  type Kit,
  type SceneFlow,
  type Token,
} from '@cck/core';
import { loadScene } from '@cck/engine';
import { GATEWAY_MIGRATION } from '../../foundation/net/migration';
import { currentSkinBundle, MODULE_CATALOG, type CatalogEntry } from '../../foundation/catalog';
import type { ModuleContext } from '../../foundation/ModuleContext';
import { LOBBY_EVENTS, type LobbyEventMap } from '../../foundation/events';

export { LOBBY_EVENTS } from '../../foundation/events';

const { ccclass } = _decorator;
const TAG = '[CCK-LOBBY]';
/** 主场景 / 返回目标。返回大厅是重进本场景，不回 Boot。 */
const LOBBY_SCENE = 'Lobby';
/** 大厅自己就是一个 bundle（可热更、可替换）——场景也在包内，切回来要带 bundle 名。 */
const LOBBY_BUNDLE = 'lobby';
/** prefab 上的节点契约。改 prefab 时**别改这些名字**，否则这里静默取不到。 */
const N_ITEMS = 'Items';
const N_ITEM_LABEL = 'Label';
/**
 * 大厅骨架在**自己那个皮包**里的位置（`skin-<马甲>-lobby`）——大厅是马甲的第二张脸，
 * 每套皮各画各的。这两份**不经 UIManager**：它们随 `Lobby.scene` 生死、挂在场景自己的渲染根下。
 */
const P_PANEL = 'LobbyPanel';
const P_ITEM = 'LobbyItem';
/** 条目行距。纯布局参数——真要做滚动列表就换成 `Layout` 组件，这里够用。 */
const ITEM_GAP = 80;

/** DI token：当前 kit 的大厅导航实例。见 {@link resolveNav}——**不做模块级单例**。 */
const LOBBY_NAV: Token<LobbyNav> = createToken<LobbyNav>('demo.lobbyNav');

/**
 * 取当前 kit 的导航实例：存在 DI 根容器里、按 kit 归属，kit 换了就撤旧建新。
 *
 * 为什么不写成 `static instance()`：模块级单例的生命周期是「JS 模块」，而 JS 模块既不随
 * `loadScene` 重载、也不随 bundle 卸载消失（`CLAUDE.md` §业务开发三条硬规则 / ADR-0010），
 * 状态只会越攒越脏。放进容器后归属是显式的——一个 kit 一份，换 kit 直接可见。
 *
 * 为什么 kit 换了**必须整份重建**而不能沿用：`flow` 绑的是上一轮的世界，而 `coreModule.stop`
 * 会注销 `EVENT_BUS`，新 kit 拿到的是**全新总线**——旧订阅留在孤儿总线上永远收不到 `lobby:back`，
 * 只有重新 `enterLobby` 才会在新总线上重新订阅。
 *
 * 顺带 `dispose()` 旧的：撤 disposer、清 flow/pendingGame/面板引用，不留悬挂状态。
 */
function resolveNav(): LobbyNav {
  const root = getRootContainer();
  const kit = root.tryResolve(KIT);
  if (!kit) {
    // 直接播放 Lobby.scene（预览起始场景取「当前打开场景」）会走到这：没经过 Boot →
    // 没有 kit、没有相机组，画面全黑且模块打不开。给一条能照着做的错误，别让人瞎找。
    console.error(`${TAG} 未初始化 kit：本场景要求先经 Boot.scene 启动（编辑器里请打开 Boot.scene 再播放）`);
  }
  const current = root.tryResolve(LOBBY_NAV);
  if (current && current.kit === kit) return current;
  current?.dispose(); // 预览重播 shutdown→reboot：撤掉上一轮挂在存活 EventBus 上的订阅
  const nav = new LobbyNav(kit);
  root.register(LOBBY_NAV, { useValue: nav }, { allowOverride: true });
  return nav;
}

/**
 * 大厅导航大脑——按 catalog 导航、按需 load→mount→release 模块。一个 kit 一份，由
 * {@link resolveNav} 从 DI 容器取，**不是模块级单例**。
 *
 * 状态分两类：
 * - **跨场景常驻**（`flow` / `backSub` / `pendingGame`）：只初始化一次。Lobby.scene 会被 game
 *   场景顶掉再重新加载，而本实例挂在容器上、不随场景走。
 * - **场景内节点**（`lobbyPanel`）：随 Lobby.scene 销毁重建，不做常驻。模块面板不在此列——
 *   它们由 UIManager 挂进 kit 常驻相机组的层容器（跨场景存活），host 只持 `openPanel` 这份账。
 *
 * 相机 / 屏幕适配**不在这里** —— kit 的常驻相机组（`cameraRigModule`）在 Boot 阶段建好并跨场景存活。
 * 设计见 apps/demo/docs/scene-and-camera-architecture.md。
 */
class LobbyNav {
  /** 本实例属于哪个 kit。`resolveNav` 靠它判断该不该整份重建。 */
  constructor(readonly kit: Kit | undefined) {}

  private flow?: SceneFlow;
  private backSub?: Disposer;
  private pendingGame?: CatalogEntry;

  private lobbyPanel?: Node;
  private openPanel?: { entry: CatalogEntry; ctx: ModuleContext };

  /** Lobby.scene 每次加载都调用：在场景里重建大厅 UI；导航常驻状态只初始化一次。 */
  async enterLobby(root: Node): Promise<void> {
    // 清单 → UIManager 注册表这一下由**地基层**在启动时做掉了（`Foundation.boot`）：
    // 它比大厅早、且只做一次，大厅这里只管按清单画按钮。
    await this.buildLobbyUI(root);
    // 「回到大厅」= 本 demo 选定的网关搬家时机（没在退休时是 no-op）。
    // 契约只规定「收到 GatewayRetiring 后择机重新握手」，时机由客户端定：真实项目还可以
    // 挑战斗结算后、切场景前等等。搬家期间连接不断，玩家无感。
    void getRootContainer().tryResolve(GATEWAY_MIGRATION)?.atSafePoint();
    if (this.flow) {
      console.log(`${TAG} Lobby.scene 重新加载 → 大厅 UI 已重建（导航状态跨场景常驻）`);
      return;
    }
    this.flow = createSceneFlow();
    this.flow
      .add({ name: 'lobby', onResume: () => void this.returnedFromGame() })
      .add({ name: 'game', onEnter: () => void this.enterGameScene() });
    this.flow.start('lobby');
    this.backSub = getEventBus<LobbyEventMap>().on(LOBBY_EVENTS.back, () => void this.onGameBack());
    console.log(`${TAG} 首次进入大厅：SceneFlow + 返回事件订阅就绪`);
  }

  /** 撤掉本实例挂在**比 kit 活得久**的东西上的账（目前只有 EventBus 订阅）。 */
  dispose(): void {
    this.backSub?.();
    this.backSub = undefined;
    this.flow = undefined;
    this.pendingGame = undefined;
    this.lobbyPanel = undefined;
    this.openPanel = undefined;
  }

  // —— 大厅导航 UI（数据驱动：布局吃 LobbyPanel.prefab，条目吃 MODULE_CATALOG × LobbyItem.prefab）——
  private async buildLobbyUI(root: Node): Promise<void> {
    // 从**大厅自己那个皮包**取这两份，而不是 `@property(Prefab)` 序列化绑定 —— 后者绑的是
    // lobby bundle 内的固定资源，换皮换不掉（这正是它以前的样子）。
    //
    // 皮包由**本模块自己装**（不在 `APP_CONFIG.shared` 里）：大厅的脸只有进了大厅才用得上，
    // 塞进启动期的地基皮包就是让每个马甲的首包都背着它。装了不卸 —— 大厅是常驻场景，
    // 从 game 场景返回还要重建一次 UI。
    const bundle = currentSkinBundle('lobby');
    let panelPrefab: Prefab;
    let itemPrefab: Prefab;
    try {
      await getBundleManager().load(bundle);
      [panelPrefab, itemPrefab] = await Promise.all([
        getAssetLoader().load<Prefab>(P_PANEL, { type: 'prefab', bundle }),
        getAssetLoader().load<Prefab>(P_ITEM, { type: 'prefab', bundle }),
      ]);
    } catch (e) {
      // 这个马甲没配大厅皮包，或包里没放齐那两份 —— 每套皮都得补齐（见 catalog.ts 的 skinBundle 注释）。
      console.error(`${TAG} 皮包 '${bundle}' 缺失或里头没有 ${P_PANEL} / ${P_ITEM} → 大厅空白：${String(e)}`);
      return;
    }
    // 大厅内容全挂在场景自己的渲染根下（随场景回收）。模块面板不再自建挂载层——
    // 交给 UIManager 挂进 kit 常驻相机组的对应层容器（z 序由层枚举顺序定，不由打开顺序定）。
    this.lobbyPanel = instantiate(panelPrefab);
    root.addChild(this.lobbyPanel);

    // 条目按清单逐条克隆模板：**代码只填数据和事件**，字号 / 配色 / 底图都在 LobbyItem.prefab 上。
    const items = this.lobbyPanel.getChildByName(N_ITEMS);
    if (!items) {
      console.error(`${TAG} LobbyPanel.prefab 里找不到 '${N_ITEMS}' 容器节点 → 无功能入口`);
      return;
    }
    MODULE_CATALOG.forEach((entry, i) => {
      const node = instantiate(itemPrefab);
      items.addChild(node);
      node.setPosition(0, -i * ITEM_GAP, 0);
      const label = node.getChildByName(N_ITEM_LABEL)?.getComponent(Label);
      if (label) label.string = `${entry.kind === 'game' ? '🎮' : '🧩'} ${entry.title}`;
      node.on(Node.EventType.TOUCH_END, () => void this.openModule(entry));
    });
  }

  /**
   * 这个模块要额外装的皮包 —— 换皮的模块脸不在自己包里，在 `skin-<马甲>-<id>` 里。
   * **跟模块包同生共死**：一起装、一起卸，玩家不点就一个字节都不下。
   */
  private skinOf(entry: CatalogEntry): string | undefined {
    return entry.skinned ? currentSkinBundle(entry.id) : undefined;
  }

  /** 打开一个 catalog 模块（panel 挂本场景；game 走 SceneFlow 切自带场景）。 */
  async openModule(entry: CatalogEntry): Promise<void> {
    if (this.openPanel || this.pendingGame) {
      console.warn(`${TAG} 已有模块打开，忽略 openModule('${entry.id}')`);
      return;
    }
    const skin = this.skinOf(entry);
    console.log(`${TAG} openModule('${entry.id}') kind=${entry.kind} → load('${entry.bundle}')${skin ? ` + 皮包 '${skin}'` : ''}`);
    // 两个包并行装：脚本在模块包、脸在皮包，缺一个界面就起不来
    const packs = skin ? [entry.bundle, skin] : [entry.bundle];
    await Promise.all(packs.map((b) => getBundleManager().load(b)));
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
    // 皮包也挂进同一条链，**必须在 container 之后 add**：teardown 逆序执行 → 皮包这条先跑。
    //
    // ⚠️ 界面实例是被**这条**销毁的，不是被 `scope.dispose()` 的第一步：那一步
    // `closeByBundle(entry.bundle)` 按**解析后**的 bundle 比对，而换皮界面解析出来的是皮包名
    // → 对 skinned 模块是 no-op。少了这条就只 release 包不销毁界面，留下一堆孤儿组件。
    const skin = this.skinOf(entry);
    if (skin) {
      const skinScope = createBundleScope(skin);
      scope.add(() => skinScope.dispose());
    }
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
    if (e) {
      // 场景换完才卸 bundle（它自带的场景还在跑时不能卸）。皮包跟模块包一起卸 ——
      // openModule 是一起装的，这里漏一个就是泄漏。
      getBundleManager().release(e.bundle);
      const skin = this.skinOf(e);
      if (skin) getBundleManager().release(skin);
    }
    console.log(`${TAG} 返回大厅：loadScene('${LOBBY_SCENE}') + release('${e?.bundle}')`);
  }
}

/**
 * Lobby.scene 的宿主组件 —— 挂在场景渲染根（`UITransform` + `RenderRoot2D` + 满屏 `Widget`）上。
 * 每次加载 Lobby.scene 都会新建本组件实例；导航状态在 DI 容器里的 `LobbyNav`（一个 kit 一份）
 * 跨场景常驻，见 {@link resolveNav}。
 */
@ccclass('LobbyHost')
export class LobbyHost extends Component {
  /**
   * 大厅面板与条目模板**不再是 `@property(Prefab)` 序列化引用** —— 那是编辑器期绑定，绑死在
   * lobby bundle 里，马甲换不掉。改由 {@link LobbyNav.enterLobby} 从当前皮肤包按路径取
   *（`lobby/LobbyPanel`、`lobby/LobbyItem`）。所以本组件现在**一个可配属性都没有**。
   */
  start(): void {
    void resolveNav().enterLobby(this.node);
  }
}

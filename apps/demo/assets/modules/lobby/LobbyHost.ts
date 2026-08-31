import {
  _decorator,
  Component,
  Label,
  Mask,
  Node,
  ScrollView,
  UITransform,
  instantiate,
  view,
  type Prefab,
} from 'cc';
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
import { GAME_HOST } from '../../foundation/game/host';
import { GATEWAY_MIGRATION } from '../../foundation/net/migration';
import { currentSkinBundle, MODULE_CATALOG, type CatalogEntry } from '../../foundation/catalog';
import type { ModuleContext } from '../../foundation/ModuleContext';
import { LOBBY_EVENTS, type LobbyEventMap } from '../../foundation/events';
import { gridLayout } from './grid';

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
/** 条目间距。条目**尺寸**不写这里——读 `LobbyItem.prefab` 实例的 `UITransform`，各马甲各画各的。 */
const ITEM_GAP_X = 24;
const ITEM_GAP_Y = 14;
/** 列表区四周留白（设计单位）。 */
const EDGE = 40;

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
  /** 正在装包、还没落到 `openPanel`/`pendingGame` 的那一个 —— 见 {@link openModule}。 */
  private opening?: string;

  private lobbyPanel?: Node;
  private openPanel?: { entry: CatalogEntry; ctx: ModuleContext };
  /** 入口列表的滚动视图（挂在 prefab 的 `Items` 上）。随场景生死，见 {@link relayout}。 */
  private scroll?: ScrollView;
  private itemNodes: Node[] = [];
  /** prefab 里 `Items` 的原始 y —— 设计者指定的「第一个条目中心」，两套皮各写各的。 */
  private itemsY = 0;

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
    this.opening = undefined;
    this.lobbyPanel = undefined;
    this.openPanel = undefined;
    this.scroll = undefined;
    this.itemNodes = [];
  }

  // —— 大厅导航 UI（数据驱动：布局吃 LobbyPanel.prefab，条目吃 MODULE_CATALOG × LobbyItem.prefab）——
  private async buildLobbyUI(root: Node): Promise<void> {
    // 从**大厅自己那个皮包**取这两份，而不是 `@property(Prefab)` 序列化绑定 —— 后者绑的是
    // lobby bundle 内的固定资源，换皮换不掉（这正是它以前的样子）。
    //
    // 皮包**已经在内存里**：它是 `lobby` 在依赖表里的一条 `needs`（`foundation/bundles.ts`），
    // 随 lobby 一起装、一起卸。大厅的脸只有进了大厅才用得上，塞进启动期的地基皮包就是让
    // 每个马甲的首包都背着它。
    const bundle = currentSkinBundle('lobby');
    let panelPrefab: Prefab;
    let itemPrefab: Prefab;
    try {
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
    // `Items` 在 prefab 里是个**空容器**（只有 UITransform，条目一个都没有），位置就是设计者
    // 指定的「第一个条目中心」——两套皮各写各的（base 面板内 y=60，vest 满屏 y=520），所以
    // 读它、不硬编码。它自己的尺寸随后被视口覆盖。
    this.itemsY = items.position.y;
    // 就地装成滚动视图：Mask 裁掉视口外的、ScrollView 负责拖动。**内容节点由代码建** ——
    // 条目位置本来就是算出来的（见 grid.ts），prefab 里没有也不该有它们的坑位。
    // ⚠️ ScrollView 认的「视口」是 `content.parent`，所以 Mask 必须挂在 content 的父节点上。
    items.addComponent(Mask);
    const scroll = items.addComponent(ScrollView);
    const content = new Node('Content');
    content.layer = items.layer; // 不置 UI_2D 层的节点不渲染（子节点跟着遭殃）
    content.addComponent(UITransform).setAnchorPoint(0, 1); // 内容从左上角长出去
    items.addChild(content);
    scroll.content = content;
    scroll.elastic = true;
    this.scroll = scroll;
    this.itemNodes = [];

    MODULE_CATALOG.forEach((entry) => {
      const node = instantiate(itemPrefab);
      content.addChild(node);
      const label = node.getChildByName(N_ITEM_LABEL)?.getComponent(Label);
      if (label) label.string = itemText(entry);
      // 更新失败现在一路抛上来（BundleUpdater 不再退回包内版本）——不接住就只剩「点了没反应」
      // 拖动时不会误触发：ScrollView 的 `cancelInnerEvents` 默认 true，滚起来就把子节点的
      // 触摸取消掉（触点几乎没动的情况下才照常派发 TOUCH_END）。
      node.on(Node.EventType.TOUCH_END, () => {
        this.openModule(entry).catch((e: unknown) =>
          console.error(`${TAG} 打开模块 '${entry.id}' 失败（多半是热更没下来）`, e),
        );
      });
      this.itemNodes.push(node);
    });
    this.relayout();
  }

  /**
   * 按当前横竖屏重排入口列表 —— **竖屏上下滚、横屏左右滚**，装得下就不滚。
   *
   * 由 {@link LobbyHost} 在场景启动和每次 `canvas-resize` 时调用（转屏走的就是这条）。
   * 算式在 `grid.ts`（零 `cc`、有单测），这里只负责把算出来的数字塞给节点。
   */
  relayout(): void {
    const scroll = this.scroll;
    const content = scroll?.content;
    if (!scroll?.isValid || !content?.isValid || !this.itemNodes.length) return;
    const items = scroll.node;
    const size = view.getVisibleSize();
    const halfH = size.height / 2;
    const horizontal = size.width > size.height;

    // 列表区：上沿取 prefab 指定的位置，**但不许跑出屏幕** —— 竖屏 prefab 的坐标（vest 的
    // Title 在 y=720）在横屏 1080 高的屏上是屏外，不夹一下列表整个看不见。
    const first = this.itemNodes[0].getComponent(UITransform);
    const itemW = first?.width ?? 0;
    const itemH = first?.height ?? 0;
    const top = Math.min(this.itemsY + itemH / 2, halfH - EDGE);
    const bottom = -halfH + EDGE;

    const g = gridLayout({
      count: this.itemNodes.length,
      itemW,
      itemH,
      gapX: ITEM_GAP_X,
      gapY: ITEM_GAP_Y,
      availW: size.width - EDGE * 2,
      availH: top - bottom,
      horizontal,
    });

    items.getComponent(UITransform)!.setContentSize(g.viewW, g.viewH);
    items.setPosition(0, top - g.viewH / 2, 0); // 视口横向居中、上沿贴 top
    content.getComponent(UITransform)!.setContentSize(g.contentW, g.contentH);
    content.setPosition(-g.viewW / 2, g.viewH / 2, 0); // 锚点 (0,1) → 这就是视口左上角
    g.slots.forEach((s, i) => this.itemNodes[i].setPosition(s.x, s.y, 0));
    scroll.horizontal = horizontal;
    scroll.vertical = !horizontal;
  }

  /**
   * 这个模块要额外装的皮包 —— 换皮的模块脸不在自己包里，在 `skin-<马甲>-<id>` 里。
   * **跟模块包同生共死**：一起装、一起卸，玩家不点就一个字节都不下。
   */
  private skinOf(entry: CatalogEntry): string | undefined {
    return entry.skinned ? currentSkinBundle(entry.id) : undefined;
  }

  /**
   * 打开一个 catalog 模块（panel 挂本场景；game 走 SceneFlow 切自带场景）。
   *
   * **占坑要占在 `await` 之前**：`openPanel` / `pendingGame` 都是 `load(bundle)` 回来之后才落的，
   * 只拿它们当守卫的话，包还在下的那几秒里第二次点击照样进得来 —— 两个模块都装上，
   * 后一个把前一个的记录覆盖掉，前一个的 `scope` 从此没人 dispose（bundle 引用 + DI 子作用域 +
   * 界面实例一起漏，界面还赖在屏幕上）。首次从 CDN 下包时这个窗口有好几秒，双击就能踩到。
   */
  async openModule(entry: CatalogEntry): Promise<void> {
    if (this.opening || this.openPanel || this.pendingGame) {
      console.warn(`${TAG} 已有模块打开/正在打开，忽略 openModule('${entry.id}')`);
      return;
    }
    this.opening = entry.id;
    try {
      console.log(`${TAG} openModule('${entry.id}') kind=${entry.kind} → load('${entry.bundle}')`);
      // 换皮模块的脸在皮包里，但**这里不用管** —— 皮包是它在依赖表里的一条 `needs`，
      // `load` 会先把它装上并各加一次引用，`release` 时对称减掉。
      await getBundleManager().load(entry.bundle);
      if (entry.kind === 'game') {
        this.pendingGame = entry;
        this.flow!.push('game'); // → 'game'.onEnter → enterGameScene
      } else {
        await this.mountPanel(entry);
      }
    } finally {
      this.opening = undefined;
    }
  }

  // —— panel：建 bundle 作用域 → UIManager.open（prefab/层来自注册表，界面脚本随 prefab 一起被 instantiate）——
  private async mountPanel(entry: CatalogEntry): Promise<void> {
    const container = getRootContainer().createScope(`module:${entry.id}`);
    const scope = createBundleScope(entry.bundle);
    scope.add(() => container.dispose()); // DI 子作用域也挂进同一条回收链，别让调用点记两笔账
    // 皮包的界面回收也挂进同一条链，**必须在 container 之后 add**：teardown 逆序执行 → 这条先跑。
    //
    // ⚠️ 界面实例是被**这条**销毁的，不是被 `scope.dispose()` 的第一步：那一步
    // `closeByBundle(entry.bundle)` 按**解析后**的 bundle 比对，而换皮界面解析出来的是皮包名
    // → 对 skinned 模块是 no-op。少了这条就只 release 包不销毁界面，留下一堆孤儿组件。
    // 这里**只关界面、不 release 皮包** —— 皮包的引用是 `load(模块包)` 按依赖表加上的，
    // 由 `scope.dispose()` 里的 `release(模块包)` 对称减掉，再减一次就是负债。
    const skin = this.skinOf(entry);
    if (skin) scope.add(() => getUIManager().closeByBundle(skin));
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
      // 场景换完才卸 bundle（它自带的场景还在跑时不能卸）。皮包不用单列 ——
      // 它是模块包的一条 `needs`，引用计数会跟着一起归零。
      getBundleManager().release(e.bundle);
    }
    console.log(`${TAG} 返回大厅：loadScene('${LOBBY_SCENE}') + release('${e?.bundle}')`);
  }
}

/**
 * 大厅按钮上写什么。game 类顺带把**历史最好成绩**写上。
 *
 * 这是「子游戏 → 大厅」那条回路唯一看得见的地方：游戏结束时 `GameHost.submit(id, score)`，
 * 回到大厅（`Lobby.scene` 重新加载 → 重建 UI）按钮上就变了。**大厅不认识任何一个游戏** ——
 * 它只按 id 读一个数，不知道那分是打砖块还是吃硬币来的。
 *
 * `tryResolve` 而不是 `getGameHost()`：大厅在编辑器里被单独播放时地基没起来，这里该显示
 * 「没有成绩」而不是抛异常炸掉整个列表。
 */
function itemText(entry: CatalogEntry): string {
  const icon = entry.kind === 'game' ? '🎮' : '🧩';
  if (entry.kind !== 'game') return `${icon} ${entry.title}`;
  const best = getRootContainer().tryResolve(GAME_HOST)?.best(entry.id) ?? 0;
  return best > 0 ? `${icon} ${entry.title}  最好 ${best}` : `${icon} ${entry.title}`;
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
    // 转屏要重排入口列表（竖屏上下滚 / 横屏左右滚）。同方向内的窗口缩放也会来，
    // 照样重算——网格是按可用区算的，窗口变窄就该少一列。
    view.on('canvas-resize', this.relayout, this);
  }

  onDestroy(): void {
    view.off('canvas-resize', this.relayout, this);
  }

  /** 转发给导航实例（UI 节点归它持有）。列表还没建好时是 no-op。 */
  private relayout(): void {
    resolveNav().relayout();
  }
}

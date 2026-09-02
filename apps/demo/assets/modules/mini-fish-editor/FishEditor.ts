import {
  Button,
  Color,
  Component,
  EditBox,
  EventKeyboard,
  EventMouse,
  EventTouch,
  Graphics,
  Input,
  KeyCode,
  Label,
  Node,
  Prefab,
  ScrollView,
  Slider,
  Sprite,
  SpriteAtlas,
  Toggle,
  UITransform,
  Vec2,
  Vec3,
  _decorator,
  input,
  instantiate,
} from 'cc';
import { effect, type Disposer } from '@cck/core';
import {
  exitButton,
  gameNode,
  loadGameAsset,
  loadGameAtlas,
  releaseGameArt,
} from '../../foundation/game/stage';
import { scopedKey } from '../../foundation/net/auth';
import { FISH_KINDS, fishKind } from '../mini-fish/content/fish-kinds';
import { FIELD, fishPath, makeFishPath, pointAt, segmentCount } from '../mini-fish/content/paths';
import { CONTENT } from '../mini-fish/content/content';
import { waveFeeder } from '../mini-fish/seams/feeder';
import { Angle, Fish } from '../mini-fish/ecs/components';
import { FishVM } from '../mini-fish/FishVM';
import { EditorVM, type EditorStorage } from './EditorVM';
import { defineQuery, Position } from '@cck/ecs-bitecs';

const { ccclass } = _decorator;

/** 自己那个包（prefab 从这儿取）。 */
const BUNDLE = 'mini-fish-editor';
/** 鱼的图集在**捕鱼**包里 —— 动态取，所以本包的 `deps` 保持为空（见设计文档 §3）。 */
const FISH_BUNDLE = 'mini-fish';

/** 画布节点（prefab 里 `Body/Stage/Board`）的尺寸，缩放的分母。 */
const BOARD = { width: 1240, height: 872 };
/** `z = 1` 时一屏看多大一片世界：比场地大一圈，因为控制点故意伸到屏外。 */
const VIEW = { width: FIELD.width * 1.3, height: FIELD.height * 1.5 };
const BASE = BOARD.width / VIEW.width;
const ZOOM = { min: 0.25, max: 4 };
/** 命中半径在**屏幕上**恒定：放大之后不该更难点中。 */
const HIT_PX = 22;

const COL_DIM = new Color(48, 78, 96);
const COL_CURVE = new Color(71, 200, 192);
const COL_HANDLE = new Color(240, 160, 60);
const COL_ANCHOR = new Color(232, 240, 246);
const COL_CORNER = new Color(224, 87, 79);
const COL_FIELD = new Color(34, 64, 79);
const COL_ROW = new Color(24, 46, 58);
const COL_ROW_ON = new Color(240, 160, 60);
const COL_ROW_WAVE_ON = new Color(71, 200, 192);
const COL_TEXT = new Color(207, 224, 234);
const COL_DIMTEXT = new Color(125, 154, 171);
const COL_FAINT = new Color(77, 107, 125);
const COL_BAD = new Color(224, 87, 79);
const COL_WARN_TEXT = new Color(246, 195, 126);
const TAB_ON = new Color(240, 160, 60, 90);
const TAB_OFF = new Color(24, 46, 58, 0);

const fishQuery = defineQuery([Fish, Position]);

/**
 * 内容编辑器的 View —— **只做仓规允许的四件事**：instantiate prefab、建绑定、把屏幕坐标转成
 * 世界坐标后转发给 {@link EditorVM}、转发生命周期。曲线和控制点用 `Graphics` 画（绘制不是逻辑）。
 *
 * 界面全在五张 prefab 里（`EditorPanel` 外壳 + `PathPage` / `WavePage` 两页 + `PathItem` /
 * `GroupItem` 两张列表项），本类只按名字取节点接线。验收单是
 * `apps/demo/docs/mockups/fish-editor-v2-prototype.html`。
 *
 * 预览**直接跑游戏本体的 `FishVM`**（`aiAgents: []` ⇒ 只剩玩家那门炮，而它不 `aim()` 就永不
 * 开火 ⇒ 无子弹、无结算、只有鱼在游）。自己写一份插值等于抵消编辑器存在的理由 —— 恒速、朝向、
 * 离场三处行为各有两份实现，迟早漂，而漂的那天你信的是编辑器、错的是游戏。
 *
 * **哪些状态留在这儿不进 VM**：页签、正在拖第几个点、镜像修饰键、每条路径的显影、两个名称
 * 筛选、平移缩放。它们都是「怎么看」不是「编的是什么」，一个字节都不许进导出。
 */
@ccclass('FishEditor')
export class FishEditor extends Component {
  private vm?: EditorVM;
  private preview?: FishVM;
  private atlas?: SpriteAtlas;
  private pathItem?: Prefab;
  private groupItem?: Prefab;
  private stop?: Disposer;

  private root?: Node;
  private board?: Node;
  private gfx?: Graphics;
  private fishes?: Node;
  private pathPage?: Node;
  private wavePage?: Node;
  private banner?: Node;
  private popup?: Node;
  private scrub?: Slider;
  private readonly fishNodes = new Map<number, Node>();

  // —— View 自己的状态（不进 VM、不进导出）——
  private tab: 'path' | 'wave' = 'path';
  private readonly hidden = new Set<string>();
  private showLines = true;
  private filterPath = '';
  private filterWave = '';
  private readonly view = { cx: 0, cy: 0, z: 1 };
  /** 正在拖第几个控制点；`-1` = 没在拖。 */
  private dragging = -1;
  private panFrom?: { x: number; y: number; cx: number; cy: number };
  private space = false;
  private alt = false;

  private playing = false;
  private clock = 0;
  private duration = 8;
  private saveIn = 0;

  async start(): Promise<void> {
    const [panel, pathPage, wavePage, pathItem, groupItem, atlas] = await Promise.all([
      loadGameAsset<Prefab>(this.node, BUNDLE, 'EditorPanel'),
      loadGameAsset<Prefab>(this.node, BUNDLE, 'PathPage'),
      loadGameAsset<Prefab>(this.node, BUNDLE, 'WavePage'),
      loadGameAsset<Prefab>(this.node, BUNDLE, 'PathItem'),
      loadGameAsset<Prefab>(this.node, BUNDLE, 'GroupItem'),
      loadGameAtlas(this.node, FISH_BUNDLE, 'textures'),
    ]);
    // 加载期间被切走了 —— 那是取消不是失败，安静收摊
    if (!panel || !pathPage || !wavePage || !pathItem || !groupItem || !this.node.isValid) return;
    this.pathItem = pathItem;
    this.groupItem = groupItem;
    this.atlas = atlas ?? undefined;

    this.vm = new EditorVM(CONTENT, {
      storage: webStorage(),
      storageKey: scopedKey('cck.fishEditorDraft'),
    });

    const root = instantiate(panel);
    this.node.addChild(root);
    this.root = root;
    this.pathPage = instantiate(pathPage);
    this.wavePage = instantiate(wavePage);
    at(root, 'Body/PathPageMount')?.addChild(this.pathPage);
    at(root, 'Body/WavePageMount')?.addChild(this.wavePage);

    this.bindPanel(root);
    this.bindPage(this.pathPage, 'path');
    this.bindPage(this.wavePage, 'wave');
    exitButton(this.node, { fontSize: 15, box: [110, 30], text: '← 大厅' }).node.setPosition(-880, 502);

    input.on(Input.EventType.KEY_DOWN, this.onKey, this);
    input.on(Input.EventType.KEY_UP, this.onKey, this);

    this.fitView();
    // 整体重画：编辑器不是每帧刷新的东西，细粒度绑定不值那个代码量
    this.stop = effect(() => {
      void this.vm!.changed.value; // 订阅它
      this.rebuild();
    });
    this.restartPreview();
  }

  onDestroy(): void {
    this.stop?.();
    input.off(Input.EventType.KEY_DOWN, this.onKey, this);
    input.off(Input.EventType.KEY_UP, this.onKey, this);
    // FishVM 没有 dispose —— 它只持 ECS world 和几个纯对象，丢掉引用就完了
    this.preview = undefined;
    releaseGameArt(BUNDLE);
    releaseGameArt(FISH_BUNDLE);
  }

  update(dt: number): void {
    if (!this.vm) return;
    if (this.playing) {
      this.clock += dt;
      if (this.clock >= this.duration) {
        this.clock = this.duration;
        this.playing = false;
        this.setText('Body/Stage/Transport/BtnPlay/Label', '▶ 播放');
      } else {
        this.preview?.tick(dt);
      }
      this.syncFish();
      this.drawBar();
    }
    // 草稿 debounce 落盘：改动后 1.5 秒没再动就存一次
    if (this.saveIn > 0) {
      this.saveIn -= dt;
      if (this.saveIn <= 0) this.vm.saveDraft();
    }
  }

  // —— 接线：外壳 ————————————————————————————————————————————————

  private bindPanel(root: Node): void {
    this.board = at(root, 'Body/Stage/Board');
    this.gfx = this.board?.getComponent(Graphics) ?? undefined;
    this.fishes = at(root, 'Body/Stage/Fish');
    this.banner = at(root, 'Banner');
    this.scrub = at(root, 'Body/Stage/Transport/Scrub')?.getComponent(Slider) ?? undefined;

    // 页签：切的是 active，不换 prefab（同包内动态加载省不了下载，只换来闪烁）
    this.onToggle(at(root, 'Topbar/Left/Tabs/TabPath'), () => this.switchTab('path'));
    this.onToggle(at(root, 'Topbar/Left/Tabs/TabWave'), () => this.switchTab('wave'));

    this.tap(at(root, 'Topbar/Right/BtnDraft'), () => this.vm!.saveDraft());
    this.tap(at(root, 'Topbar/Right/BtnExport'), () => this.exportContent());
    this.tap(at(root, 'Banner/BtnRestore'), () => {
      this.vm!.restoreDraft();
      this.restartPreview();
    });
    this.tap(at(root, 'Banner/BtnDiscard'), () => {
      this.vm!.discardDraft();
      if (this.banner) this.banner.active = false;
    });

    this.tap(at(root, 'Body/Stage/ViewBar/BtnFit'), () => {
      this.fitView();
      this.afterView();
    });
    this.tap(at(root, 'Body/Stage/ViewBar/BtnLines'), () => {
      this.showLines = !this.showLines;
      this.setText('Body/Stage/ViewBar/BtnLines/Label', this.showLines ? '◉ 路线' : '◌ 路线');
      this.draw();
    });

    this.tap(at(root, 'Body/Stage/Transport/BtnPlay'), () => this.togglePlay());
    this.tap(at(root, 'Body/Stage/Transport/BtnHome'), () => this.seek(0));
    this.tap(at(root, 'Body/Stage/Transport/BtnStepB'), () => this.seek(this.clock - 0.1));
    this.tap(at(root, 'Body/Stage/Transport/BtnStepF'), () => this.seek(this.clock + 0.1));
    this.scrub?.node.on('slide', () => this.seek(this.scrub!.progress * this.duration), this);

    this.bindStage(at(root, 'Body/Stage'));

    const info = this.vm!.draftInfo();
    if (this.banner) this.banner.active = info !== null;
    if (info) this.setText('Banner/Text', `有一份未导出的草稿（基于 rev ${info.rev}）`);
  }

  /** 画布上的三件事：拖控制点、平移、缩放。 */
  private bindStage(stage: Node | undefined): void {
    if (!stage || !this.board) return;

    stage.on(Node.EventType.MOUSE_DOWN, (e: EventMouse) => {
      if (e.getButton() === EventMouse.BUTTON_MIDDLE) this.startPan(e.getUILocation());
    });
    stage.on(Node.EventType.MOUSE_WHEEL, (e: EventMouse) => {
      // 让**光标底下那个点**不动：先记它的世界坐标，缩放后把视野中心挪回去让它落回原处。
      // 不这么做的话滚轮永远朝画布中心缩，想看的东西会跑出屏幕。
      const p = e.getUILocation();
      const [wx, wy] = this.toWorld(p.x, p.y);
      const z = this.view.z * (e.getScrollY() > 0 ? 1.15 : 1 / 1.15);
      this.view.z = Math.max(ZOOM.min, Math.min(ZOOM.max, z));
      const [ax, ay] = this.toWorld(p.x, p.y);
      this.view.cx += wx - ax;
      this.view.cy += wy - ay;
      this.afterView();
    });

    stage.on(Node.EventType.TOUCH_START, (e: EventTouch) => {
      this.closePopup();
      const p = e.getUILocation();
      if (this.space) {
        this.startPan(p);
        return;
      }
      if (this.tab !== 'path') return;
      const [x, y] = this.toWorld(p.x, p.y);
      this.dragging = this.vm!.hitTest(x, y, HIT_PX / this.scale()) ?? -1;
      if (this.dragging >= 0) {
        this.vm!.selectedSegment = this.vm!.segmentOf(this.dragging);
        this.vm!.changed.value += 1;
      }
    });
    stage.on(Node.EventType.TOUCH_MOVE, (e: EventTouch) => {
      const p = e.getUILocation();
      if (this.panFrom) {
        this.view.cx = this.panFrom.cx - (p.x - this.panFrom.x) / this.scale();
        this.view.cy = this.panFrom.cy - (p.y - this.panFrom.y) / this.scale();
        this.afterView();
        return;
      }
      if (this.dragging < 0) return;
      const [x, y] = this.toWorld(p.x, p.y);
      // 按住 Alt = 不镜像 ⇒ 故意在这个接点折一个角
      this.vm!.dragPoint(this.dragging, Math.round(x), Math.round(y), { mirror: !this.alt });
      this.saveIn = 1.5;
    });
    const drop = (): void => {
      this.panFrom = undefined;
      this.dragging = -1;
    };
    stage.on(Node.EventType.TOUCH_END, drop);
    stage.on(Node.EventType.TOUCH_CANCEL, drop);
    stage.on(Node.EventType.MOUSE_UP, drop);
  }

  // —— 接线：两页 ————————————————————————————————————————————————

  private bindPage(page: Node, kind: 'path' | 'wave'): void {
    const filter = at(page, 'LeftCol/Filter')?.getComponent(EditBox);
    filter?.node.on('text-changed', () => {
      if (kind === 'path') this.filterPath = filter.string;
      else this.filterWave = filter.string;
      this.rebuild();
    });

    if (kind === 'path') {
      this.tap(at(page, 'LeftCol/BtnAdd'), () => this.vm!.copyPath());
      this.tap(at(page, 'LeftCol/BtnDel'), () => this.vm!.removePath());
      this.tap(at(page, 'RightCol/view/content/SegNav/Prev'), () => this.stepSegment(-1));
      this.tap(at(page, 'RightCol/view/content/SegNav/Next'), () => this.stepSegment(1));
      this.tap(at(page, 'RightCol/view/content/BtnAddSeg'), () => this.vm!.addSegment());
      this.tap(at(page, 'RightCol/view/content/BtnDelSeg'), () => this.vm!.removeSegment());
      this.onEdit(at(page, 'RightCol/view/content/FieldId/Value'), (s) => {
        const path = this.vm!.draft.paths[this.vm!.selectedPath];
        if (path && s.trim()) {
          path.id = s.trim();
          this.vm!.changed.value += 1;
        }
      });
      this.bindNum(page, 'RightCol/view/content/FieldCX/Num', 10, () => this.pointAtSel()?.[0] ?? 0, (v) =>
        this.movePoint(v, undefined),
      );
      this.bindNum(page, 'RightCol/view/content/FieldCY/Num', 10, () => this.pointAtSel()?.[1] ?? 0, (v) =>
        this.movePoint(undefined, v),
      );
    } else {
      this.tap(at(page, 'LeftCol/BtnAdd'), () => {
        this.vm!.addWave();
        this.restartPreview();
      });
      this.tap(at(page, 'LeftCol/BtnDel'), () => {
        this.vm!.removeWave();
        this.restartPreview();
      });
      this.tap(at(page, 'RightCol/view/content/BtnAddGroup'), () => {
        this.vm!.addGroup();
        this.restartPreview();
        at(page, 'RightCol')?.getComponent(ScrollView)?.scrollToBottom(0.15);
      });
      this.onEdit(at(page, 'RightCol/view/content/FieldId/Value'), (s) => {
        const wave = this.vm!.draft.waves[this.vm!.selectedWave];
        if (wave && s.trim()) {
          wave.id = s.trim();
          this.vm!.changed.value += 1;
        }
      });
    }
  }

  private switchTab(tab: 'path' | 'wave'): void {
    if (this.tab === tab) return;
    this.tab = tab;
    const paint2 = (node: Node | undefined, on: boolean): void => {
      const sprite = node?.getComponent(Sprite);
      if (sprite) sprite.color = on ? TAB_ON : TAB_OFF;
      const label = node?.getChildByName('Label')?.getComponent(Label);
      if (label) label.color = on ? COL_ROW_ON : COL_DIMTEXT;
    };
    paint2(at(this.root, 'Topbar/Left/Tabs/TabPath'), tab === 'path');
    paint2(at(this.root, 'Topbar/Left/Tabs/TabWave'), tab === 'wave');
    this.closePopup();
    this.rebuild();
  }

  // —— 重画 ————————————————————————————————————————————————————————

  /** VM 变了就整体重画。**不重启预览** —— 那由播放键、换阵、改队伍触发。 */
  private rebuild(): void {
    if (!this.vm || !this.pathPage || !this.wavePage || !this.root) return;
    this.pathPage.active = this.tab === 'path';
    this.wavePage.active = this.tab === 'wave';
    const transport = at(this.root, 'Body/Stage/Transport');
    if (transport) transport.active = this.tab === 'wave';
    this.setText('Topbar/Left/Rev', `rev ${this.vm.draft.rev}`);
    this.setText('Body/Stage/ViewBar/Zoom', `${Math.round(this.view.z * 100)}%`);

    if (this.tab === 'path') this.rebuildPathPage();
    else this.rebuildWavePage();

    this.duration = this.waveDuration();
    this.draw();
    this.drawBar();
  }

  private rebuildPathPage(): void {
    const page = this.pathPage!;
    const vm = this.vm!;
    const paths = vm.draft.paths;
    const shown = paths.map((p, i) => ({ p, i })).filter((it) => match(it.p.id, this.filterPath));

    setLabel(page, 'LeftCol/Head', `路径  ${shown.length}/${paths.length}`, COL_FAINT);
    this.fillList(at(page, 'LeftCol/List'), shown.length, (content, k) => {
      const { p, i } = shown[k];
      const item = instantiate(this.pathItem!);
      content.addChild(item);
      paint(item, i === vm.selectedPath ? COL_ROW_ON : COL_ROW);
      setLabel(item, 'Name', p.id, COL_TEXT);
      setLabel(item, 'Meta', `${segmentCount(p.p)} 段`, COL_FAINT);
      const eye = item.getChildByName('Eye');
      const off = this.hidden.has(p.id);
      setLabel(eye, 'Label', off ? '◌' : '◉', off ? COL_FAINT : COL_CURVE);
      this.tap(eye, () => {
        // 显影是**视图状态**：按 id 记不按下标，删一条路径不会让别人的眼睛跟着串位
        if (off) this.hidden.delete(p.id);
        else this.hidden.add(p.id);
        this.rebuild();
      });
      this.tap(item, () => {
        vm.selectedPath = i;
        vm.changed.value += 1;
      });
    });

    const path = paths[vm.selectedPath];
    const box = at(page, 'RightCol/view/content/FieldId/Value')?.getComponent(EditBox);
    if (box && path && box.string !== path.id) box.string = path.id;
    const n = vm.segments();
    setLabel(page, 'RightCol/view/content/SegNav/Info', `第 ${vm.selectedSegment + 1} / ${n} 段`, COL_TEXT);
    const del = at(page, 'RightCol/view/content/BtnDelSeg')?.getComponent(Button);
    if (del) del.interactable = n >= 2;

    const corners = vm.corners();
    const warn = at(page, 'RightCol/view/content/WarnCorner');
    if (warn) {
      warn.active = corners.length > 0;
      const list = corners.map((c) => `第 ${c.seg} 个接点 ${c.deg}°`).join('、');
      setLabel(
        warn,
        'Label',
        `这条路有 ${corners.length} 个折角：${list}。鱼到那儿会瞬间转头 —— 不想要就拖一下手柄拉平（按住 Alt 拖才是故意折）。`,
        COL_WARN_TEXT,
      );
    }
    this.syncPointFields(page);
  }

  private rebuildWavePage(): void {
    const page = this.wavePage!;
    const vm = this.vm!;
    const waves = vm.draft.waves;
    const shown = waves.map((w, i) => ({ w, i })).filter((it) => match(it.w.id, this.filterWave));

    setLabel(page, 'LeftCol/Head', `鱼阵  ${shown.length}/${waves.length}`, COL_FAINT);
    this.fillList(at(page, 'LeftCol/List'), shown.length, (content, k) => {
      const { w, i } = shown[k];
      const item = instantiate(this.pathItem!); // 行的形状跟路径一样，省一张 prefab
      content.addChild(item);
      paint(item, i === vm.selectedWave ? COL_ROW_WAVE_ON : COL_ROW);
      setLabel(item, 'Name', w.id, COL_TEXT);
      setLabel(item, 'Meta', `${w.groups.length} 队`, COL_FAINT);
      const eye = item.getChildByName('Eye');
      if (eye) eye.active = false; // 阵没有显影，那是路径的事
      this.tap(item, () => {
        vm.selectedWave = i;
        vm.changed.value += 1;
        this.restartPreview();
      });
    });

    const wave = waves[vm.selectedWave];
    const box = at(page, 'RightCol/view/content/FieldId/Value')?.getComponent(EditBox);
    if (box && wave && box.string !== wave.id) box.string = wave.id;

    const groups = at(page, 'RightCol/view/content/Groups');
    const scroll = at(page, 'RightCol')?.getComponent(ScrollView);
    const keep = scroll?.getScrollOffset();
    groups?.removeAllChildren();
    if (groups) wave?.groups.forEach((g, i) => this.buildGroup(groups, g, i));
    // ⚠️ 重建列表项会把滚动位置打回 0（「加一队鱼」看着就像没滚动），存了要还
    if (scroll && keep) scroll.scrollToOffset(new Vec2(keep.x, keep.y), 0);
  }

  private buildGroup(parent: Node, g: GroupView, i: number): void {
    const vm = this.vm!;
    const item = instantiate(this.groupItem!);
    parent.addChild(item);
    setLabel(item, 'Head/Title', `队 ${i + 1}`, COL_DIMTEXT);
    this.tap(at(item, 'Head/BtnDel'), () => {
      vm.removeGroup(i);
      this.restartPreview();
    });

    const known = new Set(vm.draft.paths.map((p) => p.id));
    const pathPick = at(item, 'FieldPath/Pick');
    setLabel(pathPick, 'Label', g.path, known.has(g.path) ? COL_TEXT : COL_BAD);
    this.tap(pathPick, () =>
      this.openPopup(pathPick, vm.draft.paths.map((p) => p.id), (id) => this.patch(i, { path: id })),
    );
    const kindPick = at(item, 'FieldKind/Pick');
    setLabel(kindPick, 'Label', g.kind, COL_TEXT);
    this.tap(kindPick, () =>
      this.openPopup(kindPick, FISH_KINDS.map((k) => k.id), (id) => this.patch(i, { kind: id })),
    );

    this.bindNum(item, 'FieldAt/Num', 0.1, () => g.at, (v) => this.patch(i, { at: Math.max(0, round2(v)) }));
    this.bindNum(item, 'FieldCount/Num', 1, () => g.count, (v) => this.patch(i, { count: Math.max(1, Math.round(v)) }));
    this.bindNum(item, 'FieldGap/Num', 0.05, () => g.gap, (v) => this.patch(i, { gap: Math.max(0, round2(v)) }));
    this.bindNum(item, 'FieldSpeed/Num', 10, () => g.speed, (v) => this.patch(i, { speed: Math.max(10, Math.round(v)) }));
  }

  /** 列表模板：存滚动位置 → 清空 → 逐行建 → 还原滚动位置。 */
  private fillList(list: Node | undefined, count: number, build: (content: Node, k: number) => void): void {
    const scroll = list?.getComponent(ScrollView);
    const content = scroll?.content;
    if (!scroll || !content) return;
    const keep = scroll.getScrollOffset();
    content.removeAllChildren();
    for (let k = 0; k < count; k++) build(content, k);
    scroll.scrollToOffset(new Vec2(keep.x, keep.y), 0);
  }

  // —— 画 ————————————————————————————————————————————————————————

  /** 选中那条带控制点和把手，其余淡淡一条；折角的接点标红。 */
  private draw(): void {
    const g = this.gfx;
    if (!g || !this.vm) return;
    g.clear();
    this.drawField(g);
    const vm = this.vm;
    // 鱼阵页只画**这一阵用到的**路线：别的路线在这儿是噪声
    const used =
      this.tab === 'wave'
        ? new Set((vm.draft.waves[vm.selectedWave]?.groups ?? []).map((it) => it.path))
        : null;
    const cornerSegs = new Set(vm.corners().map((c) => c.seg));

    vm.draft.paths.forEach((path, i) => {
      if (this.hidden.has(path.id)) return;
      if (used && !used.has(path.id)) return;
      const sel = this.tab === 'path' && i === vm.selectedPath;
      if (!sel && !this.showLines) return;
      g.lineWidth = sel ? 3 : 2;
      g.strokeColor = sel ? COL_CURVE : COL_DIM;
      // 有了弧长查找表，`{ p, length: 1 }` 那种假路径对象不成立了 —— 建真的。
      // 顺带的好处：按弧长采样出来的点是**等距**的，画出来的曲线比按参数采样更均匀。
      const fp = makeFishPath(path.p);
      const steps = 24 * segmentCount(path.p);
      for (let s = 0; s <= steps; s++) {
        const [x, y] = this.toBoard(pointAt(fp, s / steps));
        if (s === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
      if (!sel) return;

      g.lineWidth = 1;
      g.strokeColor = COL_HANDLE;
      const count = path.p.length / 2;
      for (let k = 0; k < count; k++) {
        if (k % 3 === 0) continue;
        const a = k % 3 === 1 ? k - 1 : k + 1;
        const [ax, ay] = this.toBoard({ x: path.p[a * 2], y: path.p[a * 2 + 1] });
        const [bx, by] = this.toBoard({ x: path.p[k * 2], y: path.p[k * 2 + 1] });
        g.moveTo(ax, ay);
        g.lineTo(bx, by);
      }
      g.stroke();
      for (let k = 0; k < count; k++) {
        const [x, y] = this.toBoard({ x: path.p[k * 2], y: path.p[k * 2 + 1] });
        const anchor = k % 3 === 0;
        g.fillColor = anchor ? (cornerSegs.has(k / 3) ? COL_CORNER : COL_ANCHOR) : COL_HANDLE;
        g.circle(x, y, anchor ? 7 : 5);
        g.fill();
      }
    });
  }

  /** 场地边框：控制点故意伸到屏外，得有个框才知道哪儿是屏内。 */
  private drawField(g: Graphics): void {
    const [x0, y0] = this.toBoard({ x: -FIELD.width / 2, y: -FIELD.height / 2 });
    const [x1, y1] = this.toBoard({ x: FIELD.width / 2, y: FIELD.height / 2 });
    g.lineWidth = 1;
    g.strokeColor = COL_FIELD;
    g.rect(x0, y0, x1 - x0, y1 - y0);
    g.stroke();
  }

  private drawBar(): void {
    if (this.scrub) this.scrub.progress = this.duration > 0 ? Math.min(1, this.clock / this.duration) : 0;
    this.setText('Body/Stage/Transport/Clock', `${this.clock.toFixed(2)} / ${this.duration} s`);
    this.setText('Body/Stage/Transport/Live', `场上 ${this.fishNodes.size}`);
  }

  // —— 弹层（下拉）——————————————————————————————————————————————

  /**
   * 自绘下拉：引擎没有原生控件，而 `ScrollView` 自带 `Mask` **会把弹层裁掉**，
   * 所以挂到面板根节点（层级最高）上，位置按锚节点的世界坐标现算。
   */
  private openPopup(anchor: Node | undefined, options: readonly string[], pick: (v: string) => void): void {
    this.closePopup();
    if (!this.root || !anchor || options.length === 0) return;
    const shown = options.slice(0, 12);
    const w = 234;
    const rowH = 26;
    const h = shown.length * rowH + 8;

    const pop = gameNode(this.root, 'Popup');
    pop.getComponent(UITransform)!.setContentSize(w, h);
    const bg = pop.addComponent(Sprite);
    bg.spriteFrame = anchor.getComponent(Sprite)?.spriteFrame ?? null;
    bg.type = Sprite.Type.SLICED;
    bg.sizeMode = Sprite.SizeMode.CUSTOM;
    bg.color = new Color(55, 98, 122);

    const world = anchor.getComponent(UITransform)!.convertToWorldSpaceAR(new Vec3(0, 0, 0));
    const local = this.root.getComponent(UITransform)!.convertToNodeSpaceAR(world);
    const below = local.y - h / 2 - 18;
    // 下面放不下就翻上去
    pop.setPosition(local.x, below - h / 2 < -540 ? local.y + h / 2 + 18 : below);

    shown.forEach((opt, k) => {
      const row = gameNode(pop, `Opt${k}`);
      row.getComponent(UITransform)!.setContentSize(w - 8, rowH - 2);
      row.setPosition(0, h / 2 - 4 - rowH * k - rowH / 2);
      const label = row.addComponent(Label);
      label.string = opt;
      label.fontSize = 14;
      label.lineHeight = 22;
      label.color = COL_TEXT;
      label.overflow = Label.Overflow.CLAMP;
      row.getComponent(UITransform)!.setContentSize(w - 8, rowH - 2);
      this.tap(row, () => {
        pick(opt);
        this.closePopup();
      });
    });
    this.popup = pop;
  }

  private closePopup(): void {
    this.popup?.destroy();
    this.popup = undefined;
  }

  // —— 预览 ————————————————————————————————————————————————————————

  /** 换阵 / 恢复草稿 / 改队伍之后重开一局预览。 */
  private restartPreview(): void {
    if (!this.vm) return;
    const wave = this.vm.draft.waves[this.vm.selectedWave];
    this.fishNodes.forEach((n) => n.destroy());
    this.fishNodes.clear();
    this.clock = 0;
    if (!wave) {
      this.preview = undefined;
      return;
    }
    // 引用不到的路径会让 waveFeeder 当场抛 —— 那正是要的，但编辑器不能因此崩掉
    try {
      this.preview = new FishVM({
        feeder: waveFeeder(this.vm.toContent(), { order: [wave.id], loop: false }),
        aiAgents: [],
      });
      this.setText('Body/Stage/Hint', '');
    } catch (e) {
      this.preview = undefined;
      this.setText('Body/Stage/Hint', '这个阵还有解析不到的路径引用，先修再预览');
      console.warn('[fish-editor] 这个阵还有解析不到的引用，先修再预览', e);
    }
    this.syncFish();
  }

  private togglePlay(): void {
    if (!this.playing && this.clock >= this.duration) this.restartPreview();
    this.playing = !this.playing;
    this.setText('Body/Stage/Transport/BtnPlay/Label', this.playing ? '❚❚ 暂停' : '▶ 播放');
  }

  /** 拖 / 步进到某一刻：从头重跑到那儿 —— 预览是确定性的，重跑比记录快照省事得多。 */
  private seek(t: number): void {
    const target = Math.max(0, Math.min(this.duration, t));
    this.playing = false;
    this.setText('Body/Stage/Transport/BtnPlay/Label', '▶ 播放');
    this.restartPreview();
    const step = 1 / 60;
    for (let s = 0; s < target; s += step) this.preview?.tick(step);
    this.clock = target;
    this.syncFish();
    this.drawBar();
  }

  /** 把 ECS 里的鱼同步成节点。生灭自己 diff，不走事件（同 `FishGame`）。 */
  private syncFish(): void {
    const world = this.preview?.world;
    if (!world || !this.fishes) return;
    const s = this.scale();
    const alive = new Set<number>();
    for (const eid of fishQuery(world)) {
      alive.add(eid);
      const kind = fishKind(Fish.kind[eid]);
      let node = this.fishNodes.get(eid);
      if (!node) {
        node = gameNode(this.fishes, `fish${eid}`);
        const sprite = node.addComponent(Sprite);
        const frame = this.atlas?.getSpriteFrame(`${kind.id}_run_0`);
        if (frame) {
          sprite.spriteFrame = frame;
          sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        }
        this.fishNodes.set(eid, node);
      }
      // 尺寸跟着缩放走：缩放是**视野**变了，鱼在世界里还是那么大
      node.getComponent(UITransform)!.setContentSize(kind.r * 2.4 * s, kind.r * 2 * s);
      const [x, y] = this.toBoard({ x: Position.x[eid], y: Position.y[eid] });
      node.setPosition(x, y);
      const a = Angle.v[eid];
      node.setRotationFromEuler(0, 0, (a * 180) / Math.PI);
      node.setScale(new Vec3(1, Math.abs(a) > Math.PI / 2 ? -1 : 1, 1));
    }
    for (const [eid, node] of this.fishNodes) {
      if (alive.has(eid)) continue;
      node.destroy();
      this.fishNodes.delete(eid);
    }
  }

  /**
   * 预览时长 = 最后一条**跑完**的鱼跑完的时刻 + 半秒。不是「最后出生那条」——
   * 各 group 路径长短与速度都不同，后生的短路径可能先跑完。
   */
  private waveDuration(): number {
    const wave = this.vm?.draft.waves[this.vm.selectedWave];
    if (!wave) return 8;
    const index = new Map(this.vm!.draft.paths.map((p, i) => [p.id, i]));
    let end = 3;
    for (const g of wave.groups) {
      const idx = index.get(g.path);
      if (idx === undefined) continue;
      const travel = fishPath(idx).length / Math.max(1, g.speed);
      for (let i = 0; i < g.count; i++) end = Math.max(end, g.at + i * g.gap + travel);
    }
    return Math.ceil(Math.min(120, end + 0.5) * 10) / 10;
  }

  // —— 编辑动作 ————————————————————————————————————————————————

  private patch(index: number, patch: Partial<GroupView>): void {
    this.vm!.patchGroup(index, patch);
    this.restartPreview();
  }

  private stepSegment(step: number): void {
    const n = this.vm!.segments();
    if (n === 0) return;
    this.vm!.selectedSegment = (this.vm!.selectedSegment + step + n) % n;
    this.vm!.changed.value += 1;
  }

  /** 那两个坐标框编的是谁：正在拖就是它，否则是当前段的起始锚点。 */
  private selectedPoint(): number {
    return this.dragging >= 0 ? this.dragging : this.vm!.selectedSegment * 3;
  }

  private pointAtSel(): [number, number] | null {
    const p = this.vm?.draft.paths[this.vm.selectedPath]?.p;
    const i = this.selectedPoint();
    return p && i * 2 + 1 < p.length ? [p[i * 2], p[i * 2 + 1]] : null;
  }

  private movePoint(x: number | undefined, y: number | undefined): void {
    const cur = this.pointAtSel();
    if (!cur) return;
    this.vm!.dragPoint(this.selectedPoint(), x ?? cur[0], y ?? cur[1], { mirror: !this.alt });
  }

  private syncPointFields(page: Node): void {
    const cur = this.pointAtSel();
    if (!cur) return;
    const put = (path: string, v: number): void => {
      const box = at(page, path)?.getComponent(EditBox);
      if (box && box.string !== String(v)) box.string = String(v);
    };
    put('RightCol/view/content/FieldCX/Num/Value', cur[0]);
    put('RightCol/view/content/FieldCY/Num/Value', cur[1]);
  }

  /**
   * 导出：`content.ts` 全文进剪贴板，人 `Ctrl+V` 覆盖仓库里那份。
   *
   * ⚠️ `navigator.clipboard` **只在 secure context 可用**（Creator 预览的 localhost ✅，
   * 挂在局域网 IP 上 ❌）。所以失败要**明确报**并把全文打进控制台 —— 静默失败的话人会
   * 粘出上一次剪贴板里的东西。
   */
  private exportContent(): void {
    const text = this.vm!.exportText();
    console.log('[fish-editor] content.ts 全文如下（复制它覆盖仓库里那份）:\n' + text);
    const clip = (globalThis as { navigator?: { clipboard?: { writeText(s: string): Promise<void> } } })
      .navigator?.clipboard;
    const say = (s: string): void => this.setText('Topbar/Right/BtnExport/Label', s);
    if (!clip) {
      say('⚠ 复制不了 → 看控制台');
      return;
    }
    clip.writeText(text).then(
      () => say(`已复制 rev ${this.vm!.draft.rev}`),
      () => say('⚠ 复制失败 → 看控制台'),
    );
  }

  // —— 视野 ————————————————————————————————————————————————————————

  private scale(): number {
    return BASE * this.view.z;
  }

  /** 让场地 + 所有**没被藏起来**的路径一起落进画布。 */
  private fitView(): void {
    let minX = -FIELD.width / 2;
    let maxX = FIELD.width / 2;
    let minY = -FIELD.height / 2;
    let maxY = FIELD.height / 2;
    for (const path of this.vm?.draft.paths ?? []) {
      if (this.hidden.has(path.id)) continue;
      for (let i = 0; i < path.p.length; i += 2) {
        minX = Math.min(minX, path.p[i]);
        maxX = Math.max(maxX, path.p[i]);
        minY = Math.min(minY, path.p[i + 1]);
        maxY = Math.max(maxY, path.p[i + 1]);
      }
    }
    const pad = 120;
    this.view.cx = (minX + maxX) / 2;
    this.view.cy = (minY + maxY) / 2;
    const z = Math.min(
      BOARD.width / ((maxX - minX + pad * 2) * BASE),
      BOARD.height / ((maxY - minY + pad * 2) * BASE),
    );
    this.view.z = Math.max(ZOOM.min, Math.min(ZOOM.max, z));
  }

  private startPan(p: { x: number; y: number }): void {
    this.panFrom = { x: p.x, y: p.y, cx: this.view.cx, cy: this.view.cy };
    this.dragging = -1;
  }

  private afterView(): void {
    this.setText('Body/Stage/ViewBar/Zoom', `${Math.round(this.view.z * 100)}%`);
    this.draw();
    this.syncFish();
  }

  private onKey(e: EventKeyboard): void {
    const down = e.type === Input.EventType.KEY_DOWN;
    if (e.keyCode === KeyCode.SPACE) this.space = down;
    if (e.keyCode === KeyCode.ALT_LEFT || e.keyCode === KeyCode.ALT_RIGHT) this.alt = down;
  }

  // —— 坐标 ————————————————————————————————————————————————————————

  /** 世界（设计像素，屏心原点）→ 画布局部坐标。 */
  private toBoard(p: { x: number; y: number }): [number, number] {
    const s = this.scale();
    return [(p.x - this.view.cx) * s, (p.y - this.view.cy) * s];
  }

  /** 屏幕 UI 坐标 → 世界坐标。 */
  private toWorld(x: number, y: number): [number, number] {
    const local = this.board!.getComponent(UITransform)!.convertToNodeSpaceAR(new Vec3(x, y, 0));
    const s = this.scale();
    return [local.x / s + this.view.cx, local.y / s + this.view.cy];
  }

  // —— 小工具 ————————————————————————————————————————————————————

  private tap(node: Node | undefined | null, fn: () => void): void {
    node?.on(Node.EventType.TOUCH_END, (e: EventTouch) => {
      e.propagationStopped = true;
      fn();
      this.saveIn = 1.5;
    });
  }

  private onToggle(node: Node | undefined, fn: () => void): void {
    const toggle = node?.getComponent(Toggle);
    toggle?.node.on('toggle', () => {
      if (toggle.isChecked) fn();
    });
  }

  private onEdit(node: Node | undefined, fn: (s: string) => void): void {
    const box = node?.getComponent(EditBox);
    box?.node.on('editing-did-ended', () => {
      fn(box.string);
      this.saveIn = 1.5;
    });
  }

  /** `◀ 输入框 ▶` 一组：按钮走步长；输入框**夹紧不拒绝**（乱敲不该把值清空）。 */
  private bindNum(
    root: Node,
    path: string,
    step: number,
    get: () => number,
    set: (v: number) => void,
  ): void {
    const group = at(root, path);
    if (!group) return;
    const box = group.getChildByName('Value')?.getComponent(EditBox);
    if (box) box.string = String(get());
    this.tap(group.getChildByName('Dec'), () => set(get() - step));
    this.tap(group.getChildByName('Inc'), () => set(get() + step));
    box?.node.on('editing-did-ended', () => {
      const v = Number(box.string);
      set(Number.isFinite(v) ? v : get());
      this.saveIn = 1.5;
    });
  }

  private setText(path: string, text: string): void {
    const label = at(this.root, path)?.getComponent(Label);
    if (label) label.string = text;
  }
}

/** `patchGroup` 收得下的那些字段。 */
interface GroupView {
  at: number;
  path: string;
  kind: string;
  count: number;
  gap: number;
  speed: number;
}

/** 按路径取子节点。取不到返回 `undefined` —— 名字写错是**少一个绑定**，不是崩。 */
function at(root: Node | undefined, path: string): Node | undefined {
  return root?.getChildByPath(path) ?? undefined;
}

function setLabel(root: Node | undefined | null, path: string, text: string, color: Color): void {
  const label = root?.getChildByPath(path)?.getComponent(Label);
  if (label) {
    label.string = text;
    label.color = color;
  }
}

/**
 * 改的是 `Button.normalColor` **不是** `Sprite.color`：Button 的 COLOR 过渡是**赋值**，
 * 鼠标一划过就把 `sprite.color` 刷回 normalColor 了。两处都写才在过渡生效前后都对。
 */
function paint(node: Node, color: Color): void {
  const btn = node.getComponent(Button);
  if (btn) btn.normalColor = color;
  const sprite = node.getComponent(Sprite);
  if (sprite) sprite.color = color;
}

function match(id: string, filter: string): boolean {
  return filter === '' || id.toLowerCase().includes(filter.toLowerCase());
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** `localStorage` 实现。没有它（小游戏、native）就不落盘 —— 编辑器只在桌面 web 上用。 */
function webStorage(): EditorStorage | undefined {
  const ls = (globalThis as { localStorage?: Storage }).localStorage;
  if (!ls) return undefined;
  return {
    read: (k) => ls.getItem(k),
    write: (k, v) => ls.setItem(k, v),
    clear: (k) => ls.removeItem(k),
  };
}

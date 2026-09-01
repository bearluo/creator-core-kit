import {
  Color,
  Component,
  EventTouch,
  Graphics,
  Label,
  Node,
  Prefab,
  Sprite,
  SpriteAtlas,
  UITransform,
  Vec3,
  _decorator,
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
import { FIELD, fishPath, makeFishPath, pointAt } from '../mini-fish/content/paths';
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

/** 画布区把 `FIELD`（1920×1080）缩到这么大。比场地大一圈：控制点故意伸到屏外。 */
const BOARD = { width: 1300, height: 820 };
const VIEW = { width: FIELD.width * 1.3, height: FIELD.height * 1.5 };
const SCALE = BOARD.width / VIEW.width;

const COL_LINE = new Color(70, 110, 140);
const COL_CURVE = new Color(80, 200, 180);
const COL_HANDLE = new Color(240, 190, 80);
const COL_END = new Color(240, 240, 240);
const COL_BAR = new Color(63, 194, 173);
const COL_BAR_BG = new Color(40, 62, 80);

const fishQuery = defineQuery([Fish, Position]);

/**
 * 内容编辑器的 View —— **只做仓规允许的四件事**：instantiate prefab、建绑定、把屏幕坐标转成
 * 世界坐标后转发给 {@link EditorVM}、转发生命周期。曲线和控制点用 `Graphics` 画（绘制不是逻辑）。
 *
 * 预览**直接跑游戏本体的 `FishVM`**（`aiAgents: []` ⇒ 只剩玩家那门炮，而它不 `aim()` 就永不
 * 开火 ⇒ 无子弹、无结算、只有鱼在游）。自己写一份插值等于抵消编辑器存在的理由 —— 恒速、朝向、
 * 离场三处行为各有两份实现，迟早漂，而漂的那天你信的是编辑器、错的是游戏。
 *
 * 界面全在三张 prefab 里（`EditorPanel` / `PathItem` / `GroupItem`），本类只按名字取节点接线。
 */
@ccclass('FishEditor')
export class FishEditor extends Component {
  private vm?: EditorVM;
  private preview?: FishVM;
  private atlas?: SpriteAtlas;
  private pathItem?: Prefab;
  private groupItem?: Prefab;
  private stop?: Disposer;

  private board?: Node;
  private gfx?: Graphics;
  private barGfx?: Graphics;
  private fishes?: Node;
  private pathList?: Node;
  private groupList?: Node;
  private banner?: Node;
  private readonly labels = new Map<string, Label>();
  private readonly fishNodes = new Map<number, Node>();

  private playing = false;
  private clock = 0;
  private duration = 8;
  /** 正在拖第几个控制点；`-1` = 没在拖。 */
  private dragging = -1;
  private saveIn = 0;

  async start(): Promise<void> {
    const [panel, pathItem, groupItem, atlas] = await Promise.all([
      loadGameAsset<Prefab>(this.node, BUNDLE, 'EditorPanel'),
      loadGameAsset<Prefab>(this.node, BUNDLE, 'PathItem'),
      loadGameAsset<Prefab>(this.node, BUNDLE, 'GroupItem'),
      loadGameAtlas(this.node, FISH_BUNDLE, 'textures'),
    ]);
    // 加载期间被切走了 —— 那是取消不是失败，安静收摊
    if (!panel || !pathItem || !groupItem || !this.node.isValid) return;
    this.pathItem = pathItem;
    this.groupItem = groupItem;
    this.atlas = atlas ?? undefined;

    this.vm = new EditorVM(CONTENT, {
      storage: webStorage(),
      storageKey: scopedKey('cck.fishEditorDraft'),
    });

    const root = instantiate(panel);
    this.node.addChild(root);
    this.bind(root);
    exitButton(this.node).node.setPosition(-780, 500);

    // 整体重画：编辑器不是每帧刷新的东西，细粒度绑定不值那个代码量
    this.stop = effect(() => {
      void this.vm!.changed.value; // 订阅它
      this.rebuild();
    });
    this.restartPreview();
  }

  onDestroy(): void {
    this.stop?.();
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
        this.setLabel('BtnPlay', '▶ 播放');
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

  // —— 接线 ————————————————————————————————————————————————————————

  private bind(root: Node): void {
    const find = (name: string): Node => root.getChildByPath(name) ?? root;
    this.board = find('Board');
    this.gfx = this.board.getComponent(Graphics) ?? undefined;
    this.fishes = gameNode(this.board, 'Fishes');
    this.pathList = find('Left/PathList');
    this.groupList = find('Right/GroupList');
    this.banner = find('Banner');
    this.barGfx = find('Transport/Bar').getComponent(Graphics) ?? undefined;
    for (const label of root.getComponentsInChildren(Label)) {
      this.labels.set(label.node.name, label);
    }

    this.tap(find('Left/BtnCopyPath'), () => this.vm!.copyPath());
    this.tap(find('Left/BtnDelPath'), () => this.vm!.removePath());
    this.tap(find('Right/BtnPrevWave'), () => this.selectWave(-1));
    this.tap(find('Right/BtnNextWave'), () => this.selectWave(1));
    this.tap(find('Right/BtnAddWave'), () => this.vm!.addWave());
    this.tap(find('Right/BtnDelWave'), () => this.vm!.removeWave());
    this.tap(find('Right/BtnAddGroup'), () => this.vm!.addGroup());
    this.tap(find('BtnExport'), () => this.exportContent());
    this.tap(find('Transport/BtnPlay'), () => this.togglePlay());
    this.tap(find('Transport/BtnHome'), () => this.seek(0));
    this.tap(find('Transport/BtnStepBack'), () => this.seek(this.clock - 0.1));
    this.tap(find('Transport/BtnStepFwd'), () => this.seek(this.clock + 0.1));
    this.tap(find('Banner/BtnRestore'), () => {
      this.vm!.restoreDraft();
      this.restartPreview();
    });
    this.tap(find('Banner/BtnDiscard'), () => {
      this.vm!.discardDraft();
      this.banner!.active = false;
    });

    // 拖控制点：按下抓、移动跟、抬起放
    this.board.on(Node.EventType.TOUCH_START, (e: EventTouch) => {
      const [x, y] = this.toWorld(e);
      this.dragging = this.vm!.hitTest(x, y, 26 / SCALE) ?? -1;
    });
    this.board.on(Node.EventType.TOUCH_MOVE, (e: EventTouch) => {
      if (this.dragging < 0) return;
      const [x, y] = this.toWorld(e);
      this.vm!.dragPoint(this.dragging, Math.round(x), Math.round(y));
    });
    const drop = (): void => void (this.dragging = -1);
    this.board.on(Node.EventType.TOUCH_END, drop);
    this.board.on(Node.EventType.TOUCH_CANCEL, drop);

    const info = this.vm!.draftInfo();
    this.banner.active = info !== null;
    if (info) {
      this.setLabel('BannerText', `有一份未导出的草稿（基于 rev ${info.rev}）`);
    }
  }

  private tap(node: Node, fn: () => void): void {
    node.on(Node.EventType.TOUCH_END, (e: EventTouch) => {
      e.propagationStopped = true;
      fn();
      this.saveIn = 1.5;
    });
  }

  private setLabel(name: string, text: string): void {
    const label = this.labels.get(name);
    if (label) label.string = text;
  }

  // —— 重画 ————————————————————————————————————————————————————————

  /** VM 变了就整体重画：列表、属性、曲线、时长。**不重启预览** —— 那由播放键和换阵触发。 */
  private rebuild(): void {
    if (!this.vm || !this.pathList || !this.groupList) return;
    const draft = this.vm.draft;

    this.pathList.removeAllChildren();
    draft.paths.forEach((p, i) => {
      const item = instantiate(this.pathItem!);
      this.pathList!.addChild(item);
      item.setPosition(0, -i * 46);
      const name = item.getChildByName('Name')?.getComponent(Label);
      if (name) {
        name.string = `${i === this.vm!.selectedPath ? '▸ ' : '  '}${p.id}`;
        name.color = i === this.vm!.selectedPath ? COL_CURVE : COL_END;
      }
      item.on(Node.EventType.TOUCH_END, () => {
        this.vm!.selectedPath = i;
        this.vm!.changed.value += 1;
      });
    });

    const unresolved = new Set(this.vm.unresolved().map((u) => `${u.wave}:${u.group}`));
    const wave = draft.waves[this.vm.selectedWave];
    this.setLabel('WaveName', wave ? `${this.vm.selectedWave + 1}/${draft.waves.length} ${wave.id}` : '（没有阵）');
    this.groupList.removeAllChildren();
    wave?.groups.forEach((g, i) => {
      const item = instantiate(this.groupItem!);
      this.groupList!.addChild(item);
      item.setPosition(0, -i * 156);
      const set = (n: string, s: string, bad = false): void => {
        const l = item.getChildByName(n)?.getComponent(Label);
        if (l) {
          l.string = s;
          l.color = bad ? new Color(230, 110, 110) : COL_END;
        }
      };
      set('Path', g.path, unresolved.has(`${this.vm!.selectedWave}:${i}`));
      set('Kind', g.kind.replace('fish_', ''));
      set('Count', `×${g.count}`);
      set('Gap', `${g.gap.toFixed(2)}s`);
      set('Speed', `${Math.round(g.speed)}`);
      const step = (n: string, fn: () => void): void => {
        const child = item.getChildByName(n);
        if (child) this.tap(child, fn);
      };
      step('BtnPathPrev', () => this.cyclePath(i, -1));
      step('BtnPathNext', () => this.cyclePath(i, 1));
      step('BtnKindPrev', () => this.cycleKind(i, -1));
      step('BtnKindNext', () => this.cycleKind(i, 1));
      step('BtnCountDec', () => this.patch(i, { count: Math.max(1, g.count - 1) }));
      step('BtnCountInc', () => this.patch(i, { count: g.count + 1 }));
      step('BtnGapDec', () => this.patch(i, { gap: Math.max(0, +(g.gap - 0.05).toFixed(2)) }));
      step('BtnGapInc', () => this.patch(i, { gap: +(g.gap + 0.05).toFixed(2) }));
      step('BtnSpeedDec', () => this.patch(i, { speed: Math.max(10, g.speed - 10) }));
      step('BtnSpeedInc', () => this.patch(i, { speed: g.speed + 10 }));
      step('BtnDel', () => this.vm!.removeGroup(i));
    });

    this.duration = this.waveDuration();
    this.draw();
    this.drawBar();
  }

  /** 画路径：选中那条带控制点和把手，其余淡淡一条。 */
  private draw(): void {
    const g = this.gfx;
    if (!g || !this.vm) return;
    g.clear();
    this.vm.draft.paths.forEach((path, i) => {
      const sel = i === this.vm!.selectedPath;
      g.lineWidth = sel ? 4 : 2;
      g.strokeColor = sel ? COL_CURVE : COL_LINE;
      // 有了弧长查找表，`{ p, length: 1 }` 那种假路径对象不成立了 —— 建真的。
      // 顺带的好处：按弧长采样出来的点是**等距**的，画出来的曲线比按参数采样更均匀。
      const fp = makeFishPath(path.p);
      for (let s = 0; s <= 48; s++) {
        const pt = pointAt(fp, s / 48);
        const [x, y] = this.toBoard(pt.x, pt.y);
        if (s === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
      if (!sel) return;
      // 把手：p0-p1、p2-p3 两条虚线（这里用细实线，Graphics 没有虚线）
      g.lineWidth = 1;
      g.strokeColor = COL_HANDLE;
      for (const [a, b] of [[0, 1], [2, 3]] as const) {
        const [ax, ay] = this.toBoard(path.p[a * 2], path.p[a * 2 + 1]);
        const [bx, by] = this.toBoard(path.p[b * 2], path.p[b * 2 + 1]);
        g.moveTo(ax, ay);
        g.lineTo(bx, by);
      }
      g.stroke();
      for (let k = 0; k < 4; k++) {
        const [x, y] = this.toBoard(path.p[k * 2], path.p[k * 2 + 1]);
        g.fillColor = k === 0 || k === 3 ? COL_END : COL_HANDLE;
        g.circle(x, y, 9);
        g.fill();
      }
    });
  }

  private drawBar(): void {
    const g = this.barGfx;
    if (!g) return;
    const w = 520;
    const pct = this.duration > 0 ? Math.min(1, this.clock / this.duration) : 0;
    g.clear();
    g.fillColor = COL_BAR_BG;
    g.rect(0, -3, w, 6);
    g.fill();
    g.fillColor = COL_BAR;
    g.rect(0, -3, w * pct, 6);
    g.fill();
    this.setLabel('Clock', `${this.clock.toFixed(2)} s / ${this.duration} s`);
    this.setLabel('Live', `场上 ${this.fishNodes.size} 条`);
  }

  // —— 预览 ————————————————————————————————————————————————————————

  /** 换阵 / 恢复草稿之后重开一局预览。 */
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
    } catch (e) {
      this.preview = undefined;
      console.warn('[fish-editor] 这个阵还有解析不到的引用，先修再预览', e);
    }
    this.syncFish();
  }

  private togglePlay(): void {
    if (!this.playing && this.clock >= this.duration) this.restartPreview();
    this.playing = !this.playing;
    this.setLabel('BtnPlay', this.playing ? '❚❚ 暂停' : '▶ 播放');
  }

  /** 拖 / 步进到某一刻：从头重跑到那儿 —— 预览是确定性的，重跑比记录快照省事得多。 */
  private seek(t: number): void {
    const target = Math.max(0, Math.min(this.duration, t));
    this.playing = false;
    this.setLabel('BtnPlay', '▶ 播放');
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
    const alive = new Set<number>();
    for (const eid of fishQuery(world)) {
      alive.add(eid);
      let node = this.fishNodes.get(eid);
      if (!node) {
        node = gameNode(this.fishes, `fish${eid}`);
        const kind = fishKind(Fish.kind[eid]);
        const sprite = node.addComponent(Sprite);
        const frame = this.atlas?.getSpriteFrame(`${kind.id}_run_0`);
        if (frame) {
          sprite.spriteFrame = frame;
          sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        }
        node.getComponent(UITransform)!.setContentSize(kind.r * 2.4 * SCALE, kind.r * 2 * SCALE);
        this.fishNodes.set(eid, node);
      }
      const [x, y] = this.toBoard(Position.x[eid], Position.y[eid]);
      node.setPosition(x, y);
      const a = Angle.v[eid];
      node.setRotationFromEuler(0, 0, (a * 180) / Math.PI);
      node.setScale(new Vec3(SCALE, Math.abs(a) > Math.PI / 2 ? -SCALE : SCALE, 1));
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

  // —— 编辑动作 ————————————————————————————————————————————————————

  private patch(index: number, patch: Partial<{ count: number; gap: number; speed: number }>): void {
    this.vm!.patchGroup(index, patch);
    this.restartPreview();
  }

  private cyclePath(index: number, step: number): void {
    const paths = this.vm!.draft.paths;
    const g = this.vm!.draft.waves[this.vm!.selectedWave].groups[index];
    const at = paths.findIndex((p) => p.id === g.path);
    const next = (at + step + paths.length) % paths.length;
    this.vm!.patchGroup(index, { path: paths[next].id });
    this.restartPreview();
  }

  private cycleKind(index: number, step: number): void {
    const g = this.vm!.draft.waves[this.vm!.selectedWave].groups[index];
    const at = FISH_KINDS.findIndex((k) => k.id === g.kind);
    const next = (at + step + FISH_KINDS.length) % FISH_KINDS.length;
    this.vm!.patchGroup(index, { kind: FISH_KINDS[next].id });
    this.restartPreview();
  }

  private selectWave(step: number): void {
    const n = this.vm!.draft.waves.length;
    if (n === 0) return;
    this.vm!.selectedWave = (this.vm!.selectedWave + step + n) % n;
    this.vm!.changed.value += 1;
    this.restartPreview();
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
    if (!clip) {
      this.setLabel('BtnExport', '⚠ 复制不了 → 看控制台');
      return;
    }
    clip.writeText(text).then(
      () => this.setLabel('BtnExport', `已复制 rev ${this.vm!.draft.rev}`),
      () => this.setLabel('BtnExport', '⚠ 复制失败 → 看控制台'),
    );
  }

  // —— 坐标 ————————————————————————————————————————————————————————

  /** 世界（设计像素，屏心原点）→ 画布局部坐标。 */
  private toBoard(x: number, y: number): [number, number] {
    return [x * SCALE, y * SCALE];
  }

  /** 触点（屏幕）→ 世界坐标。 */
  private toWorld(e: EventTouch): [number, number] {
    const p = e.getUILocation();
    const local = this.board!.getComponent(UITransform)!.convertToNodeSpaceAR(new Vec3(p.x, p.y, 0));
    return [local.x / SCALE, local.y / SCALE];
  }
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

import {
  AudioClip,
  AudioSource,
  Camera,
  Color,
  director,
  gfx,
  Graphics,
  Label,
  Layers,
  Node,
  profiler,
  ResolutionPolicy,
  resources,
  sp,
  Sprite,
  SpriteFrame,
  sys,
  Texture2D,
  UITransform,
  Vec3,
  view,
} from 'cc';
import { SpineVatPopulation } from './SpineVatRenderer';

type Grid = number[][];

interface FruitSlotOptions {
  useVat: boolean;
  cacheMode: sp.SpineAnimationCacheMode;
}

interface PerfSnapshot {
  fps: number;
  p50FrameMs: number;
  p95FrameMs: number;
  framesOver25Percent: number;
  drawCalls: number;
  averageDrawCalls: number;
  maxDrawCalls: number;
  gpuInstances: number;
  triangles: number;
  textureMemoryMb: number;
  bufferMemoryMb: number;
  gameState: string;
  spinIndex: number;
  renderMode: string;
}

const COLS = 5;
const ROWS = 3;
const LINE_BET_COUNT = 9;
const GRID_CENTER_Y = 145;
const GRID_SPACING_X = 118;
const GRID_SPACING_Y = 145;
const SYMBOL_ANIMATION = 'letsparty_tuan_nanwuzhe_tigger';
const PAY_LINES = [
  [1, 1, 1, 1, 1],
  [0, 0, 0, 0, 0],
  [2, 2, 2, 2, 2],
  [0, 1, 2, 1, 0],
  [2, 1, 0, 1, 2],
  [0, 0, 1, 2, 2],
  [2, 2, 1, 0, 0],
  [1, 2, 1, 0, 1],
  [1, 0, 1, 2, 1],
] as const;
const PAY_TABLE: Record<number, readonly number[]> = {
  1: [0, 0, 3, 10, 55],
  2: [0, 0, 3, 15, 85],
  3: [0, 0, 10, 30, 150],
  4: [0, 0, 20, 45, 250],
  5: [0, 0, 30, 60, 350],
  6: [0, 0, 40, 80, 450],
  7: [0, 0, 55, 100, 650],
  8: [0, 0, 75, 150, 850],
};

function loadAsset<T>(path: string, type: new (...args: any[]) => T): Promise<T> {
  return new Promise((resolve, reject) => {
    resources.load(path, type as any, (error, asset) => {
      if (error || !asset) reject(error ?? new Error(`Missing resource: ${path}`));
      else resolve(asset as T);
    });
  });
}

async function loadSpriteFrame(path: string): Promise<SpriteFrame> {
  const texture = await loadAsset(`${path}/texture`, Texture2D);
  const frame = new SpriteFrame();
  frame.texture = texture;
  return frame;
}

function setSize(node: Node, width: number, height: number): UITransform {
  const transform = node.getComponent(UITransform) ?? node.addComponent(UITransform);
  transform.setContentSize(width, height);
  return transform;
}

export class FruitSlotGame {
  private readonly root: Node;
  private readonly options: FruitSlotOptions;
  private readonly cells: Sprite[][] = [];
  private readonly symbolFrames: SpriteFrame[] = [];
  private readonly audio = new Map<string, AudioClip>();
  private readonly frameTimes = new Float32Array(300);
  private readonly stoppedColumns = new Set<number>();

  private balanceLabel!: Label;
  private betLabel!: Label;
  private winLabel!: Label;
  private statusLabel!: Label;
  private modeLabel!: Label;
  private spinLabel!: Label;
  private spinButton!: Node;
  private winRoot!: Node;
  private bgm!: AudioSource;
  private effects!: AudioSource;
  private maleData: sp.SkeletonData | null = null;
  private vatPopulation: SpineVatPopulation | null = null;
  private targetGrid: Grid = [];
  private ready = false;
  private spinning = false;
  private autoSpin = false;
  private turbo = false;
  private elapsed = 0;
  private symbolTick = 0;
  private autoDelay = 0;
  private spinIndex = 0;
  private balance = 10000;
  private betIndex = 1;
  private readonly bets = [10, 20, 50, 100];
  private rngState = 0x51f15e1d;
  private perfCursor = 0;
  private perfCount = 0;
  private perfElapsed = 0;
  private drawCallTotal = 0;
  private drawCallSamples = 0;
  private maxDrawCalls = 0;
  private maxGpuInstances = 0;
  private maxTriangles = 0;
  private destroyed = false;
  private mainCamera: Camera | null = null;
  private vatCameraNode: Node | null = null;

  constructor(root: Node, options: FruitSlotOptions) {
    this.root = root;
    this.options = options;
  }

  async start(): Promise<void> {
    view.setDesignResolutionSize(720, 1280, ResolutionPolicy.FIXED_HEIGHT);
    profiler.hideStats();
    if (this.options.useVat) this.setupVatOverlayCamera();
    setSize(this.root, 720, 1280);
    this.buildInterface();
    this.statusLabel.string = '正在载入 FruitMachinePart...';

    try {
      const symbolTasks = Array.from({ length: 11 }, (_, index) =>
        loadSpriteFrame(`fruit-game/ui/symbols/fmp_icon_${index + 1}`));
      const [frames, maleData] = await Promise.all([
        Promise.all(symbolTasks),
        loadAsset('fruit-machine/letsparty_tuan_nanwuzhe', sp.SkeletonData),
        this.loadInterfaceSprites(),
        this.loadAudio(),
      ]);
      if (this.destroyed) return;
      this.symbolFrames.push(...frames);
      this.maleData = maleData;
      this.targetGrid = this.randomGrid();
      this.applyGrid(this.targetGrid);
      this.ready = true;
      this.statusLabel.string = '点击 SPIN 开始 | 第 4 局为满屏舞者压力局';
      this.spinLabel.string = 'SPIN';
      this.publishBridge();
      console.log(`[FruitGame] ready mode=${this.modeName()} balance=${this.balance}`);
    } catch (error) {
      this.statusLabel.string = `资源载入失败: ${String(error)}`;
      console.error('[FruitGame] resource load failed', error);
    }
  }

  update(dt: number): void {
    this.recordPerformance(dt);
    if (!this.spinning) {
      if (this.autoSpin && this.ready) {
        this.autoDelay -= dt;
        if (this.autoDelay <= 0) this.spin();
      }
      return;
    }

    this.elapsed += dt;
    this.symbolTick += dt;
    if (this.symbolTick >= (this.turbo ? 0.035 : 0.07)) {
      this.symbolTick = 0;
      for (let col = 0; col < COLS; col += 1) {
        if (this.stoppedColumns.has(col)) continue;
        for (let row = 0; row < ROWS; row += 1) this.setCell(row, col, 1 + Math.floor(this.random() * 11));
      }
    }

    const base = this.turbo ? 0.28 : 0.72;
    const step = this.turbo ? 0.055 : 0.13;
    for (let col = 0; col < COLS; col += 1) {
      if (!this.stoppedColumns.has(col) && this.elapsed >= base + col * step) this.stopColumn(col);
    }
    if (this.stoppedColumns.size === COLS) this.finishSpin();
  }

  destroy(): void {
    this.destroyed = true;
    this.clearWinAnimation();
    this.bgm?.stop();
    this.root.destroyAllChildren();
    if (this.mainCamera?.isValid) this.mainCamera.visibility |= Layers.Enum.UI_3D;
    this.vatCameraNode?.destroy();
    this.vatCameraNode = null;
    this.mainCamera = null;
    if (sys.isBrowser && typeof window !== 'undefined') {
      delete (window as any).__FRUIT_GAME_SPIN__;
      delete (window as any).__FRUIT_GAME_METRICS__;
    }
  }

  spin(forceBenchmark = false): void {
    if (!this.ready || this.spinning) return;
    const totalBet = this.bets[this.betIndex] * LINE_BET_COUNT;
    if (this.balance < totalBet) {
      this.statusLabel.string = '金币不足，已补充试玩金币';
      this.balance = 10000;
    }
    this.balance -= totalBet;
    this.spinIndex += 1;
    this.clearWinAnimation();
    this.playBgm();
    this.playEffect('spin');
    this.targetGrid = forceBenchmark ? this.fullMaleGrid() : this.nextGrid();
    this.spinning = true;
    this.elapsed = 0;
    this.symbolTick = 0;
    this.stoppedColumns.clear();
    this.spinLabel.string = 'STOP';
    this.winLabel.string = 'GOOD LUCK';
    this.statusLabel.string = `第 ${this.spinIndex} 局转轴滚动中...`;
    this.refreshEconomy();
  }

  private buildInterface(): void {
    this.createSprite('Background', 'fruit-game/ui/base/fmp_full_bg', 720, 1700, 0, 0);

    const shade = this.node('Shade', this.root, 0, 0);
    setSize(shade, 720, 1280);
    const shadeGfx = shade.addComponent(Graphics);
    shadeGfx.fillColor = new Color(3, 5, 26, 72);
    shadeGfx.rect(-360, -640, 720, 1280);
    shadeGfx.fill();

    this.createSprite('ReelFrame', 'fruit-game/ui/base/fmp_jtk_bk', 680, 602, 0, 150);
    this.winRoot = this.node('WinAnimation', this.root, 0, GRID_CENTER_Y);

    for (let row = 0; row < ROWS; row += 1) {
      const rowSprites: Sprite[] = [];
      for (let col = 0; col < COLS; col += 1) {
        const x = (col - 2) * GRID_SPACING_X;
        const y = GRID_CENTER_Y + (1 - row) * GRID_SPACING_Y;
        const cell = this.node(`Cell-${row}-${col}`, this.root, x, y);
        setSize(cell, 108, 118);
        const backing = cell.addComponent(Graphics);
        backing.fillColor = new Color(13, 18, 74, 176);
        backing.roundRect(-54, -59, 108, 118, 14);
        backing.fill();
        const icon = this.node('Icon', cell, 0, 0);
        setSize(icon, 96, 104);
        const sprite = icon.addComponent(Sprite);
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        rowSprites.push(sprite);
      }
      this.cells.push(rowSprites);
    }

    const topPanel = this.panel('TopPanel', 0, 566, 660, 78, new Color(5, 10, 47, 210));
    this.addLabel(topPanel, 'PARTY FRUITS', 30, new Color(255, 95, 222), -205, 0, 230, 52);
    this.balanceLabel = this.addLabel(topPanel, '', 27, Color.WHITE, 170, 0, 300, 52);
    this.modeLabel = this.addLabel(this.root, `SPINE: ${this.modeName()}`, 20, new Color(92, 224, 255), 0, 505, 400, 34);

    const winPanel = this.panel('WinPanel', 0, -250, 610, 104, new Color(16, 8, 66, 224));
    this.winLabel = this.addLabel(winPanel, 'GOOD LUCK', 38, new Color(255, 223, 83), 0, 10, 580, 58);
    this.statusLabel = this.addLabel(this.root, '', 20, new Color(200, 214, 255), 0, -323, 660, 40);

    this.addButton('Minus', '-', -245, -445, 86, 86, () => this.changeBet(-1));
    const betPanel = this.panel('BetPanel', -135, -445, 126, 86, new Color(8, 18, 68, 230));
    this.betLabel = this.addLabel(betPanel, '', 24, Color.WHITE, 0, 0, 120, 70);
    this.addButton('Plus', '+', -25, -445, 86, 86, () => this.changeBet(1));
    this.addButton('Auto', 'AUTO', 86, -445, 92, 86, () => this.toggleAuto());
    this.addButton('Turbo', 'FAST', 183, -445, 82, 86, () => this.toggleTurbo());

    this.spinButton = this.node('SpinButton', this.root, 290, -445);
    setSize(this.spinButton, 132, 132);
    const spinGfx = this.spinButton.addComponent(Graphics);
    spinGfx.fillColor = new Color(255, 45, 193, 245);
    spinGfx.circle(0, 0, 62);
    spinGfx.fill();
    spinGfx.strokeColor = new Color(95, 229, 255);
    spinGfx.lineWidth = 6;
    spinGfx.circle(0, 0, 58);
    spinGfx.stroke();
    this.spinLabel = this.addLabel(this.spinButton, '...', 27, Color.WHITE, 0, 0, 126, 56);
    this.spinButton.on(Node.EventType.TOUCH_END, () => this.spin());

    this.bgm = this.root.addComponent(AudioSource);
    const effectNode = this.node('Effects', this.root, 0, 0);
    this.effects = effectNode.addComponent(AudioSource);
    this.refreshEconomy();
  }

  private async loadInterfaceSprites(): Promise<void> {
    const sprites = this.root.getComponentsInChildren(Sprite);
    const tasks = sprites.map(async (sprite) => {
      const path = (sprite.node as any).__fruitResourcePath as string | undefined;
      if (!path) return;
      const frame = await loadSpriteFrame(path);
      if (!this.destroyed && sprite.isValid) sprite.spriteFrame = frame;
    });
    await Promise.all(tasks);
  }

  private async loadAudio(): Promise<void> {
    const entries: Array<[string, string]> = [
      ['bgm', 'fruit-game/audio/01_back'],
      ['click', 'fruit-game/audio/03_click'],
      ['spin', 'fruit-game/audio/05_spin'],
      ['stop', 'fruit-game/audio/06_reels_stop'],
      ['win', 'fruit-game/audio/08_win'],
      ['bigwin', 'fruit-game/audio/20_bigwin'],
    ];
    const clips = await Promise.all(entries.map(([, path]) => loadAsset(path, AudioClip)));
    entries.forEach(([key], index) => this.audio.set(key, clips[index]));
  }

  private createSprite(name: string, path: string, width: number, height: number, x: number, y: number): Sprite {
    const node = this.node(name, this.root, x, y);
    setSize(node, width, height);
    (node as any).__fruitResourcePath = path;
    const sprite = node.addComponent(Sprite);
    sprite.sizeMode = Sprite.SizeMode.CUSTOM;
    return sprite;
  }

  private panel(name: string, x: number, y: number, width: number, height: number, color: Color): Node {
    const node = this.node(name, this.root, x, y);
    setSize(node, width, height);
    const graphics = node.addComponent(Graphics);
    graphics.fillColor = color;
    graphics.roundRect(-width / 2, -height / 2, width, height, 20);
    graphics.fill();
    graphics.strokeColor = new Color(81, 109, 255, 220);
    graphics.lineWidth = 3;
    graphics.roundRect(-width / 2, -height / 2, width, height, 20);
    graphics.stroke();
    return node;
  }

  private addButton(name: string, text: string, x: number, y: number, width: number, height: number, action: () => void): Node {
    const node = this.node(name, this.root, x, y);
    setSize(node, width, height);
    const graphics = node.addComponent(Graphics);
    graphics.fillColor = new Color(29, 38, 105, 245);
    graphics.roundRect(-width / 2, -height / 2, width, height, 18);
    graphics.fill();
    graphics.strokeColor = new Color(69, 213, 255, 230);
    graphics.lineWidth = 3;
    graphics.roundRect(-width / 2, -height / 2, width, height, 18);
    graphics.stroke();
    this.addLabel(node, text, text.length > 2 ? 20 : 38, Color.WHITE, 0, 0, width, height - 10);
    node.on(Node.EventType.TOUCH_END, () => {
      this.playEffect('click');
      action();
    });
    return node;
  }

  private addLabel(parent: Node, text: string, fontSize: number, color: Color, x: number, y: number, width: number, height: number): Label {
    const node = this.node(`${text || 'Value'}Label`, parent, x, y);
    setSize(node, width, height);
    const label = node.addComponent(Label);
    label.string = text;
    label.fontSize = fontSize;
    label.lineHeight = Math.max(fontSize + 5, height - 8);
    label.color = color;
    label.horizontalAlign = Label.HorizontalAlign.CENTER;
    label.verticalAlign = Label.VerticalAlign.CENTER;
    label.overflow = Label.Overflow.SHRINK;
    return label;
  }

  private node(name: string, parent: Node, x: number, y: number): Node {
    const node = new Node(name);
    node.layer = parent.layer || Layers.Enum.UI_2D;
    node.parent = parent;
    node.setPosition(x, y);
    return node;
  }

  private setupVatOverlayCamera(): void {
    const scene = this.root.scene;
    const source = scene?.getComponentInChildren(Camera) ?? null;
    if (!scene || !source) {
      console.warn('[FruitGame] VAT overlay camera was not created: main camera missing');
      return;
    }
    this.mainCamera = source;
    source.visibility &= ~Layers.Enum.UI_3D;

    const node = new Node('VatOverlayCamera');
    node.parent = scene;
    node.setWorldPosition(source.node.worldPosition);
    node.setWorldRotation(source.node.worldRotation);
    const camera = node.addComponent(Camera);
    camera.projection = source.projection;
    camera.orthoHeight = source.orthoHeight;
    camera.near = source.near;
    camera.far = source.far;
    camera.priority = source.priority + 1;
    camera.clearFlags = gfx.ClearFlagBit.NONE;
    camera.visibility = Layers.Enum.UI_3D;
    this.vatCameraNode = node;
  }

  private setCell(row: number, col: number, symbol: number): void {
    const sprite = this.cells[row]?.[col];
    const frame = this.symbolFrames[symbol - 1];
    if (!sprite || !frame) return;
    sprite.spriteFrame = frame;
    sprite.node.active = true;
    const source = frame.originalSize;
    const scale = Math.min(100 / source.width, 108 / source.height);
    setSize(sprite.node, source.width * scale, source.height * scale);
  }

  private applyGrid(grid: Grid): void {
    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLS; col += 1) this.setCell(row, col, grid[row][col]);
    }
  }

  private stopColumn(col: number): void {
    this.stoppedColumns.add(col);
    for (let row = 0; row < ROWS; row += 1) this.setCell(row, col, this.targetGrid[row][col]);
    this.playEffect('stop', 0.6);
  }

  private finishSpin(): void {
    this.spinning = false;
    this.spinLabel.string = 'SPIN';
    const win = this.calculateWin(this.targetGrid) * this.bets[this.betIndex];
    this.balance += win;
    this.refreshEconomy();
    if (win > 0) {
      this.winLabel.string = `WIN ${win.toLocaleString()}`;
      this.statusLabel.string = this.isFullMaleGrid(this.targetGrid)
        ? `满屏男舞者大奖 | ${this.modeName()} 演出`
        : `第 ${this.spinIndex} 局中奖`;
      this.playEffect(this.isFullMaleGrid(this.targetGrid) ? 'bigwin' : 'win');
      if (this.isFullMaleGrid(this.targetGrid)) void this.showFullMaleWin();
    } else {
      this.winLabel.string = 'GOOD LUCK';
      this.statusLabel.string = `第 ${this.spinIndex} 局未中奖`;
    }
    this.autoDelay = this.turbo ? 0.35 : 1.1;
  }

  private async showFullMaleWin(): Promise<void> {
    if (!this.maleData || this.destroyed) return;
    for (const row of this.cells) for (const sprite of row) sprite.node.active = false;
    if (this.options.useVat) {
      try {
        this.vatPopulation = await SpineVatPopulation.createFromResources(
          this.winRoot,
          this.maleData.textures[0],
          15,
          'fruit-machine-vat',
          { columns: 5, spacingX: GRID_SPACING_X, spacingY: -GRID_SPACING_Y, scale: 0.75, offsetY: 0 },
        );
      } catch (error) {
        console.error('[FruitGame] VAT win presentation failed', error);
        this.statusLabel.string = `VAT 演出失败: ${String(error)}`;
      }
      return;
    }

    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLS; col += 1) {
        const node = this.node(`OfficialSpine-${row}-${col}`, this.winRoot,
          (col - 2) * GRID_SPACING_X, (1 - row) * GRID_SPACING_Y);
        node.setScale(0.75, 0.75, 0.75);
        const skeleton = node.addComponent(sp.Skeleton);
        skeleton.defaultCacheMode = this.options.cacheMode;
        skeleton.enableBatch = true;
        skeleton.premultipliedAlpha = false;
        skeleton.skeletonData = this.maleData;
        skeleton.setAnimation(0, SYMBOL_ANIMATION, true);
      }
    }
  }

  private clearWinAnimation(): void {
    this.vatPopulation?.destroy();
    this.vatPopulation = null;
    if (this.winRoot?.isValid) this.winRoot.destroyAllChildren();
    for (const row of this.cells) for (const sprite of row) sprite.node.active = true;
  }

  private nextGrid(): Grid {
    const phase = this.spinIndex % 4;
    if (phase === 2) {
      const grid = this.randomGrid();
      for (let col = 0; col < COLS; col += 1) grid[1][col] = 6;
      return grid;
    }
    if (phase === 3) {
      const grid = this.randomGrid();
      for (let col = 0; col < 3; col += 1) grid[col % ROWS][col] = 10;
      return grid;
    }
    if (phase === 0) return this.fullMaleGrid();
    return this.randomGrid();
  }

  private randomGrid(): Grid {
    return Array.from({ length: ROWS }, () =>
      Array.from({ length: COLS }, () => 1 + Math.floor(this.random() * 11)));
  }

  private fullMaleGrid(): Grid {
    return Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => 6));
  }

  private isFullMaleGrid(grid: Grid): boolean {
    return grid.every((row) => row.every((symbol) => symbol === 6));
  }

  private calculateWin(grid: Grid): number {
    let total = 0;
    for (const line of PAY_LINES) {
      const symbols = line.map((row, col) => grid[row][col]);
      let base = symbols.find((symbol) => symbol !== 9) ?? 9;
      if (base < 1 || base > 8) continue;
      let count = 0;
      for (const symbol of symbols) {
        if (symbol === base || symbol === 9) count += 1;
        else break;
      }
      if (count >= 3) total += PAY_TABLE[base]?.[count - 1] ?? 0;
    }
    return total;
  }

  private changeBet(delta: number): void {
    if (this.spinning) return;
    this.betIndex = (this.betIndex + delta + this.bets.length) % this.bets.length;
    this.refreshEconomy();
  }

  private toggleAuto(): void {
    this.autoSpin = !this.autoSpin;
    this.statusLabel.string = this.autoSpin ? '自动 Spin 已开启' : '自动 Spin 已关闭';
    if (this.autoSpin && !this.spinning) this.autoDelay = 0;
  }

  private toggleTurbo(): void {
    this.turbo = !this.turbo;
    this.statusLabel.string = this.turbo ? '快速模式已开启' : '快速模式已关闭';
  }

  private refreshEconomy(): void {
    if (this.balanceLabel) this.balanceLabel.string = `COINS ${this.balance.toLocaleString()}`;
    if (this.betLabel) this.betLabel.string = `BET\n${this.bets[this.betIndex] * LINE_BET_COUNT}`;
  }

  private playBgm(): void {
    if (this.bgm.playing) return;
    const clip = this.audio.get('bgm');
    if (!clip) return;
    this.bgm.clip = clip;
    this.bgm.loop = true;
    this.bgm.volume = 0.28;
    this.bgm.play();
  }

  private playEffect(name: string, volume = 0.8): void {
    const clip = this.audio.get(name);
    if (clip) this.effects.playOneShot(clip, volume);
  }

  private random(): number {
    let x = this.rngState | 0;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.rngState = x >>> 0;
    return this.rngState / 0x100000000;
  }

  private modeName(): string {
    return this.options.useVat ? 'VAT + GPU Instancing' : 'SHARED_CACHE + Batch';
  }

  private publishBridge(): void {
    if (!sys.isBrowser || typeof window === 'undefined') return;
    (window as any).__FRUIT_GAME_SPIN__ = (benchmark = false) => this.spin(Boolean(benchmark));
  }

  private recordPerformance(dt: number): void {
    const device = director.root?.device;
    const drawCalls = device?.numDrawCalls ?? 0;
    this.drawCallTotal += drawCalls;
    this.drawCallSamples += 1;
    this.maxDrawCalls = Math.max(this.maxDrawCalls, drawCalls);
    this.maxGpuInstances = Math.max(this.maxGpuInstances, device?.numInstances ?? 0);
    this.maxTriangles = Math.max(this.maxTriangles, device?.numTris ?? 0);
    this.frameTimes[this.perfCursor] = dt * 1000;
    this.perfCursor = (this.perfCursor + 1) % this.frameTimes.length;
    this.perfCount = Math.min(this.perfCount + 1, this.frameTimes.length);
    this.perfElapsed += dt;
    if (this.perfElapsed < 5 || this.perfCount === 0) return;

    const samples = Array.from(this.frameTimes.subarray(0, this.perfCount)).sort((a, b) => a - b);
    const total = samples.reduce((sum, value) => sum + value, 0);
    const percentile = (ratio: number): number => samples[Math.floor((samples.length - 1) * ratio)];
    const memory = device?.memoryStatus;
    const snapshot: PerfSnapshot = {
      fps: total > 0 ? samples.length * 1000 / total : 0,
      p50FrameMs: percentile(0.5),
      p95FrameMs: percentile(0.95),
      framesOver25Percent: samples.filter((value) => value > 25).length * 100 / samples.length,
      drawCalls,
      averageDrawCalls: this.drawCallSamples > 0 ? this.drawCallTotal / this.drawCallSamples : 0,
      maxDrawCalls: this.maxDrawCalls,
      gpuInstances: this.maxGpuInstances,
      triangles: this.maxTriangles,
      textureMemoryMb: (memory?.textureSize ?? 0) / 1024 / 1024,
      bufferMemoryMb: (memory?.bufferSize ?? 0) / 1024 / 1024,
      gameState: this.spinning ? 'spinning' : this.vatPopulation || this.winRoot?.children.length ? 'win' : 'idle',
      spinIndex: this.spinIndex,
      renderMode: this.modeName(),
    };
    if (sys.isBrowser && typeof window !== 'undefined') (window as any).__FRUIT_GAME_METRICS__ = snapshot;
    console.log(`[FruitGamePerf] ${JSON.stringify(snapshot)}`);
    this.perfElapsed = 0;
    this.drawCallTotal = 0;
    this.drawCallSamples = 0;
    this.maxDrawCalls = 0;
    this.maxGpuInstances = 0;
    this.maxTriangles = 0;
  }
}

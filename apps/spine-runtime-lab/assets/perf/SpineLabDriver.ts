import {
  _decorator,
  Canvas,
  Color,
  Component,
  director,
  EventTouch,
  Graphics,
  ImageAsset,
  input,
  Input,
  Label,
  Node,
  resources,
  screen,
  sp,
  Sprite,
  SpriteFrame,
  sys,
  Texture2D,
  UITransform,
  Vec3,
  view,
} from 'cc';
import type { SpineVatPlayOptions } from '../../extensions/spine-vat-importer/assets/runtime/SpineVatPlayback';
import {
  ensureVatRuntimeClasses,
  loadSkeletonData,
  runtimeClass,
  SpineVatRuntimePopulation,
  type VatPopulationLayout,
} from './SpineVatRuntimePopulation';

const { ccclass, property } = _decorator;

/** 遮挡探针：取 clip 里包围盒最大的一帧，让被测实例在屏幕上有足够多的不透明像素。 */
interface OcclusionProbeSpec {
  clip: string;
  frame: number;
  fps: number;
  centerX: number;
  centerY: number;
  width: number;
  height: number;
}

/** 两种 VAT 组件：ui = spinevat.UiSkeleton（UI batch），mesh = spinevat.Skeleton（MeshRenderer）。 */
type VatKind = 'ui' | 'mesh';

/** 测试只用组件的公开接口，和业务代码用法相同。 */
type VatComponent = Component & {
  skeletonData: unknown;
  initialClipIndex: number;
  loop: boolean;
  setManualFrame(frame: number | null): void;
};

/** 在 probeRoot 下建一个定格在 frame 的被测实例（VAT 或官方 Spine），返回其节点。 */
type OcclusionProbeFactory = (name: string, frame: number) => Node | Promise<Node>;

interface PerformanceSnapshot {
  fps: number;
  p50FrameMs: number;
  p95FrameMs: number;
  framesOver25Percent: number;
  samples: number;
  drawCalls: number;
  averageDrawCalls: number;
  maxDrawCalls: number;
  gpuInstances: number;
  triangles: number;
  textureMemoryMb: number;
  bufferMemoryMb: number;
}

/**
 * Runtime probe for the Cocos 3.8 Spine path.
 *
 * The test deliberately shares one SkeletonData asset between all instances,
 * then changes only cache mode and enableBatch. GPU instancing is reported as
 * unsupported for this 2D UI renderer path; the comparison is the supported
 * Spine knobs (shared cache and batch).
 */
@ccclass('SpineLabDriver')
export class SpineLabDriver extends Component {
  @property({ tooltip: 'Spine 实例数' })
  instanceCount = 20;

  @property({ tooltip: '0=REALTIME, 1=SHARED_CACHE, 2=PRIVATE_CACHE' })
  cacheMode = 0;

  @property({ tooltip: '开启 Skeleton.enableBatch' })
  enableBatch = true;

  @property({ tooltip: '自动加载 assetMode 对应的 Spine 资源' })
  autoLoadSpine = true;

  @property({ tooltip: '2=水果机男舞者 4.2, 3=男舞者剪裁动画测试（URL asset=cliptest）' })
  assetMode = 2;

  @property({ tooltip: '0=官方 Spine Runtime, 2=VAT 3D（spinevat.Skeleton，MeshRenderer）, 3=VAT 2D（spinevat.UiSkeleton，UI batch）' })
  renderMode = 0;

  @property({ tooltip: '>0 时按该秒数轮换 A/B 阶段：每个实例数跑 VAT 2D 插值 / 2D 阶跃 / 3D 插值 / 官方 SHARED_CACHE，最后 2D 与官方各跑一次穿插+遮挡' })
  abPhaseSeconds = 0;

  @property({ tooltip: 'A/B 实例数扫描，如 "30,150,600"；穿插+遮挡阶段只跑第一个数量。空 = 用 instanceCount' })
  abInstanceCounts = '';

  @property({ tooltip: '保真度测试：VAT 与 REALTIME Spine 同一帧左右并排，host 侧 tools/check-fidelity.py 读截图逐像素比对；跑完转入 A/B' })
  fidelityTest = false;

  @property({ tooltip: 'VAT v2 为每个实例分配不同动画、相位、速度和颜色' })
  vatIndependentDemo = false;

  @property({ tooltip: '普通图片交错/遮挡测试：0=关闭，1=交错，2=遮挡，3=两者都测' })
  spriteMixMode = 0;

  @property({ type: sp.SkeletonData, tooltip: '可替换为自己的 Spine SkeletonData' })
  skeletonData: sp.SkeletonData | null = null;

  private statusLabel!: Label;
  private detailLabel!: Label;
  private probeRoot!: Node;
  private proxyGfx: Graphics | null = null;
  private skeletons: sp.Skeleton[] = [];
  private elapsed = 0;
  private frameCount = 0;
  private frameTime = 0;
  private modeApplied = -1;
  private loading = false;
  private vatPopulationV2: SpineVatRuntimePopulation | null = null;
  private vatReference: sp.Skeleton | null = null;
  private vatBuildId = 0;
  private perfElapsed = 0;
  private perfSampleCount = 0;
  private perfSampleCursor = 0;
  private readonly perfFrameTimes = new Float32Array(300);
  private latestPerformance: PerformanceSnapshot | null = null;
  private perfDrawCallTotal = 0;
  private perfDrawCallSamples = 0;
  private perfMaxDrawCalls = 0;
  private perfMaxGpuInstances = 0;
  private perfMaxTriangles = 0;
  private vatUiActive = false;
  private abPhaseIndex = 0;
  private occlusionSpec: OcclusionProbeSpec | null = null;
  private abElapsed = 0;

  /** 同一 APK、同一温升条件下交替跑，避免两次安装之间的设备状态差异混进 A/B。 */
  private abPhases: { renderMode: number; cacheMode: number; spriteMixMode: number; count: number; interpolate?: boolean }[] = [];
  /** VAT UI 帧间插值开关（SpineVatUiSkeleton.interpolate）；A/B 逐阶段切换，量低端机上的 VS 开销。 */
  private vatInterpolate = true;

  private static readonly COUNT_KEY = 'spine-lab.instance-count';
  private static readonly MODE_KEY = 'spine-lab.cache-mode';
  private static readonly BATCH_KEY = 'spine-lab.enable-batch';
  private static readonly INSTANCE_COUNTS = [0, 1, 5, 10, 15, 20, 30];

  onLoad(): void {
    this.restoreProfile();
    this.applyBrowserProfile();
    if (this.isVatModeRequested() && sys.isBrowser && typeof window !== 'undefined') {
      const requestedCount = Number(new URLSearchParams(window.location.search).get('count'));
      if (SpineLabDriver.INSTANCE_COUNTS.includes(requestedCount)) this.instanceCount = requestedCount;
    }
    this.probeRoot = new Node('SpineInstances');
    this.probeRoot.parent = this.node;

    const ui = this.probeRoot.addComponent(UITransform);
    ui.setContentSize(1280, 620);
    this.createHud();
    input.on(Input.EventType.TOUCH_END, this.onTouchEnd, this);
    if (this.abPhaseSeconds > 0) {
      const counts = this.abInstanceCounts.split(',').map(Number).filter((count) => count > 0);
      if (counts.length === 0) counts.push(this.instanceCount);
      for (const count of counts) {
        this.abPhases.push({ renderMode: 3, cacheMode: 1, spriteMixMode: 0, count, interpolate: true });
        this.abPhases.push({ renderMode: 3, cacheMode: 1, spriteMixMode: 0, count, interpolate: false });
        this.abPhases.push({ renderMode: 2, cacheMode: 1, spriteMixMode: 0, count, interpolate: true });
        this.abPhases.push({ renderMode: 0, cacheMode: 1, spriteMixMode: 0, count });
      }
      this.abPhases.push({ renderMode: 3, cacheMode: 1, spriteMixMode: 3, count: counts[0] });
      this.abPhases.push({ renderMode: 0, cacheMode: 1, spriteMixMode: 3, count: counts[0] });
      this.applyAbPhase();
    }

    if (this.autoLoadSpine && !this.skeletonData) this.loadSelectedSpine();
    else this.rebuild();
  }

  onDestroy(): void {
    input.off(Input.EventType.TOUCH_END, this.onTouchEnd, this);
    this.vatPopulationV2?.destroy();
  }

  update(dt: number): void {
    this.vatPopulationV2?.updateHybrid();
    if (!this.fidelityTest) this.recordPerformance(dt);
    if (this.abPhaseSeconds > 0 && this.skeletonData) {
      if (!this.fidelityTest) this.abElapsed += dt;
      if (this.abElapsed >= this.abPhaseSeconds) {
        this.abElapsed = 0;
        this.abPhaseIndex = (this.abPhaseIndex + 1) % this.abPhases.length;
        this.applyAbPhase();
        this.rebuild();
      }
    }
    this.elapsed += dt;
    this.frameCount += 1;
    this.frameTime += dt;
    if (this.proxyGfx) this.drawProxy(this.elapsed);

    // Keep the on-screen metric useful without allocating every frame.
    if (this.elapsed > 0.5) {
      const fps = this.frameCount / this.frameTime;
      const mode = this.modeName(this.cacheMode);
      const vatPopulation = this.vatPopulationV2;
      if (vatPopulation) {
        this.detailLabel.string = `source: VAT Extension\ninstances: ${this.instanceCount}\nmode: GPU instancing\ndraw groups: ${vatPopulation.drawGroups}\nVAT textures: ${(vatPopulation.textureBytes / 1024 / 1024).toFixed(2)} MB\napprox fps: ${fps.toFixed(1)}`;
      } else if (this.vatUiActive) {
        this.detailLabel.string = `source: ${this.vatModeName()}\ninstances: ${this.instanceCount}\nsprite mix: ${this.spriteMixMode}\napprox fps: ${fps.toFixed(1)}`;
      } else {
        const source = this.skeletons.length > 0 ? 'real Spine' : 'proxy (asset not loaded)';
        this.detailLabel.string = `source: ${source}\ninstances: ${this.instanceCount}\nmode: ${mode}\nenableBatch: ${this.enableBatch}\napprox fps: ${fps.toFixed(1)}\nGPU instancing: not used by sp.Skeleton (2D UI path)`;
      }
      if (sys.isBrowser && typeof window !== 'undefined') {
        const device = director.root?.device;
        (window as any).__SPINE_LAB_METRICS__ = {
          fps,
          drawCalls: device?.numDrawCalls ?? 0,
          instances: device?.numInstances ?? 0,
          triangles: device?.numTris ?? 0,
          mode: this.vatPopulationV2 ? 'VAT_EXT' : mode,
          instanceCount: this.instanceCount,
          ...this.latestPerformance,
        };
      }
      this.frameCount = 0;
      this.frameTime = 0;
      this.elapsed = 0;
    }

    if (this.modeApplied !== this.cacheMode && this.skeletons.length > 0) this.rebuild();
  }

  /** Rebuild the population after changing inspector properties at runtime. */
  rebuild(): void {
    if (!this.probeRoot) return;
    this.loading = false;
    this.vatBuildId += 1;
    this.vatPopulationV2?.destroy();
    this.vatPopulationV2 = null;
    this.vatReference = null;
    this.vatUiActive = false;
    this.destroyChildren();
    this.skeletons = [];
    this.proxyGfx = null;
    this.modeApplied = this.cacheMode;
    this.resetPerformanceWindow();

    if (!this.skeletonData) {
      const proxy = new Node('Proxy');
      proxy.parent = this.probeRoot;
      this.proxyGfx = proxy.addComponent(Graphics);
      this.statusLabel.string = 'Spine asset unavailable - running proxy only';
      return;
    }

    if (this.fidelityTest) {
      void this.runFidelity(this.vatBuildId);
      return;
    }
    if (this.renderMode === 3) {
      void this.rebuildVatUi(this.vatBuildId);
      return;
    }
    if (this.isVatV2Requested()) {
      void this.rebuildVatV2(this.vatBuildId);
      return;
    }
    const mode = this.cacheMode as sp.SpineAnimationCacheMode;
    const layout = this.populationLayout();
    const columns = layout.columns ?? Math.max(1, Math.ceil(Math.sqrt(this.instanceCount)));
    const spacingX = layout.spacingX ?? 140;
    const spacingY = layout.spacingY ?? 160;
    const rows = Math.ceil(this.instanceCount / columns);
    for (let i = 0; i < this.instanceCount; i += 1) {
      const node = new Node(`Skeleton-${i}`);
      node.parent = this.probeRoot;
      const x = (i % columns - (columns - 1) / 2) * spacingX;
      const y = (Math.floor(i / columns) - (rows - 1) / 2) * spacingY;
      node.setPosition(new Vec3(x, y + (layout.offsetY ?? -40), 0));
      const scale = layout.scale ?? 1;
      node.setScale(scale, scale, scale);
      const skeleton = node.addComponent(sp.Skeleton);
      skeleton.defaultCacheMode = mode;
      skeleton.skeletonData = this.getActiveSkeletonData();
      skeleton.premultipliedAlpha = this.atlasPremultiplied();
      skeleton.enableBatch = this.enableBatch;
      skeleton.animation = this.animationName();
      skeleton.loop = true;
      this.skeletons.push(skeleton);
    }
    this.statusLabel.string = `Loaded shared SkeletonData - ${this.instanceCount} instances`;
    console.log(`[SpineLab] asset=${this.assetName()} instances=${this.instanceCount} mode=${this.modeName(this.cacheMode)} enableBatch=${this.enableBatch}`);
    if (this.spriteMixMode > 0) {
      const probe: OcclusionProbeFactory = (name, frame) => {
        const node = new Node(name);
        node.parent = this.probeRoot;
        node.layer = this.probeRoot.layer;
        // 参照组：定格用 REALTIME（缓存模式不能任意 seek），只多 2 个实例。
        const skeleton = node.addComponent(sp.Skeleton);
        skeleton.skeletonData = this.getActiveSkeletonData();
        skeleton.setAnimationCacheMode(sp.SpineAnimationCacheMode.REALTIME);
        skeleton.premultipliedAlpha = this.atlasPremultiplied();
        skeleton.enableBatch = this.enableBatch;
        const entry = skeleton.setAnimation(0, this.animationName(), false);
        if (entry) entry.trackTime = frame / (this.occlusionSpec?.fps ?? 30);
        skeleton.timeScale = 0; // 定格方式见 runFidelity
        return node;
      };
      void this.setupSiblingMixTest(this.skeletons.map((skeleton) => skeleton.node), this.vatBuildId, probe);
    }
  }

  private isVatModeRequested(): boolean {
    return this.renderMode >= 2 || this.isVatV2Requested();
  }

  private isVatV2Requested(): boolean {
    if (this.renderMode === 2) return true;
    if (!sys.isBrowser || typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('vat2') === '1';
  }

  private isVatCompareRequested(): boolean {
    if (!sys.isBrowser || typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('compare') === '1';
  }

  /** 图集页声明 pma: true 才按预乘渲染；默认值 true 会让 straight 图集整片发白。 */
  private atlasPremultiplied(): boolean {
    return /^s*pmas*:s*true/mi.test(this.getActiveSkeletonData().atlasText ?? '');
  }

  /**
   * 保真度测试：每页一个 渲染方式 × clip × 变体，每行一帧，左 = VAT（setManualFrame），右 = REALTIME sp.Skeleton（同一时刻、同一缩放）。
   * 每页停 4 秒并打 [SpineFidelity] 行（屏幕矩形 + 右侧偏移），host 截图后逐像素比对（tools/check-fidelity.py）。
   */
  private async runFidelity(buildId: number): Promise<void> {
    await ensureVatRuntimeClasses();
    const data = await loadSkeletonData(this.vatV2ResourceRoot());
    const manifest = data.manifest;
    const [minX, minY, maxX, maxY] = manifest.layouts[0].bounds;
    const visible = view.getVisibleSize();
    const camera = director.getScene()?.getComponentInChildren(Canvas)?.cameraComponent;
    const windowSize = screen.windowSize;
    const rows = 6;
    const cellW = visible.width / 2 - 20;
    const cellH = (visible.height - 160) / rows;
    const scale = Math.min(cellW / (maxX - minX), cellH / (maxY - minY)) * 0.9;
    const premultiplied = this.atlasPremultiplied();
    console.log(`[SpineFidelity] start clips=${manifest.clips.length} alpha=${manifest.alphaMode} spinePma=${premultiplied}`);
    // 每个 clip 三页：整帧（插值开，t=0 应与阶跃一致）/ 半帧阶跃（基线）/ 半帧插值。
    const variants = [{ half: 0, lerp: true }, { half: 0.5, lerp: false }, { half: 0.5, lerp: true }];
    const kinds: VatKind[] = ['ui', 'mesh'];
    const pagesPerKind = manifest.clips.length * variants.length;
    for (let page = 0; page < pagesPerKind * kinds.length; page += 1) {
      if (buildId !== this.vatBuildId || !this.isValid) return;
      this.destroyChildren();
      const kind = kinds[Math.floor(page / pagesPerKind)];
      const clip = manifest.clips[Math.floor((page % pagesPerKind) / variants.length)];
      const { half, lerp } = variants[page % variants.length];
      this.vatInterpolate = lerp;
      // 半帧取到倒数第二帧为止：末帧之后非循环 clip 没有下一帧可插。
      const last = clip.frameCount - 1 - (half > 0 ? 1 : 0);
      const frames = [0, 1, 2, Math.floor(clip.frameCount / 3), Math.floor(clip.frameCount * 2 / 3), last]
        .map((frame) => frame + half);
      const seeks: { spine: sp.Skeleton; frame: number }[] = [];
      for (let row = 0; row < rows; row += 1) {
        const frame = frames[row];
        const centerY = visible.height / 2 - 120 - cellH * (row + 0.5);
        const place = (node: Node, x: number): void => {
          node.parent = this.probeRoot;
          node.layer = this.probeRoot.layer;
          node.setPosition(x - (minX + maxX) / 2 * scale, centerY - (minY + maxY) / 2 * scale, 0);
          node.setScale(scale, scale, scale);
        };
        const vatNode = await this.addVatSkeleton(kind, data, `Fidelity-${kind}-${frame}`, clip.name);
        if (buildId !== this.vatBuildId || !this.isValid) return;
        place(vatNode, -visible.width / 4);
        (vatNode.getComponent(kind === 'ui' ? 'spinevat.UiSkeleton' : 'spinevat.Skeleton') as VatComponent)
          .setManualFrame(frame);
        const spineNode = new Node(`Fidelity-spine-${frame}`);
        place(spineNode, visible.width / 4);
        const spine = spineNode.addComponent(sp.Skeleton);
        spine.skeletonData = this.getActiveSkeletonData();
        spine.setAnimationCacheMode(sp.SpineAnimationCacheMode.REALTIME);
        spine.premultipliedAlpha = premultiplied;
        spine.useTint = true;
        spine.enableBatch = false;
        seeks.push({ spine, frame });
        const low = new Vec3();
        const high = new Vec3();
        const left = vatNode.worldPosition;
        camera?.worldToScreen(new Vec3(left.x + minX * scale, left.y + minY * scale, 0), low);
        camera?.worldToScreen(new Vec3(left.x + maxX * scale, left.y + maxY * scale, 0), high);
        const shifted = new Vec3();
        camera?.worldToScreen(new Vec3(spineNode.worldPosition.x + minX * scale, left.y + minY * scale, 0), shifted);
        console.log(`[SpineFidelity] page=${page} clip=${clip.name} frame=${frame} lerp=${lerp ? 1 : 0} fps=${clip.fps}`
          + ` rect=${Math.round(low.x)},${Math.round(low.y)},${Math.round(high.x)},${Math.round(high.y)}`
          + ` dx=${Math.round(shifted.x - low.x)} window=${windowSize.width}x${windowSize.height} renderer=${kind}`);
      }
      // 定格参照帧：直接写 trackTime，timeScale = 0 让组件每帧照常 apply + 刷新渲染数据但时间不走。
      // 不能用 updateAnimation(t)：native 上 JSB 没导出 dtRate（读出 undefined），同步调用推不动时间；
      // 也不能用 paused：暂停后不再刷新渲染数据，画面停在旧结果上。等组件跑过首帧再定位。
      await new Promise<void>((resolve) => this.scheduleOnce(resolve, 0.1));
      for (const { spine, frame } of seeks) {
        const entry = spine.setAnimation(0, clip.name, false);
        if (entry) entry.trackTime = frame / clip.fps;
        spine.timeScale = 0;
      }
      this.statusLabel.string = '';
      await new Promise<void>((resolve) => this.scheduleOnce(resolve, 4));
    }
    this.vatInterpolate = true;
    console.log('[SpineFidelity] done');
    // 对比跑完转入 A/B 循环（同一个包先验画面、再测性能）。
    this.fidelityTest = false;
    if (buildId === this.vatBuildId && this.isValid) this.rebuild();
  }

  private getActiveSkeletonData(): sp.SkeletonData {
    return this.skeletonData!;
  }

  private async rebuildVatV2(buildId: number): Promise<void> {
    try {
      this.statusLabel.string = 'VAT 3D: 正在加载 SkeletonData...';
      await ensureVatRuntimeClasses();
      runtimeClass<{ interpolate: boolean }>('spinevat.Skeleton').interpolate = this.vatInterpolate;
      const requestedClip = sys.isBrowser && typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search).get('clip') ?? this.animationName()
        : this.animationName();
      const population = await SpineVatRuntimePopulation.createFromResources(
        this.probeRoot,
        this.instanceCount,
        this.vatV2ResourceRoot(),
        this.populationLayout(),
        requestedClip,
      );
      if (buildId !== this.vatBuildId || !this.isValid) {
        population.destroy();
        return;
      }
      this.vatPopulationV2 = population;
      const independentDemo = this.vatIndependentDemo || (sys.isBrowser && typeof window !== 'undefined'
        && new URLSearchParams(window.location.search).get('independent') === '1');
      if (independentDemo) this.applyVatV2IndependentDemo(population);
      if (this.spriteMixMode > 0) void this.setupSpriteMixTest(population, buildId);

      if (this.isVatCompareRequested()) {
        const compareOffset = 300;
        const referenceNode = new Node('Spine-v2-Reference');
        referenceNode.parent = this.probeRoot;
        referenceNode.setPosition(-compareOffset, -40, 0);
        const referenceScale = this.populationLayout().scale ?? 0.7;
        referenceNode.setScale(referenceScale, referenceScale, referenceScale);
        const reference = referenceNode.addComponent(sp.Skeleton);
        reference.defaultCacheMode = sp.SpineAnimationCacheMode.REALTIME;
        reference.useTint = true;
        reference.premultipliedAlpha = population.manifest.alphaMode === 'premultiplied';
        reference.skeletonData = this.skeletonData;
        reference.enableBatch = true;
        reference.loop = false;
        reference.paused = true;
        this.vatReference = reference;
        this.setVatV2ReferenceFrame(population.currentClip.name, 0, population.currentClip.fps);
      }

      this.statusLabel.string = `VAT Extension ready - ${this.instanceCount} components / ${population.drawGroups} lanes`;
      this.detailLabel.string = [
        `clips: ${population.manifest.clips.length}`,
        `clip: ${population.currentClip.name}`,
        `lanes: ${population.drawGroups}`,
        `VAT textures: ${(population.textureBytes / 1024 / 1024).toFixed(2)} MB`,
        `alpha: ${population.manifest.alphaMode}`,
        this.spriteMixMode > 0 ? `sprite mix: mode ${this.spriteMixMode}` : '',
      ].join('\n');
      console.log(
        `[SpineVatExtension] asset=${this.assetName()} instances=${this.instanceCount}`
        + ` clips=${population.manifest.clips.length} lanes=${population.drawGroups}`
        + ` vatBytes=${population.textureBytes} alpha=${population.manifest.alphaMode}`,
      );
      if (sys.isBrowser && typeof window !== 'undefined') {
        (window as any).__SPINE_VAT_V2__ = population.manifest;
        (window as any).__SPINE_VAT_V2_READY__ = {
          instances: this.instanceCount,
          clips: population.manifest.clips.map((clip) => clip.name),
          drawGroups: population.drawGroups,
          textureBytes: population.textureBytes,
          alphaMode: population.manifest.alphaMode,
          player: 'spinevat.Skeleton',
          independentDemo,
        };
        (window as any).__SPINE_VAT_V2_SET_CLIP__ = (name: string): unknown => {
          population.setClip(name);
          this.setVatV2ReferenceFrame(name, 0, population.currentClip.fps);
          return population.currentClip;
        };
        (window as any).__SPINE_VAT_V2_SET_FRAME__ = (frame: number | null): void => {
          population.setManualFrame(frame);
          if (frame !== null) {
            this.setVatV2ReferenceFrame(
              population.currentClip.name,
              frame,
              population.currentClip.fps,
            );
          }
        };
        const getInstance = (index: number) => {
          const instance = population.instances[index];
          if (!instance) throw new Error(`VAT v2 instance index out of range: ${index}`);
          return instance;
        };
        (window as any).__SPINE_VAT_V2_INSTANCES__ = population.instances;
        (window as any).__SPINE_VAT_V2_STATES__ = (): unknown[] => (
          population.instances.map((instance) => instance.snapshot())
        );
        (window as any).__SPINE_VAT_V2_PLAY__ = (
          index: number,
          animation: string,
          options?: SpineVatPlayOptions,
        ): unknown => {
          const instance = getInstance(index);
          instance.play(animation, options);
          return instance.snapshot();
        };
        (window as any).__SPINE_VAT_V2_PAUSE__ = (index: number): unknown => {
          const instance = getInstance(index);
          instance.pause();
          return instance.snapshot();
        };
        (window as any).__SPINE_VAT_V2_RESUME__ = (index: number): unknown => {
          const instance = getInstance(index);
          instance.resume();
          return instance.snapshot();
        };
        (window as any).__SPINE_VAT_V2_SEEK__ = (index: number, seconds: number): unknown => {
          const instance = getInstance(index);
          instance.seek(seconds);
          return instance.snapshot();
        };
        (window as any).__SPINE_VAT_V2_SPEED__ = (index: number, speed: number): unknown => {
          const instance = getInstance(index);
          instance.setSpeed(speed);
          return instance.snapshot();
        };
        (window as any).__SPINE_VAT_V2_LOOP__ = (index: number, loop: boolean): unknown => {
          const instance = getInstance(index);
          instance.setLoop(loop);
          return instance.snapshot();
        };
        (window as any).__SPINE_VAT_V2_COLOR__ = (
          index: number,
          red: number,
          green: number,
          blue: number,
          alpha = 1,
        ): unknown => {
          const instance = getInstance(index);
          instance.setColor([red, green, blue, alpha]);
          return instance.snapshot();
        };
        (window as any).__SPINE_VAT_V2_ON_EVENT__ = (
          index: number,
          listener: (event: unknown) => void,
        ): (() => void) => getInstance(index).onEvent(listener);
        (window as any).__SPINE_VAT_V2_SOCKET__ = (index: number, name: string): unknown => (
          getInstance(index).socket(name)
        );
        (window as any).__SPINE_VAT_V2_DEMO_INDEPENDENT__ = (): unknown[] => {
          this.applyVatV2IndependentDemo(population);
          return population.instances.map((instance) => instance.snapshot());
        };
      }
    } catch (error) {
      const message = String(error);
      console.error('[SpineVatExtension] failed', error);
      this.statusLabel.string = `VAT Extension failed: ${message}`;
      if (sys.isBrowser && typeof window !== 'undefined') (window as any).__SPINE_VAT_V2_ERROR__ = message;
    }
  }

  private vatModeName(): string {
    return `${this.renderMode === 2 ? 'VAT_MESH' : 'VAT_UI'}_${this.vatInterpolate ? 'LERP' : 'STEP'}`;
  }

  /** 按使用者的流程建一个 VAT 实例；mesh 要等组件加载完（setManualFrame 之前）。 */
  private async addVatSkeleton(kind: VatKind, data: unknown, name: string, clip: string): Promise<Node> {
    const type = runtimeClass<(new () => VatComponent) & { interpolate: boolean }>(
      kind === 'ui' ? 'spinevat.UiSkeleton' : 'spinevat.Skeleton',
    );
    type.interpolate = this.vatInterpolate;
    const node = new Node(name);
    node.parent = this.probeRoot;
    node.layer = this.probeRoot.layer;
    const skeleton = node.addComponent(type as never) as VatComponent;
    skeleton.skeletonData = data;
    skeleton.initialClipIndex = (data as { manifest: { clips: { name: string }[] } }).manifest.clips
      .findIndex((entry) => entry.name === clip) + 1;
    skeleton.loop = true;
    if (kind === 'mesh') await (skeleton as unknown as { reload(): Promise<void> }).reload();
    return node;
  }

  private applyAbPhase(): void {
    const phase = this.abPhases[this.abPhaseIndex];
    this.instanceCount = phase.count;
    this.renderMode = phase.renderMode;
    this.cacheMode = phase.cacheMode;
    this.spriteMixMode = phase.spriteMixMode;
    this.vatInterpolate = phase.interpolate ?? true;
    this.enableBatch = true;
    console.log(`[SpineAB] phase=${this.abPhaseIndex}`
      + ` mode=${phase.renderMode >= 2 ? this.vatModeName() : this.modeName(phase.cacheMode)}`
      + ` mix=${phase.spriteMixMode} count=${phase.count} seconds=${this.abPhaseSeconds}`);
  }

  /** VAT UI 原型：每实例一个 spinevat.UiSkeleton，每 lane 一个 UIRenderer，和 Sprite 同走 Batcher2D。 */
  private async rebuildVatUi(buildId: number): Promise<void> {
    try {
      this.statusLabel.string = 'VAT UI: 正在加载...';
      await ensureVatRuntimeClasses();
      const data = await loadSkeletonData(this.vatV2ResourceRoot());
      if (buildId !== this.vatBuildId || !this.isValid) return;
      const layout = this.populationLayout();
      const columns = layout.columns ?? Math.max(1, Math.ceil(Math.sqrt(this.instanceCount)));
      const rows = Math.max(1, Math.ceil(this.instanceCount / columns));
      const scale = layout.scale ?? 1;
      const nodes: Node[] = [];
      let instanceVertices = 0;
      for (let index = 0; index < this.instanceCount; index += 1) {
        const node = await this.addVatSkeleton('ui', data, `VatUi-${index}`, this.animationName());
        node.setPosition(new Vec3(
          (index % columns - (columns - 1) / 2) * (layout.spacingX ?? 140),
          (Math.floor(index / columns) - (rows - 1) / 2) * (layout.spacingY ?? 160) + (layout.offsetY ?? -40),
          0,
        ));
        node.setScale(scale, scale, scale);
        instanceVertices = (node.getComponent('spinevat.UiSkeleton') as unknown as { vertexCount: number }).vertexCount;
        nodes.push(node);
      }
      this.vatUiActive = true;
      this.statusLabel.string = `${this.vatModeName()} - ${this.instanceCount} instances`;
      console.log(`[SpineVatUi] instances=${this.instanceCount} instanceVertices=${instanceVertices}`
        + ` vertexBytesPerFrame=${instanceVertices * this.instanceCount * 8}`);
      const probe: OcclusionProbeFactory = async (name, frame) => {
        const node = await this.addVatSkeleton('ui', data, name, this.animationName());
        (node.getComponent('spinevat.UiSkeleton') as VatComponent).setManualFrame(frame);
        return node;
      };
      if (this.spriteMixMode > 0) await this.setupSiblingMixTest(nodes, buildId, probe);
    } catch (error) {
      console.error('[SpineVatUi] failed', error);
      this.statusLabel.string = `VAT UI failed: ${String(error)}`;
    }
  }

  /**
   * 2D 穿插/遮挡按兄弟顺序摆（UI batch 只认遍历顺序，不认 z）：
   * 交错 = 前 10 个实例后面各插一张图；遮挡 = setupOcclusionProbe 的像素探针（网格外单独摆，host 侧读像素判定）。
   */
  private async setupSiblingMixTest(nodes: Node[], buildId: number, probe: OcclusionProbeFactory): Promise<void> {
    try {
      const texture = await new Promise<Texture2D>((resolve, reject) => {
        resources.load('sprites/fmp_icon_1/texture', Texture2D, (error, asset) => {
          if (error || !asset) reject(error ?? new Error('普通图片测试纹理加载失败'));
          else resolve(asset);
        });
      });
      if (buildId !== this.vatBuildId || !this.isValid) return;
      const frame = new SpriteFrame();
      frame.texture = texture;
      const place = (target: Node, after: boolean, color: Color, size: number, name: string): void => {
        this.addMixSprite(this.probeRoot, frame, target.position.x, target.position.y, 0, color, size, name);
        const sprite = this.probeRoot.children[this.probeRoot.children.length - 1];
        sprite.setSiblingIndex(target.getSiblingIndex() + (after ? 1 : 0));
      };

      let sprites = 0;
      if (this.spriteMixMode === 1 || this.spriteMixMode === 3) {
        for (let index = 0; index < Math.min(10, nodes.length); index += 1) {
          place(nodes[index], true, new Color(255, 210, 80, 170), 92, `InterleaveSprite-${index}`);
          sprites += 1;
        }
      }
      if (this.spriteMixMode === 2 || this.spriteMixMode === 3) {
        await this.setupOcclusionProbe(probe);
        sprites += 2;
      }
      console.log(`[SpineSpriteMix] order=sibling mode=${this.spriteMixMode} ordinarySprites=${sprites}`);
    } catch (error) {
      console.error('[SpineSpriteMix] failed', error);
    }
  }

  /**
   * 遮挡像素探针：在网格上方空白处摆两组，与网格不重叠。
   * back  = 不透明纯蓝方块在前、被测实例在后（兄弟顺序），方块内应能看到实例像素（非纯蓝占比明显）；
   * front = 被测实例在前、不透明纯红方块在后，方块内应全是纯红。
   * 被测实例定格在包围盒最大的一帧。判定在 host 侧：tools/check-occlusion.py 读截图 + 本日志的屏幕矩形。
   */
  private async setupOcclusionProbe(probe: OcclusionProbeFactory): Promise<void> {
    const spec = await this.occlusionProbeSpec();
    const visible = view.getVisibleSize();
    const scale = 0.45;
    // back 方块比实例大一圈：否则实例把它整块盖住，截图里看不到蓝，证明不了方块真的画了。
    // front 方块小于实例：整块都该是红。
    const small = Math.round(Math.min(spec.width, spec.height) * scale * 0.5);
    const large = Math.round(Math.max(spec.width, spec.height) * scale * 1.3);
    const centerY = visible.height / 2 - 120 - spec.height * scale / 2;
    const solid = this.solidSpriteFrame();
    const camera = director.getScene()?.getComponentInChildren(Canvas)?.cameraComponent;
    const windowSize = screen.windowSize;
    const cases = [
      { name: 'back', x: -visible.width / 4, color: new Color(0, 0, 255, 255), spriteFirst: true, size: large },
      { name: 'front', x: visible.width / 4, color: new Color(255, 0, 0, 255), spriteFirst: false, size: small },
    ];
    for (const testCase of cases) {
      const addSprite = (): Node => {
        this.addMixSprite(this.probeRoot, solid, testCase.x, centerY, 0, testCase.color, testCase.size, `Occlusion-${testCase.name}-sprite`);
        return this.probeRoot.children[this.probeRoot.children.length - 1];
      };
      const addProbe = async (): Promise<void> => {
        const node = await probe(`Occlusion-${testCase.name}-subject`, spec.frame);
        node.setPosition(testCase.x - spec.centerX * scale, centerY - spec.centerY * scale, 0);
        node.setScale(scale, scale, scale);
      };
      let sprite: Node;
      if (testCase.spriteFirst) {
        sprite = addSprite();
        await addProbe();
      } else {
        await addProbe();
        sprite = addSprite();
      }
      const box = sprite.getComponent(UITransform)!.getBoundingBoxToWorld();
      const low = new Vec3();
      const high = new Vec3();
      camera?.worldToScreen(new Vec3(box.xMin, box.yMin, 0), low);
      camera?.worldToScreen(new Vec3(box.xMax, box.yMax, 0), high);
      const c = testCase.color;
      console.log(`[SpineOcclusion] case=${testCase.name} sprite=${c.r},${c.g},${c.b}`
        + ` expect=${testCase.spriteFirst ? 'subject-over-sprite' : 'sprite-over-subject'}`
        + ` rect=${Math.round(low.x)},${Math.round(low.y)},${Math.round(high.x)},${Math.round(high.y)}`
        + ` window=${windowSize.width}x${windowSize.height} clip=${spec.clip} frame=${spec.frame}`
        + ` mode=${this.renderMode >= 2 ? this.vatModeName() : this.modeName(this.cacheMode)}`);
    }
    // 混合探针：定格在 additive lane 有可见顶点的帧（frame 0 没有），用于对比不同混合实现的截图。
    const blend = await probe('Occlusion-blend-subject', 20);
    blend.setPosition(-spec.centerX * scale, centerY - spec.centerY * scale, 0);
    blend.setScale(scale, scale, scale);
  }

  private async occlusionProbeSpec(): Promise<OcclusionProbeSpec> {
    if (this.occlusionSpec) return this.occlusionSpec;
    await ensureVatRuntimeClasses();
    const data = await loadSkeletonData(this.vatV2ResourceRoot());
    const manifest = data.manifest;
    const layout = manifest.layouts[0];
    const clip = manifest.clips.find((entry) => entry.name === this.animationName()) ?? manifest.clips[0];
    const pages = data.positionPages.map((page) => new Float32Array(page.buffer()));
    const texelAt = (linear: number): Float32Array => {
      const page = Math.floor(linear / manifest.pageTexels);
      const offset = (linear - page * manifest.pageTexels) * 4;
      return pages[page].subarray(offset, offset + 4);
    };
    // 固定槽位 layout：顶点区之后是剪裁区；受剪裁的顶点是剪裁前的原始位置，要夹进当帧剪裁多边形的包围盒。
    const clipCount = layout.clipCount;
    const vertexArea = layout.frameStride - clipCount * 8;
    let best: OcclusionProbeSpec | null = null;
    for (let frame = 0; frame < clip.frameCount; frame += 1) {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      const frameBase = (clip.frameOffset + frame) * layout.frameStride;
      const clipBoxes = Array.from({ length: clipCount }, (_, index) => {
        const box = [Infinity, Infinity, -Infinity, -Infinity];
        for (let point = 0; point < 8; point += 1) {
          const texel = texelAt(frameBase + vertexArea + index * 8 + point);
          if (texel[2] < 0.5) return null; // 这帧剪裁没生效
          box[0] = Math.min(box[0], texel[0]); box[1] = Math.min(box[1], texel[1]);
          box[2] = Math.max(box[2], texel[0]); box[3] = Math.max(box[3], texel[1]);
        }
        return box;
      });
      for (let vertex = 0; vertex < vertexArea; vertex += 1) {
        const texel = texelAt(frameBase + vertex);
        // 未用的顶点槽整条为 0、固定槽位里没画出来的键 uv 为 -1，别让它们把包围盒拉偏。
        if (texel[0] === 0 && texel[1] === 0 && texel[2] === 0 && texel[3] === 0) continue;
        if (texel[2] < 0) continue;
        let x = texel[0];
        let y = texel[1];
        const clipIndex = clipCount > 0 ? texelAt(layout.staticFrame * layout.frameStride + vertex)[0] : -1;
        const box = clipIndex >= 0 ? clipBoxes[clipIndex] : null;
        if (box) {
          x = Math.min(Math.max(x, box[0]), box[2]);
          y = Math.min(Math.max(y, box[1]), box[3]);
        }
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
      const width = maxX - minX;
      const height = maxY - minY;
      if (width > 0 && (!best || width * height > best.width * best.height)) {
        best = {
          clip: clip.name,
          frame,
          fps: clip.fps,
          centerX: (minX + maxX) / 2,
          centerY: (minY + maxY) / 2,
          width,
          height,
        };
      }
    }
    if (!best) throw new Error(`遮挡探针：clip ${clip.name} 没有可用帧`);
    console.log(`[SpineOcclusion] spec clip=${best.clip} frame=${best.frame}`
      + ` size=${best.width.toFixed(1)}x${best.height.toFixed(1)}`);
    this.occlusionSpec = best;
    return best;
  }

  private solidSpriteFrame(): SpriteFrame {
    const image = new ImageAsset({
      width: 2,
      height: 2,
      _data: new Uint8Array(16).fill(255),
      _compressed: false,
      format: Texture2D.PixelFormat.RGBA8888,
    });
    const texture = new Texture2D();
    texture.image = image;
    const frame = new SpriteFrame();
    frame.texture = texture;
    return frame;
  }

  private applyVatV2IndependentDemo(population: SpineVatRuntimePopulation): void {
    const colors = [
      [1, 1, 1, 1],
      [1, 0.78, 0.70, 1],
      [0.72, 0.92, 1, 1],
      [0.82, 1, 0.72, 1],
      [1, 0.90, 0.62, 1],
    ] as const;
    const clips = population.manifest.clips;
    population.instances.forEach((instance, index) => {
      const clip = clips[index % clips.length];
      const duration = clip.frameCount / clip.fps;
      instance.play(clip.name, {
        loop: true,
        speed: 0.65 + (index % 7) * 0.12,
        startTime: (index * 0.173) % duration,
      });
      instance.setColor(colors[index % colors.length]);
      if (index % 9 === 0) instance.pause();
      else if (index % 9 === 1) instance.seek(duration * 0.67);
    });
    console.log(`[SpineVatV2Demo] independent=true states=${JSON.stringify(
      population.instances.map((instance) => instance.snapshot()),
    )}`);
    const socketName = clips[0]?.sockets?.[0]?.name;
    if (socketName && population.instances[1]) {
      console.log(`[SpineVatV2Socket] phase=before name=${socketName} matrix=${JSON.stringify(
        population.instances[1].socket(socketName),
      )}`);
    }
    this.scheduleOnce(() => {
      if (this.vatPopulationV2 !== population) return;
      console.log(`[SpineVatV2State] states=${JSON.stringify(
        population.instances.map((instance) => instance.snapshot()),
      )}`);
      if (socketName && population.instances[1]) {
        console.log(`[SpineVatV2Socket] phase=after name=${socketName} matrix=${JSON.stringify(
          population.instances[1].socket(socketName),
        )}`);
      }
    }, 2);
  }

  /** Adds 3D SpriteRenderer submissions so image and VAT share the transparent queue. */
  private async setupSpriteMixTest(population: SpineVatRuntimePopulation, buildId: number): Promise<void> {
    try {
      const texture = await new Promise<Texture2D>((resolve, reject) => {
        resources.load('sprites/fmp_icon_1/texture', Texture2D, (error, asset) => {
          if (error || !asset) reject(error ?? new Error('普通图片测试纹理加载失败'));
          else resolve(asset);
        });
      });
      if (buildId !== this.vatBuildId || !this.isValid) return;
      const frame = new SpriteFrame();
      frame.texture = texture;

      if (this.spriteMixMode === 1 || this.spriteMixMode === 3) {
        const count = Math.min(10, population.instances.length);
        for (let index = 0; index < count; index += 1) {
          const vatNode = population.instances[index].component.node;
          vatNode.setPosition(vatNode.position.x, vatNode.position.y, index * 2);
          this.addMixSprite(
            population.parent,
            frame,
            vatNode.position.x,
            vatNode.position.y,
            index * 2 + 1,
            new Color(255, 210, 80, 170),
            92,
            `InterleaveSprite-${index}`,
          );
        }
      }

      if (this.spriteMixMode === 2 || this.spriteMixMode === 3) {
        const backVat = population.instances[Math.min(10, population.instances.length - 1)]?.component.node;
        const frontVat = population.instances[Math.min(11, population.instances.length - 1)]?.component.node;
        if (backVat && frontVat) {
          backVat.setPosition(-260, -20, 100);
          frontVat.setPosition(260, -20, 200);
          this.addMixSprite(
            population.parent,
            frame,
            -260,
            -20,
            90,
            new Color(70, 150, 255, 230),
            220,
            'OcclusionBackSprite',
          );
          this.addMixSprite(
            population.parent,
            frame,
            260,
            -20,
            210,
            new Color(255, 70, 70, 230),
            220,
            'OcclusionFrontSprite',
          );
          console.log('[SpineSpriteMix] occlusion=EXPECTED_2D_ORDER'
            + ' left=Sprite(z90)<VAT(z100)'
            + ' right=VAT(z200)<Sprite(z210)');
        }
      }

      console.log(`[SpineSpriteMix] mode=${this.spriteMixMode}`
        + ` ordinarySprites=${this.spriteMixMode === 1 || this.spriteMixMode === 3 ? Math.min(10, population.instances.length) : 2}`
        + ' note=check drawCalls and screenshot for depth order');
    } catch (error) {
      console.error('[SpineSpriteMix] failed', error);
    }
  }

  private addMixSprite(
    parent: Node,
    frame: SpriteFrame,
    x: number,
    y: number,
    z: number,
    color: Color,
    size: number,
    name: string,
  ): void {
    const node = new Node(name);
    node.parent = parent;
    node.layer = parent.layer;
    node.setPosition(x, y, z);
    node.addComponent(UITransform).setContentSize(size, size);
    const sprite = node.addComponent(Sprite);
    sprite.sizeMode = Sprite.SizeMode.CUSTOM;
    sprite.spriteFrame = frame;
    sprite.color = color;
  }

  private setVatV2ReferenceFrame(animationName: string, frame: number, frameRate: number): void {
    if (!this.vatReference) return;
    this.vatReference.paused = true;
    this.vatReference.clearTracks();
    this.vatReference.setToSetupPose();
    this.vatReference.setAnimation(0, animationName, false);
    (this.vatReference as any)._instance.updateAnimation(Math.max(0, Math.floor(frame)) / frameRate);
    (this.vatReference as any)._markForUpdateRenderData();
  }

  private loadSelectedSpine(): void {
    this.loading = true;
    const resourcePath = this.resourcePath();
    this.statusLabel.string = `Loading resources/${resourcePath}...`;
    resources.load(resourcePath, sp.SkeletonData, (error, asset) => {
      this.loading = false;
      if (error || !asset) {
        this.statusLabel.string = `Spine load failed: ${error?.message ?? 'unknown error'}`;
        this.rebuild();
        return;
      }
      this.skeletonData = asset;
      this.rebuild();
    });
  }

  private assetName(): string {
    return this.assetMode === 3 ? 'nanwuzhe-cliptest' : 'nanwuzhe';
  }

  private resourcePath(): string {
    return this.assetMode === 3 ? 'spine/nanwuzhe/letsparty_tuan_nanwuzhe_cliptest' : 'spine/nanwuzhe/letsparty_tuan_nanwuzhe';
  }

  private animationName(): string {
    return this.assetMode === 3 ? 'clip_toggle' : 'letsparty_tuan_nanwuzhe_tigger';
  }

  private vatV2ResourceRoot(): string {
    return this.assetMode === 3 ? 'vat/nanwuzhe-cliptest' : 'vat/nanwuzhe';
  }

  private populationLayout(): VatPopulationLayout {
    // 30 个以上按面积等比缩小，让所有实例留在屏幕内（片元量不随实例数涨，测的是 CPU/顶点开销）。
    const shrink = Math.max(1, Math.sqrt(this.instanceCount / 30));
    return {
      columns: Math.round(5 * shrink),
      spacingX: 140 / shrink,
      spacingY: 170 / shrink,
      scale: 0.26 / shrink,
      offsetY: -40,
    };
  }

  private createHud(): void {
    const hud = new Node('HUD');
    hud.parent = this.node;
    hud.addComponent(UITransform).setContentSize(1280, 720);
    this.statusLabel = hud.addComponent(Label);
    this.statusLabel.fontSize = 24;
    this.statusLabel.lineHeight = 30;
    this.statusLabel.color = new Color(235, 240, 255, 255);
    this.statusLabel.horizontalAlign = Label.HorizontalAlign.LEFT;
    this.statusLabel.verticalAlign = Label.VerticalAlign.TOP;
    this.statusLabel.node.setPosition(new Vec3(-550, 320, 0));
    this.statusLabel.string = 'Preparing Spine runtime probe...';

    this.detailLabel = new Node('Metrics').addComponent(Label);
    this.detailLabel.node.parent = hud;
    this.detailLabel.fontSize = 18;
    this.detailLabel.lineHeight = 24;
    this.detailLabel.color = new Color(170, 190, 220, 255);
    this.detailLabel.horizontalAlign = Label.HorizontalAlign.LEFT;
    this.detailLabel.verticalAlign = Label.VerticalAlign.TOP;
    this.detailLabel.node.setPosition(new Vec3(-550, 235, 0));
    this.detailLabel.string = 'Waiting for first sample...\nleft: 0/1/5/10/20/30 instances | right-top: cache mode | right-bottom: batch';
  }

  private restoreProfile(): void {
    const countValue = sys.localStorage.getItem(SpineLabDriver.COUNT_KEY);
    const modeValue = sys.localStorage.getItem(SpineLabDriver.MODE_KEY);
    const batch = sys.localStorage.getItem(SpineLabDriver.BATCH_KEY);
    if (countValue !== null) {
      const count = Number(countValue);
      if (SpineLabDriver.INSTANCE_COUNTS.includes(count)) this.instanceCount = count;
    }
    if (modeValue === '0' || modeValue === '1') this.cacheMode = Number(modeValue);
    if (batch === 'true' || batch === 'false') this.enableBatch = batch === 'true';
  }

  private applyBrowserProfile(): void {
    if (!sys.isBrowser || typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const countValue = params.get('count');
    if (countValue !== null) {
      const count = Number(countValue);
      if (SpineLabDriver.INSTANCE_COUNTS.includes(count)) this.instanceCount = count;
    }
    if (params.get('mode') === 'realtime') this.cacheMode = 0;
    if (params.get('mode') === 'shared') this.cacheMode = 1;
    if (params.get('batch') === '0') this.enableBatch = false;
    if (params.get('batch') === '1') this.enableBatch = true;
    if (params.get('asset') === 'cliptest') this.assetMode = 3;
    if (params.get('fidelity') === '1') this.fidelityTest = true;
  }

  private onTouchEnd(event: EventTouch): void {
    // A/B 轮换期间误触会改实例数/模式并写进 localStorage，直接污染数据。
    if (this.abPhaseSeconds > 0) return;
    const position = event.getLocation();
    const size = screen.windowSize;
    if (position.x < size.width / 2) {
      const index = SpineLabDriver.INSTANCE_COUNTS.indexOf(this.instanceCount);
      this.instanceCount = SpineLabDriver.INSTANCE_COUNTS[(index + 1) % SpineLabDriver.INSTANCE_COUNTS.length];
      sys.localStorage.setItem(SpineLabDriver.COUNT_KEY, String(this.instanceCount));
    } else if (position.y > size.height / 2) {
      this.cacheMode = this.cacheMode === 0 ? 1 : 0;
      sys.localStorage.setItem(SpineLabDriver.MODE_KEY, String(this.cacheMode));
    } else {
      this.enableBatch = !this.enableBatch;
      sys.localStorage.setItem(SpineLabDriver.BATCH_KEY, String(this.enableBatch));
    }
    this.rebuild();
  }

  private destroyChildren(): void {
    for (const child of [...this.probeRoot.children]) child.destroy();
  }

  private recordPerformance(dt: number): void {
    const device = director.root?.device;
    const drawCalls = device?.numDrawCalls ?? 0;
    this.perfDrawCallTotal += drawCalls;
    this.perfDrawCallSamples += 1;
    this.perfMaxDrawCalls = Math.max(this.perfMaxDrawCalls, drawCalls);
    this.perfMaxGpuInstances = Math.max(this.perfMaxGpuInstances, device?.numInstances ?? 0);
    this.perfMaxTriangles = Math.max(this.perfMaxTriangles, device?.numTris ?? 0);
    const frameMs = dt * 1000;
    this.perfFrameTimes[this.perfSampleCursor] = frameMs;
    this.perfSampleCursor = (this.perfSampleCursor + 1) % this.perfFrameTimes.length;
    this.perfSampleCount = Math.min(this.perfSampleCount + 1, this.perfFrameTimes.length);
    this.perfElapsed += dt;
    if (this.perfElapsed < 5 || this.perfSampleCount === 0) return;

    const samples = Array.from(this.perfFrameTimes.subarray(0, this.perfSampleCount));
    samples.sort((left, right) => left - right);
    let totalMs = 0;
    let framesOver25 = 0;
    for (const sample of samples) {
      totalMs += sample;
      if (sample > 25) framesOver25 += 1;
    }

    const memory = device?.memoryStatus;
    const percentile = (value: number): number => samples[Math.floor((samples.length - 1) * value)];
    const snapshot: PerformanceSnapshot = {
      fps: totalMs > 0 ? samples.length * 1000 / totalMs : 0,
      p50FrameMs: percentile(0.50),
      p95FrameMs: percentile(0.95),
      framesOver25Percent: framesOver25 * 100 / samples.length,
      samples: samples.length,
      drawCalls,
      averageDrawCalls: this.perfDrawCallSamples > 0
        ? this.perfDrawCallTotal / this.perfDrawCallSamples
        : 0,
      maxDrawCalls: this.perfMaxDrawCalls,
      gpuInstances: this.perfMaxGpuInstances,
      triangles: this.perfMaxTriangles,
      textureMemoryMb: (memory?.textureSize ?? 0) / 1024 / 1024,
      bufferMemoryMb: (memory?.bufferSize ?? 0) / 1024 / 1024,
    };
    this.latestPerformance = snapshot;

    const mode = this.renderMode === 3 ? (this.vatUiActive ? this.vatModeName() : 'VAT_UI_FAILED')
      : this.renderMode === 2 ? (this.vatPopulationV2 ? this.vatModeName() : 'VAT_MESH_FAILED')
        : this.modeName(this.cacheMode);
    console.log(
      `[SpinePerf] mode=${mode} instances=${this.instanceCount} mix=${this.spriteMixMode}`
      + ` fps=${snapshot.fps.toFixed(2)} p50=${snapshot.p50FrameMs.toFixed(2)}`
      + ` p95=${snapshot.p95FrameMs.toFixed(2)} over25=${snapshot.framesOver25Percent.toFixed(2)}`
      + ` samples=${snapshot.samples} drawCalls=${snapshot.drawCalls}`
      + ` drawCallsAvg=${snapshot.averageDrawCalls.toFixed(2)}`
      + ` drawCallsMax=${snapshot.maxDrawCalls}`
      + ` gpuInstances=${snapshot.gpuInstances} triangles=${snapshot.triangles}`
      + ` textureMB=${snapshot.textureMemoryMb.toFixed(2)}`
      + ` bufferMB=${snapshot.bufferMemoryMb.toFixed(2)}`,
    );
    this.perfElapsed = 0;
    this.perfDrawCallTotal = 0;
    this.perfDrawCallSamples = 0;
    this.perfMaxDrawCalls = 0;
    this.perfMaxGpuInstances = 0;
    this.perfMaxTriangles = 0;
  }

  private resetPerformanceWindow(): void {
    this.perfElapsed = 0;
    this.perfSampleCount = 0;
    this.perfSampleCursor = 0;
    this.latestPerformance = null;
    this.perfDrawCallTotal = 0;
    this.perfDrawCallSamples = 0;
    this.perfMaxDrawCalls = 0;
    this.perfMaxGpuInstances = 0;
    this.perfMaxTriangles = 0;
  }

  private drawProxy(time: number): void {
    const g = this.proxyGfx!;
    g.clear();
    g.fillColor = new Color(60, 180, 255, 220);
    const columns = Math.max(1, Math.ceil(Math.sqrt(this.instanceCount)));
    const rows = Math.ceil(this.instanceCount / columns);
    for (let i = 0; i < this.instanceCount; i += 1) {
      const x = (i % columns - (columns - 1) / 2) * 100;
      const y = (Math.floor(i / columns) - (rows - 1) / 2) * 100 - 40;
      const pulse = 1 + Math.sin(time * 3 + i * 0.35) * 0.08;
      g.rect(x - 28 * pulse, y - 36 * pulse, 56 * pulse, 72 * pulse);
    }
    g.fill();
  }

  private modeName(mode: number): string {
    if (mode === 1) return 'SHARED_CACHE';
    if (mode === 2) return 'PRIVATE_CACHE';
    return 'REALTIME';
  }
}

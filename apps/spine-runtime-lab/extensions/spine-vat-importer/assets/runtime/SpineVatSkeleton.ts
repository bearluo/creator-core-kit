import {
  _decorator,
  Enum,
  MeshRenderer,
  setPropertyEnumType,
} from 'cc';
import { EDITOR_NOT_IN_PREVIEW } from 'cc/env';
import type {
  SpineVatColor,
  SpineVatPlayOptions,
  SpineVatRuntimeEvent,
  SpineVatSnapshot,
} from './SpineVatPlayback';
import { SpineVatRenderHandle } from './SpineVatRenderResources';
import type { SpineVatSocketMatrix } from './SpineVatSchema';
import { SpineVatSkeletonData } from './SpineVatSkeletonData';
import { SpineVatSocket, syncSockets } from './SpineVatSocket';

const { ccclass, executeInEditMode, menu, playOnFocus, property } = _decorator;
const DEFAULT_ANIMATIONS = Enum({ '<Default>': 0 });

@ccclass('spinevat.Skeleton')
@executeInEditMode
@playOnFocus
@menu('Spine/VAT Skeleton')
export class SpineVatSkeleton extends MeshRenderer {
  /**
   * 帧间插值总开关：VS 在相邻两帧间插位置与颜色（多一倍 VS 采样，CPU 不变）。
   * 启动时按机型档位定一次；只影响之后加载的实例。
   */
  static interpolate = true;

  @property({ type: SpineVatSkeletonData, visible: false })
  private skeletonDataBacking: SpineVatSkeletonData | null = null;

  @property({ type: SpineVatSkeletonData, displayName: 'Skeleton Data', tooltip: '转换工具导出的 Spine VAT 主资源' })
  get skeletonData(): SpineVatSkeletonData | null {
    return this.skeletonDataBacking;
  }

  set skeletonData(value: SpineVatSkeletonData | null) {
    if (this.skeletonDataBacking === value) return;
    this.stopLoadingAndDispose();
    this.skeletonDataBacking = value;
    if (this.initialClip && !value?.manifest.clips.some((clip) => clip.name === this.initialClip)) {
      this.initialClip = '';
    }
    this.refreshAnimationEnum();
    this.editorSignature = this.assetSignature();
    this.requestReload();
  }

  @property({ visible: false })
  private initialClip = '';

  @property({
    type: DEFAULT_ANIMATIONS,
    displayName: 'Initial Clip',
    tooltip: '赋值 Skeleton Data 后从资源动画列表中选择',
  })
  get initialClipIndex(): number {
    if (!this.initialClip || !this.skeletonDataBacking) return 0;
    const value = this.skeletonDataBacking.getAnimsEnum()[this.initialClip];
    return typeof value === 'number' ? value : 0;
  }

  set initialClipIndex(value: number) {
    const animation = this.skeletonDataBacking?.getAnimsEnum()[value];
    const next = value === 0 || animation === undefined ? '' : String(animation);
    if (this.initialClip === next) return;
    this.initialClip = next;
    this.editorSignature = this.assetSignature();
    this.requestReload();
  }

  @property({ displayName: 'Loop', tooltip: '初始动画是否循环播放' })
  loop = true;

  @property({ displayName: 'Time Scale', tooltip: '动画播放速度', min: 0 })
  timeScale = 1;

  @property({ displayName: 'Preview In Editor', tooltip: '编辑模式下直接播放 VAT 预览' })
  previewInEditor = true;

  @property({ type: [SpineVatSocket], displayName: 'Sockets', tooltip: '挂点：目标节点每帧跟随骨骼。骨骼要在烘焙面板里勾过' })
  sockets: SpineVatSocket[] = [];

  private handle: SpineVatRenderHandle | null = null;
  private loadGeneration = 0;
  private reloadQueued = false;
  private editorSignature = '';
  /** 挂在组件上而不是 handle 上：加载完成前注册的、reload 前注册的都不能丢。 */
  private readonly listeners = new Set<(event: SpineVatRuntimeEvent) => void>();

  private readonly flushReload = (): void => {
    this.reloadQueued = false;
    void this.reload();
  };

  onLoad(): void {
    super.onLoad();
    this.refreshAnimationEnum();
  }

  onEnable(): void {
    super.onEnable();
    this.editorSignature = this.assetSignature();
    this.requestReload();
  }

  update(): void {
    if (EDITOR_NOT_IN_PREVIEW) {
      const signature = this.assetSignature();
      if (signature !== this.editorSignature) {
        this.editorSignature = signature;
        this.refreshAnimationEnum();
        this.requestReload();
      }
    }
    if (!this.handle) return;
    for (const event of this.handle.drainEvents()) {
      for (const listener of this.listeners) listener(event);
    }
  }

  async reload(): Promise<void> {
    this.cancelQueuedReload();
    const generation = ++this.loadGeneration;
    this.disposeHandle();

    if (EDITOR_NOT_IN_PREVIEW && !this.previewInEditor) return;
    const data = this.skeletonDataBacking;
    if (!data) return;

    try {
      const handle = await SpineVatRenderHandle.create(this, data, SpineVatSkeleton.interpolate, this.initialClip || undefined);
      if (!this.isValid || generation !== this.loadGeneration || !this.enabledInHierarchy) {
        handle.destroy();
        return;
      }
      handle.setLoop(this.loop);
      handle.setSpeed(this.timeScale);
      this.handle = handle;
    } catch (error) {
      if (generation !== this.loadGeneration) return;
      console.error('[SpineVatSkeleton] 加载 VAT 资源失败', error);
    }
  }

  play(animation: string, options: SpineVatPlayOptions = {}): void {
    if (!this.handle) throw new Error('SpineVatSkeleton is not loaded');
    this.handle.play(animation, options);
  }

  pause(): void {
    this.handle?.pause();
  }

  resume(): void {
    this.handle?.resume();
  }

  setLoop(loop: boolean): void {
    this.loop = loop;
    this.editorSignature = this.assetSignature();
    this.handle?.setLoop(loop);
  }

  setTimeScale(timeScale: number): void {
    this.timeScale = timeScale;
    this.editorSignature = this.assetSignature();
    this.handle?.setSpeed(timeScale);
  }

  setManualFrame(frame: number | null): void {
    this.handle?.setManualFrame(frame);
  }

  seek(seconds: number): void {
    this.handle?.seek(seconds);
  }

  setColor(color: SpineVatColor): void {
    this.handle?.setColor(color);
  }

  socket(name: string): SpineVatSocketMatrix | null {
    return this.handle?.socket(name) ?? null;
  }

  snapshot(): SpineVatSnapshot | null {
    return this.handle?.snapshot() ?? null;
  }

  onVatEvent(listener: (event: SpineVatRuntimeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  lateUpdate(): void {
    if (this.handle) syncSockets(this.sockets, (bone) => this.socket(bone));
  }

  onRestore(): void {
    super.onRestore();
    this.refreshAnimationEnum();
    this.editorSignature = this.assetSignature();
    this.requestReload();
  }

  onDisable(): void {
    this.stopLoadingAndDispose();
    super.onDisable();
  }

  onDestroy(): void {
    this.listeners.clear();
    this.stopLoadingAndDispose();
    super.onDestroy();
  }

  private refreshAnimationEnum(): void {
    const animations = this.skeletonDataBacking?.getAnimsEnum() ?? DEFAULT_ANIMATIONS;
    setPropertyEnumType(this, 'initialClipIndex', animations);
  }

  private requestReload(): void {
    if (!this.isValid || !this.enabledInHierarchy) return;
    if (EDITOR_NOT_IN_PREVIEW && !this.previewInEditor) {
      this.stopLoadingAndDispose();
      return;
    }
    if (this.reloadQueued) return;
    this.reloadQueued = true;
    this.scheduleOnce(this.flushReload, 0);
  }

  private cancelQueuedReload(): void {
    if (!this.reloadQueued) return;
    this.unschedule(this.flushReload);
    this.reloadQueued = false;
  }

  private stopLoadingAndDispose(): void {
    this.loadGeneration += 1;
    this.cancelQueuedReload();
    this.disposeHandle();
  }

  private disposeHandle(): void {
    const handle = this.handle;
    this.handle = null;
    handle?.destroy();
  }

  private assetSignature(): string {
    return [
      this.previewInEditor,
      this.skeletonDataBacking?.uuid ?? '',
      this.initialClip,
      this.loop,
      this.timeScale,
    ].join('|');
  }
}

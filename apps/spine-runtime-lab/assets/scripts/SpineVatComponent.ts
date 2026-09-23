import {
  _decorator,
  CCObject,
  Component,
} from 'cc';
import { EDITOR_NOT_IN_PREVIEW } from 'cc/env';
import { SpineVatAsset } from './SpineVatAsset';
import type { SpineVatPlayOptions } from './SpineVatPlayerCore';
import { SpineVatPopulationV2 } from './SpineVatRendererV2';

const { ccclass, executeInEditMode, menu, playOnFocus, property } = _decorator;

/** Inspector loader and edit-mode preview for folders exported by the Spine VAT workbench. */
@ccclass('SpineVatComponent')
@executeInEditMode
@playOnFocus
@menu('Spine/VAT Component')
export class SpineVatComponent extends Component {
  @property({ type: SpineVatAsset, visible: false })
  private _vatAsset: SpineVatAsset | null = null;

  @property({ type: SpineVatAsset, tooltip: '转换工具导出的 Spine VAT 主资源' })
  get vatAsset(): SpineVatAsset | null {
    return this._vatAsset;
  }

  set vatAsset(value: SpineVatAsset | null) {
    if (this._vatAsset === value) return;
    this.stopLoadingAndDispose();
    this._vatAsset = value;
    this.editorAssetSignature = this.assetSignature();
    this.requestReload();
  }

  @property({ tooltip: '编辑模式下直接创建并播放 VAT 预览' })
  previewInEditor = true;

  @property({ tooltip: '创建的 VAT 实例数量', min: 1, step: 1 })
  instanceCount = 1;

  @property({ tooltip: '每行实例数', min: 1, step: 1 })
  columns = 1;

  @property({ tooltip: '实例横向间距' })
  spacingX = 140;

  @property({ tooltip: '实例纵向间距' })
  spacingY = 170;

  @property({ tooltip: '实例统一缩放', min: 0.001 })
  instanceScale = 1;

  @property({ tooltip: '整体纵向偏移' })
  offsetY = 0;

  @property({ tooltip: '初始动画；留空时使用 manifest 中第一个动画' })
  initialClip = '';

  private population: SpineVatPopulationV2 | null = null;
  private loadGeneration = 0;
  private reloadQueued = false;
  private editorAssetSignature = '';

  private readonly flushQueuedReload = (): void => {
    this.reloadQueued = false;
    void this.reload();
  };

  onEnable(): void {
    this.editorAssetSignature = this.assetSignature();
    this.requestReload();
  }

  update(): void {
    if (EDITOR_NOT_IN_PREVIEW) {
      const signature = this.assetSignature();
      if (signature !== this.editorAssetSignature) {
        this.editorAssetSignature = signature;
        this.requestReload();
      }
    }
    this.population?.updateHybrid();
  }

  async reload(): Promise<void> {
    this.cancelQueuedReload();
    const generation = ++this.loadGeneration;
    this.disposePopulation();

    if (EDITOR_NOT_IN_PREVIEW && !this.previewInEditor) return;

    if (!this._vatAsset) {
      if (!EDITOR_NOT_IN_PREVIEW) {
        console.warn('[SpineVatComponent] 请在 Inspector 中拖入 Spine VAT Asset');
      }
      return;
    }

    try {
      const layout = {
        columns: Math.max(1, Math.floor(this.columns)),
        spacingX: this.spacingX,
        spacingY: this.spacingY,
        scale: this.instanceScale,
        offsetY: this.offsetY,
      };
      const initialClip = this.initialClip.trim() || undefined;
      const population = await SpineVatPopulationV2.createFromVatAsset(
        this.node,
        this._vatAsset,
        Math.max(1, Math.floor(this.instanceCount)),
        layout,
        initialClip,
      );

      if (!this.isValid || generation !== this.loadGeneration || !this.enabledInHierarchy) {
        population.destroy();
        return;
      }
      if (EDITOR_NOT_IN_PREVIEW) {
        population.root.hideFlags = CCObject.Flags.DontSave | CCObject.Flags.HideInHierarchy;
      }
      this.population = population;
    } catch (error) {
      if (generation !== this.loadGeneration) return;
      console.error('[SpineVatComponent] 加载 Inspector 资源失败', error);
    }
  }

  play(animation: string, options: SpineVatPlayOptions = {}): void {
    if (!this.population) throw new Error('SpineVatComponent is not loaded');
    for (const instance of this.population.instances) instance.play(animation, options);
  }

  pause(): void {
    for (const instance of this.population?.instances ?? []) instance.pause();
  }

  resume(): void {
    for (const instance of this.population?.instances ?? []) instance.resume();
  }

  onRestore(): void {
    this.editorAssetSignature = this.assetSignature();
    this.requestReload();
  }

  resetInEditor(): void {
    this.editorAssetSignature = this.assetSignature();
    this.requestReload();
  }

  onDisable(): void {
    this.stopLoadingAndDispose();
  }

  onDestroy(): void {
    this.stopLoadingAndDispose();
  }

  private requestReload(): void {
    if (!this.isValid || !this.enabledInHierarchy) return;
    if (EDITOR_NOT_IN_PREVIEW && !this.previewInEditor) {
      this.stopLoadingAndDispose();
      return;
    }
    if (this.reloadQueued) return;
    this.reloadQueued = true;
    this.scheduleOnce(this.flushQueuedReload, 0);
  }

  private cancelQueuedReload(): void {
    if (!this.reloadQueued) return;
    this.unschedule(this.flushQueuedReload);
    this.reloadQueued = false;
  }

  private stopLoadingAndDispose(): void {
    this.loadGeneration += 1;
    this.cancelQueuedReload();
    this.disposePopulation();
  }

  private disposePopulation(): void {
    const population = this.population;
    this.population = null;
    population?.destroy();
  }

  private assetSignature(): string {
    return [
      this.previewInEditor,
      this._vatAsset?.uuid ?? '',
      this.instanceCount,
      this.columns,
      this.spacingX,
      this.spacingY,
      this.instanceScale,
      this.offsetY,
      this.initialClip,
    ].join('|');
  }
}

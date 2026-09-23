import {
  _decorator,
  Asset,
  BufferAsset,
  EffectAsset,
  Texture2D,
} from 'cc';
import type { SpineVatManifestV2 } from './SpineVatTypes';

const { ccclass, property } = _decorator;

/** Creator asset that owns every dependency required by one converted Spine package. */
@ccclass('SpineVatAsset')
export class SpineVatAsset extends Asset {
  @property({ visible: false })
  protected _manifestJson = '';

  @property({ type: [BufferAsset], visible: false })
  public positionPages: BufferAsset[] = [];

  @property({ type: [BufferAsset], visible: false })
  public lightPages: BufferAsset[] = [];

  @property({ type: [BufferAsset], visible: false })
  public darkPages: BufferAsset[] = [];

  @property({ type: [Texture2D], visible: false })
  public atlasPages: Texture2D[] = [];

  @property({ type: EffectAsset, visible: false })
  public effectAsset: EffectAsset | null = null;

  private parsedManifest: SpineVatManifestV2 | null = null;
  private parsedSource = '';

  get manifest(): SpineVatManifestV2 {
    if (!this._manifestJson) throw new Error('Spine VAT Asset does not contain a manifest');
    if (this.parsedManifest && this.parsedSource === this._manifestJson) return this.parsedManifest;

    const manifest = JSON.parse(this._manifestJson) as SpineVatManifestV2;
    if (manifest.format !== 'spine-vat-2') {
      throw new Error(`Unsupported VAT format: ${String((manifest as any)?.format)}`);
    }
    this.parsedManifest = manifest;
    this.parsedSource = this._manifestJson;
    return manifest;
  }

  /** Used by the converter/importer before this asset is serialized by Creator. */
  setManifest(manifest: SpineVatManifestV2 | string): void {
    this._manifestJson = typeof manifest === 'string' ? manifest : JSON.stringify(manifest);
    this.parsedManifest = null;
    this.parsedSource = '';
  }
}

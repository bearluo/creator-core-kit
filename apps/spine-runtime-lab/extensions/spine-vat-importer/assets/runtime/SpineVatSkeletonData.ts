import {
  _decorator,
  Asset,
  BufferAsset,
  EffectAsset,
  Enum,
  Texture2D,
  js,
} from 'cc';
import type { SpineVatManifest } from './SpineVatSchema';

const { ccclass, property } = _decorator;
const CLASS_NAME = 'spinevat.SkeletonData';

/** Runtime methods are copied onto the worker placeholder when AssetDB registered it first. */
class SpineVatSkeletonDataBase extends Asset {
  get manifest(): SpineVatManifest {
    const manifestJson = (this as any).manifestJson as string;
    if (!manifestJson) throw new Error('Spine VAT SkeletonData does not contain a manifest');

    const state = this as any;
    if (state.parsedManifest && state.parsedSource === manifestJson) return state.parsedManifest;

    const manifest = JSON.parse(manifestJson) as SpineVatManifest;
    if (manifest.format !== 'spine-vat-2') {
      throw new Error(`Unsupported VAT format: ${String((manifest as { format?: unknown }).format)}`);
    }
    state.parsedManifest = manifest;
    state.parsedSource = manifestJson;
    return manifest;
  }

  /** Same shape as sp.SkeletonData.getAnimsEnum(), used by the component Inspector. */
  getAnimsEnum(): Record<string, string | number> {
    const state = this as any;
    if (state.animationsEnum) return state.animationsEnum;
    const definition: Record<string, number> = { '<Default>': 0 };
    this.manifest.clips.forEach((clip, index) => {
      definition[clip.name] = index + 1;
    });
    state.animationsEnum = Enum(definition) as Record<string, string | number>;
    return state.animationsEnum;
  }

  /** Importer-only entry used before Creator serializes this asset. */
  setManifest(manifest: SpineVatManifest | string): void {
    (this as any).manifestJson = typeof manifest === 'string' ? manifest : JSON.stringify(manifest);
    const state = this as any;
    state.parsedManifest = null;
    state.parsedSource = '';
    state.animationsEnum = null;
  }
}

function applyPropertyMetadata(target: any): void {
  property({ visible: false })(target.prototype, 'manifestJson');
  property({ type: [BufferAsset], visible: false })(target.prototype, 'positionPages');
  property({ type: [BufferAsset], visible: false })(target.prototype, 'lightPages');
  property({ type: [BufferAsset], visible: false })(target.prototype, 'darkPages');
  property({ type: [Texture2D], visible: false })(target.prototype, 'atlasPages');
  property({ type: EffectAsset, visible: false })(target.prototype, 'effectAsset');
  property({ type: EffectAsset, visible: false })(target.prototype, 'uiEffectAsset');
}

function createRuntimeAssetClass(): typeof SpineVatSkeletonDataBase {
  const existing = js.getClassByName(CLASS_NAME) as typeof SpineVatSkeletonDataBase | null;
  if (existing) {
    for (const name of Object.getOwnPropertyNames(SpineVatSkeletonDataBase.prototype)) {
      if (name === 'constructor') continue;
      const descriptor = Object.getOwnPropertyDescriptor(SpineVatSkeletonDataBase.prototype, name);
      if (descriptor) Object.defineProperty(existing.prototype, name, descriptor);
    }
    return existing;
  }

  class DefinedSpineVatSkeletonData extends SpineVatSkeletonDataBase {
    private manifestJson = '';
    readonly positionPages: BufferAsset[] = [];
    readonly lightPages: BufferAsset[] = [];
    readonly darkPages: BufferAsset[] = [];
    readonly atlasPages: Texture2D[] = [];
    /** spinevat.Skeleton（MeshRenderer）用。 */
    readonly effectAsset: EffectAsset | null = null;
    /** spinevat.UiSkeleton（UI batch）用。 */
    readonly uiEffectAsset: EffectAsset | null = null;
  }

  applyPropertyMetadata(DefinedSpineVatSkeletonData);
  ccclass(CLASS_NAME)(DefinedSpineVatSkeletonData);
  return DefinedSpineVatSkeletonData;
}

/** 导入器写入的字段（序列化属性由 applyPropertyMetadata 声明）。 */
interface SpineVatSkeletonDataFields {
  readonly positionPages: BufferAsset[];
  readonly lightPages: BufferAsset[];
  readonly darkPages: BufferAsset[];
  readonly atlasPages: Texture2D[];
  /** spinevat.Skeleton（MeshRenderer）用。 */
  readonly effectAsset: EffectAsset | null;
  /** spinevat.UiSkeleton（UI batch）用。 */
  readonly uiEffectAsset: EffectAsset | null;
}

export type SpineVatSkeletonData = SpineVatSkeletonDataBase & SpineVatSkeletonDataFields;
export const SpineVatSkeletonData = createRuntimeAssetClass() as unknown as
  (new () => SpineVatSkeletonData) & typeof SpineVatSkeletonDataBase;

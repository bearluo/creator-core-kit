import {
  Asset,
  BufferAsset,
  Component,
  js,
  Node,
  resources,
  Texture2D,
  Vec3,
} from 'cc';
import type { SpineVatPlayOptions } from '../../extensions/spine-vat-importer/assets/runtime/SpineVatPlayback';
import type { SpineVatManifest as SpineVatManifestV2, SpineVatSocketMatrix } from '../../extensions/spine-vat-importer/assets/runtime/SpineVatSchema';

export interface VatPopulationLayout {
  columns?: number;
  spacingX?: number;
  spacingY?: number;
  scale?: number;
  offsetY?: number;
}

type SpineVatColor = readonly [number, number, number, number];

type RuntimeSkeletonData = Asset & {
  readonly manifest: SpineVatManifestV2;
  readonly positionPages: BufferAsset[];
  readonly lightPages: BufferAsset[];
  readonly darkPages: BufferAsset[];
  readonly atlasPages: Texture2D[];
};

type RuntimeSkeleton = Component & {
  skeletonData: RuntimeSkeletonData | null;
  initialClipIndex: number;
  loop: boolean;
  timeScale: number;
  reload(): Promise<void>;
  play(animation: string, options?: SpineVatPlayOptions): void;
  pause(): void;
  resume(): void;
  setLoop(loop: boolean): void;
  setTimeScale(timeScale: number): void;
  setManualFrame(frame: number | null): void;
  seek(seconds: number): void;
  setColor(color: SpineVatColor): void;
  socket(name: string): SpineVatSocketMatrix | null;
  snapshot(): unknown;
  onVatEvent(listener: (event: unknown) => void): () => void;
};

type ComponentConstructor<T extends Component> = new (...args: never[]) => T;

export function runtimeClass<T>(name: string): T {
  const runtime = js.getClassByName(name);
  if (!runtime) throw new Error(`VAT 扩展运行时未注册 ${name}`);
  return runtime as T;
}

export async function ensureVatRuntimeClasses(): Promise<void> {
  const system = (globalThis as { System?: { import?: (specifier: string) => Promise<unknown> } }).System;
  if (system?.import) {
    // The extension owns these classes; load its bundle module before AssetDB resolves ctor types.
    await system.import('chunks:///_virtual/SpineVatSkeleton.ts');
    await system.import('chunks:///_virtual/SpineVatUiSkeleton.ts');
  }
  runtimeClass('spinevat.SkeletonData');
  runtimeClass('spinevat.Skeleton');
  runtimeClass('spinevat.UiSkeleton');
}

export function loadSkeletonData(resourceRoot: string): Promise<RuntimeSkeletonData> {
  return new Promise((resolve, reject) => {
    // Bundle path lookup happens before late custom Asset constructors are registered.
    // Loading by path lets the serialized __type__ select spinevat.SkeletonData.
    resources.load(`${resourceRoot}/manifest`, (error, asset) => {
      if (error || !asset) {
        reject(error ?? new Error(`VAT 资源加载失败: ${resourceRoot}/manifest`));
        return;
      }
      const data = asset as RuntimeSkeletonData;
      if (!data.manifest || !data.positionPages || !data.lightPages) {
        reject(new Error(`VAT 资源类型无效: ${resourceRoot}/manifest`));
        return;
      }
      resolve(data);
    });
  });
}

function bufferBytes(assets: readonly BufferAsset[]): number {
  return assets.reduce((total, asset) => total + asset.buffer().byteLength, 0);
}

export class SpineVatRuntimeInstance {
  constructor(readonly component: RuntimeSkeleton) {}

  play(animation: string, options?: SpineVatPlayOptions): void {
    this.component.play(animation, options);
  }

  pause(): void {
    this.component.pause();
  }

  resume(): void {
    this.component.resume();
  }

  seek(seconds: number): void {
    this.component.seek(seconds);
  }

  setSpeed(speed: number): void {
    this.component.setTimeScale(speed);
  }

  setLoop(loop: boolean): void {
    this.component.setLoop(loop);
  }

  setColor(color: SpineVatColor): void {
    this.component.setColor(color);
  }

  socket(name: string): SpineVatSocketMatrix | null {
    return this.component.socket(name);
  }

  snapshot(): unknown {
    return this.component.snapshot();
  }

  onEvent(listener: (event: unknown) => void): () => void {
    return this.component.onVatEvent(listener);
  }
}

/** Benchmark-only population builder. Each child owns exactly one spinevat.Skeleton component. */
export class SpineVatRuntimePopulation {
  readonly instances: SpineVatRuntimeInstance[];
  readonly manifest: SpineVatManifestV2;
  readonly drawGroups: number;
  readonly textureBytes: number;
  currentClip: SpineVatManifestV2['clips'][number];

  private constructor(
    readonly parent: Node,
    readonly data: RuntimeSkeletonData,
    readonly nodes: Node[],
    instances: SpineVatRuntimeInstance[],
    initialClip: string,
  ) {
    this.instances = instances;
    this.manifest = data.manifest;
    this.currentClip = this.manifest.clips.find((clip) => clip.name === initialClip)
      ?? this.manifest.clips[0];
    const layout = this.manifest.layouts.find((entry) => entry.id === this.currentClip.layout);
    this.drawGroups = layout?.lanes.length ?? this.manifest.compatibility.drawCallsPerBatch;
    this.textureBytes = bufferBytes(data.positionPages)
      + bufferBytes(data.lightPages)
      + bufferBytes(data.darkPages);
  }

  static async createFromResources(
    parent: Node,
    instanceCount: number,
    resourceRoot: string,
    layout: VatPopulationLayout = {},
    initialClip?: string,
  ): Promise<SpineVatRuntimePopulation> {
    await ensureVatRuntimeClasses();
    const data = await loadSkeletonData(resourceRoot);
    return SpineVatRuntimePopulation.create(parent, data, instanceCount, layout, initialClip);
  }

  static async create(
    parent: Node,
    data: RuntimeSkeletonData,
    instanceCount: number,
    layout: VatPopulationLayout = {},
    initialClip?: string,
  ): Promise<SpineVatRuntimePopulation> {
    const skeletonType = runtimeClass<ComponentConstructor<RuntimeSkeleton>>('spinevat.Skeleton');
    const clip = data.manifest.clips.find((entry) => entry.name === initialClip)
      ?? data.manifest.clips[0];
    if (!clip) throw new Error('VAT 资源没有可播放动画');

    const columns = layout.columns ?? Math.max(1, Math.ceil(Math.sqrt(instanceCount)));
    const rows = Math.max(1, Math.ceil(instanceCount / columns));
    const spacingX = layout.spacingX ?? 140;
    const spacingY = layout.spacingY ?? 160;
    const scale = layout.scale ?? 1;
    const nodes: Node[] = [];
    const components: RuntimeSkeleton[] = [];

    for (let index = 0; index < instanceCount; index += 1) {
      const node = new Node(`VatSkeleton-${index}`);
      node.parent = parent;
      node.layer = parent.layer;
      node.setPosition(new Vec3(
        (index % columns - (columns - 1) / 2) * spacingX,
        (Math.floor(index / columns) - (rows - 1) / 2) * spacingY + (layout.offsetY ?? -40),
        0,
      ));
      node.setScale(scale, scale, scale);
      const skeleton = node.addComponent(skeletonType);
      skeleton.skeletonData = data;
      skeleton.loop = true;
      skeleton.timeScale = 1;
      skeleton.initialClipIndex = data.manifest.clips.indexOf(clip) + 1;
      nodes.push(node);
      components.push(skeleton);
    }

    await Promise.all(components.map((component) => component.reload()));
    return new SpineVatRuntimePopulation(
      parent,
      data,
      nodes,
      components.map((component) => new SpineVatRuntimeInstance(component)),
      clip.name,
    );
  }

  setClip(name: string): void {
    const clip = this.manifest.clips.find((entry) => entry.name === name);
    if (!clip) throw new Error(`VAT 动画不存在: ${name}`);
    this.currentClip = clip;
    this.instances.forEach((instance) => instance.play(name, { loop: true }));
  }

  setManualFrame(frame: number | null): void {
    this.instances.forEach((instance) => instance.component.setManualFrame(frame));
  }

  updateHybrid(): void {
    // spinevat.Skeleton updates playback, sockets, and events on each component.
  }

  destroy(): void {
    for (const node of this.nodes) {
      if (node.isValid) node.destroy();
    }
    this.nodes.length = 0;
    this.instances.length = 0;
  }
}

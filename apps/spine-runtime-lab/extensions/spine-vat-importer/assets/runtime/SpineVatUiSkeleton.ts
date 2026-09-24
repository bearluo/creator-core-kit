import {
  _decorator,
  CCObject,
  Component,
  director,
  Director,
  EffectAsset,
  Enum,
  gfx,
  Material,
  Node,
  setPropertyEnumType,
  Texture2D,
  Vec4,
} from 'cc';
import { EDITOR_NOT_IN_PREVIEW } from 'cc/env';
import { SpineVatPlayback, type SpineVatColor, type SpineVatPlayOptions } from './SpineVatPlayback';
import {
  compilePages,
  createLightTexture,
  createTexture,
  singleLayout,
  vatChannelDefines,
  vatClipUniform,
} from './SpineVatRenderResources';
import type { SpineVatBlendMode, SpineVatManifest } from './SpineVatSchema';
import { SpineVatSkeletonData } from './SpineVatSkeletonData';
import { SLOT_SHIFT, SpineVatUiLane, type SpineVatUiLaneInfo as Lane } from './SpineVatUiLane';

const { ccclass, menu, property } = _decorator;
const DEFAULT_ANIMATIONS = Enum({ '<Default>': 0 });

// VAT 走 2D UI 提交流程。一个实例 = 一个 SpineVatUiSkeleton（槽位/播放/变换）
// + 每段同材质相邻 lane 一个 SpineVatUiLane（UIRenderer，见 SpineVatUiLane.ts），运行时挂在实例节点下，
// 所以绘制顺序就是实例节点的兄弟顺序，和 Sprite 穿插规则相同。
// 一组 = 一套材质（UBO 里 48 实例 × 5 个 vec4）；满了再开一组。贴图按骨骼数据共享，不随组复制。
// 不同组材质不同，组间必断批；实例按创建顺序占槽，兄弟相邻的实例基本落在同一组。
const MAX_UI_INSTANCES = 48;
const VEC4_PER_INSTANCE = 5;
const MAX_TEXTURE_PAGES = 4;
function now(): number {
  return director.root?.cumulativeTime ?? 0;
}

const MERGED_TECHNIQUE = 8;

/** normal / additive 都走 merged（同一材质才能跨 lane 合批）；multiply / screen 仍各用一个。 */
function techniqueIndex(alphaMode: SpineVatManifest['alphaMode'], blendMode: SpineVatBlendMode): number {
  if (blendMode === 'normal' || blendMode === 'additive') return MERGED_TECHNIQUE;
  const blendOffset = blendMode === 'multiply' ? 2 : 3;
  return (alphaMode === 'premultiplied' ? 4 : 0) + blendOffset;
}

/** 同一份骨骼数据共用的贴图与布局。 */
interface UiShared {
  key: string;
  effect: EffectAsset;
  manifest: SpineVatManifest;
  layout: SpineVatManifest['layouts'][number];
  atlases: Texture2D[];
  pages: ReturnType<typeof compilePages>;
  positions: Texture2D[];
  lights: Texture2D[];
  darks: Texture2D[];
  black: Texture2D;
  white: Texture2D;
  groups: UiGroup[];
}

interface UiGroup {
  shared: UiShared;
  /** VAT_LERP 是编译期宏，开 / 不开是两套材质，组按它区分。 */
  interpolate: boolean;
  /** 按 technique 共享：同 blend 的 lane 用同一个材质，才能跨 lane 合批。 */
  materials: Map<number, Material>;
  slots: Vec4[];
  freeSlots: number[];
  dirty: boolean;
  flush: () => void;
}

const shareds = new Map<string, UiShared>();

function acquireShared(data: SpineVatSkeletonData): UiShared {
  const effect = data.uiEffectAsset;
  if (!effect) throw new Error('Spine VAT SkeletonData 缺少 UI Effect 依赖；请重新导入 manifest.spinevat');
  const key = `${data.uuid}|${effect.uuid}`;
  const existing = shareds.get(key);
  if (existing) return existing;
  const manifest = data.manifest;
  const layout = singleLayout(manifest);
  if (layout.frameStride > SLOT_SHIFT) throw new Error(`VAT UI 单帧顶点数 ${layout.frameStride} 超过 ${SLOT_SHIFT}`);
  const atlases = layout.lanes.map((lane) => {
    const atlas = data.atlasPages[lane.atlasPage];
    if (!atlas) throw new Error(`VAT UI lane 引用的 atlas page ${lane.atlasPage} 缺失`);
    return atlas;
  });
  const pages = compilePages(data);
  const shared: UiShared = {
    key,
    effect,
    manifest,
    layout,
    atlases,
    pages,
    positions: pages.map((page) => createTexture(page.position, page.width, page.height, gfx.Format.RGBA32F)),
    lights: manifest.channels.light ? pages.map(createLightTexture) : [],
    darks: manifest.channels.dark
      ? pages.map((page) => createTexture(page.dark!, page.width, page.height, gfx.Format.RGBA8))
      : [],
    black: createTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, gfx.Format.RGBA8),
    white: createTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, gfx.Format.RGBA8),
    groups: [],
  };
  shareds.set(key, shared);
  return shared;
}

function createGroup(shared: UiShared, interpolate: boolean): UiGroup {
  const { manifest, pages, layout } = shared;
  const materials = new Map<number, Material>();
  for (const lane of layout.lanes) {
    const technique = techniqueIndex(manifest.alphaMode, lane.blendMode);
    if (materials.has(technique)) continue;
    const material = new Material();
    material.hideFlags = CCObject.Flags.DontSave;
    material.initialize({
      effectAsset: shared.effect,
      technique,
      defines: {
        VAT_MERGED: technique === MERGED_TECHNIQUE,
        VAT_STRAIGHT: manifest.alphaMode !== 'premultiplied',
        VAT_LERP: interpolate,
        VAT_CLIP: layout.clipCount > 0,
        ...vatChannelDefines(pages),
      },
    });
    for (let page = 0; page < MAX_TEXTURE_PAGES; page += 1) {
      const size = pages[page] ? new Vec4(pages[page].width, pages[page].height, 0, 0) : new Vec4(1, 1, 0, 0);
      material.setProperty(`positionTexture${page}`, shared.positions[page] ?? shared.black);
      if (shared.lights.length > 0) material.setProperty(`lightTexture${page}`, shared.lights[page] ?? shared.white);
      if (shared.darks.length > 0) material.setProperty(`darkTexture${page}`, shared.darks[page] ?? shared.black);
      material.setProperty(`vatPageSize${page}`, size);
    }
    material.setProperty('vatLayout', new Vec4(layout.frameStride, manifest.pageTexels, pages.length, SLOT_SHIFT));
    material.setProperty('vatClip', vatClipUniform(layout));
    materials.set(technique, material);
  }
  const group: UiGroup = {
    shared,
    interpolate,
    materials,
    slots: Array.from({ length: MAX_UI_INSTANCES * VEC4_PER_INSTANCE }, () => new Vec4()),
    freeSlots: Array.from({ length: MAX_UI_INSTANCES }, (_, index) => MAX_UI_INSTANCES - 1 - index),
    dirty: true,
    flush: () => {
      if (!group.dirty) return;
      group.dirty = false;
      for (const material of group.materials.values()) {
        const pass = material.passes[0];
        pass.setUniformArray(pass.getHandle('vatInstances'), group.slots);
      }
    },
  };
  director.on(Director.EVENT_BEFORE_DRAW, group.flush);
  shared.groups.push(group);
  return group;
}

/** 取一个有空槽的组（没有就新开），返回组和槽位。 */
function acquireSlot(data: SpineVatSkeletonData): { group: UiGroup; slot: number } {
  const shared = acquireShared(data);
  const interpolate = SpineVatUiSkeleton.interpolate;
  const group = shared.groups.find((candidate) => candidate.freeSlots.length > 0 && candidate.interpolate === interpolate)
    ?? createGroup(shared, interpolate);
  return { group, slot: group.freeSlots.pop()! };
}

function releaseSlot(group: UiGroup, slot: number): void {
  group.freeSlots.push(slot);
  if (group.freeSlots.length < MAX_UI_INSTANCES) return;
  const shared = group.shared;
  shared.groups.splice(shared.groups.indexOf(group), 1);
  director.off(Director.EVENT_BEFORE_DRAW, group.flush);
  for (const material of group.materials.values()) material.destroy();
  if (shared.groups.length > 0) return;
  shareds.delete(shared.key);
  for (const texture of [...shared.positions, ...shared.lights, ...shared.darks, shared.black, shared.white]) {
    texture.destroy();
  }
}

/**
 * 2D 版 Spine VAT：和 Sprite / sp.Skeleton 走同一条 UI batch，按兄弟顺序穿插。
 * 用法同 spinevat.Skeleton：挂到 UI 节点上，赋 Skeleton Data，选 Initial Clip。
 */
@ccclass('spinevat.UiSkeleton')
@menu('Spine/VAT UI Skeleton')
export class SpineVatUiSkeleton extends Component {
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
    this.skeletonDataBacking = value;
    if (this.initialClip && !value?.manifest.clips.some((clip) => clip.name === this.initialClip)) {
      this.initialClip = '';
    }
    this.refreshAnimationEnum();
    this.rebuild();
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
    this.rebuild();
  }

  @property({ displayName: 'Loop', tooltip: '初始动画是否循环播放' })
  loop = true;

  @property({ displayName: 'Time Scale', tooltip: '动画播放速度', min: 0 })
  timeScale = 1;

  private group: UiGroup | null = null;
  private slot = -1;
  private playback: SpineVatPlayback | null = null;
  private laneNodes: Node[] = [];

  onLoad(): void {
    this.refreshAnimationEnum();
  }

  onEnable(): void {
    if (!this.group) this.rebuild();
  }

  get vertexCount(): number {
    return this.group?.shared.layout.lanes.reduce((sum, lane) => sum + lane.vertexCapacity, 0) ?? 0;
  }

  play(animation: string, options: SpineVatPlayOptions = {}): void {
    if (!this.playback) throw new Error('SpineVatUiSkeleton is not loaded');
    this.playback.play(animation, options, now());
    this.upload();
  }

  pause(): void {
    this.playback?.pause(now());
    this.upload();
  }

  resume(): void {
    this.playback?.resume(now());
    this.upload();
  }

  seek(seconds: number): void {
    this.playback?.seek(seconds, now());
    this.upload();
  }

  setLoop(loop: boolean): void {
    this.loop = loop;
    this.playback?.setLoop(loop);
    this.upload();
  }

  setTimeScale(timeScale: number): void {
    this.timeScale = timeScale;
    this.playback?.setSpeed(timeScale, now());
    this.upload();
  }

  setColor(color: SpineVatColor): void {
    this.playback?.setColor(color);
    this.upload();
  }

  setManualFrame(frame: number | null): void {
    this.playback?.setManualFrame(frame, now());
    this.upload();
  }

  lateUpdate(): void {
    if (this.group) this.writeTransform();
  }

  onDestroy(): void {
    this.teardown();
  }

  private refreshAnimationEnum(): void {
    const animations = this.skeletonDataBacking?.getAnimsEnum() ?? DEFAULT_ANIMATIONS;
    setPropertyEnumType(this, 'initialClipIndex', animations);
  }

  /** 按当前 skeletonData / initialClip 重建；编辑器里不建（lane 节点会被存进场景）。 */
  private rebuild(): void {
    this.teardown();
    const data = this.skeletonDataBacking;
    if (EDITOR_NOT_IN_PREVIEW || !data || !this.isValid || !this.enabledInHierarchy) return;
    const { group, slot } = acquireSlot(data);
    this.group = group;
    this.slot = slot;
    const { manifest, layout, atlases } = group.shared;
    this.playback = new SpineVatPlayback(manifest.clips, manifest.alphaMode, now(), this.initialClip || undefined);
    this.playback.setLoop(this.loop);
    this.playback.setSpeed(this.timeScale, now());
    this.writeTransform();
    this.upload();

    // 相邻且材质、贴图都相同的 lane 合成一段 = 一个 chunk（见 SpineVatUiLane 注释）。
    const technique = (lane: Lane): number => techniqueIndex(manifest.alphaMode, lane.blendMode);
    const segments: number[][] = [];
    layout.lanes.forEach((lane, index) => {
      const last = segments[segments.length - 1];
      const previous = last && layout.lanes[last[last.length - 1]];
      if (previous && technique(previous) === technique(lane) && atlases[last[0]] === atlases[index]) last.push(index);
      else segments.push([index]);
    });
    for (const segment of segments) {
      const node = new Node(`${this.node.name}-lane${segment.join('')}`);
      node.hideFlags |= CCObject.Flags.DontSave;
      node.parent = this.node;
      node.layer = this.node.layer;
      const lanes = segment.map((index) => layout.lanes[index]);
      const material = group.materials.get(technique(lanes[0]))!;
      node.addComponent(SpineVatUiLane).init(lanes, atlases[segment[0]], material, slot);
      this.laneNodes.push(node);
    }
  }

  private teardown(): void {
    for (const node of this.laneNodes) if (node.isValid) node.destroy();
    this.laneNodes = [];
    this.playback = null;
    if (this.group) {
      releaseSlot(this.group, this.slot);
      this.group = null;
      this.slot = -1;
    }
  }

  /** 只在世界矩阵真的变了才标脏，免得每帧整组重传 uniform。 */
  private writeTransform(): void {
    const group = this.group!;
    const m = this.node.worldMatrix;
    const base = this.slot * VEC4_PER_INSTANCE;
    const xform = group.slots[base + 3];
    const translate = group.slots[base + 4];
    if (xform.x === m.m00 && xform.y === m.m01 && xform.z === m.m04 && xform.w === m.m05
      && translate.x === m.m12 && translate.y === m.m13) return;
    xform.set(m.m00, m.m01, m.m04, m.m05);
    translate.set(m.m12, m.m13, 0, 0);
    group.dirty = true;
  }

  private upload(): void {
    if (!this.group || !this.playback) return;
    const group = this.group;
    const attributes = this.playback.gpuAttributes(now());
    const base = this.slot * VEC4_PER_INSTANCE;
    group.slots[base].set(...attributes.anim0);
    group.slots[base + 1].set(...attributes.anim1);
    group.slots[base + 2].set(...attributes.color);
    group.dirty = true;
  }
}

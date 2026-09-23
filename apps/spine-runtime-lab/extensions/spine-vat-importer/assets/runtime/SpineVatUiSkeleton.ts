import {
  _decorator,
  CCObject,
  Component,
  director,
  Director,
  EffectAsset,
  gfx,
  Material,
  Node,
  Texture2D,
  Vec4,
} from 'cc';
import { SpineVatPlayback, type SpineVatColor, type SpineVatPlayOptions } from './SpineVatPlayback';
import { compilePages, createLightTexture, createTexture, vatChannelDefines } from './SpineVatRenderResources';
import type { SpineVatBlendMode, SpineVatManifest } from './SpineVatSchema';
import type { SpineVatSkeletonData } from './SpineVatSkeletonData';
import { SLOT_SHIFT, SpineVatUiLane, type SpineVatUiLaneInfo as Lane } from './SpineVatUiLane';

const { ccclass } = _decorator;

// 原型：VAT 走 2D UI 提交流程。一个实例 = 一个 SpineVatUiSkeleton（槽位/播放/变换）
// + 每段同材质相邻 lane 一个 SpineVatUiLane（UIRenderer，见 SpineVatUiLane.ts），挂在实例节点下，
// 所以绘制顺序就是实例节点的兄弟顺序，和 Sprite 穿插规则相同。
// 一组 = 一套材质（UBO 里 48 实例 × 5 个 vec4）；满了再开一组。贴图按 骨骼数据 + effect 共享，不随组复制。
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
  const blendOffset = blendMode === 'additive' ? 1 : blendMode === 'multiply' ? 2 : blendMode === 'screen' ? 3 : 0;
  return (alphaMode === 'premultiplied' ? 4 : 0) + blendOffset;
}

type Layout = SpineVatManifest['layouts'][number];
const CLIP_TEXELS = 8; // 与 compiler 的 MAX_CLIP_VERTICES、effect 的 VAT_CLIP 一致

/** 固定槽位 layout（带索引、逐附件槽位不漂）才能帧间插值；三角形汤插了会裂。 */
function canInterpolate(layout: Layout): boolean {
  return layout.lanes.every((lane) => lane.geometryMode === 'indexed-stable');
}

interface UiLayout {
  layout: Layout;
  atlases: Texture2D[];
}

/** 同一份骨骼数据 + effect 共用的贴图与布局。 */
interface UiShared {
  key: string;
  effect: EffectAsset;
  manifest: SpineVatManifest;
  layouts: UiLayout[];
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
  manifest: SpineVatManifest;
  /** 按 layout × technique 共享：同 blend 的 lane 用同一个材质，才能跨 lane 合批。 */
  materials: Map<string, Material>;
  slots: Vec4[];
  freeSlots: number[];
  dirty: boolean;
  flush: () => void;
}

const shareds = new Map<string, UiShared>();

function acquireShared(data: SpineVatSkeletonData, effect: EffectAsset): UiShared {
  const key = `${data.uuid}|${effect.uuid}`;
  const existing = shareds.get(key);
  if (existing) return existing;
  const manifest = data.manifest;
  const layouts = manifest.layouts.map((layout): UiLayout => {
    if (layout.frameStride > SLOT_SHIFT) throw new Error(`VAT UI 单帧顶点数 ${layout.frameStride} 超过 ${SLOT_SHIFT}`);
    const atlases = layout.lanes.map((lane) => {
      const atlas = data.atlasPages[lane.atlasPage];
      if (!atlas) throw new Error(`VAT UI lane 引用的 atlas page ${lane.atlasPage} 缺失`);
      return atlas;
    });
    return { layout, atlases };
  });
  const pages = compilePages(data);
  const shared: UiShared = {
    key,
    effect,
    manifest,
    layouts,
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

function materialKey(layoutIndex: number, technique: number): string {
  return `${layoutIndex}:${technique}`;
}

function createGroup(shared: UiShared, interpolate: boolean): UiGroup {
  const { manifest, pages } = shared;
  const materials = new Map<string, Material>();
  shared.layouts.forEach(({ layout }, layoutIndex) => {
    const clipCount = layout.clipCount ?? 0;
    for (const lane of layout.lanes) {
      const technique = techniqueIndex(manifest.alphaMode, lane.blendMode);
      const key = materialKey(layoutIndex, technique);
      if (materials.has(key)) continue;
      const material = new Material();
      material.hideFlags = CCObject.Flags.DontSave;
      material.initialize({
        effectAsset: shared.effect,
        technique,
        defines: {
          VAT_MERGED: technique === MERGED_TECHNIQUE,
          VAT_STRAIGHT: manifest.alphaMode !== 'premultiplied',
          VAT_LERP: interpolate && canInterpolate(layout),
          VAT_CLIP: clipCount > 0,
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
      material.setProperty('vatClip', new Vec4(layout.staticFrame ?? 0, layout.frameStride - clipCount * CLIP_TEXELS, 0, 0));
      materials.set(key, material);
    }
  });
  const group: UiGroup = {
    shared,
    interpolate,
    manifest,
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
function acquireSlot(data: SpineVatSkeletonData, effect: EffectAsset): { group: UiGroup; slot: number } {
  const shared = acquireShared(data, effect);
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

@ccclass('spinevat.UiSkeleton')
export class SpineVatUiSkeleton extends Component {
  /**
   * 帧间插值总开关：VS 在相邻两帧间插位置与颜色（多一倍 VS 采样，CPU 不变）。
   * 启动时按机型档位定一次；只影响之后 setup 的实例。
   * 只作用于固定槽位 layout（canInterpolate）：三角形汤的顶点槽位逐帧漂移，插了会裂，那些 clip 始终阶跃。
   */
  static interpolate = true;

  private group: UiGroup | null = null;
  private slot = -1;
  private playback: SpineVatPlayback | null = null;
  private laneNodes: Node[] = [];
  /** 每个 layout 一组 lane 节点；只有当前 clip 所在 layout 的那组启用。 */
  private layoutNodes: Node[][] = [];
  private activeLayout = -1;

  /** 原型入口：由测试驱动在 addComponent 之后调用。 */
  setup(data: SpineVatSkeletonData, effect: EffectAsset, initialClip?: string): void {
    if (this.group) throw new Error('SpineVatUiSkeleton 已初始化');
    const { group, slot } = acquireSlot(data, effect);
    this.group = group;
    this.slot = slot;
    this.playback = new SpineVatPlayback(group.manifest.clips, group.manifest.alphaMode, now(), initialClip);
    this.writeTransform();
    this.upload();

    // 相邻且材质、贴图都相同的 lane 合成一段 = 一个 chunk（见 SpineVatUiLane 注释）。
    const technique = (lane: Lane): number => techniqueIndex(group.manifest.alphaMode, lane.blendMode);
    group.shared.layouts.forEach(({ layout, atlases }, layoutIndex) => {
      const nodes: Node[] = [];
      const segments: number[][] = [];
      layout.lanes.forEach((lane, index) => {
        const last = segments[segments.length - 1];
        const previous = last && layout.lanes[last[last.length - 1]];
        if (previous && technique(previous) === technique(lane) && atlases[last[0]] === atlases[index]) last.push(index);
        else segments.push([index]);
      });
      for (const segment of segments) {
        const node = new Node(`${this.node.name}-${layout.id}-lane${segment.join('')}`);
        node.parent = this.node;
        node.layer = this.node.layer;
        node.active = false;
        const lanes = segment.map((index) => layout.lanes[index]);
        const material = group.materials.get(materialKey(layoutIndex, technique(lanes[0])))!;
        node.addComponent(SpineVatUiLane).init(lanes, atlases[segment[0]], material, slot);
        this.laneNodes.push(node);
        nodes.push(node);
      }
      this.layoutNodes.push(nodes);
    });
    this.syncLayout();
  }

  get vertexCount(): number {
    const layout = this.group?.shared.layouts[this.activeLayout]?.layout;
    return layout?.lanes.reduce((sum, lane) => sum + lane.vertexCapacity, 0) ?? 0;
  }

  play(animation: string, options: SpineVatPlayOptions = {}): void {
    this.playback?.play(animation, options, now());
    this.syncLayout();
    this.upload();
  }

  /** clip 换了 layout 就换一组 lane 节点。 */
  private syncLayout(): void {
    const group = this.group;
    if (!group || !this.playback) return;
    const id = this.playback.currentClip.layout;
    const next = Math.max(0, group.shared.layouts.findIndex(({ layout }) => layout.id === id));
    if (next === this.activeLayout) return;
    this.layoutNodes.forEach((nodes, index) => {
      for (const node of nodes) node.active = index === next;
    });
    this.activeLayout = next;
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
    for (const node of this.laneNodes) if (node.isValid) node.destroy();
    this.laneNodes = [];
    this.layoutNodes = [];
    if (this.group) {
      releaseSlot(this.group, this.slot);
      this.group = null;
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
    const group = this.group!;
    const attributes = this.playback!.gpuAttributes(now());
    const base = this.slot * VEC4_PER_INSTANCE;
    group.slots[base].set(...attributes.anim0);
    group.slots[base + 1].set(...attributes.anim1);
    group.slots[base + 2].set(...attributes.color);
    group.dirty = true;
  }
}

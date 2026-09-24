import { sp } from 'cc';
import { captureSpineVatFrame } from './SpineVatBaker';
import type { VatFrame } from './SpineVatBaker';

/** 一个附件在某帧渲染输出里的位置（剪裁前的原始几何）。 */
export interface FixedKeyRange {
  /** `${slotIndex}/${附件名}`：固定槽位的键。 */
  key: string;
  slot: number;
  vertexStart: number;
  vertexCount: number;
  indexStart: number;
  indexCount: number;
  textureId: string;
  blendMode: number;
  /** 当帧裁它的剪裁附件键；未被剪裁为 null。 */
  clip: string | null;
}

export interface FixedFrame {
  /** 去掉剪裁附件后的渲染输出。 */
  source: VatFrame;
  keys: FixedKeyRange[];
  /** 当帧生效的剪裁：键 → 世界坐标多边形 [x0, y0, x1, y1, ...]。 */
  clips: Map<string, number[]>;
}

export interface FixedBakeResult {
  animation: string;
  frames: FixedFrame[];
}

/** 去掉全部剪裁附件（及它们的 deform 时间轴——否则 SkeletonJson 找不到附件会抛）。 */
export function createUnclippedSkeletonData(source: sp.SkeletonData): sp.SkeletonData {
  const json = JSON.parse(JSON.stringify(source.skeletonJson)) as any;
  if (json.skeleton?.hash) json.skeleton.hash = `${json.skeleton.hash}-vat-unclipped`;
  const removed = new Set<string>();
  for (const skin of json.skins ?? []) {
    for (const [slot, attachments] of Object.entries(skin.attachments ?? {}) as [string, any][]) {
      for (const [name, attachment] of Object.entries(attachments) as [string, any][]) {
        if (attachment?.type !== 'clipping') continue;
        delete attachments[name];
        removed.add(`${skin.name}/${slot}/${name}`);
      }
    }
  }
  for (const animation of Object.values(json.animations ?? {}) as any[]) {
    for (const [skin, slots] of Object.entries(animation.attachments ?? {}) as [string, any][]) {
      for (const [slot, attachments] of Object.entries(slots) as [string, any][]) {
        for (const name of Object.keys(attachments)) {
          if (removed.has(`${skin}/${slot}/${name}`)) delete attachments[name];
        }
      }
    }
  }
  const result = new sp.SkeletonData();
  result.skeletonJson = json;
  result.atlasText = source.atlasText;
  result.textureNames = [...source.textureNames];
  result.textures = [...source.textures];
  result.scale = source.scale;
  return result;
}

const spine = (): any => sp.spine;

/** 按官方渲染器（spine-skeleton-instance.cpp）的跳过规则列出当帧画出来的附件。 */
function renderedKeys(skeleton: any): Array<Omit<FixedKeyRange, 'vertexStart' | 'indexStart' | 'textureId' | 'blendMode' | 'clip'>> {
  const keys = [];
  for (const slot of skeleton.drawOrder) {
    if (!slot.bone.active) continue;
    const attachment = slot.getAttachment();
    if (!attachment) continue;
    const index = slot.data.index as number;
    if (attachment instanceof spine().RegionAttachment) {
      keys.push({ key: `${index}/${attachment.name}`, slot: index, vertexCount: 4, indexCount: 6 });
    } else if (attachment instanceof spine().MeshAttachment) {
      keys.push({
        key: `${index}/${attachment.name}`,
        slot: index,
        vertexCount: attachment.worldVerticesLength / 2,
        indexCount: attachment.triangles.length,
      });
    }
  }
  return keys;
}

/** 按官方 clipStart / clipEnd 规则算每个 slot 当帧被哪个剪裁裁，以及生效剪裁的多边形。 */
function clipState(skeleton: any): { bySlot: Map<number, string>; clips: Map<string, number[]> } {
  const bySlot = new Map<number, string>();
  const clips = new Map<string, number[]>();
  let current: { key: string; end: number } | null = null;
  const clipEnd = (slot: any): void => {
    if (current && current.end === slot.data.index) current = null;
  };
  for (const slot of skeleton.drawOrder) {
    if (!slot.bone.active) continue; // 官方这里不 clipEnd
    const attachment = slot.getAttachment();
    if (!attachment) {
      clipEnd(slot);
      continue;
    }
    if (attachment instanceof spine().ClippingAttachment) {
      if (current) continue; // 已在剪裁中：官方 clipStart 直接返回
      const key = `${slot.data.index}/${attachment.name}`;
      const polygon = new Array<number>(attachment.worldVerticesLength).fill(0);
      attachment.computeWorldVertices(slot, 0, attachment.worldVerticesLength, polygon, 0, 2);
      clips.set(key, polygon);
      current = { key, end: attachment.endSlot.index };
      continue;
    }
    if (current && (attachment instanceof spine().RegionAttachment || attachment instanceof spine().MeshAttachment)) {
      bySlot.set(slot.data.index, current.key);
    }
    clipEnd(slot);
  }
  return { bySlot, clips };
}

/**
 * 与 bakeSpineAnimation 同步采样：unclipped 出几何，original 出剪裁归属与多边形。
 * 两个组件必须已设好 skeletonData（前者是 createUnclippedSkeletonData 的结果）。
 */
export function bakeFixedSlots(
  unclipped: sp.Skeleton,
  original: sp.Skeleton,
  animationName: string,
  frameRate: number,
  premultipliedAlpha: boolean,
): FixedBakeResult {
  const animation = original.findAnimation(animationName);
  if (!animation) throw new Error(`Spine animation not found: ${animationName}`);
  for (const skeleton of [unclipped, original]) {
    skeleton.paused = true;
    skeleton.useTint = true;
    skeleton.premultipliedAlpha = premultipliedAlpha;
    skeleton.clearTracks();
    skeleton.setToSetupPose();
    skeleton.setAnimation(0, animationName, false);
  }
  const frameCount = Math.max(1, Math.ceil(animation.duration * frameRate));
  const frames: FixedFrame[] = [];
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    for (const skeleton of [unclipped, original]) {
      (skeleton as any)._instance.updateAnimation(frameIndex > 0 ? 1 / frameRate : 0);
    }
    const source = captureSpineVatFrame(unclipped, frameIndex / frameRate);
    // wasm 的 updateAnimation 不更新世界矩阵，要等 updateRenderData；不调的话剪裁多边形停在上一次渲染的姿势。
    (original as any).updateRenderData();
    const { bySlot, clips } = clipState((original as any)._skeleton);
    const materials: Array<{ end: number; textureId: string; blendMode: number }> = [];
    let segmentEnd = 0;
    for (const segment of source.segments) {
      segmentEnd += segment.vertexCount;
      materials.push({ end: segmentEnd, textureId: segment.textureId, blendMode: segment.blendMode });
    }
    let vertexStart = 0;
    let indexStart = 0;
    const keys = renderedKeys((unclipped as any)._skeleton).map((entry): FixedKeyRange => {
      const material = materials.find((candidate) => candidate.end > vertexStart);
      if (!material) throw new Error(`${animationName} 帧 ${frameIndex}：附件 ${entry.key} 超出渲染输出`);
      const range = {
        ...entry,
        vertexStart,
        indexStart,
        textureId: material.textureId,
        blendMode: material.blendMode,
        clip: bySlot.get(entry.slot) ?? null,
      };
      vertexStart += entry.vertexCount;
      indexStart += entry.indexCount;
      return range;
    });
    if (vertexStart !== source.vertexCount || indexStart !== source.indexCount) {
      throw new Error(`${animationName} 帧 ${frameIndex}：按 drawOrder 数出 ${vertexStart}/${indexStart}，`
        + `渲染输出 ${source.vertexCount}/${source.indexCount}`);
    }
    frames.push({ source, keys, clips });
  }
  return { animation: animationName, frames };
}

import {
  _decorator,
  director,
  gfx,
  macro,
  Material,
  RenderData,
  sys,
  Texture2D,
  UIRenderer,
} from 'cc';
import type { IAssembler } from 'cc';
import type { SpineVatManifest } from './SpineVatSchema';

type IBatcher = Parameters<UIRenderer['fillBuffers']>[0];
export type SpineVatUiLaneInfo = SpineVatManifest['layouts'][number]['lanes'][number];

const { ccclass } = _decorator;

// 每顶点一个 float = 4 B（native 每帧整块重传 UI 顶点，越小越好）：
//   code = (槽位 + additive ? 64 : 0) * SLOT_SHIFT + 帧内顶点序号。最大 128 * 2^14 < 2^24，float 精确表示。
export const SLOT_SHIFT = 16384;
const ADDITIVE_FLAG = 64;
const VFMT = [new gfx.Attribute('a_vatVertex', gfx.Format.R32F)];
// 按 stride 4 B 共用一个 StaticVBAccessor；默认 144 KB 只装得下 36k 顶点 ≈ 11 个实例，
// 一换 buffer 就断批。首次创建时临时调大到 255 KB（= 65280 顶点；MeshBuffer 断言顶点数 < 65536）。
const VAT_UI_BUFFER_KB = 255;

// ---- 按需上传 ----
// a_vatVertex 是独占的 4 B 格式，这些 MeshBuffer 里只有 VAT lane。顶点码只在分配 chunk 时写一次，
// 索引只在绘制顺序 / 参与实例变化时才变，引擎却每帧整块重传（web：vData 到 byteOffset + iData；native：整个容量）。
// web：直接覆盖这些 MeshBuffer 实例的 uploadBuffers，只传变了的。
// native：在共享的 dirtyMark 上置高位；只有打了引擎补丁（CMake 选项 CCK_VAT_UI_STATIC_VB，
//   native/engine/common/Classes/engine-patches/UIMeshBuffer.cpp）才认，原版引擎只看「非 0 = 脏」，行为不变。
type MeshBuffer = RenderData['chunk']['meshBuffer'];
interface UploadState {
  vertexDirty: boolean;
  indexDirty: boolean;
  uploadedBytes: number;
  uploadedIndices: number;
}
interface IaRef {
  vertexBuffers: gfx.Buffer[];
  indexBuffer: gfx.Buffer;
}
const uploadStates = new WeakMap<MeshBuffer, UploadState>();
const NATIVE_DIRTY_SLOT = 3; // MeshBufferSharedBufferView.dirty
const NATIVE_VERTEX_DIRTY = 2;
const NATIVE_STATIC_VB = 4;

function markVertexDirty(meshBuffer: MeshBuffer): void {
  if (sys.isNative) {
    meshBuffer.sharedBuffer[NATIVE_DIRTY_SLOT] |= NATIVE_VERTEX_DIRTY | NATIVE_STATIC_VB;
    return;
  }
  let state = uploadStates.get(meshBuffer);
  if (!state) {
    state = { vertexDirty: true, indexDirty: true, uploadedBytes: 0, uploadedIndices: 0 };
    uploadStates.set(meshBuffer, state);
    // iOS 14 WebGL 不能多个 IA 共用一个 GPU buffer，引擎在那条路上逐 IA 各传一份，保留原实现。
    if (!(sys as unknown as { __isWebIOS14OrIPadOS14Env?: boolean }).__isWebIOS14OrIPadOS14Env) {
      const target = state;
      meshBuffer.uploadBuffers = (): void => uploadChanged(meshBuffer, target);
    }
  }
  state.vertexDirty = true;
}

/** 与 MeshBuffer.uploadBuffers 相同，只是顶点 / 索引没变就不传。 */
function uploadChanged(buffer: MeshBuffer, state: UploadState): void {
  if (buffer.byteOffset === 0 || !buffer.dirty) return;
  const ia = (buffer as unknown as { _iaPool: IaRef[] })._iaPool[0];
  const byteCount = buffer.byteOffset;
  const vb = ia.vertexBuffers[0];
  if (state.vertexDirty || byteCount > state.uploadedBytes || byteCount > vb.size) {
    if (byteCount > vb.size) vb.resize(byteCount);
    vb.update(new Float32Array(buffer.vData.buffer, 0, byteCount >> 2) as never); // creator-types 的 BufferSource 声明比引擎实际接受的窄
    state.vertexDirty = false;
    state.uploadedBytes = byteCount;
  }
  const indexCount = buffer.indexOffset;
  const ib = ia.indexBuffer;
  if (state.indexDirty || indexCount > state.uploadedIndices || indexCount * 2 > ib.size) {
    if (indexCount * 2 > ib.size) ib.resize(indexCount * 2);
    ib.update(new Uint16Array(buffer.iData.buffer, 0, indexCount) as never);
    state.indexDirty = false;
    state.uploadedIndices = indexCount;
  }
  buffer.dirty = false;
}

const assembler: IAssembler = {
  createData(comp: SpineVatUiLane): RenderData {
    const vertexCount = comp.vertexCount;
    const previous = macro.BATCHER2D_MEM_INCREMENT;
    macro.BATCHER2D_MEM_INCREMENT = VAT_UI_BUFFER_KB; // 取定值：更大会超 65535 顶点
    const renderData = RenderData.add(VFMT);
    macro.BATCHER2D_MEM_INCREMENT = previous;
    renderData.initRenderDrawInfo(comp);
    renderData.resize(vertexCount, comp.indices.length);
    const vb = renderData.chunk.vb;
    let vertex = 0;
    for (const lane of comp.lanes) {
      const base = (comp.slot + (lane.blendMode === 'additive' ? ADDITIVE_FLAG : 0)) * SLOT_SHIFT + lane.vertexOffset;
      for (let index = 0; index < lane.vertexCapacity; index += 1, vertex += 1) vb[vertex] = base + index;
    }
    markVertexDirty(renderData.chunk.meshBuffer);
    if (sys.isNative) {
      // 位置在 shader 里从 VAT 取，native 不要按「前 3 个 float 是坐标」去改写顶点。
      renderData.renderDrawInfo.setVertexPositionInWorld(true);
      renderData.chunk.setIndexBuffer(comp.indices);
    }
    return renderData;
  },

  updateRenderData(comp: SpineVatUiLane): void {
    comp.renderData?.updateRenderData(comp, comp.atlas!);
  },

  // 只有 web 走这里；native 由 Batcher2d::fillIndexBuffers 直接拷 chunk.ib。
  // 上一帧自己就写在同一位置、同一段顶点 → iData 那段还是自己的（排在前面的只写到这个 offset 为止），不重写也不标脏。
  fillBuffers(comp: SpineVatUiLane): void {
    const chunk = comp.renderData!.chunk;
    const meshBuffer = chunk.meshBuffer;
    const offset = meshBuffer.indexOffset;
    const first = chunk.vertexOffset;
    const indices = comp.indices;
    const count = indices.length;
    const frame = director.getTotalFrames();
    const written = comp.indexFrame === frame - 1 && comp.indexBuffer === meshBuffer
      && comp.indexOffset === offset && comp.indexFirst === first;
    if (!written) {
      const ib = meshBuffer.iData;
      for (let index = 0; index < count; index += 1) ib[offset + index] = first + indices[index];
      const state = uploadStates.get(meshBuffer);
      if (state) state.indexDirty = true;
    }
    comp.indexFrame = frame;
    comp.indexBuffer = meshBuffer;
    comp.indexOffset = offset;
    comp.indexFirst = first;
    meshBuffer.indexOffset = offset + count;
  },
};

/**
 * 一段 lane（同材质的一个或多个 lane）的 UI 提交；槽位、材质由所属 SpineVatUiSkeleton 分配。
 * 同一实例的 lane 合成一段 = 一个 chunk：拆开时各 lane 按首次适配分进不同 MeshBuffer，
 * 实例在两个 buffer 间来回跳，每跳一次断一次批。
 * 单独成文件：Creator 规定一个脚本最多一个 Component，放一起启动即报 “Each script can have at most one Component”。
 */
@ccclass('spinevat.UiLane')
export class SpineVatUiLane extends UIRenderer {
  lanes: SpineVatUiLaneInfo[] = [];
  vertexCount = 0;
  /** chunk 内顶点号：lane 自带的三角形（lane 内局部号）加上 lane 在 chunk 里的起点。 */
  indices = new Uint16Array(0);
  atlas: Texture2D | null = null;
  slot = -1;
  /** fillBuffers 的「上一帧写在哪」记录（web）。 */
  indexFrame = -1;
  indexBuffer: MeshBuffer | null = null;
  indexOffset = -1;
  indexFirst = -1;

  init(lanes: SpineVatUiLaneInfo[], atlas: Texture2D, material: Material, slot: number): void {
    this.lanes = lanes;
    this.vertexCount = lanes.reduce((sum, lane) => sum + lane.vertexCapacity, 0);
    const indices: number[] = [];
    let base = 0;
    for (const lane of lanes) {
      for (const index of lane.indices) indices.push(base + index);
      base += lane.vertexCapacity;
    }
    this.indices = Uint16Array.from(indices);
    this.atlas = atlas;
    this.slot = slot;
    this._useVertexOpacity = true;
    this.customMaterial = material;
    this._flushAssembler();
    this.markForUpdateRenderData();
  }

  protected _flushAssembler(): void {
    this._assembler = assembler;
    if (!this._renderData && this.vertexCount > 0) {
      this._renderData = assembler.createData(this) as RenderData;
      this._renderData.material = this.getRenderMaterial(0);
      this.markForUpdateRenderData();
    }
  }

  protected _canRender(): boolean {
    return super._canRender() && !!this._renderData && this.vertexCount > 0;
  }

  protected _render(render: IBatcher): void {
    render.commitComp(this, this._renderData, this.atlas!, assembler, null);
  }
}

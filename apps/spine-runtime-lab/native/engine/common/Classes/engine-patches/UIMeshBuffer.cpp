/****************************************************************************
 Copyright (c) 2019-2023 Xiamen Yaji Software Co., Ltd.

 http://www.cocos.com

 Permission is hereby granted, free of charge, to any person obtaining a copy
 of this software and associated documentation files (the "Software"), to deal
 in the Software without restriction, including without limitation the rights to
 use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
 of the Software, and to permit persons to whom the Software is furnished to do so,
 subject to the following conditions:

 The above copyright notice and this permission notice shall be included in
 all copies or substantial portions of the Software.

 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 THE SOFTWARE.
****************************************************************************/

// creator-core-kit 补丁：Creator 3.8.7 引擎 cocos/2d/renderer/UIMeshBuffer.cpp 的副本，只改 uploadBuffers / setDirty(bool)，destroy 多一行清表。
// 由 CMake 选项 CCK_VAT_UI_STATIC_VB 替换引擎原文件（native/engine/common/CMakeLists.txt）；升级引擎时对照原文件重新 diff。
//
// dirtyMark 高位由 JS 置（extensions/spine-vat-importer/assets/runtime/SpineVatUiLane.ts）：
//   bit 0  引擎原义：本帧有批次用到这个 buffer
//   bit 1  VERTEX_DIRTY：JS 改过顶点（分配 chunk 时），下次上传后清掉
//   bit 2  STATIC_VB：这个 buffer 的顶点只在分配时变 → 平时只传用到的那段索引
// 原版：每帧 update(_vData) / update(_iData) 传整个容量（VAT 的 buffer 是 255 KB + 索引），不管变没变。
// 补丁：顶点只在 VERTEX_DIRTY 时传；索引与上次上传的逐字节比较，不同才传。没有 STATIC_VB 的 buffer 走原逻辑，一行不差。
#include "2d/renderer/UIMeshBuffer.h"
#include "renderer/gfx-base/GFXDevice.h"
#include <cstring>
#include "base/std/container/unordered_map.h"
#include "base/std/container/vector.h"

namespace cc {

namespace {
constexpr uint32_t ENGINE_DIRTY = 1;
constexpr uint32_t VERTEX_DIRTY = 2;
constexpr uint32_t STATIC_VB = 4;

// 上次传给 GPU 的索引，只给 STATIC_VB 的 buffer 存。头文件不改就没地方放成员，按指针查表；
// uploadBuffers / destroy 都在同一线程（Batcher2d 所在线程）调用，不加锁。
ccstd::unordered_map<const UIMeshBuffer*, ccstd::vector<uint16_t>>& uploadedIndices() {
    static ccstd::unordered_map<const UIMeshBuffer*, ccstd::vector<uint16_t>> table;
    return table;
}
} // namespace

static uint32_t getAttributesStride(ccstd::vector<gfx::Attribute>& attrs) {
    uint32_t stride = 0;
    for (auto& attr : attrs) {
        const auto& info = gfx::GFX_FORMAT_INFOS[static_cast<uint32_t>(attr.format)];
        stride += info.size;
    }
    return stride;
}

UIMeshBuffer::~UIMeshBuffer() {
    destroy();
}

void UIMeshBuffer::setVData(float* vData) {
    _vData = vData;
}

void UIMeshBuffer::setIData(uint16_t* iData) {
    _iData = iData;
}

void UIMeshBuffer::initialize(ccstd::vector<gfx::Attribute>&& attrs, bool needCreateLayout) {
    _attributes = attrs;
    _vertexFormatBytes = getAttributesStride(attrs);
    if (needCreateLayout) {
        _meshBufferLayout = new MeshBufferLayout();
    }
    _needDeleteLayout = needCreateLayout;
}

void UIMeshBuffer::reset() {
    setIndexOffset(0);
    _dirty = false;
}

void UIMeshBuffer::resetIA() {
}

void UIMeshBuffer::destroy() {
    uploadedIndices().erase(this);
    reset();
    _attributes.clear();
    _vb = nullptr;
    _ib = nullptr;
    if (_needDeleteVData) {
        delete _vData;
        delete _iData;
    }
    _vData = nullptr;
    _iData = nullptr;
    // Destroy InputAssemblers
    _ia = nullptr;
    if (_needDeleteLayout) {
        CC_SAFE_DELETE(_meshBufferLayout);
    }
}

void UIMeshBuffer::setDirty() {
    _dirty = true;
}

gfx::InputAssembler* UIMeshBuffer::requireFreeIA(gfx::Device* device) {
    return createNewIA(device);
}

void UIMeshBuffer::uploadBuffers() {
    uint32_t byteOffset = getByteOffset();
    bool dirty = getDirty();
    if (_meshBufferLayout == nullptr || byteOffset == 0 || !dirty || !_ia) {
        return;
    }

    uint32_t mark = _meshBufferLayout->dirtyMark;
    if (mark & STATIC_VB) {
        if (!(mark & ENGINE_DIRTY)) return; // 只有 JS 标记、本帧没批次用它
        uint32_t indexCount = getIndexOffset();
        gfx::Buffer* vBuffer = _ia->getVertexBuffers()[0];
        bool vertexResized = byteOffset > vBuffer->getSize();
        if (vertexResized) vBuffer->resize(byteOffset);
        if (vertexResized || (mark & VERTEX_DIRTY)) vBuffer->update(_vData, byteOffset);
        // 索引：Batcher2d::fillIndexBuffers 每帧照抄一遍，内容多半和上一帧相同 → memcmp 相同就不传。
        gfx::Buffer* iBuffer = _ia->getIndexBuffer();
        bool indexResized = indexCount * 2 > iBuffer->getSize();
        if (indexResized) iBuffer->resize(indexCount * 2);
        auto& uploaded = uploadedIndices()[this];
        if (indexResized || uploaded.size() != indexCount
            || std::memcmp(uploaded.data(), _iData, indexCount * 2) != 0) {
            iBuffer->update(_iData, indexCount * 2);
            uploaded.assign(_iData, _iData + indexCount);
        }
        _meshBufferLayout->dirtyMark = STATIC_VB;
        return;
    }

    uint32_t indexCount = getIndexOffset();
    uint32_t byteCount = getByteOffset();

    gfx::BufferList vBuffers = _ia->getVertexBuffers();
    if (!vBuffers.empty()) {
        gfx::Buffer* vBuffer = vBuffers[0];
        if (byteCount > vBuffer->getSize()) {
            vBuffer->resize(byteCount);
        }
        vBuffer->update(_vData);
    }
    gfx::Buffer* iBuffer = _ia->getIndexBuffer();
    if (indexCount * 2 > iBuffer->getSize()) {
        iBuffer->resize(indexCount * 2);
    }
    iBuffer->update(_iData);

    setDirty(false);
}

// use less
void UIMeshBuffer::recycleIA(gfx::InputAssembler* ia) {
}

gfx::InputAssembler* UIMeshBuffer::createNewIA(gfx::Device* device) {
    if (!_ia) {
        uint32_t vbStride = _vertexFormatBytes;
        uint32_t ibStride = sizeof(uint16_t);

        gfx::InputAssemblerInfo iaInfo = {};
        _vb = device->createBuffer({
            gfx::BufferUsageBit::VERTEX | gfx::BufferUsageBit::TRANSFER_DST,
            gfx::MemoryUsageBit::DEVICE | gfx::MemoryUsageBit::HOST,
            vbStride * 3,
            vbStride,
        });
        _ib = device->createBuffer({
            gfx::BufferUsageBit::INDEX | gfx::BufferUsageBit::TRANSFER_DST,
            gfx::MemoryUsageBit::DEVICE | gfx::MemoryUsageBit::HOST,
            ibStride * 3,
            ibStride,
        });

        iaInfo.attributes = _attributes;
        iaInfo.vertexBuffers.emplace_back(_vb);
        iaInfo.indexBuffer = _ib;
        _ia = device->createInputAssembler(iaInfo);
    }

    return _ia;
}

void UIMeshBuffer::syncSharedBufferToNative(uint32_t* buffer) {
    _sharedBuffer = buffer;
    parseLayout();
}

void UIMeshBuffer::parseLayout() {
    _meshBufferLayout = reinterpret_cast<MeshBufferLayout*>(_sharedBuffer);
}

void UIMeshBuffer::setByteOffset(uint32_t byteOffset) {
    _meshBufferLayout->byteOffset = byteOffset;
}

void UIMeshBuffer::setVertexOffset(uint32_t vertexOffset) {
    _meshBufferLayout->vertexOffset = vertexOffset;
}

void UIMeshBuffer::setIndexOffset(uint32_t indexOffset) {
    _meshBufferLayout->indexOffset = indexOffset;
}

void UIMeshBuffer::setDirty(bool dirty) const {
    // 只动 bit 0，保留 JS 置的高位。
    _meshBufferLayout->dirtyMark = (_meshBufferLayout->dirtyMark & ~ENGINE_DIRTY) | (dirty ? ENGINE_DIRTY : 0);
}

} // namespace cc

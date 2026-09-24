'use strict';

const fs = require('fs');
const path = require('path');
const {
  Camera,
  Color,
  Director,
  Layers,
  Node,
  Scene,
  Vec3,
  assetManager,
  director,
  gfx,
  renderer,
} = require('cc');

const PREVIEW_NAME = 'spine-vat-preview';
const PREVIEW_QUERY = 'query-spine-vat-preview-data';
const RUNTIME_MODULE = 'db://spine-vat-importer/runtime/SpineVatSkeleton.ts';

class PreviewBuffer {
  constructor(name, scene, onResize) {
    this.name = name;
    this.scene = scene;
    this.renderScene = scene.renderScene;
    this.onResize = onResize;
    this.width = Math.max(1, Math.floor(director.root.mainWindow.width));
    this.height = Math.max(1, Math.floor(director.root.mainWindow.height));
    this.data = new Uint8Array(this.width * this.height * 4);
    this.regions = [new gfx.BufferTextureCopy()];
    this.regions[0].texExtent.width = this.width;
    this.regions[0].texExtent.height = this.height;
    this.regions[0].texExtent.depth = 1;
    this.renderData = { width: this.width, height: this.height, buffer: this.data };
    this.queue = [];
    this.locked = false;
    this.createWindow();
  }

  createWindow() {
    const root = director.root;
    const mainWindow = root.mainWindow;
    const renderPassInfo = new gfx.RenderPassInfo(
      [new gfx.ColorAttachment(mainWindow.swapchain.colorTexture.format)],
      new gfx.DepthStencilAttachment(mainWindow.swapchain.depthStencilTexture.format),
    );
    renderPassInfo.colorAttachments[0].barrier = root.device.getGeneralBarrier(
      new gfx.GeneralBarrierInfo(0, gfx.AccessFlagBit.FRAGMENT_SHADER_READ_TEXTURE),
    );
    this.window = root.createWindow({
      title: this.name,
      width: this.width,
      height: this.height,
      renderPassInfo,
      isOffscreen: true,
    });
  }

  resize(width, height) {
    width = Math.max(1, Math.floor(width));
    height = Math.max(1, Math.floor(height));
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    this.window.resize(width, height);
    this.regions[0].texExtent.width = width;
    this.regions[0].texExtent.height = height;
    this.data = new Uint8Array(width * height * 4);
    this.renderData = { width, height, buffer: this.data };
    this.onResize(width, height);
  }

  copyFrameBuffer() {
    const framebuffer = this.window && this.window.framebuffer;
    if (!framebuffer) return this.renderData;
    director.root.device.copyTextureToBuffers(
      framebuffer.colorTextures[0],
      [new Uint8Array(this.renderData.buffer.buffer)],
      this.regions,
    );
    this.flipRowsIfNeeded();
    return this.renderData;
  }

  flipRowsIfNeeded() {
    const api = director.root.device.gfxAPI;
    if ([gfx.API.GLES2, gfx.API.GLES3, gfx.API.WEBGL, gfx.API.WEBGL2].includes(api)) return;
    const rowBytes = this.width * 4;
    const temporary = new Uint8Array(rowBytes);
    for (let top = 0, bottom = this.height - 1; top < bottom; top += 1, bottom -= 1) {
      const topOffset = top * rowBytes;
      const bottomOffset = bottom * rowBytes;
      temporary.set(this.data.subarray(topOffset, topOffset + rowBytes));
      this.data.copyWithin(topOffset, bottomOffset, bottomOffset + rowBytes);
      this.data.set(temporary, bottomOffset);
    }
  }

  async getImageData(width, height) {
    if (!this.renderScene || !this.window) return this.renderData;
    this.resize(width, height);
    this.onResize(this.width, this.height);
    cce.Engine.repaintInEditMode();

    const camera = this.window.cameras && this.window.cameras[0];
    if (!camera) return this.renderData;
    if (camera.width !== this.width || camera.height !== this.height) camera.resize(this.width, this.height);
    camera.update(true);

    return new Promise((resolve) => {
      director.once(Director.EVENT_AFTER_DRAW, () => resolve(this.copyFrameBuffer()));
    });
  }

  getImageDataInQueue(width, height, event) {
    this.queue.push({ width, height, event });
    void this.step();
  }

  async step() {
    if (this.locked) return;
    const item = this.queue.shift();
    if (!item) return;
    this.locked = true;
    try {
      const data = await this.getImageData(item.width, item.height);
      item.event.reply(null, data);
    } catch (error) {
      item.event.reply(error);
    } finally {
      this.locked = false;
      void this.step();
    }
  }
}

function loadAsset(uuid) {
  return new Promise((resolve, reject) => {
    assetManager.loadAny(uuid, (error, asset) => {
      if (error || !asset) reject(error || new Error(`VAT Asset 加载失败：${uuid}`));
      else resolve(asset);
    });
  });
}

class SpineVatPreview {
  constructor() {
    this.skeleton = null;
    this.asset = null;
    this.bounds = [-1, -1, 1, 1];
    this.viewportWidth = 1;
    this.viewportHeight = 1;

    this.scene = new Scene(PREVIEW_NAME);
    this.content = new Node('VAT Preview Content');
    this.content.layer = Layers.Enum.UI_3D;
    this.content.parent = this.scene;

    this.cameraNode = new Node('VAT Preview Camera');
    this.cameraNode.parent = this.scene;
    this.cameraComp = this.cameraNode.addComponent(Camera);
    this.cameraComp.projection = Camera.ProjectionType.ORTHO;
    this.cameraComp.near = 0.1;
    this.cameraComp.far = 4000;
    this.cameraComp.clearColor = new Color(38, 42, 39, 255);
    this.cameraComp.clearFlags = gfx.ClearFlagBit.COLOR | gfx.ClearFlagBit.DEPTH_STENCIL;
    this.cameraComp.visibility = Layers.BitMask.UI_3D;
    this.cameraComp.enabled = false;

    this.scene._load();
    this.scene._activate();
    this.camera = this.cameraComp.camera;
    this.camera.isWindowSize = false;
    this.camera.cameraUsage = renderer.scene.CameraUsage.EDITOR;
    this.camera.detachCamera();
  }

  init(registerName) {
    if (this.buffer) return;
    this.buffer = new PreviewBuffer(registerName, this.scene, (width, height) => this.fitCamera(width, height));
    this.camera.changeTargetWindow(this.buffer.window);
    this.cameraComp.enabled = true;
    this.fitCamera(this.buffer.width, this.buffer.height);
  }

  async setAsset(uuid) {
    this.disposePopulation();
    const runtime = await Editor.Module.importProjectModule(RUNTIME_MODULE);
    const Skeleton = runtime && runtime.SpineVatSkeleton;
    if (!Skeleton) throw new Error(`无法从 ${RUNTIME_MODULE} 加载 SpineVatSkeleton`);
    this.asset = await loadAsset(uuid);
    if (!this.skeleton) this.skeleton = this.content.addComponent(Skeleton);
    this.skeleton.enabled = true;

    const manifest = this.asset.manifest;
    const clip = manifest.clips && manifest.clips[0];
    if (!clip) throw new Error('VAT 资源不包含动画片段');
    this.bounds = manifest.layouts && manifest.layouts[0] && manifest.layouts[0].bounds || [-1, -1, 1, 1];
    this.skeleton.skeletonData = this.asset;
    this.skeleton.initialClipIndex = 1;
    await this.skeleton.reload();
    this.fitCamera(this.viewportWidth, this.viewportHeight);
    this.cameraComp.enabled = true;
    cce.Engine.repaintInEditMode();
    return this.describe();
  }

  describe() {
    const manifest = this.asset && this.asset.manifest;
    const state = this.getState();
    return {
      ...state,
      clips: manifest ? manifest.clips.map((clip) => ({
        name: clip.name,
        fps: clip.fps,
        duration: clip.duration,
        frameCount: clip.frameCount,
        layout: clip.layout,
      })) : [],
    };
  }

  getState() {
    return this.skeleton && this.skeleton.snapshot() || null;
  }

  setAnimation(name) {
    const state = this.getState();
    this.skeleton.play(name, { loop: state ? state.loop : true, speed: state ? state.speed : 1 });
    cce.Engine.repaintInEditMode();
    return this.getState();
  }

  setLoop(loop) {
    this.skeleton.setLoop(Boolean(loop));
    return this.getState();
  }

  setSpeed(speed) {
    this.skeleton.setTimeScale(Number(speed));
    return this.getState();
  }

  setFrame(frame) {
    this.skeleton.pause();
    this.skeleton.setManualFrame(Number(frame));
    cce.Engine.repaintInEditMode();
    return this.getState();
  }

  play() {
    this.skeleton.setManualFrame(null);
    this.skeleton.resume();
    cce.Engine.repaintInEditMode();
    return this.getState();
  }

  pause() {
    this.skeleton.pause();
    cce.Engine.repaintInEditMode();
    return this.getState();
  }

  stop() {
    this.skeleton.pause();
    this.skeleton.setManualFrame(0);
    cce.Engine.repaintInEditMode();
    return this.getState();
  }

  fitCamera(width, height) {
    this.viewportWidth = Math.max(1, width || 1);
    this.viewportHeight = Math.max(1, height || 1);
    const [minX, minY, maxX, maxY] = this.bounds;
    const contentWidth = Math.max(1, maxX - minX);
    const contentHeight = Math.max(1, maxY - minY);
    const aspect = this.viewportWidth / this.viewportHeight;
    const halfHeight = Math.max(contentHeight / 2, contentWidth / (2 * aspect)) * 1.12;
    const center = new Vec3((minX + maxX) / 2, (minY + maxY) / 2, 0);
    this.cameraComp.orthoHeight = halfHeight;
    this.cameraNode.setPosition(center.x, center.y, 1000);
    this.cameraNode.lookAt(center, Vec3.UNIT_Y);
  }

  async queryPreviewData(info) {
    return this.buffer.getImageData(info.width, info.height);
  }

  queryPreviewDataQueue(info, event) {
    this.buffer.getImageDataInQueue(info.width, info.height, event);
  }

  queryViewToolState() {
    return { enableResetCamera: false, enableViewToggle: false };
  }

  close() {
    this.disposePopulation();
    this.cameraComp.enabled = false;
    cce.Engine.repaintInEditMode();
  }

  disposePopulation() {
    if (this.skeleton) this.skeleton.skeletonData = null;
    this.asset = null;
  }
}

const preview = new SpineVatPreview();
let registered = false;

exports.methods = {
  /**
   * 资源右键「烘焙 Spine VAT」：.bin 与图集 PNG 写进 outDir，manifest 文本返回给调用方。
   * manifest 要等 PNG 导入完（Texture2D 子资源生成）再写，否则同批并行导入时导入器找不到纹理。
   */
  async bake(uuid, alphaMode, outDir, sourceDir) {
    const { bakeSpineVat } = require('./bake/dist/bake.js');
    const baked = await bakeSpineVat(await loadAsset(uuid), alphaMode);
    fs.mkdirSync(outDir, { recursive: true });
    let manifest = '';
    for (const [name, content] of baked.files) {
      if (name === 'manifest.spinevat') manifest = content;
      else fs.writeFileSync(path.join(outDir, name), content);
    }
    for (const page of baked.atlasPages) {
      const source = path.join(sourceDir, page);
      if (!fs.existsSync(source)) throw new Error(`找不到图集纹理 ${source}，manifest 已写出，请手动拷贝`);
      fs.copyFileSync(source, path.join(outDir, page));
    }
    return { manifest, summary: baked.summary };
  },

  async initPreview() {
    if (!registered) {
      await cce.Preview.initPreview(PREVIEW_NAME, PREVIEW_QUERY, preview);
      registered = true;
    }
    return true;
  },
};

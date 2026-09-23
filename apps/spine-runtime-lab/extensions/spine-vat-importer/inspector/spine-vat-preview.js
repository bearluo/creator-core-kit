'use strict';

const PREVIEW_NAME = 'spine-vat-preview';
const PREVIEW_QUERY = 'query-spine-vat-preview-data';

exports.template = /* html */`
<ui-section class="vat-preview-section config no-padding" header="VAT 动画预览" expand>
  <div class="preview-content">
    <div class="preview-settings">
      <ui-prop>
        <ui-label slot="label" value="动画"></ui-label>
        <ui-select-pro slot="content" class="animation"></ui-select-pro>
      </ui-prop>
      <ui-prop>
        <ui-label slot="label" value="循环"></ui-label>
        <ui-checkbox slot="content" class="loop" value="true"></ui-checkbox>
      </ui-prop>
      <ui-prop>
        <ui-label slot="label" value="速度"></ui-label>
        <div slot="content" class="speed-row">
          <input class="speed" type="range" min="0.1" max="2" step="0.1" value="1">
          <span class="speed-value">1.0×</span>
          <ui-button class="reset-speed" type="icon" tooltip="恢复 1 倍速"><ui-icon value="reset"></ui-icon></ui-button>
        </div>
      </ui-prop>
      <div class="clip-summary">-</div>
    </div>

    <div class="preview-stage">
      <div class="loading">正在加载 VAT 预览…</div>
    </div>

    <div class="transport">
      <ui-button class="first-frame transparent" type="icon" tooltip="第一帧"><ui-icon value="rewind"></ui-icon></ui-button>
      <ui-button class="previous-frame transparent" type="icon" tooltip="上一帧"><ui-icon value="prev-play"></ui-icon></ui-button>
      <ui-button class="play transparent" type="icon" tooltip="播放"><ui-icon value="play"></ui-icon></ui-button>
      <ui-button class="pause transparent" type="icon" tooltip="暂停" hidden><ui-icon value="pause"></ui-icon></ui-button>
      <ui-button class="stop transparent" type="icon" tooltip="停止"><ui-icon value="stop"></ui-icon></ui-button>
      <ui-button class="next-frame transparent" type="icon" tooltip="下一帧"><ui-icon value="next-play"></ui-icon></ui-button>
      <ui-button class="last-frame transparent" type="icon" tooltip="最后一帧"><ui-icon value="forward"></ui-icon></ui-button>
      <span class="frame-value">0 / 0</span>
    </div>
    <input class="timeline" type="range" min="0" max="0" step="1" value="0">
    <div class="preview-error" hidden></div>
  </div>
</ui-section>`;

exports.style = /* css */`
.vat-preview-section { margin-top: 0; }
.preview-content { display: flex; flex-direction: column; padding: 5px 8px 9px; }
.preview-settings { padding-bottom: 5px; }
.speed-row { display: grid; grid-template-columns: minmax(0, 1fr) 38px 24px; gap: 5px; align-items: center; }
.speed, .timeline { accent-color: #a9cc59; }
.speed { width: 100%; }
.speed-value { color: var(--color-normal-contrast-weaker); font-variant-numeric: tabular-nums; text-align: right; }
.clip-summary { margin: 4px 2px 1px; color: var(--color-normal-contrast-weaker); font-size: 10px; text-align: right; }
.preview-stage {
  position: relative; width: 100%; height: var(--inspector-footer-preview-height, 240px); min-height: 160px;
  overflow: hidden; border: 1px solid var(--color-normal-border); border-radius: 4px;
  background: radial-gradient(circle at 50% 45%, #3b4036 0%, #292c2b 48%, #202224 100%);
}
.preview-stage canvas { display: block; width: 100%; height: 100%; }
.loading { position: absolute; inset: 0; z-index: 2; display: flex; align-items: center; justify-content: center; color: #b9c49f; background: rgba(31, 34, 32, .76); pointer-events: none; }
.loading[hidden] { display: none; }
.transport { display: flex; align-items: center; justify-content: center; gap: 2px; padding: 7px 0 4px; }
.transport ui-button[hidden] { display: none; }
.frame-value { min-width: 65px; margin-left: 6px; color: var(--color-normal-contrast-weaker); font-size: 10px; font-variant-numeric: tabular-nums; text-align: right; }
.timeline { width: 100%; margin: 0; }
.preview-error { margin-top: 6px; padding: 7px; border: 1px solid #8c3c3c; border-radius: 4px; background: rgba(140, 60, 60, .15); color: #efb2b2; white-space: pre-wrap; }
`;

exports.$ = {
  section: '.vat-preview-section',
  animation: '.animation',
  loop: '.loop',
  speed: '.speed',
  speedValue: '.speed-value',
  resetSpeed: '.reset-speed',
  clipSummary: '.clip-summary',
  stage: '.preview-stage',
  loading: '.loading',
  firstFrame: '.first-frame',
  previousFrame: '.previous-frame',
  play: '.play',
  pause: '.pause',
  stop: '.stop',
  nextFrame: '.next-frame',
  lastFrame: '.last-frame',
  frameValue: '.frame-value',
  timeline: '.timeline',
  error: '.preview-error',
};

function executeScene(method, args = []) {
  return Editor.Message.request('scene', 'execute-scene-script', {
    name: 'spine-vat-importer',
    method,
    args,
  });
}

class VatPreviewCanvas {
  constructor(container) {
    this.container = container;
    this.canvas = document.createElement('canvas');
    this.container.appendChild(this.canvas);
    this.glPreview = null;
    this.resizeObserver = null;
    this.animationId = -1;
    this.dirty = true;
    this.playing = true;
    this.closed = false;
    this.lastDraw = 0;
  }

  async init() {
    await executeScene('initPreview');
    const GLPreview = Editor._Module.require('PreviewExtends').default;
    this.glPreview = new GLPreview(PREVIEW_NAME, PREVIEW_QUERY);
    await this.glPreview.init({
      width: Math.max(1, this.container.clientWidth),
      height: Math.max(1, this.container.clientHeight),
    });
    this.resizeObserver = new ResizeObserver(() => { this.dirty = true; });
    this.resizeObserver.observe(this.container);
    this.tick();
  }

  setPlaying(value) {
    this.playing = value;
    this.dirty = true;
  }

  requestDraw() {
    this.dirty = true;
  }

  async call(funcName, ...args) {
    const value = await Editor.Message.request('scene', 'call-preview-function', PREVIEW_NAME, funcName, ...args);
    this.dirty = true;
    return value;
  }

  async draw() {
    if (!this.glPreview || this.closed) return;
    const width = Math.max(1, Math.floor(this.container.clientWidth));
    const height = Math.max(1, Math.floor(this.container.clientHeight));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      await this.glPreview.initGL(this.canvas, { width, height });
      await this.glPreview.resizeGL(width, height);
    }
    const image = await this.glPreview.queryPreviewData({ width, height });
    this.glPreview.drawGL(image);
  }

  tick(time = 0) {
    if (this.closed) return;
    if (this.dirty || (this.playing && time - this.lastDraw >= 33)) {
      this.dirty = false;
      this.lastDraw = time;
      this.draw().catch((error) => console.warn('[Spine VAT Preview]', error));
    }
    this.animationId = requestAnimationFrame((nextTime) => this.tick(nextTime));
  }

  close() {
    this.closed = true;
    cancelAnimationFrame(this.animationId);
    if (this.resizeObserver) this.resizeObserver.disconnect();
  }
}

function setPlaying(panel, playing) {
  panel.playing = playing;
  panel.$.play.toggleAttribute('hidden', playing);
  panel.$.pause.toggleAttribute('hidden', !playing);
  if (panel.preview) panel.preview.setPlaying(playing);
}

function currentClip(panel) {
  return panel.clips[panel.clipIndex] || null;
}

function setFrameUI(panel, frame) {
  const clip = currentClip(panel);
  const max = Math.max(0, (clip && clip.frameCount || 1) - 1);
  const value = Math.max(0, Math.min(max, Math.floor(Number(frame) || 0)));
  panel.$.timeline.max = String(max);
  panel.$.timeline.value = String(value);
  panel.$.frameValue.textContent = `${value} / ${max}`;
}

function updateClipUI(panel) {
  const clip = currentClip(panel);
  if (!clip) {
    panel.$.clipSummary.textContent = '-';
    setFrameUI(panel, 0);
    return;
  }
  panel.$.clipSummary.textContent = `${clip.fps} FPS · ${clip.frameCount} 帧 · ${Number(clip.duration).toFixed(2)} 秒 · Layout ${clip.layout}`;
  setFrameUI(panel, 0);
}

function populateAnimations(panel) {
  panel.$.animation.replaceChildren();
  panel.clips.forEach((clip, index) => {
    const option = document.createElement('ui-select-option-pro');
    option.setAttribute('label', clip.name);
    option.setAttribute('value', String(index));
    if (index === panel.clipIndex) option.setAttribute('selected', '');
    panel.$.animation.appendChild(option);
  });
}

async function loadAsset(panel, uuid) {
  const generation = ++panel.loadGeneration;
  panel.$.loading.hidden = false;
  panel.$.error.hidden = true;
  const ready = await panel.previewReady;
  if (!ready || generation !== panel.loadGeneration) return;
  const info = await panel.preview.call('setAsset', uuid);
  if (generation !== panel.loadGeneration) return;
  if (!info) throw new Error('Scene 进程没有返回 VAT 资源信息');
  panel.clips = info.clips || [];
  panel.clipIndex = Math.max(0, panel.clips.findIndex((clip) => clip.name === info.clip));
  populateAnimations(panel);
  updateClipUI(panel);
  panel.$.loop.value = info.loop !== false;
  panel.$.speed.value = String(info.speed || 1);
  panel.$.speedValue.textContent = `${Number(info.speed || 1).toFixed(1)}×`;
  setPlaying(panel, !info.paused);
  panel.$.loading.hidden = true;
}

async function seekFrame(panel, frame) {
  setPlaying(panel, false);
  const state = await panel.preview.call('setFrame', Number(frame));
  setFrameUI(panel, state && state.frame);
}

exports.ready = function() {
  const panel = this;
  panel.clips = [];
  panel.clipIndex = 0;
  panel.playing = true;
  panel.loadGeneration = 0;
  panel.lastStateQuery = 0;
  panel.preview = new VatPreviewCanvas(panel.$.stage);
  panel.previewReady = panel.preview.init().then(() => true).catch((error) => {
    panel.$.loading.hidden = true;
    panel.$.error.textContent = `预览初始化失败：${error && error.message || error}`;
    panel.$.error.hidden = false;
    console.error('[Spine VAT Preview]', error);
    return false;
  });

  panel.$.animation.addEventListener('confirm', async (event) => {
    panel.clipIndex = Number(event.detail);
    const clip = currentClip(panel);
    if (!clip) return;
    updateClipUI(panel);
    const state = await panel.preview.call('setAnimation', clip.name);
    setPlaying(panel, state && !state.paused);
  });
  panel.$.loop.addEventListener('confirm', async (event) => {
    await panel.preview.call('setLoop', Boolean(event.target.value));
  });
  panel.$.speed.addEventListener('input', async (event) => {
    const speed = Number(event.target.value);
    panel.$.speedValue.textContent = `${speed.toFixed(1)}×`;
    await panel.preview.call('setSpeed', speed);
  });
  panel.$.resetSpeed.addEventListener('click', async () => {
    panel.$.speed.value = '1';
    panel.$.speedValue.textContent = '1.0×';
    await panel.preview.call('setSpeed', 1);
  });
  panel.$.timeline.addEventListener('input', (event) => setFrameUI(panel, event.target.value));
  panel.$.timeline.addEventListener('change', (event) => void seekFrame(panel, event.target.value));
  panel.$.play.addEventListener('click', async () => {
    const state = await panel.preview.call('play');
    setPlaying(panel, state && !state.paused);
  });
  panel.$.pause.addEventListener('click', async () => {
    const state = await panel.preview.call('pause');
    setPlaying(panel, state && !state.paused);
    setFrameUI(panel, state && state.frame);
  });
  panel.$.stop.addEventListener('click', async () => {
    const state = await panel.preview.call('stop');
    setPlaying(panel, false);
    setFrameUI(panel, state && state.frame);
  });
  panel.$.firstFrame.addEventListener('click', () => void seekFrame(panel, 0));
  panel.$.lastFrame.addEventListener('click', () => {
    const clip = currentClip(panel);
    void seekFrame(panel, Math.max(0, (clip && clip.frameCount || 1) - 1));
  });
  panel.$.previousFrame.addEventListener('click', () => void seekFrame(panel, Number(panel.$.timeline.value) - 1));
  panel.$.nextFrame.addEventListener('click', () => void seekFrame(panel, Number(panel.$.timeline.value) + 1));

  const updateTimeline = async (time) => {
    if (panel.preview && panel.playing && time - panel.lastStateQuery > 100) {
      panel.lastStateQuery = time;
      try {
        const state = await panel.preview.call('getState');
        if (state) setFrameUI(panel, state.frame);
      } catch (error) {
        console.warn('[Spine VAT Preview]', error);
      }
    }
    panel.timelineAnimationId = requestAnimationFrame(updateTimeline);
  };
  panel.timelineAnimationId = requestAnimationFrame(updateTimeline);
};

exports.update = function(assetList, metaList) {
  this.assetList = assetList;
  this.metaList = metaList;
  const asset = assetList[0];
  const hidden = assetList.length !== 1 || !asset;
  this.$.section.style.display = hidden ? 'none' : '';
  if (!hidden) {
    loadAsset(this, asset.uuid).catch((error) => {
      this.$.loading.hidden = true;
      this.$.error.textContent = `VAT 预览加载失败：${error && error.message || error}`;
      this.$.error.hidden = false;
      console.error('[Spine VAT Preview]', error);
    });
  }
};

exports.close = function() {
  this.loadGeneration += 1;
  cancelAnimationFrame(this.timelineAnimationId);
  if (this.preview) {
    this.preview.call('close').catch(() => {});
    this.preview.close();
  }
};

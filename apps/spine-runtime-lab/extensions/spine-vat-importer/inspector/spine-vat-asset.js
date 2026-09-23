'use strict';

const fs = require('fs');

exports.template = /* html */`
<section class="vat-inspector">
  <div class="hero">
    <div>
      <div class="eyebrow">SPINE VAT 2</div>
      <div class="title">GPU 动画资源</div>
    </div>
    <span class="compatibility"></span>
  </div>

  <div class="stats">
    <div class="stat"><span>动画</span><strong class="clip-count">-</strong></div>
    <div class="stat"><span>Render Lanes</span><strong class="lane-count">-</strong></div>
    <div class="stat"><span>纹理页</span><strong class="page-count">-</strong></div>
    <div class="stat"><span>显存估算</span><strong class="gpu-bytes">-</strong></div>
  </div>

  <ui-section class="config" header="资源依赖" expand>
    <div class="dependency-list">
      <ui-prop><ui-label slot="label" value="Effect"></ui-label><ui-asset slot="content" class="effect" readonly droppable="cc.EffectAsset"></ui-asset></ui-prop>
      <div class="atlas-pages"></div>
      <div class="position-pages"></div>
      <div class="light-pages"></div>
      <div class="dark-pages"></div>
    </div>
  </ui-section>

  <ui-section class="config metadata" header="VAT 信息" expand>
    <ui-prop><ui-label slot="label" value="格式"></ui-label><ui-label slot="content" class="format"></ui-label></ui-prop>
    <ui-prop><ui-label slot="label" value="Alpha"></ui-label><ui-label slot="content" class="alpha"></ui-label></ui-prop>
    <ui-prop><ui-label slot="label" value="颜色通道"></ui-label><ui-label slot="content" class="channels"></ui-label></ui-prop>
    <ui-prop><ui-label slot="label" value="Spine Runtime"></ui-label><ui-label slot="content" class="runtime"></ui-label></ui-prop>
    <ui-prop><ui-label slot="label" value="布局"></ui-label><ui-label slot="content" class="layouts"></ui-label></ui-prop>
    <ui-prop><ui-label slot="label" value="绘制批次"></ui-label><ui-label slot="content" class="draw-calls"></ui-label></ui-prop>
  </ui-section>

  <ui-section class="config clips-section" header="动画片段" expand>
    <div class="clip-list"></div>
  </ui-section>

  <ui-section class="config warnings-section" header="兼容性提示" expand>
    <div class="warning-list"></div>
  </ui-section>

  <div class="error" hidden></div>
</section>`;

exports.style = /* css */`
.vat-inspector { padding: 0 4px 8px 0; color: var(--color-normal-contrast-weakest); }
.hero {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  margin: 2px 0 8px; padding: 12px 14px; border: 1px solid #50612e;
  border-radius: 6px; background: linear-gradient(135deg, #313925 0%, #252a23 55%, #202325 100%);
}
.eyebrow { color: #b9d96e; font-size: 10px; font-weight: 700; letter-spacing: 1.4px; }
.title { margin-top: 2px; color: #eef4df; font-size: 15px; font-weight: 600; }
.compatibility { padding: 4px 7px; border-radius: 3px; background: #567324; color: #efffc8; font-size: 10px; }
.compatibility.hybrid { background: #765d21; color: #ffe9a8; }
.stats { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; margin-bottom: 8px; }
.stat { display: flex; align-items: baseline; justify-content: space-between; padding: 7px 9px; border: 1px solid var(--color-normal-border); border-radius: 4px; background: var(--color-normal-fill); }
.stat span { color: var(--color-normal-contrast-weaker); font-size: 11px; }
.stat strong { color: var(--color-normal-contrast); font-size: 12px; font-weight: 600; }
.config { margin-top: 6px; }
.dependency-list, .metadata, .clip-list, .warning-list { padding: 5px 8px 7px; }
.dependency-list ui-asset { width: 100%; pointer-events: auto; }
.clip-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; padding: 6px 2px; border-bottom: 1px solid var(--color-normal-border); }
.clip-row:last-child { border-bottom: 0; }
.clip-name { overflow: hidden; color: var(--color-normal-contrast); text-overflow: ellipsis; white-space: nowrap; }
.clip-meta { color: var(--color-normal-contrast-weaker); font-size: 10px; white-space: nowrap; }
.warning { margin: 4px 0; padding: 6px 8px; border-left: 2px solid #bd8a2c; background: rgba(189, 138, 44, .08); color: #d9c28e; line-height: 1.45; }
.empty { padding: 5px 2px; color: var(--color-normal-contrast-weaker); }
.error { margin-top: 8px; padding: 8px; border: 1px solid #8c3c3c; border-radius: 4px; background: rgba(140, 60, 60, .15); color: #efb2b2; white-space: pre-wrap; }
`;

exports.$ = {
  compatibility: '.compatibility',
  clipCount: '.clip-count',
  laneCount: '.lane-count',
  pageCount: '.page-count',
  gpuBytes: '.gpu-bytes',
  effect: '.effect',
  atlasPages: '.atlas-pages',
  positionPages: '.position-pages',
  lightPages: '.light-pages',
  darkPages: '.dark-pages',
  format: '.format',
  alpha: '.alpha',
  channels: '.channels',
  runtime: '.runtime',
  layouts: '.layouts',
  drawCalls: '.draw-calls',
  clipList: '.clip-list',
  warningsSection: '.warnings-section',
  warningList: '.warning-list',
  error: '.error',
};

function readImportedAsset(asset) {
  const libraryPath = asset && asset.library && asset.library['.json'];
  if (!libraryPath) throw new Error('VAT Library JSON 不存在，请重新导入资源');
  return JSON.parse(fs.readFileSync(libraryPath, 'utf8'));
}

function readManifest(asset, imported) {
  const sourcePath = asset && (asset.file || asset.source);
  if (sourcePath && fs.existsSync(sourcePath)) {
    return JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  }
  if (imported && imported._manifestJson) return JSON.parse(imported._manifestJson);
  throw new Error('无法读取 .spinevat manifest');
}

function setText(element, value) {
  element.setAttribute('value', String(value));
}

function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function createAssetRows(parent, title, assets, expectedType) {
  parent.replaceChildren();
  if (!assets || assets.length === 0) return;
  assets.forEach((assetRef, index) => {
    const prop = document.createElement('ui-prop');
    const label = document.createElement('ui-label');
    const field = document.createElement('ui-asset');
    label.setAttribute('slot', 'label');
    label.setAttribute('value', assets.length === 1 ? title : `${title} ${index}`);
    field.setAttribute('slot', 'content');
    field.setAttribute('readonly', '');
    field.setAttribute('droppable', assetRef.__expectedType__ || expectedType);
    field.setAttribute('value', assetRef.__uuid__ || '');
    prop.append(label, field);
    parent.appendChild(prop);
  });
}

function renderClips(parent, clips) {
  parent.replaceChildren();
  if (!clips.length) {
    parent.innerHTML = '<div class="empty">没有动画片段</div>';
    return;
  }
  clips.forEach((clip) => {
    const row = document.createElement('div');
    row.className = 'clip-row';
    const name = document.createElement('span');
    name.className = 'clip-name';
    name.textContent = clip.name;
    name.title = clip.name;
    const meta = document.createElement('span');
    meta.className = 'clip-meta';
    meta.textContent = `${clip.fps} FPS · ${clip.frameCount} 帧 · ${Number(clip.duration).toFixed(2)}s`;
    row.append(name, meta);
    parent.appendChild(row);
  });
}

function renderWarnings(panel, warnings) {
  panel.$.warningList.replaceChildren();
  panel.$.warningsSection.style.display = warnings.length ? '' : 'none';
  warnings.forEach((message) => {
    const item = document.createElement('div');
    item.className = 'warning';
    item.textContent = message;
    panel.$.warningList.appendChild(item);
  });
}

exports.update = function(assetList, metaList) {
  this.assetList = assetList;
  this.metaList = metaList;
  const asset = assetList[0];
  const multiple = assetList.length !== 1;
  this.$.error.hidden = true;

  if (multiple || !asset) {
    this.$.error.textContent = 'VAT 属性检查器暂不支持多选。';
    this.$.error.hidden = false;
    return;
  }

  try {
    const imported = readImportedAsset(asset);
    const manifest = readManifest(asset, imported);
    const lanes = (manifest.layouts || []).reduce((sum, layout) => sum + (layout.lanes || []).length, 0);
    const compatibility = manifest.compatibility || {};
    const level = compatibility.level || 'UNKNOWN';

    this.$.compatibility.textContent = level;
    this.$.compatibility.classList.toggle('hybrid', level !== 'LOSSLESS_VAT');
    this.$.clipCount.textContent = String((manifest.clips || []).length);
    this.$.laneCount.textContent = String(lanes);
    this.$.pageCount.textContent = String((manifest.texturePages || []).length);
    this.$.gpuBytes.textContent = formatBytes(compatibility.estimatedGpuBytes);

    this.$.effect.setAttribute('value', imported.effectAsset && imported.effectAsset.__uuid__ || '');
    createAssetRows(this.$.atlasPages, 'Atlas', imported.atlasPages, 'cc.Texture2D');
    createAssetRows(this.$.positionPages, 'Position', imported.positionPages, 'cc.BufferAsset');
    createAssetRows(this.$.lightPages, 'Light', imported.lightPages, 'cc.BufferAsset');
    createAssetRows(this.$.darkPages, 'Dark', imported.darkPages, 'cc.BufferAsset');

    setText(this.$.format, manifest.format || '-');
    setText(this.$.alpha, manifest.alphaMode === 'premultiplied' ? '预乘透明' : '非预乘透明');
    const channels = ['Position'];
    if (manifest.channels && manifest.channels.light) channels.push('Light');
    if (manifest.channels && manifest.channels.dark) channels.push('Dark');
    setText(this.$.channels, channels.join(' + '));
    setText(this.$.runtime, manifest.source && `${manifest.source.runtimeFamily} (${manifest.source.spineVersion})` || '-');
    setText(this.$.layouts, (manifest.layouts || []).map((layout) => layout.id).join(', ') || '-');
    setText(this.$.drawCalls, `${compatibility.drawCallsPerBatch || lanes} / 批次`);
    renderClips(this.$.clipList, manifest.clips || []);
    renderWarnings(this, compatibility.warnings || []);
  } catch (error) {
    this.$.error.textContent = `VAT 属性读取失败：${error && error.message || error}`;
    this.$.error.hidden = false;
    console.error('[Spine VAT Inspector]', error);
  }
};

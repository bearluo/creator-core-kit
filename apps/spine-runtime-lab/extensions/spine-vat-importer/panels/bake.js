'use strict';

// 烘焙面板：资源右键「烘焙 Spine VAT…」打开。参数默认值从输出目录里已有的 manifest 读回（产物即参数记录）。
const fs = require('fs');
const path = require('path');

const LOG_PREFIX = '[Spine VAT Bake]';
const request = (...args) => Editor.Message.request(...args);
const sceneScript = (method, ...args) => request('scene', 'execute-scene-script', { name: 'spine-vat-importer', method, args });
const escapeHtml = (text) => String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function urlToPath(url) {
  const relative = url.replace(/^db:\/\/assets\/?/, '');
  if (relative === url) throw new Error(`输出目录要在 db://assets 下：${url}`);
  return path.join(Editor.Project.path, 'assets', ...relative.split('/').filter(Boolean));
}

module.exports = Editor.Panel.define({
  template: `
    <div class="bake">
      <header><b id="title">未选择 Spine 资源</b><div id="notice" class="notice"></div></header>
      <section class="row"><ui-label>输出目录</ui-label><ui-input id="outDir"></ui-input></section>
      <section class="row"><ui-label>Alpha</ui-label><span id="alphaMode"></span></section>
      <section class="row"><ui-label>帧率</ui-label><ui-num-input id="frameRate" min="1" max="120" step="1" preci="0"></ui-num-input></section>
      <section class="group"><div class="head"><span>动画</span><ui-button id="allAnims" class="mini">全选</ui-button><ui-button id="noAnims" class="mini">全不选</ui-button></div>
        <div id="animations" class="list"></div></section>
      <section class="group"><div class="head"><span>Socket 骨骼</span><ui-input id="boneFilter" placeholder="搜索骨骼"></ui-input></div>
        <div id="bones" class="list"></div></section>
      <footer><ui-button id="bake" class="blue">烘焙</ui-button><div id="status"></div></footer>
    </div>`,
  style: `
    .bake { display: flex; flex-direction: column; gap: 8px; padding: 10px; height: 100%; box-sizing: border-box; }
    .row { display: flex; align-items: center; gap: 8px; } .row ui-label { width: 64px; } .row > :last-child { flex: 1; }
    .group { display: flex; flex-direction: column; min-height: 0; flex: 1; }
    .head { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; } .head span { flex: 1; } .head ui-input { flex: 2; }
    .list { overflow-y: auto; border: 1px solid var(--color-normal-border); border-radius: 3px; padding: 4px; flex: 1; min-height: 60px; }
    .list ui-checkbox { display: block; margin: 2px 0; }
    .notice { color: var(--color-warn-fill); margin-top: 4px; white-space: pre-wrap; }
    #status { margin-top: 6px; white-space: pre-wrap; word-break: break-all; }
    #status.error { color: var(--color-danger-fill); }
  `,
  $: {
    title: '#title', notice: '#notice', outDir: '#outDir', alphaMode: '#alphaMode', frameRate: '#frameRate',
    animations: '#animations', allAnims: '#allAnims', noAnims: '#noAnims',
    bones: '#bones', boneFilter: '#boneFilter', bake: '#bake', status: '#status',
  },
  methods: {
    /** 主进程在右键菜单点击时发来要烘的资源。 */
    async setTarget(uuid) {
      if (!uuid) return;
      this.info = await request('asset-db', 'query-asset-info', uuid);
      if (!this.info) return;
      const name = path.basename(this.info.file, path.extname(this.info.file));
      this.$.title.textContent = this.info.url;
      this.$.outDir.value = `${path.posix.dirname(this.info.url)}/${name}-vat`;
      await this.loadDefaults();
    },

    async loadDefaults() {
      this.setStatus('');
      this.$.bake.disabled = true;
      try {
        const described = await sceneScript('describeBakeSource', this.info.uuid, path.join(urlToPath(this.$.outDir.value), 'manifest.spinevat'));
        const { source, options, dropped } = described;
        this.source = source;
        this.selectedAnims = new Set(options.animations);
        this.selectedBones = new Set(options.socketNames);
        this.$.alphaMode.textContent = {
          straight: 'straight（atlas 未声明预乘）',
          premultiplied: 'premultiplied（atlas 声明了 pma: true）',
          unknown: '无法判断（atlas 各页的 pma 声明不一致）',
        }[source.alphaMode];
        this.$.frameRate.value = options.frameRate;
        const notices = [];
        if (source.runtimeError) notices.push(source.runtimeError);
        if (dropped.length) notices.push(`上次烘焙的这些在骨架里已经没有了，已去掉：${dropped.join(', ')}`);
        this.$.notice.textContent = notices.join('\n');
        this.renderAnimations();
        this.renderBones();
        this.$.bake.disabled = Boolean(source.runtimeError);
      } catch (error) {
        this.setStatus(`读取 Spine 失败：${error && error.message || error}`, true);
      }
    },

    renderAnimations() {
      this.$.animations.innerHTML = this.source.animations
        .map((name) => `<ui-checkbox data-name="${escapeHtml(name)}" ${this.selectedAnims.has(name) ? 'value="true"' : ''}>${escapeHtml(name)}</ui-checkbox>`)
        .join('');
    },

    renderBones() {
      const filter = (this.$.boneFilter.value || '').toLowerCase();
      // 已选的始终排前面，不被搜索过滤掉
      const bones = this.source.bones.filter((name) => this.selectedBones.has(name) || name.toLowerCase().includes(filter));
      bones.sort((a, b) => Number(this.selectedBones.has(b)) - Number(this.selectedBones.has(a)));
      this.$.bones.innerHTML = bones
        .map((name) => `<ui-checkbox data-name="${escapeHtml(name)}" ${this.selectedBones.has(name) ? 'value="true"' : ''}>${escapeHtml(name)}</ui-checkbox>`)
        .join('');
    },

    setStatus(text, error = false) {
      this.$.status.textContent = text;
      this.$.status.classList.toggle('error', error);
    },

    async bake() {
      const options = {
        frameRate: Number(this.$.frameRate.value),
        animations: this.source.animations.filter((name) => this.selectedAnims.has(name)),
        socketNames: this.source.bones.filter((name) => this.selectedBones.has(name)),
      };
      const outUrl = this.$.outDir.value.replace(/\/+$/, '');
      this.$.bake.disabled = true;
      this.setStatus('烘焙中…');
      console.log(`${LOG_PREFIX} ${this.info.url} → ${outUrl} ${JSON.stringify(options)}`);
      try {
        const outDir = urlToPath(outUrl);
        const { manifest, summary } = await sceneScript('bake', this.info.uuid, options, outDir, path.dirname(this.info.file));
        // 先导入 .bin 与图集，再写 manifest：导入器要读到图集的 Texture2D 子资源。
        await request('asset-db', 'refresh-asset', outUrl);
        fs.writeFileSync(path.join(outDir, 'manifest.spinevat'), manifest);
        await request('asset-db', 'refresh-asset', `${outUrl}/manifest.spinevat`);
        this.setStatus(`完成：${outUrl}/manifest.spinevat\n${summary}`);
        console.log(`${LOG_PREFIX} 完成 ${outUrl}/manifest.spinevat ${summary}`);
      } catch (error) {
        this.setStatus(`失败：${error && error.message || error}`, true);
        console.error(`${LOG_PREFIX} 失败 ${this.info.url}`, error);
      } finally {
        this.$.bake.disabled = false;
      }
    },
  },

  async ready() {
    const toggle = (set) => (event) => {
      const name = event.target.getAttribute && event.target.getAttribute('data-name');
      if (!name) return;
      if (event.target.value) set().add(name);
      else set().delete(name);
    };
    this.$.animations.addEventListener('change', toggle(() => this.selectedAnims));
    this.$.bones.addEventListener('change', toggle(() => this.selectedBones));
    this.$.allAnims.addEventListener('confirm', () => { this.selectedAnims = new Set(this.source.animations); this.renderAnimations(); });
    this.$.noAnims.addEventListener('confirm', () => { this.selectedAnims = new Set(); this.renderAnimations(); });
    this.$.boneFilter.addEventListener('change', () => this.renderBones());
    this.$.outDir.addEventListener('confirm', () => this.info && this.loadDefaults());
    this.$.bake.addEventListener('confirm', () => this.bake());
    this.$.bake.disabled = true;
    await this.setTarget(await request('spine-vat-importer', 'query-bake-target'));
  },
});

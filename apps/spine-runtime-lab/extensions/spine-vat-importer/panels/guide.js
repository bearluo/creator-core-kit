'use strict';

// 新手指导：菜单「扩展 → Spine VAT 新手指导」打开；装好扩展后第一次启动编辑器自动弹一次。
const STEPS = [
  {
    title: '这是什么',
    body: `
      <p>把 Spine 动画<b>预先烘焙成贴图</b>（VAT，顶点动画贴图），运行时只用一个 shader 按时间取顶点，CPU 不再逐帧算骨骼。</p>
      <ul>
        <li><b>适合</b>：同屏大量重复、动画固定的 Spine，比如背景人群、特效小人；几百个实例也能满帧。</li>
        <li><b>支持</b>：剪裁（clipping）、多种混合模式、事件回调、挂点（socket）、帧间插值。</li>
        <li><b>不支持</b>：运行时换装、动画混合（crossfade）、实时改骨骼——这些要在烘焙时定死。需要它们的角色继续用官方 <code>sp.Skeleton</code>。</li>
      </ul>
      <p>整个流程三步：<b>烘焙 → 挂组件 → 脚本控制</b>。点「下一步」逐个看。</p>`,
  },
  {
    title: '准备',
    body: `
      <ul>
        <li>Spine 资源要是 <b>Spine 4.2 导出的 JSON</b>（不支持 <code>.skel</code>），<code>.json</code>、<code>.atlas</code> 和图集 PNG 放在同一个目录。</li>
        <li>烘焙所在的工程要在<b>项目设置 → 功能裁剪 → Spine</b> 里选 <b>4.2</b>，改完重启编辑器。新建工程默认是 3.8，这时烘焙面板会直接提示。</li>
        <li><b>播放不依赖 Spine 模块</b>：游戏工程必须留在 3.8 的话，换一个 4.2 的工程烘焙，把产物目录拷过来即可。</li>
        <li>烘焙时编辑器里要打开着一个场景（烘焙用的临时节点挂在它下面，不存盘、不显示）。</li>
      </ul>`,
  },
  {
    title: '烘焙',
    body: `
      <p>资源管理器里<b>右键 Spine 的 .json → 烘焙 Spine VAT…</b>，打开烘焙面板：</p>
      <ul>
        <li><b>输出目录</b>：默认同目录的 <code>&lt;名&gt;-vat/</code>。</li>
        <li><b>Alpha</b>：自动判断，不用选——<code>.atlas</code> 里写了 <code>pma: true</code>（导出时勾了「Premultiply alpha」）就按预乘处理，否则按 straight。</li>
        <li><b>帧率</b>：默认 30；运行时帧间插值，30 通常就够平滑。</li>
        <li><b>动画</b>：只勾会用到的，省贴图。</li>
        <li><b>Socket 骨骼</b>：要在运行时挂东西（武器、特效、血条）的骨骼才勾，<b>不勾的骨骼运行时取不到</b>。挂法见下一步的 Sockets 属性。</li>
      </ul>
      <p>点「烘焙」后产物自动导入，<code>manifest.spinevat</code> 就是要用的资源。再次打开面板会自动带上次的参数。</p>`,
  },
  {
    title: '挂组件',
    body: `
      <p><b>最快</b>：把 <code>manifest.spinevat</code> 拖到<b>层级管理器</b>里，自动建一个 2D 节点并挂好组件、选好第一段动画。</p>
      <p>也可以手动给节点添加组件：</p>
      <ul>
        <li><b>Spine/VAT UI Skeleton</b>（2D）：放在 Canvas 下，节点层级要是 <code>UI_2D</code>。和 Sprite、官方 Spine 按兄弟顺序穿插和遮挡；每 48 个相邻实例合成一批。</li>
        <li><b>Spine/VAT Skeleton</b>（3D）：普通 3D 节点，GPU Instancing，实例再多也只有几个 Draw Call；同一节点不要再挂别的 Renderer。</li>
      </ul>
      <p>组件属性：<b>Skeleton Data</b>（拖 manifest）、<b>Initial Clip</b>（初始动画）、<b>Loop</b>、<b>Time Scale</b>、<b>Preview In Editor</b>（编辑器里直接播放）、<b>Sockets</b>（挂点：填烘焙时勾过的骨骼名，Target 拖一个放在 VAT 节点下面的子节点，它会每帧跟着骨骼动，用来挂武器、特效、血条）。</p>
      <p>同一份资源可以给任意多个节点用，贴图和材质共享，每个节点的播放状态互不影响。</p>`,
  },
  {
    title: '脚本控制',
    body: `
      <pre>import { SpineVatUiSkeleton } from 'db://spine-vat-importer/runtime/SpineVatUiSkeleton';
// 3D 用 SpineVatSkeleton（runtime/SpineVatSkeleton），接口相同

const vat = node.getComponent(SpineVatUiSkeleton)!;
vat.play('run', { loop: true, speed: 1 });
vat.pause();  vat.resume();  vat.seek(0.5);
vat.setTimeScale(0.8);
vat.setColor([1, 0.5, 0.5, 1]);       // RGBA 0~1
vat.setManualFrame(12);               // 定格到第 12 帧，传 null 恢复

const off = vat.onVatEvent((e) => console.log(e.clip, e.name));  // Spine 事件
off();                                // 取消监听

const m = vat.socket('hand');         // [a, b, c, d, x, y]，只有烘焙时勾过的骨骼才有；只想挂节点用 Sockets 属性就够了
const s = vat.snapshot();             // 当前动画、帧、循环、速度、是否暂停等</pre>
      <p>监听挂在组件上，换资源、重新加载后照样有效。</p>`,
  },
  {
    title: '注意事项',
    body: `
      <ul>
        <li><b>改了 Spine 源文件要重新烘焙</b>，产物不会自动更新。</li>
        <li>过不了「固定槽位」规则的动画会在烘焙时报错并写明是哪段、为什么，按提示调整 Spine 资源。</li>
        <li>低端机想再省 GPU：创建实例前设 <code>SpineVatUiSkeleton.interpolate = false</code>（3D 同理）关掉帧间插值。</li>
        <li>启动时控制台提示 <code>contribution.importer 已在 3.8.3 版本废弃</code> 可以忽略，不要改扩展的 package.json。</li>
        <li>完整说明见扩展目录里的 <code>README.md</code>。菜单「扩展 → Spine VAT 新手指导」随时可以再打开这里。</li>
      </ul>`,
  },
];

module.exports = Editor.Panel.define({
  template: `
    <div class="guide">
      <nav id="dots"></nav>
      <h2 id="title"></h2>
      <article id="body"></article>
      <footer>
        <ui-button id="prev">上一步</ui-button>
        <span id="count"></span>
        <ui-button id="next" class="blue">下一步</ui-button>
      </footer>
    </div>`,
  style: `
    .guide { display: flex; flex-direction: column; height: 100%; padding: 14px 18px; box-sizing: border-box; }
    nav { display: flex; gap: 6px; flex-wrap: wrap; }
    nav span { cursor: pointer; padding: 2px 8px; border-radius: 10px; background: var(--color-normal-fill-emphasis); font-size: 12px; }
    nav span.on { background: var(--color-primary-fill); color: var(--color-primary-contrast); }
    h2 { margin: 14px 0 6px; font-size: 18px; }
    article { flex: 1; overflow-y: auto; line-height: 1.7; }
    article li { margin: 4px 0; }
    code, pre { font-family: Consolas, monospace; background: var(--color-normal-fill-emphasis); border-radius: 3px; }
    code { padding: 0 4px; }
    pre { padding: 10px; white-space: pre; overflow-x: auto; font-size: 12px; line-height: 1.5; }
    footer { display: flex; align-items: center; gap: 10px; padding-top: 10px; }
    footer #count { flex: 1; text-align: center; opacity: 0.7; }
  `,
  $: { dots: '#dots', title: '#title', body: '#body', prev: '#prev', next: '#next', count: '#count' },
  methods: {
    show(index) {
      this.index = Math.max(0, Math.min(STEPS.length - 1, index));
      const step = STEPS[this.index];
      this.$.title.textContent = `${this.index + 1}. ${step.title}`;
      this.$.body.innerHTML = step.body;
      this.$.body.scrollTop = 0;
      this.$.count.textContent = `${this.index + 1} / ${STEPS.length}`;
      this.$.prev.disabled = this.index === 0;
      this.$.next.textContent = this.index === STEPS.length - 1 ? '完成' : '下一步';
      for (const [i, dot] of Array.from(this.$.dots.children).entries()) dot.classList.toggle('on', i === this.index);
    },
  },
  ready() {
    this.$.dots.innerHTML = STEPS.map((step, i) => `<span data-index="${i}">${i + 1} ${step.title}</span>`).join('');
    this.$.dots.addEventListener('click', (event) => {
      const index = event.target.getAttribute && event.target.getAttribute('data-index');
      if (index !== null && index !== undefined) this.show(Number(index));
    });
    this.$.prev.addEventListener('confirm', () => this.show(this.index - 1));
    this.$.next.addEventListener('confirm', () => {
      if (this.index === STEPS.length - 1) Editor.Panel.close('spine-vat-importer.guide');
      else this.show(this.index + 1);
    });
    this.show(0);
  },
});

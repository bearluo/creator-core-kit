import { ImageAsset, Node, sp, Texture2D, Vec3 } from 'cc';
import { analyzeSpineVatSkeletonData } from './SpineVatAnalyzer';
import { bakeAndCompileSpineVatV2, type CompiledSpineVatV2 } from './SpineVatCompilerV2';
import { SpineVatPopulationV2 } from './SpineVatRendererV2';
import type { SpineVatAlphaMode, SpineVatAnalysisReport } from './SpineVatTypes';
import {
  createSpineVatZip,
  sanitizeSpineVatPackageName,
  type SpineVatZipEntry,
} from './SpineVatZip';

interface AtlasUpload {
  atlasName: string;
  file: File;
}

interface WorkbenchSource {
  name: string;
  json: Record<string, any>;
  jsonFile: File;
  atlasFile: File;
  atlasText: string;
  atlasUploads: AtlasUpload[];
  textures: Texture2D[];
  imageAssets: ImageAsset[];
  objectUrls: string[];
  skeletonData: sp.SkeletonData;
}

function byId<T extends HTMLElement>(root: HTMLElement, id: string): T {
  const element = root.querySelector<T>(`#${id}`);
  if (!element) throw new Error(`VAT workbench element not found: ${id}`);
  return element;
}

function fileBaseName(path: string): string {
  return path.replace(/\\/g, '/').split('/').pop() ?? path;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function atlasPageNames(atlasText: string, imageFiles: readonly File[]): string[] {
  const lines = atlasText.replace(/\r/g, '').split('\n');
  const detected: Array<{ name: string; line: number }> = [];
  for (let index = 0; index < lines.length; index += 1) {
    const name = lines[index].trim();
    if (!name || name.includes(':')) continue;
    let next = index + 1;
    while (next < lines.length && !lines[next].trim()) next += 1;
    if (/^size\s*:/i.test(lines[next]?.trim() ?? '')) detected.push({ name, line: index });
  }
  if (detected.length > 0) return detected.map((entry) => entry.name);

  return imageFiles.map((file) => {
    const name = fileBaseName(file.name);
    const pattern = new RegExp(`^\\s*(?:.*[/\\\\])?${escapeRegExp(name)}\\s*$`, 'mi');
    const match = pattern.exec(atlasText);
    return { name, index: match?.index ?? Number.MAX_SAFE_INTEGER };
  }).filter((entry) => entry.index < Number.MAX_SAFE_INTEGER)
    .sort((left, right) => left.index - right.index)
    .map((entry) => entry.name);
}

function matchAtlasImages(pageNames: readonly string[], imageFiles: readonly File[]): AtlasUpload[] {
  return pageNames.map((atlasName) => {
    const base = fileBaseName(atlasName).toLowerCase();
    const file = imageFiles.find((candidate) => fileBaseName(candidate.name).toLowerCase() === base);
    if (!file) throw new Error(`Atlas 纹理页缺失：${atlasName}`);
    return { atlasName, file };
  });
}

async function loadTexture(file: File): Promise<{
  texture: Texture2D;
  imageAsset: ImageAsset;
  objectUrl: string;
}> {
  const objectUrl = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = 'async';
  image.src = objectUrl;
  try {
    if (typeof image.decode === 'function') await image.decode();
    else await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error(`图片解码失败：${file.name}`));
    });
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
  const imageAsset = new ImageAsset(image);
  const texture = new Texture2D();
  texture.image = imageAsset;
  return { texture, imageAsset, objectUrl };
}

function inferAtlasAlpha(atlasText: string): Exclude<SpineVatAlphaMode, 'unknown'> | null {
  const values: string[] = [];
  const pattern = /^\s*pma\s*:\s*(true|false)\s*$/gim;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(atlasText)) !== null) values.push(match[1]);
  if (values.length === 0) return null;
  if (values.every((value) => value === 'true')) return 'premultiplied';
  if (values.every((value) => value === 'false')) return 'straight';
  return null;
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function creatorUsage(packageName: string): string {
  return `# ${packageName} - Spine VAT 资源

1. 将整个 \`${packageName}\` 文件夹拖入 Creator 3.8.7 项目的 \`assets/\`。
2. 如果项目尚未安装 Runtime，请点击“下载 CC 组件”，将压缩包中的 \`assets/\` 和 \`extensions/\` 合并到 Creator 工程根目录。
3. 等待 Creator 导入完成；\`manifest.spinevat\` 的资源类型应显示为 \`SpineVatAsset\`。若无法识别，请检查 \`spine-vat-importer\` 扩展是否启用。
4. 创建节点并添加 \`SpineVatComponent\`，只需把 \`manifest.spinevat\` 拖入 \`Vat Asset\`。position/light/dark、atlas 图片与 Effect 由主资源自动关联，编辑模式会直接预览。
5. 代码使用同一个主资源：

\`\`\`ts
const population = await SpineVatPopulationV2.createFromVatAsset(
  parentNode,
  vatAsset,
  20,
);

population.instances[0].play(population.manifest.clips[0].name, {
  loop: true,
  speed: 1,
});
\`\`\`

资源格式：spine-vat-2。VAT 文件在 Web 工具中离线生成，Web/Android 运行时只负责加载。
`;
}

export class SpineVatWorkbench {
  private readonly previewRoot: Node;
  private rootElement!: HTMLDivElement;
  private styleElement: HTMLStyleElement | null = null;
  private source: WorkbenchSource | null = null;
  private analysis: SpineVatAnalysisReport | null = null;
  private compiled: CompiledSpineVatV2 | null = null;
  private officialNode: Node | null = null;
  private officialSkeleton: sp.Skeleton | null = null;
  private vatPopulation: SpineVatPopulationV2 | null = null;
  private busy = false;
  private paused = false;
  private previewScale = 0.5;
  private previewCenter: [number, number] = [0, 0];

  constructor(private readonly parent: Node) {
    this.previewRoot = new Node('VAT-Workbench-Preview');
    this.previewRoot.parent = parent;
  }

  start(): void {
    this.installUi();
    this.setStatus('等待上传 Spine JSON、atlas 和全部纹理页', 'idle');
  }

  update(): void {
    this.vatPopulation?.updateHybrid();
  }

  destroy(): void {
    this.rootElement?.remove();
    this.styleElement?.remove();
    this.styleElement = null;
    this.clearPreview();
    this.releaseSource();
    this.previewRoot.destroy();
  }

  private installUi(): void {
    const style = document.createElement('style');
    style.id = 'spine-vat-workbench-style';
    style.textContent = `
      :root { --vat-ink:#15211f; --vat-paper:#f5f0e5; --vat-moss:#2f6953; --vat-coral:#ef6a4b; --vat-line:#cfc6b5; }
      body { background:radial-gradient(circle at 75% 20%,#263c36 0,#101817 54%,#080d0c 100%)!important; }
      .vat-workbench { position:fixed; inset:0; z-index:20; color:var(--vat-ink); font-family:"Microsoft YaHei","Trebuchet MS",sans-serif; pointer-events:none; }
      .vat-brand { position:absolute; left:28px; top:22px; display:flex; align-items:center; gap:12px; color:#f8f1e5; letter-spacing:.02em; }
      .vat-brand b { font:700 21px Georgia,"Microsoft YaHei",serif; }
      .vat-brand em { font-style:normal; font-size:11px; letter-spacing:.18em; color:#9fc8b8; }
      .vat-panel { pointer-events:auto; position:absolute; left:24px; top:70px; bottom:22px; width:352px; overflow:auto; padding:18px; border:1px solid rgba(255,255,255,.22); border-radius:18px; background:linear-gradient(145deg,rgba(250,246,237,.97),rgba(232,225,211,.94)); box-shadow:0 24px 60px rgba(0,0,0,.34); }
      .vat-panel::-webkit-scrollbar { width:7px; }.vat-panel::-webkit-scrollbar-thumb { background:#9ca99f; border-radius:8px; }
      .vat-section { padding:0 0 16px; margin:0 0 16px; border-bottom:1px solid var(--vat-line); }
      .vat-section:last-child { border-bottom:0; margin-bottom:0; }
      .vat-kicker { margin:0 0 7px; color:var(--vat-coral); font-size:10px; font-weight:800; letter-spacing:.18em; text-transform:uppercase; }
      .vat-title { margin:0 0 11px; font:700 18px Georgia,"Microsoft YaHei",serif; }
      .vat-drop { display:block; padding:20px 14px; border:1.5px dashed #7f988d; border-radius:13px; text-align:center; background:rgba(255,255,255,.45); cursor:pointer; transition:.2s; }
      .vat-drop:hover,.vat-drop.is-over { border-color:var(--vat-coral); background:#fff7ef; transform:translateY(-1px); }
      .vat-drop strong { display:block; font-size:14px; }.vat-drop span { display:block; margin-top:6px; color:#64716d; font-size:11px; line-height:1.5; }
      .vat-grid { display:grid; grid-template-columns:1fr 1fr; gap:9px; }
      .vat-field { display:flex; flex-direction:column; gap:5px; font-size:11px; color:#52615c; }
      .vat-field.wide { grid-column:1/-1; }
      .vat-field input,.vat-field select { width:100%; box-sizing:border-box; border:1px solid #bcb4a4; border-radius:8px; padding:8px 9px; background:#fffdf8; color:var(--vat-ink); outline:none; }
      .vat-field input:focus,.vat-field select:focus { border-color:var(--vat-moss); box-shadow:0 0 0 2px rgba(47,105,83,.13); }
      .vat-anims { display:grid; gap:5px; max-height:130px; overflow:auto; padding:7px; border:1px solid #cbc3b5; border-radius:9px; background:#fffdf8; }
      .vat-anims label { display:flex; gap:7px; align-items:center; font-size:11px; color:#30413c; }
      .vat-actions { display:flex; gap:8px; }
      .vat-btn { flex:1; border:0; border-radius:10px; padding:10px 12px; cursor:pointer; font-weight:750; color:white; background:var(--vat-moss); box-shadow:0 6px 14px rgba(47,105,83,.2); }
      .vat-btn.alt { color:var(--vat-ink); background:#ddd5c7; box-shadow:none; }.vat-btn.export { background:var(--vat-coral); }
      .vat-runtime-download { width:100%; margin-top:8px; }
      .vat-btn:disabled { opacity:.42; cursor:not-allowed; transform:none; }
      .vat-status { display:flex; gap:9px; align-items:flex-start; padding:10px; border-radius:10px; background:#e6e0d4; font-size:11px; line-height:1.45; white-space:pre-wrap; }
      .vat-status::before { content:""; flex:0 0 8px; height:8px; margin-top:4px; border-radius:50%; background:#8d958f; }
      .vat-status.busy::before { background:#e59a31; box-shadow:0 0 0 5px rgba(229,154,49,.16); animation:vat-pulse 1s infinite; }
      .vat-status.ok::before { background:#3c8b69; }.vat-status.error::before { background:#d84f45; }
      @keyframes vat-pulse { 50% { opacity:.35; } }
      .vat-report { display:grid; grid-template-columns:repeat(2,1fr); gap:7px; margin-top:10px; }
      .vat-metric { padding:9px; border-radius:9px; background:rgba(255,255,255,.58); }.vat-metric b { display:block; font:700 17px Georgia,serif; }.vat-metric span { color:#6c7672; font-size:10px; }
      .vat-warnings { margin:9px 0 0; padding-left:16px; max-height:100px; overflow:auto; color:#8b4e3d; font-size:10px; line-height:1.5; }
      .vat-preview-labels { position:absolute; pointer-events:none; left:400px; right:25px; top:78px; display:grid; grid-template-columns:1fr 1fr; gap:20px; color:#dce9e3; text-align:center; font-size:11px; letter-spacing:.12em; }
      .vat-preview-labels span { padding:7px 11px; border-top:1px solid rgba(255,255,255,.25); }
      .vat-playbar { pointer-events:auto; position:absolute; left:430px; right:45px; bottom:28px; display:flex; align-items:center; gap:10px; padding:11px 14px; border:1px solid rgba(255,255,255,.2); border-radius:13px; background:rgba(11,20,18,.78); color:#dce9e3; backdrop-filter:blur(9px); }
      .vat-playbar select,.vat-playbar input { min-width:0; accent-color:var(--vat-coral); }.vat-playbar select { max-width:260px; padding:6px; border-radius:7px; background:#f5f0e5; }
      .vat-playbar input[type=range] { flex:1; }.vat-playbar button { border:0; border-radius:8px; padding:7px 12px; background:#e7ded0; cursor:pointer; }
      .vat-playbar small { min-width:52px; color:#9fc8b8; }
      @media (max-width:760px) {
        .vat-brand { left:16px; top:14px; }.vat-brand em,.vat-preview-labels { display:none; }
        .vat-panel { left:10px; right:10px; top:54px; bottom:76px; width:auto; padding:14px; }
        .vat-playbar { left:10px; right:10px; bottom:10px; padding:8px; gap:7px; }
        .vat-playbar select { max-width:145px; }.vat-playbar small { min-width:34px; }
      }
    `;
    document.head.appendChild(style);
    this.styleElement = style;

    this.rootElement = document.createElement('div');
    this.rootElement.className = 'vat-workbench';
    this.rootElement.innerHTML = `
      <div class="vat-brand"><b>Spine VAT Forge</b><em>CREATOR 3.8.7 / SPINE 4.2</em></div>
      <aside class="vat-panel">
        <section class="vat-section">
          <p class="vat-kicker">01 / Source</p><h2 class="vat-title">上传 Spine 资源</h2>
          <label class="vat-drop" id="vat-drop"><strong>拖入资源文件</strong><span>一个 .json、一个 .atlas，以及 atlas 引用的全部 PNG/JPG/WebP</span><input id="vat-files" type="file" multiple accept=".json,.atlas,.png,.jpg,.jpeg,.webp" hidden></label>
          <div id="vat-source-summary" style="margin-top:9px;font-size:11px;line-height:1.55;color:#52615c"></div>
        </section>
        <section class="vat-section">
          <p class="vat-kicker">02 / Recipe</p><h2 class="vat-title">转换参数</h2>
          <div class="vat-grid">
            <label class="vat-field"><span>采样 FPS</span><select id="vat-fps"><option>15</option><option>24</option><option selected>30</option><option>60</option></select></label>
            <label class="vat-field"><span>Alpha</span><select id="vat-alpha"><option value="auto">Atlas 自动</option><option value="straight">Straight</option><option value="premultiplied">PMA</option></select></label>
            <label class="vat-field"><span>最大纹理</span><select id="vat-texture-size"><option>2048</option><option selected>4096</option><option>8192</option></select></label>
            <label class="vat-field"><span>纹理预算 MB</span><input id="vat-budget" type="number" min="1" max="512" value="64"></label>
            <label class="vat-field wide"><span>导出 socket（骨骼名，逗号分隔）</span><input id="vat-sockets" placeholder="例如: hand_r, fx_socket"></label>
            <div class="vat-field wide"><span>动画</span><div class="vat-anims" id="vat-animations"><span>上传后显示</span></div></div>
          </div>
        </section>
        <section class="vat-section">
          <p class="vat-kicker">03 / Build</p><div class="vat-actions"><button class="vat-btn" id="vat-build" disabled>分析并生成</button><button class="vat-btn export" id="vat-export" disabled>下载 Creator 包</button></div>
          <button class="vat-btn alt vat-runtime-download" id="vat-runtime">下载 CC 组件</button>
          <div id="vat-status" class="vat-status" style="margin-top:11px"></div><div id="vat-report"></div>
        </section>
      </aside>
      <div class="vat-preview-labels"><span>OFFICIAL SPINE RUNTIME</span><span>VAT OUTPUT</span></div>
      <div class="vat-playbar" id="vat-playbar" style="display:none"><select id="vat-preview-clip"></select><button id="vat-play">暂停</button><input id="vat-frame" type="range" min="0" max="1" value="0"><small id="vat-frame-label">AUTO</small></div>
    `;
    document.body.appendChild(this.rootElement);

    const input = byId<HTMLInputElement>(this.rootElement, 'vat-files');
    const drop = byId<HTMLElement>(this.rootElement, 'vat-drop');
    input.addEventListener('change', () => void this.acceptFiles(Array.from(input.files ?? [])));
    drop.addEventListener('dragover', (event) => {
      event.preventDefault();
      drop.classList.add('is-over');
    });
    drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
    drop.addEventListener('drop', (event) => {
      event.preventDefault();
      drop.classList.remove('is-over');
      void this.acceptFiles(Array.from(event.dataTransfer?.files ?? []));
    });
    byId<HTMLButtonElement>(this.rootElement, 'vat-build').addEventListener('click', () => void this.build());
    byId<HTMLButtonElement>(this.rootElement, 'vat-export').addEventListener('click', () => void this.exportPackage());
    byId<HTMLButtonElement>(this.rootElement, 'vat-runtime').addEventListener('click', () => void this.downloadRuntime());
    byId<HTMLSelectElement>(this.rootElement, 'vat-preview-clip').addEventListener('change', (event) => {
      this.setPreviewClip((event.currentTarget as HTMLSelectElement).value);
    });
    byId<HTMLButtonElement>(this.rootElement, 'vat-play').addEventListener('click', () => this.togglePreview());
    byId<HTMLInputElement>(this.rootElement, 'vat-frame').addEventListener('input', (event) => {
      this.setPreviewFrame(Number((event.currentTarget as HTMLInputElement).value));
    });
  }

  private async acceptFiles(files: File[]): Promise<void> {
    if (this.busy || files.length === 0) return;
    this.setBusy(true);
    this.setStatus('正在读取并校验资源...', 'busy');
    let pendingTextures: Awaited<ReturnType<typeof loadTexture>>[] = [];
    let pendingSkeletonData: sp.SkeletonData | null = null;
    try {
      const jsonFile = files.find((file) => file.name.toLowerCase().endsWith('.json'));
      const atlasFile = files.find((file) => file.name.toLowerCase().endsWith('.atlas'));
      const imageFiles = files.filter((file) => /\.(png|jpe?g|webp)$/i.test(file.name));
      if (!jsonFile) throw new Error('缺少 Spine JSON 文件');
      if (!atlasFile) throw new Error('缺少 .atlas 文件');
      if (imageFiles.length === 0) throw new Error('缺少 atlas 纹理图片');

      const [jsonText, atlasText] = await Promise.all([jsonFile.text(), atlasFile.text()]);
      const json = JSON.parse(jsonText) as Record<string, any>;
      const spineVersion = String(json.skeleton?.spine ?? '');
      if (!/^4\.2(?:\.|$)/.test(spineVersion)) {
        throw new Error(`仅支持 Spine 4.2 JSON，当前文件版本为 ${spineVersion || 'unknown'}`);
      }
      const pages = atlasPageNames(atlasText, imageFiles);
      if (pages.length === 0) throw new Error('无法从 atlas 中识别纹理页');
      const atlasUploads = matchAtlasImages(pages, imageFiles);
      const loaded: Awaited<ReturnType<typeof loadTexture>>[] = [];
      pendingTextures = loaded;
      for (const upload of atlasUploads) loaded.push(await loadTexture(upload.file));
      const skeletonData = new sp.SkeletonData();
      pendingSkeletonData = skeletonData;
      // Creator's declaration uses the parsed runtime type, while the web importer accepts raw Spine JSON.
      (skeletonData as any).skeletonJson = json;
      skeletonData.atlasText = atlasText;
      skeletonData.textureNames = atlasUploads.map((upload) => upload.atlasName);
      skeletonData.textures = loaded.map((entry) => entry.texture);

      this.clearPreview();
      this.releaseSource();
      const sourceName = sanitizeSpineVatPackageName(jsonFile.name.replace(/\.json$/i, ''));
      this.source = {
        name: sourceName,
        json,
        jsonFile,
        atlasFile,
        atlasText,
        atlasUploads,
        textures: loaded.map((entry) => entry.texture),
        imageAssets: loaded.map((entry) => entry.imageAsset),
        objectUrls: loaded.map((entry) => entry.objectUrl),
        skeletonData,
      };
      pendingTextures = [];
      pendingSkeletonData = null;
      this.analysis = null;
      this.compiled = null;
      this.populateAnimations(Object.keys(json.animations ?? {}));
      this.showSourceSummary();
      this.createOfficialPreview(Object.keys(json.animations ?? {})[0]);
      byId<HTMLButtonElement>(this.rootElement, 'vat-build').disabled = false;
      byId<HTMLButtonElement>(this.rootElement, 'vat-export').disabled = true;
      this.setStatus('资源加载成功。选择动画和参数后开始转换。', 'ok');
    } catch (error) {
      pendingSkeletonData?.destroy();
      for (const entry of pendingTextures) {
        entry.texture.destroy();
        entry.imageAsset.destroy();
        URL.revokeObjectURL(entry.objectUrl);
      }
      this.setStatus(String(error instanceof Error ? error.message : error), 'error');
    } finally {
      this.setBusy(false);
    }
  }

  private populateAnimations(names: string[]): void {
    const container = byId<HTMLElement>(this.rootElement, 'vat-animations');
    container.replaceChildren();
    for (const name of names) {
      const label = document.createElement('label');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = name;
      checkbox.checked = true;
      label.append(checkbox, document.createTextNode(name));
      container.appendChild(label);
    }
    if (names.length === 0) container.textContent = '没有动画';
  }

  private selectedAnimations(): string[] {
    return Array.from(
      this.rootElement.querySelectorAll<HTMLInputElement>('#vat-animations input:checked'),
      (input) => input.value,
    );
  }

  private showSourceSummary(): void {
    const source = this.source!;
    const skeleton = source.json.skeleton ?? {};
    const inferredAlpha = inferAtlasAlpha(source.atlasText);
    byId<HTMLElement>(this.rootElement, 'vat-source-summary').textContent = [
      `${source.name} · Spine ${skeleton.spine ?? 'unknown'}`,
      `${Object.keys(source.json.animations ?? {}).length} 动画 · ${source.atlasUploads.length} 纹理页`,
      `${(source.json.bones ?? []).length} bones · ${(source.json.slots ?? []).length} slots`,
      `Alpha: ${inferredAlpha ?? 'atlas 未声明，请手动选择'}`,
    ].join('\n');
  }

  private resolvedAlphaMode(): Exclude<SpineVatAlphaMode, 'unknown'> {
    const value = byId<HTMLSelectElement>(this.rootElement, 'vat-alpha').value;
    if (value === 'straight' || value === 'premultiplied') return value;
    const inferred = inferAtlasAlpha(this.source!.atlasText);
    if (!inferred) throw new Error('Atlas 没有一致的 pma 声明，请手动选择 Straight 或 PMA');
    return inferred;
  }

  private async build(): Promise<void> {
    if (!this.source || this.busy) return;
    const animations = this.selectedAnimations();
    if (animations.length === 0) {
      this.setStatus('至少选择一个动画', 'error');
      return;
    }
    this.setBusy(true);
    byId<HTMLButtonElement>(this.rootElement, 'vat-export').disabled = true;
    try {
      const fps = Number(byId<HTMLSelectElement>(this.rootElement, 'vat-fps').value);
      const maxTextureSize = Number(byId<HTMLSelectElement>(this.rootElement, 'vat-texture-size').value);
      const maxTextureBytes = Number(byId<HTMLInputElement>(this.rootElement, 'vat-budget').value) * 1024 * 1024;
      const socketNames = byId<HTMLInputElement>(this.rootElement, 'vat-sockets').value
        .split(',').map((name) => name.trim()).filter(Boolean);
      const alphaMode = this.resolvedAlphaMode();
      this.setStatus(`正在分析 ${animations.length} 个动画的拓扑、材质和显存预算...`, 'busy');
      this.analysis = await analyzeSpineVatSkeletonData(this.previewRoot, this.source.skeletonData, {
        animations,
        frameRate: fps,
        alphaMode,
        textureProfile: 'exact',
        budget: { maxTextureSize, maxTextureBytes },
      });
      if (this.analysis.compatibility.level === 'RUNTIME_FALLBACK') {
        this.renderReport();
        throw new Error('分析结果要求回退官方 Runtime，请检查警告或提高预算');
      }

      this.setStatus('分析通过，正在采集官方 Spine Runtime 最终几何...', 'busy');
      this.compiled = await bakeAndCompileSpineVatV2(
        this.previewRoot,
        this.source.skeletonData,
        this.analysis,
        { maxTextureSize, socketNames },
      );
      await this.createVatPreview();
      this.renderReport();
      byId<HTMLButtonElement>(this.rootElement, 'vat-export').disabled = false;
      this.setStatus('转换完成。请对比预览，确认后下载 Creator 资源包。', 'ok');
    } catch (error) {
      this.setStatus(String(error instanceof Error ? error.message : error), 'error');
    } finally {
      this.setBusy(false);
    }
  }

  private renderReport(): void {
    if (!this.analysis) return;
    const report = byId<HTMLElement>(this.rootElement, 'vat-report');
    const compiled = this.compiled;
    const bytes = compiled?.textureBytes ?? this.analysis.compatibility.estimatedGpuBytes;
    report.innerHTML = `
      <div class="vat-report">
        <div class="vat-metric"><b>${this.analysis.compatibility.level}</b><span>兼容等级</span></div>
        <div class="vat-metric"><b>${(bytes / 1024 / 1024).toFixed(2)} MB</b><span>VAT 精确数据</span></div>
        <div class="vat-metric"><b>${compiled?.manifest.layouts[0]?.lanes.length ?? this.analysis.compatibility.drawCallsPerBatch}</b><span>Render Lanes</span></div>
        <div class="vat-metric"><b>${this.analysis.clips.length}</b><span>已选动画</span></div>
      </div>
    `;
    const warnings = this.analysis.compatibility.warnings.slice(0, 12);
    if (warnings.length > 0) {
      const list = document.createElement('ul');
      list.className = 'vat-warnings';
      for (const warning of warnings) {
        const item = document.createElement('li');
        item.textContent = warning;
        list.appendChild(item);
      }
      report.appendChild(list);
    }
  }

  private createOfficialPreview(animation?: string): void {
    if (!this.source || !animation) return;
    this.officialNode?.destroy();
    const bounds = this.sourceBounds();
    this.previewCenter = [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2];
    this.previewScale = Math.min(0.85, 310 / Math.max(1, bounds[2] - bounds[0]), 430 / Math.max(1, bounds[3] - bounds[1]));
    const node = new Node('Official-Spine-Preview');
    node.parent = this.previewRoot;
    node.setScale(this.previewScale, this.previewScale, this.previewScale);
    node.setPosition(new Vec3(
      -20 - this.previewCenter[0] * this.previewScale,
      -this.previewCenter[1] * this.previewScale,
      0,
    ));
    const skeleton = node.addComponent(sp.Skeleton);
    skeleton.defaultCacheMode = sp.SpineAnimationCacheMode.REALTIME;
    skeleton.enableBatch = false;
    skeleton.useTint = true;
    skeleton.premultipliedAlpha = this.resolvedAlphaModeSafe() === 'premultiplied';
    skeleton.skeletonData = this.source.skeletonData;
    skeleton.animation = animation;
    skeleton.loop = true;
    this.officialNode = node;
    this.officialSkeleton = skeleton;
  }

  private async createVatPreview(): Promise<void> {
    this.vatPopulation?.destroy();
    this.vatPopulation = null;
    const initialClip = this.compiled!.manifest.clips[0].name;
    const population = await SpineVatPopulationV2.create(
      this.previewRoot,
      this.compiled!,
      this.source!.textures,
      1,
      { columns: 1, scale: this.previewScale, offsetY: 0 },
      initialClip,
    );
    population.root.setPosition(new Vec3(
      405 - this.previewCenter[0] * this.previewScale,
      -this.previewCenter[1] * this.previewScale,
      0,
    ));
    this.vatPopulation = population;
    this.setPreviewClip(initialClip);
    const clipSelect = byId<HTMLSelectElement>(this.rootElement, 'vat-preview-clip');
    clipSelect.replaceChildren(...this.compiled!.manifest.clips.map((clip) => {
      const option = document.createElement('option');
      option.value = clip.name;
      option.textContent = clip.name;
      return option;
    }));
    clipSelect.value = initialClip;
    byId<HTMLElement>(this.rootElement, 'vat-playbar').style.display = 'flex';
  }

  private setPreviewClip(name: string): void {
    if (!this.vatPopulation || !this.officialSkeleton) return;
    this.paused = false;
    this.vatPopulation.instances[0].play(name, { loop: true });
    this.officialSkeleton.paused = false;
    this.officialSkeleton.loop = true;
    this.officialSkeleton.setAnimation(0, name, true);
    const clip = this.vatPopulation.manifest.clips.find((entry) => entry.name === name)!;
    const slider = byId<HTMLInputElement>(this.rootElement, 'vat-frame');
    slider.max = String(Math.max(0, clip.frameCount - 1));
    slider.value = '0';
    byId<HTMLElement>(this.rootElement, 'vat-frame-label').textContent = 'AUTO';
    byId<HTMLButtonElement>(this.rootElement, 'vat-play').textContent = '暂停';
  }

  private togglePreview(): void {
    if (!this.vatPopulation || !this.officialSkeleton) return;
    const instance = this.vatPopulation.instances[0];
    const button = byId<HTMLButtonElement>(this.rootElement, 'vat-play');
    if (this.paused) {
      const clip = instance.currentClip;
      const snapshot = instance.snapshot();
      const resumeFrame = snapshot.manualFrame ?? snapshot.frame;
      instance.setManualFrame(null);
      instance.resume();
      this.setOfficialFrame(clip.name, resumeFrame, clip.fps, true);
      this.officialSkeleton.paused = false;
      this.paused = false;
      button.textContent = '暂停';
      byId<HTMLElement>(this.rootElement, 'vat-frame-label').textContent = 'AUTO';
    } else {
      instance.pause();
      this.officialSkeleton.paused = true;
      this.paused = true;
      button.textContent = '播放';
    }
  }

  private setPreviewFrame(frame: number): void {
    if (!this.vatPopulation || !this.officialSkeleton) return;
    const clip = this.vatPopulation.currentClip;
    this.vatPopulation.instances[0].setManualFrame(frame);
    this.setOfficialFrame(clip.name, frame, clip.fps);
    this.paused = true;
    byId<HTMLButtonElement>(this.rootElement, 'vat-play').textContent = '播放';
    byId<HTMLElement>(this.rootElement, 'vat-frame-label').textContent = `${Math.floor(frame)} F`;
  }

  private setOfficialFrame(animation: string, frame: number, fps: number, loop = false): void {
    const skeleton = this.officialSkeleton!;
    skeleton.paused = true;
    skeleton.clearTracks();
    skeleton.setToSetupPose();
    skeleton.loop = loop;
    skeleton.setAnimation(0, animation, loop);
    (skeleton as any)._instance.updateAnimation(Math.max(0, Math.floor(frame)) / fps);
    (skeleton as any)._markForUpdateRenderData();
  }

  private sourceBounds(): [number, number, number, number] {
    const skeleton = this.source!.json.skeleton ?? {};
    const x = Number(skeleton.x ?? 0);
    const y = Number(skeleton.y ?? 0);
    const width = Math.max(1, Number(skeleton.width ?? 600));
    const height = Math.max(1, Number(skeleton.height ?? 600));
    return [x, y, x + width, y + height];
  }

  private resolvedAlphaModeSafe(): Exclude<SpineVatAlphaMode, 'unknown'> {
    try { return this.resolvedAlphaMode(); } catch { return 'straight'; }
  }

  private async exportPackage(): Promise<void> {
    if (!this.source || !this.compiled || this.busy) return;
    this.setBusy(true);
    this.setStatus('正在封装 Creator 资源包...', 'busy');
    try {
      const packageName = sanitizeSpineVatPackageName(`${this.source.name}-vat`);
      const manifest = structuredClone(this.compiled.manifest);
      manifest.atlasPages.forEach((page, index) => {
        page.path = this.source!.atlasUploads[index].file.name;
      });
      const prefix = `${packageName}/`;
      const entries: SpineVatZipEntry[] = [
        { path: `${prefix}manifest.spinevat`, data: `${JSON.stringify(manifest, null, 2)}\n` },
        { path: `${prefix}USAGE.md`, data: creatorUsage(packageName) },
        { path: `${prefix}source/${this.source.jsonFile.name}`, data: this.source.jsonFile },
        { path: `${prefix}source/${this.source.atlasFile.name}`, data: this.source.atlasFile },
      ];
      this.compiled.pages.forEach((page, index) => {
        entries.push({ path: `${prefix}position-${index}.bin`, data: page.position });
        if (page.light) entries.push({ path: `${prefix}light-${index}.bin`, data: page.light });
        if (page.dark) entries.push({ path: `${prefix}dark-${index}.bin`, data: page.dark });
      });
      this.source.atlasUploads.forEach((upload) => {
        entries.push({ path: `${prefix}${upload.file.name}`, data: upload.file });
      });
      const zip = await createSpineVatZip(entries);
      downloadBlob(zip, `${packageName}.zip`);
      this.setStatus(`已生成 ${packageName}.zip。解压后拖入 assets，并把 manifest.spinevat 拖到组件的 Vat Asset。`, 'ok');
    } catch (error) {
      this.setStatus(String(error instanceof Error ? error.message : error), 'error');
    } finally {
      this.setBusy(false);
    }
  }

  private async downloadRuntime(): Promise<void> {
    const button = byId<HTMLButtonElement>(this.rootElement, 'vat-runtime');
    button.disabled = true;
    this.setStatus('正在下载 Creator 3.8.7 VAT Runtime...', 'busy');
    try {
      const response = await fetch('./spine-vat-runtime.zip');
      if (!response.ok) throw new Error(`CC 组件下载失败（HTTP ${response.status}）`);
      downloadBlob(await response.blob(), 'spine-vat-runtime.zip');
      this.setStatus('CC 组件已下载。解压后将其中的 assets 和 extensions 合并到 Creator 3.8.7 工程。', 'ok');
    } catch (error) {
      this.setStatus(String(error instanceof Error ? error.message : error), 'error');
    } finally {
      button.disabled = false;
    }
  }

  private clearPreview(): void {
    this.officialNode?.destroy();
    this.officialNode = null;
    this.officialSkeleton = null;
    this.vatPopulation?.destroy();
    this.vatPopulation = null;
  }

  private releaseSource(): void {
    if (!this.source) return;
    this.source.skeletonData.destroy();
    for (const texture of this.source.textures) texture.destroy();
    for (const image of this.source.imageAssets) image.destroy();
    for (const url of this.source.objectUrls) URL.revokeObjectURL(url);
    this.source = null;
  }

  private setBusy(value: boolean): void {
    this.busy = value;
    byId<HTMLButtonElement>(this.rootElement, 'vat-build').disabled = value || !this.source;
    byId<HTMLButtonElement>(this.rootElement, 'vat-export').disabled = value || !this.compiled;
  }

  private setStatus(message: string, type: 'idle' | 'busy' | 'ok' | 'error'): void {
    const status = byId<HTMLElement>(this.rootElement, 'vat-status');
    status.textContent = message;
    status.className = `vat-status ${type}`;
  }
}

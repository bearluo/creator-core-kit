import { _decorator, Color, Component, Label, Node, resources, sp, sys, UITransform, Vec3 } from 'cc';
import { analyzeSpineVatSkeletonData } from './SpineVatAnalyzer';
import { bakeAndCompileSpineVatV2, type CompiledSpineVatV2 } from './SpineVatCompilerV2';
import type { SpineVatAlphaMode, SpineVatTextureProfile } from './SpineVatTypes';

const { ccclass, property } = _decorator;

type AlphaMode = Exclude<SpineVatAlphaMode, 'unknown'>;

/**
 * Spine → VAT 烘焙（web 构建里跑）：加载 SkeletonData → 逐动画 dry-run 分析 → 固定槽位烘焙编译，
 * 然后挂 window.__SPINE_VAT_V2_EXPORT__()，调用后由 tools/static-server.mjs 把 manifest 与 .bin 写进导出目录。
 * URL 参数可覆盖属性：spine=resources 内路径、pma=straight|premultiplied、fps=30、profile=balanced|exact|compact。
 */
@ccclass('SpineVatBakeDriver')
export class SpineVatBakeDriver extends Component {
  @property({ tooltip: 'resources 内的 Spine 路径（不带扩展名）' })
  spinePath = 'spine/nanwuzhe/letsparty_tuan_nanwuzhe';

  @property({ tooltip: '图集 alpha：straight / premultiplied' })
  alphaMode: AlphaMode = 'straight';

  @property({ tooltip: '烘焙帧率' })
  frameRate = 30;

  @property({ tooltip: '贴图精度：balanced / exact / compact' })
  textureProfile: SpineVatTextureProfile = 'balanced';

  private status!: Label;

  onLoad(): void {
    const node = new Node('Status');
    node.parent = this.node;
    node.layer = this.node.layer;
    node.addComponent(UITransform).setContentSize(1000, 600);
    node.setPosition(new Vec3(0, 200, 0));
    this.status = node.addComponent(Label);
    this.status.fontSize = 24;
    this.status.color = new Color(235, 240, 255, 255);
    this.applyUrlParams();
    void this.bake();
  }

  private applyUrlParams(): void {
    if (!sys.isBrowser || typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const spine = params.get('spine');
    if (spine) this.spinePath = spine;
    const pma = params.get('pma');
    if (pma === 'straight' || pma === 'premultiplied') this.alphaMode = pma;
    const fps = Number(params.get('fps'));
    if (fps > 0) this.frameRate = fps;
    const profile = params.get('profile');
    if (profile === 'balanced' || profile === 'exact' || profile === 'compact') this.textureProfile = profile;
  }

  private async bake(): Promise<void> {
    const w = window as any;
    try {
      this.show(`加载 ${this.spinePath}...`);
      const data = await new Promise<sp.SkeletonData>((resolve, reject) => {
        resources.load(this.spinePath, sp.SkeletonData, (error, asset) => (error ? reject(error) : resolve(asset)));
      });
      if (!this.isValid) return;
      this.show('逐动画分析...');
      const report = await analyzeSpineVatSkeletonData(this.node, data, {
        alphaMode: this.alphaMode,
        frameRate: this.frameRate,
        textureProfile: this.textureProfile,
      });
      console.log(`[SpineVatBake] analysis ${JSON.stringify(report.compatibility)}`);
      if (!this.isValid) return;
      this.show('烘焙编译...');
      const compiled = await bakeAndCompileSpineVatV2(this.node, data, report);
      if (!this.isValid) return;
      w.__SPINE_VAT_ANALYSIS__ = report;
      w.__SPINE_VAT_V2_EXPORT__ = () => exportFiles(compiled);
      const summary = `clips=${compiled.manifest.clips.length} textureBytes=${compiled.textureBytes}`;
      console.log(`[SpineVatBake] done ${summary}`);
      this.show(`完成：${summary}\n控制台调用 __SPINE_VAT_V2_EXPORT__() 导出`);
    } catch (error) {
      w.__SPINE_VAT_BAKE_ERROR__ = String(error);
      console.error('[SpineVatBake] failed', error);
      if (this.isValid) this.show(`失败：${String(error)}`);
    }
  }

  private show(text: string): void {
    this.status.string = text;
  }
}

function exportFiles(compiled: CompiledSpineVatV2): Promise<unknown[]> {
  const files: Array<[string, BodyInit]> = [['manifest.spinevat', JSON.stringify(compiled.manifest, null, 2)]];
  compiled.pages.forEach((page, index) => {
    files.push([`position-${index}.bin`, page.position.buffer as ArrayBuffer]);
    if (page.light) files.push([`light-${index}.bin`, page.light.buffer as ArrayBuffer]);
    if (page.dark) files.push([`dark-${index}.bin`, page.dark.buffer as ArrayBuffer]);
  });
  return Promise.all(files.map(async ([name, body]) => {
    const response = await fetch(`/__vat_export?name=${name}`, { method: 'POST', body });
    if (!response.ok) throw new Error(`VAT export failed: ${name} (${response.status})`);
    return response.json();
  }));
}

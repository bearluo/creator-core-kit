import { CCObject, Node, director, sp } from 'cc';
import { analyzeSpineVatSkeletonData } from './SpineVatAnalyzer';
import { bakeAndCompileSpineVatV2 } from './SpineVatCompilerV2';
import type { SpineVatAlphaMode } from './SpineVatTypes';

export interface BakedSpineVat {
  /** 文件名 → 内容：manifest.spinevat 与各 .bin（图集 PNG 由调用方拷贝，文件名见 manifest.atlasPages[].path）。 */
  files: Array<[string, string | Uint8Array]>;
  atlasPages: string[];
  summary: string;
}

/**
 * 编辑器场景进程里跑：逐动画分析 → 固定槽位烘焙编译。临时节点挂在当前编辑场景下，不存盘、不进层级面板，结束即销毁。
 * 过不了固定槽位规则的动画直接抛错，错误信息写明原因。
 */
export async function bakeSpineVat(
  data: sp.SkeletonData,
  alphaMode: Exclude<SpineVatAlphaMode, 'unknown'>,
): Promise<BakedSpineVat> {
  const scene = director.getScene();
  if (!scene) throw new Error('烘焙需要一个打开的场景，先打开任意场景');
  const parent = new Node('Spine VAT Bake');
  parent.hideFlags |= CCObject.Flags.DontSave | CCObject.Flags.HideInHierarchy;
  parent.parent = scene;
  try {
    const report = await analyzeSpineVatSkeletonData(parent, data, { alphaMode, frameRate: 30, textureProfile: 'balanced' });
    const compiled = await bakeAndCompileSpineVatV2(parent, data, report);
    const files: BakedSpineVat['files'] = [['manifest.spinevat', JSON.stringify(compiled.manifest, null, 2)]];
    compiled.pages.forEach((page, index) => {
      files.push([`position-${index}.bin`, bytes(page.position)]);
      if (page.light) files.push([`light-${index}.bin`, bytes(page.light)]);
      if (page.dark) files.push([`dark-${index}.bin`, bytes(page.dark)]);
    });
    return {
      files,
      atlasPages: compiled.manifest.atlasPages.map((page) => page.path),
      summary: `clips=${compiled.manifest.clips.length} textureBytes=${compiled.textureBytes} warnings=${report.compatibility.warnings.length}`,
    };
  } finally {
    parent.destroy();
  }
}

function bytes(view: ArrayBufferView): Uint8Array {
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}

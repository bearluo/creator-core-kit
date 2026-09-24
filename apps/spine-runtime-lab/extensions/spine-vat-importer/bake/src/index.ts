import { CCObject, Node, director, sp } from 'cc';
import { analyzeSpineVatSkeletonData } from './SpineVatAnalyzer';
import { bakeAndCompileSpineVatV2 } from './SpineVatCompilerV2';
import { assertBakeOptions, type SpineSkeletonInfo, type SpineVatBakeOptions } from './SpineVatBakeOptions';

export { bakeDefaultsFromManifest, type SpineVatBakeOptions } from './SpineVatBakeOptions';

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
export async function bakeSpineVat(data: sp.SkeletonData, options: SpineVatBakeOptions): Promise<BakedSpineVat> {
  const skeleton = describeSkeleton(data);
  assertBakeOptions(options, skeleton);
  const runtimeError = runtimeProblem(data);
  if (runtimeError) throw new Error(runtimeError);
  const scene = director.getScene();
  if (!scene) throw new Error('烘焙需要一个打开的场景，先打开任意场景');
  const parent = new Node('Spine VAT Bake');
  parent.hideFlags |= CCObject.Flags.DontSave | CCObject.Flags.HideInHierarchy;
  parent.parent = scene;
  try {
    const report = await analyzeSpineVatSkeletonData(parent, data, {
      alphaMode: options.alphaMode,
      frameRate: options.frameRate,
      animations: skeleton.animations.filter((name) => options.animations.includes(name)),
      textureProfile: 'balanced',
    });
    const compiled = await bakeAndCompileSpineVatV2(parent, data, report, { socketNames: options.socketNames });
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

/** 面板用：骨架里的动画名、骨骼名（都按骨架顺序），以及当前引擎能不能烘这份数据（不能时是原因，能时为空串）。 */
export function describeSpineVatSource(data: sp.SkeletonData): SpineSkeletonInfo & { spineVersion: string; runtimeError: string } {
  return { ...describeSkeleton(data), spineVersion: skeletonJson(data)?.skeleton?.spine ?? '', runtimeError: runtimeProblem(data) };
}

function skeletonJson(data: sp.SkeletonData): any {
  const source = data.skeletonJson as unknown;
  return typeof source === 'string' ? JSON.parse(source) : source;
}

function describeSkeleton(data: sp.SkeletonData): SpineSkeletonInfo {
  const json = skeletonJson(data);
  if (!json) throw new Error('只支持 Spine JSON 数据，不支持 .skel');
  return {
    animations: Object.keys(json.animations ?? {}),
    bones: (json.bones ?? []).map((bone: { name: string }) => bone.name),
  };
}

/** 新建工程默认用 Spine 3.8 模块，解析 4.2 的 JSON 不报错，但动画全是 null。 */
function runtimeProblem(data: sp.SkeletonData): string {
  const animations = (data.getRuntimeData(true) as any)?.animations;
  const count = animations?.length ?? 0;
  let ok = count > 0;
  for (let i = 0; ok && i < count; i += 1) ok = Boolean(animations[i]);
  if (ok) return '';
  const version = skeletonJson(data)?.skeleton?.spine ?? '未知版本';
  return `引擎的 Spine 运行时解析不了这份 Spine ${version} 数据：烘焙要在 Spine 选 4.2 的工程里做（项目设置 → 功能裁剪 → Spine，改完重启编辑器）。`
    + '游戏工程要留在 3.8 的话，换个 4.2 的工程烘焙，再把 <名>-vat/ 目录拷过来，播放不依赖 Spine 模块';
}

function bytes(view: ArrayBufferView): Uint8Array {
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}

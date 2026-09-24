/** 烘焙面板提交的参数。 */
export interface SpineVatBakeOptions {
  alphaMode: 'straight' | 'premultiplied';
  /** 1..120 */
  frameRate: number;
  /** 非空，按骨架里的顺序。 */
  animations: string[];
  socketNames: string[];
}

export interface SpineSkeletonInfo {
  animations: string[];
  bones: string[];
}

/**
 * 从已有的产物 manifest 读回上次烘焙的参数当默认值（产物本身就是参数记录，不另存配置）。
 * 骨架里已经没有的动画 / 骨骼丢掉并列进 dropped；读不到或非法的字段回落到 fallback。
 */
export function bakeDefaultsFromManifest(
  manifest: unknown,
  fallback: SpineVatBakeOptions,
  skeleton: SpineSkeletonInfo,
): { options: SpineVatBakeOptions; dropped: string[] } {
  const m = manifest as any;
  if (!m || m.format !== 'spine-vat-2' || !Array.isArray(m.clips)) return { options: fallback, dropped: [] };

  const clipNames: string[] = m.clips.map((clip: any) => clip?.name).filter((name: unknown) => typeof name === 'string');
  const socketNames = new Set<string>();
  for (const clip of m.clips) for (const socket of clip?.sockets ?? []) if (typeof socket?.name === 'string') socketNames.add(socket.name);

  const animations = skeleton.animations.filter((name) => clipNames.includes(name));
  const sockets = skeleton.bones.filter((name) => socketNames.has(name));
  const dropped = [
    ...clipNames.filter((name) => !skeleton.animations.includes(name)),
    ...Array.from(socketNames).filter((name) => !skeleton.bones.includes(name)),
  ];
  const fps = m.clips[0]?.fps;

  return {
    options: {
      alphaMode: m.alphaMode === 'straight' || m.alphaMode === 'premultiplied' ? m.alphaMode : fallback.alphaMode,
      frameRate: Number.isInteger(fps) && fps >= 1 && fps <= 120 ? fps : fallback.frameRate,
      animations: animations.length > 0 ? animations : fallback.animations,
      socketNames: sockets,
    },
    dropped,
  };
}

/** 面板提交的参数在进场景进程前再校验一次。 */
export function assertBakeOptions(options: SpineVatBakeOptions, skeleton: SpineSkeletonInfo): void {
  if (options.alphaMode !== 'straight' && options.alphaMode !== 'premultiplied') throw new Error(`alpha 模式无效：${options.alphaMode}`);
  if (!Number.isInteger(options.frameRate) || options.frameRate < 1 || options.frameRate > 120) throw new Error(`帧率要在 1~120：${options.frameRate}`);
  if (options.animations.length === 0) throw new Error('至少选一段动画');
  const missing = [
    ...options.animations.filter((name) => !skeleton.animations.includes(name)),
    ...options.socketNames.filter((name) => !skeleton.bones.includes(name)),
  ];
  if (missing.length > 0) throw new Error(`骨架里没有：${missing.join(', ')}`);
}

/**
 * 出包期「打戳 / 校验」——热更版本兼容的**另一半**。
 * 运行时版本闸（core createSemverVersionGate）只**执行**比对，
 * `coreApiHash` / `minAppVersion` 的**产生**在出包期，就是本模块。
 *
 * - 打戳：算 core 公共 API 表面 hash（coreApiHash）+ 写兼容戳（app 戳 / 更新戳）。
 * - 校验：出包期主动 verifyCompat——同 core gate 语义、shift-left 到 CI，
 *   把 ADR-0001 的「AOT 缺代码跑一半才崩」提前到构建期 fail。
 *
 * 契约：兼容戳字段对齐 core AppInfo/UpdateInfo；纯 node、零 cc。
 * 见 packages/core/docs/modules/hotupdate-service.md Open Questions #2、[[adr-0001]]。
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 兼容戳：出包期打进 app（app 戳）/ 写进远程更新描述（更新戳），喂运行时版本闸。
 * 字段对齐 core：app 戳 version=AppInfo.appVersion；更新戳 version=UpdateInfo.version、
 * minAppVersion=UpdateInfo.minAppVersion；coreApiHash 两端同名。
 */
export interface CompatStamp {
  /** app 戳 = app 版本；更新戳 = 更新版本。 */
  version: string;
  /** 更新戳可选：要求 app 版本 ≥ 此。 */
  minAppVersion?: string;
  /** core 公共 API 表面 hash。 */
  coreApiHash: string;
  /**
   * 引擎内容指纹（`cc.<md5>.js` 的那段 md5，见 {@link readEngineHash}）。只有更新戳带得上
   * —— app 戳要进包、在 Creator 构建**之前**就得写好，那时产物还不存在。客户端那一端由
   * engine 的 `engineHash()` 运行时取。
   */
  engineHash?: string;
}

/** 出包期校验结果（对齐 core GateResult 语义）。 */
export interface CompatResult {
  ok: boolean;
  reason?: string;
}

/**
 * 归一化 d.ts 后算 API 表面 hash。
 * 按**行首特征**剥注释（JSDoc `/**` / 续行 `*` / 块 `/*` / 行 `//`）+ 去空白行，
 * 使「纯实现改动 / 改注释」不动 hash，「增删导出 / 改签名」才变 hash。
 * core 的字符串字面量类型（'singleton' | 'transient'…）都在代码行、不以 `*`/`/` 开头，不误伤。
 * ponytail: 行级剥注释启发式；若 JSDoc 变更误翻 hash，再上 ts AST 表面提取。
 */
export function hashApiSurface(dts: string): string {
  const normalized = dts
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('//') && !l.startsWith('*') && !l.startsWith('/*'))
    .join('\n');
  return createHash('md5').update(normalized).digest('hex').slice(0, 12);
}

/** 读 core 的 rolled-up d.ts（传文件或含 index.d.ts 的目录）算 coreApiHash。 */
export function computeCoreApiHash(dtsPathOrDir: string): string {
  const file =
    existsSync(dtsPathOrDir) && statSync(dtsPathOrDir).isDirectory()
      ? join(dtsPathOrDir, 'index.d.ts')
      : dtsPathOrDir;
  if (!existsSync(file)) throw new Error(`找不到 core 的 d.ts：${file}（先 build @cck/core？）`);
  return hashApiSurface(readFileSync(file, 'utf8'));
}

/**
 * 从 native 构建产物读**引擎内容指纹**：`<root>/src/import-map*.json` 的 `imports.cc`
 * （内容就一行 `"cc": "./cocos-js/cc.<md5>.js"`）→ `<md5>`。
 *
 * 它与 `libcocos.so` 是同一次引擎构建的两半，业务代码怎么改都不动它 —— 所以它是「这个包的引擎
 * 身份」，喂 core 版本闸的 `UpdateInfo.engineHash`，挡住「热更来的 JS 配上另一个引擎」。
 * 没开 `md5Cache`、或产物里没有 import-map → `undefined`（闸休眠，不误判）。
 */
export function readEngineHash(dataRoot: string): string | undefined {
  const dir = join(dataRoot, 'src');
  if (!existsSync(dir)) return undefined;
  const f = readdirSync(dir).find((x) => x.startsWith('import-map') && x.endsWith('.json'));
  if (f === undefined) return undefined;
  let url: unknown;
  try {
    url = (JSON.parse(readFileSync(join(dir, f), 'utf8') || '{}') as { imports?: Record<string, unknown> }).imports?.cc;
  } catch {
    return undefined;
  }
  if (typeof url !== 'string') return undefined;
  const file = url.split('?')[0].split('#')[0].split('/').pop() ?? '';
  if (!file.startsWith('cc.') || !file.endsWith('.js')) return undefined;
  const v = file.slice('cc.'.length, -'.js'.length);
  return v !== '' && !v.includes('.') ? v : undefined;
}

/** 造兼容戳并落盘（JSON）。 */
export function writeStamp(outPath: string, stamp: CompatStamp): CompatStamp {
  writeFileSync(outPath, JSON.stringify(stamp, null, 2));
  return stamp;
}

/** 读回兼容戳。 */
export function readStamp(path: string): CompatStamp {
  return JSON.parse(readFileSync(path, 'utf8')) as CompatStamp;
}

/**
 * 出包期主动校验（hash 级）：更新戳能否安全应用到已部署的 app 戳。
 * 与 core createSemverVersionGate 同语义、shift-left 到 CI——两者都以 core gate 为准。
 * 比运行时闸更严：出包期两端 coreApiHash 恒在，故无条件比对（缺一放行是运行时的容错，出包期不需要）。
 * ponytail: 只比 coreApiHash + minAppVersion；符号级「热更包引用被裁 API」深校验是上限，
 *           需静态分析热更包 import 的符号集 vs 主包 AOT 保留集，用到再上。
 */
export function verifyCompat(app: CompatStamp, update: CompatStamp): CompatResult {
  if (update.minAppVersion && compareVersion(app.version, update.minAppVersion) < 0) {
    return { ok: false, reason: `需 app ≥ ${update.minAppVersion}（当前 ${app.version}）` };
  }
  if (app.coreApiHash !== update.coreApiHash) {
    return {
      ok: false,
      reason: `core API 表面不一致（app ${app.coreApiHash} ≠ 更新 ${update.coreApiHash}），需整包更新`,
    };
  }
  // 引擎指纹**两端都有才比**（不同于 coreApiHash 的无条件比对）：app 戳生成在 Creator 构建之前、
  // 结构性拿不到本次产物的指纹，只有拿上一版的**更新戳**当 app 参数时这一端才有值。
  if (app.engineHash && update.engineHash && app.engineHash !== update.engineHash) {
    return {
      ok: false,
      reason: `引擎不一致（app ${app.engineHash} ≠ 更新 ${update.engineHash}），热更换不了引擎，需整包更新`,
    };
  }
  return { ok: true };
}

/** 点分数字版本比较 -1/0/1（对齐 core compareVersion；tools 零 core 依赖故内联）。 */
function compareVersion(a: string, b: string): number {
  const pa = a.split('.');
  const pb = b.split('.');
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const na = Number(pa[i]) || 0;
    const nb = Number(pb[i]) || 0;
    if (na !== nb) return na < nb ? -1 : 1;
  }
  return 0;
}

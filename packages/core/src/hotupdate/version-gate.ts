/** 远程更新声明的信息（来自远程 manifest 的兼容字段 + 版本头）。 */
export interface UpdateInfo {
  /** 远程版本号（点分数字，如 "1.4.0"）。 */
  version: string;
  /** 兼容要求：本次更新要求 app 版本 >= 此（缺省不校验）。 */
  minAppVersion?: string;
  /** 兼容要求：core 公共 API 表面 hash 须与本地相等（缺省不校验；呼应 ADR-0001 强引用白名单）。 */
  coreApiHash?: string;
  /**
   * 兼容要求：**引擎内容指纹**须与本地相等（缺省不校验）。出包期从产物的 `cc.<md5>.js` 取。
   *
   * 与 {@link coreApiHash} 挡的是两回事，两道闸不可互相替代：前者描述 `@cck/core` 的 API 面，
   * 换 Creator 版本 / 改引擎模块勾选时它**一动不动**；而热更下发的全是 JS，它们是对着**某一个**
   * `cc.js` 的 API 面编译的，配上另一个引擎就崩在绑定层。
   */
  engineHash?: string;
  /** 待下载总字节（进度用，可选）。 */
  totalBytes?: number;
}

/** 本地（当前安装的客户端）信息，构建期打戳。 */
export interface AppInfo {
  /** 当前 app 版本号（点分数字）。 */
  appVersion: string;
  /** 当前主包 core API 表面 hash（可选）。 */
  coreApiHash?: string;
  /**
   * 当前**引擎内容指纹**（可选）。native 由 engine 层运行时取（`cc.<md5>.js` 的那段 md5）——
   * 它属于跟 `libcocos.so` 同源、结构性不可热更的那一层，所以它就是「这个包的引擎身份」。
   */
  engineHash?: string;
}

/** 版本闸判定结果。 */
export interface GateResult {
  ok: boolean;
  /** 不通过原因（面向提示）。 */
  reason?: string;
  /** 是否需整包更新（AOT 缺代码风险 → 不能只热更）。 */
  needFullUpdate?: boolean;
}

/**
 * 版本兼容闸：apply 前判定「这个远程更新能否安全应用到当前客户端」。
 * 默认实现见 createSemverVersionGate；项目可注入自定义 gate 做灰度/强更/自定义兼容矩阵（override 即自担责）。
 */
export interface VersionGate {
  canApply(remote: UpdateInfo, local: AppInfo): GateResult;
}

/**
 * 比较点分数字版本号：a<b→-1，a==b→0，a>b→1。
 * 逐段数字比较（"1.10.0" > "1.9.9"），长度不等按缺位补 0（"1.2"=="1.2.0"）。
 * ponytail: 忽略 pre-release/build 元数据（-rc.1、+build），首版按纯数字段；需要时再引 semver 库。
 */
export function compareVersion(a: string, b: string): number {
  const pa = a.split('.');
  const pb = b.split('.');
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const na = Number(pa[i]) || 0;
    const nb = Number(pb[i]) || 0;
    if (na < nb) return -1;
    if (na > nb) return 1;
  }
  return 0;
}

/**
 * 默认安全闸（承 ADR-0001）：
 * - remote.minAppVersion 存在且 local.appVersion 低于它 → 拒，needFullUpdate（防 AOT 缺代码崩）。
 * - remote/local 都声明 coreApiHash 且不等 → 拒，needFullUpdate。
 * - remote/local 都声明 engineHash 且不等 → 拒，needFullUpdate（热更换不了引擎，只能发包）。
 * - 否则放行。零配置即享此安全默认；纯比对，可 node 单测。
 */
export function createSemverVersionGate(): VersionGate {
  return {
    canApply(remote: UpdateInfo, local: AppInfo): GateResult {
      if (remote.minAppVersion && compareVersion(local.appVersion, remote.minAppVersion) < 0) {
        return {
          ok: false,
          reason: `需 app ≥ ${remote.minAppVersion}（当前 ${local.appVersion}）`,
          needFullUpdate: true,
        };
      }
      if (remote.coreApiHash && local.coreApiHash && remote.coreApiHash !== local.coreApiHash) {
        return { ok: false, reason: 'core API 不兼容，需整包更新', needFullUpdate: true };
      }
      if (remote.engineHash && local.engineHash && remote.engineHash !== local.engineHash) {
        return { ok: false, reason: '引擎版本不一致，需整包更新', needFullUpdate: true };
      }
      return { ok: true };
    },
  };
}

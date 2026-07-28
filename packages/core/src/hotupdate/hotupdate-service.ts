import { createToken, getRootContainer, type Token } from '../di';
import { getLogger, type ILogger } from '../logging';
import {
  HOTUPDATE_BACKEND,
  createMemoryHotUpdateBackend,
  type HotUpdateProgress,
  type IHotUpdateBackend,
} from './hotupdate-backend';
import {
  createSemverVersionGate,
  type AppInfo,
  type UpdateInfo,
  type VersionGate,
} from './version-gate';

/** 统一更新状态（供 UI 读取展示）。 */
export type HotUpdateState =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'update-available'
  | 'rejected'
  | 'downloading'
  | 'applying'
  | 'ready'
  | 'failed';

/** check 产出（面向调用方）。 */
export type CheckOutcome =
  | { kind: 'up-to-date' }
  | { kind: 'update-available'; info: UpdateInfo }
  | { kind: 'rejected'; reason: string; needFullUpdate: boolean }
  | { kind: 'error'; error: unknown };

/** update 产出。 */
export type UpdateOutcome =
  | { kind: 'ready' } // 已应用，调 restart() 生效
  | { kind: 'failed'; error: unknown; retryable: boolean }
  | { kind: 'skipped'; reason: string }; // 当前状态不允许 update

export interface HotUpdateService {
  /** 当前状态（UI 可读）。 */
  readonly state: HotUpdateState;
  /** 最近一次 check 的远程信息（无则 undefined）。 */
  readonly info: UpdateInfo | undefined;
  /** 检查更新：拉远程版本头 → 比版本 → 版本闸判定。 */
  check(): Promise<CheckOutcome>;
  /** 下载 + 应用（须先 check 到 update-available；失败后可再调重试）。 */
  update(onProgress?: (p: HotUpdateProgress) => void): Promise<UpdateOutcome>;
  /** 重启生效（应在 ready 后调）。 */
  restart(): void;
}

export interface HotUpdateServiceOptions {
  /** 平台后端。默认：DI HOTUPDATE_BACKEND，未注册则空后端（恒 up-to-date）。 */
  backend?: IHotUpdateBackend;
  /** 版本兼容闸。默认 createSemverVersionGate（安全默认，可注入自定义 override）。 */
  gate?: VersionGate;
  /** 本地客户端信息（版本/hash），构建期打戳。缺省 { appVersion: '0.0.0' }。 */
  app?: AppInfo;
  logger?: ILogger;
}

/** 造 HotUpdateService（纯逻辑、零 cc；平台 IO 经 IHotUpdateBackend 注入，兼容策略经 VersionGate 注入）。 */
export function createHotUpdateService(opts?: HotUpdateServiceOptions): HotUpdateService {
  const backend =
    opts?.backend ?? getRootContainer().tryResolve(HOTUPDATE_BACKEND) ?? createMemoryHotUpdateBackend();
  const gate = opts?.gate ?? createSemverVersionGate();
  const app: AppInfo = opts?.app ?? { appVersion: '0.0.0' };
  const logger = opts?.logger ?? getLogger('HotUpdate');

  let state: HotUpdateState = 'idle';
  let info: UpdateInfo | undefined;

  return {
    get state(): HotUpdateState {
      return state;
    },
    get info(): UpdateInfo | undefined {
      return info;
    },

    async check(): Promise<CheckOutcome> {
      state = 'checking';
      let res;
      try {
        res = await backend.check();
      } catch (error) {
        state = 'failed';
        logger.warn('check 失败', error);
        return { kind: 'error', error };
      }
      if (res.status === 'up-to-date') {
        state = 'up-to-date';
        return { kind: 'up-to-date' };
      }
      info = res.info;
      const verdict = gate.canApply(res.info, app);
      if (!verdict.ok) {
        state = 'rejected';
        return {
          kind: 'rejected',
          reason: verdict.reason ?? '版本不兼容',
          needFullUpdate: verdict.needFullUpdate ?? false,
        };
      }
      state = 'update-available';
      return { kind: 'update-available', info: res.info };
    },

    async update(onProgress?: (p: HotUpdateProgress) => void): Promise<UpdateOutcome> {
      if (state !== 'update-available' && state !== 'failed') {
        const reason = `update 需在 update-available/failed 状态调用，当前 ${state}`;
        logger.warn(reason);
        return { kind: 'skipped', reason };
      }
      state = 'downloading';
      try {
        await backend.download(onProgress ?? (() => {}));
        state = 'applying';
        await backend.apply();
      } catch (error) {
        state = 'failed';
        logger.warn('update 失败', error);
        return { kind: 'failed', error, retryable: true };
      }
      state = 'ready';
      return { kind: 'ready' };
    },

    restart(): void {
      backend.restart();
    },
  };
}

/** DI token：项目可 register 自己的 HotUpdateService 覆盖默认。 */
export const HOTUPDATE_SERVICE: Token<HotUpdateService> =
  createToken<HotUpdateService>('cck.hotUpdateService');

let _default: HotUpdateService | undefined;

/** 便捷取用：优先 tryResolve(HOTUPDATE_SERVICE)；未注册则进程级默认（空后端背书）。 */
export function getHotUpdateService(): HotUpdateService {
  return getRootContainer().tryResolve(HOTUPDATE_SERVICE) ?? (_default ??= createHotUpdateService());
}

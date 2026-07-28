import { afterEach, describe, expect, it } from 'vitest';
import {
  createHotUpdateService,
  getHotUpdateService,
  HOTUPDATE_SERVICE,
} from '../hotupdate-service';
import {
  createMemoryHotUpdateBackend,
  HOTUPDATE_BACKEND,
  type CheckResult,
  type HotUpdateProgress,
  type IHotUpdateBackend,
} from '../hotupdate-backend';
import type { VersionGate } from '../version-gate';
import { getRootContainer } from '../../di';
import { LogLevel, type ILogger } from '../../logging';

function fakeLogger(): { logger: ILogger; warns: unknown[][] } {
  const warns: unknown[][] = [];
  const logger: ILogger = {
    level: LogLevel.Debug,
    setLevel: () => {},
    debug: () => {},
    info: () => {},
    warn: (...a: unknown[]) => void warns.push(a),
    error: () => {},
    child: () => logger,
  };
  return { logger, warns };
}

/** 可控 spy IHotUpdateBackend：可设 check 结果/各阶段抛错；download 会 emit 一次进度；记录 restart 次数。 */
function makeBackend() {
  const state = {
    checkResult: { status: 'up-to-date' } as CheckResult,
    checkErr: undefined as unknown,
    downloadErr: undefined as unknown,
    applyErr: undefined as unknown,
    restarts: 0,
  };
  const backend: IHotUpdateBackend = {
    check: () => (state.checkErr ? Promise.reject(state.checkErr) : Promise.resolve(state.checkResult)),
    download: (onProgress: (p: HotUpdateProgress) => void) => {
      onProgress({ bytesDone: 5, bytesTotal: 10, filesDone: 1, filesTotal: 2 });
      return state.downloadErr ? Promise.reject(state.downloadErr) : Promise.resolve();
    },
    apply: () => (state.applyErr ? Promise.reject(state.applyErr) : Promise.resolve()),
    restart: () => void state.restarts++,
  };
  return { backend, state };
}

const NEW: CheckResult = { status: 'new-version', info: { version: '1.2.0', minAppVersion: '1.0.0' } };

afterEach(() => {
  getRootContainer().unregister(HOTUPDATE_SERVICE);
  getRootContainer().unregister(HOTUPDATE_BACKEND);
});

describe('HotUpdateService · check', () => {
  it('1. 已最新 → up-to-date', async () => {
    const b = makeBackend();
    const h = createHotUpdateService({ backend: b.backend, app: { appVersion: '1.0.0' } });
    expect(h.state).toBe('idle');
    expect(await h.check()).toEqual({ kind: 'up-to-date' });
    expect(h.state).toBe('up-to-date');
  });

  it('2. 新版本 + 闸放行 → update-available，记 info', async () => {
    const b = makeBackend();
    b.state.checkResult = NEW;
    const h = createHotUpdateService({ backend: b.backend, app: { appVersion: '1.5.0' } });
    const r = await h.check();
    expect(r).toEqual({ kind: 'update-available', info: NEW.info });
    expect(h.state).toBe('update-available');
    expect(h.info).toEqual(NEW.info);
  });

  it('3. 新版本 + 闸拒（app 太旧）→ rejected + needFullUpdate', async () => {
    const b = makeBackend();
    b.state.checkResult = { status: 'new-version', info: { version: '2.0.0', minAppVersion: '2.0.0' } };
    const h = createHotUpdateService({ backend: b.backend, app: { appVersion: '1.0.0' } });
    const r = await h.check();
    expect(r.kind).toBe('rejected');
    if (r.kind === 'rejected') expect(r.needFullUpdate).toBe(true);
    expect(h.state).toBe('rejected');
  });

  it('4. check 抛错 → error + state failed + 告警', async () => {
    const b = makeBackend();
    b.state.checkErr = new Error('net');
    const { logger, warns } = fakeLogger();
    const h = createHotUpdateService({ backend: b.backend, logger });
    const r = await h.check();
    expect(r.kind).toBe('error');
    expect(h.state).toBe('failed');
    expect(warns).toHaveLength(1);
  });

  it('5. 自定义 gate override 生效', async () => {
    const b = makeBackend();
    b.state.checkResult = NEW;
    const denyAll: VersionGate = { canApply: () => ({ ok: false, reason: 'x', needFullUpdate: false }) };
    const h = createHotUpdateService({ backend: b.backend, gate: denyAll, app: { appVersion: '9.0.0' } });
    expect((await h.check()).kind).toBe('rejected');
  });
});

describe('HotUpdateService · update', () => {
  it('6. update-available → download(进度)→apply→ready，状态流转', async () => {
    const b = makeBackend();
    b.state.checkResult = NEW;
    const h = createHotUpdateService({ backend: b.backend, app: { appVersion: '1.5.0' } });
    await h.check();
    const progs: HotUpdateProgress[] = [];
    const r = await h.update((p) => progs.push(p));
    expect(r).toEqual({ kind: 'ready' });
    expect(h.state).toBe('ready');
    expect(progs).toEqual([{ bytesDone: 5, bytesTotal: 10, filesDone: 1, filesTotal: 2 }]);
  });

  it('7. 非 update-available 状态调 update → skipped', async () => {
    const b = makeBackend();
    const { logger, warns } = fakeLogger();
    const h = createHotUpdateService({ backend: b.backend, logger });
    const r = await h.update(); // idle
    expect(r.kind).toBe('skipped');
    expect(warns).toHaveLength(1);
  });

  it('8. download 失败 → failed + retryable，可重试转 ready', async () => {
    const b = makeBackend();
    b.state.checkResult = NEW;
    b.state.downloadErr = new Error('disk');
    const h = createHotUpdateService({ backend: b.backend, app: { appVersion: '1.5.0' } });
    await h.check();
    const r1 = await h.update();
    expect(r1).toMatchObject({ kind: 'failed', retryable: true });
    expect(h.state).toBe('failed');
    // 重试（清错）→ ready
    b.state.downloadErr = undefined;
    const r2 = await h.update();
    expect(r2).toEqual({ kind: 'ready' });
  });

  it('9. apply 失败 → failed', async () => {
    const b = makeBackend();
    b.state.checkResult = NEW;
    b.state.applyErr = new Error('write');
    const h = createHotUpdateService({ backend: b.backend, app: { appVersion: '1.5.0' } });
    await h.check();
    const r = await h.update();
    expect(r.kind).toBe('failed');
    expect(h.state).toBe('failed');
  });

  it('10. update 无 onProgress 亦可跑', async () => {
    const b = makeBackend();
    b.state.checkResult = NEW;
    const h = createHotUpdateService({ backend: b.backend, app: { appVersion: '1.5.0' } });
    await h.check();
    expect((await h.update()).kind).toBe('ready');
  });
});

describe('HotUpdateService · restart + DI', () => {
  it('11. restart 委托后端', async () => {
    const b = makeBackend();
    const h = createHotUpdateService({ backend: b.backend });
    h.restart();
    expect(b.state.restarts).toBe(1);
  });

  it('12. 无 backend 注册 → 空后端（恒 up-to-date）', async () => {
    const h = createHotUpdateService();
    expect(h.info).toBeUndefined();
    expect((await h.check()).kind).toBe('up-to-date');
  });

  it('13. getHotUpdateService 单例；register 可覆盖', () => {
    const a = getHotUpdateService();
    expect(getHotUpdateService()).toBe(a);
    const custom = createHotUpdateService();
    getRootContainer().register(HOTUPDATE_SERVICE, { useValue: custom });
    expect(getHotUpdateService()).toBe(custom);
  });

  it('14. tryResolve(HOTUPDATE_BACKEND) 生效路径', async () => {
    const b = makeBackend();
    b.state.checkResult = NEW;
    getRootContainer().register(HOTUPDATE_BACKEND, { useValue: b.backend });
    const h = createHotUpdateService({ app: { appVersion: '1.5.0' } }); // 不传 backend → 走 DI
    expect((await h.check()).kind).toBe('update-available');
  });

  it('15. gate 返回裸 {ok:false} → reason/needFullUpdate 走默认兜底', async () => {
    const b = makeBackend();
    b.state.checkResult = NEW;
    const bare: VersionGate = { canApply: () => ({ ok: false }) };
    const h = createHotUpdateService({ backend: b.backend, gate: bare, app: { appVersion: '1.5.0' } });
    expect(await h.check()).toEqual({ kind: 'rejected', reason: '版本不兼容', needFullUpdate: false });
  });

  it('16. 空后端：preset check + download/apply/restart 全 no-op', async () => {
    const backend = createMemoryHotUpdateBackend({ check: NEW });
    expect(await backend.check()).toEqual(NEW);
    await expect(backend.download(() => {})).resolves.toBeUndefined();
    await expect(backend.apply()).resolves.toBeUndefined();
    expect(() => backend.restart()).not.toThrow();
  });
});

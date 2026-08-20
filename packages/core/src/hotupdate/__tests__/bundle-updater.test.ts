import { afterEach, describe, expect, it } from 'vitest';
import { getRootContainer } from '../../di';
import { LogLevel, type ILogger } from '../../logging';
import { createBundleUpdater, BUNDLE_UPDATER } from '../bundle-updater';
import {
  HOTUPDATE_BACKEND_FACTORY,
  type CheckResult,
  type IHotUpdateBackend,
  type HotUpdateProgress,
} from '../hotupdate-backend';

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

/** 可控后端：记录调用；check 结果与 download 行为按 bundle 预置。 */
function makeFactory(preset?: {
  check?: Record<string, CheckResult | Error>;
  downloadFails?: string[];
  /** 后端的本地 manifest asset key；不给则该后端不实现 assetKeys（web / 老实现的形状）。 */
  keys?: Record<string, string[]>;
}) {
  const created: string[] = [];
  const checks: string[] = [];
  const downloads: string[] = [];
  const pending = new Map<string, { resolve: () => void }>();
  let manual = false;

  const factory = (bundle: string): IHotUpdateBackend => {
    created.push(bundle);
    return {
      check(): Promise<CheckResult> {
        checks.push(bundle);
        const r = preset?.check?.[bundle] ?? { status: 'up-to-date' };
        return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
      },
      download(onProgress: (p: HotUpdateProgress) => void): Promise<void> {
        downloads.push(bundle);
        onProgress({ bytesDone: 1, bytesTotal: 2, filesDone: 0, filesTotal: 1 });
        if (preset?.downloadFails?.includes(bundle)) return Promise.reject(new Error('下载炸了'));
        if (!manual) return Promise.resolve();
        return new Promise<void>((resolve) => pending.set(bundle, { resolve }));
      },
      apply: () => Promise.resolve(),
      restart: () => {},
      ...(preset?.keys?.[bundle] ? { assetKeys: (): string[] => preset.keys![bundle] } : {}),
    };
  };
  return {
    factory,
    created,
    checks,
    downloads,
    holdDownloads: (): void => void (manual = true),
    flush: (bundle: string): void => pending.get(bundle)?.resolve(),
  };
}

const newVersion = (version: string): CheckResult => ({
  status: 'new-version',
  info: { version, totalBytes: 100 },
});

afterEach(() => {
  const root = getRootContainer();
  root.unregister(HOTUPDATE_BACKEND_FACTORY);
  root.unregister(BUNDLE_UPDATER);
});

/** 让已排队的微任务跑完（等 check 的 await 链推进到 download）。 */
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('createBundleUpdater', () => {
  it('无 factory（非 native / 未注册）→ no-op，不抛', async () => {
    const u = createBundleUpdater({ logger: fakeLogger().logger });
    await expect(u.ensureLatest('shop')).resolves.toBeUndefined();
  });

  it('发现新版本 → check + download，各按 bundle 独立', async () => {
    const f = makeFactory({ check: { shop: newVersion('1.0.1') } });
    const u = createBundleUpdater({ factory: f.factory });
    await u.ensureLatest('shop');
    await u.ensureLatest('lobby');
    expect(f.checks).toEqual(['shop', 'lobby']);
    expect(f.downloads).toEqual(['shop']); // lobby 已最新，不下载
    expect(f.created).toEqual(['shop', 'lobby']);
  });

  it('同一 bundle 再次 ensureLatest 不重复跑（后端也不重复造）', async () => {
    const f = makeFactory({ check: { shop: newVersion('1.0.1') } });
    const u = createBundleUpdater({ factory: f.factory });
    await u.ensureLatest('shop');
    await u.ensureLatest('shop');
    expect(f.checks).toEqual(['shop']);
    expect(f.created).toEqual(['shop']);
  });

  it('并发同名共享同一次更新', async () => {
    const f = makeFactory({ check: { shop: newVersion('1.0.1') } });
    f.holdDownloads();
    const u = createBundleUpdater({ factory: f.factory });
    const a = u.ensureLatest('shop');
    const b = u.ensureLatest('shop');
    await tick(); // 等 check 兑现、download 挂起
    f.flush('shop');
    await Promise.all([a, b]);
    expect(f.checks).toEqual(['shop']);
    expect(f.downloads).toEqual(['shop']);
  });

  it('check 失败（离线 / CDN 少传文件）→ reject，绝不退回包内版本', async () => {
    const f = makeFactory({ check: { shop: new Error('网络挂了') } });
    const u = createBundleUpdater({ factory: f.factory, logger: fakeLogger().logger });
    await expect(u.ensureLatest('shop')).rejects.toThrow('网络挂了');
    expect(f.downloads).toEqual([]);
  });

  it('下载失败 → reject（掩盖发布事故的代价大于这次加载失败）', async () => {
    const f = makeFactory({ check: { shop: newVersion('1.0.1') }, downloadFails: ['shop'] });
    const u = createBundleUpdater({ factory: f.factory, logger: fakeLogger().logger });
    await expect(u.ensureLatest('shop')).rejects.toThrow();
  });

  it('版本闸拒（coreApiHash 不符）→ 不下载，reject 且带 needFullUpdate 标记（该发整包了，不是网络错）', async () => {
    const f = makeFactory({
      check: { shop: { status: 'new-version', info: { version: '2.0.0', coreApiHash: 'bbbb' } } },
    });
    const u = createBundleUpdater({
      factory: f.factory,
      app: { appVersion: '1.0.0', coreApiHash: 'aaaa' },
      logger: fakeLogger().logger,
    });
    const e = await u.ensureLatest('shop').catch((err: unknown) => err);
    expect((e as { __cckLaunchFailure?: { kind?: string } }).__cckLaunchFailure?.kind).toBe(
      'needFullUpdate',
    );
    expect(f.downloads).toEqual([]);
  });

  it('失败不留缓存 → 重试真的重跑（否则拿到的是同一个已 reject 的 promise）', async () => {
    let boom = true;
    const factory = (): IHotUpdateBackend => ({
      check: (): Promise<CheckResult> =>
        boom ? Promise.reject(new Error('网络挂了')) : Promise.resolve({ status: 'up-to-date' }),
      download: (): Promise<void> => Promise.resolve(),
      apply: (): Promise<void> => Promise.resolve(),
      restart: (): void => {},
    });
    const u = createBundleUpdater({ factory, logger: fakeLogger().logger });
    await expect(u.ensureLatest('shop')).rejects.toThrow('网络挂了');
    boom = false;
    await expect(u.ensureLatest('shop')).resolves.toBeUndefined();
  });

  it('onProgress 带上 bundle 名转发', async () => {
    const seen: Array<[string, number]> = [];
    const f = makeFactory({ check: { shop: newVersion('1.0.1') } });
    const u = createBundleUpdater({
      factory: f.factory,
      onProgress: (bundle, p) => void seen.push([bundle, p.bytesDone]),
    });
    await u.ensureLatest('shop');
    expect(seen).toEqual([['shop', 1]]);
  });

  it('factory 默认从 DI 的 HOTUPDATE_BACKEND_FACTORY 拾取', async () => {
    const f = makeFactory({ check: { shop: newVersion('1.0.1') } });
    getRootContainer().register(HOTUPDATE_BACKEND_FACTORY, { useValue: f.factory });
    await createBundleUpdater().ensureLatest('shop');
    expect(f.downloads).toEqual(['shop']);
  });

  it('BUNDLE_UPDATER token 可注册覆盖', () => {
    const u = createBundleUpdater();
    getRootContainer().register(BUNDLE_UPDATER, { useValue: u });
    expect(getRootContainer().tryResolve(BUNDLE_UPDATER)).toBe(u);
  });
});

describe('BundleUpdater.versionOf（内容寻址产物：加载哪个 md5）', () => {
  const K = { shop: ['assets/shop/cc.config.a1b2c.json', 'assets/shop/index.a1b2c.js'] };

  it('ensureLatest 之前没有值 —— 版本只有更新跑完才作数', () => {
    const f = makeFactory({ keys: K });
    expect(createBundleUpdater({ factory: f.factory }).versionOf?.('shop')).toBeUndefined();
  });

  it('走下载那条路 → 记下更新后 manifest 里的版本', async () => {
    const f = makeFactory({ check: { shop: newVersion('1.0.1') }, keys: K });
    const u = createBundleUpdater({ factory: f.factory });
    await u.ensureLatest('shop');
    expect(u.versionOf?.('shop')).toBe('a1b2c');
  });

  it('up-to-date 那条路同样记 —— 包内 bundleVers 只在从没更新过时才碰巧对得上', async () => {
    const f = makeFactory({ keys: K });
    const u = createBundleUpdater({ factory: f.factory });
    await u.ensureLatest('shop');
    expect(u.versionOf?.('shop')).toBe('a1b2c');
  });

  it('后端不实现 assetKeys（web / 空后端）→ undefined，调用方回落别的来源', async () => {
    const f = makeFactory({ check: { shop: newVersion('1.0.1') } });
    const u = createBundleUpdater({ factory: f.factory });
    await u.ensureLatest('shop');
    expect(u.versionOf?.('shop')).toBeUndefined();
  });

  it('更新失败 → 不留版本（留着会让重试后的 load 去取一个可能已被删掉的 md5 文件）', async () => {
    const f = makeFactory({ check: { shop: newVersion('1.0.1') }, downloadFails: ['shop'], keys: K });
    const u = createBundleUpdater({ factory: f.factory });
    await expect(u.ensureLatest('shop')).rejects.toThrow();
    expect(u.versionOf?.('shop')).toBeUndefined();
  });

  it('只回答问到的那个 bundle', async () => {
    const f = makeFactory({ keys: K });
    const u = createBundleUpdater({ factory: f.factory });
    await u.ensureLatest('shop');
    expect(u.versionOf?.('lobby')).toBeUndefined();
  });
});

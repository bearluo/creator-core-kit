import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMemoryStorage } from '../../save';
import { createSaveManager, getSaveManager, type SaveManager } from '../../save';
import { boot, type Kit } from '../../bootstrap';
import { getRootContainer, type Container } from '../../di';
import { DEVICE_PROFILE, type DeviceProfile } from '../../device';
import { getUIVariant, setUIVariant } from '../../ui';
import {
  createDeviceTier,
  deviceTierModule,
  DEVICE_TIER,
  TIER_DEFAULT,
  type DeviceTierOptions,
  type TierVerdict,
} from '../device-tier';

const PROFILE: DeviceProfile = { deviceTotalMemoryBytes: 2 * 1024 ** 3, readFailures: [] };

function freshSave(): SaveManager {
  return createSaveManager({ storage: createMemoryStorage() });
}

function make(opts: DeviceTierOptions = {}) {
  return createDeviceTier({ profile: PROFILE, save: freshSave(), ...opts });
}

/** 一个手动兑现的 promise，用来精确控制 fetchTier 什么时候回来。 */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('DeviceTier · 判档前的样子', () => {
  it('resolveAtStartup 跑完之前恒为 default', () => {
    const t = make({ scoreTier: () => 'low' });
    expect(t.tier).toBe(TIER_DEFAULT);
    expect(t.source).toBe('default');
    expect(t.serverOutcome).toBe('skipped');
  });
});

describe('DeviceTier · 优先级链', () => {
  it('玩家自选最高优先级，而且**不再问服务器**', async () => {
    const save = freshSave();
    const fetchTier = vi.fn();
    const t = createDeviceTier({ profile: PROFILE, save, scoreTier: () => 'low', fetchTier });

    await t.setPreferred('ultra');
    await t.resolveAtStartup();

    expect(t.tier).toBe('ultra');
    expect(t.source).toBe('player');
    expect(fetchTier).not.toHaveBeenCalled();
    expect(t.serverOutcome).toBe('skipped');
  });

  it('无自选 → 上次生效的缓存垫底', async () => {
    const save = freshSave();
    await createDeviceTier({ profile: PROFILE, save, scoreTier: () => 'low' }).resolveAtStartup();

    const second = createDeviceTier({ profile: PROFILE, save, scoreTier: () => 'high' });
    await second.resolveAtStartup();
    // 缓存优先于本地重算：上次算出来的 low 仍然作数
    expect(second.tier).toBe('low');
    expect(second.source).toBe('cache');
  });

  it('无自选无缓存 → 本地打分', async () => {
    const t = make({ scoreTier: (p) => (p.deviceTotalMemoryBytes! < 3 * 1024 ** 3 ? 'low' : 'high') });
    await t.resolveAtStartup();
    expect(t.tier).toBe('low');
    expect(t.source).toBe('local');
  });

  it('什么取值函数都不传 → 恒 default，跟没注册模块逐字相同', async () => {
    const t = make();
    await t.resolveAtStartup();
    expect(t.tier).toBe(TIER_DEFAULT);
    expect(t.source).toBe('default');
  });

  it('⚠️ scoreTier 是项目代码，它抛了不许掀翻启动 —— 分档是可选功能', async () => {
    const t = make({
      scoreTier: () => {
        throw new Error('项目的打分函数有 bug');
      },
    });
    await expect(t.resolveAtStartup()).resolves.toBeUndefined();
    expect(t.tier).toBe(TIER_DEFAULT);
    expect(t.source).toBe('default');
  });

  it('打分函数返回空串当没打分', async () => {
    const t = make({ scoreTier: () => '' });
    await t.resolveAtStartup();
    expect(t.tier).toBe(TIER_DEFAULT);
  });
});

describe('DeviceTier · 把档位灌进 UIVariant', () => {
  afterEach(async () => {
    await setUIVariant({ tier: TIER_DEFAULT }); // 默认 UIManager 是进程级的，别留脏
  });

  it('判完就推进 UI 变体 —— 紧接着的 shared 步要按档装常驻皮包，晚一步就静默装错', async () => {
    const t = make({ scoreTier: () => 'low' });
    expect(getUIVariant().tier).toBe(TIER_DEFAULT);

    await t.resolveAtStartup();

    expect(t.tier).toBe('low');
    expect(getUIVariant().tier).toBe('low'); // 不指望接入方记得接这根线
  });

  it('判档途中被 dispose → 不推（宿主已经没了）', async () => {
    const d = deferred<TierVerdict | 'none'>();
    const t = make({ scoreTier: () => 'low', fetchTier: () => d.promise });
    const p = t.resolveAtStartup();
    t.dispose();
    d.resolve({ tier: 'mid', source: 'server' });
    await p;

    expect(getUIVariant().tier).toBe(TIER_DEFAULT);
  });
});

describe('DeviceTier · 缺省与坏数据', () => {
  it('一个 option 都不传也能跑：save / logger / profile 全走默认', async () => {
    const t = createDeviceTier();
    await expect(t.resolveAtStartup()).resolves.toBeUndefined();
    expect(t.tier).toBe(TIER_DEFAULT);
    // 别把默认 SaveManager 留脏给别的用例
    await getSaveManager().delete('cck_tier');
    await getSaveManager().delete('cck_tier_preferred');
  });

  it('缓存里躺着坏数据（tier 不是字符串 / 是空串）→ 当没有，不是当 0 档', async () => {
    for (const bad of [{ tier: 42 }, { tier: '' }, {}]) {
      const save = freshSave();
      await save.save('cck_tier', bad);
      const t = createDeviceTier({ profile: PROFILE, save, scoreTier: () => 'low' });
      await t.resolveAtStartup();
      expect(t.tier).toBe('low');
      expect(t.source).toBe('local');
    }
  });
});

describe('DeviceTier · 服务器这一趟', () => {
  it('及时返回 → 服务器结论盖过本地，并写缓存', async () => {
    const save = freshSave();
    const verdict: TierVerdict = { tier: 'mid', source: 'server' };
    const t = createDeviceTier({
      profile: PROFILE,
      save,
      scoreTier: () => 'low',
      fetchTier: () => Promise.resolve(verdict),
    });
    await t.resolveAtStartup();

    expect(t.tier).toBe('mid');
    expect(t.source).toBe('server');
    expect(t.serverOutcome).toBe('ok');
    // 下一次启动能从缓存拿到它
    const next = createDeviceTier({ profile: PROFILE, save });
    await next.resolveAtStartup();
    expect(next.tier).toBe('mid');
  });

  it('服务器明说没有 → 用兜底，埋点记 none', async () => {
    const t = make({ scoreTier: () => 'low', fetchTier: () => Promise.resolve('none') });
    await t.resolveAtStartup();
    expect(t.tier).toBe('low');
    expect(t.source).toBe('local');
    expect(t.serverOutcome).toBe('none');
  });

  it('接口失败 → 用兜底，埋点记 error（跟 none 走同一条路，只有埋点分得开）', async () => {
    const t = make({ scoreTier: () => 'low', fetchTier: () => Promise.reject(new Error('boom')) });
    await t.resolveAtStartup();
    expect(t.tier).toBe('low');
    expect(t.serverOutcome).toBe('error');
  });

  it('本地算出来的也写缓存 —— 下次启动即便打分函数变了也有垫底', async () => {
    const save = freshSave();
    await createDeviceTier({ profile: PROFILE, save, scoreTier: () => 'low' }).resolveAtStartup();
    const raw = await save.load('cck_tier');
    expect(raw).toMatchObject({ tier: 'low', source: 'local' });
  });
});

describe('DeviceTier · 超时：机会主义等待、不重试', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('超预算就走，用兜底，埋点记 timeout', async () => {
    vi.useFakeTimers();
    const d = deferred<TierVerdict | 'none'>();
    const t = make({ budgetMs: 1500, scoreTier: () => 'low', fetchTier: () => d.promise });

    const p = t.resolveAtStartup();
    await vi.advanceTimersByTimeAsync(1500);
    await p;

    expect(t.tier).toBe('low');
    expect(t.source).toBe('local');
    expect(t.serverOutcome).toBe('timeout');
  });

  it('⭐ 没赶上的那趟迟到回来，仍然写缓存给下次用', async () => {
    vi.useFakeTimers();
    const save = freshSave();
    const d = deferred<TierVerdict | 'none'>();
    const t = createDeviceTier({
      profile: PROFILE,
      save,
      budgetMs: 1500,
      scoreTier: () => 'low',
      fetchTier: () => d.promise,
    });

    const p = t.resolveAtStartup();
    await vi.advanceTimersByTimeAsync(1500);
    await p;
    expect(t.tier).toBe('low'); // 本次会话已经定了，迟到的不改它

    d.resolve({ tier: 'mid', source: 'server' });
    await vi.advanceTimersByTimeAsync(0);

    expect(await save.load('cck_tier')).toMatchObject({ tier: 'mid', source: 'server' });
  });

  it('迟到的那趟自己炸了也不能把日志污染成错误 —— 取消不是失败', async () => {
    vi.useFakeTimers();
    const d = deferred<TierVerdict | 'none'>();
    const t = make({ budgetMs: 100, scoreTier: () => 'low', fetchTier: () => d.promise });

    const p = t.resolveAtStartup();
    await vi.advanceTimersByTimeAsync(100);
    await p;

    d.reject(new Error('late boom'));
    await expect(vi.advanceTimersByTimeAsync(0)).resolves.not.toThrow();
    expect(t.tier).toBe('low');
  });
});

describe('DeviceTier · 「await 回来先确认自己还在」', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('判档途中被 dispose → 回来不改任何状态', async () => {
    vi.useFakeTimers();
    const d = deferred<TierVerdict | 'none'>();
    const t = make({ budgetMs: 1500, scoreTier: () => 'low', fetchTier: () => d.promise });

    const p = t.resolveAtStartup();
    t.dispose(); // 启动被强更 / 停服中止
    d.resolve({ tier: 'mid', source: 'server' });
    await vi.advanceTimersByTimeAsync(1500);
    await p;

    expect(t.tier).toBe(TIER_DEFAULT);
    expect(t.source).toBe('default');
  });

  it('dispose 之后迟到的服务器结果不写缓存', async () => {
    vi.useFakeTimers();
    const save = freshSave();
    const d = deferred<TierVerdict | 'none'>();
    const t = createDeviceTier({
      profile: PROFILE,
      save,
      budgetMs: 100,
      scoreTier: () => 'low',
      fetchTier: () => d.promise,
    });

    const p = t.resolveAtStartup();
    await vi.advanceTimersByTimeAsync(100);
    await p;
    expect(await save.load('cck_tier')).toMatchObject({ tier: 'low' });

    t.dispose();
    d.resolve({ tier: 'mid', source: 'server' });
    await vi.advanceTimersByTimeAsync(0);

    // 宿主已经没了 —— 那份迟到的结论不该再落盘
    expect(await save.load('cck_tier')).toMatchObject({ tier: 'low' });
  });
});

describe('DeviceTier · 会话内只判一次', () => {
  it('并发调用共用同一趟，fetchTier 只被调一次', async () => {
    const fetchTier = vi.fn(() => Promise.resolve<TierVerdict>({ tier: 'mid', source: 'server' }));
    const t = make({ fetchTier });

    await Promise.all([t.resolveAtStartup(), t.resolveAtStartup(), t.resolveAtStartup()]);

    expect(fetchTier).toHaveBeenCalledTimes(1);
    expect(t.tier).toBe('mid');
  });

  it('跑完之后再调也不会重判（会话内不换档）', async () => {
    let n = 0;
    const t = make({ fetchTier: () => Promise.resolve<TierVerdict>({ tier: `t${++n}`, source: 's' }) });
    await t.resolveAtStartup();
    await t.resolveAtStartup();
    expect(t.tier).toBe('t1');
    expect(n).toBe(1);
  });
});

describe('DeviceTier · 玩家自选（下次启动生效）', () => {
  it('setPreferred 不动本次会话的档位', async () => {
    const t = make({ scoreTier: () => 'low' });
    await t.resolveAtStartup();
    expect(t.tier).toBe('low');

    await t.setPreferred('ultra');
    expect(t.tier).toBe('low'); // 本次会话不变，这是不变式
  });

  it('清除自选后回到自动判定', async () => {
    const save = freshSave();
    const first = createDeviceTier({ profile: PROFILE, save, scoreTier: () => 'low' });
    await first.setPreferred('ultra');
    await first.setPreferred(undefined);

    const second = createDeviceTier({ profile: PROFILE, save, scoreTier: () => 'low' });
    await second.resolveAtStartup();
    expect(second.tier).toBe('low');
    expect(second.source).toBe('local');
  });
});

describe('deviceTierModule', () => {
  let container: Container | undefined;
  let kit: Kit | undefined;

  afterEach(async () => {
    await kit?.shutdown();
    kit = undefined;
    container?.dispose();
  });

  it('install 注册 DEVICE_TIER；stop 注销', async () => {
    container = getRootContainer().createScope('t1');
    container.register(DEVICE_PROFILE, { useValue: PROFILE });
    kit = await boot({
      container,
      modules: [{ name: 'device-profile' }, deviceTierModule({ save: freshSave() })],
    });

    expect(container.hasLocal(DEVICE_TIER)).toBe(true);
    await kit.shutdown();
    kit = undefined;
    container?.dispose();
    expect(container.hasLocal(DEVICE_TIER)).toBe(false);
  });

  it('漏注册 device-profile → boot 当场抛，而不是等到判档时静默失败', async () => {
    container = getRootContainer().createScope('t2');
    await expect(boot({ container, modules: [deviceTierModule()] })).rejects.toThrow(
      /depends on missing module "device-profile"/,
    );
  });

  it('画像从容器里捞（install 期捕获，没有画像就打不了分）', async () => {
    container = getRootContainer().createScope('t3');
    container.register(DEVICE_PROFILE, { useValue: PROFILE });
    const seen: DeviceProfile[] = [];
    kit = await boot({
      container,
      modules: [
        { name: 'device-profile' },
        deviceTierModule({
          save: freshSave(),
          scoreTier: (p) => {
            seen.push(p);
            return 'low';
          },
        }),
      ],
    });

    await container.resolve(DEVICE_TIER).resolveAtStartup();
    expect(seen).toEqual([PROFILE]);
  });
});

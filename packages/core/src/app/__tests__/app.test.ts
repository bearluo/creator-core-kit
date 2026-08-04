import { afterEach, describe, expect, it } from 'vitest';
import {
  createApp,
  defaultLaunchSteps,
  getApp,
  APP,
  APP_INFO,
  type AppConfig,
  type AppDeps,
  type LaunchFailure,
  type LaunchPhase,
} from '../app';
import { getRootContainer } from '../../di';
import { LogLevel, type ILogger } from '../../logging';
import type { CheckOutcome, UpdateOutcome } from '../../hotupdate';

function fakeLogger(): ILogger {
  const logger: ILogger = {
    level: LogLevel.Debug,
    setLevel: () => {},
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    child: () => logger,
  };
  return logger;
}

/** 全套 fake 依赖 + config 工厂：所有外部调用按序记进 calls，用它断言序列与「没走到哪一步」。 */
function makeEnv() {
  const calls: string[] = [];
  const jsons = new Map<string, unknown>();
  const versionsSet: Array<Readonly<Record<string, string>>> = [];
  let check: CheckOutcome = { kind: 'up-to-date' };
  let update: UpdateOutcome = { kind: 'ready' };

  const deps: AppDeps = {
    logger: fakeLogger(),
    bundles: {
      load: (name: string) => {
        calls.push(`bundle.load:${name}`);
        return Promise.resolve({ name });
      },
      setVersions: (m: Readonly<Record<string, string>>) => {
        calls.push('bundle.setVersions');
        versionsSet.push(m);
      },
    },
    assets: {
      load: <T>(path: string): Promise<T> => {
        calls.push(`asset.load:${path}`);
        const v = jsons.get(path);
        return v === undefined
          ? Promise.reject(new Error(`fake: ${path} 不存在`))
          : Promise.resolve(v as T);
      },
      loadRemote: <T>(url: string): Promise<T> => {
        calls.push(`asset.loadRemote:${url}`);
        const v = jsons.get(url);
        return v === undefined
          ? Promise.reject(new Error(`fake: ${url} 不存在`))
          : Promise.resolve(v as T);
      },
      release: (p: string) => void calls.push(`asset.release:${p}`),
    },
    hotUpdate: {
      check: () => {
        calls.push('hot.check');
        return Promise.resolve(check);
      },
      update: () => {
        calls.push('hot.update');
        return Promise.resolve(update);
      },
      restart: () => void calls.push('hot.restart'),
    },
  };

  const config = (over?: Partial<AppConfig>): AppConfig => ({
    appId: 'demo',
    version: '1.0.0',
    channel: 'test',
    env: 'dev',
    lobby: {
      bundle: 'lobby',
      enter: () => {
        calls.push('lobby.enter');
        return Promise.resolve();
      },
    },
    ...over,
  });

  return {
    deps,
    config,
    calls,
    versionsSet,
    setJson: (p: string, v: unknown) => void jsons.set(p, v),
    setCheck: (r: CheckOutcome) => void (check = r),
    setUpdate: (r: UpdateOutcome) => void (update = r),
  };
}

afterEach(() => {
  getRootContainer().unregister(APP);
});

describe('App · 启动编排', () => {
  it('1. 默认序列按序跑完 → running，逐阶段 report', async () => {
    const e = makeEnv();
    const phases: LaunchPhase[] = [];
    const app = createApp(e.config(), { deps: e.deps });
    app.onProgress((p) => phases.push(p.phase));
    await app.launch();
    expect(app.phase).toBe('running');
    // dispatch 阶段照常上报（步骤本身在没配 dispatcher 时空跑，见 dispatch.test.ts 用例 2）
    expect(phases).toEqual(['platform', 'dispatch', 'hotupdate', 'shared', 'lobby', 'running']);
    expect(e.calls).toEqual([
      'asset.load:cck-app-compat', // 本例未预置戳 → 降级（见用例 8）
      'hot.check',
      'bundle.load:shared',
      'bundle.load:lobby',
      'lobby.enter',
    ]);
  });

  it('2. 某步抛错 → phase=failed，onFailure 给可重试的 network', async () => {
    const e = makeEnv();
    const boom = new Error('net down');
    const app = createApp(e.config(), {
      deps: e.deps,
      steps: [{ name: 'x', phase: 'shared', run: () => Promise.reject(boom) }],
    });
    const fails: LaunchFailure[] = [];
    app.onFailure((f) => fails.push(f));
    await app.launch();
    expect(app.phase).toBe('failed');
    expect(fails).toEqual([{ kind: 'network', retryable: true, error: boom }]);
  });

  it('3. retry 从失败步继续，前面的步骤不重跑', async () => {
    const e = makeEnv();
    const ran: string[] = [];
    let failOnce = true;
    const app = createApp(e.config(), {
      deps: e.deps,
      steps: [
        {
          name: 'a',
          phase: 'platform',
          run: () => {
            ran.push('a');
            return Promise.resolve();
          },
        },
        {
          name: 'b',
          phase: 'shared',
          run: () => {
            ran.push('b');
            if (failOnce) {
              failOnce = false;
              return Promise.reject(new Error('x'));
            }
            return Promise.resolve();
          },
        },
        {
          name: 'c',
          phase: 'lobby',
          run: () => {
            ran.push('c');
            return Promise.resolve();
          },
        },
      ],
    });
    await app.launch();
    expect(app.phase).toBe('failed');
    await app.retry();
    expect(app.phase).toBe('running');
    expect(ran).toEqual(['a', 'b', 'b', 'c']); // a 没重跑
  });

  it('4. web 版本表 compat 闸拒 → needFullUpdate，不设版本、不加载 lobby', async () => {
    const e = makeEnv();
    e.setJson('cck-app-compat', { json: { version: '1.0.0', coreApiHash: 'localhash' } });
    e.setJson('https://cdn/v.json', {
      json: { version: '1.1.0', coreApiHash: 'otherhash', bundles: { shop: 'abc' } },
    });
    const app = createApp(e.config({ versionUrl: 'https://cdn/v.json' }), { deps: e.deps });
    const fails: LaunchFailure[] = [];
    app.onFailure((f) => fails.push(f));
    await app.launch();
    expect(fails[0]?.kind).toBe('needFullUpdate');
    expect(e.calls).not.toContain('bundle.setVersions');
    expect(e.calls).not.toContain('bundle.load:lobby');
  });

  it('5. 自定义 steps 整体替换默认序列', async () => {
    const e = makeEnv();
    const ran: string[] = [];
    const app = createApp(e.config(), {
      deps: e.deps,
      steps: [
        {
          name: 'only',
          phase: 'lobby',
          run: () => {
            ran.push('only');
            return Promise.resolve();
          },
        },
      ],
    });
    await app.launch();
    expect(ran).toEqual(['only']);
    expect(e.calls).toEqual([]); // 默认步骤一个都没跑
  });

  it('6. 有更新且应用成功 → restart 后停住，不继续往下走', async () => {
    const e = makeEnv();
    e.setCheck({ kind: 'update-available', info: { version: '1.1.0' } });
    e.setUpdate({ kind: 'ready' });
    const app = createApp(e.config(), { deps: e.deps });
    await app.launch();
    expect(e.calls).toContain('hot.restart');
    expect(e.calls).not.toContain('bundle.load:lobby');
    expect(app.phase).toBe('hotupdate'); // 停在原地等进程重来
  });

  it('7. check 被闸拒（native 侧）→ needFullUpdate', async () => {
    const e = makeEnv();
    e.setCheck({ kind: 'rejected', reason: '需 app ≥ 2.0.0', needFullUpdate: true });
    const app = createApp(e.config(), { deps: e.deps });
    const fails: LaunchFailure[] = [];
    app.onFailure((f) => fails.push(f));
    await app.launch();
    expect(fails[0]).toEqual({ kind: 'needFullUpdate', reason: '需 app ≥ 2.0.0' });
  });

  it('8. web：拉到版本表 → setVersions 收到 bundles 映射', async () => {
    const e = makeEnv();
    e.setJson('https://cdn/v.json', {
      json: { version: '1.0.0', bundles: { shop: 'abc', lobby: 'def' } },
    });
    const app = createApp(e.config({ versionUrl: 'https://cdn/v.json' }), { deps: e.deps });
    await app.launch();
    expect(e.versionsSet).toEqual([{ shop: 'abc', lobby: 'def' }]);
    expect(app.phase).toBe('running');
  });

  it('9. app 戳缺失 → 不阻断启动（闸休眠，用 config.version 兜底）', async () => {
    const e = makeEnv();
    const app = createApp(e.config(), { deps: e.deps });
    await app.launch();
    expect(app.phase).toBe('running');
  });

  it('10. app 戳读到 → AppInfo 进 bag 供后续步骤用，且 JSON 随即释放', async () => {
    const e = makeEnv();
    e.setJson('cck-app-compat', { json: { version: '2.0.0', coreApiHash: 'h1' } });
    let seen: unknown;
    const app = createApp(e.config(), {
      deps: e.deps,
      steps: [
        defaultLaunchSteps(e.deps)[0],
        {
          name: 'peek',
          phase: 'shared',
          run: (ctx) => {
            seen = ctx.bag.get(APP_INFO);
            return Promise.resolve();
          },
        },
      ],
    });
    await app.launch();
    expect(seen).toEqual({ appVersion: '2.0.0', coreApiHash: 'h1' });
    expect(e.calls).toContain('asset.release:cck-app-compat');
  });

  it('11. config.shared 自定义：按序加载多个共享 bundle', async () => {
    const e = makeEnv();
    const app = createApp(e.config({ shared: ['shared-ui', 'shared-config'] }), { deps: e.deps });
    await app.launch();
    expect(e.calls).toContain('bundle.load:shared-ui');
    expect(e.calls.indexOf('bundle.load:shared-ui')).toBeLessThan(
      e.calls.indexOf('bundle.load:shared-config'),
    );
  });

  it('12. onProgress 返回的 Disposer 能退订', async () => {
    const e = makeEnv();
    const seen: LaunchPhase[] = [];
    const app = createApp(e.config(), { deps: e.deps });
    const off = app.onProgress((p) => seen.push(p.phase));
    off();
    await app.launch();
    expect(seen).toEqual([]);
  });

  it('13. restart 走注入的平台实现（engine 侧 web=location.reload / native=game.restart）', () => {
    const e = makeEnv();
    let restarted = 0;
    const app = createApp(e.config(), { deps: { ...e.deps, restart: () => void restarted++ } });
    app.restart();
    expect(restarted).toBe(1);
    expect(e.calls).not.toContain('hot.restart');
  });

  it('14. getApp：未注册时给出照着做就能修的错误；注册后取到同一个', () => {
    expect(() => getApp()).toThrow(/createApp/);
    const e = makeEnv();
    const app = createApp(e.config(), { deps: e.deps });
    getRootContainer().register(APP, { useValue: app });
    expect(getApp()).toBe(app);
  });
});

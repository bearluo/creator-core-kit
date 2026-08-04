import { describe, expect, it } from 'vitest';
import {
  defaultLaunchSteps,
  APP_INFO,
  DISPATCH,
  type AppConfig,
  type DispatchResult,
  type LaunchContext,
  type LaunchFailure,
  type LaunchStep,
} from '../app';
import { HTTP, type HttpRequest, type IHttp } from '../../network';
import { getRootContainer } from '../../di';

const URL = 'http://dispatch.test/api/Handshake';

/** 服务端真实回包形状：业务错误也走 HTTP 200，data 字段是 proto3 JSON 的 snake_case。 */
function envelope(data: Record<string, unknown>, code = 'ERROR_CODE_OK'): string {
  return JSON.stringify({ code, msg: '', data });
}

const PLAY_SNAKE = {
  action: 'ACTION_PLAY',
  ws_url: 'ws://server/ws',
  cdn_url: 'http://cdn/',
  notice: '',
  store_url: 'https://store',
  server_time_ms: 1785815855139,
};

function makeEnv(text: string | Error) {
  const seen: HttpRequest[] = [];
  const http: IHttp = {
    request(req) {
      seen.push(req);
      return text instanceof Error
        ? Promise.reject(text)
        : Promise.resolve({ status: 200, text });
    },
  };
  const steps = defaultLaunchSteps({ http });
  const step = steps.find((s) => s.name === 'dispatch') as LaunchStep;

  const run = (over?: Partial<AppConfig>, info?: unknown): Promise<void | 'halt'> => {
    const config: AppConfig = {
      appId: 'demo',
      version: '1.0.0',
      channel: 'test',
      env: 'dev',
      lobby: { bundle: 'lobby', enter: () => Promise.resolve() },
      dispatcher: { url: URL, protoVersion: 1, platform: 'web' },
      ...over,
    };
    const bag = new Map<string, unknown>();
    if (info !== undefined) bag.set(APP_INFO, info);
    lastBag = bag;
    const ctx: LaunchContext = { config, bag, report: () => {} };
    return Promise.resolve(step.run(ctx));
  };

  let lastBag = new Map<string, unknown>();
  return { seen, run, steps, bag: () => lastBag };
}

/** abortLaunch 抛的是带结构标记的 Error（跨 bundle instanceof 不可靠，见 app.ts）。 */
async function failureOf(p: Promise<unknown>): Promise<LaunchFailure> {
  try {
    await p;
  } catch (e) {
    return (e as { __cckLaunchFailure: LaunchFailure }).__cckLaunchFailure;
  }
  throw new Error('期望 abortLaunch，但没抛');
}

describe('dispatch 启动步', () => {
  it('1. 排在 platform 之后、hotupdate 之前 —— 它要 platform 读出的能力戳，又要给热更定 cdn', () => {
    const names = defaultLaunchSteps().map((s) => s.name);
    expect(names).toEqual(['platform', 'dispatch', 'hotupdate', 'shared', 'lobby']);
  });

  it('2. 没配 dispatcher → 整步跳过，一个请求都不发', async () => {
    const env = makeEnv(envelope(PLAY_SNAKE));
    await env.run({ dispatcher: undefined });
    expect(env.seen).toHaveLength(0);
  });

  it('3. PLAY → 解析 snake_case 落进 bag', async () => {
    const env = makeEnv(envelope(PLAY_SNAKE));
    await env.run();
    expect(env.bag().get(DISPATCH)).toEqual({
      action: 'play',
      wsUrl: 'ws://server/ws',
      cdnUrl: 'http://cdn/',
      notice: '',
      storeUrl: 'https://store',
      serverTimeMs: 1785815855139,
    } satisfies DispatchResult);
  });

  it('4. camelCase 字段 + 数字枚举也认（服务端换序列化选项不该让客户端集体启动失败）', async () => {
    const env = makeEnv(
      envelope({ action: 1, wsUrl: 'ws://a/ws', cdnUrl: 'http://b/', serverTimeMs: 7 }, '1'),
    );
    await env.run();
    expect(env.bag().get(DISPATCH)).toMatchObject({
      action: 'play',
      wsUrl: 'ws://a/ws',
      cdnUrl: 'http://b/',
      serverTimeMs: 7,
    });
  });

  it('5. 握手包带上 platform 步读出的 coreApiHash 作能力戳、戳里的版本作 appVersion', async () => {
    const env = makeEnv(envelope(PLAY_SNAKE));
    await env.run({ dispatcher: { url: URL, protoVersion: 3, platform: 'android', deviceId: 'd1' } }, {
      appVersion: '1.4.2',
      coreApiHash: 'abc123',
    });
    expect(JSON.parse(env.seen[0]?.body ?? '{}')).toEqual({
      protoVersion: 3,
      appVersion: '1.4.2',
      platform: 'android',
      channel: 'test',
      capabilityStamp: 'abc123',
      deviceId: 'd1',
    });
  });

  it('6. 没有 app 戳 → 能力戳空串、版本退回 config.version（缺戳不阻断启动）', async () => {
    const env = makeEnv(envelope(PLAY_SNAKE));
    await env.run();
    expect(JSON.parse(env.seen[0]?.body ?? '{}')).toMatchObject({
      appVersion: '1.0.0',
      capabilityStamp: '',
      deviceId: '',
    });
  });

  it('7. UPDATE → needFullUpdate 且带 storeUrl（重试没有意义，要送去商店）', async () => {
    const env = makeEnv(envelope({ ...PLAY_SNAKE, action: 'ACTION_UPDATE', ws_url: '' }));
    expect(await failureOf(env.run())).toEqual({
      kind: 'needFullUpdate',
      reason: '当前客户端版本已停止服务',
      storeUrl: 'https://store',
    });
  });

  it('8. UPDATE 带公告 → 用公告作 reason', async () => {
    const env = makeEnv(
      envelope({ ...PLAY_SNAKE, action: 'ACTION_UPDATE', notice: '请更新到 2.0' }),
    );
    expect(await failureOf(env.run())).toMatchObject({ reason: '请更新到 2.0' });
  });

  it('9. MAINTENANCE → 独立分类（停服不是网络异常，UI 要显示公告而不是「重试」）', async () => {
    const env = makeEnv(
      envelope({ ...PLAY_SNAKE, action: 'ACTION_MAINTENANCE', notice: '维护至 10:00' }),
    );
    expect(await failureOf(env.run())).toEqual({
      kind: 'maintenance',
      notice: '维护至 10:00',
      retryable: true,
    });
  });

  it('10. 失败态也先落 bag —— UI 要拿 notice / storeUrl', async () => {
    const env = makeEnv(envelope({ ...PLAY_SNAKE, action: 'ACTION_MAINTENANCE' }));
    await failureOf(env.run());
    expect(env.bag().get(DISPATCH)).toMatchObject({ action: 'maintenance' });
  });

  it('11. code 非 OK → 抛（如契约版本对不上）', async () => {
    const env = makeEnv(
      JSON.stringify({ code: 'ERROR_CODE_PROTO_VERSION_MISMATCH', msg: '契约版本对不上' }),
    );
    await expect(env.run()).rejects.toThrow(/PROTO_VERSION_MISMATCH/);
  });

  it('12. 未知 action → 抛，不猜', async () => {
    const env = makeEnv(envelope({ ...PLAY_SNAKE, action: 'ACTION_TELEPORT' }));
    await expect(env.run()).rejects.toThrow(/未知 action/);
  });

  it('13. 服务器时间字段缺失/不是数字 → 0（宁可让业务看出没有权威时间）', async () => {
    const env = makeEnv(envelope({ action: 'ACTION_PLAY', server_time_ms: 'now' }));
    await env.run();
    expect(env.bag().get(DISPATCH)).toMatchObject({ serverTimeMs: 0, wsUrl: '' });
  });

  it('14. 请求本身失败 → 原样抛，由 classify 判成可重试的 network', async () => {
    const env = makeEnv(new Error('网络错误 @ ' + URL));
    await expect(env.run()).rejects.toThrow(/网络错误/);
  });

  it('15. 不注入 http → 走 DI 里注册的那个（生产路径：engine 的 ccHttpModule）', async () => {
    const seen: HttpRequest[] = [];
    getRootContainer().register(HTTP, {
      useValue: {
        request(req) {
          seen.push(req);
          return Promise.resolve({ status: 200, text: envelope(PLAY_SNAKE) });
        },
      },
    });
    try {
      const step = defaultLaunchSteps().find((s) => s.name === 'dispatch')!;
      const bag = new Map<string, unknown>();
      await step.run({
        config: {
          appId: 'demo',
          version: '1.0.0',
          channel: 'test',
          env: 'dev',
          lobby: { bundle: 'lobby', enter: () => Promise.resolve() },
          dispatcher: { url: URL, protoVersion: 1, platform: 'web' },
        },
        bag,
        report: () => {},
      });
      expect(seen[0]?.url).toBe(URL);
      expect(bag.get(DISPATCH)).toMatchObject({ action: 'play' });
    } finally {
      getRootContainer().unregister(HTTP);
    }
  });

  it('16. 信封 OK 但没带 data → 当未知 action 抛，不静默放行', async () => {
    const env = makeEnv(JSON.stringify({ code: 'ERROR_CODE_OK', msg: '' }));
    await expect(env.run()).rejects.toThrow(/未知 action/);
  });
});

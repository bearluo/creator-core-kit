import { afterEach, describe, expect, it } from 'vitest';
import {
  createMemoryStorage,
  createNetwork,
  createProtobufCodec,
  createTimer,
  getRootContainer,
  APP,
  type App,
  type IHttp,
  type ISocket,
} from '@cck/core';
import {
  createAuthSession,
  customAccount,
  deviceAccount,
  deviceId,
  lastLoginName,
  login,
  rememberLoginName,
} from '../../../assets/foundation/net/auth';
import { createKitSchema } from '../../../assets/foundation/net/schema';

/**
 * 会话认证。守的是「**每条连接各认各的**」这条网关侧规矩 ——
 * 认证是连接级动作，重连 / 网关搬家之后拿到的是全新连接，不重认就只剩 NOT_HANDSHAKED。
 */

function fakeSocket(): ISocket & { open(): void; drop(): void; sent: ArrayBuffer[] } {
  const s = {
    sent: [] as ArrayBuffer[],
    connect() {},
    send: (data: unknown) => s.sent.push(data as ArrayBuffer),
    close() {},
    open: () => s.onOpen?.(),
    drop: () => s.onClose?.(),
  } as ISocket & { open(): void; drop(): void; sent: ArrayBuffer[] };
  return s;
}

/** 一条连上的连接 + 会话；服务端行为由 `reply` 决定。 */
function authHarness(login: () => Promise<string> = () => Promise.resolve('tok-1')) {
  const socket = fakeSocket();
  const codec = createProtobufCodec(createKitSchema());
  const net = createNetwork({
    socket,
    codec,
    timer: createTimer(),
    url: 'ws://gw/ws',
    heartbeat: { enabled: false },
  });
  /** 收到的 AuthRequest（解出 token 与 seq），用来断言「认了几次、拿的什么 token」。 */
  const auths = (): { token: string; seq: number }[] =>
    socket.sent
      .map((f) => codec.decode(f))
      .filter((m) => m.type === 'AuthRequest')
      .map((m) => ({ token: (m.body as { token: string }).token, seq: m.seq ?? 0 }));
  /** 服务端回一条 AuthResponse，seq 原样回传。 */
  const replyOk = (playerId = 'p-1'): void => {
    const last = auths().at(-1);
    if (!last) return;
    socket.onMessage?.(
      codec.encode({ type: 'AuthResponse', body: { playerId, serverTimeMs: 1 }, seq: last.seq }),
    );
  };
  net.connect();
  socket.open();
  const session = createAuthSession(net, login);
  return { socket, net, session, auths, replyOk };
}

/** 账号服：body 由 `reply` 给，状态码固定 200（业务错误一律 200 + code，见 ADR-0005）。 */
function fakeHttp(reply: unknown, status = 200): IHttp & { body?: unknown } {
  const h: IHttp & { body?: unknown } = {
    request: (req) => {
      h.body = JSON.parse(req.body ?? '{}');
      return Promise.resolve({ status, text: JSON.stringify(reply) });
    },
  };
  return h;
}

describe('设备号与账号', () => {
  it('生成一次就落存储，之后每次拿到同一个（否则每次启动都是新玩家）', async () => {
    const st = createMemoryStorage();
    const first = await deviceId(st);
    expect(first).not.toBe('');
    expect(await deviceId(st)).toBe(first);
    expect(await deviceAccount(st)).toEqual({ provider: 'device', credential: first });
  });

  it('自有账号的 credential 是 `账号:密码`', () => {
    expect(customAccount('tester-a', 'pw123456')).toEqual({
      provider: 'custom',
      credential: 'tester-a:pw123456',
    });
  });

  it('只记账号名不记密码 —— 密码明文落存储等于送到玩家手上', async () => {
    const st = createMemoryStorage();
    expect(await lastLoginName(st)).toBe('');
    await rememberLoginName('tester-a', st);
    expect(await lastLoginName(st)).toBe('tester-a');
    expect(JSON.stringify(await st.get('cck.lastLogin'))).not.toContain('pw');
  });
});

describe('马甲隔离', () => {
  /** 只用到 `config.appId`；App 的其余部分与本测试无关。 */
  const asVest = (appId: string): void => {
    getRootContainer().register(APP, { useValue: { config: { appId } } as App }, { allowOverride: true });
  };

  afterEach(() => asVest('')); // 空 appId = 不加前缀，回到其余用例的前提

  it('两个马甲各自一个游客账号 —— 同一份存储也不串', async () => {
    const st = createMemoryStorage(); // Web / 小游戏同域名共用 localStorage，就是这个场景
    asVest('vest-a');
    const a = await deviceId(st);
    asVest('vest-b');
    const b = await deviceId(st);
    expect(b).not.toBe(a);

    asVest('vest-a'); // 回到 A：还是 A 自己那个号，没被 B 顶掉
    expect(await deviceId(st)).toBe(a);
    expect(await st.keys()).toEqual(
      expect.arrayContaining(['vest-a.cck.deviceId', 'vest-b.cck.deviceId']),
    );
  });

  it('上次登录的账号名同样按马甲分开记', async () => {
    const st = createMemoryStorage();
    asVest('vest-a');
    await rememberLoginName('tester-a', st);
    asVest('vest-b');
    expect(await lastLoginName(st)).toBe('');
  });
});

describe('POST /api/Login', () => {
  it('OK：拿到 token / playerId / 是否新号，凭据原样送出去', async () => {
    const http = fakeHttp({
      code: 'ERROR_CODE_OK',
      data: { token: 'tok-1', player_id: 'p-1', is_new_player: true },
    });
    const account = customAccount('tester-a', 'pw123456');
    expect(await login('http://acc/api/Login', account, http)).toEqual({
      token: 'tok-1',
      playerId: 'p-1',
      isNewPlayer: true,
    });
    expect(http.body).toEqual(account);
  });

  it('认证失败：给玩家看得懂的话（登录界面直接显示这句）', async () => {
    const http = fakeHttp({ code: 'ERROR_CODE_UNAUTHENTICATED', msg: '凭据校验未通过' });
    await expect(login('http://acc/api/Login', customAccount('a', 'pw123456'), http)).rejects.toThrow(
      '账号或密码不对',
    );
  });

  it('其余业务错误码原样带出去（HTTP 仍是 200 —— 判定看 code 不看状态码）', async () => {
    const http = fakeHttp({ code: 'ERROR_CODE_INVALID_ARGUMENT', msg: '不支持的 provider: wechat' });
    await expect(
      login('http://acc/api/Login', { provider: 'wechat', credential: 'x' }, http),
    ).rejects.toThrow('不支持的 provider');
  });

  it('code 是 OK 但没带 token：当失败 —— 拿空 token 去认证只会在网关那边莫名其妙地断', async () => {
    const http = fakeHttp({ code: 'ERROR_CODE_OK', data: { player_id: 'p-1' } });
    await expect(login('http://acc/api/Login', customAccount('a', 'pw123456'), http)).rejects.toThrow(
      'token',
    );
  });
});

describe('AuthSession', () => {
  it('ready() 发一帧 AuthRequest，拿回 playerId', async () => {
    const h = authHarness();
    const p = h.session.ready();
    await Promise.resolve();
    expect(h.auths()).toHaveLength(1);
    expect(h.auths()[0]?.token).toBe('tok-1');
    h.replyOk('p-42');
    expect(await p).toBe('p-42');
    expect(h.session.playerId).toBe('p-42');
    h.session.dispose();
  });

  it('并发 ready() 只认一次 —— 认两次会让服务端把第一条连接当顶号踢掉', async () => {
    const h = authHarness();
    const a = h.session.ready();
    const b = h.session.ready();
    await Promise.resolve();
    expect(h.auths()).toHaveLength(1);
    h.replyOk();
    expect(await a).toBe(await b);
    h.session.dispose();
  });

  it('重连（新连接）自动重认，并且重新登录换新 token', async () => {
    let n = 0;
    const h = authHarness(() => Promise.resolve(`tok-${++n}`));
    const first = h.session.ready();
    await Promise.resolve();
    h.replyOk();
    await first;

    // 掉线 → 重连上来是全新连接，网关不认之前那次认证
    h.socket.drop();
    h.socket.open();
    await Promise.resolve();
    await Promise.resolve();
    expect(h.auths()).toHaveLength(2);
    expect(h.auths()[1]?.token).toBe('tok-2'); // 不复用旧 token
    expect(h.session.playerId).toBe(''); // 认完之前不对外宣称身份
    h.session.dispose();
  });

  it('登录失败不炸整条链路：ready() 抛给启动步，重连时还会再试', async () => {
    let fail = true;
    const h = authHarness(() => (fail ? Promise.reject(new Error('账号服 500')) : Promise.resolve('tok-ok')));
    await expect(h.session.ready()).rejects.toThrow('账号服 500');

    fail = false;
    const retry = h.session.ready(); // 上一次的失败不该把会话锁死
    await Promise.resolve();
    expect(h.auths()).toHaveLength(1);
    h.replyOk('p-9');
    expect(await retry).toBe('p-9');
    h.session.dispose();
  });

  it('dispose 之后新连接不再自动认证', async () => {
    const h = authHarness();
    h.session.dispose();
    h.socket.drop();
    h.socket.open();
    await Promise.resolve();
    expect(h.auths()).toHaveLength(0);
  });
});

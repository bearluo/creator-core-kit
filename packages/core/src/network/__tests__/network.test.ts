import { afterEach, describe, expect, it } from 'vitest';
import { createNetwork, getNetwork, NETWORK } from '../network';
import { createMemorySocket, NETWORK_SOCKET, type ISocket } from '../socket';
import { createJsonCodec, type ICodec, type NetMessage } from '../codec';
import { createTimer } from '../../timer';
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

/** 透传 codec：sent[] 直接是 NetMessage 对象，便于断言。 */
const idCodec: ICodec = { encode: (m) => m, decode: (d) => d as NetMessage };

/** 可控 spy ISocket：记录 connect/send/close；open()/recv()/drop()/err() 模拟底层事件。 */
function makeSocket() {
  let connects = 0;
  let closes = 0;
  const sent: NetMessage[] = [];
  const s: ISocket = {
    connect: () => void connects++,
    send: (d) => void sent.push(d as NetMessage),
    close: () => {
      closes++;
      s.onClose?.();
    },
  };
  return {
    socket: s,
    sent,
    get connects() {
      return connects;
    },
    get closes() {
      return closes;
    },
    open: () => s.onOpen?.(),
    recv: (data: NetMessage) => s.onMessage?.(data),
    drop: () => s.onClose?.(),
    err: (e: unknown) => s.onError?.(e),
  };
}

/** 便捷：建一个已 open 的 network（重连/心跳默认关，按需开）。 */
function connected(opts?: Parameters<typeof createNetwork>[0]) {
  const h = makeSocket();
  const timer = createTimer();
  const net = createNetwork({
    socket: h.socket,
    codec: idCodec,
    timer,
    url: 'ws://x',
    reconnect: { enabled: false },
    heartbeat: { enabled: false },
    ...opts,
  });
  net.connect();
  h.open();
  return { h, timer, net };
}

afterEach(() => {
  getRootContainer().unregister(NETWORK);
  getRootContainer().unregister(NETWORK_SOCKET);
});

describe('Network · 连接/状态', () => {
  it('1. connect → connecting → open，onState 记录流转', () => {
    const h = makeSocket();
    const net = createNetwork({ socket: h.socket, codec: idCodec, timer: createTimer(), url: 'ws://x', reconnect: { enabled: false }, heartbeat: { enabled: false } });
    const states: string[] = [];
    net.onState((s) => states.push(s));
    expect(net.state).toBe('closed');
    net.connect();
    expect(net.state).toBe('connecting');
    expect(h.connects).toBe(1);
    h.open();
    expect(net.state).toBe('open');
    expect(states).toEqual(['connecting', 'open']);
  });

  it('2. connect 无 url → 告警 + closed', () => {
    const { logger, warns } = fakeLogger();
    const net = createNetwork({ socket: makeSocket().socket, codec: idCodec, timer: createTimer(), logger });
    net.connect(); // 无 url
    expect(net.state).toBe('closed');
    expect(warns).toHaveLength(1);
  });

  it('3. connect(url) 覆盖 url', () => {
    const h = makeSocket();
    const net = createNetwork({ socket: h.socket, codec: idCodec, timer: createTimer(), reconnect: { enabled: false }, heartbeat: { enabled: false } });
    net.connect('ws://override');
    expect(net.state).toBe('connecting');
  });

  it('4. close 主动 → closed，不重连', () => {
    const { h, net } = connected({ reconnect: { enabled: true } });
    net.close();
    expect(net.state).toBe('closed');
    expect(h.closes).toBe(1);
  });
});

describe('Network · 发送/请求', () => {
  it('5. send 已连接 → 发出；未连接 → 告警丢弃', () => {
    const { logger, warns } = fakeLogger();
    const h = makeSocket();
    const net = createNetwork({ socket: h.socket, codec: idCodec, timer: createTimer(), url: 'ws://x', reconnect: { enabled: false }, heartbeat: { enabled: false }, logger });
    net.send('a', 1); // 未连接
    expect(warns).toHaveLength(1);
    net.connect();
    h.open();
    net.send('move', { x: 1 });
    expect(h.sent).toEqual([{ type: 'move', body: { x: 1 } }]);
  });

  it('6. request → 带 seq 发出；匹配 seq 响应 → resolve', async () => {
    const { h, net } = connected();
    const p = net.request('login', { u: 'a' });
    expect(h.sent).toEqual([{ type: 'login', body: { u: 'a' }, seq: 1 }]);
    h.recv({ type: 'login', body: { ok: true }, seq: 1 });
    await expect(p).resolves.toEqual({ type: 'login', body: { ok: true }, seq: 1 });
  });

  it('7. request 未连接 → reject not connected', async () => {
    const h = makeSocket();
    const net = createNetwork({ socket: h.socket, codec: idCodec, timer: createTimer(), url: 'ws://x', reconnect: { enabled: false }, heartbeat: { enabled: false } });
    await expect(net.request('x')).rejects.toThrow('not connected');
  });

  it('8. request 超时 → reject 超时', async () => {
    const { timer, net } = connected();
    const p = net.request('slow', undefined, { timeoutSec: 5 });
    timer.tick(5);
    await expect(p).rejects.toThrow('超时');
  });

  it('9. 并发 request seq 递增、各自匹配', async () => {
    const { h, net } = connected();
    const p1 = net.request('a');
    const p2 = net.request('b');
    expect(h.sent.map((m) => m.seq)).toEqual([1, 2]);
    h.recv({ type: 'b', body: 2, seq: 2 });
    h.recv({ type: 'a', body: 1, seq: 1 });
    expect(await p1).toMatchObject({ body: 1 });
    expect(await p2).toMatchObject({ body: 2 });
  });

  it('10. 响应带 seq 但不在 pending → 落推送路由', () => {
    const { h, net } = connected();
    const got: unknown[] = [];
    net.on('x', (b) => got.push(b));
    h.recv({ type: 'x', body: 'late', seq: 999 });
    expect(got).toEqual(['late']);
  });

  it('11. 断线失败在途请求（connection lost）', async () => {
    const { h, net } = connected({ reconnect: { enabled: false } });
    const p = net.request('x');
    h.drop();
    await expect(p).rejects.toThrow('connection lost');
  });
});

describe('Network · 推送路由', () => {
  it('12. on/off 推送；disposer 取消', () => {
    const { h, net } = connected();
    const got: unknown[] = [];
    const dispose = net.on('chat', (b) => got.push(b));
    h.recv({ type: 'chat', body: 'hi' });
    dispose();
    h.recv({ type: 'chat', body: 'yo' });
    net.on('chat', () => {});
    net.off('chat', () => {}); // off 未知 handler 无副作用
    expect(got).toEqual(['hi']);
  });

  it('13. handler 抛错 → 告警、不影响其他 handler', () => {
    const { logger, warns } = fakeLogger();
    const { h, net } = connected({ logger });
    const got: unknown[] = [];
    net.on('e', () => {
      throw new Error('boom');
    });
    net.on('e', (b) => got.push(b));
    h.recv({ type: 'e', body: 1 });
    expect(got).toEqual([1]);
    expect(warns).toHaveLength(1);
  });

  it('14. 无 handler 的 type → no-op', () => {
    const { h } = connected();
    expect(() => h.recv({ type: 'none', body: 1 })).not.toThrow();
  });
});

describe('Network · 重连', () => {
  it('15. 意外断 → reconnecting → 退避后重连 → open，attempt 重置', () => {
    const { h, timer, net } = connected({ reconnect: { enabled: true, minDelaySec: 1, maxDelaySec: 10 } });
    h.drop();
    expect(net.state).toBe('reconnecting');
    timer.tick(1); // 退避 min=1 → 重连
    expect(net.state).toBe('connecting');
    expect(h.connects).toBe(2);
    h.open();
    expect(net.state).toBe('open');
  });

  it('16. 退避指数递增（min → min×2）', () => {
    const { h, timer } = connected({ reconnect: { enabled: true, minDelaySec: 1, maxDelaySec: 10 } });
    h.drop(); // attempt 0 → delay 1
    timer.tick(1);
    expect(h.connects).toBe(2);
    h.drop(); // attempt 1 → delay 2
    timer.tick(1); // 不足 2，不触发
    expect(h.connects).toBe(2);
    timer.tick(1); // 累计 2 → 触发
    expect(h.connects).toBe(3);
  });

  it('17. maxAttempts 上限 → 放弃 closed', () => {
    const { logger, warns } = fakeLogger();
    const { h, timer, net } = connected({ reconnect: { enabled: true, minDelaySec: 1, maxAttempts: 1 }, logger });
    h.drop(); // attempt 0 < 1 → schedule
    timer.tick(1); // attempt → 1, connecting
    h.drop(); // attempt 1 >= 1 → 放弃
    expect(net.state).toBe('closed');
    expect(warns.some((w) => String(w[0]).includes('放弃'))).toBe(true);
  });

  it('18. reconnect 关 → 断线即 closed', () => {
    const { h, net } = connected({ reconnect: { enabled: false } });
    h.drop();
    expect(net.state).toBe('closed');
  });

  it('19. close 取消待定重连', () => {
    const { h, timer, net } = connected({ reconnect: { enabled: true, minDelaySec: 5 } });
    h.drop();
    expect(net.state).toBe('reconnecting');
    net.close();
    expect(net.state).toBe('closed');
    timer.tick(5); // 重连已取消，无新 connect
    expect(h.connects).toBe(1);
  });
});

describe('Network · 心跳', () => {
  it('20. 心跳 ping：一间隔发 ping；收到入站则保活', () => {
    const { h, timer, net } = connected({ heartbeat: { enabled: true, intervalSec: 5, type: 'ping' } });
    timer.tick(5); // alive(open)=true → 发 ping, alive=false
    expect(h.sent).toContainEqual({ type: 'ping' });
    h.recv({ type: 'data', body: 1 }); // 入站 → alive=true
    timer.tick(5); // alive → 再发 ping（未判死）
    expect(net.state).toBe('open');
    expect(h.sent.filter((m) => m.type === 'ping')).toHaveLength(2);
  });

  it('21. 心跳判死：一间隔零入站 → 关闭（reconnect 关→closed）', () => {
    const { timer, net } = connected({ heartbeat: { enabled: true, intervalSec: 5 }, reconnect: { enabled: false } });
    timer.tick(5); // 发 ping, alive=false
    timer.tick(5); // 无入站 → 判死 → close → closed
    expect(net.state).toBe('closed');
  });

  it('22. heartbeat 关 → 不发 ping', () => {
    const { h, timer, net } = connected({ heartbeat: { enabled: false } });
    timer.tick(100);
    expect(h.sent).toHaveLength(0);
    expect(net.state).toBe('open');
  });
});

describe('Network · codec/传输错误/DI', () => {
  it('23. JSON codec round-trip', () => {
    const c = createJsonCodec();
    const msg: NetMessage = { type: 't', body: { a: 1 }, seq: 3 };
    expect(c.decode(c.encode(msg))).toEqual(msg);
  });

  it('24. decode 失败 → 告警、不崩', () => {
    const { logger, warns } = fakeLogger();
    const h = makeSocket();
    const net = createNetwork({ socket: h.socket, codec: createJsonCodec(), timer: createTimer(), url: 'ws://x', reconnect: { enabled: false }, heartbeat: { enabled: false }, logger });
    net.connect();
    h.open();
    h.recv('not json' as unknown as NetMessage);
    expect(warns.some((w) => String(w[0]).includes('decode'))).toBe(true);
    expect(net.state).toBe('open');
  });

  it('25. socket onError → 告警', () => {
    const { logger, warns } = fakeLogger();
    const { h } = connected({ logger });
    h.err(new Error('sock'));
    expect(warns.some((w) => String(w[0]).includes('socket error'))).toBe(true);
  });

  it('26b. 空 socket 全 no-op API', () => {
    const s = createMemorySocket();
    expect(() => {
      s.connect('ws://x');
      s.send('d');
      s.close();
    }).not.toThrow();
  });

  it('26. 无 socket 注册 → 空 socket，connect 不崩、停在 connecting', () => {
    const net = createNetwork({ codec: idCodec, timer: createTimer(), url: 'ws://x' });
    net.connect();
    expect(net.state).toBe('connecting'); // 空 socket 永不 open
  });

  it('27. getNetwork 单例；register 覆盖；tryResolve(NETWORK_SOCKET) 生效', () => {
    const a = getNetwork();
    expect(getNetwork()).toBe(a);
    const custom = createNetwork();
    getRootContainer().register(NETWORK, { useValue: custom });
    expect(getNetwork()).toBe(custom);

    const h = makeSocket();
    getRootContainer().register(NETWORK_SOCKET, { useValue: h.socket });
    const net = createNetwork({ codec: idCodec, timer: createTimer(), url: 'ws://x', reconnect: { enabled: false }, heartbeat: { enabled: false } });
    net.connect();
    expect(h.connects).toBe(1); // 走 DI 的 socket
  });
});

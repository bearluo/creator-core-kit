import { describe, expect, it } from 'vitest';
import { defaultLaunchSteps, DISPATCH, type AppConfig, type DispatchResult } from '../app';
import { createNetwork, createPbSchema, createProtobufCodec, type ISocket } from '../network';
import type { HttpRequest, IHttp } from '../network';
import { createTimer } from '../timer';

/**
 * 打**真服务器**的端到端验证：dispatcher 握手 → 按下发的 wsUrl 连网关 → Ping/Pong 往返。
 *
 * 单测里那些假 socket 只证明状态机自洽；帧头字节序、seq 是否被原样回传、
 * dispatcher 的信封形状这些「两边约定」，只有真服务器能证。
 *
 * **服务器没起就整体跳过**（不看环境变量，免得还要记一条 pnpm 脚本）：
 * 局域网测试机 dev139 上 `docker compose up -d`（server-core-kit 仓）后再跑 `pnpm test` 即自动生效，
 * CI 上（够不着这个内网地址）恒跳过。
 */

/** dev139（172.25.50.139）—— 2026-08-05 服务从开发本机迁到这台局域网测试机。 */
const DISPATCHER = 'http://172.25.50.139:9100';
/** dispatcher 的版本表里 1.3.0 起才放行，低于它会拿到 ACTION_UPDATE。 */
const APP_VERSION = '1.3.0';
/** 契约版本由项目提供 —— core 不含协议常量（ADR-0011）。 */
const PROTO_VERSION = 1;

const up = await fetch(`${DISPATCHER}/healthz`, { signal: AbortSignal.timeout(800) })
  .then((r) => r.ok)
  .catch(() => false);

/** node 侧 IHttp：engine 那份是 XHR，这里用 fetch，接缝形状一致。 */
const nodeHttp: IHttp = {
  async request(req: HttpRequest) {
    const res = await fetch(req.url, {
      method: req.method ?? 'GET',
      body: req.body,
      headers: { ...req.headers },
      signal: AbortSignal.timeout((req.timeoutSec ?? 10) * 1000),
    });
    return { status: res.status, text: await res.text() };
  },
};

/** node 侧 ISocket：与 engine 的 WebSocket 壳同形（含那行决定成败的 binaryType）。 */
function nodeSocket(): ISocket {
  let ws: WebSocket | undefined;
  const self: ISocket = {
    connect(url) {
      const sock = new WebSocket(url);
      sock.binaryType = 'arraybuffer';
      ws = sock;
      sock.onopen = (): void => self.onOpen?.();
      sock.onmessage = (ev): void => self.onMessage?.(ev.data);
      sock.onclose = (): void => self.onClose?.();
      sock.onerror = (ev): void => self.onError?.(ev);
    },
    send: (data) => ws?.send(data as ArrayBuffer),
    close: () => ws?.close(),
  };
  return self;
}

/**
 * 只覆盖 Ping/Pong 的手写 schema。
 *
 * ponytail: 不引 protobufjs、不引契约仓的生成产物——本用例要证的是**帧头与 seq 回传**，
 * 而两个消息各自只有 double 字段（field 1/2，wire type 1）。手写反而是自校验的：
 * 字节要是错了，Go 那边 `proto.Unmarshal` 直接回 BAD_FRAME。真业务协议照常用生成代码。
 */
const PB_DOUBLE_KEY = { clientTimeMs: 0x09, serverTimeMs: 0x11 } as const;

function encodeDoubles(fields: Readonly<Record<string, number>>): Uint8Array {
  const keys = Object.entries(fields).filter(([, v]) => v !== 0);
  const out = new Uint8Array(keys.length * 9);
  const view = new DataView(out.buffer);
  keys.forEach(([name, v], i) => {
    out[i * 9] = PB_DOUBLE_KEY[name as keyof typeof PB_DOUBLE_KEY];
    view.setFloat64(i * 9 + 1, v, true); // protobuf 定长字段是小端
  });
  return out;
}

function decodeDoubles(bytes: Uint8Array): Record<string, number> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: Record<string, number> = {};
  for (let i = 0; i + 8 < bytes.byteLength; i += 9) {
    const name = Object.keys(PB_DOUBLE_KEY).find(
      (k) => PB_DOUBLE_KEY[k as keyof typeof PB_DOUBLE_KEY] === bytes[i],
    );
    if (name) out[name] = view.getFloat64(i + 1, true);
  }
  return out;
}

const schema = createPbSchema(
  { Ping: 10, Pong: 11, Error: 13 }, // 契约的 cmd 号段（kit 框架占 1..999）
  {
    encodeBody: (_type, body) => encodeDoubles((body ?? {}) as Record<string, number>),
    decodeBody: (_type, bytes) => decodeDoubles(bytes),
  },
);

describe.skipIf(!up)('端到端 · 真服务器', () => {
  it('1. dispatcher 握手放行并下发 wsUrl / cdnUrl / 服务器时间', async () => {
    const step = defaultLaunchSteps({ http: nodeHttp }).find((s) => s.name === 'dispatch')!;
    const bag = new Map<string, unknown>();
    const config = {
      appId: 'e2e',
      version: APP_VERSION,
      channel: 'test',
      env: 'dev',
      lobby: { bundle: 'lobby', enter: () => Promise.resolve() },
      dispatcher: {
        url: `${DISPATCHER}/api/Handshake`,
        protoVersion: PROTO_VERSION,
        platform: 'web',
      },
    } satisfies AppConfig;

    await step.run({ config, bag, report: () => {} });

    const r = bag.get(DISPATCH) as DispatchResult;
    expect(r.action).toBe('play');
    expect(r.wsUrl).toMatch(/^ws:\/\/.+\/ws$/);
    // 服务器权威时间：拿它校本地时钟，所以必须是个像样的当下毫秒数
    expect(r.serverTimeMs).toBeGreaterThan(1.7e12);
  });

  it('2. 按下发的 wsUrl 连网关，Ping 走 request → 拿到 seq 对上的 Pong', async () => {
    const step = defaultLaunchSteps({ http: nodeHttp }).find((s) => s.name === 'dispatch')!;
    const bag = new Map<string, unknown>();
    await step.run({
      config: {
        appId: 'e2e',
        version: APP_VERSION,
        channel: 'test',
        env: 'dev',
        lobby: { bundle: 'lobby', enter: () => Promise.resolve() },
        dispatcher: {
          url: `${DISPATCHER}/api/Handshake`,
          protoVersion: PROTO_VERSION,
          platform: 'web',
        },
      },
      bag,
      report: () => {},
    });
    const { wsUrl } = bag.get(DISPATCH) as DispatchResult;

    const timer = createTimer();
    const driver = setInterval(() => timer.tick(0.05), 50);
    const net = createNetwork({
      socket: nodeSocket(),
      codec: createProtobufCodec(schema),
      timer,
      url: wsUrl,
      reconnect: { enabled: false }, // 失败就该失败，别在用例里退避重连拖时间
      heartbeat: { enabled: false }, // 心跳的 '__ping' 不在本 schema 里；本例只验 request 往返
    });

    try {
      await new Promise<void>((resolve, reject) => {
        const off = net.onState((s) => {
          if (s === 'open') {
            off();
            resolve();
          }
          if (s === 'closed') {
            off();
            reject(new Error(`连不上网关 ${wsUrl}`));
          }
        });
        net.connect();
      });

      const clientTimeMs = 1700000000123;
      const pong = await net.request('Ping', { clientTimeMs }, { timeoutSec: 5 });

      expect(pong.type).toBe('Pong'); // cmd 11 反查出类型名 → 帧头字节序对了
      const body = pong.body as { clientTimeMs: number; serverTimeMs: number };
      expect(body.clientTimeMs).toBe(clientTimeMs); // 服务端原样回传 → 可算 RTT
      expect(body.serverTimeMs).toBeGreaterThan(1.7e12);
    } finally {
      clearInterval(driver);
      net.close();
    }
  }, 15000);
});

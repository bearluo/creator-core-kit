import { createToken, getRootContainer, type Token } from '../di';
import { getLogger, type ILogger } from '../logging';
import { getTimer, type ITimer } from '../timer';
import type { Disposer } from '../eventbus';
import { NETWORK_SOCKET, createMemorySocket, type ISocket } from './socket';
import { createJsonCodec, type ICodec, type NetMessage } from './codec';

/** 连接状态。 */
export type NetState = 'closed' | 'connecting' | 'open' | 'reconnecting';

/** 推送消息处理器。 */
export type NetHandler = (body: unknown, msg: NetMessage) => void;

export interface ReconnectOptions {
  /** 默认 true。 */
  enabled?: boolean;
  /** 首次重连延迟（秒），默认 1；退避 = min(max, min×2^attempt)。 */
  minDelaySec?: number;
  /** 退避上限（秒），默认 30。 */
  maxDelaySec?: number;
  /** 最大重连次数，默认 0（=无限）。 */
  maxAttempts?: number;
}

export interface HeartbeatOptions {
  /** 默认 true。 */
  enabled?: boolean;
  /** 心跳间隔（秒），默认 15；一个间隔内无任何入站消息则判死→关闭触发重连。 */
  intervalSec?: number;
  /** ping 消息 type，默认 '__ping'。 */
  type?: string;
}

export interface RequestOptions {
  /** 超时（秒），默认 10。 */
  timeoutSec?: number;
}

export interface INetwork {
  readonly state: NetState;
  /** 连接（可传 url 覆盖）。重置重连计数。 */
  connect(url?: string): void;
  /** 主动关闭（不触发重连）。 */
  close(): void;
  /** 发送消息（fire-and-forget）。未连接则告警丢弃。 */
  send(type: string, body?: unknown): void;
  /** 请求（seq 关联 + 超时），返回响应信封。未连接立即 reject；超时/断线 reject。 */
  request(type: string, body?: unknown, opts?: RequestOptions): Promise<NetMessage>;
  /** 注册推送处理器，返回取消订阅 disposer。 */
  on(type: string, handler: NetHandler): Disposer;
  /** 移除推送处理器。 */
  off(type: string, handler: NetHandler): void;
  /** 订阅状态变化，返回取消订阅 disposer。 */
  onState(cb: (s: NetState) => void): Disposer;
}

export interface NetworkOptions {
  socket?: ISocket;
  codec?: ICodec;
  timer?: ITimer;
  url?: string;
  reconnect?: ReconnectOptions;
  heartbeat?: HeartbeatOptions;
  logger?: ILogger;
}

interface Pending {
  resolve: (msg: NetMessage) => void;
  reject: (err: unknown) => void;
  cancelTimeout: Disposer;
}

/** 造 Network（纯逻辑、零 cc；传输经 ISocket、协议经 ICodec、调度经 ITimer 注入）。 */
export function createNetwork(opts?: NetworkOptions): INetwork {
  const socket = opts?.socket ?? getRootContainer().tryResolve(NETWORK_SOCKET) ?? createMemorySocket();
  const codec = opts?.codec ?? createJsonCodec();
  const timer = opts?.timer ?? getTimer();
  const logger = opts?.logger ?? getLogger('Network');
  const rcEnabled = opts?.reconnect?.enabled ?? true;
  const rcMin = opts?.reconnect?.minDelaySec ?? 1;
  const rcMax = opts?.reconnect?.maxDelaySec ?? 30;
  const rcMaxAttempts = opts?.reconnect?.maxAttempts ?? 0; // 0 = 无限
  const hbEnabled = opts?.heartbeat?.enabled ?? true;
  const hbInterval = opts?.heartbeat?.intervalSec ?? 15;
  const hbType = opts?.heartbeat?.type ?? '__ping';

  let url = opts?.url;
  let state: NetState = 'closed';
  let attempt = 0;
  let nextSeq = 1;
  let alive = false;
  let reconnectTimer: Disposer | undefined;
  let heartbeatTimer: Disposer | undefined;
  const pending = new Map<number, Pending>();
  const handlers = new Map<string, Set<NetHandler>>();
  const stateListeners = new Set<(s: NetState) => void>();

  const setState = (s: NetState): void => {
    if (s === state) return;
    state = s;
    for (const cb of [...stateListeners]) cb(s);
  };

  const rawSend = (msg: NetMessage): void => socket.send(codec.encode(msg));

  const dispatch = (msg: NetMessage): void => {
    const set = handlers.get(msg.type);
    if (!set) return;
    for (const h of [...set]) {
      try {
        h(msg.body, msg);
      } catch (e) {
        logger.warn(`handler '${msg.type}' 抛错`, e);
      }
    }
  };

  const stopHeartbeat = (): void => {
    heartbeatTimer?.();
    heartbeatTimer = undefined;
  };
  const startHeartbeat = (): void => {
    stopHeartbeat();
    if (!hbEnabled) return;
    alive = true;
    heartbeatTimer = timer.interval(hbInterval, () => {
      if (!alive) {
        // 上个间隔内零入站 → 判死，关闭触发重连
        socket.close();
        return;
      }
      alive = false;
      rawSend({ type: hbType });
    });
  };

  const failPending = (err: unknown): void => {
    for (const p of pending.values()) {
      p.cancelTimeout();
      p.reject(err);
    }
    pending.clear();
  };

  const cancelReconnect = (): void => {
    reconnectTimer?.();
    reconnectTimer = undefined;
  };

  const doConnect = (): void => {
    if (!url) {
      logger.warn('connect: 无 url');
      setState('closed');
      return;
    }
    setState('connecting');
    socket.connect(url);
  };

  const scheduleReconnect = (): void => {
    if (rcMaxAttempts > 0 && attempt >= rcMaxAttempts) {
      logger.warn('重连超上限，放弃');
      setState('closed');
      return;
    }
    setState('reconnecting');
    const delay = Math.min(rcMax, rcMin * 2 ** attempt);
    reconnectTimer = timer.delay(delay, () => {
      attempt++;
      doConnect();
    });
  };

  // —— 挂 socket 回调（一次）——
  socket.onOpen = (): void => {
    attempt = 0;
    setState('open');
    startHeartbeat();
  };
  socket.onMessage = (data: unknown): void => {
    alive = true;
    let msg: NetMessage;
    try {
      msg = codec.decode(data);
    } catch (e) {
      logger.warn('decode 失败', e);
      return;
    }
    if (msg.seq != null && pending.has(msg.seq)) {
      const p = pending.get(msg.seq)!;
      pending.delete(msg.seq);
      p.cancelTimeout();
      p.resolve(msg);
      return;
    }
    dispatch(msg);
  };
  socket.onClose = (): void => {
    if (state === 'closed') return; // 已被主动 close 收尾
    stopHeartbeat();
    failPending(new Error('connection lost'));
    if (!rcEnabled) {
      setState('closed');
      return;
    }
    scheduleReconnect();
  };
  socket.onError = (e: unknown): void => logger.warn('socket error', e);

  const off = (type: string, handler: NetHandler): void => {
    handlers.get(type)?.delete(handler);
  };

  return {
    get state(): NetState {
      return state;
    },
    connect(u?: string): void {
      if (u) url = u;
      attempt = 0;
      cancelReconnect();
      doConnect();
    },
    close(): void {
      cancelReconnect();
      stopHeartbeat();
      failPending(new Error('closed'));
      setState('closed');
      socket.close();
    },
    send(type: string, body?: unknown): void {
      if (state !== 'open') {
        logger.warn('send: 未连接，丢弃');
        return;
      }
      rawSend({ type, body });
    },
    request(type: string, body?: unknown, o?: RequestOptions): Promise<NetMessage> {
      if (state !== 'open') return Promise.reject(new Error('not connected'));
      const seq = nextSeq++;
      const timeoutSec = o?.timeoutSec ?? 10;
      return new Promise<NetMessage>((resolve, reject) => {
        const cancelTimeout = timer.delay(timeoutSec, () => {
          // timer 只在未被 cancelTimeout 取消时触发，故此刻 entry 必在（resolve/断线均会取消本 timer）
          pending.delete(seq);
          reject(new Error(`request '${type}' 超时`));
        });
        pending.set(seq, { resolve, reject, cancelTimeout });
        rawSend({ type, body, seq });
      });
    },
    on(type: string, handler: NetHandler): Disposer {
      let set = handlers.get(type);
      if (!set) {
        set = new Set();
        handlers.set(type, set);
      }
      set.add(handler);
      return () => off(type, handler);
    },
    off,
    onState(cb: (s: NetState) => void): Disposer {
      stateListeners.add(cb);
      return () => void stateListeners.delete(cb);
    },
  };
}

/** DI token：项目可 register 自己的 Network 覆盖默认。 */
export const NETWORK: Token<INetwork> = createToken<INetwork>('cck.network');

let _default: INetwork | undefined;

/** 便捷取用：优先 tryResolve(NETWORK)；未注册则进程级默认（空 socket 背书）。 */
export function getNetwork(): INetwork {
  return getRootContainer().tryResolve(NETWORK) ?? (_default ??= createNetwork());
}

import { createToken, type Token } from '../di';

/**
 * 传输接缝：一条消息型长连接（WebSocket 式）。core 只认本接口（守零 cc 铁律）。
 * engine 按平台适配——Web 原生 WebSocket / native jsb WebSocket / 小游戏 wx.connectSocket。
 * 事件用可赋值回调（DOM WebSocket 风格）：engine 侧底层事件触发时调用 core 挂的这些回调。
 * connect() 可在 close 后再次调用（重连由 core 编排，engine 每次新建底层连接、复用同一组回调）。
 */
export interface ISocket {
  /** 发起连接（重连时会被再次调用）。 */
  connect(url: string): void;
  /** 发送已编码数据（由 ICodec 编码后的字节/字符串）。 */
  send(data: unknown): void;
  /** 主动关闭。 */
  close(): void;
  /** 连接就绪。 */
  onOpen?: () => void;
  /** 收到一条消息（原始数据，交 ICodec 解码）。 */
  onMessage?: (data: unknown) => void;
  /** 连接关闭（主动/被动均触发）。 */
  onClose?: () => void;
  /** 传输错误（可选，仅告警；关闭以 onClose 为准）。 */
  onError?: (err: unknown) => void;
}

/** DI token：engine Bootstrap register 平台 socket 适配；未注册时 Network 回退空 socket（永不 open）。 */
export const NETWORK_SOCKET: Token<ISocket> = createToken<ISocket>('cck.networkSocket');

/** 空 socket（null object）：connect/send/close 皆 no-op、回调永不触发。默认实现（无 engine 时）。 */
export function createMemorySocket(): ISocket {
  return {
    connect: () => {},
    send: () => {},
    close: () => {},
  };
}

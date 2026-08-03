import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWebSocketSocket } from '../net-socket';

/**
 * `createWebSocketSocket` 的薄壳测试。这里假的是 **DOM 的 `WebSocket` 全局**（平台 API），
 * 不是 `cc`——ADR-0002 管的是 cc mock 膨胀，与此无关。断言的也全是本壳自己的接线
 * （binaryType / 回调桥接 / identity 卫 / 重连弃旧），不是「真 WebSocket 会怎样」。
 *
 * 真实往返仍由 apps/demo 的 gameView + 真 echo server 兜底（见 network.md 实现记录）。
 */

/** 记录构造与调用的假 WebSocket；实例挂进 `made` 供断言。 */
class FakeWebSocket {
  static made: FakeWebSocket[] = [];
  binaryType = 'blob';
  readonly sent: unknown[] = [];
  closed = 0;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  constructor(readonly url: string) {
    FakeWebSocket.made.push(this);
  }
  send(data: unknown): void {
    this.sent.push(data);
  }
  close(): void {
    this.closed++;
  }
}

function installFake(): void {
  FakeWebSocket.made = [];
  (globalThis as { WebSocket?: unknown }).WebSocket = FakeWebSocket;
}

afterEach(() => {
  delete (globalThis as { WebSocket?: unknown }).WebSocket;
});

describe('createWebSocketSocket', () => {
  it('1. connect 后把 binaryType 设为 arraybuffer（否则二进制 codec 收到 Blob）', () => {
    installFake();
    createWebSocketSocket().connect('ws://x/');
    expect(FakeWebSocket.made[0].binaryType).toBe('arraybuffer');
  });

  it('2. 底层事件桥到 core 挂的回调', () => {
    installFake();
    const sock = createWebSocketSocket();
    const onOpen = vi.fn();
    const onMessage = vi.fn();
    const onClose = vi.fn();
    const onError = vi.fn();
    Object.assign(sock, { onOpen, onMessage, onClose, onError });
    sock.connect('ws://x/');
    const ws = FakeWebSocket.made[0];
    ws.onopen?.();
    ws.onmessage?.({ data: 'hi' });
    ws.onerror?.('boom');
    ws.onclose?.();
    expect(onOpen).toHaveBeenCalledOnce();
    expect(onMessage).toHaveBeenCalledWith('hi');
    expect(onError).toHaveBeenCalledWith('boom');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('3. ArrayBuffer 原样透传（不被转成 string）', () => {
    installFake();
    const sock = createWebSocketSocket();
    const onMessage = vi.fn();
    sock.onMessage = onMessage;
    sock.connect('ws://x/');
    const buf = new Uint8Array([0, 1, 255]).buffer;
    FakeWebSocket.made[0].onmessage?.({ data: buf });
    expect(onMessage).toHaveBeenCalledWith(buf);
    const sent = new Uint8Array([7]).buffer;
    sock.send(sent);
    expect(FakeWebSocket.made[0].sent).toEqual([sent]);
  });

  it('4. 重连：connect 新建底层连接并关掉旧的，旧连接的迟到事件被 identity 卫忽略', () => {
    installFake();
    const sock = createWebSocketSocket();
    const onOpen = vi.fn();
    sock.onOpen = onOpen;
    sock.connect('ws://a/');
    const old = FakeWebSocket.made[0];
    sock.connect('ws://b/');
    expect(FakeWebSocket.made).toHaveLength(2);
    expect(old.closed).toBe(1);
    old.onopen?.(); // 已被 drop 置 null，且 identity 卫也不认它
    expect(onOpen).not.toHaveBeenCalled();
    FakeWebSocket.made[1].onopen?.();
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('5. close() 后本次 close 触发的 onclose 不再回传 core（core 已同步收尾）', () => {
    installFake();
    const sock = createWebSocketSocket();
    const onClose = vi.fn();
    sock.onClose = onClose;
    sock.connect('ws://x/');
    sock.close();
    FakeWebSocket.made[0].onclose?.();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('6. 无 WebSocket 全局（小游戏平台）→ onError + onClose 优雅降级，不抛', () => {
    delete (globalThis as { WebSocket?: unknown }).WebSocket;
    const sock = createWebSocketSocket();
    const onError = vi.fn();
    const onClose = vi.fn();
    Object.assign(sock, { onError, onClose });
    expect(() => sock.connect('ws://x/')).not.toThrow();
    expect(onError).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});

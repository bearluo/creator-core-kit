import { NETWORK_SOCKET } from '@cck/core';
import type { ISocket, KitModule } from '@cck/core';

/**
 * ISocket 的 WebSocket 实现 —— Network 的「引擎半」薄壳：把平台 WebSocket 的底层事件桥到 core 挂的回调。
 * 覆盖 Web（浏览器 WebSocket 全局）+ native（jsb 提供的 DOM 兼容 WebSocket 全局）。
 * 重连由 core 编排：core 每次调 connect(url) 时本壳新建底层连接、复用同一组回调（onOpen/onMessage/...）；
 * 用 identity 卫（`ws === sock`）忽略被替换掉的旧连接的迟到事件，避免重连时旧 socket 串扰。
 *
 * ponytail: 小游戏（wx.connectSocket）不在此壳内——其 API 非 DOM WebSocket，需要时另写 wxSocket 适配。
 */
export function createWebSocketSocket(): ISocket {
  let ws: WebSocket | undefined;

  const drop = (old: WebSocket | undefined): void => {
    if (!old) return;
    old.onopen = null;
    old.onmessage = null;
    old.onclose = null;
    old.onerror = null;
    try {
      old.close();
    } catch {
      /* 已关 / 未开，忽略 */
    }
  };

  const self: ISocket = {
    connect(url: string): void {
      drop(ws); // 重连：先弃旧连接
      if (typeof WebSocket === 'undefined') {
        self.onError?.(new Error('WebSocket 不可用（小游戏平台请用 wx 适配）'));
        self.onClose?.();
        return;
      }
      const sock = new WebSocket(url);
      // 二进制帧必须收成 ArrayBuffer。默认是 'blob'，而 ICodec.decode(data) 是**同步**签名，
      // Blob 只能异步读——不是「解不出来」，是接口形状根本对不上。JSON codec 走 string，
      // 所以这行缺了也一直没暴露，直到接 protobuf。见 ADR-0011。
      sock.binaryType = 'arraybuffer';
      ws = sock;
      sock.onopen = (): void => {
        if (ws === sock) self.onOpen?.();
      };
      sock.onmessage = (ev: MessageEvent): void => {
        if (ws === sock) self.onMessage?.(ev.data);
      };
      sock.onclose = (): void => {
        if (ws === sock) self.onClose?.();
      };
      sock.onerror = (ev: Event): void => {
        if (ws === sock) self.onError?.(ev);
      };
    },
    send(data: unknown): void {
      // JSON codec 产 string；二进制 codec（ArrayBuffer）运行期亦被 WebSocket.send 接受，类型由调用方保证。
      ws?.send(data as string);
    },
    close(): void {
      const cur = ws;
      ws = undefined; // 先置空 → identity 卫失效，本次 close 触发的 onclose 不再回传 core（core 已同步收尾）
      drop(cur);
    },
  };
  return self;
}

/** KitModule：注册 `NETWORK_SOCKET → WebSocket 实现`（本层未注册时）。放模块数组里，Network 自动拾取。 */
export function ccNetworkModule(): KitModule {
  return {
    name: 'network-socket',
    install(ctx) {
      if (!ctx.container.hasLocal(NETWORK_SOCKET)) {
        ctx.container.register(NETWORK_SOCKET, { useValue: createWebSocketSocket() });
      }
    },
  };
}

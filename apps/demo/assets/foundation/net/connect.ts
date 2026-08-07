import {
  createNetwork,
  createProtobufCodec,
  getRootContainer,
  getTimer,
  APP_INFO,
  DISPATCH,
  NETWORK,
  PB_SCHEMA,
  type DispatchResult,
  type INetwork,
  type LaunchContext,
} from '@cck/core';
import { createKitSchema } from './schema';
import { createGatewayMigration, dispatchAgain, GATEWAY_MIGRATION } from './migration';

/**
 * 建长连接 —— 地基启动的第一步。
 *
 * 排在 `dispatch` 之后：`wsUrl` 是那一步拿到的，且**按本客户端版本路由**，不能写死在配置里。
 * 此后业务侧 `getNetwork()` 直接拿到已连上的实例。
 */

const TAG = '[CCK-NET]';

/**
 * 等到 open。连不上就抛——启动期长连接失败该走 LaunchFailure（进度条给重试按钮），
 * 不该悄悄放行进大厅、也不该无限等。
 *
 * 超时不是保险丝而是必需品：`connecting` 可以**永远不结束**——被防火墙黑洞掉的 SYN
 * 不会回 RST，浏览器要几十秒才放弃，native 的实现更没准。真踩过的一次是忘了装
 * `ccNetworkModule()`，core 回退到空 socket（connect 是 no-op、回调永不触发），
 * 启动就停在进度条上，什么都不报。
 */
function waitOpen(net: INetwork, url: string, timeoutSec = 10): Promise<void> {
  if (net.state === 'open') return Promise.resolve(); // retry 时后台重连可能已经成功
  return new Promise<void>((resolve, reject) => {
    const cancelTimeout = getTimer().delay(timeoutSec, () => {
      off();
      reject(new Error(`长连接 ${timeoutSec}s 未就绪（停在 ${net.state}）：${url}`));
    });
    const off = net.onState((s) => {
      if (s === 'open') {
        cancelTimeout();
        off();
        resolve();
      } else if (s === 'closed') {
        cancelTimeout();
        off();
        reject(new Error(`长连接建立失败：${url}`));
      }
    });
    net.connect();
  });
}

/**
 * 按 dispatcher 下发的 `wsUrl` 连网关，并把协议注册表 / 连接 / 搬家器落进 DI。
 *
 * 失败不吞：抛出去由 App 判成 `network`（可重试），LaunchOverlay 给重试按钮。
 * 重试时复用 DI 里那条连接（core 的重连在后台一直退避重试），不新建。
 */
export async function connectNetwork(ctx: LaunchContext): Promise<void> {
  const root = getRootContainer();
  // 注册表先于 wsUrl 判断落 DI：单机跑（没配 dispatcher）时模块照样能注册自己那段，
  // 模块侧不必为「有没有网络」分支。
  let schema = root.tryResolve(PB_SCHEMA);
  if (!schema) {
    schema = createKitSchema();
    root.register(PB_SCHEMA, { useValue: schema });
  }

  const d = ctx.bag.get(DISPATCH) as DispatchResult | undefined;
  if (!d?.wsUrl) return; // 没配 dispatcher（单机跑）→ 后面这段不存在

  let net = root.tryResolve(NETWORK);
  if (!net) {
    net = createNetwork({
      codec: createProtobufCodec(schema),
      url: d.wsUrl,
      // 心跳用契约里的 Ping，而不是 core 默认的 '__ping'——后者不在 schema 里，
      // 编码时会直接抛「未知消息类型」。服务端回的 Pong 走 seq=0 推送，不占请求位。
      heartbeat: { type: 'Ping' },
    });
    root.register(NETWORK, { useValue: net });
  }
  if (!root.tryResolve(GATEWAY_MIGRATION)) {
    const info = ctx.bag.get(APP_INFO);
    root.register(GATEWAY_MIGRATION, {
      useValue: createGatewayMigration(net, d.wsUrl, () => dispatchAgain(info)),
    });
  }
  await waitOpen(net, d.wsUrl);

  // 一次 Ping 往返当作接入自检：连上 ≠ 协议对得上（帧头字节序、cmd 表、pb 编码
  // 任一错都在这里现形，而不是等某个业务包发不出去才发现）。顺带拿到 RTT。
  const t0 = Date.now();
  const pong = (await net.request('Ping', { clientTimeMs: t0 }, { timeoutSec: 5 })).body as {
    serverTimeMs: number;
  };
  console.log(
    `${TAG} 长连接就绪 ${d.wsUrl} · RTT ${Date.now() - t0}ms · 服务器时间 ${pong.serverTimeMs}`,
  );
}

import {
  createNetwork,
  createPbSchema,
  createProtobufCodec,
  getRootContainer,
  getTimer,
  DISPATCH,
  NETWORK,
  type DispatchResult,
  type INetwork,
  type LaunchStep,
  type PbSchema,
} from '@cck/core';
import { kit } from '@kit/proto';
import { CMD } from '@kit/proto/cmd';

/**
 * 协议接入 —— 契约（`@kit/proto`）与 kit 的 `PbSchema` 接缝之间的**项目侧胶水**。
 *
 * 按 ADR-0011，kit（core / engine）里不出现任何 cmd 号或消息定义：core 只认 `PbSchema`
 * 这个接口，契约的生成产物由**接入方**喂进来。所以这一层归 apps/demo，不归 packages/。
 * 换契约（或某个项目自带一套协议）只换这个文件，kit 一行不动。
 *
 * 与 Bootstrap 同放 `assets/scenes/`：它和启动序列同生命周期，随主包一起进内存，
 * 不属于任何可卸载 bundle。
 */

const TAG = '[CCK-NET]';

/**
 * protobufjs static-module 生成的消息类，只用到这两个方法。
 * `kit.v1` 是「消息名 → 类」的命名空间对象，正好和 `CMD` 的「消息名 → cmd 号」对上——
 * 这不是巧合：`CMD` 就是 kit-proto 从 `Cmd` 枚举按同一命名约定生成的，对不上它生成期就炸。
 */
interface PbMessageType {
  encode(message: unknown): { finish(): Uint8Array };
  decode(bytes: Uint8Array): unknown;
}

/** 契约生成产物 → core 的 {@link PbSchema}。 */
export function createKitSchema(): PbSchema {
  const types = kit.v1 as unknown as Readonly<Record<string, PbMessageType>>;
  return createPbSchema(CMD, {
    // `?? {}`：心跳走 `send('Ping')` 不带 body，而 pb 的 encode 会读 message 的字段。
    encodeBody: (type, body) => types[type].encode(body ?? {}).finish(),
    decodeBody: (type, bytes) => types[type].decode(bytes),
  });
}

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
 * 启动序列的「连长连接」一步：按 dispatcher 下发的 `wsUrl` 连网关并注册进 DI。
 *
 * 排在 `dispatch` 阶段（`demo-net-info` 之后）—— wsUrl 是那一步拿到的，且**按本客户端
 * 版本路由**，不能写死在配置里。此后业务侧 `getNetwork()` 直接拿到已连上的实例。
 *
 * 失败不吞：抛出去由 App 判成 `network`（可重试），LaunchOverlay 给重试按钮。
 * 重试时复用 DI 里那条连接（core 的重连在后台一直退避重试），不新建。
 */
export function netConnectStep(): LaunchStep {
  return {
    name: 'demo-net-connect',
    phase: 'dispatch',
    async run(ctx) {
      const d = ctx.bag.get(DISPATCH) as DispatchResult | undefined;
      if (!d?.wsUrl) return; // 没配 dispatcher（单机跑）→ 这步不存在

      const root = getRootContainer();
      let net = root.tryResolve(NETWORK);
      if (!net) {
        net = createNetwork({
          codec: createProtobufCodec(createKitSchema()),
          url: d.wsUrl,
          // 心跳用契约里的 Ping，而不是 core 默认的 '__ping'——后者不在 schema 里，
          // 编码时会直接抛「未知消息类型」。服务端回的 Pong 走 seq=0 推送，不占请求位。
          heartbeat: { type: 'Ping' },
        });
        root.register(NETWORK, { useValue: net });
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
    },
  };
}

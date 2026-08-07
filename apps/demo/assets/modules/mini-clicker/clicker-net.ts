import { getRootContainer, NETWORK, PB_SCHEMA } from '@cck/core';
import { pbSegment } from '../../foundation/net/schema';
import { CMD, game, kit } from './clicker-proto';

/**
 * 本模块的协议接线 —— **协议段随 bundle 走的那一半**。
 *
 * 基础段（握手 / 心跳 / 错误）在主包，改了要整包更新；本模块的 cmd 1000–1999 则由
 * `clicker-proto.ts`（契约仓的模块段产物，整个拷进本 bundle）带着，随 bundle 热更。
 * 加载时注册进全局注册表，释放时注销 —— 全程连接不断、codec 实例不换。
 *
 * 契约同步：`clicker-proto.ts` 来自 `@kit/proto` 的 `gen/ts/game/clicker.ts`，
 * 升级契约后要重新拷（`pnpm proto:sync`）。
 */

const TAG = '[CCK-CLICKER]';

/**
 * 把本模块的协议段注册进全局注册表。
 *
 * @returns 注销函数 —— 交给 `ctx.scope.add()`，bundle 释放时自动摘掉。
 *   注销后服务端若还推本段的消息，`decode` 会因 cmd 未知抛错、被 core 吞成一条 warn，
 *   这是预期的降级。
 */
export function registerClickerProto(): () => void {
  const schema = getRootContainer().resolve(PB_SCHEMA);
  // 幂等：`onShow` 会随界面重建再调一次（转屏 / 换皮），而协议段的生命周期是 **bundle**
  // 不是界面实例。已注册就给个空注销，别让第二次进来撞「消息类型已注册」。
  if (schema.cmdOf('ClickRequest') !== undefined) return () => {};
  return schema.add(CMD, pbSegment(game.clicker.v1));
}

/**
 * 拿本模块的协议真发一次请求，验证「模块段注册后即可用」。
 *
 * 没有长连接（单机跑）就静默跳过 —— 分包验证不该把本地调试卡死。
 *
 * ⚠️ **别把响应内容当业务结果**：clicker 是契约仓的号段样板，服务端没有这个玩法。
 * 实测回的是基础段的 `Error{NOT_HANDSHAKED}`（网关认出这是要鉴权的业务 cmd）。
 * 那恰恰是分包要证的东西：**模块段负责把 cmd 1000 编出去，基础段负责把 cmd 13 解回来，
 * 两段在同一张注册表里各司其职**。所以这里打印原始 `type` 和 body，不装作读懂了它。
 */
export async function clickerPing(count: number): Promise<void> {
  const net = getRootContainer().tryResolve(NETWORK);
  if (!net || net.state !== 'open') return;
  try {
    const res = await net.request('ClickRequest', { count }, { timeoutSec: 5 });
    console.log(`${TAG} 模块段往返 OK ← ${res.type} ${JSON.stringify(res.body)}`);
  } catch (e) {
    // 服务端若改成回 Error（cmd 13，基础段）会走这里——同样说明链路是通的。
    const code = (e as { body?: { code?: kit.v1.ErrorCode } })?.body?.code;
    console.warn(`${TAG} ClickRequest 未拿到响应（code=${code ?? '?'}）：${String(e)}`);
  }
}

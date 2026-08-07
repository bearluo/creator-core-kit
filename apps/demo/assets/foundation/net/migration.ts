import {
  createToken,
  defaultLaunchSteps,
  getApp,
  APP_INFO,
  DISPATCH,
  type DispatchResult,
  type INetwork,
  type Token,
} from '@cck/core';

/**
 * 网关退休搬家 —— 收到 `GatewayRetiring`（推送，cmd 16）后**择机**换网关。
 *
 * 这条消息**不是踢人**：连接照常可用，只是这台网关要停服了。什么时候搬由客户端定
 * （契约只说 what），本 demo 取「回到大厅」这个时机（见 `LobbyHost.enterLobby`）。
 *
 * 新地址**只能从握手拿**：契约不带 `ws_url`，dispatcher 才是唯一的路由真相 ——
 * 猜地址 / 复用旧地址会绕过维护模式与版本退休。
 */

const TAG = '[CCK-NET]';

export interface GatewayMigration {
  /** 是否收到过退休通知且尚未搬走。 */
  readonly pending: boolean;
  /** 到了合适的时机调它（回大厅 / 战斗结束 / 切场景）。没在退休就是 no-op。 */
  atSafePoint(): Promise<void>;
  /** 撤订阅。 */
  dispose(): void;
}

/**
 * 建搬家器。`rehandshake` 是「重走一遍握手拿新 wsUrl」这个动作的接缝——
 * 生产由 {@link dispatchAgain} 提供（真打 HTTP），测试注入假的。
 * `currentUrl` 是此刻连着的那个网关，用来识破「握手又把我派回这台」。
 */
export function createGatewayMigration(
  net: INetwork,
  currentUrl: string,
  rehandshake: () => Promise<string>,
): GatewayMigration {
  let pending = false;
  let migrating = false;
  let here = currentUrl;

  const migrate = async (): Promise<void> => {
    if (!pending || migrating) return;
    migrating = true;
    try {
      const url = await rehandshake();
      if (!url) return; // 握手没给地址（维护 / 强更）→ 留在原网关，下次时机再试
      // dispatcher 又把我派回这台。**握手没有缓存**，拿到的就是它此刻的路由真相——
      // 它还往这台派人，说明这台现在在它眼里可用：要么退休撤销了（契约没有「取消」这种
      // 消息，只能这么推断），要么运维还没把它摘出路由池。这两者从客户端看不可区分，
      // 也不必区分：**都是「此刻不用搬」**。所以不重连（省掉白抖一次），并把标志撤下来
      // ——挂着它只会让此后每个时机、每次断线都白打一次握手，永远清不掉。
      //
      // 撤掉是安全的，服务端有两条路会再叫醒我：① 真还在退休的话，连接一断重连上去
      // 立刻又收到一条 `GatewayRetiring`（真服务器实测如此），标志重新置起；
      // ② deadline 到点会 `Kick` + 断连，走下面 onState 那条重新握手。
      if (url === here) {
        pending = false;
        console.log(`${TAG} 握手仍指向 ${url} → 此刻无需搬家（退休已撤销，或路由尚未摘除）`);
        return;
      }
      here = url;
      pending = false;
      // 先 close 再 connect：close 会把在途 request 立刻 reject（否则它们要挂到超时才知道
      // 已经换了连接）。旧 socket 由 engine 侧的 ISocket 在 connect 时一并弃掉。
      net.close();
      net.connect(url);
      console.log(`${TAG} 网关搬家 → ${url}`);
    } catch (e) {
      // 握手失败不升级成故障：老网关还活着，下个时机再试。
      console.warn(`${TAG} 网关搬家握手失败，暂留原网关：${String(e)}`);
    } finally {
      migrating = false;
    }
  };

  const offPush = net.on('GatewayRetiring', (body) => {
    const b = (body ?? {}) as { deadlineAtMs?: number; msg?: string };
    // 后一条完全覆盖前一条：这里只是把标志重新置起，**不叠加任何计时器**。
    pending = true;
    // deadline 是给日志看的，不做倒计时 UI：`0`（常态）意味着根本不会被踢，把它做成必填
    // 就退化成「每次发版给玩家一个倒计时」，正是这条消息要消灭的东西。非 0 时也不必本地
    // 计时——到点服务端会发 Kick 并断开，那条路径由下面的 onState 兜住。
    console.log(
      `${TAG} 收到 GatewayRetiring（连接照常可用）deadline=${b.deadlineAtMs || '无'} msg=${b.msg ?? ''}`,
    );
  });

  // 退休期间掉线（deadline 到点的 Kick、或普通网络抖动）→ **别按老地址退避重连**，
  // 那台网关正在下线。先握手换地址再连。握手失败时不干预，core 的退避照常走，
  // 下一轮断开会再进来一次。
  const offState = net.onState((s) => {
    if (s === 'reconnecting' && pending) void migrate();
  });

  return {
    get pending(): boolean {
      return pending;
    },
    atSafePoint: migrate,
    dispose(): void {
      offPush();
      offState();
    },
  };
}

/** DI token：当前 kit 的网关搬家器。业务侧在自己认为合适的时机取它调 `atSafePoint()`。 */
export const GATEWAY_MIGRATION: Token<GatewayMigration> =
  createToken<GatewayMigration>('demo.gatewayMigration');

/**
 * 重走一遍启动握手，返回新的 `wsUrl`（拿不到就是空串）。
 *
 * 直接复用 kit 默认序列里的 `dispatch` 步——同一段请求体、同一套 code / action 解析，
 * 不另写一份会漂移的副本。`appInfo` 是启动时那一步读出的 app 戳：版本 / capabilityStamp
 * 决定 dispatcher 把你路由到哪个部署单元，丢了它重连就可能落到另一组机器上。
 */
export async function dispatchAgain(appInfo: unknown): Promise<string> {
  const step = defaultLaunchSteps().find((s) => s.name === 'dispatch')!;
  const bag = new Map<string, unknown>([[APP_INFO, appInfo]]);
  // action 非 play（强更 / 维护）时这一步会抛，由调用方吞成一条 warn。
  await step.run({ config: getApp().config, bag, report: () => {} });
  return (bag.get(DISPATCH) as DispatchResult | undefined)?.wsUrl ?? '';
}

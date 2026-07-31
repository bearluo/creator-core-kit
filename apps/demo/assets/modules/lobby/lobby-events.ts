/**
 * 大厅框架事件名（core EventBus，跨 bundle 单例）。
 * 单独一个零依赖小文件：game 模块 bundle（如 mini-dodge）只 import 这个 const 即可发「返回大厅」，
 * 不必拖入整个 LobbyHost 模块 → 模块 bundle 对主包的运行时依赖最小化（守设计 §3）。
 */
export const LOBBY_EVENTS = {
  /** game 类模块场景内点「返回大厅」时 emit（无 payload）。 */
  back: 'lobby:back',
} as const;

/** 大厅 EventBus 事件类型表（喂 `getEventBus<LobbyEventMap>()`，否则默认空 EventMap 的 key 为 never）。 */
export interface LobbyEventMap {
  'lobby:back': void;
}

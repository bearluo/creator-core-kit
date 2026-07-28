---
模块: network
所在包: packages/core（Network 纯逻辑：连接状态机 + 请求关联 + 重连 + 心跳 + 路由 + 内存 fake，零 cc）；平台 WebSocket 适配走 engine ISocket，协议编解码走项目 ICodec
状态: 已实现          # 草案 → 评审中 → 已定稿 → 已实现
摘要: 长连接客户端 createNetwork——连接生命周期 + send + request(seq 关联+超时) + on(type) 推送路由 + 自动重连(指数退避) + 心跳保活，调度全注入 ITimer（测试手动 tick 确定性）。core 定义 INetwork + ISocket（传输接缝）+ ICodec（协议接缝，seq 落位/读取由 codec 桥接，不锁协议格式），零 cc。
何时读: 需要长连接、请求响应 RPC、断线重连、心跳、服务器推送路由，或为某平台接 socket/换协议编解码时。
日期: 2026-07-28
依赖: di（NETWORK/NETWORK_SOCKET token）、[[timer]]（重连/超时/心跳调度注入 ITimer）、logger（告警）、[[adr-0001]]（跨 bundle 走全局 token）。ISocket 平台适配走 engine（后续）。横评见 docs/research/2026-07-28-network-survey.md。对标 oops-framework NetManager/NetNode。
---

# Network / 协议层（INetwork）设计文档

## TL;DR

`createNetwork({ socket?, codec?, timer?, url?, reconnect?, heartbeat? })` 返回 `INetwork`：`connect/close`；`send(type, body)` fire-and-forget；`request(type, body, {timeoutSec})` 走 **seq 关联 + 超时** 返回响应信封；`on(type, handler)` 推送路由；`onState(cb)` 状态订阅。**完整客户端**（用户定 2026-07-28）：内建**自动重连**（指数退避 [min,max] + maxAttempts）+ **心跳保活**（一间隔零入站判死→重连），调度**全注入 [[timer]]**（测试手动 `tick` 确定性、无真实时钟）。**core 零 cc**：连接状态机/请求关联/重连/心跳/路由全可 node 单测；真实传输经 `ISocket`（engine 适配平台 WebSocket）、协议字节经 `ICodec`（默认 JSON，**seq 落位/读取由 codec 桥接**，换 protobuf 只换 codec）。

## Purpose（目标与定位）

- **做什么**：游戏长连接客户端——把平台分裂的 socket、无内建的 RPC/重连/心跳/推送路由收敛为一个 `INetwork`。
- **定位/取舍**：**瘦 core 半 + ISocket/ICodec 接缝**（按铁律预定，`INetwork` 是 core 接口）。core 持连接状态机 + 请求关联 + 重连退避 + 心跳 + 路由（**可 node 单测**）；engine `ISocket` 做平台传输 IO（Web 原生 WebSocket / native jsb WebSocket / 小游戏 wx.connectSocket），项目 `ICodec` 做协议编解码。调度注入 [[timer]]（`delay`/`interval` + 手动 tick）。
- **请求关联为何「自增 seq + codec 桥接」**（用户 2026-07-28 提「服务器不回传 id 怎么匹配」）：seq 关联的前提是**服务器把请求的关联 id 原样回传**（几乎所有游戏协议都有 seq/reqId/serial 字段）。框架分配自增 seq，但**把 seq 落到/读出协议约定字段的活交给 ICodec**——换协议只换 codec，core 关联逻辑不动。响应读不出 seq → 当推送按 type 路由；服务器完全不回传任何 id → RPC 不可用，退化为 send + on(type)（协议约束，见 Open Questions #2）。
- **YAGNI（首版砍）**：HTTP 短请求（另一形状，建议单独模块——用户定只做消息型 socket）；发送队列/离线缓冲（未连接 request 直接 reject、send 告警丢弃）；重连中在途请求重发（断线即 fail pending，上层重发）；协议级错误码建模（request resolve 整个信封，app 自查 body）；消息压缩/分片（codec/engine 内部事）。

## Public API（TypeScript 精确签名）

```ts
// —— 协议接缝（core 定义，项目实现）——
export interface NetMessage { type: string; body?: unknown; seq?: number; }
export interface ICodec { encode(msg: NetMessage): unknown; decode(data: unknown): NetMessage; }
export function createJsonCodec(): ICodec;

// —— 传输接缝（core 定义，engine 实现）——DOM WebSocket 风格可赋值回调
export interface ISocket {
  connect(url: string): void; send(data: unknown): void; close(): void;
  onOpen?: () => void; onMessage?: (data: unknown) => void; onClose?: () => void; onError?: (err: unknown) => void;
}
export const NETWORK_SOCKET: Token<ISocket>;
export function createMemorySocket(): ISocket;   // 空 socket（永不 open），默认 + 测试

// —— 消费接口（core 实现）——
export type NetState = 'closed' | 'connecting' | 'open' | 'reconnecting';
export type NetHandler = (body: unknown, msg: NetMessage) => void;
export interface ReconnectOptions { enabled?: boolean; minDelaySec?: number; maxDelaySec?: number; maxAttempts?: number; }
export interface HeartbeatOptions { enabled?: boolean; intervalSec?: number; type?: string; }
export interface RequestOptions { timeoutSec?: number; }
export interface INetwork {
  readonly state: NetState;
  connect(url?: string): void;
  close(): void;
  send(type: string, body?: unknown): void;
  request(type: string, body?: unknown, opts?: RequestOptions): Promise<NetMessage>;
  on(type: string, handler: NetHandler): Disposer;
  off(type: string, handler: NetHandler): void;
  onState(cb: (s: NetState) => void): Disposer;
}
export const NETWORK: Token<INetwork>;
export function getNetwork(): INetwork;
export function createNetwork(opts?: NetworkOptions): INetwork;
```

## Behavior & data flow（行为与数据流）

- **状态机**：`closed →(connect) connecting →(socket.onOpen) open`；`open →(socket.onClose 意外) reconnecting →(退避 delay) connecting → …`（reconnect 关则直接 closed）；任意态 `→(close) closed`。`onState` 广播变化。
- **connect(url?)**：覆盖 url、重置 attempt、取消待定重连 → `socket.connect(url)`；无 url → 告警 closed。
- **onOpen**：attempt 归 0 → open → 启动心跳。
- **onMessage(data)**：`alive=true`（心跳保活）→ `codec.decode`（失败告警丢弃）→ 若 `seq` 命中 pending → 兑现该 request（并取消其超时）；否则按 `type` 派发到 `on` handler（无 handler 则 no-op）。
- **send(type, body)**：非 open → 告警丢弃；否则 `socket.send(codec.encode({type, body}))`。
- **request(type, body, {timeoutSec=10})**：非 open → 立即 reject；分配 seq → 挂 pending + `timer.delay(timeout)` 超时 reject → 发 `{type, body, seq}`。
- **心跳（注入 timer.interval）**：open 时启，`intervalSec` 一到——上间隔有入站(`alive`) → 发 ping、`alive=false`；上间隔零入站 → 判死 `socket.close()`（→ onClose → 重连）。
- **重连（注入 timer.delay）**：意外 onClose → fail 所有 pending（'connection lost'）→ 退避 `min(max, min×2^attempt)` 后 attempt++ 重连；超 maxAttempts（>0 时）放弃 closed。
- **close()**：取消重连 + 停心跳 + fail pending（'closed'）+ setState closed + `socket.close()`（onClose 见 closed 即止，不重连）。
- **默认解析**：`socket = opts.socket ?? tryResolve(NETWORK_SOCKET) ?? 空 socket`；`codec ?? JSON`；`timer ?? getTimer()`。
- **与 cc 边界**：INetwork/状态机/内存 fake 全在 core（零 cc）。engine 实现 `ISocket`：包平台 WebSocket（onopen/onmessage/onclose/onerror 转 core 回调，connect 每次新建底层连接支持重连）。属**有状态引擎行为**，ADR-0002 不进 cc mock，走 apps/demo 集成验证。

## Key design decisions（决策表）

| # | 维度 | 选项 | 选定 | 理由 |
|---|---|---|---|---|
| 1 | v1 范围 | 精简 / **完整客户端（含重连+心跳）** | **完整**（用户定 2026-07-28） | 移动长连接刚需；调度注入 ITimer 后仍全可测 |
| 2 | 传输 | 含 HTTP / **只消息型 socket** | **只 socket**（用户定 2026-07-28） | HTTP 是另一形状，单独模块更清爽 |
| 3 | 请求关联 | 类型匹配 / **自增 seq + codec 桥接** | **seq + codec 桥接**（用户定 2026-07-28） | 对业务透明、同类并发不歧义；seq 落位交 codec 不锁协议 |
| 4 | 调度 | 内建 setTimeout / **注入 ITimer** | **注入 [[timer]]** | 测试手动 tick 确定性、无真实时钟；复用既有 |
| 5 | 心跳判死 | ping+pong 超时 / **一间隔零入站判死** | **零入站判死** | 单 interval + alive 标志即可，够用可测（检测窗口=intervalSec）|
| 6 | 断线在途请求 | 重发 / **fail pending** | **fail pending** | 简单正确；上层按需重发 |
| 7 | 推送路由 | 复用 EventBus / **内建轻量 Map 路由** | **内建轻量** | 连接内消息 ≠ 全局事件，避免强耦合 [[eventbus]] |
| 8 | DI 便捷 | 仅工厂 / **NETWORK + NETWORK_SOCKET token + getNetwork** | **都给** | 对齐姊妹模块 token+fallback 范式 |

## Platform considerations（全平台 / 小游戏兼容）

- core（状态机/关联/重连/心跳/路由/内存 fake）纯 TS，全平台无差异。
- engine `ISocket` 适配：Web 原生 `WebSocket`；native jsb `WebSocket`；小游戏 `wx.connectSocket`/`tt.connectSocket`（回调式、单连接限制——适配层抹平）。
- 协议 `ICodec`：JSON 默认；protobuf/自定义二进制换 codec（seq 落位随协议约定）。
- 跨 bundle 共享 Network 走全局 `NETWORK` token（[[adr-0001]]）。
- 调度依赖 [[timer]]：网络计时跟随注入的 timer；如需与游戏暂停解耦（切后台不冻结网络超时），注入独立的非缩放 timer 实例。

## Testable seams + test plan（可测接缝 + vitest 用例）

- **可测性**：全纯 TS 零 cc；spy `ISocket`（记 connect/send/close，`open()/recv()/drop()/err()` 模拟底层事件）+ 透传 codec（sent[] 直接是信封）+ `createTimer()` 手动 `tick` 驱动超时/重连/心跳 + fake logger。
- **用例清单**（已实现，28 用例）：连接状态流转/onState、无 url、connect(url) 覆盖、主动 close 不重连；send 连/未连、request+seq 匹配/未连 reject/超时/并发递增/带 seq 未命中落路由/断线 fail pending；on/off/disposer、handler 抛错隔离、无 handler no-op；意外断→退避重连→open、退避指数递增、maxAttempts 放弃、reconnect 关即 closed、close 取消待定重连；心跳 ping+保活、判死、心跳关不发；JSON codec round-trip、decode 失败告警、socket onError 告警、空 socket no-op、getNetwork 单例/register 覆盖/tryResolve(NETWORK_SOCKET)。

## Open Questions（已决议 · 2026-07-28）

1. **完整客户端 / 只消息型 socket / seq+codec 桥接**：✅（用户定）。
2. **服务器须回传关联 id 才能 RPC**（用户 2026-07-28 提出）：seq 关联依赖服务器把请求 id 原样回传；协议若不携带/不回传任何关联 id，则 `request()` 不可用，退化为 `send` + `on(type)` 由业务自关联。这是协议约束，非框架可补。codec 负责把 seq 落到协议约定字段——已是可换点。
3. HTTP 短请求：单独模块（本模块只长连接）。
4. 网络计时与游戏暂停解耦：注入独立非缩放 timer（文档标注），需要时再定默认。

---

## 实现记录

- **落地文件**：`packages/core/src/network/socket.ts`（`ISocket` + `NETWORK_SOCKET` + `createMemorySocket`）、`codec.ts`（`NetMessage` + `ICodec` + `createJsonCodec`）、`network.ts`（`createNetwork` + `INetwork`/状态机/重连/心跳/请求关联 + `NETWORK` + `getNetwork`）、`index.ts`；core `index.ts` re-export（`export * from './network'`）。
- **最终 API 与设计偏差**：无偏差，与定稿一致。
  1. request 超时回调去掉了 `if (pending.delete)` 守卫——entry 被移除的每条路径（resolve/断线/close）都会 `cancelTimeout` 停掉该 timer，故 timer 触发时 entry 必在，守卫的 false 分支不可达（消死分支保 100%）。
  2. 心跳判死采「一间隔零入站」单标志实现（`alive`），非 ping/pong 双超时——更简洁可测，检测窗口=intervalSec。
- **测试结果 / 覆盖率**：`network.test.ts` **28 用例全绿**；`socket.ts`、`codec.ts`、`network.ts`、`index.ts` 均 **100% Stmts/Branch/Funcs/Lines**（全量 326 passed）。
- **commit / PR**：待提交。
- **遗留 Minors**：engine 侧 `ISocket` 的平台 WebSocket 适配（Web/native/小游戏）+ 注册 `NETWORK_SOCKET`（随 apps/demo 集成）；HTTP 短请求、发送队列/离线缓冲、协议错误码建模、非缩放 timer 默认留后续（YAGNI）。

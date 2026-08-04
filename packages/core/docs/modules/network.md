---
模块: network
所在包: packages/core（Network 纯逻辑：连接状态机 + 请求关联 + 重连 + 心跳 + 路由 + 内存 fake，零 cc）；平台 WebSocket 适配走 engine ISocket，协议编解码走项目 ICodec
状态: 已实现          # 草案 → 评审中 → 已定稿 → 已实现
摘要: 长连接客户端 createNetwork——连接生命周期 + send + request(seq 关联+超时) + on(type) 推送路由 + 自动重连(指数退避) + 心跳保活，调度全注入 ITimer（测试手动 tick 确定性）。core 定义 INetwork + ISocket（传输接缝）+ ICodec（协议接缝，seq 落位/读取由 codec 桥接，不锁协议格式）+ IHttp（短请求接缝，POST-only RPC），零 cc。
何时读: 需要长连接、请求响应 RPC、断线重连、心跳、服务器推送路由、HTTP 短请求，或为某平台接 socket/http、换协议编解码时。
日期: 2026-08-04
依赖: di（NETWORK/NETWORK_SOCKET/HTTP token）、[[timer]]（重连/超时/心跳调度注入 ITimer）、logger（告警）、[[adr-0001]]（跨 bundle 走全局 token）、[[adr-0011]]（服务端分仓 + 协议契约）。ISocket / IHttp 平台适配走 engine。横评见 docs/research/2026-07-28-network-survey.md。对标 oops-framework NetManager/NetNode。
---

# Network / 协议层（INetwork）设计文档

## TL;DR

`createNetwork({ socket?, codec?, timer?, url?, reconnect?, heartbeat? })` 返回 `INetwork`：`connect/close`；`send(type, body)` fire-and-forget；`request(type, body, {timeoutSec})` 走 **seq 关联 + 超时** 返回响应信封；`on(type, handler)` 推送路由；`onState(cb)` 状态订阅。**完整客户端**（用户定 2026-07-28）：内建**自动重连**（指数退避 [min,max] + maxAttempts）+ **心跳保活**（一间隔零入站判死→重连），调度**全注入 [[timer]]**（测试手动 `tick` 确定性、无真实时钟）。**core 零 cc**：连接状态机/请求关联/重连/心跳/路由全可 node 单测；真实传输经 `ISocket`（engine 适配平台 WebSocket）、协议字节经 `ICodec`（默认 JSON，**seq 落位/读取由 codec 桥接**，换 protobuf 只换 codec）。

## Purpose（目标与定位）

- **做什么**：游戏长连接客户端——把平台分裂的 socket、无内建的 RPC/重连/心跳/推送路由收敛为一个 `INetwork`。
- **定位/取舍**：**瘦 core 半 + ISocket/ICodec 接缝**（按铁律预定，`INetwork` 是 core 接口）。core 持连接状态机 + 请求关联 + 重连退避 + 心跳 + 路由（**可 node 单测**）；engine `ISocket` 做平台传输 IO（Web 原生 WebSocket / native jsb WebSocket / 小游戏 wx.connectSocket），项目 `ICodec` 做协议编解码。调度注入 [[timer]]（`delay`/`interval` + 手动 tick）。
- **请求关联为何「自增 seq + codec 桥接」**（用户 2026-07-28 提「服务器不回传 id 怎么匹配」）：seq 关联的前提是**服务器把请求的关联 id 原样回传**（几乎所有游戏协议都有 seq/reqId/serial 字段）。框架分配自增 seq，但**把 seq 落到/读出协议约定字段的活交给 ICodec**——换协议只换 codec，core 关联逻辑不动。响应读不出 seq → 当推送按 type 路由；服务器完全不回传任何 id → RPC 不可用，退化为 send + on(type)（协议约束，见 Open Questions #2）。
- **HTTP 短请求为什么也在这**：启动握手（dispatcher）、版本表、公告这类一问一答的东西**架在 socket 上要先连上才能问**，而「能不能连、连哪台」正是握手要回答的。所以 `IHttp` 与 `ISocket` 并列，同属「跟服务器说话」这个模块。
- **YAGNI（本版砍）**：发送队列/离线缓冲（未连接 request 直接 reject、send 告警丢弃）；重连中在途请求重发（断线即 fail pending，上层重发）；协议级错误码建模（request resolve 整个信封，app 自查 body）；消息压缩/分片（codec/engine 内部事）；HTTP 侧的重试 / 拦截器 / 并发限流（调用方按需包一层）。

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

// —— HTTP 短请求接缝（core 定义，engine 实现）——
export interface HttpRequest {
  readonly url: string;
  readonly method?: 'GET' | 'POST';
  readonly body?: string;                              // 已序列化
  readonly headers?: Readonly<Record<string, string>>;
  readonly timeoutSec?: number;
}
export interface HttpResponse { readonly status: number; readonly text: string; }
export interface IHttp { request(req: HttpRequest): Promise<HttpResponse>; }
export const HTTP: Token<IHttp>;
export function getHttp(): IHttp;                      // 未注册直接抛（core 做不了 IO，没有默认实现）
export function postJson(http: IHttp, url: string, body: unknown, timeoutSec?: number): Promise<unknown>;

// —— protobuf 帧编解码（帧头拆装在框架，具体协议全在注入的 schema 里）——
export interface PbSchema {
  cmdOf(type: string): number | undefined;
  typeOf(cmd: number): string | undefined;
  encodeBody(type: string, body: unknown): Uint8Array;
  decodeBody(type: string, bytes: Uint8Array): unknown;
}
export function createProtobufCodec(schema: PbSchema): ICodec;
export function createPbSchema(
  cmds: Readonly<Record<string, number>>,
  body: Pick<PbSchema, 'encodeBody' | 'decodeBody'>,
): PbSchema;
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
| 2 | 传输 | socket / **socket + HTTP 短请求** | **两者都在本模块**，各出一个接缝（`ISocket` / `IHttp`） | 启动握手要先于连接发生，架不到 socket 上；两者都是「跟服务器说话」，拆两个模块只会让 DI 装配多一处 |
| 2b | HTTP 返回值形状 | 解析好的对象 / **`{status, text}`** | **原始文本** | content-type 嗅探与 JSON 解析留在 core（可 node 单测），适配层只搬字节；非 200 也 resolve —— **业务错误本就走 200 + body 里的 code**，状态码只表达传输层出事 |
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
- **`IHttp` 在 web 上受 CORS 约束，native / 小游戏不受**。浏览器预览与 web-mobile 构建打跨域接口时，服务端必须回 `Access-Control-Allow-*` 并放行 `OPTIONS` 预检——**这是服务端的事，客户端补不了**（XHR 只会拿到一个不说原因的 `onerror`，看着像「服务器挂了」）。排查时先在浏览器控制台看有没有 CORS 字样，别在客户端这边找。
- 跨 bundle 共享 Network 走全局 `NETWORK` token（[[adr-0001]]）。
- 调度依赖 [[timer]]：网络计时跟随注入的 timer；如需与游戏暂停解耦（切后台不冻结网络超时），注入独立的非缩放 timer 实例。

## Testable seams + test plan（可测接缝 + vitest 用例）

- **可测性**：全纯 TS 零 cc；spy `ISocket`（记 connect/send/close，`open()/recv()/drop()/err()` 模拟底层事件）+ 透传 codec（sent[] 直接是信封）+ `createTimer()` 手动 `tick` 驱动超时/重连/心跳 + fake logger。
- **用例清单**（已实现，28 用例）：连接状态流转/onState、无 url、connect(url) 覆盖、主动 close 不重连；send 连/未连、request+seq 匹配/未连 reject/超时/并发递增/带 seq 未命中落路由/断线 fail pending；on/off/disposer、handler 抛错隔离、无 handler no-op；意外断→退避重连→open、退避指数递增、maxAttempts 放弃、reconnect 关即 closed、close 取消待定重连；心跳 ping+保活、判死、心跳关不发；JSON codec round-trip、decode 失败告警、socket onError 告警、空 socket no-op、getNetwork 单例/register 覆盖/tryResolve(NETWORK_SOCKET)。

## Open Questions（已决议 · 2026-07-28）

1. **完整客户端 / 只消息型 socket / seq+codec 桥接**：✅（用户定）。
2. **服务器须回传关联 id 才能 RPC**（用户 2026-07-28 提出）：seq 关联依赖服务器把请求 id 原样回传；协议若不携带/不回传任何关联 id，则 `request()` 不可用，退化为 `send` + `on(type)` 由业务自关联。这是协议约束，非框架可补。codec 负责把 seq 落到协议约定字段——已是可换点。
3. 网络计时与游戏暂停解耦：注入独立非缩放 timer（文档标注），需要时再定默认。

---

## 实现记录

- **落地文件**：`packages/core/src/network/socket.ts`（`ISocket` + `NETWORK_SOCKET` + `createMemorySocket`）、`codec.ts`（`NetMessage` + `ICodec` + `createJsonCodec`）、`pb-codec.ts`（`PbSchema` + `createProtobufCodec` + `createPbSchema`）、`http.ts`（`IHttp` + `HTTP` + `getHttp` + `postJson`）、`network.ts`（`createNetwork` + `INetwork`/状态机/重连/心跳/请求关联 + `NETWORK` + `getNetwork`）、`index.ts`；core `index.ts` re-export（`export * from './network'`）。
- **最终 API 与设计偏差**：无偏差，与定稿一致。
  1. request 超时回调去掉了 `if (pending.delete)` 守卫——entry 被移除的每条路径（resolve/断线/close）都会 `cancelTimeout` 停掉该 timer，故 timer 触发时 entry 必在，守卫的 false 分支不可达（消死分支保 100%）。
  2. 心跳判死采「一间隔零入站」单标志实现（`alive`），非 ping/pong 双超时——更简洁可测，检测窗口=intervalSec。
- **测试结果 / 覆盖率**：`network.test.ts` **28 用例全绿**；`socket.ts`、`codec.ts`、`network.ts`、`index.ts` 均 **100% Stmts/Branch/Funcs/Lines**（全量 326 passed）。
- **commit / PR**：待提交。
- **遗留 Minors**：engine 侧 WebSocket 适配已实现（见下，覆盖 Web/native；小游戏 wx.connectSocket 后续）；HTTP 短请求、发送队列/离线缓冲、协议错误码建模、非缩放 timer 默认留后续（YAGNI）。

### engine 半适配（WebSocket 的 ISocket 实现，2026-07-28）

- **落地文件**：`packages/engine/src/net-socket.ts`——`createWebSocketSocket()`（`ISocket` 的平台 WebSocket 实现）+ `ccNetworkModule()`（注册 `NETWORK_SOCKET`）；engine `index.ts` 导出。
- **实现**：把平台 WebSocket 的底层事件桥到 core 挂的回调（`onOpen/onMessage/onClose/onError`）。重连由 core 编排——core 每次调 `connect(url)` 时本壳**新建底层 WebSocket、复用同一组回调**；用 **identity 卫（`ws === sock`）** 忽略被替换掉的旧连接的迟到事件，避免重连时旧 socket 串扰。`close()` 先把 `ws` 置空（identity 卫随即失效 → 本次 close 触发的 `onclose` 不再回传 core，core 已同步收尾）再关底层。`connect` 前 `typeof WebSocket === 'undefined'` 守缺失平台 → `onError`+`onClose` 优雅降级。
- **覆盖**：Web 浏览器 `WebSocket` + native jsb 提供的 DOM 兼容 `WebSocket` 全局。**ponytail**：小游戏（`wx.connectSocket`）非 DOM WebSocket，不在此壳内，需要时另写 `wxSocket` 适配。
- **类型策略**：`WebSocket`/`MessageEvent`/`Event`/`XMLHttpRequest` 来自根 `tsconfig.base.json` 的 `lib:["ES2021","DOM"]` 全局（属 DOM 平台全局，非 `cc` 导出，与 ADR-0005 的 creator-types 类型源并存）。

### engine 半适配（IHttp 的 XHR 实现）

- **落地文件**：`packages/engine/src/net-http.ts`——`createXhrHttp()` + `ccHttpModule()`（注册 `HTTP`）。
- **为什么是 XHR 不是 fetch**：Web、native jsb、小游戏适配层**三边都提供** `XMLHttpRequest`（Cocos 自己的资源下载器就走它），而 `fetch` 在 jsb 上不保证存在。一个壳覆盖全平台，好过按平台写三份。
- **已知行为**：XHR 出于同源安全**不告诉你**失败原因——DNS 失败 / 拒连 / CORS 全是同一个空 `onerror` 事件，所以错误信息只能给到 url 这一层，细分要看浏览器控制台。

### 真服务器端到端验证

`packages/core/src/__tests__/e2e-server.test.ts` 打**真服务器**（server-core-kit 的本机 docker）：dispatcher 握手 → 按下发的 `wsUrl` 连网关 → `request('Ping')` 拿到 seq 对得上的 `Pong`。**服务器没起就整体跳过**（top-level 探一下 `/healthz`，不看环境变量），所以 CI 上恒跳过、本机 `docker compose up -d` 后跑 `pnpm test` 即自动生效。

它证的是单测证不了的那部分：帧头字节序、seq 被服务端原样回传、dispatcher 信封形状。用例里的 Ping/Pong body 是**手写的两个 double 字段**而非生成代码——本例要证的是帧头与 seq，手写反而自校验（字节错了 Go 那边 `proto.Unmarshal` 直接回 `BAD_FRAME`）。真实业务协议照常用契约仓的生成代码实现 `PbSchema`。

### 接入方怎么喂 `PbSchema`

kit 里**不出现任何 cmd 号或消息定义**（ADR-0011），契约的生成产物由接入方接进来。样例是 `apps/demo/assets/scenes/kit-net.ts`（约 30 行）：契约仓 `@kit/proto` 的 `CMD`（消息名 → cmd 号）配 `kit.v1.*`（protobufjs static-module 生成的消息类）正好凑成 `createPbSchema` 的两个入参，

```ts
createPbSchema(CMD, {
  encodeBody: (type, body) => types[type].encode(body ?? {}).finish(),
  decodeBody: (type, bytes) => types[type].decode(bytes),
});
```

`?? {}` 不能省：心跳走 `send(type)` 不带 body，而 pb 的 `encode` 会读 message 的字段。心跳类型也要设成契约里有的消息（demo 用 `Ping`）——默认的 `'__ping'` 不在 schema 里，编码当场抛。
- **验证**：四门全绿；**真机 gameView 预览已验证**（DI 接入 + 真 echo 端到端往返）：`NETWORK_SOCKET (WebSocket) registered=true` + `WebSocket 全局可用=true`（证明拾取 cc 壳而非 memory socket）。**真 echo 往返闭环**：起本地 `docker run --rm -p 9099:8080 jmalloc/echo-server`，DemoBoot 用 `createNetwork({url:'ws://localhost:9099/'})`（不传 socket → 取 DI 注册的真 WebSocket 适配器）走 `request('echo',{n:42,s:'cck'})`，日志 `body={"n":42,"s":"cck"} → OK`——`connect→onOpen→send(带 seq)→onMessage→seq 匹配→resolve` 全链路经真 WebSocket 适配器打通（echo-server 首条问候语非 JSON，codec.decode 失败被忽略，无害）。DemoBoot 的 echo 块自带 5s 超时，无 echo 服务器时优雅跳过。

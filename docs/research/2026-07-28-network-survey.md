---
状态: 草案（评审中）
摘要: 横评 Cocos 3.8 全平台网络（WebSocket/HTTP 各平台分裂）与游戏长连接客户端模式，为 INetwork 定接口形状、core↔engine 拆分、请求/响应关联、重连/心跳/路由与可测接缝。
何时读: 设计长连接、请求响应 RPC、断线重连、心跳保活、协议编解码、服务器推送路由，或质疑相关选型时。
日期: 2026-07-28
依赖: docs/adr/0001-cross-bundle-singleton-and-aot-hotupdate.md（INetwork 走全局 token）, packages/core/docs/modules/timer.md（重连/超时/心跳调度注入 ITimer）, packages/core/docs/modules/eventbus.md（推送路由参照）
---

# Network / 协议层（INetwork）横评

## 目的与范围

`INetwork` 是铁律列出的 core 接口（引擎能力走接口 + DI）。本横评覆盖游戏**长连接客户端**：连接生命周期、发送、**请求/响应关联（RPC）**、**断线重连**、**心跳保活**、**服务器推送路由**、**协议编解码**，产出接口形状 + core↔engine 拆分 + 可测接缝，供设计定稿。

> 铁律约束：连接状态机 / 请求关联 / 重连退避 / 心跳调度 / 路由分发进 `core`（可 node 单测，调度注入 [[timer]]）；真实 socket IO（WebSocket/wx.connectSocket）经 `ISocket` 接缝、协议字节编解码经 `ICodec` 接缝下沉 `engine`/项目。

## 一、Cocos 3.8 全平台网络事实基线

- **无统一 socket**：cc 引擎不为游戏封统一长连接。可用底层按平台分裂——
  - **Web**：浏览器原生 `WebSocket`；
  - **native（jsb）**：引擎提供 `WebSocket` 实现（jsb 绑定）；
  - **微信/抖音小游戏**：`wx.connectSocket` / `tt.connectSocket`（**API 形状不同**，回调式、单连接限制等）。
- **HTTP** 同样分裂：Web `fetch`/`XMLHttpRequest`、native jsb http、小游戏 `wx.request`。
- ⇒ **传输必须走接缝**：core 定 `ISocket`（open/send/onMessage/onClose…），engine 按平台适配。这与 [[asset-manager]] 的 `IAssetSource`、[[save-manager]] 的 `IStorage` 同构。

## 二、难点

- **N1 平台传输分裂**：WS/HTTP API 各平台不同 → `ISocket` 接缝统一。
- **N2 请求/响应关联（无内建 RPC）**：一条消息流上要把「请求」与「对应响应」配对 → 自增 `seq` + pending 表 + 超时（注入 [[timer]] `delay`）。
- **N3 断线重连**：移动网络易抖 → 退避重连状态机（指数退避 [min,max] + 上限次数），防惊群；重连中在途请求怎么办（失败/重发/丢弃）。
- **N4 心跳保活**：TCP 半开检测——定时 ping、pong 超时判死 → 触发重连（注入 [[timer]] `interval`）。
- **N5 协议编解码**：消息 ↔ 字节（JSON / protobuf / 自定义二进制）→ `ICodec` 接缝，默认 JSON。
- **N6 推送路由**：服务器主动推（非响应）按类型分发到 handler → 类型键路由（可参照/复用 [[eventbus]]）。
- **N7 状态一致性**：连接状态机（closed/connecting/open/reconnecting/closing）+ 在途请求在断线时的收敛。

## 三、姊妹/开源框架

- **oops-framework `NetManager`/`NetNode`**：socket 抽象（可换 WS 实现）+ 心跳 + 断线重连 + 请求响应（req/rsp 按协议号配对）+ handler 注册 + 协议编解码（json/protobuf 可插）。**印证**：ISocket 抽象 + 心跳 + 重连 + req/rsp 关联 + 可插 codec 是长连接客户端标配。
- **godot-core-kit**：Godot 有 ENet/WebSocketPeer/high-level multiplayer；kit 包连接 + 信号路由。对标点=连接抽象 + 事件路由。

## 四、设计候选 + 建议

- **core 半（`INetwork` + 逻辑）**：连接状态机、`request(msg)→Promise`（seq 关联 + 超时）、`send`、`on(type,handler)` 路由、自动重连退避、心跳；调度全注入 [[timer]]（测试手动 tick，**确定性、无真实时钟**）。
- **engine/项目半（接缝实现）**：`ISocket`（cc/平台 WebSocket 适配：open/close/send/onMessage/onOpen/onClose/onError）+ `ICodec`（协议字节编解码，默认 JSON，项目可换 protobuf）。
- **core/engine 拆分基本预定**：`INetwork` 是铁律 core 接口，逻辑全可测 → **瘦 core 半 + ISocket/ICodec 接缝**，不再作为分歧（仅确认）。
- **路由复用 [[eventbus]]?**：可选。推送路由本质是类型键分发；首版内建轻量 `Map<type, Set<handler>>` 够用，避免与 EventBus 强耦合（EventBus 是全局事件、网络推送是连接内消息，语义不同）。倾向内建轻量路由。

## 五、待拍板分歧

| 编号 | 分歧 | 选项（含倾向） |
|---|---|---|
| Q-N1 | v1 范围 | 完整客户端（连接+发送+请求响应+路由 **+ 自动重连 + 心跳**，注入 [[timer]]，推荐）／精简（前四项，重连/心跳后续） |
| Q-N2 | 传输假设 | 只消息型 socket（WebSocket 式长连接，覆盖三平台，推荐）／同时含 HTTP 短请求（另一形状，建议单独模块） |
| Q-N3 | 请求/响应关联 | 自增 seq id（框架分配，透明，推荐）／消息类型匹配（同类型请求并发会歧义） |

> core/engine 拆分（瘦 core + ISocket/ICodec 接缝）按铁律预定，不列分歧。

拍板后出 `packages/core/docs/modules/network.md` 定稿 → TDD。

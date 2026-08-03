---
状态: 已定稿（快照）
摘要: 横评游戏服务端选型——socket 二进制格式（pb / FlatBuffers / MessagePack / TSBuffer）、pb 的 JS 运行时（protobufjs vs protobuf-es，有反直觉结论）、HTTP 传 pb 的传输协议（裸 POST / Connect / gRPC-Web / gRPC）、服务端栈（Go / Node / skynet / Pitaya / Nakama）、不停服更新（真热更 vs 多版本退休）、无状态与有状态分层。产出 ADR-0011 的依据。
何时读: 为本 kit 选服务端、定协议格式、定 HTTP 传输、定更新策略，或质疑上述选型时。
日期: 2026-08-03
依赖: docs/research/2026-07-28-network-survey.md（客户端 INetwork 横评，本文是它的服务端对侧）, packages/core/docs/modules/network.md（ICodec / ISocket 接缝现状）, docs/adr/0011-server-framework-split-and-protocol-contract.md（本横评的结论）
---

# 游戏服务端 / 协议横评

## 目的与范围

客户端 `INetwork` 已实现（长连接 + seq 关联 + 重连 + 心跳），但**没有任何服务器可对接**，网络交互无法验证。本横评为「搭什么服务器」定选型，覆盖：socket 二进制格式、pb 的 JS 运行时、HTTP 传输协议、服务端语言与框架、不停服更新策略、服务分层。

**用户给定的硬约束**（2026-08-03）：支持 HTTP + socket；socket 用 protobuf 或更好的格式；HTTP 可用 JSON；要分布式；要不重启更新；服务端框架**要能提供给非 Cocos 的客户端接入**（`godot-core-kit` 是现成的第二个消费者）。

---

## 一、socket 二进制格式

**一个游戏 RPC 包通常 20~200 字节，解码耗时微秒级，不在瓶颈上。** 换格式能省的远不如帧格式/路由设计的影响大。

| 格式 | 包大小 | 解码成本 | 跨语言 | JS 生态 | 判 |
|---|---|---|---|---|---|
| **protobuf** | 最小（varint） | 低 | ★★★ 全语言 | 成熟 | ✅ **选定** |
| FlatBuffers | **更大**（vtable + 对齐） | 零拷贝 ≈ 0 | ★★★ | 有，API 难用 | ❌ 战场不在 socket |
| Cap'n Proto | 小 | ≈ 0 | ★★ | JS 实现不成熟 | ❌ |
| MessagePack | 中（字段名进包） | 低 | ★★★ | msgpackr 极快 | 免 codegen，原型期备选 |
| TSBuffer (tsrpc) | ≈ pb | 低 | ❌ **只有 TS** | — | ❌ 服务端锁死 TS |
| bebop | 小 | 很低 | ★★ | 小 | ❌ 生态赌不起 |
| Colyseus Schema | — | — | ❌ | — | ❌ 只在 Colyseus 内有意义 |

### FlatBuffers 为什么不选

公开 benchmark 常说 FlatBuffers 更适合实时/游戏，但那些语境是**大结构 + 只读局部字段**（读 500 字段的关卡配置里的 3 个，pb 要解全量、FB 只寻址那 3 个）。socket 小消息吃不到这个优势，反而吃两个亏：

1. **编码后更大** —— vtable + 4/8 字节对齐，移动端流量更贵。有测评给出 pb 序列化体积约为 FlatBuffers 的三分之一。
2. **JS API 要倒序 build** —— 写业务很痛苦。

它有真正的战场：**配置表**（大、只读、随机访问局部）。本仓 `config-table` 模块那里才该考虑它。socket 和配置表用不同格式是正常的，不必强行统一。

### 结论

**protobuf（proto3）**。同时立一条纪律：`kit-proto` 只用 proto3 最保守子集，**不用 `Any`、不用嵌套 `oneof`、不用 `map`** —— 这三个跨语言实现差异最大，而契约要能被 Go / TS / 将来 GDScript 或 C# 共同消费。

---

## 二、pb 的 JS 运行时（反直觉结论）

这才是真正要选的东西，不是格式本身。

| | protobufjs（`--target static-module`） | @bufbuild/protobuf（protobuf-es） |
|---|---|---|
| 包体 | light ~16kb gzip；static build 砍掉反射后可控 | **小一半以上**，tree-shakable |
| 编码 | 基准 | **慢约 5.1x** |
| 解码 | 基准 | **慢约 14.8x** |
| int64 | `Long` 对象（坑，见下） | 原生 `BigInt` |
| TS 体验 | `.d.ts` 拼的，一般 | 原生 TS，干净 |
| Cocos 圈实战 | 最多 | 少 |

性能数据来自 protobuf-es 自己的 issue #333；另有实测 6MB / 15 万重复字段消息解码，protobufjs ≈ 100ms、protobuf-es ≈ 350ms。

**选 protobufjs static-module。** 长连接游戏是高频收包，解码慢 14.8x 是每帧都在付的税；包体差距用 static build（不带 parser / 反射）已经压住。protobuf-es 更适合「包体敏感、调用稀疏」的 Web 后台，与游戏客户端正好相反。

### 两个必须写进协议规范的坑

1. **禁用 `int64` / `uint64`**。protobufjs 默认解成 `Long` 对象 → 每包多分配对象 → GC 抖动。要大数用 `string`，要计数用 `int32` / `fixed32`。
2. **Cocos 构建会做 ES5 降级**。本仓已被咬过一次（`[...set]` 被降级成 `[].concat(set)`，预览测不出、只在构建产物炸）。pb 生成代码必须验**构建产物**，不能只看预览。

---

## 三、HTTP 传 pb 的传输协议

**决定性约束是目标平台**：微信小游戏 / WebView 只有 `XHR`/`fetch`，拿不到 HTTP/2 trailer 的控制权 → **原生 gRPC 客户端出局**（不是性能问题，是够不着）。

| 方案 | 浏览器/小游戏直连 | 要代理 | pb 原生 | 评 |
|---|---|---|---|---|
| 裸 `POST` + `application/x-protobuf` | ✅ | 否 | ✅ | 最省，协议约定就三行 |
| **Connect protocol**（connectrpc） | ✅ | 否 | ✅ | POST-only、HTTP/1.1 即可、**完全不用 trailer** |
| gRPC-Web | ✅ | **要** Envoy / grpcwebproxy | ✅ | 白多一层，Connect 之后无理由选 |
| 原生 gRPC（HTTP/2） | ❌ | — | ✅ | 服务器之间可用，客户端不行 |

Connect 官方文档明确：Connect 协议是 POST-only、可跑在 HTTP/1.1 或 HTTP/2 上、不使用 HTTP trailer，因此对任何网络基础设施都友好；`connect-es` 配 Protobuf-ES 是目前唯一完整通过 protobuf conformance 测试的 JS 实现。

### 结论

**客户端 ↔ 网关走裸 POST + pb，形状与 Connect 同构**（`POST /api/<Method>`），将来要升 Connect 是平滑的。服务器之间随意用 gRPC。

而 HTTP 的**编码用 JSON**（用户定，2026-08-03），但**由 `.proto` 生成**（proto3 canonical JSON mapping），不手写：

```
一份 .proto ──→ socket：二进制编码
           └──→ HTTP：JSON 编码（同一套字段名 / 枚举 / 错误码）
```

裸手写 JSON 的真实代价不在传输，在**两套真理来源会漂移**：socket 有一套 enum 和错误码，HTTP 又有一套，三个月后对不上，且线上才发现。

配套三条约定：

1. **不用 REST，用 POST-only RPC**（`POST /api/<Method>`）。游戏后端没有资源语义，REST 只会让人纠结 PUT 还是 PATCH。
2. **业务错误不用 HTTP 状态码**，一律 `200` + `{code, msg, data}`。CDN、渠道 SDK 代理、企业网关会篡改甚至吞掉 4xx/5xx，产生无法归因的报错。HTTP 状态码只表达传输层出事。
3. 本仓需补 `IHttp` 接缝 + engine 适配（Web `fetch` / native / 小游戏 `wx.request`）—— `network.md` 决策 #2 当初把 HTTP 短请求 YAGNI 掉了。

---

## 四、pb 之上的三层（真正决定架构的）

### ① 帧格式

**WebSocket 自带 message 边界，不加长度前缀。** 长度前缀是 TCP 才需要的，加了纯浪费。将来上 native TCP 再补 varint 长度前缀，那是另一个 socket 适配的事。

### ② 路由头

| 做法 | 代价 |
|---|---|
| (a) Envelope message `{cmd, seq, bytes payload}` | 多一次 pb 解码 + 一次 buffer copy |
| **(b) 定长二进制头 + pb body** ← 选定 | 6 字节，**网关不解 pb 就能路由** |
| (c) 一个巨型 `oneof` message | 加消息要改公共文件，撞「最小化交叉」的协作约定 |

```
[u16 cmd][u32 seq][pb body ...]
```

(b) 相对 (a) 的真实收益在**分布式**：gateway 读 6 字节头就能把包甩给对应的后端进程，**完全不需要反序列化 body、不需要知道协议内容**。这决定了能不能做无状态网关，也意味着**新增子游戏时 gateway 不改代码、不重新部署**。

### ③ cmd 号来源

在 `.proto` 里给消息挂 `option`，脚本生成映射表。**别用消息名字符串当 cmd** —— 浪费字节，服务器还要 hash。

---

## 五、服务端栈

| 栈 | 分布式 | 不重启更新 | pb | 与本仓 TS 契合 | 判 |
|---|---|---|---|---|---|
| **Go** 自建 | 好（goroutine + 水平扩展） | 滚动重启 | ✅ | ★☆ | ✅ **选定** |
| Node/TS 自建 | 单线程，要多进程 | 进程 reload | ✅ | ★★★ | 特定场景备选，见下 |
| Colyseus (Node/TS) | 房间级 + proxy | ❌ | 自家 Schema，**非 pb** | ★★★ | ❌ 撞 pb 硬要求 |
| tsrpc (Node/TS) | ❌ | ❌ | ❌ **TSBuffer** | ★★☆ | ❌ 明确不用 pb |
| Pitaya (Go) | ✅ etcd + NATS | ❌ 编译型 | ✅ | ★☆ | 参照其分层，不直接用 |
| Nakama (Go) | ✅ 集群 | 半（Lua/JS runtime 可换） | ✅ | ★☆ | 弱联网项目可直接用 |
| skynet (C+Lua) | ✅ actor | ✅✅ **真·角色级热更** | 要自己接 | ★ | 真热更的唯一解，但被多版本方案替代 |

### 为什么 Go

用户给的两个词是「扩容」和「代码效率」：

- **扩容**：无状态服 = 加机器；有状态房间服 = goroutine per room，单机几万房间，按房间 ID 分片。两个模式 Go 都最省心。
- **代码效率**：**单二进制部署**，这对多版本并存是决定性的 —— 每个版本 = 一个二进制 + 一份配置，没有依赖冲突。Node 的 `node_modules` 多版本共存难受，Java 每版一份 JVM 内存开销大。

### Node/TS 的唯一杀手锏

本仓 `packages/core` 是**零 cc 纯 TS**，服务端能直接 `import`。战斗结算、数值计算、ECS 可以客户端服务端跑**同一份代码** —— 防作弊要服务端重算时价值极大，能省掉「两套语言实现同一套规则然后对不上」的经典灾难。

**决策规则**：需要服务端权威校验战斗/数值的子游戏 → 那**一个**子游戏服用 Node/TS；其余（gateway、大厅、纯存档型）→ Go。因为 gateway 对 body 无知，这个混搭天然成立。

---

## 六、不重启更新：多版本退休 vs 真热更

**编译型语言做不到真热更**（Go/Rust/C++ 只能滚动重启 + 优雅停机）。skynet 因为一个角色一个 actor，能精确到单个玩家换逻辑模块 —— 这是它相对编译型的结构性优势。

但用户提出的**多版本退休机制**（2026-08-03）绕开了这个问题，且是当下手游主流做法：不热更代码，而是**多版本并存 + 按客户端版本路由 + 老版本自然退休**。它把一个语言级难题降级成了运维问题，选语言的顾虑随之解除。

### 落地要点

**① 入口必须是协议永久冻结的 dispatcher。** 版本路由不能靠 DNS（改不了已发布的老客户端），也不能靠网关认 header（老客户端可能没带）。标准做法是启动时先问一个永不下线的调度接口：

```
客户端启动 ──→ dispatcher
   入: {appVer, protoVer, platform, channel, 能力戳}
   出: {action: PLAY | UPDATE | MAINTENANCE, wsUrl, cdnUrl, notice}
             │
   ┌─────────┼─────────┐
 v1.2      v1.3      v1.4      各版本独立部署单元
(退休中)   (主力)   (灰度中)
   └─────────┼─────────┘
             ↓
      共享存储（schema 只增不改）
```

**dispatcher 的协议一旦发布就永久冻结**，它是唯一一个所有历史版本客户端都要能解析的东西。必须极简，绝不能塞业务字段 —— 每加一个字段都是给未来上镣铐。老版本退休后客户端拿到的必须是明确的 `UPDATE`，不能是连接超时。

**② 真正的难点是共享数据，不是路由。** 多版本并存时不同版本读写同一份玩家数据。加字段安全；改语义、删字段、改枚举含义会让老版本炸。纪律：**存储 schema 只增不改不删**。

用 `reserved` 锁 tag 号：

```proto
message PlayerData {
  reserved 5, 7;               // 废弃字段的 tag，永不复用
  reserved "old_vip_level";
}
```

**tag 复用是 pb 最经典的事故**：删了 `field 5 = int32 vip`，半年后新加 `field 5 = string name`，存量老数据里的 5 会被当 string 解 → 乱码或崩溃，而且是**静默的**，干净数据的测试环境根本测不出来。

**③ 版本下线后代码删、存储字段不删。** 多版本并存是短期的（几周），不是永久：灰度 → 全量 → 老版 2~4 周后退休 → 同时活着的永远只有 1~2 个。老版本的**代码分支在退休时删掉**。留下的只有废弃的存储字段，不删的理由：回滚窗口需要（新版炸了退回上一版，字段已删则老代码读不到）；离线玩家的存档还是老格式；一个废弃字段几字节，几百万玩家也就几十 MB，省这个换数据事故血亏。

**④ 有状态服务不能跨版本混。** 同一局玩家必须同版本 → 匹配池按版本分池 → **版本碎片化稀释匹配池**。DAU 小时是致命的，所以退休要激进（如某版在线占比 < 5% 持续 3 天即下线）。

### 这套方案覆盖不了的一类

**紧急 hotfix**（线上刷钱漏洞、必崩 bug，等不了发版和审核）。两个补丁覆盖 95%：**配置热更**（数值、开关、掉落表放配置中心，不重启生效，必须有）+ **无状态服务滚动重启**（几十秒，有 dispatcher 兜底连重连都平滑）。剩下 5% 才需要真·角色级热更，前提是「长局不能断线」的形态。

---

## 七、无状态 vs 有状态

**判定标准**：请求打到任意一个实例结果都一样 → 无状态；必须打到「那一个」实例 → 有状态。

无状态 ≠ 没数据。是指**进程内存不保存跨请求的会话状态**，状态全在外部存储；有状态是**内存里那份比存储里更新**（权威在内存）。

| | 无状态 | 有状态 |
|---|---|---|
| 扩容 | 加机器，负载均衡随便轮询 | 要分片/路由，加机器要迁移 |
| 挂掉 | 重试到别的实例，玩家无感 | 那批玩家的会话全丢 |
| 更新 | 滚动重启，几十秒 | 等会话结束或做状态迁移 |
| 延迟 | 每次读存储 | 内存直取 |
| 并发 | 靠存储事务 | 单实例天然串行，无竞争 |

### 对「大厅 + 子游戏」形态的映射

用户给定的游戏形态（2026-08-03）：大厅 + 子游戏，子游戏形态多样，**因为有大厅路由所以不同游戏可走不同策略**。服务端应镜像客户端分层：

```
              gateway  ← 有连接、无业务
                 │
      ┌──────────┴──────────┐
   lobby（无状态）        子游戏服（各自决定）
   登录/存档/排行/邮件/商城   ├ 棋牌卡牌 → 有状态房间
                           ├ 肉鸽单机 → 不需要子游戏服
                           └ 实时对战 → 有状态 + 帧同步
```

1. **gateway 是「伪有状态」** —— 持有 WebSocket 连接（天然有状态），但不持有业务状态。挂了玩家重连即恢复，扩容就是加机器让连接自然分布。
2. **大厅无状态 → 多版本方案在这里几乎零成本**。滚动重启、灰度、多版本并存全是白送的。
3. **有状态只出现在具体子游戏，且是「每局」粒度**。一局结束状态即消失 → 退休一个版本只要「不再分配新局，等当前局打完」，几分钟到几十分钟。这叫 **drain（排水）**，比状态迁移简单一个数量级。

单机型子游戏（如肉鸽 survivors）**不需要子游戏服**，走大厅的无状态接口存档 + 传排行榜即可。

---

## 八、结论汇总

| # | 维度 | 选定 |
|---|---|---|
| 1 | socket 格式 | protobuf（proto3 保守子集） |
| 2 | pb 的 JS 运行时 | protobufjs `--target static-module` |
| 3 | 帧格式 | `[u16 cmd][u32 seq][pb body]`，无长度前缀 |
| 4 | cmd 来源 | `.proto` option + 生成映射表 |
| 5 | HTTP 编码 | `.proto` 生成的 JSON（proto3 canonical mapping） |
| 6 | HTTP 形状 | POST-only RPC + `200` + `{code,msg,data}` |
| 7 | 服务端语言 | Go（需服务端权威校验的子游戏可用 Node/TS 复用 core） |
| 8 | 不重启更新 | 多版本并存 + dispatcher 路由 + 激进退休；配置热更兜底 hotfix |
| 9 | 分层 | dispatcher / gateway / lobby(无状态) / game(有状态，drain 退休) |
| 10 | 仓库 | 服务端独立仓，经独立的 `kit-proto` 契约接入（见 ADR-0011） |

## 参考

- Protobuf-ES 性能：<https://github.com/bufbuild/protobuf-es/issues/333>；项目：<https://github.com/bufbuild/protobuf-es>
- protobuf.js：<https://github.com/protobufjs/protobuf.js>
- Connect 协议参考：<https://connectrpc.com/docs/protocol/>；多协议支持：<https://connectrpc.com/docs/multi-protocol/>；connect-es：<https://github.com/connectrpc/connect-es>
- gRPC-Web vs REST vs Connect-RPC（2026）：<https://apiscout.dev/guides/grpc-web-vs-rest-vs-connect-rpc-frontend-2026>
- 序列化格式对比（Linköping University）：<https://www.ida.liu.se/~nikca89/papers/networking20c.pdf>
- FlatBuffers vs Protobufs：<https://www.netguru.com/blog/flatbuffers-vs-protobufs>
- Pitaya：<https://github.com/topfreegames/pitaya>、<https://pitaya.readthedocs.io/en/latest/overview.html>
- Nakama：<https://heroiclabs.com/docs/nakama/getting-started/>；Colyseus：<https://colyseus.io/>
- 脚本型 vs 编译型热更方案：<https://www.codedump.info/post/20191206-gameserver-hot-refresh/>
- skynet 优劣：<https://zhuanlan.zhihu.com/p/599584192>

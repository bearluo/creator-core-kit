---
状态: 已接受
日期: 2026-08-03
依赖: docs/research/2026-08-03-game-server-survey.md, packages/core/docs/modules/network.md, docs/adr/0001-cross-bundle-singleton-and-aot-hotupdate.md
---

# ADR-0011：服务端框架独立成仓，经冻结的 `kit-proto` 契约接入

## 背景

客户端 `INetwork` 已实现并通过 echo 验证，但**没有任何真实服务器可对接**——重连、心跳判死、超时、seq 关联、断线 fail pending 这些逻辑只在单测里被假 socket 驱动过，网络交互在真实环境下从未验证。要补上这块，就得有服务器。

真正的分歧不在「用什么技术」，而在**服务端能力放哪**。讨论中依次出现过四种主张，前三种都被否掉：

| 主张 | 否决理由 |
|---|---|
| 只做一个假 mock server | 服务器是玩具的话，dispatcher 握手、版本闸、gateway 路由、有状态服 drain 全验不到，kit 的网络层等于对着玩具设计——正是「kit 脱离实际业务」这个要避免的失败模式 |
| 服务端进本仓（monorepo） | 本仓是 **Cocos** 客户端框架。服务端焊在这里，`godot-core-kit` 就永远接不上，它就不是框架、只是本仓的后端 |
| 服务端独立仓 + 协议放服务端仓 | 协议有三个消费者（creator / godot / server），放任何一方都让另外两方去 submodule 一个大仓 |

第四种成立：**服务端独立仓，协议再独立一层作契约。**

## 决策

### 1. 三层仓库划分

```
kit-proto            契约层：帧头 + dispatcher 握手 + 错误码 + 版本协商
   │                 引擎中立、语言中立、设计上冻结
   ├──→ creator-core-kit   Cocos 客户端框架（TS）   本仓
   ├──→ godot-core-kit     Godot 客户端框架
   └──→ server-core-kit    服务端框架（Go）
```

**本仓不含任何服务端代码。** 本仓在这条链上的责任只有两件：实现 `ICodec` 的 pb 版本（`createProtobufCodec`）、补 `IHttp` 接缝。协议类型从 `kit-proto` 的生成产物来。

### 2. 契约层的边界（引擎中立的硬约束）

`kit-proto` **只含**：帧头格式、dispatcher 握手、错误码、版本协商、会话生命周期。

**不含**：热更、资源、场景、任何引擎概念。具体推论——

- dispatcher 下发的 `cdnUrl` 就是个 URL。服务端不认识 Cocos 的 manifest 格式，也不认识 Godot 的 pck，客户端框架各自解释。
- **`compat-stamp` 不进服务端**。那是本仓的机制；服务端只认一个抽象的「客户端能力戳」字符串，怎么算出来的它不管。
- 只用 proto3 最保守子集：**不用 `Any`、不用嵌套 `oneof`、不用 `map`**——这三个跨语言实现差异最大，而契约要能被 Go / TS / 将来 GDScript 或 C# 共同消费。

### 3. 本仓承诺的协议面

- **socket 走 protobuf**，帧格式 `[u16 cmd][u32 seq][pb body]`，**不加长度前缀**（WebSocket 自带 message 边界；长度前缀是 TCP 才需要的）。
- **pb 的 JS 运行时用 protobufjs `--target static-module`**（不是 protobuf-es，见横评第二节：后者解码慢约 14.8x，长连接高频收包每帧都在付这个税）。
- **HTTP 用 `.proto` 生成的 JSON**，POST-only RPC，业务错误一律 `200` + `{code, msg, data}`。
- **禁用 `int64`/`uint64`**（protobufjs 解成 `Long` 对象 → GC 抖动）；废弃字段用 `reserved` 锁 tag 号，永不复用。

### 4. 不重启更新走多版本退休，不追求真热更

编译型语言做不到真热更。改为**多版本并存 + dispatcher 按客户端版本路由 + 老版本激进退休**，把语言级难题降级成运维问题。**dispatcher 的协议一旦发布即永久冻结**——它是唯一一个所有历史版本客户端都要能解析的东西。

配套纪律：**存储 schema 只增不改不删**（多版本读写同一份玩家数据）。版本退休时删代码分支，**不删存储字段**。

### 5. 版本 = 协议版本，不是框架版本

dispatcher 判定的是 **`kit-proto` 的版本**。客户端框架 v2.1 和服务端框架 v3.0 都可以声明「我说 proto v5」。三个仓各自演进，只在契约上对齐。

### 6. `server-core-kit` 必须可 `docker run`

从第一天就要发布镜像（或 release 二进制）。**没有可拉取的服务端制品，客户端仓就做不了端到端验证**，「不脱离实际业务」就落空了。

## 理由

### 为什么值得多两个仓

分仓的成本是真实的，各有解法：

| 成本 | 解法 |
|---|---|
| 改协议要动多个仓 | `kit-proto` 打 tag，各仓锁版本升级。它本来就该极少变——频繁改说明契约设计错了，**这个摩擦是特性不是 bug** |
| 端到端验证要跨仓 | `server-core-kit` 发 docker 镜像，客户端仓 CI 拉镜像跑 e2e，本地 `docker compose up` |
| 各仓协议版本会漂 | 启动握手时 dispatcher 校验，不匹配直接拒——这本就是设计好的行为，漂了会立刻暴露而非静默 |

换来的是：**服务端框架能被非 Cocos 客户端接入**。`godot-core-kit` 是现成的第二个消费者，不是假设。

### 为什么 6 字节头值这个复杂度

gateway 读头就能路由、**永不解 body**，于是它对所有子游戏协议完全无知：

- 接入方新增子游戏，**gateway 不改代码、不重新部署**；
- Go 网关和 Node/TS 子游戏服可以混搭（需要服务端权威校验战斗数值的子游戏可复用本仓零 cc 的 `packages/core`），gateway 无所谓转给谁。

选 Envelope message（`{cmd, seq, bytes payload}`）则每包多一次 pb 解码 + 一次 copy，且 gateway 必须理解协议。

### 为什么 HTTP 的 JSON 要由 proto 生成而不是手写

裸手写 JSON 的代价不在传输，在**两套真理来源会漂移**：socket 有一套 enum 和错误码，HTTP 又有一套，三个月后 `ErrorCode.BANNED` 在两边对不上号，且线上才发现。proto3 有官方 canonical JSON mapping，一份 `.proto` 生两种编码，代价接近零。

## 后果

**本仓要做的**（其余在别的仓）：

1. `packages/engine/src/net-socket.ts` 建 WebSocket 时设 `binaryType = 'arraybuffer'`。当前缺这行，默认 `'blob'` → `ev.data` 是 `Blob`；而 `ICodec.decode(data): NetMessage` 是**同步签名**，Blob 只能异步读——不是「解不出来」，是接口形状直接不兼容。JSON codec 走 string 所以一直没暴露。
2. `packages/core/src/network/` 增 `createProtobufCodec(schema: PbSchema): ICodec`。6 字节头的拆装在框架里，具体协议全在注入的 `schema` 里，本仓不含任何具体协议：

   ```ts
   export interface PbSchema {
     cmdOf(type: string): number | undefined;
     typeOf(cmd: number): string | undefined;
     encodeBody(type: string, body: unknown): Uint8Array;
     decodeBody(type: string, bytes: Uint8Array): unknown;
   }
   ```
3. 补 `IHttp` 接缝 + engine 适配（Web `fetch` / native / 小游戏 `wx.request`）。`network.md` 决策 #2 当初把 HTTP 短请求 YAGNI 掉了，现在要收回来。
4. `App` 的 `defaultLaunchSteps()` 里加一步 dispatcher 查询。它应和热更检查**合并成同一个请求**，不打两次 HTTP。

**白捡的收益**：codec 可切换意味着开发期用 JSON codec 抓包肉眼可读、上线切 pb，一行的事——二进制协议最烦的调试问题自动消失。

**待定**（不阻塞上述）：是否有需要服务端权威校验的子游戏。这决定哪些子游戏服用 Node/TS 复用 `packages/core`，不影响本仓客户端侧任何工作。

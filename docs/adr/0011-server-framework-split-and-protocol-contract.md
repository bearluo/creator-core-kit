---
状态: 已接受
日期: 2026-08-03
依赖: docs/research/2026-08-03-game-server-survey.md, packages/core/docs/modules/network.md, docs/adr/0001-cross-bundle-singleton-and-aot-hotupdate.md
---

# ADR-0011：服务端不进本仓，经冻结的 `kit-proto` 契约接入

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

**本仓不含任何服务端代码，也不定义协议。** 帧格式、数字类型、HTTP 错误约定、多版本退休、服务端制品形态，是 `kit-proto` 和 `server-core-kit` 各自仓里的决策，本仓只消费，不在这里重述。

### 2. 本仓在这条链上的责任

只有三件：实现 `ICodec` 的 pb 版本（`createProtobufCodec`）、补 `IHttp` 接缝、启动流程里加 dispatcher 查询。协议类型全部来自 `kit-proto` 的生成产物，本仓源码里不出现任何具体 cmd 或消息定义。

### 3. pb 的 JS 运行时用 protobufjs `--target static-module`

不是 protobuf-es——后者包体小一半，但编码慢约 5.1x、解码慢约 14.8x（见横评第二节）。长连接高频收包每帧都在付这个税，包体一次性、解码常态化。

这条留在本仓，因为它是 **JS 侧**的实现选择，另外两个消费者各自选自己的运行时。

### 4. 本仓的机制不往契约里塞

- **`compat-stamp` 不进服务端**。那是本仓 ADR-0001 的机制；服务端只认一个抽象的「客户端能力戳」字符串，怎么算出来的它不管。
- dispatcher 下发的 `cdnUrl` 就是个 URL。服务端不认识 Cocos 的 manifest 格式，也不认识 Godot 的 pck，客户端框架各自解释。

这条是本仓对契约单方面的自我约束：契约一旦沾上引擎概念，`godot-core-kit` 接入就得绕。

## 理由

分仓的成本是真实的，各有解法：

| 成本 | 解法 |
|---|---|
| 改协议要动多个仓 | `kit-proto` 打 tag，各仓锁版本升级。它本来就该极少变——频繁改说明契约设计错了，**这个摩擦是特性不是 bug** |
| 端到端验证要跨仓 | `server-core-kit` 发 docker 镜像，客户端仓 CI 拉镜像跑 e2e，本地 `docker compose up` |
| 各仓协议版本会漂 | 启动握手时 dispatcher 校验，不匹配直接拒——这本就是设计好的行为，漂了会立刻暴露而非静默 |

换来的是：**服务端框架能被非 Cocos 客户端接入**。`godot-core-kit` 是现成的第二个消费者，不是假设。

## 后果

**本仓要做的**（其余在别的仓）：

1. `packages/engine/src/net-socket.ts` 建 WebSocket 时设 `binaryType = 'arraybuffer'`。当前缺这行，默认 `'blob'` → `ev.data` 是 `Blob`；而 `ICodec.decode(data): NetMessage` 是**同步签名**，Blob 只能异步读——不是「解不出来」，是接口形状直接不兼容。JSON codec 走 string 所以一直没暴露。
2. `packages/core/src/network/` 增 `createProtobufCodec(schema: PbSchema): ICodec`。帧头拆装在框架里，具体协议全在注入的 `schema` 里，本仓不含任何具体协议：

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

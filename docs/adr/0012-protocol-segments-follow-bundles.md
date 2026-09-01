---
状态: 已接受
日期: 2026-08-05
依赖: docs/adr/0011-server-framework-split-and-protocol-contract.md, docs/adr/0009-bundle-layering-criterion.md, packages/core/docs/modules/network.md
---

# ADR-0012：协议按功能模块分段，模块段随它的 Asset Bundle 走

## 背景

ADR-0011 把契约接进来之后，`@kit/proto` 是作为 **npm 依赖**被主包的 `kit-net.ts` import 的。实测发现这条路和分包更新是冲突的：

**Cocos Creator 3.8.7 把所有 npm 依赖统一打进 `src/chunks/bundle.js`**，那是随主包走的 base 层——改了要整包更新、用户重装（ADR-0009 的分层判据里，main/res 就是"需重启"的那一层）。谁 import 它不影响这个结果：实测让 `assets/modules/mini-clicker/` 下的脚本 import 契约包，代码照样落在 base chunk 里。

后果是：**加一个子游戏的协议 = 发新包**。子游戏本身的代码、prefab、配表都能随 bundle 热更，唯独它的协议不能——这让"一模块一 bundle、按需热更"这条主线在协议这一环断掉。

## 决策

### 1. cmd 分段，模块段的生成代码作为项目脚本进各自 bundle

- **基础段**（握手 / 心跳 / 错误 / 分配器，cmd 1–999）留在 base，走 npm `exports`。它本来就不该常变，改它要整包更新是可以接受的代价。
- **模块段**（每个功能模块 1000 个号，第 N 个模块从 `1000*N` 起）由契约仓额外产一份**单文件 `.ts`**，消费方拷进 `assets/modules/<模块>/`，随该 bundle 打包、随 bundle 热更。号段由 `kit-proto` 统一分配，**一经发布不许改、不许复用**（老客户端里编译进去的 cmd 号改不了）。
- protobufjs 运行时留在 base 共享。实测模块 bundle 的产物里它出现 **0 次**——运行时不会被复制进每个 bundle，涨的只有协议本身。

**必须是 `.ts` 不能是 `.js`**：Creator 把 `assets/` 下的 `.js` 一律当 CommonJS（内部重写成 `xxx.mjs?cjs=&original=.js`），喂 ESM 产物直接 `Unexpected import statement in CJS module` 炸构建。

### 2. core 提供可增量注册的 `PbSchemaRegistry`

codec 拿的不再是一张造好就不动的表，而是可增量的注册表：base 启动时装基础段并注册进 `PB_SCHEMA` token，模块 bundle 加载时 `add` 自己那段、注销函数交 `BundleScope.add()` 托管。全程 `INetwork` 与 codec 实例不换、连接不断。

**core 里仍然不出现任何 cmd 号或消息定义**（ADR-0011 不变），它只多了一个"分段"的机制。

## 理由

### 为什么不用「协议当数据热更」

看起来更优雅的方案是让协议变成 bundle 里的一个 json 资源：pbjs 产 descriptor，运行时 `protobuf.Root.fromJSON()` 反射建类型。实测反射版与静态生成代码**编出的字节完全一致、可互相解码**，而且协议成了资源、热更天然成立、连拷文件都省了。

**被平台否决**：protobufjs 的反射路径靠 `Function.apply(null, source)` 动态生成 encoder/decoder（`@protobufjs/codegen`），**没有 fallback**。微信 / 抖音小游戏禁 `new Function`。本仓的目标是全平台，这条路直接出局。

代价是模块段要拷文件（`pnpm proto:sync`），而漏拷是静默的——旧协议还在、编译照过、线上错发。所以 CI 跑完同步脚本会检查工作树有没有变，同 `pnpm docs:api` 的套路。

### 为什么号段由契约仓统一分配

各模块自己挑号必然撞车，而症状极其难查：网关只看 6 字节帧头路由，撞号就是把 A 模块的包发给 B 模块，且**只有两个模块同时在线时才复现**。所以 `add` 在撞号时当场抛，加上 demo 侧一条断言号段边界的单测——把这个 bug 挡在加载期而不是线上。

## 后果

- **模块卸载后它的在途请求解不出来**：响应帧回来时 cmd 已注销，`decode` 抛错被 core 吞成一条 warn，该请求走超时。可接受的降级——真要紧的请求别跨模块卸载。
- **模块段产物里内联了它 import 的框架 proto**（pbjs 的行为）。这是特性不是浪费：bundle 能热更、base 不能，模块协议绝不能依赖 base 里那份可能已经过期的副本。
- **改基础协议仍然要整包更新**。躲不掉，所以基础段要尽早定死。
- 端到端验证过（预览 + web-mobile 真构建）：模块段 cmd 1000 编码发出 → 服务端按 cmd 路由 → 回基础段的 `Error{NOT_HANDSHAKED}` → 用基础段解回来。两段在同一张注册表里各司其职。

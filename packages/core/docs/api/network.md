[**@cck/core API**](README.md)

***

[@cck/core API](README.md) / network

# network

## Interfaces

### HeartbeatOptions

Defined in: [packages/core/src/network/network.ts:25](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/network/network.ts#L25)

#### Properties

##### enabled?

> `optional` **enabled**: `boolean`

Defined in: [packages/core/src/network/network.ts:27](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/network/network.ts#L27)

默认 true。

##### intervalSec?

> `optional` **intervalSec**: `number`

Defined in: [packages/core/src/network/network.ts:29](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/network/network.ts#L29)

心跳间隔（秒），默认 15；一个间隔内无任何入站消息则判死→关闭触发重连。

##### type?

> `optional` **type**: `string`

Defined in: [packages/core/src/network/network.ts:31](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/network/network.ts#L31)

ping 消息 type，默认 '__ping'。

***

### HttpRequest

Defined in: [packages/core/src/network/http.ts:11](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/network/http.ts#L11)

HTTP 短请求接缝。长连接之外还需要它：启动握手（dispatcher）、版本表、公告这类
一问一答的东西架在 socket 上要先连上才能问，而「能不能连」正是握手要回答的。

core 只定义形状，真实 IO 在 engine（`createXhrHttp`）。**不返回解析后的对象**：
适配层只负责搬字节，content-type 嗅探 / JSON 解析留在 core 侧（可 node 单测）。

#### Properties

##### body?

> `readonly` `optional` **body**: `string`

Defined in: [packages/core/src/network/http.ts:16](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/network/http.ts#L16)

已序列化的请求体。

##### headers?

> `readonly` `optional` **headers**: `Readonly`\<`Record`\<`string`, `string`\>\>

Defined in: [packages/core/src/network/http.ts:17](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/network/http.ts#L17)

##### method?

> `readonly` `optional` **method**: `"GET"` \| `"POST"`

Defined in: [packages/core/src/network/http.ts:14](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/network/http.ts#L14)

默认 `'GET'`。

##### timeoutSec?

> `readonly` `optional` **timeoutSec**: `number`

Defined in: [packages/core/src/network/http.ts:19](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/network/http.ts#L19)

默认由适配层定（engine 侧 10s）。

##### url

> `readonly` **url**: `string`

Defined in: [packages/core/src/network/http.ts:12](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/network/http.ts#L12)

***

### HttpResponse

Defined in: [packages/core/src/network/http.ts:22](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/network/http.ts#L22)

#### Properties

##### status

> `readonly` **status**: `number`

Defined in: [packages/core/src/network/http.ts:23](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/network/http.ts#L23)

##### text

> `readonly` **text**: `string`

Defined in: [packages/core/src/network/http.ts:24](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/network/http.ts#L24)

***

### ICodec

Defined in: [packages/core/src/network/codec.ts:15](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/network/codec.ts#L15)

协议编解码接缝：消息信封 ↔ 线上数据（字节/字符串）。core 用它把 seq 落到/读出协议约定字段——
换 protobuf / 自定义二进制只换 codec，core 的请求关联/路由逻辑不动（见 network 横评 N5/Q-N3）。

#### Methods

##### decode()

> **decode**(`data`): [`NetMessage`](network.md#netmessage)

Defined in: [packages/core/src/network/codec.ts:19](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/network/codec.ts#L19)

收到数据 → 信封。须从协议字段读出 seq（无关联 id 则 seq=undefined，core 按推送处理）。

###### Parameters

###### data

`unknown`

###### Returns

[`NetMessage`](network.md#netmessage)

##### encode()

> **encode**(`msg`): `unknown`

Defined in: [packages/core/src/network/codec.ts:17](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/network/codec.ts#L17)

信封 → 发送数据。须把 msg.seq 落到协议里服务器会原样回传的字段。

###### Parameters

###### msg

[`NetMessage`](network.md#netmessage)

###### Returns

`unknown`

***

### IHttp

Defined in: [packages/core/src/network/http.ts:27](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/network/http.ts#L27)

#### Methods

##### request()

> **request**(`req`): `Promise`\<[`HttpResponse`](network.md#httpresponse)\>

Defined in: [packages/core/src/network/http.ts:29](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/network/http.ts#L29)

传输层出错（DNS / 连不上 / 超时）reject；服务器有回应即 resolve，状态码由调用方判。

###### Parameters

###### req

[`HttpRequest`](network.md#httprequest)

###### Returns

`Promise`\<[`HttpResponse`](network.md#httpresponse)\>

***

### INetwork

Defined in: [packages/core/src/network/network.ts:39](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/network/network.ts#L39)

#### Properties

##### state

> `readonly` **state**: [`NetState`](network.md#netstate)

Defined in: [packages/core/src/network/network.ts:40](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/network/network.ts#L40)

#### Methods

##### close()

> **close**(): `void`

Defined in: [packages/core/src/network/network.ts:44](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/network/network.ts#L44)

主动关闭（不触发重连）。

###### Returns

`void`

##### connect()

> **connect**(`url`?): `void`

Defined in: [packages/core/src/network/network.ts:42](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/network/network.ts#L42)

连接（可传 url 覆盖）。重置重连计数。

###### Parameters

###### url?

`string`

###### Returns

`void`

##### off()

> **off**(`type`, `handler`): `void`

Defined in: [packages/core/src/network/network.ts:52](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/network/network.ts#L52)

移除推送处理器。

###### Parameters

###### type

`string`

###### handler

[`NetHandler`](network.md#nethandler)

###### Returns

`void`

##### on()

> **on**(`type`, `handler`): [`Disposer`](eventbus.md#disposer)

Defined in: [packages/core/src/network/network.ts:50](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/network/network.ts#L50)

注册推送处理器，返回取消订阅 disposer。

###### Parameters

###### type

`string`

###### handler

[`NetHandler`](network.md#nethandler)

###### Returns

[`Disposer`](eventbus.md#disposer)

##### onState()

> **onState**(`cb`): [`Disposer`](eventbus.md#disposer)

Defined in: [packages/core/src/network/network.ts:54](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/network/network.ts#L54)

订阅状态变化，返回取消订阅 disposer。

###### Parameters

###### cb

(`s`) => `void`

###### Returns

[`Disposer`](eventbus.md#disposer)

##### request()

> **request**(`type`, `body`?, `opts`?): `Promise`\<[`NetMessage`](network.md#netmessage)\>

Defined in: [packages/core/src/network/network.ts:48](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/network/network.ts#L48)

请求（seq 关联 + 超时），返回响应信封。未连接立即 reject；超时/断线 reject。

###### Parameters

###### type

`string`

###### body?

`unknown`

###### opts?

[`RequestOptions`](network.md#requestoptions)

###### Returns

`Promise`\<[`NetMessage`](network.md#netmessage)\>

##### send()

> **send**(`type`, `body`?): `void`

Defined in: [packages/core/src/network/network.ts:46](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/network/network.ts#L46)

发送消息（fire-and-forget）。未连接则告警丢弃。

###### Parameters

###### type

`string`

###### body?

`unknown`

###### Returns

`void`

***

### ISocket

Defined in: [packages/core/src/network/socket.ts:9](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/network/socket.ts#L9)

传输接缝：一条消息型长连接（WebSocket 式）。core 只认本接口（守零 cc 铁律）。
engine 按平台适配——Web 原生 WebSocket / native jsb WebSocket / 小游戏 wx.connectSocket。
事件用可赋值回调（DOM WebSocket 风格）：engine 侧底层事件触发时调用 core 挂的这些回调。
connect() 可在 close 后再次调用（重连由 core 编排，engine 每次新建底层连接、复用同一组回调）。

#### Properties

##### onClose()?

> `optional` **onClose**: () => `void`

Defined in: [packages/core/src/network/socket.ts:21](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/network/socket.ts#L21)

连接关闭（主动/被动均触发）。

###### Returns

`void`

##### onError()?

> `optional` **onError**: (`err`) => `void`

Defined in: [packages/core/src/network/socket.ts:23](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/network/socket.ts#L23)

传输错误（可选，仅告警；关闭以 onClose 为准）。

###### Parameters

###### err

`unknown`

###### Returns

`void`

##### onMessage()?

> `optional` **onMessage**: (`data`) => `void`

Defined in: [packages/core/src/network/socket.ts:19](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/network/socket.ts#L19)

收到一条消息（原始数据，交 ICodec 解码）。

###### Parameters

###### data

`unknown`

###### Returns

`void`

##### onOpen()?

> `optional` **onOpen**: () => `void`

Defined in: [packages/core/src/network/socket.ts:17](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/network/socket.ts#L17)

连接就绪。

###### Returns

`void`

#### Methods

##### close()

> **close**(): `void`

Defined in: [packages/core/src/network/socket.ts:15](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/network/socket.ts#L15)

主动关闭。

###### Returns

`void`

##### connect()

> **connect**(`url`): `void`

Defined in: [packages/core/src/network/socket.ts:11](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/network/socket.ts#L11)

发起连接（重连时会被再次调用）。

###### Parameters

###### url

`string`

###### Returns

`void`

##### send()

> **send**(`data`): `void`

Defined in: [packages/core/src/network/socket.ts:13](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/network/socket.ts#L13)

发送已编码数据（由 ICodec 编码后的字节/字符串）。

###### Parameters

###### data

`unknown`

###### Returns

`void`

***

### NetMessage

Defined in: [packages/core/src/network/codec.ts:5](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/network/codec.ts#L5)

框架中立消息信封。type=消息类型/协议号（路由 + 请求响应匹配用）；body=业务负载；
seq=关联 id（request 时框架分配，由 codec 写入协议约定字段；response 由 codec 从协议读出）。

#### Properties

##### body?

> `optional` **body**: `unknown`

Defined in: [packages/core/src/network/codec.ts:7](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/network/codec.ts#L7)

##### seq?

> `optional` **seq**: `number`

Defined in: [packages/core/src/network/codec.ts:8](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/network/codec.ts#L8)

##### type

> **type**: `string`

Defined in: [packages/core/src/network/codec.ts:6](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/network/codec.ts#L6)

***

### NetworkOptions

Defined in: [packages/core/src/network/network.ts:57](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/network/network.ts#L57)

#### Properties

##### codec?

> `optional` **codec**: [`ICodec`](network.md#icodec)

Defined in: [packages/core/src/network/network.ts:59](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/network/network.ts#L59)

##### heartbeat?

> `optional` **heartbeat**: [`HeartbeatOptions`](network.md#heartbeatoptions)

Defined in: [packages/core/src/network/network.ts:63](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/network/network.ts#L63)

##### logger?

> `optional` **logger**: [`ILogger`](logging.md#ilogger)

Defined in: [packages/core/src/network/network.ts:64](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/network/network.ts#L64)

##### reconnect?

> `optional` **reconnect**: [`ReconnectOptions`](network.md#reconnectoptions)

Defined in: [packages/core/src/network/network.ts:62](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/network/network.ts#L62)

##### socket?

> `optional` **socket**: [`ISocket`](network.md#isocket)

Defined in: [packages/core/src/network/network.ts:58](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/network/network.ts#L58)

##### timer?

> `optional` **timer**: [`ITimer`](timer.md#itimer)

Defined in: [packages/core/src/network/network.ts:60](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/network/network.ts#L60)

##### url?

> `optional` **url**: `string`

Defined in: [packages/core/src/network/network.ts:61](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/network/network.ts#L61)

***

### PbSchema

Defined in: [packages/core/src/network/pb-codec.ts:28](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/network/pb-codec.ts#L28)

协议 schema 接缝，由 `.proto` 的生成代码实现。

`cmdOf`/`typeOf` 是同一张表的两个方向：框架用字符串 `type` 路由（`INetwork.on(type)`），
线上用数字 `cmd` 省字节。

#### Extended by

- [`PbSchemaRegistry`](network.md#pbschemaregistry)

#### Methods

##### cmdOf()

> **cmdOf**(`type`): `undefined` \| `number`

Defined in: [packages/core/src/network/pb-codec.ts:30](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/network/pb-codec.ts#L30)

消息类型名 → cmd 号。未知类型返回 `undefined`。

###### Parameters

###### type

`string`

###### Returns

`undefined` \| `number`

##### decodeBody()

> **decodeBody**(`type`, `bytes`): `unknown`

Defined in: [packages/core/src/network/pb-codec.ts:36](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/network/pb-codec.ts#L36)

解码消息体（不含帧头）。

###### Parameters

###### type

`string`

###### bytes

`Uint8Array`

###### Returns

`unknown`

##### encodeBody()

> **encodeBody**(`type`, `body`): `Uint8Array`

Defined in: [packages/core/src/network/pb-codec.ts:34](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/network/pb-codec.ts#L34)

编码消息体（不含帧头）。

###### Parameters

###### type

`string`

###### body

`unknown`

###### Returns

`Uint8Array`

##### typeOf()

> **typeOf**(`cmd`): `undefined` \| `string`

Defined in: [packages/core/src/network/pb-codec.ts:32](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/network/pb-codec.ts#L32)

cmd 号 → 消息类型名。未知 cmd 返回 `undefined`。

###### Parameters

###### cmd

`number`

###### Returns

`undefined` \| `string`

***

### PbSchemaRegistry

Defined in: [packages/core/src/network/pb-codec.ts:112](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/network/pb-codec.ts#L112)

可增量注册的 schema —— **分包的那一半**。

协议不能一股脑塞进 base 层（改了要重启才生效）：客户端把 npm 依赖统统打进主包，
所以只有 base 装「基础段」（握手 / 心跳 / 错误 / 分配器），各功能模块的协议
随自己的 Asset Bundle 走，加载时 [add](network.md#add) 进来、释放时注销。
整个过程 `INetwork` 和 codec 实例不变，连接不断。

#### Extends

- [`PbSchema`](network.md#pbschema)

#### Methods

##### add()

> **add**(`cmds`, `body`): () => `void`

Defined in: [packages/core/src/network/pb-codec.ts:120](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/network/pb-codec.ts#L120)

注册一段协议。type 重名或 cmd 撞号**当场抛**（模块 cmd 段划错要在加载时炸，
不能等线上错发）；校验全过才落库，不留半注册的表。

###### Parameters

###### cmds

`Readonly`\<`Record`\<`string`, `number`\>\>

###### body

[`SegmentBody`](network.md#segmentbody)

###### Returns

`Function`

注销函数，交给模块的 `BundleScope.add()` 托管即可。可重复调用；
  若该段已被热更后的新段顶替，旧注销函数不会误删新段。

###### Returns

`void`

##### cmdOf()

> **cmdOf**(`type`): `undefined` \| `number`

Defined in: [packages/core/src/network/pb-codec.ts:30](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/network/pb-codec.ts#L30)

消息类型名 → cmd 号。未知类型返回 `undefined`。

###### Parameters

###### type

`string`

###### Returns

`undefined` \| `number`

###### Inherited from

[`PbSchema`](network.md#pbschema).[`cmdOf`](network.md#cmdof)

##### decodeBody()

> **decodeBody**(`type`, `bytes`): `unknown`

Defined in: [packages/core/src/network/pb-codec.ts:36](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/network/pb-codec.ts#L36)

解码消息体（不含帧头）。

###### Parameters

###### type

`string`

###### bytes

`Uint8Array`

###### Returns

`unknown`

###### Inherited from

[`PbSchema`](network.md#pbschema).[`decodeBody`](network.md#decodebody)

##### encodeBody()

> **encodeBody**(`type`, `body`): `Uint8Array`

Defined in: [packages/core/src/network/pb-codec.ts:34](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/network/pb-codec.ts#L34)

编码消息体（不含帧头）。

###### Parameters

###### type

`string`

###### body

`unknown`

###### Returns

`Uint8Array`

###### Inherited from

[`PbSchema`](network.md#pbschema).[`encodeBody`](network.md#encodebody)

##### typeOf()

> **typeOf**(`cmd`): `undefined` \| `string`

Defined in: [packages/core/src/network/pb-codec.ts:32](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/network/pb-codec.ts#L32)

cmd 号 → 消息类型名。未知 cmd 返回 `undefined`。

###### Parameters

###### cmd

`number`

###### Returns

`undefined` \| `string`

###### Inherited from

[`PbSchema`](network.md#pbschema).[`typeOf`](network.md#typeof)

***

### ReconnectOptions

Defined in: [packages/core/src/network/network.ts:14](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/network/network.ts#L14)

#### Properties

##### enabled?

> `optional` **enabled**: `boolean`

Defined in: [packages/core/src/network/network.ts:16](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/network/network.ts#L16)

默认 true。

##### maxAttempts?

> `optional` **maxAttempts**: `number`

Defined in: [packages/core/src/network/network.ts:22](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/network/network.ts#L22)

最大重连次数，默认 0（=无限）。

##### maxDelaySec?

> `optional` **maxDelaySec**: `number`

Defined in: [packages/core/src/network/network.ts:20](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/network/network.ts#L20)

退避上限（秒），默认 30。

##### minDelaySec?

> `optional` **minDelaySec**: `number`

Defined in: [packages/core/src/network/network.ts:18](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/network/network.ts#L18)

首次重连延迟（秒），默认 1；退避 = min(max, min×2^attempt)。

***

### RequestOptions

Defined in: [packages/core/src/network/network.ts:34](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/network/network.ts#L34)

#### Properties

##### timeoutSec?

> `optional` **timeoutSec**: `number`

Defined in: [packages/core/src/network/network.ts:36](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/network/network.ts#L36)

超时（秒），默认 10。

## Type Aliases

### NetHandler()

> **NetHandler**: (`body`, `msg`) => `void`

Defined in: [packages/core/src/network/network.ts:12](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/network/network.ts#L12)

推送消息处理器。

#### Parameters

##### body

`unknown`

##### msg

[`NetMessage`](network.md#netmessage)

#### Returns

`void`

***

### NetState

> **NetState**: `"closed"` \| `"connecting"` \| `"open"` \| `"reconnecting"`

Defined in: [packages/core/src/network/network.ts:9](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/network/network.ts#L9)

连接状态。

***

### SegmentBody

> **SegmentBody**: `Pick`\<[`PbSchema`](network.md#pbschema), `"encodeBody"` \| `"decodeBody"`\>

Defined in: [packages/core/src/network/pb-codec.ts:102](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/network/pb-codec.ts#L102)

一段协议的 body 编解码（由该段的生成代码提供）。

## Variables

### HTTP

> `const` **HTTP**: [`Token`](di.md#tokent)\<[`IHttp`](network.md#ihttp)\>

Defined in: [packages/core/src/network/http.ts:33](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/network/http.ts#L33)

DI token：engine 的 `ccHttpModule()` 注册 XHR 实现。

***

### NETWORK

> `const` **NETWORK**: [`Token`](di.md#tokent)\<[`INetwork`](network.md#inetwork)\>

Defined in: [packages/core/src/network/network.ts:270](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/network/network.ts#L270)

DI token：项目可 register 自己的 Network 覆盖默认。

***

### NETWORK\_SOCKET

> `const` **NETWORK\_SOCKET**: [`Token`](di.md#tokent)\<[`ISocket`](network.md#isocket)\>

Defined in: [packages/core/src/network/socket.ts:27](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/network/socket.ts#L27)

DI token：engine Bootstrap register 平台 socket 适配；未注册时 Network 回退空 socket（永不 open）。

***

### PB\_SCHEMA

> `const` **PB\_SCHEMA**: [`Token`](di.md#tokent)\<[`PbSchemaRegistry`](network.md#pbschemaregistry)\>

Defined in: [packages/core/src/network/pb-codec.ts:127](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/network/pb-codec.ts#L127)

DI token：项目在启动时把注册表放进来（基础段已注册好），
各模块 bundle 加载时取出来注册自己那段——模块不认识 `INetwork`，只认这张表。

## Functions

### createJsonCodec()

> **createJsonCodec**(): [`ICodec`](network.md#icodec)

Defined in: [packages/core/src/network/codec.ts:23](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/network/codec.ts#L23)

默认 JSON codec：type/body/seq 直接作 JSON 字段。项目可换 protobuf/二进制 codec。

#### Returns

[`ICodec`](network.md#icodec)

***

### createMemorySocket()

> **createMemorySocket**(): [`ISocket`](network.md#isocket)

Defined in: [packages/core/src/network/socket.ts:30](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/network/socket.ts#L30)

空 socket（null object）：connect/send/close 皆 no-op、回调永不触发。默认实现（无 engine 时）。

#### Returns

[`ISocket`](network.md#isocket)

***

### createNetwork()

> **createNetwork**(`opts`?): [`INetwork`](network.md#inetwork)

Defined in: [packages/core/src/network/network.ts:74](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/network/network.ts#L74)

造 Network（纯逻辑、零 cc；传输经 ISocket、协议经 ICodec、调度经 ITimer 注入）。

#### Parameters

##### opts?

[`NetworkOptions`](network.md#networkoptions)

#### Returns

[`INetwork`](network.md#inetwork)

***

### createPbSchema()

> **createPbSchema**(`cmds`, `body`): [`PbSchema`](network.md#pbschema)

Defined in: [packages/core/src/network/pb-codec.ts:192](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/network/pb-codec.ts#L192)

从一张 `{type: cmd}` 表建**单段**不可变 schema，body 编解码仍要调用方给。
只有一段协议（不分包）时用它；要分包见 [createPbSchemaRegistry](network.md#createpbschemaregistry)。

#### Parameters

##### cmds

`Readonly`\<`Record`\<`string`, `number`\>\>

##### body

[`SegmentBody`](network.md#segmentbody)

#### Returns

[`PbSchema`](network.md#pbschema)

***

### createPbSchemaRegistry()

> **createPbSchemaRegistry**(): [`PbSchemaRegistry`](network.md#pbschemaregistry)

Defined in: [packages/core/src/network/pb-codec.ts:130](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/network/pb-codec.ts#L130)

建一个空的协议注册表，等各段自己 [PbSchemaRegistry.add](network.md#add) 进来。

#### Returns

[`PbSchemaRegistry`](network.md#pbschemaregistry)

***

### createProtobufCodec()

> **createProtobufCodec**(`schema`): [`ICodec`](network.md#icodec)

Defined in: [packages/core/src/network/pb-codec.ts:64](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/network/pb-codec.ts#L64)

建 protobuf codec。

**seq 约定**：`0` 保留给「非请求」。`send()` 不带 seq → 落 0；解码读到 0 → `seq` 留
`undefined`，core 按推送走 `on(type)` 路由。core 的 `nextSeq` 从 1 起，不冲突。

**抛错语义**（与 core 现有处理对齐）：`encode` 抛错向上传播到 `send`/`request` 调用方
——发了协议里没有的消息是编程错误，应该响亮；`decode` 抛错被 core 捕获成一条 warn 并
丢弃该帧——收到坏数据不该弄垮连接。

#### Parameters

##### schema

[`PbSchema`](network.md#pbschema)

#### Returns

[`ICodec`](network.md#icodec)

***

### getHttp()

> **getHttp**(): [`IHttp`](network.md#ihttp)

Defined in: [packages/core/src/network/http.ts:36](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/network/http.ts#L36)

取全局 IHttp。core 做不了 IO，所以没有默认实现——没注册就是装配漏了，响亮地说。

#### Returns

[`IHttp`](network.md#ihttp)

***

### getNetwork()

> **getNetwork**(): [`INetwork`](network.md#inetwork)

Defined in: [packages/core/src/network/network.ts:275](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/network/network.ts#L275)

便捷取用：优先 tryResolve(NETWORK)；未注册则进程级默认（空 socket 背书）。

#### Returns

[`INetwork`](network.md#inetwork)

***

### postJson()

> **postJson**(`http`, `url`, `body`, `timeoutSec`?): `Promise`\<`unknown`\>

Defined in: [packages/core/src/network/http.ts:51](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/network/http.ts#L51)

POST 一个 JSON 并解析回来。服务端契约是 **POST-only RPC**（`POST /api/<Method>`），
且**业务错误一律 HTTP 200** + body 里带 code——CDN / 渠道 SDK 代理 / 企业网关会篡改
甚至吞掉 4xx/5xx，产生无法归因的报错。所以这里只把非 200 当传输层出事。

#### Parameters

##### http

[`IHttp`](network.md#ihttp)

##### url

`string`

##### body

`unknown`

##### timeoutSec?

`number`

#### Returns

`Promise`\<`unknown`\>

import { createPbSchemaRegistry, type PbSchemaRegistry, type SegmentBody } from '@cck/core';
import { kit } from '@kit/proto';
import { CMD } from '@kit/proto/cmd';

/**
 * 协议接入 —— 契约（`@kit/proto`）与 kit 的 `PbSchema` 接缝之间的**项目侧胶水**。
 *
 * 按 ADR-0011，kit（core / engine）里不出现任何 cmd 号或消息定义：core 只认 `PbSchema`
 * 这个接口，契约的生成产物由**接入方**喂进来。所以这一层归 apps/demo，不归 packages/。
 *
 * 放**地基 bundle** 而不是主包：协议是最常变的一层（服务端加个 cmd、改个字段），
 * 摆进 AOT 就意味着每次契约升级都要发新包。放这里 → 热更 `foundation` 即可。
 */

/**
 * protobufjs static-module 生成的消息类，只用到这两个方法。
 * `kit.v1` 是「消息名 → 类」的命名空间对象，正好和 `CMD` 的「消息名 → cmd 号」对上——
 * 这不是巧合：`CMD` 就是 kit-proto 从 `Cmd` 枚举按同一命名约定生成的，对不上它生成期就炸。
 */
interface PbMessageType {
  encode(message: unknown): { finish(): Uint8Array };
  decode(bytes: Uint8Array): unknown;
}

/**
 * 「消息名 → pb 消息类」的命名空间对象 → 一段协议的 body 编解码。
 * 基础段和各功能模块段共用同一套逻辑，模块 bundle 直接 import 这个函数。
 *
 * 模块 bundle 能这样跨包 import 一个**函数**（而不是被复制一份），靠的是
 * `foundation` 的 bundle 优先级（6）高于所有模块（1）：被多个 bundle 引用的资源归属
 * 优先级最高的那个，同级才会各复制一份。改优先级前先读 `docs/adr/0013`。
 */
export function pbSegment(types: object): SegmentBody {
  const t = types as Readonly<Record<string, PbMessageType>>;
  return {
    // `?? {}`：心跳走 `send('Ping')` 不带 body，而 pb 的 encode 会读 message 的字段。
    encodeBody: (type, body) => t[type].encode(body ?? {}).finish(),
    decodeBody: (type, bytes) => t[type].decode(bytes),
  };
}

/**
 * 业务响应的 `code` 是不是 OK。
 *
 * 契约分两层（ADR-0007）：连接层出错发 `Error` 消息 + 关连接，业务层出错走**各自响应的
 * `code` 字段**、连接不受影响。所以业务侧每个响应都要判它 —— pb 解出来是数字，
 * 且**默认值 0 是 `UNSPECIFIED` 不是 OK**（OK = 1），漏判会把「服务端没填 code」当成成功。
 */
export function isOk(code: unknown): boolean {
  return code === kit.v1.ErrorCode.ERROR_CODE_OK;
}

/** 错误码 → 名字，给日志和提示用。业务判断请用 {@link isOk}。 */
export function codeName(code: unknown): string {
  return kit.v1.ErrorCode[code as number] ?? String(code ?? '');
}

/**
 * 建协议注册表并装上**框架段**（握手 / 心跳 / 错误 / 认证 / 账号 / 邮件）。
 *
 * 框架段（cmd 1–999）随本 bundle 走，一次装齐；接入方自己的业务段（cmd 1000+）随各自
 * 功能 bundle 走，加载时 `add` 进这张表、释放时注销（见 `modules/mini-clicker/clicker-net.ts`）。
 */
export function createKitSchema(): PbSchemaRegistry {
  const schema = createPbSchemaRegistry();
  schema.add(CMD, pbSegment(kit.v1));
  return schema;
}

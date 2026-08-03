import type { ICodec, NetMessage } from './codec';

/**
 * protobuf 帧编解码。**本文件不含任何具体协议** —— 帧头的拆装在这里，
 * 消息体和 cmd 映射全由注入的 {@link PbSchema} 提供（生成代码实现它）。
 * 换协议只换 schema，core 的请求关联 / 路由逻辑不动。见 ADR-0011。
 *
 * 线上格式（大端 = 网络字节序）：
 * ```
 * [u16 cmd][u32 seq][pb body ...]
 * ```
 * - **不加长度前缀**：WebSocket 自带 message 边界，长度前缀是 TCP 才需要的。
 *   将来接裸 TCP 要在那个 ISocket 适配里补 varint 长度前缀，不在本 codec。
 * - **定长头而非 Envelope message**：网关读 6 字节就能路由，**永不反序列化 body**，
 *   于是它对所有业务协议无知——新增模块时网关不改代码、不重新部署。
 */

/** 帧头字节数：u16 cmd + u32 seq。 */
const HEADER_BYTES = 6;

/**
 * 协议 schema 接缝，由 `.proto` 的生成代码实现。
 *
 * `cmdOf`/`typeOf` 是同一张表的两个方向：框架用字符串 `type` 路由（`INetwork.on(type)`），
 * 线上用数字 `cmd` 省字节。
 */
export interface PbSchema {
  /** 消息类型名 → cmd 号。未知类型返回 `undefined`。 */
  cmdOf(type: string): number | undefined;
  /** cmd 号 → 消息类型名。未知 cmd 返回 `undefined`。 */
  typeOf(cmd: number): string | undefined;
  /** 编码消息体（不含帧头）。 */
  encodeBody(type: string, body: unknown): Uint8Array;
  /** 解码消息体（不含帧头）。 */
  decodeBody(type: string, bytes: Uint8Array): unknown;
}

/**
 * 把 socket 收到的东西归一成可读字节；不是二进制就抛（多半是 codec 配错了）。
 *
 * ponytail: 只认 `Uint8Array`（Node 的 `Buffer` 是它的子类）和 `ArrayBuffer`——真实
 * 传输层只产这两种。别的 TypedArray / DataView 走下面的 throw，报错信息够指路。
 */
function asBytes(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  throw new Error(
    `pb-codec: 收到非二进制数据（${typeof data}）——` +
      `WebSocket 适配层是否漏设 binaryType='arraybuffer'？`,
  );
}

/**
 * 建 protobuf codec。
 *
 * **seq 约定**：`0` 保留给「非请求」。`send()` 不带 seq → 落 0；解码读到 0 → `seq` 留
 * `undefined`，core 按推送走 `on(type)` 路由。core 的 `nextSeq` 从 1 起，不冲突。
 *
 * **抛错语义**（与 core 现有处理对齐）：`encode` 抛错向上传播到 `send`/`request` 调用方
 * ——发了协议里没有的消息是编程错误，应该响亮；`decode` 抛错被 core 捕获成一条 warn 并
 * 丢弃该帧——收到坏数据不该弄垮连接。
 */
export function createProtobufCodec(schema: PbSchema): ICodec {
  return {
    encode(msg: NetMessage): ArrayBuffer {
      const cmd = schema.cmdOf(msg.type);
      if (cmd === undefined) {
        throw new Error(`pb-codec: 未知消息类型 '${msg.type}'（schema 里没有它的 cmd）`);
      }
      const body = schema.encodeBody(msg.type, msg.body);
      const out = new Uint8Array(HEADER_BYTES + body.byteLength);
      const view = new DataView(out.buffer);
      view.setUint16(0, cmd);
      // ponytail: seq 是 u32，超过 2^32 会静默回绕并可能错配 pending。单条 INetwork 生命周期内
      // 要发 40 亿次请求才够得着（100 req/s 跑一年半），不加分支；真要跑那么久就在这里补回绕检查。
      view.setUint32(2, msg.seq ?? 0);
      out.set(body, HEADER_BYTES);
      return out.buffer;
    },

    decode(data: unknown): NetMessage {
      const bytes = asBytes(data);
      if (bytes.byteLength < HEADER_BYTES) {
        throw new Error(`pb-codec: 帧长 ${bytes.byteLength} < 帧头 ${HEADER_BYTES} 字节`);
      }
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const cmd = view.getUint16(0);
      const seq = view.getUint32(2);
      const type = schema.typeOf(cmd);
      if (type === undefined) {
        throw new Error(`pb-codec: 未知 cmd ${cmd}（schema 里没有它的类型名）`);
      }
      const body = schema.decodeBody(type, bytes.subarray(HEADER_BYTES));
      // seq 0 = 服务器主动推送，不是任何 request 的响应。
      return seq === 0 ? { type, body } : { type, body, seq };
    },
  };
}

/**
 * 从一张 `{type: cmd}` 表建 schema 的辅助器，body 编解码仍要调用方给。
 * 生成代码通常直接实现 {@link PbSchema}；这个只是省掉手写双向表的样板。
 */
export function createPbSchema(
  cmds: Readonly<Record<string, number>>,
  body: Pick<PbSchema, 'encodeBody' | 'decodeBody'>,
): PbSchema {
  const byType = new Map<string, number>(Object.entries(cmds));
  const byCmd = new Map<number, string>();
  for (const [type, cmd] of byType) {
    const dup = byCmd.get(cmd);
    if (dup !== undefined) {
      throw new Error(`pb-codec: cmd ${cmd} 被 '${dup}' 和 '${type}' 同时占用`);
    }
    byCmd.set(cmd, type);
  }
  return {
    cmdOf: (type) => byType.get(type),
    typeOf: (cmd) => byCmd.get(cmd),
    encodeBody: body.encodeBody,
    decodeBody: body.decodeBody,
  };
}

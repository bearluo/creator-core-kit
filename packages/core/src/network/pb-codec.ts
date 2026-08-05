import { createToken, type Token } from '../di';
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

/** 一段协议的 body 编解码（由该段的生成代码提供）。 */
export type SegmentBody = Pick<PbSchema, 'encodeBody' | 'decodeBody'>;

/**
 * 可增量注册的 schema —— **分包的那一半**。
 *
 * 协议不能一股脑塞进不可热更的 AOT 层：客户端把 npm 依赖统统打进主包，
 * 所以只有 AOT 装「基础段」（握手 / 心跳 / 错误 / 分配器），各功能模块的协议
 * 随自己的 Asset Bundle 走，加载时 {@link add} 进来、释放时注销。
 * 整个过程 `INetwork` 和 codec 实例不变，连接不断。
 */
export interface PbSchemaRegistry extends PbSchema {
  /**
   * 注册一段协议。type 重名或 cmd 撞号**当场抛**（模块 cmd 段划错要在加载时炸，
   * 不能等线上错发）；校验全过才落库，不留半注册的表。
   *
   * @returns 注销函数，交给模块的 `BundleScope.add()` 托管即可。可重复调用；
   *   若该段已被热更后的新段顶替，旧注销函数不会误删新段。
   */
  add(cmds: Readonly<Record<string, number>>, body: SegmentBody): () => void;
}

/**
 * DI token：项目在启动时把注册表放进来（基础段已注册好），
 * 各模块 bundle 加载时取出来注册自己那段——模块不认识 `INetwork`，只认这张表。
 */
export const PB_SCHEMA: Token<PbSchemaRegistry> = createToken<PbSchemaRegistry>('cck.pbSchema');

/** 建一个空的协议注册表，等各段自己 {@link PbSchemaRegistry.add} 进来。 */
export function createPbSchemaRegistry(): PbSchemaRegistry {
  /** 用对象引用当这一次注册的身份，注销时按引用比对。 */
  interface Entry {
    readonly cmd: number;
    readonly body: SegmentBody;
  }
  const byType = new Map<string, Entry>();
  const byCmd = new Map<number, string>();

  const entryOf = (type: string): Entry => {
    const e = byType.get(type);
    if (e === undefined) {
      throw new Error(`pb-codec: 未知消息类型 '${type}'（所属协议段没注册，或已随 bundle 释放）`);
    }
    return e;
  };

  return {
    cmdOf: (type) => byType.get(type)?.cmd,
    typeOf: (cmd) => byCmd.get(cmd),
    encodeBody: (type, body) => entryOf(type).body.encodeBody(type, body),
    decodeBody: (type, bytes) => entryOf(type).body.decodeBody(type, bytes),

    add(cmds, body) {
      const pairs = Object.entries(cmds);
      // 先全量校验再落库——半注册的表比没注册更难查。`pending` 兜住同一批内部撞号。
      const pending = new Map<number, string>();
      for (const [type, cmd] of pairs) {
        if (byType.has(type)) {
          throw new Error(`pb-codec: 消息类型 '${type}' 已被注册（两段协议重名？）`);
        }
        const dup = byCmd.get(cmd) ?? pending.get(cmd);
        if (dup !== undefined) {
          throw new Error(`pb-codec: cmd ${cmd} 被 '${dup}' 和 '${type}' 同时占用`);
        }
        pending.set(cmd, type);
      }

      const added = pairs.map(([type, cmd]): [string, Entry] => {
        const entry: Entry = { cmd, body };
        byType.set(type, entry);
        byCmd.set(cmd, type);
        return [type, entry];
      });

      return () => {
        for (const [type, entry] of added) {
          // 按引用比对：模块热更重载后同 cmd 可能已归新段，旧注销函数不许把新段摘掉。
          if (byType.get(type) === entry) {
            byType.delete(type);
            byCmd.delete(entry.cmd);
          }
        }
      };
    },
  };
}

/**
 * 从一张 `{type: cmd}` 表建**单段**不可变 schema，body 编解码仍要调用方给。
 * 只有一段协议（不分包）时用它；要分包见 {@link createPbSchemaRegistry}。
 */
export function createPbSchema(
  cmds: Readonly<Record<string, number>>,
  body: SegmentBody,
): PbSchema {
  const registry = createPbSchemaRegistry();
  registry.add(cmds, body);
  return registry;
}

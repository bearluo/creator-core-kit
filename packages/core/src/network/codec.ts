/**
 * 框架中立消息信封。type=消息类型/协议号（路由 + 请求响应匹配用）；body=业务负载；
 * seq=关联 id（request 时框架分配，由 codec 写入协议约定字段；response 由 codec 从协议读出）。
 */
export interface NetMessage {
  type: string;
  body?: unknown;
  seq?: number;
}

/**
 * 协议编解码接缝：消息信封 ↔ 线上数据（字节/字符串）。core 用它把 seq 落到/读出协议约定字段——
 * 换 protobuf / 自定义二进制只换 codec，core 的请求关联/路由逻辑不动（见 network 横评 N5/Q-N3）。
 */
export interface ICodec {
  /** 信封 → 发送数据。须把 msg.seq 落到协议里服务器会原样回传的字段。 */
  encode(msg: NetMessage): unknown;
  /** 收到数据 → 信封。须从协议字段读出 seq（无关联 id 则 seq=undefined，core 按推送处理）。 */
  decode(data: unknown): NetMessage;
}

/** 默认 JSON codec：type/body/seq 直接作 JSON 字段。项目可换 protobuf/二进制 codec。 */
export function createJsonCodec(): ICodec {
  return {
    encode: (msg: NetMessage): string => JSON.stringify(msg),
    decode: (data: unknown): NetMessage => JSON.parse(String(data)) as NetMessage,
  };
}

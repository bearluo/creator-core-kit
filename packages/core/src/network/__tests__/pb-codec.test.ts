import { describe, expect, it, vi } from 'vitest';
import { createPbSchema, createProtobufCodec, type PbSchema } from '../pb-codec';

/**
 * 帧头（`[u16 cmd][u32 seq][pb body]`）的拆装测试。body 编解码用**透传假 schema**——
 * 本 codec 不该知道 protobuf 长什么样，真 pb 的编解码是生成代码的事。
 */

/** body 直接是字节数组的假 schema：编解码可逆且肉眼可读。 */
function fakeSchema(cmds: Record<string, number> = { ping: 1, chat: 2, push: 3 }): PbSchema {
  return createPbSchema(cmds, {
    encodeBody: (_type, body) => Uint8Array.from((body as number[]) ?? []),
    decodeBody: (_type, bytes) => Array.from(bytes),
  });
}

/** 取帧头三元组，避免每个用例重复写 DataView。 */
function header(buf: ArrayBuffer): { cmd: number; seq: number; body: number[] } {
  const view = new DataView(buf);
  return {
    cmd: view.getUint16(0),
    seq: view.getUint32(2),
    body: Array.from(new Uint8Array(buf, 6)),
  };
}

describe('createProtobufCodec', () => {
  it('1. encode 产出 [u16 cmd][u32 seq][body]，大端', () => {
    const buf = createProtobufCodec(fakeSchema()).encode({
      type: 'chat',
      body: [9, 8],
      seq: 0x01020304,
    }) as ArrayBuffer;
    expect(buf.byteLength).toBe(6 + 2);
    expect(header(buf)).toEqual({ cmd: 2, seq: 0x01020304, body: [9, 8] });
    // 大端：高位字节在前
    expect(Array.from(new Uint8Array(buf, 2, 4))).toEqual([1, 2, 3, 4]);
  });

  it('2. round-trip：encode → decode 还原 type / body / seq', () => {
    const codec = createProtobufCodec(fakeSchema());
    const msg = { type: 'chat', body: [1, 2, 3], seq: 42 };
    expect(codec.decode(codec.encode(msg))).toEqual(msg);
  });

  it('3. 无 seq（send 走的路）→ 落 0；解回来 seq 是 undefined 不是 0', () => {
    const codec = createProtobufCodec(fakeSchema());
    const buf = codec.encode({ type: 'ping', body: [] }) as ArrayBuffer;
    expect(header(buf).seq).toBe(0);
    const back = codec.decode(buf);
    expect(back.seq).toBeUndefined();
    expect('seq' in back).toBe(false); // core 用 `msg.seq != null` 判，别塞个 0 进去
  });

  it('4. seq 0 的入站帧按推送处理（不会去撞 pending 表）', () => {
    const codec = createProtobufCodec(fakeSchema());
    const frame = new Uint8Array([0, 3, 0, 0, 0, 0, 7]); // cmd=3 seq=0 body=[7]
    expect(codec.decode(frame.buffer)).toEqual({ type: 'push', body: [7] });
  });

  it('5. encode 未知 type → 抛（编程错误，要响亮）', () => {
    expect(() => createProtobufCodec(fakeSchema()).encode({ type: 'nope' })).toThrow(/未知消息类型/);
  });

  it('6. decode 未知 cmd → 抛（core 会捕获成 warn 并丢帧）', () => {
    const frame = new Uint8Array([0xff, 0xff, 0, 0, 0, 1]);
    expect(() => createProtobufCodec(fakeSchema()).decode(frame.buffer)).toThrow(/未知 cmd 65535/);
  });

  it('7. decode 短帧 → 抛，不越界读', () => {
    expect(() => createProtobufCodec(fakeSchema()).decode(new Uint8Array([0, 1, 0]).buffer)).toThrow(
      /帧长 3/,
    );
  });

  it('8. decode 收到 string → 抛，且指出 binaryType 这个真凶', () => {
    expect(() => createProtobufCodec(fakeSchema()).decode('{"type":"ping"}')).toThrow(
      /binaryType/,
    );
  });

  it('9. decode 接受 ArrayBuffer / Uint8Array / 带 offset 的视图', () => {
    const codec = createProtobufCodec(fakeSchema());
    const buf = codec.encode({ type: 'chat', body: [5], seq: 1 }) as ArrayBuffer;
    const expected = { type: 'chat', body: [5], seq: 1 };
    expect(codec.decode(buf)).toEqual(expected);
    expect(codec.decode(new Uint8Array(buf))).toEqual(expected);
    // 带 byteOffset 的视图：底层 buffer 前面还有别的字节，不能按 buffer 起点读
    const padded = new Uint8Array(3 + buf.byteLength);
    padded.set(new Uint8Array(buf), 3);
    expect(codec.decode(padded.subarray(3))).toEqual(expected);
  });

  it('10. 空 body 往返不炸', () => {
    const codec = createProtobufCodec(fakeSchema());
    const buf = codec.encode({ type: 'ping', body: [], seq: 1 }) as ArrayBuffer;
    expect(buf.byteLength).toBe(6);
    expect(codec.decode(buf)).toEqual({ type: 'ping', body: [], seq: 1 });
  });

  it('11. body 编解码全权交给 schema（codec 不认识 protobuf）', () => {
    const encodeBody = vi.fn(() => new Uint8Array([1]));
    const decodeBody = vi.fn(() => 'decoded');
    const schema = createPbSchema({ x: 7 }, { encodeBody, decodeBody });
    const codec = createProtobufCodec(schema);
    const buf = codec.encode({ type: 'x', body: { any: 'shape' } }) as ArrayBuffer;
    expect(encodeBody).toHaveBeenCalledWith('x', { any: 'shape' });
    expect(codec.decode(buf).body).toBe('decoded');
    expect(decodeBody).toHaveBeenCalledWith('x', new Uint8Array([1]));
  });
});

describe('createPbSchema', () => {
  it('12. 双向映射', () => {
    const s = fakeSchema({ a: 10, b: 20 });
    expect(s.cmdOf('a')).toBe(10);
    expect(s.typeOf(20)).toBe('b');
    expect(s.cmdOf('missing')).toBeUndefined();
    expect(s.typeOf(999)).toBeUndefined();
  });

  it('13. cmd 撞号 → 建表时就抛（别等线上错发）', () => {
    expect(() => fakeSchema({ a: 5, b: 5 })).toThrow(/cmd 5 被/);
  });
});

import { describe, expect, it } from 'vitest';
import { createProtobufCodec } from '@cck/core';
import { kit } from '@kit/proto';
import { CMD } from '@kit/proto/cmd';
import { createKitSchema } from '../../assets/scenes/kit-net';

/**
 * 协议接入的**契约守卫**：证明 `@kit/proto` 的生成产物插进 core 的 `PbSchema` 接缝后
 * 确实能打出对的帧。跑在 node，不需要服务器、不需要 Creator。
 *
 * 打真服务器的往返验证另在两处：`packages/core/src/__tests__/e2e-server.test.ts`
 * （手写 schema 验帧头与 seq 回传）、kit-proto 自己的 `pnpm verify`（TS ↔ Go 互验 pb 编码）。
 * 这里补的是中间那段——**契约产物与本框架的接线**，也是唯一会因为对方 `pnpm gen` 而漂移的一段。
 */

const types = kit.v1 as unknown as Record<string, unknown>;

describe('kit-proto 接入', () => {
  it('CMD 表里每个消息名在 kit.v1 里都有对应的 pb 类', () => {
    // 漂移守卫：契约加了 cmd 却没加 message（或改了命名约定），编码期才炸就晚了
    expect(Object.keys(CMD).length).toBeGreaterThan(0);
    for (const name of Object.keys(CMD)) {
      expect(types[name], `kit.v1.${name} 不存在`).toBeDefined();
    }
  });

  it('schema 的 cmd ↔ type 双向表与契约一致', () => {
    const schema = createKitSchema();
    for (const [name, cmd] of Object.entries(CMD)) {
      expect(schema.cmdOf(name)).toBe(cmd);
      expect(schema.typeOf(cmd)).toBe(name);
    }
  });

  it('Ping 走一个 codec 来回：帧头是大端 [u16 cmd][u32 seq]，body 原样解回', () => {
    const codec = createProtobufCodec(createKitSchema());
    const clientTimeMs = 1700000000123;
    // ICodec.encode 声明成 unknown（JSON codec 产 string、pb codec 产 ArrayBuffer）
    const frame = codec.encode({ type: 'Ping', body: { clientTimeMs }, seq: 7 }) as ArrayBuffer;

    const view = new DataView(frame);
    expect(view.getUint16(0)).toBe(CMD['Ping']); // 大端；小端会读成 0x0a00 = 2560
    expect(view.getUint32(2)).toBe(7);

    const back = codec.decode(frame);
    expect(back.type).toBe('Ping');
    expect(back.seq).toBe(7);
    // double（不是 int64）→ 两边都是原生 number，不会变成 Long 对象（kit-proto ADR-0002）
    expect((back.body as { clientTimeMs: number }).clientTimeMs).toBe(clientTimeMs);
  });

  it('心跳的空 body 能编码（core 的 send(type) 不带 body）', () => {
    const codec = createProtobufCodec(createKitSchema());
    expect(() => codec.encode({ type: 'Ping' })).not.toThrow();
    // seq 省略 → 落 0 → 解码端认作服务器推送，不占请求位
    expect(codec.decode(codec.encode({ type: 'Ping' })).seq).toBeUndefined();
  });
});

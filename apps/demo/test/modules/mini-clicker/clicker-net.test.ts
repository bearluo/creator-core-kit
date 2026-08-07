import { beforeEach, describe, expect, it } from 'vitest';
import { createProtobufCodec, getRootContainer, PB_SCHEMA, type PbSchemaRegistry } from '@cck/core';
import { CMD as BASE_CMD } from '@kit/proto/cmd';
import { createKitSchema } from '../../../assets/foundation/net/schema';
import { CMD, game } from '../../../assets/modules/mini-clicker/clicker-proto';
import { registerClickerProto } from '../../../assets/modules/mini-clicker/clicker-net';

/**
 * 模块协议段的**契约守卫**：证明「协议随 bundle 走」这条路是通的——注册后能打出本段的帧、
 * 注销后干干净净、基础段全程不受影响。跑在 node，不需要服务器、不需要 Creator。
 *
 * 号段守卫是这里最值钱的一条：cmd 撞号只有两个模块**同时在线**时才复现，而且症状是
 * 「A 模块的包被发给 B 模块」——线上抓这个比在这儿断言贵几个数量级。
 */

/** clicker 在契约仓分到的号段（kit-proto README 的分段表，第 1 个模块）。 */
const SEGMENT = { from: 1000, to: 1999 };

describe('clicker 模块协议段', () => {
  let schema: PbSchemaRegistry;

  beforeEach(() => {
    // 每例重来一张表：注册/注销的用例之间不许串味。根容器在整个测试文件里是同一个，
    // 所以要 allowOverride（生产侧走 tryResolve 判空，不会重复注册）。
    schema = createKitSchema();
    getRootContainer().register(PB_SCHEMA, { useValue: schema }, { allowOverride: true });
  });

  it('CMD 表里每个消息名在 game.clicker.v1 里都有对应的 pb 类', () => {
    const types = game.clicker.v1 as unknown as Record<string, unknown>;
    expect(Object.keys(CMD).length).toBeGreaterThan(0);
    for (const name of Object.keys(CMD)) {
      expect(types[name], `game.clicker.v1.${name} 不存在`).toBeDefined();
    }
  });

  it('cmd 号全在分配的号段内，且不与基础段重叠', () => {
    const baseCmds = new Set(Object.values(BASE_CMD));
    for (const [name, cmd] of Object.entries(CMD)) {
      expect(cmd, `${name} 越出 clicker 号段`).toBeGreaterThanOrEqual(SEGMENT.from);
      expect(cmd, `${name} 越出 clicker 号段`).toBeLessThanOrEqual(SEGMENT.to);
      expect(baseCmds.has(cmd), `${name} 与基础段撞号`).toBe(false);
    }
  });

  it('注册前发本段消息报未知类型，注册后即可用（同一个 codec 实例）', () => {
    const codec = createProtobufCodec(schema);
    expect(() => codec.encode({ type: 'ClickRequest', body: { count: 1 } })).toThrow(
      /未知消息类型/,
    );

    registerClickerProto();

    const frame = codec.encode({ type: 'ClickRequest', body: { count: 42 }, seq: 3 }) as ArrayBuffer;
    expect(new DataView(frame).getUint16(0)).toBe(CMD['ClickRequest']); // 大端
    expect(new DataView(frame).getUint32(2)).toBe(3);
    const back = codec.decode(frame);
    expect(back.type).toBe('ClickRequest');
    expect((back.body as { count: number }).count).toBe(42);
  });

  it('注销（bundle 释放）后本段消失，基础段照常', () => {
    const off = registerClickerProto();
    expect(schema.cmdOf('ClickRequest')).toBe(CMD['ClickRequest']);

    off();

    expect(schema.cmdOf('ClickRequest')).toBeUndefined();
    expect(schema.typeOf(CMD['ClickResponse'])).toBeUndefined();
    expect(schema.cmdOf('Ping')).toBe(BASE_CMD['Ping']); // 心跳不受模块卸载影响
  });

  it('重复注册幂等：界面重建（转屏/换皮）再调一次不炸', () => {
    registerClickerProto();
    expect(() => registerClickerProto()).not.toThrow();
    expect(schema.cmdOf('ClickRequest')).toBe(CMD['ClickRequest']);
  });
});

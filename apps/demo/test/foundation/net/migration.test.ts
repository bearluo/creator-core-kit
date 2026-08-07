import { describe, expect, it } from 'vitest';
import { createNetwork, createProtobufCodec, createTimer, type ISocket } from '@cck/core';
import { createGatewayMigration } from '../../../assets/foundation/net/migration';
import { createKitSchema } from '../../../assets/foundation/net/schema';

/** 假 socket：记下每次 connect 的 url，并能手动灌入服务端帧 / 制造断线。 */
function fakeSocket(): ISocket & { urls: string[]; open(): void; drop(): void } {
  const s = {
    urls: [] as string[],
    connect(url: string) {
      s.urls.push(url);
    },
    send() {},
    close() {},
    open: () => s.onOpen?.(),
    drop: () => s.onClose?.(),
  } as ISocket & { urls: string[]; open(): void; drop(): void };
  return s;
}

/** 一条连上的连接 + 搬家器。`next` 是「重新握手会拿到的地址」，测试里随时改。 */
function retiringHarness(next = { url: 'ws://gw-new/ws' }) {
  const socket = fakeSocket();
  const codec = createProtobufCodec(createKitSchema());
  const net = createNetwork({
    socket,
    codec,
    timer: createTimer(), // 不 tick → 退避重连不会真的发生，正好隔离出搬家这一步
    url: 'ws://gw-old/ws',
    heartbeat: { enabled: false },
  });
  net.connect();
  socket.open();
  const migration = createGatewayMigration(net, 'ws://gw-old/ws', () => Promise.resolve(next.url));
  /** 服务端推一条 GatewayRetiring（推送 = seq 0），走真 codec、真契约。 */
  const pushRetiring = (deadlineAtMs = 0, msg = 'gw-old 下线'): void =>
    socket.onMessage?.(codec.encode({ type: 'GatewayRetiring', body: { deadlineAtMs, msg } }));
  return { socket, net, migration, pushRetiring };
}

describe('GatewayRetiring（cmd 16）· 网关优雅退休', () => {
  it('收到它不是被踢：连接照常可用，只是标记待搬家', () => {
    const { net, migration, pushRetiring } = retiringHarness();
    pushRetiring();
    expect(net.state).toBe('open'); // 一条连接都没断
    expect(migration.pending).toBe(true);
    migration.dispose();
  });

  it('择机重新握手 → 连到握手下发的那个网关（不复用旧地址）', async () => {
    const { socket, net, migration, pushRetiring } = retiringHarness();
    pushRetiring();
    await migration.atSafePoint();
    expect(socket.urls).toEqual(['ws://gw-old/ws', 'ws://gw-new/ws']);
    expect(net.state).toBe('connecting');
    expect(migration.pending).toBe(false); // 搬完就不再是退休状态
    migration.dispose();
  });

  it('没收到退休通知时 atSafePoint 是 no-op（每次回大厅都会调它）', async () => {
    const { socket, migration } = retiringHarness();
    await migration.atSafePoint();
    expect(socket.urls).toEqual(['ws://gw-old/ws']);
    migration.dispose();
  });

  it('后一条完全覆盖前一条：补发带截止的那条不会叠加成第二次搬家', async () => {
    const { socket, migration, pushRetiring } = retiringHarness();
    pushRetiring(0); // 常态：不设截止
    pushRetiring(1.9e12, '2 小时后强制断开'); // 几小时后补一条带截止的
    await migration.atSafePoint();
    await migration.atSafePoint();
    expect(socket.urls).toEqual(['ws://gw-old/ws', 'ws://gw-new/ws']); // 只搬了一次
    migration.dispose();
  });

  it('退休期间掉线（deadline 到点的 Kick 也算）→ 先握手换地址，不按老地址重连', () => {
    const { socket, migration, pushRetiring } = retiringHarness();
    pushRetiring(1.9e12);
    socket.drop();
    return Promise.resolve().then(() => {
      expect(socket.urls).toEqual(['ws://gw-old/ws', 'ws://gw-new/ws']);
      migration.dispose();
    });
  });

  it('握手拿不到地址（维护 / 强更）→ 留在原网关，下个时机再试', async () => {
    const next = { url: '' };
    const { socket, net, migration, pushRetiring } = retiringHarness(next);
    pushRetiring();
    await migration.atSafePoint();
    expect(socket.urls).toEqual(['ws://gw-old/ws']); // 没换连接
    expect(net.state).toBe('open');
    expect(migration.pending).toBe(true); // 仍待搬家
    next.url = 'ws://gw-new/ws';
    await migration.atSafePoint();
    expect(socket.urls).toEqual(['ws://gw-old/ws', 'ws://gw-new/ws']);
    migration.dispose();
  });

  it('握手又把我派回这台 → 不搬也不永久挂着（真服务器实测过的场景）', async () => {
    // 握手无缓存 → 它还往这台派人 = 此刻这台可用（退休撤销了，或路由尚未摘除）。
    const next = { url: 'ws://gw-old/ws' };
    const { socket, net, migration, pushRetiring } = retiringHarness(next);
    pushRetiring();
    await migration.atSafePoint();
    expect(socket.urls).toEqual(['ws://gw-old/ws']); // 没白断一次重连
    expect(net.state).toBe('open');
    expect(migration.pending).toBe(false); // 也没一直挂着让此后每个时机都白打一次握手

    // 真还在退休的话服务端会再说一遍（重连上去立刻又推一条 / 服务端主动重发），那时照常搬。
    next.url = 'ws://gw-new/ws';
    pushRetiring();
    await migration.atSafePoint();
    expect(socket.urls).toEqual(['ws://gw-old/ws', 'ws://gw-new/ws']);
    migration.dispose();
  });

  it('未注册的 cmd 丢弃并继续，绝不断连（kit-proto 不变量）', () => {
    const { socket, net, migration } = retiringHarness();
    const frame = new Uint8Array(6);
    new DataView(frame.buffer).setUint16(0, 0xffff); // 编译期还不认识的新推送
    socket.onMessage?.(frame.buffer);
    expect(net.state).toBe('open');
    migration.dispose();
  });
});

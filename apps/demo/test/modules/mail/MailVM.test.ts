import { describe, expect, it } from 'vitest';
import { kit } from '@kit/proto';
import { MailVM, type MailNet, type MailTimer } from '../../../assets/modules/mail/MailVM';

/**
 * 邮件 VM 的单测 —— 零 `cc`、零网络，直接在 node 跑。
 *
 * 这里守的是**契约里那几条容易写错的规矩**，而不是「函数调没调到」：
 * 推送只当提醒不取数据、去抖合并、能不能领看附件不看 claimed、实发物品以响应为准。
 */

const OK = kit.v1.ErrorCode.ERROR_CODE_OK;

/** 一封邮件的 pb 形状（protobufjs 解出来就是这样：默认值字段直接缺席）。 */
function mail(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { mailId: 'm1', title: '登录奖励', body: '领了别忘了上线', createdAtMs: 1, ...over };
}

/** 记录每次请求，按 type 回预置响应。 */
function fakeNet(replies: Record<string, unknown[]>) {
  const calls: { type: string; body: unknown }[] = [];
  const pushHandlers = new Map<string, (b?: unknown) => void>();
  const net: MailNet = {
    request(type, body) {
      calls.push({ type, body });
      const queue = replies[type];
      const next = queue && queue.length > 1 ? queue.shift() : queue?.[0];
      return Promise.resolve({ type: `${type}-reply`, body: next ?? {} });
    },
    on(type, handler) {
      pushHandlers.set(type, handler as (b?: unknown) => void);
      return () => pushHandlers.delete(type);
    },
  };
  return {
    net,
    calls,
    /** 服务端推一条 MailArrived（空消息）。 */
    arrive: (): void => pushHandlers.get('MailArrived')?.(),
    hasHandler: (): boolean => pushHandlers.has('MailArrived'),
  };
}

/** 手动推进的定时器：记下待触发的回调，`fire()` 才跑。 */
function fakeTimer() {
  let pending: (() => void) | undefined;
  let scheduled = 0;
  const timer: MailTimer = {
    delay(_sec, cb) {
      scheduled++;
      pending = cb;
      return () => {
        pending = undefined;
      };
    },
  };
  return {
    timer,
    /** 排过几次定时（去抖的证据：推 3 条只该留 1 个待触发）。 */
    get scheduled(): number {
      return scheduled;
    },
    get armed(): boolean {
      return pending !== undefined;
    },
    fire(): void {
      const cb = pending;
      pending = undefined;
      cb?.();
    },
  };
}

/** 等一轮微任务，让 VM 里的 async 链跑完。 */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('MailVM · 拉列表', () => {
  it('start() 立刻拉一次，把 pb 的缺省字段补成安全默认值', async () => {
    const f = fakeNet({ MailListRequest: [{ code: OK, mails: [mail()] }] });
    const vm = new MailVM(f.net, fakeTimer().timer);
    vm.start();
    await settle();

    expect(f.calls[0]?.type).toBe('MailListRequest');
    const [m] = vm.mails.value;
    expect(m?.id).toBe('m1');
    // pb 不传默认值 → read/claimed/expireAtMs 全缺席，不能变成 undefined 漏进 UI
    expect(m?.read).toBe(false);
    expect(m?.claimed).toBe(false);
    expect(m?.expireAtMs).toBe(0);
    expect(m?.attachments).toEqual([]);
    expect(vm.unread.value).toBe(1);
  });

  it('code 不是 OK → 落 error，不动列表（pb 默认值 0 也算失败）', async () => {
    const f = fakeNet({ MailListRequest: [{ code: kit.v1.ErrorCode.ERROR_CODE_RATE_LIMITED }] });
    const vm = new MailVM(f.net, fakeTimer().timer);
    await vm.refresh();

    expect(vm.mails.value).toEqual([]);
    expect(vm.error.value).toContain('ERROR_CODE_RATE_LIMITED');
  });

  it('loadMore 原样回传上一页的 next_cursor；没有下一页就是 no-op', async () => {
    const f = fakeNet({
      MailListRequest: [
        { code: OK, mails: [mail()], nextCursor: 'cur-2', hasMore: true },
        { code: OK, mails: [mail({ mailId: 'm2' })] },
      ],
    });
    const vm = new MailVM(f.net, fakeTimer().timer);
    await vm.refresh();
    expect(vm.hasMore.value).toBe(true);

    await vm.loadMore();
    expect((f.calls[1]?.body as { cursor: string }).cursor).toBe('cur-2'); // 原样回传
    expect(vm.mails.value.map((m) => m.id)).toEqual(['m1', 'm2']); // 追加不是覆盖
    expect(vm.hasMore.value).toBe(false);

    await vm.loadMore(); // 没有下一页了
    expect(f.calls).toHaveLength(2);
  });
});

describe('MailVM · MailArrived 推送', () => {
  it('推送只当提醒：不从 body 取数据，一律回头拉列表', async () => {
    const f = fakeNet({ MailListRequest: [{ code: OK, mails: [] }] });
    const t = fakeTimer();
    const vm = new MailVM(f.net, t.timer);
    vm.start();
    await settle();
    expect(f.calls).toHaveLength(1); // start 的那一次

    f.arrive();
    t.fire();
    await settle();
    expect(f.calls).toHaveLength(2);
    expect(f.calls[1]?.type).toBe('MailListRequest'); // 拉列表，而不是拿推送里的东西用
  });

  it('去抖：运营群发 3 封 → 合并成一次拉取，不是 3 次', async () => {
    const f = fakeNet({ MailListRequest: [{ code: OK, mails: [] }] });
    const t = fakeTimer();
    const vm = new MailVM(f.net, t.timer);
    vm.start();
    await settle();

    f.arrive();
    f.arrive();
    f.arrive();
    expect(t.armed).toBe(true);
    t.fire(); // 窗口到点，只触发一次
    await settle();
    expect(f.calls).toHaveLength(2); // start 一次 + 合并后的一次
  });

  it('返回的 disposer 撤订阅并取消在途的去抖（界面关了别再后台拉）', async () => {
    const f = fakeNet({ MailListRequest: [{ code: OK, mails: [] }] });
    const t = fakeTimer();
    const vm = new MailVM(f.net, t.timer);
    const stop = vm.start();
    await settle();

    f.arrive();
    stop();
    t.fire(); // 已被取消：即使定时器被外力触发也不该再拉
    await settle();
    expect(f.calls).toHaveLength(1);
    expect(f.hasHandler()).toBe(false);
  });
});

describe('MailVM · 领取与已读', () => {
  it('能不能领看附件非空，不看 claimed —— 纯通知邮件不给领取按钮', async () => {
    const f = fakeNet({
      MailListRequest: [
        {
          code: OK,
          mails: [
            mail({ mailId: 'notice' }), // 无附件 → claimed 恒 false，但不可领
            mail({ mailId: 'gift', attachments: [{ itemId: 'gold', count: 100 }] }),
            mail({ mailId: 'done', attachments: [{ itemId: 'gold', count: 1 }], claimed: true }),
          ],
        },
      ],
    });
    const vm = new MailVM(f.net, fakeTimer().timer);
    await vm.refresh();

    const byId = Object.fromEntries(vm.mails.value.map((m) => [m.id, m.claimable]));
    expect(byId['notice']).toBe(false); // ← 照 claimed 判会错在这一条
    expect(byId['gift']).toBe(true);
    expect(byId['done']).toBe(false);
  });

  it('领取回的是**实发**物品（服务端权威，可能与附件不同）', async () => {
    const f = fakeNet({
      MailListRequest: [
        { code: OK, mails: [mail({ attachments: [{ itemId: 'gold', count: 100 }] })] },
      ],
      // 背包满了 → 只发了 30。播动画得用这份，不能用 attachments 的 100。
      MailClaimRequest: [{ code: OK, items: [{ itemId: 'gold', count: 30 }] }],
    });
    const vm = new MailVM(f.net, fakeTimer().timer);
    await vm.refresh();

    const got = await vm.claim('m1');
    expect(got).toEqual([{ itemId: 'gold', count: 30 }]);
    expect(vm.mails.value[0]?.claimed).toBe(true);
    expect(vm.mails.value[0]?.claimable).toBe(false); // 按钮该灭了
  });

  it('领取失败（ALREADY_DONE 等）→ 报错并以服务端为准重拉，不在本地猜状态', async () => {
    const f = fakeNet({
      MailListRequest: [
        { code: OK, mails: [mail({ attachments: [{ itemId: 'gold', count: 100 }] })] },
        { code: OK, mails: [mail({ attachments: [{ itemId: 'gold', count: 100 }], claimed: true })] },
      ],
      MailClaimRequest: [{ code: kit.v1.ErrorCode.ERROR_CODE_ALREADY_DONE }],
    });
    const vm = new MailVM(f.net, fakeTimer().timer);
    await vm.refresh();

    expect(await vm.claim('m1')).toEqual([]);
    expect(vm.error.value).toContain('ERROR_CODE_ALREADY_DONE');
    await settle();
    expect(f.calls.filter((c) => c.type === 'MailListRequest')).toHaveLength(2); // 重拉了
    expect(vm.mails.value[0]?.claimed).toBe(true); // 状态来自服务端
  });

  it('没附件的邮件调 claim 直接不发请求（省一次必然失败的往返）', async () => {
    const f = fakeNet({ MailListRequest: [{ code: OK, mails: [mail()] }] });
    const vm = new MailVM(f.net, fakeTimer().timer);
    await vm.refresh();

    expect(await vm.claim('m1')).toEqual([]);
    expect(f.calls.filter((c) => c.type === 'MailClaimRequest')).toHaveLength(0);
  });

  it('标已读：服务端说 OK 才改本地（不做乐观更新）；已读的不再重复请求', async () => {
    const f = fakeNet({
      MailListRequest: [{ code: OK, mails: [mail()] }],
      MailReadRequest: [{ code: OK }],
    });
    const vm = new MailVM(f.net, fakeTimer().timer);
    await vm.refresh();
    expect(vm.unread.value).toBe(1);

    await vm.markRead('m1');
    expect(vm.mails.value[0]?.read).toBe(true);
    expect(vm.unread.value).toBe(0);

    await vm.markRead('m1'); // 已读 → 不再发
    expect(f.calls.filter((c) => c.type === 'MailReadRequest')).toHaveLength(1);
  });

  it('标已读失败 → 本地保持未读（红点错了比慢了难查）', async () => {
    const f = fakeNet({
      MailListRequest: [{ code: OK, mails: [mail()] }],
      MailReadRequest: [{ code: kit.v1.ErrorCode.ERROR_CODE_NOT_FOUND }],
    });
    const vm = new MailVM(f.net, fakeTimer().timer);
    await vm.refresh();

    await vm.markRead('m1');
    expect(vm.mails.value[0]?.read).toBe(false);
    expect(vm.error.value).toContain('ERROR_CODE_NOT_FOUND');
  });
});

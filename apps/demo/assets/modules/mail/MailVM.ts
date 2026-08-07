import { computed, signal, type Disposer, type INetwork, type ITimer, type ReadSignal, type Signal } from '@cck/core';
import type { kit } from '@kit/proto';
import { codeName, isOk } from '../../foundation/net/schema';

/**
 * 邮件 · 纯逻辑 ViewModel —— 零 `cc`，可 node/vitest 直跑（业务开发硬规则 1）。
 *
 * 契约是 `kit-proto` 的 `mail.proto`（cmd 100-199，**框架段**）。与 mini-clicker 不同，
 * 本模块**没有 `mail-net.ts`**：框架段由地基层的 `createKitSchema()` 一次装齐，不随本 bundle 走。
 * 随各自 bundle 热更的是接入方自己的 1000+ 号段（ADR-0012）。
 *
 * 三条来自契约、写进这里的规矩：
 *  - **推送是提醒不是传输**：`MailArrived` 是空消息，收到只表示「去拉」，数据一律从
 *    `MailListRequest` 取。所以这里没有任何从推送 body 里读东西的代码。
 *  - **去抖**：运营一次群发 3 封会推 3 条，不去抖就是 3 次全量拉取，后两次纯空跑。
 *  - **能不能领看 `attachments` 非空，不看 `claimed`**：没附件的是纯通知邮件，
 *    它的 `claimed` 恒为 false，照 `claimed` 判会给通知邮件也画一个永远点不亮的领取按钮。
 */

/** 去抖窗口（秒）。契约建议 ~200ms：够合并一次群发，又不至于让玩家觉得红点迟钝。 */
const ARRIVED_DEBOUNCE_SEC = 0.2;

/** 一次拉取的条数。服务端上限 50，超了它自己截断（不报错）。 */
const PAGE_LIMIT = 20;

/** 发货单元 —— 邮件附件与领取实发共用同一形状（契约的 `Item`）。 */
export interface MailItemReward {
  readonly itemId: string;
  readonly count: number;
}

/** 一封邮件的视图模型。字段是契约 `Mail` 的子集 + 一个派生的 `claimable`。 */
export interface MailEntry {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly attachments: readonly MailItemReward[];
  readonly createdAtMs: number;
  /** 0 = 永不过期。 */
  readonly expireAtMs: number;
  readonly read: boolean;
  readonly claimed: boolean;
  /** 该不该显示「领取」按钮 —— 有附件且还没领。 */
  readonly claimable: boolean;
}

/** VM 只用到 `INetwork` 的这两件事；测试注入一个假的即可，不必造整条连接。 */
export type MailNet = Pick<INetwork, 'request' | 'on'>;

/** 定时器同理：只要 `delay`。 */
export type MailTimer = Pick<ITimer, 'delay'>;

function toEntry(m: kit.v1.IMail): MailEntry {
  const attachments = (m.attachments ?? []).map((a) => ({
    itemId: a.itemId ?? '',
    count: a.count ?? 0,
  }));
  const claimed = m.claimed === true;
  return {
    id: m.mailId ?? '',
    title: m.title ?? '',
    body: m.body ?? '',
    attachments,
    createdAtMs: m.createdAtMs ?? 0,
    expireAtMs: m.expireAtMs ?? 0,
    read: m.read === true,
    claimed,
    claimable: attachments.length > 0 && !claimed,
  };
}

export class MailVM {
  /** 当前已拉到的邮件（服务端按时间倒序给，这里原样保序）。 */
  readonly mails: Signal<readonly MailEntry[]> = signal<readonly MailEntry[]>([]);
  /** 有请求在途。UI 拿它禁按钮，也用来挡重入。 */
  readonly loading: Signal<boolean> = signal(false);
  /** 最近一次失败的说明；成功时是空串。 */
  readonly error: Signal<string> = signal('');
  /** 还有下一页（`loadMore` 才有意义）。 */
  readonly hasMore: Signal<boolean> = signal(false);

  /** 未读数。红点要显示的就是它 —— 真相在列表里，不从推送里取（契约明说不给未读数）。 */
  readonly unread: ReadSignal<number> = computed(
    () => this.mails.value.filter((m) => !m.read).length,
  );

  /** 标题栏文案。 */
  readonly summary: ReadSignal<string> = computed(() => {
    const n = this.mails.value.length;
    const u = this.unread.value;
    if (this.loading.value && n === 0) return '邮件加载中…';
    if (n === 0) return this.error.value || '邮件（空）';
    return `邮件 ${n} 封${u > 0 ? ` · ${u} 未读` : ''}${this.hasMore.value ? ' · 还有更多' : ''}`;
  });

  private cursor = '';
  private debounce?: Disposer;

  constructor(
    private readonly net: MailNet,
    private readonly timer: MailTimer,
  ) {}

  /**
   * 订阅「你有新邮件」并立刻拉一次。返回 disposer —— 交给界面的绑定作用域，
   * 界面销毁即撤订阅，别让关掉的邮件界面还在后台拉列表。
   */
  start(): Disposer {
    const off = this.net.on('MailArrived', () => {
      // 合并：去抖窗口内再来几条只是把这一个定时器往后推，不叠加第二次拉取。
      this.debounce?.();
      this.debounce = this.timer.delay(ARRIVED_DEBOUNCE_SEC, () => {
        this.debounce = undefined;
        void this.refresh();
      });
    });
    void this.refresh();
    return () => {
      off();
      this.debounce?.();
      this.debounce = undefined;
    };
  }

  /** 从头拉一页（丢掉旧列表与游标）。 */
  refresh(): Promise<void> {
    return this.reload(false);
  }

  /** 接着上一页拉。没有下一页 / 正在拉时是 no-op。 */
  loadMore(): Promise<void> {
    if (!this.hasMore.value) return Promise.resolve();
    return this.pull(false);
  }

  /** 标已读。服务端说 OK 才改本地状态 —— 不做乐观更新，红点错了比慢了难查。 */
  async markRead(id: string): Promise<void> {
    const m = this.mails.value.find((x) => x.id === id);
    if (!m || m.read) return;
    if (await this.act('MailReadRequest', id, '标记已读')) {
      this.patch(id, (e) => ({ ...e, read: true }));
    }
  }

  /**
   * 领附件，返回**实际发放**的物品。
   *
   * 播奖励动画用返回值不用 `attachments` —— 服务端才是权威：背包满了会截断、
   * 道具下架了会换成别的。两者不一致时按 `attachments` 播就是骗玩家。
   */
  async claim(id: string): Promise<readonly MailItemReward[]> {
    const m = this.mails.value.find((x) => x.id === id);
    if (!m?.claimable) return [];
    let stale = false;
    this.loading.value = true;
    this.error.value = '';
    try {
      const res = await this.net.request('MailClaimRequest', { mailId: id }, { timeoutSec: 10 });
      const b = (res.body ?? {}) as kit.v1.IMailClaimResponse;
      if (!isOk(b.code)) {
        // ALREADY_DONE / EXPIRED / NOT_FOUND 都说明本地这份列表过期了 → 以服务端为准重拉，
        // 不在客户端猜每种码该怎么修补本地状态。
        this.error.value = `领取失败：${codeName(b.code)}`;
        stale = true;
        return [];
      }
      const items = (b.items ?? []).map((i) => ({ itemId: i.itemId ?? '', count: i.count ?? 0 }));
      this.patch(id, (e) => ({ ...e, claimed: true, claimable: false }));
      return items;
    } catch (e) {
      this.error.value = `领取失败：${String(e)}`;
      return [];
    } finally {
      this.loading.value = false;
      // 重拉只能放在**锁放开之后**：`pull` 拿 loading 挡重入，在 finally 之前调 refresh
      // 会被自己这把锁挡掉 —— 于是「领取失败就以服务端为准」静默失效，列表一直是脏的。
      // 静默重拉：`silent` 保住上面刚设的「已领过 / 已过期」提示。不然玩家点一下按钮，
      // 提示被自己触发的后台修复抹掉，什么都没看见 —— 只看到按钮悄悄灭了。
      if (stale) void this.reload(true);
    }
  }

  /** 丢掉游标从头拉。`silent` = 修复性重拉，不动 `error`（那是用户主动操作才该清的）。 */
  private reload(silent: boolean): Promise<void> {
    this.cursor = '';
    return this.pull(true, silent);
  }

  private async pull(reset: boolean, silent = false): Promise<void> {
    if (this.loading.value) return;
    this.loading.value = true;
    if (!silent) this.error.value = '';
    try {
      const res = await this.net.request(
        'MailListRequest',
        { cursor: reset ? '' : this.cursor, limit: PAGE_LIMIT },
        { timeoutSec: 10 },
      );
      const b = (res.body ?? {}) as kit.v1.IMailListResponse;
      if (!isOk(b.code)) {
        this.error.value = `拉取邮件失败：${codeName(b.code)}`;
        return;
      }
      const page = (b.mails ?? []).map(toEntry);
      this.mails.value = reset ? page : this.mails.value.concat(page);
      this.cursor = b.nextCursor ?? '';
      this.hasMore.value = b.hasMore === true;
    } catch (e) {
      this.error.value = `拉取邮件失败：${String(e)}`;
    } finally {
      this.loading.value = false;
    }
  }

  /** 标已读 / 其它「只回一个 code」的动作。返回是否成功。 */
  private async act(type: string, id: string, what: string): Promise<boolean> {
    try {
      const res = await this.net.request(type, { mailId: id }, { timeoutSec: 10 });
      const b = (res.body ?? {}) as kit.v1.IMailReadResponse;
      if (isOk(b.code)) return true;
      this.error.value = `${what}失败：${codeName(b.code)}`;
      return false;
    } catch (e) {
      this.error.value = `${what}失败：${String(e)}`;
      return false;
    }
  }

  /** 改一封邮件（signal 存的是只读数组 → 整条换新引用才会通知依赖方）。 */
  private patch(id: string, f: (e: MailEntry) => MailEntry): void {
    this.mails.value = this.mails.value.map((e) => (e.id === id ? f(e) : e));
  }
}

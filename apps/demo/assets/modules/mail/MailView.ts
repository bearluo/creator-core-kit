import { _decorator, Label, Node, instantiate } from 'cc';
import { effect, getRootContainer, getTimer, NETWORK, type Disposer } from '@cck/core';
import { bindText, BindingScope, CCKUIView } from '@cck/engine';
import type { ModuleContext } from '../../foundation/ModuleContext';
import { MailVM, type MailEntry } from './MailVM';

const { ccclass } = _decorator;

const TAG = '[CCK-MAIL]';
/** prefab 上的节点契约。改 prefab 时**别改这些名字**，否则这里静默取不到。 */
const N_TITLE = 'Title';
const N_ITEMS = 'Items';
const N_TEMPLATE = 'ItemTemplate';
const N_TOAST = 'Toast';
const N_BODY = 'Body';
const N_STATE = 'State';
const N_CLAIM = 'ClaimBtn';
const N_REFRESH = 'RefreshBtn';
const N_MORE = 'MoreBtn';
const N_CLOSE = 'CloseBtn';
/** 行距。真要做长列表就换 `ScrollView` + `Layout`，demo 这几封够用。 */
const ROW_GAP = 96;

/**
 * 邮件界面 —— **只做四件事**：取组件 / 建绑定 / 转发事件 / 转发生命周期钩子。
 * 拉取、去抖、能不能领、实发物品用哪一份，全在 {@link MailVM}（零 cc、可单测）。
 *
 * 列表是「signal 变 → 整个重建」：邮件条数是十几封量级，diff 一份行复用池的复杂度
 * 换不回什么。真到长列表那天换 `ScrollView` + 虚拟化，VM 一行不用改。
 */
@ccclass('MailView')
export class MailView extends CCKUIView {
  private vm?: MailVM;
  /** 本实例的绑定（随界面销毁重建而重来，不进 bundle 作用域）。 */
  private binds?: BindingScope;
  /** VM 的推送订阅 + 去抖定时器。 */
  private stop?: Disposer;

  onShow(args?: unknown): void {
    const ctx = args as ModuleContext;
    const net = getRootContainer().tryResolve(NETWORK);
    if (!net) {
      // 单机跑（没配 dispatcher）→ 没有连接。给一条能照着做的提示，别只留一个空列表。
      const title = this.node.getChildByName(N_TITLE)?.getComponent(Label);
      if (title) title.string = '邮件：未连接服务器';
      console.warn(`${TAG} 没有长连接（单机跑）→ 邮件不可用`);
      this.node.getChildByName(N_CLOSE)?.on(Node.EventType.TOUCH_END, ctx.close);
      return;
    }

    const vm = new MailVM(net, getTimer());
    this.vm = vm;
    this.binds = new BindingScope();

    const title = this.node.getChildByName(N_TITLE)?.getComponent(Label);
    if (title) this.binds.add(bindText(title, () => vm.summary.value));
    const toast = this.node.getChildByName(N_TOAST)?.getComponent(Label);
    if (toast) this.binds.add(bindText(toast, () => vm.error.value));

    const items = this.node.getChildByName(N_ITEMS);
    const template = this.node.getChildByName(N_TEMPLATE);
    if (items && template) {
      template.active = false; // 模板本体不显示，只用来克隆
      this.binds.add(effect(() => this.rebuild(items, template, vm.mails.value, toast)));
    } else {
      console.error(`${TAG} Mail.prefab 里缺 '${N_ITEMS}' 或 '${N_TEMPLATE}' 节点 → 列表空白`);
    }

    this.node.getChildByName(N_REFRESH)?.on(Node.EventType.TOUCH_END, () => void vm.refresh());
    this.node.getChildByName(N_MORE)?.on(Node.EventType.TOUCH_END, () => void vm.loadMore());
    this.node.getChildByName(N_CLOSE)?.on(Node.EventType.TOUCH_END, ctx.close);

    this.stop = vm.start(); // 订阅 MailArrived + 首次拉取
    console.log(`${TAG} MailView.onShow：MailVM 已启动（订阅 MailArrived + 拉列表）`);
  }

  onHide(): void {
    this.stop?.();
    this.stop = undefined;
    this.binds?.dispose();
    this.binds = undefined;
    this.vm = undefined;
    console.log(`${TAG} MailView.onHide：撤订阅与绑定`);
  }

  /** 列表整体重建。`effect` 读了 `mails.value` → 列表一变自动重跑。 */
  private rebuild(
    items: Node,
    template: Node,
    mails: readonly MailEntry[],
    toast: Label | null | undefined,
  ): void {
    items.removeAllChildren();
    mails.forEach((m, i) => {
      const row = instantiate(template);
      row.active = true;
      items.addChild(row);
      row.setPosition(0, -i * ROW_GAP, 0);

      const t = row.getChildByName(N_TITLE)?.getComponent(Label);
      if (t) t.string = `${m.read ? '' : '● '}${m.title}`;
      const b = row.getChildByName(N_BODY)?.getComponent(Label);
      if (b) b.string = m.body;
      const s = row.getChildByName(N_STATE)?.getComponent(Label);
      if (s) s.string = rowState(m);

      // 点标题 = 标已读；有附件才有领取按钮（判据是 attachments 非空，见 VM 注释）。
      row.on(Node.EventType.TOUCH_END, () => void this.vm?.markRead(m.id));
      const claim = row.getChildByName(N_CLAIM);
      if (claim) {
        claim.active = m.claimable;
        claim.on(Node.EventType.TOUCH_END, async (e: { propagationStopped?: boolean }) => {
          if (e) e.propagationStopped = true; // 别顺手把整行的「标已读」也触发了
          const got = await this.vm?.claim(m.id);
          if (toast && got?.length) {
            toast.string = `领取到：${got.map((g) => `${g.itemId} x${g.count}`).join('、')}`;
          }
        });
      }
    });
  }
}

/** 一行右侧的状态文案。纯展示，放这里而不是 VM —— 换皮 / 换语言只动 View。 */
function rowState(m: MailEntry): string {
  if (m.attachments.length === 0) return m.read ? '已读' : '未读';
  return m.claimed ? '已领取' : '可领取';
}

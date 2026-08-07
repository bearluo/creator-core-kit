import { signal, type Signal } from '@cck/core';
import {
  customAccount,
  CREDENTIAL_SEP,
  PASSWORD_MIN,
  type LoginAccount,
  type LoginResult,
} from '../net/auth';

/**
 * 登录 · 纯逻辑 ViewModel —— 零 `cc`，可 node/vitest 直跑（业务开发硬规则 1）。
 *
 * 两条路：**游客**（本机设备号，一键）与**自有账号**（`账号:密码`，首次登录服务端自动建号）。
 * 界面只负责把输入框里的两个字符串递进来、把 `error` / `status` 画出去。
 *
 * 为什么这里也打一次 HTTP 登录，而不是把账号直接交给闸门去登：**密码错要当场说**。
 * 交出去再登，错误就变成一次启动失败（LaunchOverlay 上一句「网络异常」），玩家不知道
 * 是自己打错了字。多的那次往返只在登录这一下，换来的是错误落在该落的地方。
 */

/** VM 要的四件事，全部注入 —— 测试不碰 HTTP、不碰存储、不碰 UIManager。 */
export interface LoginDeps {
  /** 打一次 `POST /api/Login` 验凭据。 */
  login(account: LoginAccount): Promise<LoginResult>;
  /** 本机游客账号（设备号，落存储持久化）。 */
  device(): Promise<LoginAccount>;
  /** 上次用过的账号名，用来预填。 */
  lastName(): Promise<string>;
  /** 验过了 —— 把账号交回启动闸门（界面随即被关掉）。 */
  done(account: LoginAccount): void;
}

export class LoginVM {
  /** 登录中：按钮转圈、拦住重复点。 */
  readonly busy: Signal<boolean> = signal(false);
  /** 给玩家看的失败原因（密码错 / 网络不通 / 输入不合法）。 */
  readonly error: Signal<string> = signal('');
  /** 成功后的一句反馈（新建账号还是老玩家回来），界面关掉前一闪而过。 */
  readonly status: Signal<string> = signal('');

  constructor(private readonly deps: LoginDeps) {}

  /** 界面打开时调：拿上次的账号名预填输入框。 */
  lastName(): Promise<string> {
    return this.deps.lastName();
  }

  /** 游客登录。 */
  guest(): Promise<void> {
    return this.run(() => this.deps.device());
  }

  /**
   * 自有账号登录。三条先在本地拦掉，省一次白跑的往返：
   * 账号非空、密码够长、**账号里不能有冒号**（服务端按第一个冒号切 `账号:密码`，
   * 账号带冒号会把后半截当成密码，表现成「明明打对了却说密码不对」）。
   */
  submit(name: string, password: string): Promise<void> {
    const n = name.trim();
    if (!n) return this.reject('请输入账号');
    if (n.includes(CREDENTIAL_SEP)) return this.reject(`账号里不能有 “${CREDENTIAL_SEP}”`);
    if (password.length < PASSWORD_MIN) return this.reject(`密码至少 ${PASSWORD_MIN} 位`);
    return this.run(() => Promise.resolve(customAccount(n, password)));
  }

  private reject(msg: string): Promise<void> {
    this.error.value = msg;
    return Promise.resolve();
  }

  private async run(make: () => Promise<LoginAccount>): Promise<void> {
    if (this.busy.value) return; // 连点两下 = 两次登录，服务端会把第一条当顶号
    this.busy.value = true;
    this.error.value = '';
    this.status.value = '';
    try {
      const account = await make();
      const r = await this.deps.login(account);
      this.status.value = r.isNewPlayer ? `新账号已创建：${r.playerId}` : `欢迎回来：${r.playerId}`;
      this.deps.done(account);
    } catch (e) {
      this.error.value = String((e as Error)?.message ?? e);
    } finally {
      this.busy.value = false;
    }
  }
}

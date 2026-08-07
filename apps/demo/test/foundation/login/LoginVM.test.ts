import { describe, expect, it, vi } from 'vitest';
import { LoginVM, type LoginDeps } from '../../../assets/foundation/login/LoginVM';
import type { LoginAccount, LoginResult } from '../../../assets/foundation/net/auth';

/**
 * 登录界面的逻辑。守两件事：**不合法的输入不该打出去**（省一次白跑的往返，也别让
 * 「账号带冒号」表现成「密码不对」），以及**验过了才交账号**（失败不能放行进游戏）。
 */

const OK: LoginResult = { token: 'tok', playerId: 'p-1', isNewPlayer: false };

function harness(over: Partial<LoginDeps> = {}) {
  const done = vi.fn<(a: LoginAccount) => void>();
  // 注意顺序：spy 要包在 override **外面**，否则用例传进来的 login 会把 spy 顶掉，
  // `toHaveBeenCalled` 就永远是 0（踩过一次）。
  const login = vi.fn<(a: LoginAccount) => Promise<LoginResult>>(over.login ?? (() => Promise.resolve(OK)));
  const deps: LoginDeps = {
    device: () => Promise.resolve({ provider: 'device', credential: 'dev-1' }),
    lastName: () => Promise.resolve(''),
    ...over,
    login,
    done,
  };
  return { vm: new LoginVM(deps), login, done };
}

describe('LoginVM · 自有账号', () => {
  it('账号 + 密码拼成 `账号:密码`，验过了才把账号交出去', async () => {
    const h = harness();
    await h.vm.submit('tester-a', 'pw123456');
    expect(h.login).toHaveBeenCalledWith({ provider: 'custom', credential: 'tester-a:pw123456' });
    expect(h.done).toHaveBeenCalledWith({ provider: 'custom', credential: 'tester-a:pw123456' });
    expect(h.vm.error.value).toBe('');
  });

  it('账号首尾空格去掉 —— 手机键盘很容易多敲一个', async () => {
    const h = harness();
    await h.vm.submit('  tester-a  ', 'pw123456');
    expect(h.login.mock.calls[0]?.[0].credential).toBe('tester-a:pw123456');
  });

  it('空账号：给提示，不打 HTTP', async () => {
    const h = harness();
    await h.vm.submit('   ', 'pw123456');
    expect(h.login).not.toHaveBeenCalled();
    expect(h.vm.error.value).toBe('请输入账号');
  });

  it('密码不够长：本地就拦掉（服务端下限 6 位）', async () => {
    const h = harness();
    await h.vm.submit('tester-a', 'pw12');
    expect(h.login).not.toHaveBeenCalled();
    expect(h.vm.error.value).toContain('6');
  });

  it('账号里带冒号：拦掉 —— 否则服务端按第一个冒号切，表现成「密码不对」', async () => {
    const h = harness();
    await h.vm.submit('a:b', 'pw123456');
    expect(h.login).not.toHaveBeenCalled();
    expect(h.vm.error.value).toContain('不能有');
  });

  it('密码错：错误落在登录界面上，账号不交出去', async () => {
    const h = harness({ login: () => Promise.reject(new Error('账号或密码不对')) });
    await h.vm.submit('tester-a', 'wrongpw1');
    expect(h.vm.error.value).toBe('账号或密码不对');
    expect(h.done).not.toHaveBeenCalled();
    expect(h.vm.busy.value).toBe(false); // 失败也要放开按钮，不然只能重启
  });

  it('新建账号与老玩家回来给不同的反馈', async () => {
    const h = harness({ login: () => Promise.resolve({ ...OK, isNewPlayer: true, playerId: 'p-9' }) });
    await h.vm.submit('tester-new', 'pw123456');
    expect(h.vm.status.value).toContain('p-9');
    expect(h.vm.status.value).toContain('新账号');
  });
});

describe('LoginVM · 游客', () => {
  it('一键登录：用本机设备号', async () => {
    const h = harness();
    await h.vm.guest();
    expect(h.login).toHaveBeenCalledWith({ provider: 'device', credential: 'dev-1' });
    expect(h.done).toHaveBeenCalledWith({ provider: 'device', credential: 'dev-1' });
  });
});

describe('LoginVM · 防重入与预填', () => {
  it('登录中再点只算一次 —— 认两次会让服务端把第一条连接当顶号踢掉', async () => {
    let release: (r: LoginResult) => void = () => {};
    const h = harness({ login: () => new Promise<LoginResult>((res) => (release = res)) });
    const first = h.vm.guest();
    await Promise.resolve(); // 让第一次走到 login（取设备号是个 promise）
    await Promise.resolve();
    await h.vm.guest(); // 连点第二下
    expect(h.login).toHaveBeenCalledTimes(1);
    release(OK);
    await first;
    expect(h.done).toHaveBeenCalledTimes(1);
  });

  it('预填上次用过的账号名', async () => {
    const h = harness({ lastName: () => Promise.resolve('tester-a') });
    expect(await h.vm.lastName()).toBe('tester-a');
  });
});

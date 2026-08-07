import { _decorator, EditBox, Label, Node } from 'cc';
import { bindText, BindingScope, CCKUIView } from '@cck/engine';
import { ACCOUNT_LOGIN_URL } from '../server';
import { deviceAccount, lastLoginName, login, type LoginArgs } from '../net/auth';
import { LoginVM } from './LoginVM';

const { ccclass } = _decorator;

const TAG = '[CCK-LOGIN]';
/** prefab 上的节点契约。改 prefab 时**别改这些名字**，否则这里静默取不到。 */
const N_NAME = 'Name';
const N_PASSWORD = 'Password';
const N_LOGIN = 'LoginBtn';
const N_GUEST = 'GuestBtn';
const N_ERROR = 'Error';
const N_STATUS = 'Status';

/**
 * 登录界面 —— **只做四件事**：取组件 / 建绑定 / 转发事件 / 转发生命周期钩子。
 * 校验、拼 credential、错误文案全在 {@link LoginVM}（零 cc、可单测）。
 *
 * 由 `net/auth.ts` 的 `pickAccount()` 在**启动路径上**打开（`system` 层，盖住启动界面），
 * 玩家选完账号才继续认证。所以它没有关闭按钮：这是闸门不是弹窗。
 *
 * **马甲换皮**：本类挂在**哪一份** `Login.prefab` 上由皮肤决定（`catalog.ts` 的 `skinned()`），
 * 一套逻辑配任意一张脸。给哪几种登录方式也由 prefab 说了算 —— **节点在就接线，不在就没有这条路**
 *（审核期只放一个 `GuestBtn` 的马甲，代码这边一个字都不用改）。
 */
@ccclass('LoginView')
export class LoginView extends CCKUIView {
  private binds?: BindingScope;

  onShow(args?: unknown): void {
    const done = (args as LoginArgs | undefined)?.done;
    if (!done) {
      // 只可能是被别处 `open('login')` 了。没有 done 就没人接账号，登了也没用。
      console.error(`${TAG} 缺 LoginArgs.done —— 本界面只能由 pickAccount() 打开`);
      return;
    }
    const vm = new LoginVM({
      login: (account) => login(ACCOUNT_LOGIN_URL, account),
      device: () => deviceAccount(),
      lastName: () => lastLoginName(),
      done,
    });
    this.binds = new BindingScope();

    const error = this.node.getChildByName(N_ERROR)?.getComponent(Label);
    if (error) this.binds.add(bindText(error, () => vm.error.value));
    const status = this.node.getChildByName(N_STATUS)?.getComponent(Label);
    if (status) {
      this.binds.add(bindText(status, () => (vm.busy.value ? '登录中…' : vm.status.value)));
    }

    // 这份皮给了哪几种登录方式，看它放了哪些节点 —— 不放就是不给，没有开关也没有分支。
    const nameBox = this.node.getChildByName(N_NAME)?.getComponent(EditBox);
    const pwBox = this.node.getChildByName(N_PASSWORD)?.getComponent(EditBox);
    const loginBtn = this.node.getChildByName(N_LOGIN);
    const guestBtn = this.node.getChildByName(N_GUEST);
    const ways: string[] = [];

    if (loginBtn && nameBox && pwBox) {
      loginBtn.on(Node.EventType.TOUCH_END, () => void vm.submit(nameBox.string, pwBox.string));
      void vm.lastName().then((n) => {
        if (n) nameBox.string = n;
      });
      ways.push('自有账号');
    } else if (loginBtn) {
      // 半套：有登录按钮却没输入框 —— 接了也只能提交空串，不如响亮地说清缺了什么。
      console.error(`${TAG} 有 '${N_LOGIN}' 却缺 '${N_NAME}'/'${N_PASSWORD}' → 该按钮不接线`);
    }

    if (guestBtn) {
      guestBtn.on(Node.EventType.TOUCH_END, () => void vm.guest());
      ways.push('游客');
    }

    if (ways.length === 0) {
      // 一条路都没有 = 闸门永远不放行，启动就停在这张脸上。这是皮做错了，必须喊出来。
      console.error(`${TAG} 这份皮一条登录路都没有（既无 '${N_GUEST}'，也无输入框 + '${N_LOGIN}'）→ 启动会卡在登录页`);
    }
    console.log(`${TAG} LoginView.onShow：等玩家选账号（${ways.join(' / ') || '无可用方式'}）`);
  }

  onHide(): void {
    this.binds?.dispose();
    this.binds = undefined;
  }
}

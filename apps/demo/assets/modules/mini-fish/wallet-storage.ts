/**
 * 接缝 ② 的**单机实现** —— 落盘的钱包。
 *
 * 钱**属于账户不属于这一款**（决策 B）：打鱼赚的钱将来要能在商城花，所以 key 走
 * `scopedKey`（带 `appId` 前缀，两个马甲共用同一个 localStorage 时不串）。实现先住本模块 ——
 * 现在只有一个用户，搬进地基是等第二个用户出现时的事，不是提前付的钱。
 *
 * 联网之后这一份整个换掉：余额由服务端说了算，客户端只是显示。所以 `FishVM` 只认
 * {@link FishWallet} 那三个方法，从头到尾不知道钱存在哪。
 *
 * ⚠️ **同步读不到**：`IStorage` 是异步的，而第一帧就要把「金币 10000」画出来。
 * 所以由 View 在 `start()` 里 `await` 一次读进来，再拿它造 VM —— 跟 `GameHost` 的成绩表
 * 一个路数（那边是地基 boot 读，这边是场景启动读，因为只有这一款用）。
 */
import { getRootContainer, STORAGE, type IStorage } from '@cck/core';
import { scopedKey } from '../../foundation/net/auth';
import { memoryWallet, type FishWallet } from './economy';

/** 余额存这个键。前缀由 {@link scopedKey} 加。 */
export const COINS_KEY = 'cck.fishCoins';

/**
 * 纯实现：给一份**已经读出来的**存档 + 一个写回函数，造钱包。
 *
 * 存档是玩家能翻到的地方，**坏了就当没有**（回到 `initial`）—— 不能让一行脏数据把游戏卡死，
 * 同 `GameHost.readBest`。负数同理：那只可能是被人手改过。
 */
export function persistentWallet(
  initial: number,
  saved: string | null | undefined,
  save: (balance: number) => void,
): FishWallet {
  // ⚠️ **空串必须先挡掉**：`Number('')` 是 0，会把「没存档」读成「余额 0」——
  //    玩家一进游戏钱就没了，而且这条错误只在存储写了个空值时出现，肉眼极难发现。
  const n = saved !== null && saved !== undefined && saved.trim() !== '' ? Number(saved) : NaN;
  const start = Number.isFinite(n) && n >= 0 ? n : initial;
  const inner = memoryWallet(start);
  // ponytail: 每发子弹写一次盘（一秒最多几次，localStorage 扛得住）。
  //           真嫌吵再改成攒着 + onDestroy 冲刷，代价是崩溃会丢掉最后几秒的战果。
  return {
    balance: inner.balance,
    spend: (amount) => {
      const ok = inner.spend(amount);
      if (ok) save(inner.balance());
      return ok;
    },
    earn: (amount) => {
      inner.earn(amount);
      save(inner.balance());
    },
  };
}

/** 运行期那一份：从 DI 取 `IStorage`，读一次余额。没装存储就退化成内存钱包。 */
export async function accountWallet(initial: number): Promise<FishWallet> {
  const storage: IStorage | undefined = getRootContainer().tryResolve(STORAGE);
  const key = scopedKey(COINS_KEY);
  const saved = await storage?.get(key);
  return persistentWallet(initial, saved, (balance) => void storage?.set(key, String(balance)));
}

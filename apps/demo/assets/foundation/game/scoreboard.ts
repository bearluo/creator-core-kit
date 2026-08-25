/**
 * 子游戏 VM 眼里的「成绩」——**只有这两件事**。
 *
 * 单独一个零依赖小文件（同 `foundation/events.ts` 的用意）：游戏的 VM 是零 `cc`、node 直跑的，
 * 它 import 的东西也得干净。VM 只认本接口，于是单测里塞一份 {@link memoryScoreboard} 就能跑，
 * 不必有 DI 容器、不必有 `IStorage`、不必登录。
 *
 * 运行期那份由 `game/host.ts` 的 `scoreboardFor(gameId)` 从 GameHost 现取（落盘、按马甲隔离）。
 */
export interface GameScoreboard {
  /** 历史最好成绩；没打过是 0。 */
  best(): number;
  /** 交一局成绩。**破了纪录才算数**，返回值就是「破没破」——游戏据此弹「新纪录」。 */
  submit(score: number): boolean;
}

/**
 * 内存记分板 —— VM 的缺省值，也是单测里的那一份。
 *
 * 不落盘：实例一没就清零。所以它**不是**「忘了接 GameHost 也能用」的兜底，而是
 * 「这个 VM 现在没接任何外部世界」的诚实表示。
 */
export function memoryScoreboard(initial = 0): GameScoreboard {
  let best = Math.floor(initial);
  return {
    best: () => best,
    submit: (score) => {
      const value = Math.floor(score);
      if (value <= best) return false;
      best = value;
      return true;
    },
  };
}

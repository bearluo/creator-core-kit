import {
  createToken,
  getEventBus,
  getRootContainer,
  STORAGE,
  type IStorage,
  type Token,
} from '@cck/core';
import { LOBBY_EVENTS, type LobbyEventMap } from '../events';
import { AUTH_SESSION, lastLoginName, scopedKey } from '../net/auth';
import type { GameScoreboard } from './scoreboard';

/**
 * 子游戏 ↔ 大厅的**唯一接缝**（`kind:'game'` 那一类模块用）。
 *
 * ## 为什么要有它
 *
 * panel 类模块开的时候由 host 递一份 {@link ModuleContext} 进来，要什么有什么；而 game 类
 * 是 `loadScene` 切过去的 —— **没有任何东西被递进去**，场景里的组件是引擎 new 出来的。
 * 于是在这之前，子游戏想跟外面说句话只有一条路：自己 `getEventBus().emit('lobby:back')`。
 * 每个游戏各写一遍，而且除了「我要出去」以外什么都做不到。
 *
 * 本对象把那条路收成一份**契约**：游戏 `import { getGameHost }` 就能拿到玩家是谁、
 * 自己的历史最好成绩是多少、怎么交分、怎么回大厅。反过来大厅只读 {@link GameHost.best}，
 * 不认识任何一个游戏。
 *
 * ## 为什么住在地基而不是大厅
 *
 * 拓扑规则是「跨包 `import` 只许指向优先级更高的包」：模块（1）→ 地基（6）合法，
 * 模块 → 大厅（3）也合法但**反了向** —— 大厅是**大厅的**实现，子游戏不该依赖它，
 * 否则换一个大厅（或者根本不进大厅、直接深链进某个游戏）就全断。
 * 放地基 = 谁都能用，且随地基热更。
 *
 * ## 成绩为什么是同步的
 *
 * `IStorage` 是异步的，而游戏第一帧就要把「最好 12」画出来。所以启动时**一次性**读进内存
 * （地基 boot 的最后一步，见 {@link installGameHost}），此后 {@link GameHost.best} 同步返回、
 * {@link GameHost.submit} 同步更新内存并把整张表异步写回去。丢一次写盘最多丢掉这一局的纪录，
 * 换来的是游戏侧一个 `await` 都不用写。
 */
export interface GameHost {
  /** 谁在玩 —— 游戏要显示玩家名时用这个，别自己去翻登录态。 */
  readonly player: GamePlayer;
  /** 退出到大厅。等价于以前每个游戏各写一遍的 `emit('lobby:back')`。 */
  exit(): void;
  /** 这个游戏的历史最好成绩；没打过是 0。同步（见类注释）。 */
  best(gameId: string): number;
  /** 交一局成绩。**破了纪录才落盘**，返回值就是「破没破」——游戏据此弹「新纪录！」。 */
  submit(gameId: string, score: number): boolean;
}

/** 玩家身份的**只读快照**，取自登录态。游戏不该拿到 token / 连接之类的东西。 */
export interface GamePlayer {
  /** 服务端玩家 id；单机跑（没配 dispatcher）时是空串。 */
  readonly id: string;
  /** 显示名。自有账号是账号名，游客就是「游客」。 */
  readonly name: string;
}

/** DI token：当前 kit 的 GameHost。游戏侧用 {@link getGameHost}，别自己 resolve。 */
export const GAME_HOST: Token<GameHost> = createToken<GameHost>('demo.gameHost');

/** 全部游戏的最好成绩存这一个键（一张 `{[gameId]: score}` 表）。键带 appId 前缀，马甲之间不串。 */
const BEST_KEY = 'cck.gameBest';

/**
 * 游戏侧取 host。地基没起来（比如在编辑器里直接播放某个游戏场景）时抛 —— 给一条能照着做的
 * 错误，别让人对着一个不动的画面猜。
 */
export function getGameHost(): GameHost {
  const host = getRootContainer().tryResolve(GAME_HOST);
  if (!host) {
    throw new Error('[CCK-GAME] GameHost 未安装：本场景要求先经 Boot.scene 启动（编辑器里请打开 Boot.scene 再播放）');
  }
  return host;
}

/**
 * 把 host 收成「只跟一个游戏有关」的那两件事，喂给游戏的 VM。
 *
 * VM 零 `cc`、node 直跑，所以它不该认识 GameHost（那条链一路挂到 DI 容器和 IStorage）。
 * 接缝就是 {@link GameScoreboard}：运行期给这一份，单测给 `memoryScoreboard()`。
 */
export function scoreboardFor(gameId: string, host?: GameHost): GameScoreboard {
  const h = host ?? getGameHost();
  return {
    best: () => h.best(gameId),
    submit: (score) => h.submit(gameId, score),
  };
}

/** {@link createGameHost} 的注入口 —— 全是纯函数/纯数据，于是本模块 node 直跑可测。 */
export interface GameHostDeps {
  readonly player: GamePlayer;
  /** 启动时读进来的成绩表（会被 `submit` 就地更新）。 */
  readonly best: Record<string, number>;
  /** 破纪录时把整张表写回去。失败不管 —— 见类注释。 */
  persist(all: Record<string, number>): void;
  /** 退出到大厅。 */
  exit(): void;
}

/** 纯实现。运行期的那一份由 {@link installGameHost} 装配。 */
export function createGameHost(deps: GameHostDeps): GameHost {
  return {
    player: deps.player,
    exit: deps.exit,
    best: (gameId) => deps.best[gameId] ?? 0,
    submit: (gameId, score) => {
      // 只认整数分：游戏那边可能是累计的浮点（时间、距离），落盘前定死一次，
      // 否则「最好 12.000000001」这种东西会被显示出来。
      const value = Math.floor(score);
      if (value <= (deps.best[gameId] ?? 0)) return false;
      deps.best[gameId] = value;
      deps.persist(deps.best);
      return true;
    },
  };
}

/**
 * 地基 boot 的最后一步：读成绩表 + 取玩家身份 → 装进 DI 根容器。
 *
 * 排在认证之后 —— `playerId` 要认证完才有。`allowOverride` 是给编辑器预览的
 * stop→play 用的：JS 上下文不重建，第二轮要能覆盖掉上一轮那份。
 */
export async function installGameHost(): Promise<GameHost> {
  const root = getRootContainer();
  const storage = root.tryResolve(STORAGE);
  const host = createGameHost({
    player: {
      id: root.tryResolve(AUTH_SESSION)?.playerId ?? '',
      name: (await lastLoginName(storage)) || '游客',
    },
    best: await readBest(storage),
    persist: (all) => void storage?.set(scopedKey(BEST_KEY), JSON.stringify(all)),
    exit: () => getEventBus<LobbyEventMap>().emit(LOBBY_EVENTS.back),
  });
  root.register(GAME_HOST, { useValue: host }, { allowOverride: true });
  return host;
}

/** 读成绩表。存档是玩家能翻到的地方，坏了就当没有 —— 不能让一行脏 JSON 把启动卡死。 */
async function readBest(storage?: IStorage): Promise<Record<string, number>> {
  const raw = await storage?.get(scopedKey(BEST_KEY));
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.floor(v);
    }
    return out;
  } catch {
    console.warn('[CCK-GAME] 最好成绩存档解析失败 → 当作全新开始');
    return {};
  }
}

import { DEVICE_PROFILE, type DeviceProfile } from '../device';
import { createToken, getRootContainer, type Token } from '../di';
import { getLogger, type ILogger } from '../logging';
import { getSaveManager, type SaveManager } from '../save';
import { setUIVariant } from '../ui';
import type { KitModule } from '../bootstrap';

/**
 * DeviceTier —— 档位持有者。**启动期一次性确定，会话内不可变。**
 *
 * 设计见 `docs/design/device-tiering-overview.md` §3。三条要点：
 *
 * 1. **没有 `setTier()`，这是不变式而不是约定。** 资源档一次会话内定死、运行中不换包
 *    （低清包大概率不在本地 → 降档第一次 open 变成一次下载；重建会先冲高峰值；弱网下
 *    根本降不下去）。把它做成 API 形状上的缺席，「运行中切档」在类型层面就写不出来。
 *    ⚠️ 唯一的门是既有的通用 `setUIVariant({ tier })` —— kit 不提供不背书也不拦，项目自担。
 * 2. **kit 只管编排，取值归项目。** `scoreTier`（本地打分）与 `fetchTier`（服务器结论）
 *    都由项目注入，**kit 一行经验值都不送** —— 打分权重与门槛值是策略，而且跨平台的默认
 *    打分函数必然要把三个语义不同的内存字段挑一个用，那正是 `DeviceProfile` 拆分要禁掉的事。
 * 3. **不阻塞启动**：缓存优先 + 短超时的机会主义等待、**不重试**。一次解决三个问题 ——
 *    超时不用纠结、接口失败不用特殊处理、「服务器明说没有」与「网络挂了」在启动路径上
 *    行为相同（差别只进埋点的 {@link DeviceTier.serverOutcome}）。
 */

/** 服务器（或本地）给出的档位结论。 */
export interface TierVerdict {
  /** 档位标签。**不透明 string**，kit 不知道有哪几档。 */
  readonly tier: string;
  /** 来源标记，开放 string。埋点读它。 */
  readonly source: string;
}

/** 本地兜底打分。**由项目实现**，kit 不出默认。 */
export type ScoreTier = (profile: DeviceProfile) => string;

/**
 * 服务器权威档位。**由项目实现** —— 端点、协议、字段名 kit 一概不认识
 * （判据：`dispatcher` 的响应能进 kit 是因为它跨框架，档位的不跨，它里面还带资源清单）。
 *
 * `'none'` = 服务器明说没有结论；reject = 网络挂了 / 接口失败。
 * 两者在启动路径上行为相同，差别只进埋点。
 */
export type FetchTier = (profile: DeviceProfile) => Promise<TierVerdict | 'none'>;

/** 服务器这一趟的结局。只喂埋点 —— 一个是覆盖率问题，一个是可用性问题。 */
export type ServerOutcome = 'ok' | 'none' | 'timeout' | 'error' | 'skipped';

export const TIER_DEFAULT = 'default';

/** {@link DeviceTier.source} 的几个 kit 自己会产出的值。项目的 `fetchTier` 可以给别的。 */
export const TIER_SOURCE = {
  /** 玩家在画质设置里自己选的（下次启动生效）。 */
  player: 'player',
  /** 上次生效的档位缓存。 */
  cache: 'cache',
  /** 本地打分。 */
  local: 'local',
  /** 什么都没有 —— 没注册模块 / 没传任何取值函数。 */
  default: TIER_DEFAULT,
} as const;

export interface DeviceTier {
  /** 本次会话的档位。{@link resolveAtStartup} 跑完之前是 `'default'`。**会话内不变。** */
  readonly tier: string;
  /** 档位来源。埋点读它。 */
  readonly source: string;
  /** 服务器那一趟的结局，只喂埋点。判档没跑过是 `'skipped'`。 */
  readonly serverOutcome: ServerOutcome;
  /**
   * 判档。由启动序列的 `tier` 步调用一次；**并发 / 重复调用返回同一个 promise**，会话内只判一次。
   *
   * 顺序：玩家自选 → 缓存 → 本地打分（先拿一个能立刻用的）→ 同时发 `fetchTier` 与短超时赛跑
   * → 赶上了用服务器的、没赶上就走 → **无论如何把结果写缓存给下次用** → 不重试。
   */
  resolveAtStartup(): Promise<void>;
  /**
   * 记下玩家在画质设置里选的档位（`undefined` = 清除，回到自动判定）。
   *
   * **下次启动生效** —— 它不动本次会话的 {@link tier}，那是本模块的不变式。
   * 项目在设置界面里改完画质，要提示用户「下次启动生效」。
   */
  setPreferred(tier: string | undefined): Promise<void>;
}

export interface DeviceTierOptions {
  /** 设备画像。默认取 DI 的 `DEVICE_PROFILE`（由 engine 的 `deviceProfileModule` 注册）。 */
  readonly profile?: DeviceProfile;
  readonly scoreTier?: ScoreTier;
  readonly fetchTier?: FetchTier;
  /** 等服务器的预算（ms），默认 1500。超时就走，**不重试**。 */
  readonly budgetMs?: number;
  /** 档位缓存落在哪。默认 `getSaveManager()`。 */
  readonly save?: SaveManager;
  readonly logger?: ILogger;
}

export const DEVICE_TIER: Token<DeviceTier> = createToken<DeviceTier>('cck.deviceTier');

/**
 * ⚠️ slot 名只能用 `[A-Za-z0-9_-]` —— `SaveManager` 会把别的字符**静默剔掉**
 * （`save-manager.ts` 的 `SLOT_RE`），写 `cck.tier` 会变成 `ccktier`。
 *
 * 两个 key 语义不同、优先级也不同，**不能合并**：一个是「机器该是哪档」，一个是「玩家想要哪档」。
 */
const SLOT_RESOLVED = 'cck_tier';
const SLOT_PREFERRED = 'cck_tier_preferred';

const DEFAULT_BUDGET_MS = 1500;

/** 从存档里取出一个非空的 `tier` 字段；形状不对就当没有。 */
function readTier(data: Record<string, unknown> | null): string | undefined {
  const t = data?.['tier'];
  return typeof t === 'string' && t !== '' ? t : undefined;
}

/**
 * `createDeviceTier` 的返回值。比 {@link DeviceTier} 多一个 `dispose` ——
 * 给 `KitModule.stop` 用，**不是公开 API**：容器里注册的 token 类型是 `DeviceTier`，
 * 拿不到它，所以业务代码没法把在途的判档掐掉。
 */
export interface DeviceTierHandle extends DeviceTier {
  /** 让在途的 `await` 回来后安静收摊（不改状态、不写缓存）。 */
  dispose(): void;
}

export function createDeviceTier(opts: DeviceTierOptions = {}): DeviceTierHandle {
  const logger = opts.logger ?? getLogger('DeviceTier');
  const save = (): SaveManager => opts.save ?? getSaveManager();
  const budgetMs = opts.budgetMs ?? DEFAULT_BUDGET_MS;

  let tier = TIER_DEFAULT;
  let source: string = TIER_SOURCE.default;
  let serverOutcome: ServerOutcome = 'skipped';
  let inflight: Promise<void> | undefined;
  let disposed = false;

  const profile = (): DeviceProfile =>
    opts.profile ?? getRootContainer().tryResolve(DEVICE_PROFILE) ?? { readFailures: [] };

  const persist = async (v: TierVerdict): Promise<void> => {
    await save().save(SLOT_RESOLVED, { tier: v.tier, source: v.source });
  };

  /**
   * 跟预算赛跑。**用真实时钟（`setTimeout`），不能用 `ITimer`** —— 后者被 `timeScale` 缩过、
   * 且 `paused` 时根本不触发，而判档就发生在启动那段最容易被暂停的时间里。
   */
  const race = async (
    p: Promise<TierVerdict | 'none'>,
  ): Promise<TierVerdict | 'none' | 'timeout' | 'error'> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), budgetMs);
    });
    try {
      const r = await Promise.race([p.catch((): 'error' => 'error'), timeout]);
      return r === 'none' ? 'none' : r;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };

  async function run(): Promise<void> {
    await decide();
    if (disposed) return;
    // 判出来的档位灌进 UI 变体。**必须在这一刻做完** —— 紧接着的 `shared` 启动步就要按档
    // 装常驻地基皮包，晚一步那些包就按 `'default'` 装好了，而且是静默的。
    //
    // 先例是 `resolutionModule` 灌 `orientation`（`packages/engine/src/resolution.ts`）：
    // **谁拥有一个变体维度，谁负责把它推进去**，不能指望每个接入方记得接这根线。
    //
    // 这里 `await`（那边是 `void`）：启动到这一刻一个界面都还没开，所以零重建，
    // await 纯粹为了保证「档位就位」早于「按档装包」。
    await setUIVariant({ tier });
  }

  async function decide(): Promise<void> {
    // ① 玩家自选最高优先级 —— 选了就不必再问服务器，启动还快一步。
    const preferred = readTier(await save().load(SLOT_PREFERRED));
    if (disposed) return; // await 回来先确认自己还在（启动可能已被强更 / 停服中止）
    if (preferred !== undefined) {
      tier = preferred;
      source = TIER_SOURCE.player;
      return;
    }

    // ② 先拿一个**能立刻用的**：缓存 > 本地打分 > default。
    const cached = readTier(await save().load(SLOT_RESOLVED));
    if (disposed) return;
    let fallback: TierVerdict;
    if (cached !== undefined) {
      fallback = { tier: cached, source: TIER_SOURCE.cache };
    } else {
      // `scoreTier` 是**项目代码**，而且是同步调的 —— 它抛出来会一路掀翻整条启动序列。
      // 分档是可选功能，不该有这个能力：打不出分就落 default，吵一声就行。
      let scored: string | undefined;
      try {
        scored = opts.scoreTier?.(profile());
      } catch (e) {
        logger.warn(`scoreTier 抛了，本次落默认档：${(e as Error)?.message ?? String(e)}`);
      }
      fallback =
        scored !== undefined && scored !== ''
          ? { tier: scored, source: TIER_SOURCE.local }
          : { tier: TIER_DEFAULT, source: TIER_SOURCE.default };
    }

    if (!opts.fetchTier) {
      tier = fallback.tier;
      source = fallback.source;
      // 本地算出来的也写缓存：下次启动即便打分函数变了，也还有上次的结论垫底。
      await persist(fallback);
      return;
    }

    // ③ 机会主义等待：**发出去、给个预算、不重试**。
    const pending = opts.fetchTier(profile());
    const r = await race(pending);
    if (disposed) return;

    if (typeof r === 'object') {
      serverOutcome = 'ok';
      tier = r.tier;
      source = r.source;
      await persist(r);
      return;
    }

    serverOutcome = r === 'none' ? 'none' : r;
    tier = fallback.tier;
    source = fallback.source;
    await persist(fallback);

    if (r === 'timeout') {
      // **没赶上的那趟仍然要落缓存给下次用**（#25：无论如何把结果写缓存）。
      // ⚠️ 这条继续跑在启动之后，回来时宿主很可能已经没了 —— 写之前必须再判一次。
      // 取消不是失败：安静收摊，别把它抛成错误污染日志。
      void pending
        .then(async (late) => {
          if (disposed || typeof late !== 'object') return;
          await persist(late);
          logger.debug(`档位迟到 ${late.tier}（${late.source}），已写缓存给下次启动`);
        })
        .catch(() => undefined);
    }
  }

  return {
    get tier(): string {
      return tier;
    },
    get source(): string {
      return source;
    },
    get serverOutcome(): ServerOutcome {
      return serverOutcome;
    },
    resolveAtStartup(): Promise<void> {
      // 占坑占在 await 之前：并发调用共用同一趟，不会各判一次。
      return (inflight ??= run());
    },
    async setPreferred(next: string | undefined): Promise<void> {
      if (next === undefined || next === '') await save().delete(SLOT_PREFERRED);
      else await save().save(SLOT_PREFERRED, { tier: next });
    },
    dispose(): void {
      disposed = true;
    },
  };
}

/**
 * `KitModule`。**声明 `deps: ['device-profile']` 不只是 fail-fast，是排序的正确性前提** ——
 * `install()` 里就要把画像捞出来（没有画像就打不了分，没有合理的缺省可退），
 * 拓扑排序保证画像模块先装。项目漏注册，`boot()` 当场抛「depends on missing module」，
 * 而不是等到判档那一步在预算赛跑里静默失败。
 */
export function deviceTierModule(opts: DeviceTierOptions = {}): KitModule {
  let created: DeviceTierHandle | undefined;
  return {
    name: 'device-tier',
    deps: ['device-profile'],
    install(ctx) {
      if (ctx.container.hasLocal(DEVICE_TIER)) return;
      created = createDeviceTier({
        ...opts,
        profile: opts.profile ?? ctx.container.tryResolve(DEVICE_PROFILE),
      });
      ctx.container.register(DEVICE_TIER, { useValue: created });
    },
    stop(ctx) {
      created?.dispose();
      created = undefined;
      ctx.container.unregister(DEVICE_TIER);
    },
  };
}

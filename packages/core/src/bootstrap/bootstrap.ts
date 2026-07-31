import { createToken, getRootContainer, type Container, type Token } from '../di';
import { getLogger, type ILogger } from '../logging';
import { EVENT_BUS, createEventBus, type IEventBus } from '../eventbus';
import { TIMER, createTimer, type ITimer, type ITimerDriver } from '../timer';

/**
 * Bootstrap —— 框架组合根。把地基服务按确定性顺序注册进 DI 容器并启动，幂等、可关闭。
 *
 * 不重建门面：已有 getRootContainer() + cck + getLogger/getEventBus/getTimer 作访问入口；
 * 本模块只补容器没覆盖的「顺序编排 + 生命周期 + 关闭」。见 docs/design/modules/bootstrap.md。
 */

/** 传给各模块钩子的上下文：容器 + 一个供打日志的 logger。 */
export interface BootContext {
  readonly container: Container;
  readonly logger: ILogger;
}

/**
 * 一个可组合的启动模块（功能单元 / 一个 bundle 一个）。
 * 生命周期：boot 时先对所有模块跑 install（注册服务），全部完成后再依次 start；
 * shutdown 时逆序跑 stop。三个钩子均可 async、可缺省。
 */
export interface KitModule {
  readonly name: string;
  /** 依赖的模块名，用于拓扑排序（缺失依赖 / 成环 → 抛错）。 */
  readonly deps?: readonly string[];
  install?(ctx: BootContext): void | Promise<void>;
  start?(ctx: BootContext): void | Promise<void>;
  stop?(ctx: BootContext): void | Promise<void>;
}

export interface BootOptions {
  /** 目标容器，默认 getRootContainer()。 */
  container?: Container;
  /** 待装配模块，默认 []。 */
  modules?: KitModule[];
  /** 编排期日志，默认 getLogger('Bootstrap')。 */
  logger?: ILogger;
}

/** boot 的结果句柄，也注册进容器（KIT token），兼作「已启动」标记。 */
export interface Kit {
  readonly container: Container;
  /** 已启动模块名（拓扑序）。 */
  readonly modules: readonly string[];
  readonly started: boolean;
  /** 逆序 stop 各模块（best-effort：单个失败仅告警不中断），并注销 KIT。幂等。 */
  shutdown(): Promise<void>;
}

/** DI token：boot 成功后注册结果 Kit，兼作重复 boot 抛错的依据。 */
export const KIT: Token<Kit> = createToken<Kit>('cck.kit');

/**
 * 按 deps 拓扑排序（DFS 后序）：依赖在前、依赖者在后；无依赖并列项保持输入数组序。
 * 重名 / 缺失依赖 / 成环 → 抛错。
 */
function topoSort(modules: readonly KitModule[]): KitModule[] {
  const byName = new Map<string, KitModule>();
  for (const m of modules) {
    if (byName.has(m.name)) {
      throw new Error(`Bootstrap: duplicate module name "${m.name}"`);
    }
    byName.set(m.name, m);
  }
  const sorted: KitModule[] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (m: KitModule, path: readonly string[]): void => {
    const s = state.get(m.name);
    if (s === 'done') return;
    if (s === 'visiting') {
      throw new Error(`Bootstrap: dependency cycle detected: ${path.concat(m.name).join(' -> ')}`);
    }
    state.set(m.name, 'visiting');
    for (const dep of m.deps ?? []) {
      const dm = byName.get(dep);
      if (!dm) {
        throw new Error(`Bootstrap: module "${m.name}" depends on missing module "${dep}"`);
      }
      visit(dm, path.concat(m.name));
    }
    state.set(m.name, 'done');
    sorted.push(m);
  };
  for (const m of modules) visit(m, []);
  return sorted;
}

/** 裹上模块名抛出，并挂原始错误到 .cause（ES2021 无 ErrorOptions，手动挂等价）。 */
function fail(name: string, phase: string, err: unknown): never {
  const e = new Error(`Bootstrap: module "${name}" ${phase} failed`);
  (e as { cause?: unknown }).cause = err;
  throw e;
}

/**
 * 组合根入口。按拓扑序 install → start 全部模块，注册 KIT，返回句柄。
 * - 幂等保护：同一 container 已 boot（KIT 已注册）→ 抛错，需先 kit.shutdown()。
 * - 错误 fail-fast：任一 install/start 抛错 → logger.error 上报后，裹模块名抛出。
 */
export async function boot(opts?: BootOptions): Promise<Kit> {
  const container = opts?.container ?? getRootContainer();
  const logger = opts?.logger ?? getLogger('Bootstrap');
  const modules = opts?.modules ?? [];

  if (container.hasLocal(KIT)) {
    throw new Error(
      `Bootstrap: already booted on container "${container.name}"; call kit.shutdown() first`,
    );
  }

  const ordered = topoSort(modules);
  const ctx: BootContext = { container, logger };

  for (const m of ordered) {
    try {
      await m.install?.(ctx);
    } catch (err) {
      logger.error(`module "${m.name}" install failed:`, err);
      fail(m.name, 'install', err);
    }
  }
  for (const m of ordered) {
    try {
      await m.start?.(ctx);
    } catch (err) {
      logger.error(`module "${m.name}" start failed:`, err);
      fail(m.name, 'start', err);
    }
  }

  const names: readonly string[] = Object.freeze(ordered.map((m) => m.name));
  let started = true;
  const kit: Kit = {
    container,
    modules: names,
    get started() {
      return started;
    },
    async shutdown(): Promise<void> {
      if (!started) return;
      started = false;
      for (let i = ordered.length - 1; i >= 0; i--) {
        const m = ordered[i];
        try {
          await m.stop?.(ctx);
        } catch (err) {
          logger.warn(`module "${m.name}" stop failed (ignored):`, err);
        }
      }
      container.unregister(KIT);
    },
  };
  container.register(KIT, { useValue: kit });
  return kit;
}

/**
 * 内置模块：注册 EventBus + Timer 的纯实现（零 cc）。
 * - eventBus / timer 缺省则内部 createEventBus() / createTimer()；容器本层已注册则跳过（尊重覆盖）。
 * - timer 实例由**调用方持有**以拿到 driver（ITimerDriver.tick）：engine 接 cc.director，测试手动 tick。
 */
export function coreModule(opts?: {
  eventBus?: IEventBus;
  timer?: ITimer & ITimerDriver;
}): KitModule {
  return {
    name: 'core',
    install(ctx: BootContext): void {
      if (!ctx.container.hasLocal(EVENT_BUS)) {
        ctx.container.register(EVENT_BUS, { useValue: opts?.eventBus ?? createEventBus() });
      }
      if (!ctx.container.hasLocal(TIMER)) {
        ctx.container.register(TIMER, { useValue: opts?.timer ?? createTimer() });
      }
    },
  };
}

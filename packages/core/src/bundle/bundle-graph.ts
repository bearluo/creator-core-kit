/**
 * BundleGraph —— 「哪个 bundle 依赖哪些 bundle」的**声明表**。
 *
 * ## 为什么必须有人声明
 *
 * 静态分析只看得见 `import`：出包期的两道闸（`check:graph` 扫源码 `import`、`--split` 扫产物
 * `cc.config.deps`）合起来也只覆盖了跨包引用的一半。另一半在构建期**一条记录都不产生**：
 *
 * - `assets.load('cfg/shop', { bundle: 'shop' })` —— 包名是字符串参数；
 * - `loadScene('Dodge', { bundle: 'mini-dodge' })` —— 同上；
 * - `registerUI(id, { bundle: skinBundle(id) })` —— 包名是**运行时函数**，马甲值启动后才定；
 * - `js.getClassByName(...)` —— 故意绕开静态依赖（主包拿地基的唯一缝）。
 *
 * 看不见就只能声明，再拿声明去对账。
 *
 * ## 一表两用
 *
 * `needs` 同时是**加载跟随**（装它之前先装好这些，卸它时一起松手）与**资源边界白名单**
 * （{@link BundleGraph.mayUse}）。拆成两张表必然对不上，而对不上时没有任何信号。
 *
 * ## 与优先级单调那道闸的分工
 *
 * `priority(被依赖) > priority(依赖方)` 管的是「**合不合法、会不会成环**」，本表管的是
 * 「**什么时候装、能碰谁**」。两者不互相取代 —— 声明表本身是能写出环的，
 * {@link BundleGraph.layersFor} 走到环就抛。
 */
import { getLogger, type ILogger } from '../logging';

/** 依赖项：包名，或运行时才定的解析函数（皮包名依赖当前马甲，启动后才有值）。 */
export type BundleRef = string | (() => string);

/** 表里的一行。 */
export interface BundleSpec {
  readonly name: string;
  /** 装它之前必须先装好的包，**也是它能碰的资源边界**。 */
  readonly needs?: readonly BundleRef[];
}

export interface BundleGraph {
  /** 这个包登记过没有。没登记 = 表外的包，`BundleManager` 按 strict 决定抛还是告警。 */
  has(name: string): boolean;
  /** 登记过的包名（升序）。 */
  names(): readonly string[];
  /** 直接依赖（resolver 已按当前状态求值，去重）。未登记的包返回空表。 */
  needsOf(name: string): readonly string[];
  /**
   * 装 `name` 要按顺序装的层，**最后一层就是 `name` 自己**，层内彼此无依赖、可并行。
   * 依赖成环（含自依赖）时抛 —— 表是人写的，环写得出来。
   */
  layersFor(name: string): readonly (readonly string[])[];
  /** `user` 能不能碰 `target` 的资源：自己、常驻豁免包、或在依赖闭包里。 */
  mayUse(user: string, target: string): boolean;
}

export interface BundleGraphOptions {
  /**
   * 谁都能碰、不用声明的常驻包。默认是 AOT 那几个（Creator 内置包）——
   * 它们跟应用同寿命，且共享资源本来就只许经 `resources` 这一个仓。
   */
  alwaysAllowed?: readonly string[];
  logger?: ILogger;
}

/** 默认豁免：Creator 的四个内置包，全都在 AOT 层、常驻。 */
export const DEFAULT_ALWAYS_ALLOWED: readonly string[] = [
  'main',
  'resources',
  'internal',
  'start-scene',
];

/** 从声明表造图。表里重名以**后一条**为准（便于接入方覆盖）。 */
export function createBundleGraph(
  specs: readonly BundleSpec[],
  opts?: BundleGraphOptions,
): BundleGraph {
  const logger = opts?.logger ?? getLogger('BundleGraph');
  const allowed = new Set(opts?.alwaysAllowed ?? DEFAULT_ALWAYS_ALLOWED);
  const table = new Map<string, BundleSpec>();
  for (const s of specs) {
    if (table.has(s.name)) logger.warn(`bundle '${s.name}' 登记了多次，以最后一条为准`);
    table.set(s.name, s);
  }

  const needsOf = (name: string): readonly string[] => {
    const spec = table.get(name);
    if (!spec?.needs) return [];
    const out: string[] = [];
    for (const ref of spec.needs) {
      const n = typeof ref === 'function' ? ref() : ref;
      if (n !== '' && !out.includes(n)) out.push(n);
    }
    return out;
  };

  /** 从 root 出发能到的全部包（含 root 自己）。 */
  const reachable = (root: string): Set<string> => {
    const seen = new Set<string>([root]);
    const stack = [root];
    for (let n = stack.pop(); n !== undefined; n = stack.pop())
      for (const d of needsOf(n))
        if (!seen.has(d)) {
          seen.add(d);
          stack.push(d);
        }
    return seen;
  };

  return {
    has: (name) => table.has(name),
    names: () => Array.from(table.keys()).sort(),
    needsOf,

    layersFor(name): readonly (readonly string[])[] {
      const nodes = reachable(name);
      const deps = new Map<string, string[]>();
      for (const n of nodes) deps.set(n, needsOf(n).filter((d) => nodes.has(d)));
      const out: string[][] = [];
      const done = new Set<string>();
      while (done.size < nodes.size) {
        const layer = Array.from(nodes)
          .filter((n) => !done.has(n) && (deps.get(n) ?? []).every((d) => done.has(d)))
          .sort();
        if (layer.length === 0) {
          const stuck = Array.from(nodes).filter((n) => !done.has(n)).sort();
          throw new Error(`bundle 依赖成环（或自依赖）：${stuck.join(' → ')}`);
        }
        for (const n of layer) done.add(n);
        out.push(layer);
      }
      return out;
    },

    mayUse: (user, target) =>
      user === target || allowed.has(target) || reachable(user).has(target),
  };
}

/**
 * SystemJS 模块表的纯操作（零 cc，可 node 直测）。
 * 从 bundle-source 拆出来，是因为 `js.unregisterClass` 这类要真实引擎行为的 API
 * 按 ADR-0002 不许进 cc mock，那边只能靠真机验——能算清的部分先挪到这里测掉。
 * 同 `hotupdate-paths` 之于 `hotupdate-backend`。
 */

/**
 * SystemJS 的 load 记录，只用到三个字段：`id` = 模块 id，`d` = 依赖的 load 记录，
 * namespace = 模块导出对象。
 *
 * ⚠️ namespace 挂哪个字段**跨版本会变**：Cocos 3.8.7 web 产物里的 SystemJS 是 `n`，`C` 是
 * 「top-level completion promise」；另一些版本 namespace 在 `C` 上。写死一个就会在另一边静默拿到空
 * 导出、一个类都注销不掉（表现为「类换了、界面没换」）→ 下面按形状挑，不按字段名赌。
 */
export interface SysLoad {
  id: string;
  n?: unknown;
  C?: unknown;
  d?: SysLoad[] | null;
}

/** SystemJS 实例：模块表挂在唯一的 symbol 键上，declare 表是普通实例属性 `registerRegistry`。 */
export type SystemLike = Record<string | symbol, unknown> & {
  registerRegistry?: Record<string, unknown>;
};

/** 取 load 记录的 namespace：普通对象才算（`C` 在某些版本是 Promise，要排除掉）。 */
function namespaceOf(load: SysLoad): Record<string, unknown> | undefined {
  for (const v of [load.n, load.C]) {
    if (v && typeof v === 'object' && typeof (v as { then?: unknown }).then !== 'function') {
      return v as Record<string, unknown>;
    }
  }
  return undefined;
}

/**
 * 把某个 bundle 的模块记录（连同 declare 缓存）从 SystemJS 两张表里删掉，
 * 返回这些模块导出的函数 —— 即调用方要拿去 `js.unregisterClass` 的那批类。
 *
 * 返回 `null` = 什么都没清（没有 System / 两张表缺一 / 该 bundle 的入口 chunk 不在表里）；
 * 返回空数组 = 清了模块但没有类可注销。两者对调用方的语义不同，别合并。
 */
export function dropBundleModules(sys: SystemLike | undefined, name: string): unknown[] | null {
  if (!sys) return null;
  const symbol = Reflect.ownKeys(sys).find((k) => typeof k === 'symbol');
  const loads = symbol ? (sys[symbol] as Record<string, SysLoad> | undefined) : undefined;
  const declares = sys.registerRegistry;
  if (!loads || !declares) return null;

  // 出包时该 bundle 的入口 chunk，它的依赖就是这个 bundle 自己的全部脚本模块
  const entryId = `chunks:///_virtual/${name}`;
  const entry = loads[entryId];
  if (!entry) return null;

  const classes: unknown[] = [];
  const drop = (id: string): void => {
    delete loads[id];
    delete declares[id];
  };
  for (const dep of entry.d ?? []) {
    const ns = namespaceOf(dep);
    for (const key of Object.keys(ns ?? {})) {
      const exported = ns?.[key];
      if (typeof exported === 'function') classes.push(exported); // 导出的函数 = 该模块注册的类
    }
    drop(dep.id);
  }
  drop(entryId);
  drop(`virtual:///prerequisite-imports/${name}`);
  return classes;
}

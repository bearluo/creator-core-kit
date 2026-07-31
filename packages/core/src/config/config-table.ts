import { createToken, getRootContainer, type Token } from '../di';
import { getLogger, type ILogger } from '../logging';

/** 行主键类型。 */
export type RowKey = string | number;

/** 主键提取：字段名 或 从行算出 key 的函数。 */
export type KeyExtractor<T> = keyof T | ((row: T) => RowKey);

export interface TableOptions<T> {
  /** 主键：字段名（默认 'id'）或提取函数。 */
  key?: KeyExtractor<T>;
  /** 告警日志（重复主键 / 非法主键）。默认 getLogger('ConfigTable')。 */
  logger?: ILogger;
}

/** 表中按主键取不到行、且调用方要求必得（getOrThrow）时抛出。 */
export class ConfigRowNotFoundError extends Error {
  constructor(table: string, id: RowKey) {
    super(`ConfigTable('${table}'): 主键 '${String(id)}' 无对应行`);
    this.name = 'ConfigRowNotFoundError';
  }
}

/** 按名取表、且要求必得（tableOrThrow）却未注册时抛出。 */
export class ConfigTableNotFoundError extends Error {
  constructor(name: string) {
    super(`ConfigTableManager: 表 '${name}' 未注册`);
    this.name = 'ConfigTableNotFoundError';
  }
}

export interface ConfigTable<T> {
  /** 表名。 */
  readonly name: string;
  /** 行数（去重后，= 索引条目数）。 */
  readonly size: number;
  /** 按主键取行，无 → undefined。 */
  get(id: RowKey): T | undefined;
  /** 按主键取行，无 → 抛 ConfigRowNotFoundError。 */
  getOrThrow(id: RowKey): T;
  /** 是否有该主键。 */
  has(id: RowKey): boolean;
  /** 全部行（按插入顺序，只读快照）。 */
  all(): readonly T[];
  /** 全部主键（按插入顺序）。 */
  keys(): RowKey[];
  /** 第一个满足断言的行，无 → undefined。 */
  find(pred: (row: T) => boolean): T | undefined;
  /** 所有满足断言的行。 */
  filter(pred: (row: T) => boolean): T[];
}

function makeExtractor<T>(key: KeyExtractor<T> | undefined): (row: T) => unknown {
  if (typeof key === 'function') return key;
  const field = (key ?? 'id') as keyof T;
  return (row: T) => row[field];
}

/**
 * 造一张只读配置表（纯逻辑、零 cc）：把已解析的行数组按主键索引成 Map。
 * 重复主键 → 告警 + 后者覆盖（last-wins）；非法主键（undefined/null）→ 告警 + 跳过该行。
 * 行数据的来源（Excel→JSON 由 tools 产出、JSON 由 engine 的 IAssetLoader 加载）不在本层职责内。
 */
export function createTable<T>(
  name: string,
  rows: readonly T[],
  opts?: TableOptions<T>,
): ConfigTable<T> {
  const logger = opts?.logger ?? getLogger('ConfigTable');
  const extract = makeExtractor(opts?.key);
  const index = new Map<RowKey, T>();

  for (const row of rows) {
    const raw = extract(row);
    if (raw === undefined || raw === null || (typeof raw !== 'string' && typeof raw !== 'number')) {
      logger.warn(`createTable('${name}'): 行缺合法主键（得到 ${String(raw)}），已跳过`);
      continue;
    }
    const id = raw as RowKey;
    if (index.has(id)) {
      logger.warn(`createTable('${name}'): 主键 '${String(id)}' 重复，后者覆盖前者`);
    }
    index.set(id, row);
  }

  return {
    name,
    get size(): number {
      return index.size;
    },
    get(id: RowKey): T | undefined {
      return index.get(id);
    },
    getOrThrow(id: RowKey): T {
      const row = index.get(id);
      if (row === undefined) throw new ConfigRowNotFoundError(name, id);
      return row;
    },
    has(id: RowKey): boolean {
      return index.has(id);
    },
    all(): readonly T[] {
      return Array.from(index.values());
    },
    keys(): RowKey[] {
      return Array.from(index.keys());
    },
    find(pred: (row: T) => boolean): T | undefined {
      for (const row of index.values()) if (pred(row)) return row;
      return undefined;
    },
    filter(pred: (row: T) => boolean): T[] {
      const out: T[] = [];
      for (const row of index.values()) if (pred(row)) out.push(row);
      return out;
    },
  };
}

export interface ConfigTableManager {
  /** 建表并注册（就地索引）。同名已存在 → 告警 + 覆盖。返回建好的表。 */
  register<T>(name: string, rows: readonly T[], opts?: TableOptions<T>): ConfigTable<T>;
  /** 放入一张已建好的表（按其 name）。同名已存在 → 告警 + 覆盖。 */
  add<T>(table: ConfigTable<T>): void;
  /** 取表，无 → undefined。类型由调用方以泛型断言。 */
  table<T>(name: string): ConfigTable<T> | undefined;
  /** 取表，无 → 抛 ConfigTableNotFoundError。 */
  tableOrThrow<T>(name: string): ConfigTable<T>;
  /** 是否已注册该表。 */
  has(name: string): boolean;
  /** 便捷：取某表某行，表或行不存在 → undefined。 */
  getRow<T>(name: string, id: RowKey): T | undefined;
  /** 已注册表名（按插入顺序）。 */
  names(): string[];
  /** 反注册一张表（按名）。存在→删除返回 true；不存在→no-op 返回 false。用于卸载模块撤其配表。 */
  unregister(name: string): boolean;
  /** 清空全部表。 */
  clear(): void;
}

/** 造配置表注册表门面（纯逻辑、零 cc）。游戏配表天生复数，按名集中管理。 */
export function createConfigTableManager(opts?: { logger?: ILogger }): ConfigTableManager {
  const logger = opts?.logger ?? getLogger('ConfigTables');
  const tables = new Map<string, ConfigTable<unknown>>();

  return {
    register<T>(name: string, rows: readonly T[], tableOpts?: TableOptions<T>): ConfigTable<T> {
      if (tables.has(name)) logger.warn(`register: 表 '${name}' 已存在，覆盖`);
      const table = createTable(name, rows, tableOpts);
      tables.set(name, table as ConfigTable<unknown>);
      return table;
    },
    add<T>(table: ConfigTable<T>): void {
      if (tables.has(table.name)) logger.warn(`add: 表 '${table.name}' 已存在，覆盖`);
      tables.set(table.name, table as ConfigTable<unknown>);
    },
    table<T>(name: string): ConfigTable<T> | undefined {
      return tables.get(name) as ConfigTable<T> | undefined;
    },
    tableOrThrow<T>(name: string): ConfigTable<T> {
      const t = tables.get(name);
      if (t === undefined) throw new ConfigTableNotFoundError(name);
      return t as ConfigTable<T>;
    },
    has(name: string): boolean {
      return tables.has(name);
    },
    getRow<T>(name: string, id: RowKey): T | undefined {
      return tables.get(name)?.get(id) as T | undefined;
    },
    names(): string[] {
      return Array.from(tables.keys());
    },
    unregister(name: string): boolean {
      return tables.delete(name);
    },
    clear(): void {
      tables.clear();
    },
  };
}

/** DI token：跨 bundle 共享同一套配表（照 ADR-0001，Symbol.for 全局一致）。 */
export const CONFIG_TABLES: Token<ConfigTableManager> =
  createToken<ConfigTableManager>('cck.configTables');

let _default: ConfigTableManager | undefined;

/** 便捷取用：优先 getRootContainer().tryResolve(CONFIG_TABLES)；未注册则用进程级默认。 */
export function getConfigTables(): ConfigTableManager {
  return getRootContainer().tryResolve(CONFIG_TABLES) ?? (_default ??= createConfigTableManager());
}

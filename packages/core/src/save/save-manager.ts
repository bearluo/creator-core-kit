import { createToken, getRootContainer, type Token } from '../di';
import { getLogger, type ILogger } from '../logging';
import { STORAGE, createMemoryStorage, type IStorage } from './storage';

/** 存档数据：JSON 兼容的对象（键 string，值任意可序列化）。 */
export type SaveData = Record<string, unknown>;

/** 序列化策略：对象 <-> 字符串。encode/decode 失败可抛，SaveManager 会捕获并按失败/损坏处理。 */
export interface SaveSerializer {
  readonly name: string;
  encode(value: unknown): string;
  decode(text: string): unknown;
}

/** 默认 JSON 序列化器。 */
export function createJsonSerializer(): SaveSerializer {
  return {
    name: 'json',
    encode: (v: unknown) => JSON.stringify(v),
    decode: (t: string) => JSON.parse(t) as unknown,
  };
}

/** 迁移函数：把 fromVersion 的 data 升级为 fromVersion+1 的 data 并返回。 */
export type Migration = (data: SaveData) => SaveData;

export interface SaveManagerOptions {
  /** 存储后端。默认：DI STORAGE，未注册则新建进程内存实现。 */
  storage?: IStorage;
  /** 序列化策略。默认 JSON。 */
  serializer?: SaveSerializer;
  /** key 前缀（命名空间），默认 'save'。存档位落 `<namespace>/<slot>`。 */
  namespace?: string;
  /** 当前数据版本（save 盖此版本；load 时低于它的存档走迁移链）。须 >=1，默认 1。 */
  version?: number;
  logger?: ILogger;
}

export interface SaveManager {
  /** 当前数据版本。 */
  readonly version: number;
  /** 注册一步迁移 v(from)→v(from+1)。from 须 >=1；重复覆盖。 */
  registerMigration(fromVersion: number, migrate: Migration): void;
  /** 写入 slot（覆盖）。成功 true；slot 非法 / 序列化失败 / 写入抛错 → false。 */
  save(slot: string, data: SaveData): Promise<boolean>;
  /** 读回 slot。不存在 / 损坏 / 迁移失败 → null；合法地存了 {} → 返回 {}。 */
  load(slot: string): Promise<SaveData | null>;
  /** slot 是否存在。 */
  has(slot: string): Promise<boolean>;
  /** 删除 slot。删掉 true；不存在 / 非法名 → false。 */
  delete(slot: string): Promise<boolean>;
  /** 列出全部 slot 名（升序）。 */
  list(): Promise<string[]>;
}

/** 落盘信封：数据 + 写档时的版本。 */
interface Envelope {
  _v: number;
  data: SaveData;
}

const SLOT_RE = /[^A-Za-z0-9_-]/g;

function isPlainObject(v: unknown): v is SaveData {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isEnvelope(v: unknown): v is Envelope {
  if (!isPlainObject(v)) return false;
  return typeof v._v === 'number' && isPlainObject(v.data);
}

/** 造 SaveManager（纯逻辑、零 cc；存储/序列化经接缝注入）。 */
export function createSaveManager(opts?: SaveManagerOptions): SaveManager {
  const storage = opts?.storage ?? getRootContainer().tryResolve(STORAGE) ?? createMemoryStorage();
  const serializer = opts?.serializer ?? createJsonSerializer();
  const namespace = opts?.namespace ?? 'save';
  const version = opts?.version && opts.version >= 1 ? Math.floor(opts.version) : 1;
  const logger = opts?.logger ?? getLogger('SaveManager');
  const migrations = new Map<number, Migration>();
  const prefix = `${namespace}/`;

  const sanitize = (slot: string): string => slot.replace(SLOT_RE, '');
  const keyOf = (slot: string): string => prefix + slot;

  function runMigrations(slot: string, stored: number, data: SaveData): SaveData | null {
    if (stored > version) {
      logger.warn(`load: slot '${slot}' 版本 ${stored} 高于当前 ${version}（未来版本），拒绝加载`);
      return null;
    }
    let cur = data;
    for (let v = stored; v < version; v++) {
      const m = migrations.get(v);
      if (!m) {
        logger.warn(`load: slot '${slot}' 缺 v${v}→v${v + 1} 迁移，拒绝加载`);
        return null;
      }
      const out = m(cur);
      if (!isPlainObject(out)) {
        logger.warn(`load: slot '${slot}' v${v}→v${v + 1} 迁移返回非对象，拒绝加载`);
        return null;
      }
      cur = out;
    }
    return cur;
  }

  return {
    get version(): number {
      return version;
    },

    registerMigration(fromVersion: number, migrate: Migration): void {
      if (!(fromVersion >= 1)) {
        logger.warn(`registerMigration: fromVersion 须 >=1，忽略 ${fromVersion}`);
        return;
      }
      migrations.set(Math.floor(fromVersion), migrate);
    },

    async save(slot: string, data: SaveData): Promise<boolean> {
      const safe = sanitize(slot);
      if (safe === '') {
        logger.warn(`save: 非法 slot 名 '${slot}'`);
        return false;
      }
      let text: string;
      try {
        const env: Envelope = { _v: version, data };
        text = serializer.encode(env);
      } catch (e) {
        logger.warn(`save: slot '${safe}' 序列化失败`, e);
        return false;
      }
      try {
        await storage.set(keyOf(safe), text);
      } catch (e) {
        logger.warn(`save: slot '${safe}' 写入失败`, e);
        return false;
      }
      return true;
    },

    async load(slot: string): Promise<SaveData | null> {
      const safe = sanitize(slot);
      if (safe === '') return null;
      let text: string | null;
      try {
        text = await storage.get(keyOf(safe));
      } catch (e) {
        logger.warn(`load: slot '${safe}' 读取失败`, e);
        return null;
      }
      if (text === null) return null;
      let env: unknown;
      try {
        env = serializer.decode(text);
      } catch {
        logger.warn(`load: slot '${safe}' 解析失败（损坏）`);
        return null;
      }
      if (!isEnvelope(env)) {
        logger.warn(`load: slot '${safe}' 信封非法（损坏）`);
        return null;
      }
      if (env._v === version) return env.data;
      return runMigrations(safe, env._v, env.data);
    },

    async has(slot: string): Promise<boolean> {
      const safe = sanitize(slot);
      if (safe === '') return false;
      return (await storage.get(keyOf(safe))) !== null;
    },

    async delete(slot: string): Promise<boolean> {
      const safe = sanitize(slot);
      if (safe === '') return false;
      if ((await storage.get(keyOf(safe))) === null) return false;
      await storage.remove(keyOf(safe));
      return true;
    },

    async list(): Promise<string[]> {
      const keys = await storage.keys();
      return keys
        .filter((k) => k.startsWith(prefix))
        .map((k) => k.slice(prefix.length))
        .sort();
    },
  };
}

/** DI token：项目可 register 自己的 SaveManager 覆盖默认（见 di-container）。 */
export const SAVE_MANAGER: Token<SaveManager> = createToken<SaveManager>('cck.saveManager');

let _default: SaveManager | undefined;

/** 便捷取用：优先 getRootContainer().tryResolve(SAVE_MANAGER)；未注册则用进程级默认（内存/STORAGE 背书）。 */
export function getSaveManager(): SaveManager {
  return getRootContainer().tryResolve(SAVE_MANAGER) ?? (_default ??= createSaveManager());
}

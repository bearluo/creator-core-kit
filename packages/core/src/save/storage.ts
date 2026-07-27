import { createToken, type Token } from '../di';

/**
 * 存储接缝：异步 string→string KV。core 只认本接口（守零 cc 铁律）。
 * engine 注册 cc.sys.localStorage 适配；微信/抖音小游戏可接其异步 storage；测试/默认用内存实现。
 * 异步是为兼容异步后端（wx 异步存储、IndexedDB、云存档）；同步后端包一层 Promise.resolve 即可。
 */
export interface IStorage {
  /** 读取；键不存在返回 null。 */
  get(key: string): Promise<string | null>;
  /** 写入（覆盖）。 */
  set(key: string, value: string): Promise<void>;
  /** 删除；键不存在为 no-op。 */
  remove(key: string): Promise<void>;
  /** 返回当前全部 key（无序）。SaveManager 用它按命名空间前缀筛存档位。 */
  keys(): Promise<string[]>;
}

/** DI token：engine Bootstrap register cc.sys.localStorage 适配；未注册时 SaveManager 回退内存实现。 */
export const STORAGE: Token<IStorage> = createToken<IStorage>('cck.storage');

/** 进程内存 IStorage（Map 背书）。默认实现 + 测试用；非持久，进程退出即丢。 */
export function createMemoryStorage(initial?: Record<string, string>): IStorage {
  const map = new Map<string, string>(initial ? Object.entries(initial) : undefined);
  return {
    get(key: string): Promise<string | null> {
      return Promise.resolve(map.has(key) ? (map.get(key) as string) : null);
    },
    set(key: string, value: string): Promise<void> {
      map.set(key, value);
      return Promise.resolve();
    },
    remove(key: string): Promise<void> {
      map.delete(key);
      return Promise.resolve();
    },
    keys(): Promise<string[]> {
      return Promise.resolve([...map.keys()]);
    },
  };
}

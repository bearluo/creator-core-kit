import { sys } from 'cc';
import { STORAGE } from '@cck/core';
import type { IStorage, KitModule } from '@cck/core';

/**
 * IStorage 的 cc 实现 —— SaveManager 的「引擎半」：cc.sys.localStorage 背书的 string→string KV。
 * cc.sys.localStorage 在 Web 等价 window.localStorage，原生（JSB）为 SQLite 背书的等价实现，
 * 二者均支持 getItem/setItem/removeItem/key(i)/length。core 的 SaveManager 只认异步 IStorage 接缝，
 * 这里把同步 localStorage 包一层 Promise.resolve；微信/抖音小游戏的异步 storage 可另写实现替换。
 */
export function createCcStorage(): IStorage {
  const ls = sys.localStorage; // cc.d.ts 里类型为 any，运行时为 HTML5 localStorage 等价物
  return {
    get(key: string): Promise<string | null> {
      return Promise.resolve(ls.getItem(key));
    },
    set(key: string, value: string): Promise<void> {
      ls.setItem(key, value);
      return Promise.resolve();
    },
    remove(key: string): Promise<void> {
      ls.removeItem(key);
      return Promise.resolve();
    },
    keys(): Promise<string[]> {
      const out: string[] = [];
      for (let i = 0; i < ls.length; i++) {
        const k = ls.key(i);
        if (k !== null) out.push(k);
      }
      return Promise.resolve(out);
    },
  };
}

/** KitModule：注册 `STORAGE → cc.sys.localStorage 实现`（本层未注册时）。放模块数组里，SaveManager 自动拾取。 */
export function ccStorageModule(): KitModule {
  return {
    name: 'storage',
    install(ctx) {
      if (!ctx.container.hasLocal(STORAGE)) {
        ctx.container.register(STORAGE, { useValue: createCcStorage() });
      }
    },
  };
}

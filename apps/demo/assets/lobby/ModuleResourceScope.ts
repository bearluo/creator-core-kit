import type { Asset, JsonAsset } from 'cc';
import { getAssetLoader, getConfigTables, getI18n } from '@cck/core';
import type { ConfigTable, TableOptions } from '@cck/core';
import { loadTable } from '@cck/engine';

/**
 * 模块作用域资源登记 + 一键回收（设计 §4）。
 *
 * 「bundle 没加载就不该有它的 i18n/配表；卸载 bundle 就连它们一起下掉。」难点：i18n/config 是把数据
 * **拷进 core 全局注册表**的，仅 `bundleMgr.release` 释放 bundle 的 JSON 资源撤不掉已注册的表——必须显式反注册。
 * 本 scope 让模块 mount 里每次 load* 都登记一条对称回收，unmount 只需一行 `scope.dispose()`。
 * 所有加载都带 `{bundle}`，资源从模块自己的 bundle 出。
 */
export class ModuleResourceScope {
  private readonly teardowns: Array<() => void> = [];

  constructor(private readonly bundle: string) {}

  /**
   * 加载模块 i18n 翻译表（扁平且键带模块前缀，如 `{'shop.title':'商城'}`，避免跨模块撞名）。
   * dispose 时按**精确键** removeTable，不误伤其它模块同 locale 的键。
   */
  async i18n(locale: string, path: string): Promise<void> {
    const asset = await getAssetLoader().load<JsonAsset>(path, { type: 'json', bundle: this.bundle });
    const table = (asset.json ?? {}) as Record<string, string>;
    const keys = Object.keys(table);
    getI18n().addTable(locale, table);
    getAssetLoader().release(path, { type: 'json', bundle: this.bundle }); // 数据已拷进 i18n，JSON 资源可释放
    this.teardowns.push(() => getI18n().removeTable(locale, keys));
  }

  /** 加载模块配表 → register 进默认 ConfigTableManager；dispose 时 unregister。 */
  async table<T>(name: string, path: string, tableOpts?: TableOptions<T>): Promise<ConfigTable<T>> {
    const t = await loadTable<T>(name, path, { bundle: this.bundle, tableOpts });
    this.teardowns.push(() => getConfigTables().unregister(name));
    return t;
  }

  /** 从模块 bundle 加载一个资源（prefab / audioClip / …）；dispose 时 release。 */
  async load<T extends Asset>(path: string, type?: string): Promise<T> {
    const a = await getAssetLoader().load<T>(path, { type, bundle: this.bundle });
    this.teardowns.push(() => getAssetLoader().release(path, { type, bundle: this.bundle }));
    return a;
  }

  /** 登记任意对称回收（如数据绑定 `BindingScope.dispose`、事件解绑）。 */
  add(teardown: () => void): void {
    this.teardowns.push(teardown);
  }

  /** 逆序执行全部回收（幂等，单条失败不阻断其余）。 */
  dispose(): void {
    while (this.teardowns.length > 0) {
      const fn = this.teardowns.pop();
      try {
        fn?.();
      } catch (e) {
        console.warn('[CCK-LOBBY] ModuleResourceScope 回收单条失败：', (e as Error).message);
      }
    }
  }
}

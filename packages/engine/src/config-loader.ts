import type { JsonAsset } from 'cc';
import { getAssetLoader, getConfigTables } from '@cck/core';
import type { ConfigTable, ConfigTableManager, TableOptions } from '@cck/core';

/**
 * ConfigTable 的「引擎半」：配表 JSON 经 IAssetLoader 真加载（依赖 AssetManager engine 半）并 register 进 core 的
 * ConfigTableManager。core 的 createTable 只认已解析的行数组、零 cc；JSON 来源/加载在这层。
 * JSON 内容应为行数组 `[{...}, {...}]`；Excel→JSON 由 tools 产出。
 */
export async function loadTable<T>(
  name: string,
  path: string,
  opts?: { bundle?: string; tableOpts?: TableOptions<T>; manager?: ConfigTableManager },
): Promise<ConfigTable<T>> {
  const asset = await getAssetLoader().load<JsonAsset>(path, { type: 'json', bundle: opts?.bundle });
  const rows = (asset.json ?? []) as unknown as readonly T[];
  return (opts?.manager ?? getConfigTables()).register<T>(name, rows, opts?.tableOpts);
}

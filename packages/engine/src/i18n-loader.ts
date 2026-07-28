import type { JsonAsset } from 'cc';
import {
  STORAGE,
  createMemoryStorage,
  getAssetLoader,
  getI18n,
  getRootContainer,
} from '@cck/core';
import type { Disposer, I18n, IStorage, LocaleTableInput } from '@cck/core';

/**
 * i18n 的「引擎半」：翻译表从 JSON 资源经 IAssetLoader 真加载进 core 的 I18n（依赖 AssetManager engine 半），
 * 语言选择经 IStorage 持久化。core 的 createI18n 是纯字典、零 cc，表来源/持久化在这层接线。
 */

const DEFAULT_LOCALE_KEY = 'cck.i18n.locale';

/** 从 JSON 资源加载一个 locale 的翻译表并 addTable。JSON 内容为 { key: '模板' }（可嵌套，i18n 自动拍平）。 */
export async function loadLocaleTable(
  locale: string,
  path: string,
  opts?: { bundle?: string; merge?: boolean; i18n?: I18n },
): Promise<void> {
  const asset = await getAssetLoader().load<JsonAsset>(path, { type: 'json', bundle: opts?.bundle });
  const table = (asset.json ?? {}) as LocaleTableInput;
  (opts?.i18n ?? getI18n()).addTable(locale, table, opts?.merge);
}

/**
 * 接线语言持久化：先从 storage 恢复上次选择的 locale（有则 setLocale），再订阅 onChange 写回 storage。
 * 返回取消订阅函数。storage 缺省取 DI STORAGE（未注册回退内存实现）。
 */
export async function setupLocalePersistence(opts?: {
  i18n?: I18n;
  storage?: IStorage;
  key?: string;
}): Promise<Disposer> {
  const i18n = opts?.i18n ?? getI18n();
  const storage = opts?.storage ?? getRootContainer().tryResolve(STORAGE) ?? createMemoryStorage();
  const key = opts?.key ?? DEFAULT_LOCALE_KEY;
  const stored = await storage.get(key);
  if (stored) i18n.setLocale(stored);
  return i18n.onChange((loc) => {
    void storage.set(key, loc);
  });
}

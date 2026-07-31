import { getAssetLoader, type AssetTypeToken, type IAssetLoader } from '../asset';
import {
  getConfigTables,
  type ConfigTable,
  type ConfigTableManager,
  type TableOptions,
} from '../config';
import { getI18n, type I18n, type LocaleTableInput } from '../i18n';
import { getLogger, type ILogger } from '../logging';
import { getUIManager, type UIManager } from '../ui';
import { getBundleManager, type BundleManager } from './bundle-manager';

/**
 * BundleScope —— 一个 bundle 从加载到卸载，它注册的一切都可回收。
 *
 * 「bundle 没加载就不该有它的 i18n/配表；卸载 bundle 就连它们一起下掉。」难点：i18n/config 是把数据
 * **拷进 core 全局注册表**的，仅 release bundle 的 JSON 资源撤不掉已注册的表——必须显式反注册。
 * 本 scope 让每次 load* 都登记一条对称回收，卸载只需一行 `dispose()`。
 *
 * **这是免重启换 bundle 代码的正确性基础**：换版本后 cc 的类表被静默替换（同 uuid 后注册者胜出），
 * 旧类的存活实例随即成为孤儿——`getComponent(新类)` 找不到它们，任何按类查找都会漏。所以
 * `dispose()` 的第一步必须是销毁本 bundle 的界面实例，晚一步就没有可靠手段找回它们了。
 *
 * 不对称之处：**load 由调用方做，release 由本 scope 做**。加载是启动/打开流程的一部分（要报进度、
 * 处理失败、决定时机），回收则是一条不该让调用点复述的固定链路。
 */
export interface BundleScope {
  readonly bundle: string;
  /**
   * 加载本 bundle 的 i18n 翻译表并 addTable；dispose 时按**精确键** removeTable，
   * 不误伤其它模块同 locale 的键。表须**扁平**且键带模块前缀（如 `{'shop.title':'商城'}`）。
   */
  i18n(locale: string, path: string): Promise<void>;
  /** 加载本 bundle 的配表 JSON（行数组）→ register；dispose 时 unregister。 */
  table<T>(name: string, path: string, tableOpts?: TableOptions<T>): Promise<ConfigTable<T>>;
  /** 从本 bundle 加载一个资源；dispose 时按同键 release。 */
  load<T>(path: string, type?: AssetTypeToken): Promise<T>;
  /** 登记任意对称回收（DI 子作用域 dispose、事件解绑、BindingScope、定时器…）。 */
  add(teardown: () => void | Promise<void>): void;
  /** 回收全部（幂等，单条失败不阻断其余）。顺序见实现注释。 */
  dispose(): Promise<void>;
}

/** 依赖注入口（仅为可测；生产不传，各服务从全局取）。用 Pick 收窄到真正用到的方法。 */
export interface BundleScopeDeps {
  ui?: Pick<UIManager, 'closeByBundle'>;
  bundles?: Pick<BundleManager, 'release'>;
  assets?: Pick<IAssetLoader, 'load' | 'release'>;
  i18n?: Pick<I18n, 'addTable' | 'removeTable'>;
  tables?: Pick<ConfigTableManager, 'register' | 'unregister'>;
  logger?: ILogger;
}

/** JSON 资源的最小形状（`cc.JsonAsset` 的 `.json`）——core 不 import cc，只认这个结构。 */
interface JsonLike {
  readonly json?: unknown;
}

export function createBundleScope(bundle: string, deps?: BundleScopeDeps): BundleScope {
  const logger = deps?.logger ?? getLogger('BundleScope');
  const teardowns: Array<() => void | Promise<void>> = [];
  let disposed = false;

  // 各服务**延迟解析**：scope 常在 engine 注册各后端之前就被造出来（同 UIManager 的延迟解析坑）。
  const uiMgr = (): Pick<UIManager, 'closeByBundle'> => deps?.ui ?? getUIManager();
  const bundleMgr = (): Pick<BundleManager, 'release'> => deps?.bundles ?? getBundleManager();
  const assetLoader = (): Pick<IAssetLoader, 'load' | 'release'> => deps?.assets ?? getAssetLoader();
  const i18nSvc = (): Pick<I18n, 'addTable' | 'removeTable'> => deps?.i18n ?? getI18n();
  const tableMgr = (): Pick<ConfigTableManager, 'register' | 'unregister'> =>
    deps?.tables ?? getConfigTables();

  return {
    bundle,

    async i18n(locale: string, path: string): Promise<void> {
      const asset = await assetLoader().load<JsonLike>(path, { type: 'json', bundle });
      const table = (asset?.json ?? {}) as Record<string, unknown>;
      const keys = Object.keys(table);
      // ponytail: 只按顶层键回收 → 表必须扁平。嵌套表 addTable 会拍平成 'a.b'，顶层键删不掉它们，
      // 于是 dispose 后残留翻译 → 显式告警，别静默泄漏。真要支持嵌套就得复刻 i18n 的拍平逻辑。
      const nested = keys.filter((k) => typeof table[k] !== 'string');
      if (nested.length > 0) {
        logger.warn(
          `i18n('${locale}', '${path}')：表含非字符串键 [${nested.join(', ')}]，dispose 时删不干净——请用扁平表（键带模块前缀）`,
        );
      }
      i18nSvc().addTable(locale, table as LocaleTableInput);
      assetLoader().release(path, { type: 'json', bundle }); // 数据已拷进 i18n，JSON 资源可释放
      teardowns.push(() => i18nSvc().removeTable(locale, keys));
    },

    async table<T>(
      name: string,
      path: string,
      tableOpts?: TableOptions<T>,
    ): Promise<ConfigTable<T>> {
      const asset = await assetLoader().load<JsonLike>(path, { type: 'json', bundle });
      // 表持有的是 rows 引用 → 不 release JSON 资源，让它随 bundle 一起走。
      const rows = (asset?.json ?? []) as readonly T[];
      const t = tableMgr().register<T>(name, rows, tableOpts);
      teardowns.push(() => void tableMgr().unregister(name));
      return t;
    },

    async load<T>(path: string, type?: AssetTypeToken): Promise<T> {
      const a = await assetLoader().load<T>(path, { type, bundle });
      teardowns.push(() => assetLoader().release(path, { type, bundle }));
      return a;
    },

    add(teardown: () => void | Promise<void>): void {
      teardowns.push(teardown);
    },

    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;
      // 1. 先销毁本 bundle 的界面实例——见文件头：换版本后旧实例即成孤儿，晚一步找不回来。
      try {
        uiMgr().closeByBundle(bundle);
      } catch (e) {
        logger.warn(`closeByBundle('${bundle}') 失败`, e);
      }
      // 2. 逆序回收登记项（i18n / 配表 / 资源 / DI 子作用域 / 事件…），单条失败不阻断其余。
      while (teardowns.length > 0) {
        const fn = teardowns.pop();
        try {
          await fn?.();
        } catch (e) {
          logger.warn(`bundle '${bundle}' 回收单条失败`, e);
        }
      }
      // 3. 最后才放 bundle：前面几步还要用它的资源。
      bundleMgr().release(bundle);
    },
  };
}

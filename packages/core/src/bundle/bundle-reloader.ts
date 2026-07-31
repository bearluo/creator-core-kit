import { createToken, type Token } from '../di';

/**
 * 让「下一次 loadBundle 真的重新求值该 bundle 的脚本」——免重启换 bundle 代码的平台接缝。
 *
 * 换代码**不是**换资源：`releaseAll + removeBundle` 只把资源（prefab / json / 图集 / i18n）
 * 放干净，脚本模块和已注册的 cc 类都还在缓存里，再进模块跑的仍是旧代码且**没有任何报错**。
 * 让脚本失效必须模块缓存与类注册**一起**清，engine 侧实现负责这件事。
 *
 * 两条路径：
 * - **web（md5 换版）**：换版本 = 换 `index.<md5>.js` URL，engine 的 `IBundleSource.loadBundle`
 *   发现版本变了会**自动**清一次，调用方只需 {@link BundleManager.setVersions}，无须显式调本接口。
 *   ⚠️ 没勾 MD5 Cache 则文件名恒为 `index.js`，同 URL 同模块 id → 拿到的还是旧代码且无报错。
 * - **native（原地覆盖同名文件）**：路径与版本都看不出变化，自动路径识别不到 → 热更落盘后由调用方
 *   显式调一次 `invalidate(bundle)`。
 *
 * ⚠️ **别在版本没变时调**：web 的引擎按 URL 缓存已下载脚本，清了缓存那段代码就再也执行不到，
 * 下次 load 会直接失败。native 无此限制。
 */
export interface IBundleReloader {
  /** 返回是否真的清掉了该 bundle 的脚本缓存；`false` = 本平台/本时机做不到，调用方应转重启路径。 */
  invalidate(bundle: string): boolean;
}

/** DI token：engine 注册平台实现；未注册时调用方按 `false`（需重启）处理。 */
export const BUNDLE_RELOADER: Token<IBundleReloader> =
  createToken<IBundleReloader>('cck.bundleReloader');

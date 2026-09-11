import { settings } from 'cc';

/**
 * 构建期注入的值 —— 「打包时才定、运行时只读」那几个常量的唯一入口。
 *
 * ## 为什么要有这一层
 *
 * `app-config.ts` 里的 `VEST` / `version` / `dispatcher.url` 躲不掉 AOT 层（见那个文件的注释），
 * 而它们又恰恰是**一个包一个值**的东西：出十个马甲的包就要改十次源码。这里把「值从哪来」
 * 和「值是什么」拆开，源码里只留开发期默认值，出包时由构建插件覆盖。
 *
 * ## 值怎么进来
 *
 * `extensions/cck-build` 在 `onBeforeCompressSettings` 钩子里把构建面板上填的值写进
 * `settings.json` 的 `cck` 段，引擎启动时读进内存，这里查出来。整条链路：
 *
 * ```
 * 构建面板 / 命令行 configPath
 *   → options.packages['cck-build']       （构建插件读到）
 *   → result.settings.cck                 （钩子写进去）
 *   → settings.json                       （产物）
 *   → settings.querySettings('cck', key)  （本文件）
 * ```
 *
 * ## 为什么一定要有 fallback
 *
 * **编辑器预览不走构建流程** —— 那时 `settings.json` 里根本没有 `cck` 段，查出来必然是 `null`。
 * 所以源码里的默认值不是冗余，它就是开发期用的那一套。真机上没装插件、或插件装了但没配值，
 * 同样落到这条路上：**缺配置不该炸，该按开发期默认值跑**。
 *
 * ## 为什么不用自定义宏（`cc/userland/macro`）
 *
 * 宏是编译期常量、能触发死代码剔除，但它是**项目级**配置 —— 一个项目一套值，命令行传不了，
 * 做不到「一次构建一个马甲」。这几个字段是纯数据、不产生分支，剔不剔死代码没有意义。
 * 横评见 `docs/research/2026-08-17-creator-build-custom-options.md`。
 */

/** settings.json 里的段名。改它要同步改构建插件 `hooks.js` 的 `CATEGORY`。 */
const CATEGORY = 'cck';

/**
 * ## 这些值能不能热更（实测结论，2026-08-17）
 *
 * **能，但会重启。** `settings.json` 在 base manifest 里（native 产物的 `src/` 全在），
 * 随 base 包一起下发；`hotupdate` 启动步 apply 完直接 `restart()` + halt 本轮启动，
 * 重启后 `querySettings` 读到的就是新值。真机实测：CDN 上把 `cck.vest` 从缺省改成
 * `'vest'`，客户端一轮内 `skin='base'` → 下载 → 重启 → `skin='vest'`，强杀冷启动仍是
 * `'vest'`（`build-templates/native/index.ejs` 的搜索路径还原兜住了冷启动那一程）。
 *
 * 所以「打包期常量」的准确含义是**换它要重启**，不是「必须发新包」。但有两个仍然只能发包：
 *
 * - **`dispatcherUrl` 改错 = 砖头包**：启动序列是 `dispatch` → `hotupdate`，握手失败会
 *   `abortLaunch`，**根本走不到热更那一步** —— 想靠热更修一个连不上的握手地址是死循环。
 * - **`appId` 改了丢存档**：它是本机存储 key 的前缀，换一个等于换一个玩家。
 *
 * `accountLoginUrl` 配错**不是**砖头：认证在地基 boot 里，排在 `hotupdate` **之后**，
 * 热更那一步照样跑得到，下一版改对即可（代价是要重启一次）。
 *
 * 其余四个（`vest` / `version` / `channel` / `env`）热更改是安全的。
 */

/**
 * 可注入的字段 —— **必须与 `extensions/cck-build/builder.js` 的 `options` 键一一对应**。
 *
 * 插件是 JS 写的（编辑器扩展不进 TS 编译链），两边对不上没有编译期报错，只会表现为
 * 「面板上填了但不生效」。加字段时两处一起改，并在 `build-config.test.ts` 里补一条断言。
 */
export type BuildKey =
  | 'vest'
  | 'appId'
  | 'version'
  | 'channel'
  | 'env'
  | 'dispatcherUrl'
  | 'accountLoginUrl';

/**
 * 取一个构建期注入的值，没有就用 `fallback`。
 *
 * 空字符串**也算没有**：构建面板上把输入框清空是「这一项我不配」，而不是「我要一个空的
 * dispatcher 地址」。真需要空值的字段现在一个都没有，等真出现再给它单独开一条路。
 */
export function buildValue(key: BuildKey, fallback: string): string {
  const v = settings.querySettings<string>(CATEGORY, key);
  return v === null || v === undefined || v === '' ? fallback : v;
}

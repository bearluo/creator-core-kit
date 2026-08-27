/**
 * `cc/env` 的类型声明 —— 官方 `@cocos/creator-types` **没有**这一个（只有 `cc` 本体），
 * Creator 是在 `temp/declarations/cc.env.d.ts` 里现生成的，而 `temp/` 不入库、CI 上没有。
 * 所以给 `tsconfig.check.json` 自备一份。
 *
 * 全是**打包期常量**（构建时按目标平台替换成字面量，于是没用到的分支会被摇掉）。
 * 这里只声明工程真用到的那几个，缺了就往下加。
 */
declare module 'cc/env' {
  /** 在编辑器进程里（含 Game View 预览）。 */
  export const EDITOR: boolean;
  /** 预览（编辑器预览 / 浏览器预览）。 */
  export const PREVIEW: boolean;
  /** 构建产物里。 */
  export const BUILD: boolean;
  /** 开发模式（未勾 release）。 */
  export const DEBUG: boolean;
  /** 原生平台（Android / iOS）。 */
  export const NATIVE: boolean;
  /** 浏览器 / H5。 */
  export const HTML5: boolean;
}

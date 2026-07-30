import { createToken, getRootContainer, type Token } from '../di';
import { getLogger, type ILogger } from '../logging';
import type { Disposer } from '../eventbus';

/** 扁平翻译表：点键（如 'menu.start'）→ 模板串（如 'Hi {name}'）。 */
export type LocaleTable = Record<string, string>;

/**
 * addTable 接受的输入：可扁平（值为 string）也可嵌套（值为子对象），
 * 追加时统一拍平为点键。数字值转成字符串，其它类型（布尔/数组/null）告警跳过。
 */
export type LocaleTableInput = Record<string, unknown>;

/** 插值参数：{name} → 值（数字转字符串）。 */
export type I18nParams = Record<string, string | number>;

export interface I18nOptions {
  /** 初始语言，默认 'en'。 */
  locale?: string;
  /** 回退语言（当前 locale 缺该 key 时查它）。默认与初始 locale 相同。 */
  fallbackLocale?: string;
  /** 预置翻译表 { en: {...}, zh: {...} }，值可嵌套（自动拍平）。 */
  tables?: Record<string, LocaleTableInput>;
  /** 告警日志（缺翻译 / 切到无表 locale / 非法输入）。默认 getLogger('I18n')。 */
  logger?: ILogger;
}

export interface I18n {
  /** 当前语言。 */
  readonly locale: string;
  /** 回退语言。 */
  readonly fallbackLocale: string;
  /**
   * 切语言。空串 → 告警 no-op；与当前相同 → no-op（不重复广播）；否则切换并广播 onChange。
   * 切到无翻译表的 locale 会告警（拼写错误 / 表尚未加载），但仍切换（表可后补、fallback 兜底）。
   */
  setLocale(locale: string): void;
  /**
   * 追加/合并一个 locale 的翻译表。嵌套对象自动拍平为点键。
   * merge=true（默认）叠加到已有表（同键覆盖）；false 整表替换。
   */
  addTable(locale: string, table: LocaleTableInput, merge?: boolean): void;
  /**
   * 移除翻译。keys 省略 → 删除整个 locale 表；给定 → 只删这些点键（不存在的键忽略）。
   * 删空后该 locale 表一并移除（availableLocales 不留空表）。空 locale 告警 no-op。用于卸载模块撤其翻译。
   */
  removeTable(locale: string, keys?: readonly string[]): void;
  /** 取译文：当前 locale → fallback → key 本身（缺翻译去重告警）。参数走 {name} 插值。 */
  t(key: string, params?: I18nParams): string;
  /** 指定（默认当前）locale 是否直接有该 key（不查 fallback）。 */
  has(key: string, locale?: string): boolean;
  /** 已注册翻译表的 locale 列表。 */
  availableLocales(): string[];
  /** 订阅语言切换，返回取消订阅函数。 */
  onChange(cb: (locale: string) => void): Disposer;
}

const KEY_RE = /\{(\w+)\}/g;

/** 把（可能嵌套的）输入拍平进 out，点键拼接。非 string/number 叶子告警跳过。 */
function flattenInto(
  out: LocaleTable,
  obj: LocaleTableInput,
  prefix: string,
  logger: ILogger,
): void {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') {
      out[key] = v;
    } else if (typeof v === 'number') {
      out[key] = String(v);
    } else if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      flattenInto(out, v as LocaleTableInput, key, logger);
    } else {
      logger.warn(`addTable: 键 '${key}' 值类型不支持（${Array.isArray(v) ? 'array' : typeof v}），已跳过`);
    }
  }
}

/** {name} 插值：命中参数则替换（数字转字符串），缺参数保留原占位符。 */
function interpolate(tpl: string, params?: I18nParams): string {
  if (!params) return tpl;
  return tpl.replace(KEY_RE, (m, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : m,
  );
}

/** 造 i18n 纯字典翻译层（零 cc）。字体切换 / 资源加载 / 语言持久化由 engine / app 侧接线。 */
export function createI18n(opts?: I18nOptions): I18n {
  const logger = opts?.logger ?? getLogger('I18n');
  let locale = opts?.locale ?? 'en';
  const fallbackLocale = opts?.fallbackLocale ?? locale;
  const tables = new Map<string, LocaleTable>();
  const listeners = new Set<(locale: string) => void>();
  const warned = new Set<string>(); // 缺翻译告警去重，键 'locale|key'

  const addTable = (loc: string, input: LocaleTableInput, merge = true): void => {
    if (!loc) {
      logger.warn('addTable: 空 locale，忽略');
      return;
    }
    const flat: LocaleTable = {};
    flattenInto(flat, input, '', logger);
    const existing = tables.get(loc);
    if (existing && merge) {
      Object.assign(existing, flat);
    } else {
      tables.set(loc, flat);
    }
  };

  const removeTable = (loc: string, keys?: readonly string[]): void => {
    if (!loc) {
      logger.warn('removeTable: 空 locale，忽略');
      return;
    }
    const existing = tables.get(loc);
    if (!existing) return;
    if (keys === undefined) {
      tables.delete(loc);
      return;
    }
    for (const k of keys) delete existing[k];
    if (Object.keys(existing).length === 0) tables.delete(loc);
  };

  if (opts?.tables) {
    for (const [loc, table] of Object.entries(opts.tables)) addTable(loc, table);
  }

  function warnMissing(key: string): void {
    const mark = `${locale}|${key}`;
    if (warned.has(mark)) return;
    warned.add(mark);
    logger.warn(`t: 缺翻译 [${locale}] key '${key}'`);
  }

  return {
    get locale(): string {
      return locale;
    },
    get fallbackLocale(): string {
      return fallbackLocale;
    },

    setLocale(next: string): void {
      if (!next) {
        logger.warn('setLocale: 空 locale，忽略');
        return;
      }
      if (next === locale) return;
      if (!tables.has(next)) {
        logger.warn(`setLocale: locale '${next}' 无翻译表（拼写错误或表尚未加载），仍切换`);
      }
      locale = next;
      for (const cb of [...listeners]) {
        try {
          cb(locale);
        } catch (e) {
          logger.warn('setLocale: onChange 回调抛错，已忽略', e);
        }
      }
    },

    addTable,
    removeTable,

    t(key: string, params?: I18nParams): string {
      let tpl = tables.get(locale)?.[key];
      if (tpl === undefined && fallbackLocale !== locale) {
        tpl = tables.get(fallbackLocale)?.[key];
      }
      if (tpl === undefined) {
        warnMissing(key);
        return key;
      }
      return interpolate(tpl, params);
    },

    has(key: string, loc?: string): boolean {
      const table = tables.get(loc ?? locale);
      return table !== undefined && Object.prototype.hasOwnProperty.call(table, key);
    },

    availableLocales(): string[] {
      return [...tables.keys()];
    },

    onChange(cb: (locale: string) => void): Disposer {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
  };
}

/** DI token：项目 / engine 可 register 自己的 I18n 覆盖默认。 */
export const I18N: Token<I18n> = createToken<I18n>('cck.i18n');

let _default: I18n | undefined;

/** 便捷取用：优先 getRootContainer().tryResolve(I18N)；未注册则用进程级默认（空表 'en'）。 */
export function getI18n(): I18n {
  return getRootContainer().tryResolve(I18N) ?? (_default ??= createI18n());
}

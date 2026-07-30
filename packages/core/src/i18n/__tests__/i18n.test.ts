import { afterEach, describe, expect, it } from 'vitest';
import { createI18n, getI18n, I18N, type I18n } from '../i18n';
import { getRootContainer } from '../../di';
import { LogLevel, type ILogger } from '../../logging';

function fakeLogger(): { logger: ILogger; warns: unknown[][]; errors: unknown[][] } {
  const warns: unknown[][] = [];
  const errors: unknown[][] = [];
  const logger: ILogger = {
    level: LogLevel.Debug,
    setLevel: () => {},
    debug: () => {},
    info: () => {},
    warn: (...a: unknown[]) => void warns.push(a),
    error: (...a: unknown[]) => void errors.push(a),
    child: () => logger,
  };
  return { logger, warns, errors };
}

/** 常用夹具：en/zh 两张表 + fake logger。 */
function make(): { i18n: I18n; warns: unknown[][] } {
  const { logger, warns } = fakeLogger();
  const i18n = createI18n({
    locale: 'en',
    logger,
    tables: {
      en: { hello: 'Hi {name}', 'menu.start': 'Start' },
      zh: { hello: '你好 {name}', 'menu.start': '开始' },
    },
  });
  return { i18n, warns };
}

describe('I18n', () => {
  afterEach(() => {
    getRootContainer().unregister(I18N);
  });

  it('1. t：查当前 locale + {name} 插值', () => {
    const { i18n } = make();
    expect(i18n.t('menu.start')).toBe('Start');
    expect(i18n.t('hello', { name: 'Neo' })).toBe('Hi Neo');
  });

  it('2. 插值：数字转字符串，缺参数保留占位符', () => {
    const { i18n } = make();
    i18n.addTable('en', { score: 'Score: {n}' });
    expect(i18n.t('score', { n: 42 })).toBe('Score: 42');
    expect(i18n.t('score')).toBe('Score: {n}'); // 无 params
    expect(i18n.t('score', { other: 1 })).toBe('Score: {n}'); // 参数不含 n
  });

  it('3. setLocale：切换后 t 走新语言 + 广播 onChange', () => {
    const { i18n } = make();
    const seen: string[] = [];
    i18n.onChange((loc) => void seen.push(loc));
    i18n.setLocale('zh');
    expect(i18n.locale).toBe('zh');
    expect(i18n.t('menu.start')).toBe('开始');
    expect(seen).toEqual(['zh']);
  });

  it('4. setLocale：空串告警 no-op；与当前相同不重复广播', () => {
    const { i18n, warns } = make();
    const seen: string[] = [];
    i18n.onChange((loc) => void seen.push(loc));
    i18n.setLocale('');
    expect(warns.length).toBe(1);
    expect(i18n.locale).toBe('en');
    i18n.setLocale('en'); // 同当前
    expect(seen).toEqual([]);
  });

  it('5. setLocale：切到无表 locale 告警但仍切换', () => {
    const { i18n, warns } = make();
    i18n.setLocale('fr');
    expect(i18n.locale).toBe('fr');
    expect(warns.some((w) => String(w[0]).includes('fr'))).toBe(true);
  });

  it('6. fallback：当前缺 key 时回退到 fallbackLocale', () => {
    const { logger } = fakeLogger();
    const i18n = createI18n({
      locale: 'zh',
      fallbackLocale: 'en',
      logger,
      tables: { en: { only_en: 'English only' }, zh: {} },
    });
    expect(i18n.fallbackLocale).toBe('en');
    expect(i18n.t('only_en')).toBe('English only'); // zh 无 → 回退 en
  });

  it('7. 缺翻译：返回 key 本身 + 去重告警（每 locale|key 一次）', () => {
    const { i18n, warns } = make();
    expect(i18n.t('nope')).toBe('nope');
    expect(i18n.t('nope')).toBe('nope'); // 再查不重复告警
    expect(warns.filter((w) => String(w[0]).includes('缺翻译')).length).toBe(1);
    i18n.setLocale('zh');
    expect(i18n.t('nope')).toBe('nope'); // 换 locale 后同 key 再告警一次
    expect(warns.filter((w) => String(w[0]).includes('缺翻译')).length).toBe(2);
  });

  it('8. addTable：默认 merge 叠加，merge=false 整表替换', () => {
    const { i18n } = make();
    i18n.addTable('en', { extra: 'X' }); // merge
    expect(i18n.t('extra')).toBe('X');
    expect(i18n.t('menu.start')).toBe('Start'); // 原键仍在
    i18n.addTable('en', { fresh: 'Y' }, false); // 替换
    expect(i18n.t('fresh')).toBe('Y');
    expect(i18n.has('menu.start')).toBe(false); // 原键没了
  });

  it('9. addTable：嵌套对象自动拍平为点键 + 数字转串', () => {
    const { logger } = fakeLogger();
    const i18n = createI18n({ logger });
    i18n.addTable('en', { menu: { start: 'Start', level: 3 }, title: 'T' });
    expect(i18n.t('menu.start')).toBe('Start');
    expect(i18n.t('menu.level')).toBe('3');
    expect(i18n.t('title')).toBe('T');
  });

  it('10. addTable：非法叶子（数组/布尔/null）告警跳过', () => {
    const { logger, warns } = fakeLogger();
    const i18n = createI18n({ logger });
    i18n.addTable('en', { arr: [1, 2], flag: true, nul: null, ok: 'good' } as never);
    expect(i18n.t('ok')).toBe('good');
    expect(i18n.has('arr')).toBe(false);
    expect(warns.length).toBe(3); // arr / flag / nul 各告警
  });

  it('11. addTable：空 locale 告警忽略', () => {
    const { i18n, warns } = make();
    i18n.addTable('', { a: 'b' });
    expect(warns.length).toBe(1);
  });

  it('12. has：只查指定/当前 locale，不查 fallback', () => {
    const { logger } = fakeLogger();
    const i18n = createI18n({
      locale: 'zh',
      fallbackLocale: 'en',
      logger,
      tables: { en: { only_en: 'X' }, zh: { z: '1' } },
    });
    expect(i18n.has('z')).toBe(true); // 当前 zh
    expect(i18n.has('only_en')).toBe(false); // 当前 zh 无（不查 fallback）
    expect(i18n.has('only_en', 'en')).toBe(true); // 指定 en
    expect(i18n.has('x', 'unknown_locale')).toBe(false); // 无该表
  });

  it('13. availableLocales：列出已注册表', () => {
    const { i18n } = make();
    expect(i18n.availableLocales().sort()).toEqual(['en', 'zh']);
    i18n.addTable('fr', { a: 'b' });
    expect(i18n.availableLocales().sort()).toEqual(['en', 'fr', 'zh']);
  });

  it('14. onChange：返回的 Disposer 可取消订阅', () => {
    const { i18n } = make();
    const seen: string[] = [];
    const off = i18n.onChange((loc) => void seen.push(loc));
    i18n.setLocale('zh');
    off();
    i18n.setLocale('en');
    expect(seen).toEqual(['zh']); // 取消后不再收到
  });

  it('15. onChange：回调抛错被隔离 + 告警，不影响其它订阅', () => {
    const { i18n, warns } = make();
    const seen: string[] = [];
    i18n.onChange(() => {
      throw new Error('boom');
    });
    i18n.onChange((loc) => void seen.push(loc));
    i18n.setLocale('zh');
    expect(seen).toEqual(['zh']); // 第二个订阅仍收到
    expect(warns.some((w) => String(w[0]).includes('回调抛错'))).toBe(true);
  });

  it('16. fallbackLocale 默认等于初始 locale', () => {
    const i18n = createI18n({ locale: 'ja', logger: fakeLogger().logger });
    expect(i18n.fallbackLocale).toBe('ja');
  });

  it('17. getI18n：I18N token 优先，未注册回退进程默认（单例）', () => {
    const a = getI18n();
    expect(a).toBeTruthy();
    expect(getI18n()).toBe(a); // 进程默认单例
    const custom = createI18n({ logger: fakeLogger().logger });
    getRootContainer().register(I18N, { useValue: custom });
    expect(getI18n()).toBe(custom);
  });

  it('18. 默认 locale 为 en', () => {
    const i18n = createI18n();
    expect(i18n.locale).toBe('en');
  });

  it('19. removeTable：给定 keys 只删这些点键，其余保留', () => {
    const { i18n } = make();
    i18n.addTable('en', { 'shop.title': 'Shop', 'shop.buy': 'Buy' });
    i18n.removeTable('en', ['shop.title', 'shop.buy']);
    expect(i18n.has('shop.title')).toBe(false);
    expect(i18n.has('shop.buy')).toBe(false);
    expect(i18n.t('menu.start')).toBe('Start'); // 原有键仍在
    expect(i18n.availableLocales().sort()).toEqual(['en', 'zh']); // en 非空，仍在
  });

  it('20. removeTable：省略 keys 删整个 locale 表', () => {
    const { i18n } = make();
    i18n.removeTable('zh');
    expect(i18n.has('menu.start', 'zh')).toBe(false);
    expect(i18n.availableLocales()).toEqual(['en']);
  });

  it('21. removeTable：删空后移除该 locale；空/未知 locale 安全', () => {
    const { logger, warns } = fakeLogger();
    const i18n = createI18n({ logger, tables: { en: { a: '1', b: '2' } } });
    i18n.removeTable('en', ['a', 'b']); // 删空 → en 整表移除
    expect(i18n.availableLocales()).toEqual([]);
    i18n.removeTable('nope', ['x']); // 未知 locale 静默 no-op
    expect(warns.length).toBe(0);
    i18n.removeTable(''); // 空 locale 告警
    expect(warns.length).toBe(1);
  });
});

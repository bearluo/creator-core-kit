import { afterEach, describe, expect, it } from 'vitest';
import { settings } from 'cc';

/** `__clear` 是 vitest 那份 cc 替身独有的（真 `settings` 没有）—— 每条用例之间清干净注入值。 */
const mockSettings = settings as unknown as { __clear(): void };
import { buildValue } from '../../assets/boot/build-config';

/**
 * 构建期注入的取值规则。值得有测试是因为**三条路径的失败都是静默的**：
 * 没注入时不回退 → 预览直接崩；注入了不生效 → 出的包连错服；空串当有效值 →
 * 面板上手滑清空一个输入框，包里就带了个空 dispatcher 地址。三条都没有报错。
 */
describe('buildValue', () => {
  afterEach(() => {
    mockSettings.__clear();
  });

  it('没注入 → 用 fallback（这就是编辑器预览走的路）', () => {
    expect(buildValue('vest', 'base')).toBe('base');
  });

  it('注入了 → 用注入值', () => {
    settings.overrideSettings('cck', 'vest', 'vest');
    expect(buildValue('vest', 'base')).toBe('vest');
  });

  it('空串 = 没配 —— 面板上留空是「跟随源码默认」，不是「我要一个空值」', () => {
    settings.overrideSettings('cck', 'dispatcherUrl', '');
    expect(buildValue('dispatcherUrl', 'http://a/api/Handshake')).toBe('http://a/api/Handshake');
  });

  it('只认 cck 段 —— 别的段同名 key 不该串进来', () => {
    settings.overrideSettings('engine', 'vest', 'wrong');
    expect(buildValue('vest', 'base')).toBe('base');
  });

  it('六个可注入字段各走各的 key，不互相覆盖', () => {
    // 插件 options 的键与 BuildKey 对不上时没有编译期报错（插件是 JS），这条是那份契约的
    // 唯一守卫：改 BuildKey 就会在这里被提醒同步 `extensions/cck-build/builder.js`。
    const keys = ['vest', 'appId', 'version', 'channel', 'env', 'dispatcherUrl'] as const;
    for (const k of keys) settings.overrideSettings('cck', k, `v-${k}`);
    for (const k of keys) expect(buildValue(k, 'fallback')).toBe(`v-${k}`);
  });
});

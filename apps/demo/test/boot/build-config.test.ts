import { afterEach, describe, expect, it } from 'vitest';
import { settings } from 'cc';

/** `__clear` 是 vitest 那份 cc 替身独有的（真 `settings` 没有）—— 每条用例之间清干净注入值。 */
const mockSettings = settings as unknown as { __clear(): void };
import { buildValue, type BuildKey } from '../../assets/boot/build-config';

/** `BuildKey` 编译期就擦除了，运行时要对账得有一份值 —— 少一个会被下面那条对账用例逮到。 */
const KEYS: readonly BuildKey[] = [
  'vest',
  'appId',
  'version',
  'channel',
  'env',
  'dispatcherUrl',
  'accountLoginUrl',
];

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

  it('每个可注入字段各走各的 key，不互相覆盖', () => {
    for (const k of KEYS) settings.overrideSettings('cck', k, `v-${k}`);
    for (const k of KEYS) expect(buildValue(k, 'fallback')).toBe(`v-${k}`);
  });

  it('BuildKey 与构建插件的 options 键**逐个对账**', async () => {
    // 插件是 JS（编辑器扩展不进 TS 编译链），两边对不上**没有编译期报错**，只表现为
    // 「面板上填了但不生效」—— 出的包连错服，而且一声不吭。所以这里真的去读插件那份声明，
    // 而不是在测试里再抄一遍键名（抄一遍只能守住「我记得改测试」，守不住插件）。
    // @ts-expect-error 插件是纯 JS、没有 .d.ts —— 这正是本条用例存在的理由，别为它加 allowJs
    const plugin = (await import('../../extensions/cck-build/builder.js')) as unknown as {
      configs: Record<string, { options: Record<string, unknown> }>;
    };
    expect(Object.keys(plugin.configs['*'].options).sort()).toEqual(Array.from(KEYS).sort());
  });
});

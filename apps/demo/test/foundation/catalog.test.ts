import { beforeEach, describe, expect, it } from 'vitest';
import { clearUIRegistry, getUIDef, resolveUIDef, type UIVariant } from '@cck/core';
import { MODULE_CATALOG, registerCatalogUIs, skinBundle } from '../../assets/foundation/catalog';

/**
 * 马甲换皮的解析规则。值得有测试是因为**写错了不会报错**——只会在某个马甲上悄悄加载错包，
 * 本地那套皮跑得好好的。
 */
describe('skinBundle', () => {
  const v = (skin: string): UIVariant => ({ orientation: 'portrait', skin });

  it('皮包名 = skin-<马甲>-<跟随者>', () => {
    expect(skinBundle('foundation')(v('base'))).toBe('skin-base-foundation');
    expect(skinBundle('mail')(v('vest'))).toBe('skin-vest-mail');
  });

  it('一个跟随者一个包 —— 这是「不下载没用到的模块的皮」的全部机制', () => {
    // 两个跟随者解析出同一个包名，就等于又退回「一个马甲一个大皮包」：
    // 启动装地基皮时会把所有模块的脸一起拽下来。
    const names = new Set(['foundation', 'lobby', 'mail'].map((o) => skinBundle(o)(v('base'))));
    expect(names.size).toBe(3);
  });

  it('demo 自己也是一个马甲 —— 它的皮不享受任何特殊待遇', () => {
    // 一旦这里出现「某个值走另一条路」的分支，地基里就又混进脸了，见 skinBundle 的注释。
    expect(skinBundle('foundation')(v('base'))).toBe(`skin-${'base'}-foundation`);
  });

  it('换的是包不是界面 —— 各套皮里的 prefab 同名同路径', () => {
    // 守住「同名 prefab 放不同 bundle」这个前提：解析只动 bundle，prefab 名不参与。
    expect(skinBundle('lobby')(v('vest'))).not.toContain('/');
  });
});

describe('registerCatalogUIs · 换皮登记', () => {
  const v = (skin: string): UIVariant => ({ orientation: 'portrait', skin });

  beforeEach(() => {
    clearUIRegistry();
    registerCatalogUIs();
  });

  it('登记了 skinned 的模块从自己的皮包取脸', () => {
    const def = getUIDef('mail')!;
    expect(resolveUIDef(def, v('base'))).toEqual({ bundle: 'skin-base-mail', prefab: 'Mail' });
    expect(resolveUIDef(def, v('vest')).bundle).toBe('skin-vest-mail');
  });

  it('没登记的模块脸还在自己的模块包里 —— 所有马甲同一张', () => {
    const def = getUIDef('shop')!;
    expect(resolveUIDef(def, v('vest')).bundle).toBe('shop');
  });

  it('登录界面跟着地基走（启动路径上的第一张脸，随 shared 常驻）', () => {
    const def = getUIDef('login')!;
    expect(resolveUIDef(def, v('vest'))).toEqual({
      bundle: 'skin-vest-foundation',
      prefab: 'login/Login',
    });
  });

  it('每个 skinned 模块的皮包名都由自己的 id 决定 —— 不共包', () => {
    const skinned = MODULE_CATALOG.filter((e) => e.skinned);
    expect(skinned.length).toBeGreaterThan(0);
    for (const e of skinned) {
      expect(resolveUIDef(getUIDef(e.id)!, v('base')).bundle).toBe(`skin-base-${e.id}`);
    }
  });
});

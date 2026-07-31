import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createUIManager,
  getUIManager,
  UI_MANAGER,
} from '../ui-manager';
import {
  clearUIRegistry,
  getUIDef,
  registerUI,
  resolveUIDef,
  UI_LAYERS,
  type UILayer,
} from '../ui-registry';
import { UI_VIEW, type IUIView, type UIViewSpec } from '../ui-view';
import { getRootContainer } from '../../di';
import { LogLevel, type ILogger } from '../../logging';

function fakeLogger(): { logger: ILogger; warns: unknown[][] } {
  const warns: unknown[][] = [];
  const logger: ILogger = {
    level: LogLevel.Debug,
    setLevel: () => {},
    debug: () => {},
    info: () => {},
    warn: (...a: unknown[]) => void warns.push(a),
    error: () => {},
    child: () => logger,
  };
  return { logger, warns };
}

/** 可控 spy IUIView：记录调用；auto=false 时 create 挂起，由 flush 结算；fail=true 时 create reject。 */
function makeView() {
  const creates: UIViewSpec[] = [];
  const destroys: number[] = [];
  const restacks: Array<{ layer: UILayer; handles: readonly number[] }> = [];
  const states = new Map<number, unknown>();
  const pending: Array<{ resolve: (h: number) => void; reject: (e: unknown) => void }> = [];
  let auto = true;
  let fail = false;
  let next = 100;
  const view: IUIView = {
    create(spec: UIViewSpec): Promise<number> {
      creates.push(spec);
      if (fail) return Promise.reject(new Error('create failed'));
      if (auto) return Promise.resolve(next++);
      return new Promise<number>((resolve, reject) => pending.push({ resolve, reject }));
    },
    destroy: (h: number) => void destroys.push(h),
    saveState: (h: number) => states.get(h),
    restack: (layer, handles) => void restacks.push({ layer, handles: [...handles] }),
  };
  return {
    view,
    creates,
    destroys,
    restacks,
    /** 给某 handle 预置「界面自存状态」，验证重建时的取/回灌。 */
    setState: (h: number, s: unknown) => void states.set(h, s),
    setAuto: (v: boolean) => void (auto = v),
    setFail: (v: boolean) => void (fail = v),
    flush: () => {
      const ps = [...pending];
      pending.length = 0;
      ps.forEach((p) => p.resolve(next++));
    },
  };
}

beforeEach(() => {
  clearUIRegistry();
});

afterEach(() => {
  getRootContainer().unregister(UI_MANAGER);
  getRootContainer().unregister(UI_VIEW);
});

describe('UIManager · 打开', () => {
  it('1. open 经 view 创建并跟踪，默认层 ui', async () => {
    const v = makeView();
    registerUI('panel/settings', { prefab: 'panel/settings' });
    const ui = createUIManager({ view: v.view });
    expect(await ui.open('panel/settings')).toBe(true);
    expect(ui.isOpen('panel/settings')).toBe(true);
    expect(ui.layerOf('panel/settings')).toBe('ui');
    expect(ui.layerOf('nope')).toBeUndefined();
    expect(v.creates[0]).toEqual({
      uiId: 'panel/settings',
      prefab: 'panel/settings',
      layer: 'ui',
      args: undefined,
      bundle: undefined,
      state: undefined,
    });
  });

  it('2. 注册表决定 layer/prefab（调用点只给 uiId）', async () => {
    const v = makeView();
    registerUI('hud', { layer: 'hud', prefab: 'ui/hud.prefab' });
    const ui = createUIManager({ view: v.view });
    await ui.open('hud');
    expect(v.creates[0]).toMatchObject({ layer: 'hud', prefab: 'ui/hud.prefab' });
    expect(ui.layerOf('hud')).toBe('hud');
  });

  it('3. open 透传 args', async () => {
    const v = makeView();
    registerUI('dlg', { prefab: 'dlg' });
    const ui = createUIManager({ view: v.view });
    await ui.open('dlg', { reward: 100 });
    expect(v.creates[0].args).toEqual({ reward: 100 });
  });

  it('4. 层内单实例：已打开再 open 不重复建', async () => {
    const v = makeView();
    registerUI('dlg', { prefab: 'dlg' });
    const ui = createUIManager({ view: v.view });
    await ui.open('dlg');
    expect(await ui.open('dlg')).toBe(true);
    expect(v.creates).toHaveLength(1);
  });

  it('5. 并发 open 同 uiId 复用同一 inflight（去重）', async () => {
    const v = makeView();
    v.setAuto(false);
    registerUI('dlg', { prefab: 'dlg' });
    const ui = createUIManager({ view: v.view });
    const p1 = ui.open('dlg');
    const p2 = ui.open('dlg');
    expect(v.creates).toHaveLength(1);
    v.flush();
    expect(await Promise.all([p1, p2])).toEqual([true, true]);
  });

  it('6. create 失败 → false 且不跟踪', async () => {
    const v = makeView();
    v.setFail(true);
    registerUI('bad', { prefab: 'bad' });
    const { logger, warns } = fakeLogger();
    const ui = createUIManager({ view: v.view, logger });
    expect(await ui.open('bad')).toBe(false);
    expect(ui.isOpen('bad')).toBe(false);
    expect(warns).toHaveLength(1);
  });

  it('16. 注册表带 bundle → 透传到 view.create（模块从自带 bundle 开面板）', async () => {
    const v = makeView();
    registerUI('shop/panel', { prefab: 'shop/panel', bundle: 'shop' });
    const ui = createUIManager({ view: v.view });
    await ui.open('shop/panel');
    expect(v.creates[0]).toMatchObject({ uiId: 'shop/panel', prefab: 'shop/panel', bundle: 'shop' });
  });

  it('17. 未注册 → warn + false，且不跟踪、不调 view', async () => {
    const v = makeView();
    const { logger, warns } = fakeLogger();
    const ui = createUIManager({ view: v.view, logger });
    expect(await ui.open('ghost')).toBe(false);
    expect(ui.isOpen('ghost')).toBe(false);
    expect(v.creates).toHaveLength(0);
    expect(warns).toHaveLength(1);
  });
});

describe('UIManager · 关闭', () => {
  it('7. close 打开的 UI → 销毁 + 不再跟踪', async () => {
    const v = makeView();
    registerUI('dlg', { prefab: 'dlg' });
    const ui = createUIManager({ view: v.view });
    await ui.open('dlg'); // view handle 100
    expect(ui.close('dlg')).toBe(true);
    expect(v.destroys).toEqual([100]);
    expect(ui.isOpen('dlg')).toBe(false);
  });

  it('8. close 未跟踪 → false，无销毁', () => {
    const v = makeView();
    const ui = createUIManager({ view: v.view });
    expect(ui.close('nope')).toBe(false);
    expect(v.destroys).toEqual([]);
  });

  it('9. 加载中 close：create 落地即销毁，不回填', async () => {
    const v = makeView();
    v.setAuto(false);
    registerUI('dlg', { prefab: 'dlg' });
    const ui = createUIManager({ view: v.view });
    const p = ui.open('dlg');
    expect(ui.close('dlg')).toBe(true); // 加载中先 close
    expect(v.destroys).toEqual([]); // 还没建好，暂无销毁
    v.flush(); // create 落地
    expect(await p).toBe(false);
    expect(v.destroys).toEqual([100]); // 刚建好的节点被销毁
    expect(ui.isOpen('dlg')).toBe(false);
  });

  it('10. closeLayer 只关该层', async () => {
    const v = makeView();
    registerUI('a', { layer: 'hud', prefab: 'a' });
    registerUI('b', { layer: 'popup', prefab: 'b' });
    registerUI('c', { layer: 'hud', prefab: 'c' });
    const ui = createUIManager({ view: v.view });
    await ui.open('a');
    await ui.open('b');
    await ui.open('c');
    ui.closeLayer('hud');
    expect(ui.list()).toEqual(['b']);
  });

  it('11. closeAll 关全部', async () => {
    const v = makeView();
    registerUI('a', { prefab: 'a' });
    registerUI('b', { layer: 'popup', prefab: 'b' });
    const ui = createUIManager({ view: v.view });
    await ui.open('a');
    await ui.open('b');
    ui.closeAll();
    expect(ui.list()).toEqual([]);
  });

  it('12. list 升序', async () => {
    const v = makeView();
    for (const id of ['z', 'a', 'm']) registerUI(id, { prefab: id });
    const ui = createUIManager({ view: v.view });
    await ui.open('z');
    await ui.open('a');
    await ui.open('m');
    expect(ui.list()).toEqual(['a', 'm', 'z']);
  });
});

describe('UIManager · DI', () => {
  it('13. getUIManager 单例；register UI_MANAGER 可覆盖', () => {
    const a = getUIManager();
    expect(getUIManager()).toBe(a);
    const custom = createUIManager({ view: makeView().view });
    getRootContainer().register(UI_MANAGER, { useValue: custom });
    expect(getUIManager()).toBe(custom);
  });

  it('14. 无 UI_VIEW 注册时回退空渲染层', async () => {
    registerUI('a', { prefab: 'a' });
    const ui = createUIManager();
    expect(await ui.open('a')).toBe(true);
    expect(ui.close('a')).toBe(true);
  });

  it('15. tryResolve(UI_VIEW) 生效路径', async () => {
    const v = makeView();
    registerUI('a', { prefab: 'a' });
    getRootContainer().register(UI_VIEW, { useValue: v.view });
    const ui = createUIManager(); // 不传 view → 走 DI
    await ui.open('a');
    expect(v.creates).toHaveLength(1);
  });
});

describe('UI 注册表 · 变体解析', () => {
  const portrait = { orientation: 'portrait', skin: 'default' } as const;
  const landscape = { orientation: 'landscape', skin: 'default' } as const;

  it('18. registerUI / getUIDef；同 id 重复注册后者覆盖', () => {
    registerUI('shop', { prefab: 'Shop' });
    registerUI('shop', { prefab: 'Shop2', layer: 'popup' });
    expect(getUIDef('shop')).toMatchObject({ prefab: 'Shop2', layer: 'popup' });
    expect(getUIDef('nope')).toBeUndefined();
  });

  it('19. resolveUIDef：字符串形态原样返回', () => {
    expect(resolveUIDef({ prefab: 'Shop', bundle: 'shop' }, portrait)).toEqual({
      prefab: 'Shop',
      bundle: 'shop',
    });
    expect(resolveUIDef({ prefab: 'Shop' }, portrait)).toEqual({ prefab: 'Shop', bundle: undefined });
  });

  it('20. resolveUIDef：prefab 函数 = 横竖屏换 view', () => {
    const def = {
      bundle: 'shop',
      prefab: (v: { orientation: string }) => (v.orientation === 'landscape' ? 'Shop_land' : 'Shop'),
    };
    expect(resolveUIDef(def, portrait).prefab).toBe('Shop');
    expect(resolveUIDef(def, landscape).prefab).toBe('Shop_land');
  });

  it('21. resolveUIDef：bundle 函数 = 整包换皮', () => {
    const def = {
      prefab: 'Shop',
      bundle: (v: { skin: string }) => (v.skin === 'newyear' ? 'shop-newyear' : 'shop'),
    };
    expect(resolveUIDef(def, portrait).bundle).toBe('shop');
    expect(resolveUIDef(def, { orientation: 'portrait', skin: 'newyear' }).bundle).toBe('shop-newyear');
  });

  it('22. UI_LAYERS 自下而上、ui 在中段、去重', () => {
    expect(new Set(UI_LAYERS).size).toBe(UI_LAYERS.length);
    expect(UI_LAYERS.indexOf('back')).toBe(0);
    expect(UI_LAYERS.indexOf('hud')).toBeLessThan(UI_LAYERS.indexOf('ui'));
    expect(UI_LAYERS.indexOf('ui')).toBeLessThan(UI_LAYERS.indexOf('popup'));
    expect(UI_LAYERS.indexOf('popup')).toBeLessThan(UI_LAYERS.indexOf('dialog'));
    expect(UI_LAYERS.indexOf('dialog')).toBeLessThan(UI_LAYERS.indexOf('guide'));
    expect(UI_LAYERS[UI_LAYERS.length - 1]).toBe('top');
  });
});

describe('UIManager · 变体切换（按需重建）', () => {
  const landscapePrefab = (v: { orientation: string }) =>
    v.orientation === 'landscape' ? 'Shop_land' : 'Shop';

  it('23. 解析结果不变 → 完全不 destroy/create（转屏对普通界面零成本）', async () => {
    const v = makeView();
    registerUI('plain', { prefab: 'Plain' }); // 与变体无关
    const ui = createUIManager({ view: v.view });
    await ui.open('plain');
    v.creates.length = 0;
    await ui.setVariant({ orientation: 'landscape' });
    expect(v.creates).toEqual([]);
    expect(v.destroys).toEqual([]);
    expect(v.restacks).toEqual([]);
    expect(ui.variant().orientation).toBe('landscape');
  });

  it('24. prefab 解析变了 → saveState → destroy → create，state 原样回灌', async () => {
    const v = makeView();
    registerUI('shop', { bundle: 'shop', prefab: landscapePrefab });
    const ui = createUIManager({ view: v.view });
    await ui.open('shop', { from: 'lobby' });
    v.setState(100, { scroll: 42 });
    await ui.setVariant({ orientation: 'landscape' });
    expect(v.destroys).toEqual([100]);
    expect(v.creates[1]).toMatchObject({
      uiId: 'shop',
      prefab: 'Shop_land',
      bundle: 'shop',
      args: { from: 'lobby' }, // 首次 open 的 args 一并带回
      state: { scroll: 42 },
    });
    expect(ui.isOpen('shop')).toBe(true);
  });

  it('25. bundle 解析变了（整包换皮）同样重建', async () => {
    const v = makeView();
    registerUI('shop', {
      prefab: 'Shop',
      bundle: (x: { skin: string }) => (x.skin === 'newyear' ? 'shop-newyear' : 'shop'),
    });
    const ui = createUIManager({ view: v.view });
    await ui.open('shop');
    await ui.setVariant({ skin: 'newyear' });
    expect(v.destroys).toEqual([100]);
    expect(v.creates[1]).toMatchObject({ prefab: 'Shop', bundle: 'shop-newyear' });
  });

  it('26. 多界面共存 → 只重建该重建的', async () => {
    const v = makeView();
    registerUI('plain', { prefab: 'Plain' });
    registerUI('shop', { prefab: landscapePrefab });
    const ui = createUIManager({ view: v.view });
    await ui.open('plain'); // 100
    await ui.open('shop'); // 101
    await ui.setVariant({ orientation: 'landscape' });
    expect(v.destroys).toEqual([101]);
    expect(v.creates.map((c) => c.prefab)).toEqual(['Plain', 'Shop', 'Shop_land']);
  });

  it('27. 重建后按账本顺序 restack 受影响的层', async () => {
    const v = makeView();
    registerUI('a', { layer: 'popup', prefab: 'A' }); // 100，不重建
    registerUI('b', { layer: 'popup', prefab: landscapePrefab }); // 101 → 重建成 102
    registerUI('c', { layer: 'popup', prefab: 'C' }); // 102?→ 见下
    const ui = createUIManager({ view: v.view });
    await ui.open('a'); // 100
    await ui.open('b'); // 101
    await ui.open('c'); // 102
    await ui.setVariant({ orientation: 'landscape' });
    // b 重建成 103，但层内顺序仍须是账本顺序 a,b,c
    expect(v.restacks).toEqual([{ layer: 'popup', handles: [100, 103, 102] }]);
  });

  it('28. 同值 setVariant → 完全 no-op', async () => {
    const v = makeView();
    registerUI('shop', { prefab: landscapePrefab });
    const ui = createUIManager({ view: v.view });
    await ui.open('shop');
    await ui.setVariant({ orientation: 'portrait' }); // 与初始同值
    await ui.setVariant({}); // 空 patch
    expect(v.creates).toHaveLength(1);
    expect(v.destroys).toEqual([]);
  });

  it('29. 变体切换后再 open 用新变体解析', async () => {
    const v = makeView();
    registerUI('shop', { prefab: landscapePrefab });
    const ui = createUIManager({ view: v.view });
    await ui.setVariant({ orientation: 'landscape' });
    await ui.open('shop');
    expect(v.creates[0].prefab).toBe('Shop_land');
  });

  it('30. 重建时 create 失败 → 摘掉登记 + warn，不留幽灵条目', async () => {
    const v = makeView();
    const { logger, warns } = fakeLogger();
    registerUI('shop', { prefab: landscapePrefab });
    const ui = createUIManager({ view: v.view, logger });
    await ui.open('shop');
    v.setFail(true);
    await ui.setVariant({ orientation: 'landscape' });
    expect(ui.isOpen('shop')).toBe(false);
    expect(warns).toHaveLength(1);
  });

  it('31. 变体切换先等加载中的界面落地', async () => {
    const v = makeView();
    v.setAuto(false);
    registerUI('shop', { prefab: landscapePrefab });
    const ui = createUIManager({ view: v.view });
    const p = ui.open('shop');
    const sv = ui.setVariant({ orientation: 'landscape' });
    v.setAuto(true);
    v.flush(); // 首建落地 → setVariant 继续往下重建
    await p;
    await sv;
    expect(v.creates.map((c) => c.prefab)).toEqual(['Shop', 'Shop_land']);
    expect(v.destroys).toEqual([100]);
  });

  it('32. closeByBundle 只关解析后 bundle 命中的界面', async () => {
    const v = makeView();
    registerUI('shop', { prefab: 'Shop', bundle: 'shop' });
    registerUI('bag', { prefab: 'Bag', bundle: 'bag' });
    registerUI('hud', { prefab: 'Hud' }); // 无 bundle → 任何名都不该命中
    const ui = createUIManager({ view: v.view });
    await ui.open('shop');
    await ui.open('bag');
    await ui.open('hud');
    ui.closeByBundle('shop');
    expect(ui.list()).toEqual(['bag', 'hud']);
    expect(v.destroys).toEqual([100]);
  });

  it('33. closeByBundle 对 resolver 型 bundle 按当前变体解析', async () => {
    const v = makeView();
    registerUI('shop', {
      prefab: 'Shop',
      bundle: (vr) => (vr.orientation === 'landscape' ? 'shop-land' : 'shop'),
    });
    const ui = createUIManager({ view: v.view });
    await ui.open('shop');
    ui.closeByBundle('shop-land'); // 当前竖屏 → 解析成 'shop'，不命中
    expect(ui.isOpen('shop')).toBe(true);
    await ui.setVariant({ orientation: 'landscape' });
    ui.closeByBundle('shop-land'); // 变体切了 → 命中
    expect(ui.isOpen('shop')).toBe(false);
  });

  it('34. closeByBundle 也关加载中的界面（落地即销毁，防泄漏）', async () => {
    const v = makeView();
    v.setAuto(false);
    registerUI('shop', { prefab: 'Shop', bundle: 'shop' });
    const ui = createUIManager({ view: v.view });
    const p = ui.open('shop');
    ui.closeByBundle('shop');
    expect(ui.isOpen('shop')).toBe(false);
    v.setAuto(true);
    v.flush();
    await p;
    expect(v.destroys).toHaveLength(1);
  });
});

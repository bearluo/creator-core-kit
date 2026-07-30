import { afterEach, describe, expect, it } from 'vitest';
import {
  createUIManager,
  getUIManager,
  UI_MANAGER,
} from '../ui-manager';
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
  };
  return {
    view,
    creates,
    destroys,
    setAuto: (v: boolean) => void (auto = v),
    setFail: (v: boolean) => void (fail = v),
    flush: () => {
      const ps = [...pending];
      pending.length = 0;
      ps.forEach((p) => p.resolve(next++));
    },
  };
}

afterEach(() => {
  getRootContainer().unregister(UI_MANAGER);
  getRootContainer().unregister(UI_VIEW);
});

describe('UIManager · 打开', () => {
  it('1. open 经 view 创建并跟踪，默认层 ui', async () => {
    const v = makeView();
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
    });
  });

  it('2. open 尊重 layer/prefab', async () => {
    const v = makeView();
    const ui = createUIManager({ view: v.view });
    await ui.open('hud', { layer: 'hud', prefab: 'ui/hud.prefab' });
    expect(v.creates[0]).toMatchObject({ layer: 'hud', prefab: 'ui/hud.prefab' });
    expect(ui.layerOf('hud')).toBe('hud');
  });

  it('3. open 透传 args', async () => {
    const v = makeView();
    const ui = createUIManager({ view: v.view });
    await ui.open('dlg', { args: { reward: 100 } });
    expect(v.creates[0].args).toEqual({ reward: 100 });
  });

  it('4. 层内单实例：已打开再 open 不重复建', async () => {
    const v = makeView();
    const ui = createUIManager({ view: v.view });
    await ui.open('dlg');
    expect(await ui.open('dlg')).toBe(true);
    expect(v.creates).toHaveLength(1);
  });

  it('5. 并发 open 同 uiId 复用同一 inflight（去重）', async () => {
    const v = makeView();
    v.setAuto(false);
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
    const { logger, warns } = fakeLogger();
    const ui = createUIManager({ view: v.view, logger });
    expect(await ui.open('bad')).toBe(false);
    expect(ui.isOpen('bad')).toBe(false);
    expect(warns).toHaveLength(1);
  });

  it('16. open 透传 bundle 到 view.create（模块从自带 bundle 开面板）', async () => {
    const v = makeView();
    const ui = createUIManager({ view: v.view });
    await ui.open('shop/panel', { bundle: 'shop' });
    expect(v.creates[0]).toMatchObject({ uiId: 'shop/panel', prefab: 'shop/panel', bundle: 'shop' });
  });
});

describe('UIManager · 关闭', () => {
  it('7. close 打开的 UI → 销毁 + 不再跟踪', async () => {
    const v = makeView();
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
    const ui = createUIManager({ view: v.view });
    await ui.open('a', { layer: 'hud' });
    await ui.open('b', { layer: 'popup' });
    await ui.open('c', { layer: 'hud' });
    ui.closeLayer('hud');
    expect(ui.list()).toEqual(['b']);
  });

  it('11. closeAll 关全部', async () => {
    const v = makeView();
    const ui = createUIManager({ view: v.view });
    await ui.open('a');
    await ui.open('b', { layer: 'popup' });
    ui.closeAll();
    expect(ui.list()).toEqual([]);
  });

  it('12. list 升序', async () => {
    const v = makeView();
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
    const ui = createUIManager();
    expect(await ui.open('a')).toBe(true);
    expect(ui.close('a')).toBe(true);
  });

  it('15. tryResolve(UI_VIEW) 生效路径', async () => {
    const v = makeView();
    getRootContainer().register(UI_VIEW, { useValue: v.view });
    const ui = createUIManager(); // 不传 view → 走 DI
    await ui.open('a');
    expect(v.creates).toHaveLength(1);
  });
});

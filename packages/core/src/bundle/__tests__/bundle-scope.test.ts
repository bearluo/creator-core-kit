import { describe, expect, it } from 'vitest';
import { createBundleScope, type BundleScopeDeps } from '../bundle-scope';
import type { ConfigTable } from '../../config';
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

/**
 * 记录**全局调用序**的 fake 依赖组。
 * 回收链的顺序是本模块的正确性核心（closeByBundle 必须最先、release 必须最后），
 * 所以所有依赖的调用都按序记进同一个数组，用它断言先后。
 */
function makeDeps() {
  const calls: string[] = [];
  const removed: Array<{ locale: string; keys?: readonly string[] }> = [];
  const jsons = new Map<string, unknown>();
  const deps: BundleScopeDeps = {
    ui: { closeByBundle: (b: string) => void calls.push(`ui.closeByBundle:${b}`) },
    bundles: { release: (b: string) => void calls.push(`bundle.release:${b}`) },
    assets: {
      load: <T>(path: string): Promise<T> => {
        calls.push(`asset.load:${path}`);
        return Promise.resolve((jsons.get(path) ?? {}) as T);
      },
      release: (path: string, o?: { bundle?: string }) =>
        void calls.push(`asset.release:${path}@${o?.bundle ?? '-'}`),
    },
    i18n: {
      addTable: (loc: string) => void calls.push(`i18n.addTable:${loc}`),
      removeTable: (loc: string, keys?: readonly string[]) => {
        calls.push(`i18n.removeTable:${loc}`);
        removed.push({ locale: loc, keys });
      },
    },
    tables: {
      register: <T>(name: string, rows: readonly T[]): ConfigTable<T> => {
        calls.push(`table.register:${name}`);
        return { name, rows } as unknown as ConfigTable<T>;
      },
      unregister: (name: string): boolean => {
        calls.push(`table.unregister:${name}`);
        return true;
      },
    },
  };
  return { deps, calls, removed, setJson: (p: string, v: unknown) => void jsons.set(p, v) };
}

describe('BundleScope', () => {
  it('1. dispose：closeByBundle 最先、bundle.release 最后', async () => {
    const d = makeDeps();
    d.setJson('t', { json: [{ id: 1 }] });
    const scope = createBundleScope('shop', d.deps);
    await scope.table('items', 't');
    await scope.load('Shop', 'prefab');
    d.calls.length = 0; // 只看回收段
    await scope.dispose();
    expect(d.calls[0]).toBe('ui.closeByBundle:shop');
    expect(d.calls[d.calls.length - 1]).toBe('bundle.release:shop');
  });

  it('2. 登记的 teardown 逆序执行', async () => {
    const d = makeDeps();
    const order: string[] = [];
    const scope = createBundleScope('shop', d.deps);
    scope.add(() => void order.push('first'));
    scope.add(() => void order.push('second'));
    await scope.dispose();
    expect(order).toEqual(['second', 'first']);
  });

  it('3. 单条 teardown 抛错 → 其余照常执行，整体不 reject', async () => {
    const d = makeDeps();
    const { logger, warns } = fakeLogger();
    const order: string[] = [];
    const scope = createBundleScope('shop', { ...d.deps, logger });
    scope.add(() => void order.push('a'));
    scope.add(() => {
      throw new Error('boom');
    });
    scope.add(() => void order.push('c'));
    await expect(scope.dispose()).resolves.toBeUndefined();
    expect(order).toEqual(['c', 'a']);
    expect(warns).toHaveLength(1);
    expect(d.calls).toContain('bundle.release:shop'); // 后续步骤没被中断
  });

  it('4. dispose 幂等：二次调用不重复回收', async () => {
    const d = makeDeps();
    const scope = createBundleScope('shop', d.deps);
    await scope.dispose();
    const n = d.calls.length;
    await scope.dispose();
    expect(d.calls).toHaveLength(n);
  });

  it('5. i18n：按精确键 removeTable，且 JSON 加载后即释放', async () => {
    const d = makeDeps();
    d.setJson('shop-i18n', { json: { 'shop.title': '商城', 'shop.desc': '买买买' } });
    const scope = createBundleScope('shop', d.deps);
    await scope.i18n('zh', 'shop-i18n');
    expect(d.calls).toEqual([
      'asset.load:shop-i18n',
      'i18n.addTable:zh',
      'asset.release:shop-i18n@shop',
    ]);
    await scope.dispose();
    expect(d.removed).toEqual([{ locale: 'zh', keys: ['shop.title', 'shop.desc'] }]);
  });

  it('6. table：register + dispose 时 unregister', async () => {
    const d = makeDeps();
    d.setJson('items.json', { json: [{ id: 1 }] });
    const scope = createBundleScope('shop', d.deps);
    const t = await scope.table('items', 'items.json');
    expect(t.name).toBe('items');
    await scope.dispose();
    expect(d.calls).toContain('table.unregister:items');
  });

  it('7. load：带 scope 的 bundle，dispose 时按同键 release', async () => {
    const d = makeDeps();
    const scope = createBundleScope('shop', d.deps);
    await scope.load('Shop', 'prefab');
    await scope.dispose();
    expect(d.calls).toContain('asset.release:Shop@shop');
  });

  it('8. i18n 表含嵌套值 → 告警（顶层键删不掉拍平后的 a.b，回收会不干净）', async () => {
    const d = makeDeps();
    const { logger, warns } = fakeLogger();
    d.setJson('shop-i18n', { json: { title: '商城', tip: { a: 'x' } } });
    const scope = createBundleScope('shop', { ...d.deps, logger });
    await scope.i18n('zh', 'shop-i18n');
    expect(warns).toHaveLength(1);
  });

  it('9. teardown 可以是 async，dispose 会 await 它再往下走', async () => {
    const d = makeDeps();
    const order: string[] = [];
    const scope = createBundleScope('shop', d.deps);
    scope.add(async () => {
      await Promise.resolve();
      order.push('slow');
    });
    await scope.dispose();
    expect(order).toEqual(['slow']);
    expect(d.calls[d.calls.length - 1]).toBe('bundle.release:shop');
  });

  it('10. bundle 名透出，便于调用点传给 UIManager / 日志', () => {
    const d = makeDeps();
    expect(createBundleScope('shop', d.deps).bundle).toBe('shop');
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import {
  createSaveManager,
  getSaveManager,
  SAVE_MANAGER,
  type SaveData,
  type SaveSerializer,
} from '../save-manager';
import { createMemoryStorage, STORAGE, type IStorage } from '../storage';
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

/** 新建一个用内存后端 + fake logger 的 SaveManager（多数用例的隔离夹具）。 */
function make(opts?: { version?: number; storage?: IStorage; serializer?: SaveSerializer }) {
  const { logger, warns } = fakeLogger();
  const storage = opts?.storage ?? createMemoryStorage();
  const sm = createSaveManager({
    storage,
    logger,
    version: opts?.version,
    serializer: opts?.serializer,
  });
  return { sm, storage, warns };
}

describe('SaveManager', () => {
  afterEach(() => {
    const root = getRootContainer();
    root.unregister(STORAGE);
    root.unregister(SAVE_MANAGER);
  });

  it('1. save→load 往返', async () => {
    const { sm } = make();
    expect(await sm.save('hero', { hp: 100, name: 'a' })).toBe(true);
    expect(await sm.load('hero')).toEqual({ hp: 100, name: 'a' });
  });

  it('2. load 不存在的 slot → null', async () => {
    const { sm } = make();
    expect(await sm.load('none')).toBeNull();
  });

  it('3. save 覆盖已存在 slot', async () => {
    const { sm } = make();
    await sm.save('s', { v: 1 });
    await sm.save('s', { v: 2 });
    expect(await sm.load('s')).toEqual({ v: 2 });
  });

  it('4. has：存在/不存在', async () => {
    const { sm } = make();
    expect(await sm.has('s')).toBe(false);
    await sm.save('s', {});
    expect(await sm.has('s')).toBe(true);
  });

  it('5. delete：删掉 true，不存在 false', async () => {
    const { sm } = make();
    await sm.save('s', {});
    expect(await sm.delete('s')).toBe(true);
    expect(await sm.has('s')).toBe(false);
    expect(await sm.delete('s')).toBe(false);
  });

  it('6. list：升序 + 命名空间前缀隔离', async () => {
    const storage = createMemoryStorage();
    const a = createSaveManager({ storage, namespace: 'gameA', logger: fakeLogger().logger });
    const b = createSaveManager({ storage, namespace: 'gameB', logger: fakeLogger().logger });
    await a.save('z', {});
    await a.save('a', {});
    await b.save('other', {});
    expect(await a.list()).toEqual(['a', 'z']); // 只看到自己命名空间、且升序
    expect(await b.list()).toEqual(['other']);
  });

  it('7. slot 名清洗：非法字符剔除，全非法 → 拒绝', async () => {
    const { sm } = make();
    // 'a/b!c' → 'abc'
    await sm.save('a/b!c', { ok: true });
    expect(await sm.load('abc')).toEqual({ ok: true });
    // 全非法 → 拒绝
    expect(await sm.save('///', {})).toBe(false);
    expect(await sm.load('///')).toBeNull();
    expect(await sm.has('///')).toBe(false);
    expect(await sm.delete('///')).toBe(false);
  });

  it('8. 版本信封：同版本直读', async () => {
    const storage = createMemoryStorage();
    const sm = createSaveManager({ storage, version: 5, logger: fakeLogger().logger });
    expect(sm.version).toBe(5);
    await sm.save('s', { x: 1 });
    expect(await sm.load('s')).toEqual({ x: 1 });
    // 落盘信封确带 _v
    const raw = await storage.get('save/s');
    expect(JSON.parse(raw as string)).toEqual({ _v: 5, data: { x: 1 } });
  });

  it('9. 迁移链：低版本存档按序升级', async () => {
    const storage = createMemoryStorage();
    await storage.set('save/hero', JSON.stringify({ _v: 1, data: { hp: 1 } }));
    const sm = createSaveManager({ storage, version: 3, logger: fakeLogger().logger });
    sm.registerMigration(1, (d) => ({ ...d, step1: true }));
    sm.registerMigration(2, (d) => ({ ...d, step2: true }));
    expect(await sm.load('hero')).toEqual({ hp: 1, step1: true, step2: true });
  });

  it('10. 缺迁移函数 → null + 告警', async () => {
    const storage = createMemoryStorage();
    await storage.set('save/hero', JSON.stringify({ _v: 1, data: {} }));
    const { logger, warns } = fakeLogger();
    const sm = createSaveManager({ storage, version: 2, logger });
    expect(await sm.load('hero')).toBeNull();
    expect(warns.length).toBe(1);
  });

  it('11. 未来版本（存档版本高于当前）→ null + 告警', async () => {
    const storage = createMemoryStorage();
    await storage.set('save/hero', JSON.stringify({ _v: 9, data: {} }));
    const { logger, warns } = fakeLogger();
    const sm = createSaveManager({ storage, version: 2, logger });
    expect(await sm.load('hero')).toBeNull();
    expect(warns.length).toBe(1);
  });

  it('12. 迁移函数返回非对象 → null + 告警', async () => {
    const storage = createMemoryStorage();
    await storage.set('save/hero', JSON.stringify({ _v: 1, data: {} }));
    const { logger, warns } = fakeLogger();
    const sm = createSaveManager({ storage, version: 2, logger });
    sm.registerMigration(1, () => null as unknown as SaveData);
    expect(await sm.load('hero')).toBeNull();
    expect(warns.length).toBe(1);
  });

  it('13. 损坏字节（非法 JSON / 信封非法）→ null', async () => {
    const storage = createMemoryStorage();
    await storage.set('save/bad', 'not-json{');
    await storage.set('save/bad2', JSON.stringify({ nope: 1 })); // 无 _v/data
    const sm = createSaveManager({ storage, logger: fakeLogger().logger });
    expect(await sm.load('bad')).toBeNull();
    expect(await sm.load('bad2')).toBeNull();
  });

  it('14. 序列化失败（循环引用）→ save false', async () => {
    const { sm } = make();
    const circular: SaveData = {};
    circular.self = circular;
    expect(await sm.save('c', circular)).toBe(false);
  });

  it('15. storage.get 抛错 → load 返回 null（不冒泡）', async () => {
    const failing: IStorage = {
      get: () => Promise.reject(new Error('io')),
      set: () => Promise.resolve(),
      remove: () => Promise.resolve(),
      keys: () => Promise.resolve([]),
    };
    const { sm } = make({ storage: failing });
    expect(await sm.load('x')).toBeNull();
  });

  it('16. 自定义序列化器', async () => {
    let encoded = 0;
    const serializer: SaveSerializer = {
      name: 'passthrough',
      encode: (v) => {
        encoded++;
        return JSON.stringify(v);
      },
      decode: (t) => JSON.parse(t) as unknown,
    };
    const { sm } = make({ serializer });
    await sm.save('s', { a: 1 });
    expect(encoded).toBe(1);
    expect(await sm.load('s')).toEqual({ a: 1 });
  });

  it('17. 默认从 DI STORAGE 取存储后端', async () => {
    const mem = createMemoryStorage();
    getRootContainer().register(STORAGE, { useValue: mem });
    const sm = createSaveManager({ logger: fakeLogger().logger }); // 不传 storage
    await sm.save('s', { fromDI: true });
    // 直接读底层 storage 证明用的就是注册的那个
    expect(await mem.get('save/s')).toBe(JSON.stringify({ _v: 1, data: { fromDI: true } }));
  });

  it('18. getSaveManager：SAVE_MANAGER token 优先，未注册回退默认', async () => {
    const fallback = getSaveManager();
    expect(fallback).toBeTruthy();
    const custom = createSaveManager({ logger: fakeLogger().logger });
    getRootContainer().register(SAVE_MANAGER, { useValue: custom });
    expect(getSaveManager()).toBe(custom);
  });

  it('19. registerMigration fromVersion<1 → 告警忽略', () => {
    const { logger, warns } = fakeLogger();
    const sm = createSaveManager({ storage: createMemoryStorage(), logger });
    sm.registerMigration(0, (d) => d);
    expect(warns.length).toBe(1);
  });

  it('20. storage.set 抛错 → save false（不冒泡）', async () => {
    const failing: IStorage = {
      get: () => Promise.resolve(null),
      set: () => Promise.reject(new Error('io')),
      remove: () => Promise.resolve(),
      keys: () => Promise.resolve([]),
    };
    const { sm } = make({ storage: failing });
    expect(await sm.save('x', {})).toBe(false);
  });

  it('21. createMemoryStorage(initial)：预置数据可读', async () => {
    const mem = createMemoryStorage({ k: 'v' });
    expect(await mem.get('k')).toBe('v');
    expect(await mem.keys()).toEqual(['k']);
  });

  it('22. version<1 收敛为默认 1', () => {
    const sm = createSaveManager({ storage: createMemoryStorage(), version: 0, logger: fakeLogger().logger });
    expect(sm.version).toBe(1);
  });
});

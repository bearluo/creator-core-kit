import { afterEach, describe, expect, it } from 'vitest';
import {
  createTable,
  createConfigTableManager,
  getConfigTables,
  CONFIG_TABLES,
  ConfigRowNotFoundError,
  ConfigTableNotFoundError,
} from '../config-table';
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

interface Hero {
  id: number;
  name: string;
  hp: number;
}

const HEROES: Hero[] = [
  { id: 1, name: 'a', hp: 100 },
  { id: 2, name: 'b', hp: 200 },
  { id: 3, name: 'c', hp: 100 },
];

describe('ConfigTable', () => {
  it('1. 默认主键 id：get / has / size / all / keys', () => {
    const t = createTable('hero', HEROES, { logger: fakeLogger().logger });
    expect(t.name).toBe('hero');
    expect(t.size).toBe(3);
    expect(t.get(2)).toEqual({ id: 2, name: 'b', hp: 200 });
    expect(t.get(99)).toBeUndefined();
    expect(t.has(1)).toBe(true);
    expect(t.has(99)).toBe(false);
    expect(t.keys()).toEqual([1, 2, 3]); // 插入顺序
    expect(t.all().map((r) => r.name)).toEqual(['a', 'b', 'c']);
  });

  it('2. getOrThrow：命中返回，未命中抛 ConfigRowNotFoundError', () => {
    const t = createTable('hero', HEROES, { logger: fakeLogger().logger });
    expect(t.getOrThrow(1).name).toBe('a');
    expect(() => t.getOrThrow(99)).toThrow(ConfigRowNotFoundError);
  });

  it('3. find / filter', () => {
    const t = createTable('hero', HEROES, { logger: fakeLogger().logger });
    expect(t.find((r) => r.hp === 200)?.name).toBe('b');
    expect(t.find((r) => r.hp === 999)).toBeUndefined();
    expect(t.filter((r) => r.hp === 100).map((r) => r.id)).toEqual([1, 3]);
  });

  it('4. 自定义字段主键', () => {
    const t = createTable('byName', HEROES, { key: 'name', logger: fakeLogger().logger });
    expect(t.get('b')).toEqual({ id: 2, name: 'b', hp: 200 });
    expect(t.keys()).toEqual(['a', 'b', 'c']);
  });

  it('5. 函数主键（复合/派生）', () => {
    const t = createTable('byComposite', HEROES, {
      key: (r) => `${r.name}#${r.id}`,
      logger: fakeLogger().logger,
    });
    expect(t.get('b#2')?.hp).toBe(200);
  });

  it('6. 重复主键：告警 + 后者覆盖', () => {
    const { logger, warns } = fakeLogger();
    const rows = [
      { id: 1, v: 'first' },
      { id: 1, v: 'second' },
    ];
    const t = createTable('dup', rows, { logger });
    expect(t.size).toBe(1);
    expect(t.get(1)?.v).toBe('second'); // last-wins
    expect(warns.some((w) => String(w[0]).includes('重复'))).toBe(true);
  });

  it('7. 非法主键（undefined/null/非 string|number）：告警 + 跳过该行', () => {
    const { logger, warns } = fakeLogger();
    const rows = [
      { id: 1, v: 'ok' },
      { id: undefined, v: 'skip1' },
      { id: null, v: 'skip2' },
      { id: { nested: true }, v: 'skip3' },
    ] as { id: unknown; v: string }[];
    const t = createTable('bad', rows, { logger });
    expect(t.size).toBe(1);
    expect(t.get(1)?.v).toBe('ok');
    expect(warns.length).toBe(3);
  });

  it('8. 空表', () => {
    const t = createTable<Hero>('empty', [], { logger: fakeLogger().logger });
    expect(t.size).toBe(0);
    expect(t.all()).toEqual([]);
    expect(t.keys()).toEqual([]);
    expect(t.find(() => true)).toBeUndefined();
    expect(t.filter(() => true)).toEqual([]);
  });
});

describe('ConfigTableManager', () => {
  afterEach(() => {
    getRootContainer().unregister(CONFIG_TABLES);
  });

  it('1. register / table / has / getRow / names', () => {
    const m = createConfigTableManager({ logger: fakeLogger().logger });
    m.register('hero', HEROES);
    expect(m.has('hero')).toBe(true);
    expect(m.table<Hero>('hero')?.get(1)?.name).toBe('a');
    expect(m.table('none')).toBeUndefined();
    expect(m.getRow<Hero>('hero', 2)?.hp).toBe(200);
    expect(m.getRow('hero', 99)).toBeUndefined();
    expect(m.getRow('none', 1)).toBeUndefined(); // 表不存在
    expect(m.names()).toEqual(['hero']);
  });

  it('2. add：放入已建好的表', () => {
    const m = createConfigTableManager({ logger: fakeLogger().logger });
    const t = createTable('hero', HEROES, { logger: fakeLogger().logger });
    m.add(t);
    expect(m.table<Hero>('hero')).toBe(t);
  });

  it('3. register / add 同名覆盖：告警', () => {
    const { logger, warns } = fakeLogger();
    const m = createConfigTableManager({ logger });
    m.register('hero', HEROES);
    m.register('hero', []); // 覆盖
    expect(m.table<Hero>('hero')?.size).toBe(0);
    expect(warns.some((w) => String(w[0]).includes('已存在'))).toBe(true);
    m.add(createTable('hero', HEROES, { logger: fakeLogger().logger })); // add 也覆盖
    expect(warns.filter((w) => String(w[0]).includes('已存在')).length).toBe(2);
  });

  it('4. tableOrThrow：未注册抛 ConfigTableNotFoundError', () => {
    const m = createConfigTableManager({ logger: fakeLogger().logger });
    m.register('hero', HEROES);
    expect(m.tableOrThrow<Hero>('hero').size).toBe(3);
    expect(() => m.tableOrThrow('none')).toThrow(ConfigTableNotFoundError);
  });

  it('5. clear：清空全部表', () => {
    const m = createConfigTableManager({ logger: fakeLogger().logger });
    m.register('hero', HEROES);
    m.clear();
    expect(m.names()).toEqual([]);
    expect(m.has('hero')).toBe(false);
  });

  it('6. getConfigTables：CONFIG_TABLES token 优先，未注册回退进程默认（单例）', () => {
    const a = getConfigTables();
    expect(a).toBeTruthy();
    expect(getConfigTables()).toBe(a); // 单例
    const custom = createConfigTableManager({ logger: fakeLogger().logger });
    getRootContainer().register(CONFIG_TABLES, { useValue: custom });
    expect(getConfigTables()).toBe(custom);
  });

  it('7. unregister：撤单张表，返回是否存在；不影响其它表', () => {
    const m = createConfigTableManager({ logger: fakeLogger().logger });
    m.register('hero', HEROES);
    m.register('item', [{ id: 10 }]);
    expect(m.unregister('hero')).toBe(true);
    expect(m.has('hero')).toBe(false);
    expect(m.has('item')).toBe(true); // 其它表不受影响
    expect(m.names()).toEqual(['item']);
    expect(m.unregister('hero')).toBe(false); // 再撤不存在 → false
  });
});

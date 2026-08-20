import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  computeCoreApiHash,
  readEngineHash,
  hashApiSurface,
  readStamp,
  verifyCompat,
  writeStamp,
  type CompatStamp,
} from '../api-stamp';

const DTS = `
/** 一段 JSDoc 说明。 */
declare function createToken<T>(name: string): Token<T>;
type Lifetime = 'singleton' | 'transient' | 'containerScoped';
`;

describe('hashApiSurface', () => {
  it('剥注释 + 去空白：只改注释 / 缩进不动 hash', () => {
    const base = hashApiSurface(DTS);
    const commentChanged = hashApiSurface(DTS.replace('一段 JSDoc 说明。', '完全不同的注释文字'));
    const reindented = hashApiSurface(DTS.replace('declare function', '   declare function'));
    expect(commentChanged).toBe(base);
    expect(reindented).toBe(base);
  });

  it('改签名（增删导出 / 改类型）→ hash 变', () => {
    const base = hashApiSurface(DTS);
    const sigChanged = hashApiSurface(DTS.replace('name: string', 'name: number'));
    const typeChanged = hashApiSurface(DTS.replace("'containerScoped'", "'scoped'"));
    expect(sigChanged).not.toBe(base);
    expect(typeChanged).not.toBe(base); // 字符串字面量类型在代码行，未被当注释剥掉
  });

  it('12 位 hex', () => {
    expect(hashApiSurface(DTS)).toMatch(/^[0-9a-f]{12}$/);
  });
});

describe('computeCoreApiHash', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'cck-stamp-'));
    writeFileSync(join(dir, 'index.d.ts'), DTS);
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('传目录 → 解析 index.d.ts；传文件 → 直用；二者一致', () => {
    const byDir = computeCoreApiHash(dir);
    const byFile = computeCoreApiHash(join(dir, 'index.d.ts'));
    expect(byDir).toBe(byFile);
    expect(byDir).toBe(hashApiSurface(DTS));
  });

  it('路径不存在 → 抛错', () => {
    expect(() => computeCoreApiHash(join(dir, 'nope.d.ts'))).toThrow(/找不到/);
  });
});

describe('writeStamp / readStamp', () => {
  it('落盘 + 读回等值', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cck-stamp-io-'));
    const p = join(dir, 'compat.json');
    const stamp: CompatStamp = { version: '1.2.0', minAppVersion: '1.0.0', coreApiHash: 'abc123abc123' };
    writeStamp(p, stamp);
    expect(readStamp(p)).toEqual(stamp);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('verifyCompat（出包期主动校验）', () => {
  const app: CompatStamp = { version: '1.2.0', coreApiHash: 'aaaaaaaaaaaa' };

  it('coreApiHash 相等 + 无 minAppVersion → 通过', () => {
    expect(verifyCompat(app, { version: '1.3.0', coreApiHash: 'aaaaaaaaaaaa' })).toEqual({ ok: true });
  });

  it('coreApiHash 不等 → 拒（需整包更新）', () => {
    const r = verifyCompat(app, { version: '1.3.0', coreApiHash: 'bbbbbbbbbbbb' });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/core API 表面不一致/);
  });

  it('app 版本低于 update.minAppVersion → 拒', () => {
    const r = verifyCompat(app, { version: '1.3.0', minAppVersion: '2.0.0', coreApiHash: 'aaaaaaaaaaaa' });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/需 app ≥ 2\.0\.0/);
  });

  it('app 版本满足 minAppVersion + hash 相等 → 通过', () => {
    expect(
      verifyCompat(app, { version: '1.3.0', minAppVersion: '1.0.0', coreApiHash: 'aaaaaaaaaaaa' }),
    ).toEqual({ ok: true });
  });
});

describe('readEngineHash（引擎指纹 = 产物 import-map 里 cc 的 md5）', () => {
  let root: string;
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'cck-eng-'));
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  /** 造一份 native 产物的 `src/import-map*.json`。 */
  const make = (dir: string, file: string, content: string): string => {
    const d = join(root, dir, 'src');
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, file), content);
    return join(root, dir);
  };

  it('开了 md5Cache → 抠出那段 md5', () => {
    const r = make('a', 'import-map.1d8b3.json', JSON.stringify({ imports: { cc: './cocos-js/cc.25e81.js' } }));
    expect(readEngineHash(r)).toBe('25e81');
  });

  it('没开 md5Cache（cc.js）→ undefined，闸休眠而不是拿个假值去比', () => {
    const r = make('b', 'import-map.json', JSON.stringify({ imports: { cc: './cocos-js/cc.js' } }));
    expect(readEngineHash(r)).toBeUndefined();
  });

  it('产物里没有 src/ 或没有 import-map → undefined', () => {
    expect(readEngineHash(join(root, 'nope'))).toBeUndefined();
    mkdirSync(join(root, 'c', 'src'), { recursive: true });
    expect(readEngineHash(join(root, 'c'))).toBeUndefined();
  });

  it('import-map 坏了 / 没有 cc 这一项 → undefined 而不是抛', () => {
    expect(readEngineHash(make('d', 'import-map.x.json', '{ 不是 json'))).toBeUndefined();
    expect(readEngineHash(make('e', 'import-map.y.json', JSON.stringify({ imports: {} })))).toBeUndefined();
  });
});

describe('verifyCompat 的引擎指纹一端', () => {
  const base: CompatStamp = { version: '1.0.0', coreApiHash: 'h1' };

  it('两端都有且不等 → 拒', () => {
    const r = verifyCompat({ ...base, engineHash: '25e81' }, { ...base, version: '1.0.1', engineHash: '9c2f1' });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('引擎');
  });

  it('两端都有且相等 → 过', () => {
    expect(verifyCompat({ ...base, engineHash: '25e81' }, { ...base, engineHash: '25e81' }).ok).toBe(true);
  });

  it('单边缺失 → 过（app 戳结构性打不上引擎指纹，不能因此拦下所有发布）', () => {
    expect(verifyCompat(base, { ...base, engineHash: '25e81' }).ok).toBe(true);
    expect(verifyCompat({ ...base, engineHash: '25e81' }, base).ok).toBe(true);
  });

  it('引擎相同但 coreApiHash 不同 → 仍拒（两道闸各管各的）', () => {
    const r = verifyCompat(
      { version: '1.0.0', coreApiHash: 'h1', engineHash: '25e81' },
      { version: '1.0.1', coreApiHash: 'h2', engineHash: '25e81' },
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('core API');
  });
});

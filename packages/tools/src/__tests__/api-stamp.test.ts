import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  computeCoreApiHash,
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

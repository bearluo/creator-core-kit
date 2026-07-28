import { describe, expect, it } from 'vitest';
import { compareVersion, createSemverVersionGate } from '../version-gate';

describe('compareVersion', () => {
  it('1. 逐段数字比较（10>9 非字典序）', () => {
    expect(compareVersion('1.10.0', '1.9.9')).toBe(1);
    expect(compareVersion('1.9.9', '1.10.0')).toBe(-1);
  });
  it('2. 相等', () => {
    expect(compareVersion('1.2.3', '1.2.3')).toBe(0);
  });
  it('3. 长度不等按缺位补 0（"1.2" == "1.2.0"）', () => {
    expect(compareVersion('1.2', '1.2.0')).toBe(0);
    expect(compareVersion('1.2.0', '1.2')).toBe(0);
  });
  it('4. 主次版本大小', () => {
    expect(compareVersion('2.0.0', '1.9.9')).toBe(1);
    expect(compareVersion('0.9', '1.0')).toBe(-1);
  });
  it('5. 非数字段按 0（"1.x" 容错）', () => {
    expect(compareVersion('1.x', '1.0')).toBe(0);
  });
});

describe('createSemverVersionGate（默认安全闸）', () => {
  const gate = createSemverVersionGate();

  it('6. minAppVersion 不满足 → 拒 + needFullUpdate', () => {
    const r = gate.canApply({ version: '2.0.0', minAppVersion: '2.0.0' }, { appVersion: '1.0.0' });
    expect(r.ok).toBe(false);
    expect(r.needFullUpdate).toBe(true);
    expect(r.reason).toContain('2.0.0');
  });
  it('7. minAppVersion 满足 → 放行', () => {
    const r = gate.canApply({ version: '2.0.0', minAppVersion: '1.0.0' }, { appVersion: '1.5.0' });
    expect(r.ok).toBe(true);
  });
  it('8. coreApiHash 两边都有且不等 → 拒', () => {
    const r = gate.canApply(
      { version: '1.1.0', coreApiHash: 'aaa' },
      { appVersion: '1.0.0', coreApiHash: 'bbb' },
    );
    expect(r.ok).toBe(false);
    expect(r.needFullUpdate).toBe(true);
  });
  it('9. coreApiHash 两边都有且相等 → 放行', () => {
    const r = gate.canApply(
      { version: '1.1.0', coreApiHash: 'aaa' },
      { appVersion: '1.0.0', coreApiHash: 'aaa' },
    );
    expect(r.ok).toBe(true);
  });
  it('10. remote 声明 hash 但 local 无 → 放行（无法证伪，不阻断）', () => {
    const r = gate.canApply({ version: '1.1.0', coreApiHash: 'aaa' }, { appVersion: '1.0.0' });
    expect(r.ok).toBe(true);
  });
  it('11. 无任何兼容声明 → 放行', () => {
    const r = gate.canApply({ version: '1.1.0' }, { appVersion: '1.0.0' });
    expect(r.ok).toBe(true);
  });
});

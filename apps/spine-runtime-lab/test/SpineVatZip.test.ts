import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createSpineVatZip, sanitizeSpineVatPackageName } from '../assets/scripts/SpineVatZip';

function findSignature(bytes: Uint8Array, signature: readonly number[]): number {
  for (let index = 0; index <= bytes.length - signature.length; index += 1) {
    if (signature.every((value, offset) => bytes[index + offset] === value)) return index;
  }
  return -1;
}

describe('SpineVatZip', () => {
  it('生成包含本地文件、中央目录和 EOCD 的标准 ZIP', async () => {
    const zip = await createSpineVatZip([
      { path: 'hero-vat/manifest.spinevat', data: '{"format":"spine-vat-2"}' },
      { path: 'hero-vat/position-0.bin', data: new Uint8Array([1, 2, 3, 4]) },
    ]);
    const bytes = new Uint8Array(await zip.arrayBuffer());

    expect(zip.type).toBe('application/zip');
    expect(bytes.byteLength).toBeGreaterThan(100);
    expect(findSignature(bytes, [0x50, 0x4b, 0x03, 0x04])).toBe(0);
    expect(findSignature(bytes, [0x50, 0x4b, 0x01, 0x02])).toBeGreaterThan(0);
    expect(findSignature(bytes, [0x50, 0x4b, 0x05, 0x06])).toBeGreaterThan(0);
  });

  it('清理导出包名并拒绝目录穿越', async () => {
    expect(sanitizeSpineVatPackageName('  水果 Hero / VAT  ')).toBe('Hero-VAT');
    expect(sanitizeSpineVatPackageName('***')).toBe('spine-vat');
    await expect(createSpineVatZip([{ path: 'hero/../secret.bin', data: '' }]))
      .rejects.toThrow('Invalid ZIP path');
  });

  it('CC 运行时下载包只递归打包扩展，不复制旧项目 Runtime', () => {
    const script = readFileSync(resolve(__dirname, '../tools/build-vat-workbench.ps1'), 'utf8');

    expect(script).toContain("$extensionRoot = Join-Path $projectRoot 'extensions\\spine-vat-importer'");
    expect(script).toContain('Get-ChildItem -LiteralPath $extensionRoot -Recurse -File');
    expect(script).toContain('spine-vat-runtime/extensions/spine-vat-importer/$relative');
    expect(script).not.toContain("assets\\scripts\\SpineVatComponent.ts");
    expect(script).not.toContain("assets\\scripts\\SpineVatRendererV2.ts");
  });
});

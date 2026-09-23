export interface SpineVatZipEntry {
  path: string;
  data: Blob | ArrayBuffer | ArrayBufferView | string;
}

const encoder = new TextEncoder();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function bytesOf(data: SpineVatZipEntry['data']): Promise<Uint8Array> {
  if (typeof data === 'string') return encoder.encode(data);
  if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice();
  }
  return new Uint8Array(data);
}

function setU16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true);
}

function setU32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, true);
}

function dosDateTime(date: Date): { date: number; time: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
  };
}

export function sanitizeSpineVatPackageName(value: string): string {
  const result = value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return result || 'spine-vat';
}

/** Builds a zero-dependency ZIP using stored entries, supported by Creator and standard unzip tools. */
export async function createSpineVatZip(entries: readonly SpineVatZipEntry[]): Promise<Blob> {
  const now = dosDateTime(new Date());
  const records = await Promise.all(entries.map(async (entry) => {
    const path = entry.path.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!path || path.split('/').some((part) => part === '..')) {
      throw new Error(`Invalid ZIP path: ${entry.path}`);
    }
    const name = encoder.encode(path);
    const data = await bytesOf(entry.data);
    return { name, data, crc: crc32(data), offset: 0 };
  }));

  const localParts: Uint8Array[] = [];
  let localSize = 0;
  for (const record of records) {
    record.offset = localSize;
    const header = new Uint8Array(30 + record.name.length);
    const view = new DataView(header.buffer);
    setU32(view, 0, 0x04034b50);
    setU16(view, 4, 20);
    setU16(view, 6, 0x0800);
    setU16(view, 8, 0);
    setU16(view, 10, now.time);
    setU16(view, 12, now.date);
    setU32(view, 14, record.crc);
    setU32(view, 18, record.data.byteLength);
    setU32(view, 22, record.data.byteLength);
    setU16(view, 26, record.name.length);
    setU16(view, 28, 0);
    header.set(record.name, 30);
    localParts.push(header, record.data);
    localSize += header.byteLength + record.data.byteLength;
  }

  const centralParts: Uint8Array[] = [];
  let centralSize = 0;
  for (const record of records) {
    const header = new Uint8Array(46 + record.name.length);
    const view = new DataView(header.buffer);
    setU32(view, 0, 0x02014b50);
    setU16(view, 4, 20);
    setU16(view, 6, 20);
    setU16(view, 8, 0x0800);
    setU16(view, 10, 0);
    setU16(view, 12, now.time);
    setU16(view, 14, now.date);
    setU32(view, 16, record.crc);
    setU32(view, 20, record.data.byteLength);
    setU32(view, 24, record.data.byteLength);
    setU16(view, 28, record.name.length);
    setU16(view, 30, 0);
    setU16(view, 32, 0);
    setU16(view, 34, 0);
    setU16(view, 36, 0);
    setU32(view, 38, 0);
    setU32(view, 42, record.offset);
    header.set(record.name, 46);
    centralParts.push(header);
    centralSize += header.byteLength;
  }

  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  setU32(endView, 0, 0x06054b50);
  setU16(endView, 4, 0);
  setU16(endView, 6, 0);
  setU16(endView, 8, records.length);
  setU16(endView, 10, records.length);
  setU32(endView, 12, centralSize);
  setU32(endView, 16, localSize);
  setU16(endView, 20, 0);
  const parts = [...localParts, ...centralParts, end];
  const zipBytes = new Uint8Array(parts.reduce((size, part) => size + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    zipBytes.set(part, offset);
    offset += part.byteLength;
  }
  return new Blob([zipBytes.buffer], { type: 'application/zip' });
}

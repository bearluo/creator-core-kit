/**
 * Excel(.xlsx) → JSON 配表（出包期 node 工具，零 cc）。
 * 约定：行1 字段名 / 行2 类型 / 行3 注释(忽略) / 行4+ 数据（行号可配）。每 sheet 出一份裸行数组
 * `[{...}]`，正是 config-loader.ts 契约（ConfigTable loadTable 直接吃 asset.json 作数组）。
 * 核心转换 rowsToTable 为纯函数（不碰 fs/exceljs），exceljs 只藏在 parseWorkbook 一层读适配后。
 */
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import ExcelJS from 'exceljs';

export type FieldType = 'int' | 'float' | 'number' | 'string' | 'bool' | 'json';

export interface ConventionOptions {
  /** 字段名行（1-based），默认 1。 */
  nameRow?: number;
  /** 类型行，默认 2。 */
  typeRow?: number;
  /** 数据起始行，默认 4（第 3 行留注释）。 */
  dataStartRow?: number;
  /** sheet 名以此前缀则跳过，默认 '#'。 */
  sheetSkipPrefix?: string;
  /** 列名以此前缀（或为空）则跳过，默认 '#'。 */
  fieldSkipPrefix?: string;
}

export interface ExcelOptions extends ConventionOptions {
  /** .xlsx 文件，或含 .xlsx 的目录。 */
  input: string;
  /** 输出目录，每 sheet 落一个 <sheet>.json。 */
  outDir: string;
}

export interface TableResult {
  sheet: string;
  file: string;
  rows: Record<string, unknown>[];
}

const TRUE_WORDS = new Set(['1', 'true', 'yes', 'y']);
const FALSE_WORDS = new Set(['0', 'false', 'no', 'n', '']);

function warn(msg: string): void {
  console.warn(`cck-excel: ${msg}`);
}

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || v === '';
}

/** 按声明类型 coerce 单格值；失败/未知 → 告警并返回 undefined（由 rowsToTable 省略该 key）。 */
function coerce(type: string, v: unknown, field: string): unknown {
  switch (type) {
    case 'int':
    case 'float':
    case 'number': {
      const n = Number(v);
      if (Number.isNaN(n)) {
        warn(`字段 '${field}' 值 '${String(v)}' 非数字，已跳过`);
        return undefined;
      }
      return type === 'int' ? Math.trunc(n) : n;
    }
    case 'bool': {
      const s = String(v).trim().toLowerCase();
      if (TRUE_WORDS.has(s)) return true;
      if (FALSE_WORDS.has(s)) return false;
      return Boolean(v);
    }
    case 'json':
      try {
        return JSON.parse(String(v));
      } catch {
        warn(`字段 '${field}' 值非合法 JSON：${String(v)}，已跳过`);
        return undefined;
      }
    case 'string':
      return String(v);
    default:
      warn(`未知类型 '${type}'（字段 '${field}'），按 string 处理`);
      return String(v);
  }
}

/** 纯转换：2D 单元格 → 行对象数组（应用名/类型/数据行约定 + 逐格 coerce）。核心可测接缝。 */
export function rowsToTable(cells: unknown[][], opts?: ConventionOptions): Record<string, unknown>[] {
  const nameRow = (opts?.nameRow ?? 1) - 1;
  const typeRow = (opts?.typeRow ?? 2) - 1;
  const dataStart = (opts?.dataStartRow ?? 4) - 1;
  const fieldSkip = opts?.fieldSkipPrefix ?? '#';

  const names = cells[nameRow] ?? [];
  const types = cells[typeRow] ?? [];

  // 选出保留列：名非空且不以 skip 前缀开头
  const cols: { index: number; name: string; type: string }[] = [];
  for (let c = 0; c < names.length; c++) {
    const name = isEmpty(names[c]) ? '' : String(names[c]).trim();
    if (!name || name.startsWith(fieldSkip)) continue;
    const type = isEmpty(types[c]) ? 'string' : String(types[c]).trim().toLowerCase();
    cols.push({ index: c, name, type });
  }

  const out: Record<string, unknown>[] = [];
  for (let r = dataStart; r < cells.length; r++) {
    const row = cells[r] ?? [];
    if (cols.every((col) => isEmpty(row[col.index]))) continue; // 保留列全空 → 跳（去尾部空行）
    const obj: Record<string, unknown> = {};
    for (const col of cols) {
      const cell = row[col.index];
      if (isEmpty(cell)) continue; // 空单元格 → 省略该 key
      const val = coerce(col.type, cell, col.name);
      if (val === undefined) continue;
      obj[col.name] = val;
    }
    out.push(obj);
  }
  return out;
}

/** exceljs 单元格值 → 原始值（公式取缓存结果、富文本拼文本、Date 原样交 coerce）。 */
function cellPrimitive(value: unknown): unknown {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value;
  if (typeof value === 'object') {
    const o = value as { result?: unknown; text?: unknown; richText?: { text: string }[] };
    if ('result' in o) return o.result ?? '';
    if (Array.isArray(o.richText)) return o.richText.map((t) => t.text).join('');
    if ('text' in o) return o.text ?? '';
    return String(value);
  }
  return value;
}

/** 读一个 .xlsx（exceljs），每个非跳过 sheet → { sheet, rows }。 */
export async function parseWorkbook(
  file: string,
  opts?: ConventionOptions,
): Promise<{ sheet: string; rows: Record<string, unknown>[] }[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const skip = opts?.sheetSkipPrefix ?? '#';
  const out: { sheet: string; rows: Record<string, unknown>[] }[] = [];
  wb.eachSheet((ws) => {
    if (ws.name.startsWith(skip)) return;
    const cells: unknown[][] = [];
    ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      const arr: unknown[] = [];
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        arr[colNumber - 1] = cellPrimitive(cell.value);
      });
      cells[rowNumber - 1] = arr;
    });
    out.push({ sheet: ws.name, rows: rowsToTable(cells, opts) });
  });
  return out;
}

/** input 下所有 .xlsx（跳 ~$ 临时文件）→ 每 sheet 一个 <sheet>.json 写到 outDir。 */
export async function excelToJson(opts: ExcelOptions): Promise<TableResult[]> {
  const st = statSync(opts.input);
  const files = st.isFile()
    ? [opts.input]
    : readdirSync(opts.input)
        .filter((f) => extname(f).toLowerCase() === '.xlsx' && !f.startsWith('~$'))
        .map((f) => join(opts.input, f));

  if (!existsSync(opts.outDir)) mkdirSync(opts.outDir, { recursive: true });

  const results: TableResult[] = [];
  for (const file of files) {
    for (const { sheet, rows } of await parseWorkbook(file, opts)) {
      const outFile = join(opts.outDir, `${sheet}.json`);
      writeFileSync(outFile, JSON.stringify(rows, null, 2));
      results.push({ sheet, file: outFile, rows });
    }
  }
  return results;
}

/**
 * cck-excel CLI（node:util.parseArgs）。
 *   cck-excel --in <file|dir> --out <dir> [--name-row 1] [--type-row 2] [--data-row 4] [--sheet-skip '#']
 */
import { parseArgs } from 'node:util';
import { excelToJson } from './config-excel';

function die(msg: string): never {
  console.error(`cck-excel: ${msg}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      in: { type: 'string' },
      out: { type: 'string' },
      'name-row': { type: 'string' },
      'type-row': { type: 'string' },
      'data-row': { type: 'string' },
      'sheet-skip': { type: 'string' },
    },
  });

  const input = values.in ?? die('需要 --in（.xlsx 文件或目录）');
  const outDir = values.out ?? die('需要 --out（输出目录）');
  const num = (s: string | undefined): number | undefined => (s ? Number(s) : undefined);

  const results = await excelToJson({
    input,
    outDir,
    nameRow: num(values['name-row']),
    typeRow: num(values['type-row']),
    dataStartRow: num(values['data-row']),
    sheetSkipPrefix: values['sheet-skip'],
  });

  console.log(`✅ 转出 ${results.length} 张表 → ${outDir}`);
  for (const r of results) console.log(`   ${r.sheet}.json（${r.rows.length} 行）`);
}

main().catch((e) => die(String(e)));

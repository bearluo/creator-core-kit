---
模块: config-excel
所在包: packages/tools
状态: 已实现          # 草案 → 评审中 → 已定稿 → 已实现
摘要: 出包期 node 工具——把策划的 .xlsx 配表按「名行/类型行/数据行」约定转成裸 JSON 行数组，喂 ConfigTable 的 loadTable。
何时读: 要把 Excel 配表转成 JSON、定义/调整表头约定、或搭配表构建流水线时。
日期: 2026-07-28
依赖: 第三方 exceljs（读 xlsx）。下游消费方 = [[config-table]] 的 engine 半 loadTable（吃裸行数组 JSON）。同包姊妹 = [[hot-update-manifest]]。
---

# config-excel 设计文档

## TL;DR

`excelToJson({ input, outDir })` 把 `.xlsx`（或一个目录下所有 xlsx）的每个 sheet 转成一份 `<sheet>.json`——**裸行对象数组** `[{...},{...}]`，正好是 [[config-table]] `loadTable` 吃的格式（`config-loader.ts` 契约）。约定：**行1=字段名、行2=类型、行3=注释(忽略)、行4+=数据**（行号可配）。类型 `int/float/number/string/bool/json`，空单元格省略该 key。核心转换 `rowsToTable(cells[][], opts)` 是**纯函数**（给 2D 单元格 → 行数组），exceljs 只藏在一层 ~8 行读文件适配后，可随时换。纯 node、零 cc、vitest 用手搓 2D 数组测转换逻辑（免造 xlsx 夹具）。

## Purpose（目标与定位）

- **做什么**：策划用 Excel 维护配表（多 sheet、每 sheet 一张表），本工具出包期把它转成 JSON 行数组落盘；运行时 `loadTable(name, jsonPath)` 经 AssetLoader 加载 → `createTable` 按主键索引。是 [[config-table]] 的**数据来源那半**（`config-table.md` 记为 Excel→JSON 走 tools）。
- **定位/取舍**：出包期 node 工具，跑开发机/CI，零 cc。tools 第二模块。**主键不归本工具管**——`createTable` 在加载时定 key（默认 `id`），工具只出数组。
- **YAGNI（首版故意砍）**：
  - 无 **date 类型**（用 `string` 或 `number` 存时间戳；真需要再加 `date`）。
  - 无 **client/server 列拆分**、无 **i18n 列**、无 **嵌套/组合类型**（复杂结构塞一格用 `json` 类型 `JSON.parse`）。
  - 不 eval 公式（取 Excel 缓存的计算结果）；不做增量/差量。
  - 不校验主键唯一性/外键（那是 `createTable` 加载时的活，已有告警）。

## Public API（TypeScript 精确签名）

```ts
export type FieldType = 'int' | 'float' | 'number' | 'string' | 'bool' | 'json';

export interface ConventionOptions {
  nameRow?: number;         // 字段名行（1-based），默认 1
  typeRow?: number;         // 类型行，默认 2
  dataStartRow?: number;    // 数据起始行，默认 4（第 3 行留注释）
  sheetSkipPrefix?: string; // sheet 名以此前缀则跳过，默认 '#'
  fieldSkipPrefix?: string; // 列名以此前缀（或为空）则跳过，默认 '#'
}

export interface ExcelOptions extends ConventionOptions {
  input: string;   // .xlsx 文件，或含 .xlsx 的目录
  outDir: string;  // 输出目录，每 sheet 落一个 <sheet>.json
}

export interface TableResult {
  sheet: string;
  file: string;                        // 写出的 json 路径
  rows: Record<string, unknown>[];
}

/** 纯转换：2D 单元格 → 行对象数组（应用名/类型/数据行约定 + 逐格 coerce）。核心可测接缝，不碰 fs/exceljs。 */
export function rowsToTable(cells: unknown[][], opts?: ConventionOptions): Record<string, unknown>[];

/** 读一个 .xlsx（exceljs），每个非跳过 sheet → { sheet, rows }。 */
export function parseWorkbook(file: string, opts?: ConventionOptions): Promise<{ sheet: string; rows: Record<string, unknown>[] }[]>;

/** input 下所有 .xlsx → 每 sheet 一个 <sheet>.json 写到 outDir。返回写出清单。 */
export function excelToJson(opts: ExcelOptions): Promise<TableResult[]>;
```

CLI（复用现有 `cck-manifest` 那套 parseArgs 风格；本模块 bin 名 `cck-excel`）：
```
cck-excel --in config/ --out assets/resources/tables/
          [--name-row 1] [--type-row 2] [--data-row 4] [--sheet-skip '#']
```

## Behavior & data flow（行为与数据流）

1. `excelToJson`：`input` 是文件→单个；是目录→枚举其下 `*.xlsx`（跳 `~$` 临时文件）。
2. `parseWorkbook`：exceljs `readFile` → 逐 sheet。sheet 名以 `sheetSkipPrefix` 开头 → 跳。每格取 `cell.value`，规整为原始值（公式取 `.result`，富文本取 `.text`，其余原样）→ 得 `cells[][]`。
3. `rowsToTable`（纯）：
   - 取 `nameRow`/`typeRow` 两行；对每列：列名空或以 `fieldSkipPrefix` 开头 → 丢弃该列。
   - 从 `dataStartRow` 起逐行：**整行全空 → 跳过**（去尾部空行）；否则对每个保留列按类型 coerce，**空单元格 → 省略该 key**。
   - coerce：`string`→`String(v)`；`int`→`Math.trunc(Number(v))`；`float`/`number`→`Number(v)`；`bool`→`{1,true,yes,y}`(不分大小写)为 true / `{0,false,no,n}` 为 false；`json`→`JSON.parse(String(v))`。未知类型 → 当 `string` 兼容 + 告警。
4. `excelToJson` 写盘：每 sheet `JSON.stringify(rows, null, 2)` → `outDir/<sheet>.json`。
- **与 cc 边界**：全程零 cc、纯 node。产物由运行时 [[config-table]] engine 半 `loadTable` 消费，二者只经「裸行数组 JSON」这一契约耦合。

## Key design decisions（决策表）

| # | 维度 | 选项 | 推荐默认 | 一句话理由 |
|---|---|---|---|---|
| 1 | xlsx 读库 | exceljs / SheetJS(`xlsx`) / node-xlsx | **exceljs** | 横评（下行源）：SheetJS 下载更多+读 API 更省，但**新版迁自家 CDN、npm 停在 2022 的 0.18.5**、无流式；exceljs npm 干净+维护活+流式。作本仓**第一个依赖**且框架要复用，选「不会烂+装得干净」。读只藏在 ~8 行适配后、可换。源：npmtrends / pkgpulse `sheetjs-vs-exceljs-vs-node-xlsx-2026` |
| 2 | 表头约定 | 固定 / 可配行号 | **行1 名 / 行2 类型 / 行3 注释(忽略) / 行4+ 数据**，行号可配 | 业界（Luban/egret 系）通行；注释行给策划、机器忽略；可配以适配既有表 |
| 3 | 空单元格 | 填 0/"" / 省略 key | **省略 key** | JSON 干净，缺省交消费方（`createTable`/业务），不臆造默认值 |
| 4 | sheet/列跳过 | 无 / 前缀标记 | **sheet 名 `#` 前缀、列名空或 `#` 前缀 → 跳** | 让策划留草稿 sheet / 注释列而不污染产物 |
| 5 | 类型集 | 全 / 精简 | **int/float/number/string/bool/json** | 覆盖配表 99% 场景；复杂结构塞一格用 `json`；无 date（YAGNI，用 string/timestamp） |
| 6 | 输出形态 | 带包裹 / 裸数组 | **裸行数组 `[{...}]`** | 严格对齐 `config-loader.ts` 契约（`loadTable` 直接吃 `asset.json` 作数组） |
| 7 | 主键 | 工具定 / 加载时定 | **加载时定**（工具不管） | `createTable(name, rows, {key})` 已负责，默认 `id`；工具只出数组，职责最小 |
| 8 | 可测接缝 | 造 xlsx 夹具 / 纯函数 | **抽出纯 `rowsToTable(cells[][])`** | 转换/coerce 逻辑不碰 fs/exceljs，手搓 2D 数组即测，免维护二进制 xlsx 夹具 |

## Platform considerations（全平台 / 小游戏兼容）

- 纯出包期 node 工具，与运行时平台无关。产物 JSON 走 [[config-table]]，全平台一致。
- 与三种「热」：配表 JSON 属可热更资源；改表→重导→随 bundle/热更包下发。

## Testable seams + test plan（可测接缝 + vitest 用例）

- **可测性**：核心 `rowsToTable` 纯函数、零 fs/exceljs，直接喂手搓 `cells[][]`。`excelToJson`/`parseWorkbook`（碰 exceljs+fs）首版靠一个真跑 CLI 冒烟覆盖（对齐 manifest 模块做法），不为二进制 xlsx 夹具徒增维护。
- **用例清单（rowsToTable）**：
  1. 名/类型/数据行按默认（1/2/4）解析，产出正确行对象；
  2. 各类型 coerce：`int`→整数、`float`→小数、`bool` 各真/假词、`string`、`json`→数组/对象；
  3. 空单元格 → 该 key 被省略（不出现在行对象里）；
  4. 整行全空 → 跳过（不产空对象）；
  5. 列名空 / `#` 前缀 → 该列被丢弃；
  6. 自定义行号（nameRow/typeRow/dataStartRow）生效；
  7. 未知类型 → 退化为 string + 不抛。

## Open Questions（待用户拍板）

1. **表头约定是否匹配你们策划现有 Excel 格式**：本文档默认「行1 名 / 行2 类型 / 行3 注释 / 行4+ 数据」+ 类型词 `int/float/number/string/bool/json`。若你们已有既定布局（如类型行在别处、或用 `i18n`/`long` 之类的类型词、或有 client/server 列），告诉我我改默认对齐——这是唯一真需要你拍板的。
2. **确认引入 exceljs**：作 `packages/tools` 的 devDependency（本仓第一个第三方依赖，build-time、不进 core/engine 运行时）。

---

## 实现记录（2026-07-28 完成）

- **最终 API 与设计偏差**：与设计一致，无偏差。`rowsToTable`（纯转换核心）/ `parseWorkbook`（exceljs 读）/ `excelToJson`（枚举 xlsx + 写盘）+ CLI `cck-excel` 全部落地。表头约定采 **4 行**（名/类型/注释/数据，用户选定 Q1），行号可配；xlsx 库定 **exceljs**（用户选定 Q2），作 `packages/tools` `dependencies`（本仓首个第三方依赖，build-time；tsup **external 之**，未打进 bundle）。coerce 对非数字/非法 JSON **告警并省略该 key**（parse 路径求稳）。
- **落地文件**：`src/config-excel.ts`、`src/cli-excel.ts`、`src/__tests__/config-excel.test.ts`；`package.json` 加 bin `cck-excel` + dep `exceljs@^4.4.0`；`tsup.config.ts` entry 加 `cli-excel.ts`；`index.ts` 补导出。
- **测试结果**：`config-excel.test.ts` **9 用例全绿**（各类型 coerce、int 截断/float、空格省略 key、空行跳过、`#`列/空名列丢弃、bool 真假词不分大小写、自定义行号、未知类型退化、非法 JSON 不崩）；全仓 **343 passed**（原 334 +9）。四门全绿：typecheck / lint / build（`dist/cli-excel.cjs` 6.54 KB，exceljs 未打进）/ test。
- **bin 冒烟**：exceljs 造真 `.xlsx`（`hero` + `#scratch` sheet）→ `cck-excel --in <dir> --out <dir>` → 转出 1 张表（`#scratch` 正确跳过、尾空行跳过），`hero.json` 裸数组各类型正确（int/float、bool from yes/no、json→数组&对象、`#note` 列被丢）。
- **commit**：待提交。
- **遗留 Minors**：无 date 类型（用 string/timestamp）；`parseWorkbook`/`excelToJson` 的 fs/exceljs 路径靠 CLI 冒烟覆盖、未做二进制 xlsx 单测夹具（YAGNI）；脚手架模块另开。

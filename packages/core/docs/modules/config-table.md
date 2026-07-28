---
模块: config-table
所在包: packages/core（纯 TS，零 cc）
状态: 已实现          # 草案 → 评审中 → 已定稿 → 已实现
摘要: 配表运行时层——createTable<T>(name, rows, {key}) 把已解析行数组按主键索引成只读表（get/getOrThrow/has/all/keys/find/filter），配 ConfigTableManager 门面按名集中管理多表（register/table/getRow）+ CONFIG_TABLES 跨 bundle token。Excel→JSON 归 tools（后置），JSON 加载归 engine。
何时读: 做数值/配置表（角色/关卡/道具...）运行时查询，或想知道主键索引/重复键/多表门面语义时。
日期: 2026-07-27
依赖: logger（告警经 ILogger）、di（CONFIG_TABLES token）。godot-core-kit 无对标（按通用游戏配表模式设计）。
---

# ConfigTable 设计文档

## TL;DR

`createTable<T>('hero', rows, { key })` 把**已解析的行数组**按主键（默认字段 `id`，可传字段名或提取函数）索引成只读表：`get(id)` / `getOrThrow(id)` / `has(id)` / `all()` / `keys()` / `find(pred)` / `filter(pred)`。`createConfigTableManager()` 是多表门面：`register(name, rows)` / `table(name)` / `tableOrThrow(name)` / `getRow(name, id)`，配 `CONFIG_TABLES` token 跨 bundle 共享一套配表。**纯逻辑、零 cc**——core 只吃已解析对象、只管索引查询；Excel→JSON 由 [[tools]] 构建期产出，JSON 由 engine 的 `IAssetLoader` 运行时加载后喂给 `register`。

## Purpose（目标与定位）

- **做什么**：游戏数值/配置表的**运行时索引层**——把一堆 JSON 行按主键建 Map，提供类型化按键查询与谓词检索。
- **定位/取舍**：配表全链路 = **Excel/CSV**（策划编辑）→ **tools 构建期转 JSON**（后置模块）→ **engine 运行时用 `IAssetLoader` 加载 JSON**（后置，走接缝）→ **core 建表索引 + 查询**（本模块）。core 守铁律不碰文件/cc，只接收已解析的 `T[]`。
- **与相邻模块**：独立子系统。告警走 [[logger]]，跨 bundle 共享走 [[di-container]] 的 token（照 [[monorepo-scaffold]]/ADR-0001）。
- **YAGNI（首版砍）**：多列二级索引 / 范围查询 / 表间外键关联校验 / schema 校验 / 懒加载与卸载 / 表数据热重载 diff——都不做。首版是「一次灌入、只读查询」，需要再加。

## Public API（TypeScript 精确签名）

```ts
export type RowKey = string | number;
export type KeyExtractor<T> = keyof T | ((row: T) => RowKey);

export class ConfigRowNotFoundError extends Error {}   // getOrThrow 未命中
export class ConfigTableNotFoundError extends Error {} // tableOrThrow 未注册

export interface TableOptions<T> {
  key?: KeyExtractor<T>;   // 主键：字段名（默认 'id'）或提取函数
  logger?: ILogger;        // 默认 getLogger('ConfigTable')
}

export interface ConfigTable<T> {
  readonly name: string;
  readonly size: number;                       // 去重后条目数
  get(id: RowKey): T | undefined;
  getOrThrow(id: RowKey): T;                    // 未命中抛 ConfigRowNotFoundError
  has(id: RowKey): boolean;
  all(): readonly T[];                          // 插入顺序只读快照
  keys(): RowKey[];
  find(pred: (row: T) => boolean): T | undefined;
  filter(pred: (row: T) => boolean): T[];
}
export function createTable<T>(name: string, rows: readonly T[], opts?: TableOptions<T>): ConfigTable<T>;

export interface ConfigTableManager {
  register<T>(name: string, rows: readonly T[], opts?: TableOptions<T>): ConfigTable<T>; // 同名告警覆盖
  add<T>(table: ConfigTable<T>): void;          // 放入已建表，同名告警覆盖
  table<T>(name: string): ConfigTable<T> | undefined;   // 类型由调用方泛型断言
  tableOrThrow<T>(name: string): ConfigTable<T>;        // 未注册抛 ConfigTableNotFoundError
  has(name: string): boolean;
  getRow<T>(name: string, id: RowKey): T | undefined;   // 表或行不存在 → undefined
  names(): string[];
  clear(): void;
}
export function createConfigTableManager(opts?: { logger?: ILogger }): ConfigTableManager;
export const CONFIG_TABLES: Token<ConfigTableManager>;
export function getConfigTables(): ConfigTableManager;  // tryResolve(CONFIG_TABLES) ?? 进程默认单例
```

## Behavior & data flow（行为与数据流）

- **建表**：`makeExtractor(key)` 得取键函数（函数直用；否则取字段，默认 `'id'`）。遍历 rows：取键为 `undefined`/`null`/非 `string|number` → **告警 + 跳过该行**；键已存在 → **告警 + 后者覆盖**（last-wins）；否则 `index.set(id, row)`。索引用 `Map<RowKey,T>`，天然保留插入顺序 → `all()`/`keys()` 按插入序。
- **查询**：`get`/`has` 直查 Map；`getOrThrow` 未命中抛 `ConfigRowNotFoundError`；`find`/`filter` 遍历 `index.values()`（不复制整表再 filter，`find` 命中即返回）。`all()` 返回 `[...values()]` 只读快照（不暴露内部 Map）。
- **门面**：`tables: Map<name, ConfigTable<unknown>>`。`register` 就地建表并存；`add` 存已建表；`table<T>`/`getRow<T>` 以 `as` 把 `unknown` 断言回调用方泛型（配表在注册表边界是松类型，类型由调用方负责）；`register`/`add` 同名 → 告警覆盖；`tableOrThrow` 未注册抛。
- **零 cc 边界**：core 全纯 TS。**engine/app**：用 `IAssetLoader` 加载配表 JSON（`resources/config/hero.json`）→ `manager.register('hero', json)`；跨 bundle 想共享同一 manager 就 `getRootContainer().register(CONFIG_TABLES, { useValue })`。**tools**：Excel→JSON 转换 + 可选的 `.d.ts` 行类型生成（后置模块）。

## Key design decisions（决策表）

| # | 维度 | 选项 | 选定 | 理由 |
|---|---|---|---|---|
| 1 | 多表管理 | **含 ConfigTableManager 门面 + token** / 只给单 createTable | **含门面** | 游戏配表天生几十张、按名取用是刚需；比 [[object-pool]] 更该有门面（**定稿**） |
| 2 | 主键 | 绑死 `id` / **字段名或函数，默认 id** | **可配置** | 多数表主键叫 id，但支持任意字段/复合派生键更通用 |
| 3 | 重复主键 | 抛错 / **告警 + last-wins** | **告警覆盖** | 数据错误不该崩游戏；开发期告警帮定位，运行期退化可用 |
| 4 | 非法主键行 | 抛错 / 保留 / **告警 + 跳过** | **告警跳过** | 无合法键的行无法索引；跳过 + 告警比崩溃或留下取不到的行更稳 |
| 5 | 取不到行 | 只 undefined / **get→undefined + getOrThrow→抛** | **两者都给** | 可选数据用 get、必需数据用 getOrThrow 早暴露缺配 |
| 6 | 表类型 | 全局强类型注册 / **注册表松类型 + 取用泛型断言** | **松类型断言** | 注册表存异构表，强类型需侵入式泛型登记；边界处 `as` 更轻，类型归调用方 |
| 7 | 数据来源 | core 读文件 / **core 只吃已解析行** | **只吃行** | 守铁律：文件/JSON 加载是 IO，归 engine `IAssetLoader`；Excel→JSON 归 tools |

## Platform considerations（全平台 / 小游戏兼容）

- 纯 TS（`Map` + 数组），node/web/所有小游戏/原生无差异，零 IO、零 cc。
- **加载来源**：配表 JSON 走 [[asset-manager]]/`IAssetLoader`；一模块一 bundle 时各自 bundle 内 `register` 自己的表，或统一在启动灌入共享 manager。
- **跨 bundle 共享**：`CONFIG_TABLES` token 用 `Symbol.for` 全局一致（ADR-0001），任意 bundle `getConfigTables()` 拿到同一套表。
- **热更**：新版配表 JSON 热更下来后 `register`（同名覆盖）即换表；本首版不做 diff 增量，整表替换。

## Testable seams + test plan（可测接缝 + vitest 用例）

- **可测性**：全纯 TS 零 cc；行数据是普通对象数组，告警注入 fake logger 断言。
- **用例**（14 条，见 `config-table.test.ts`）：
  - `ConfigTable`（8）：默认 id 键 get/has/size/all/keys / getOrThrow 命中与抛 / find+filter / 自定义字段键 / 函数复合键 / 重复键告警+last-wins / 非法键告警+跳过 / 空表。
  - `ConfigTableManager`（6）：register+table+has+getRow+names（含表不存在→undefined）/ add 已建表 / register+add 同名覆盖告警 / tableOrThrow 抛 / clear / getConfigTables token 优先+默认单例。

## Open Questions（已决议 · 2026-07-27 定稿）

1. **是否内置多表门面**：✅ 含 `ConfigTableManager` + `CONFIG_TABLES` token。
2. Excel→JSON 转换器 + 行类型 `.d.ts` 生成：归 [[tools]] 包，后置。

---

## 实现记录

- **落地文件**：`packages/core/src/config/config-table.ts`（`createTable` + `ConfigTable` + `createConfigTableManager` + `ConfigTableManager` + 两个 Error + `CONFIG_TABLES` token + `getConfigTables`）、`index.ts`；由 core `index.ts` re-export（第 2 批分组）。
- **最终 API 与设计偏差**：完全按定稿，无偏差。
- **测试结果 / 覆盖率**：`config-table.ts` **Stmts/Branch/Funcs/Lines 全 100%**；14 条用例全绿。
- **commit / PR**：待提交。
- **遗留 Minors**：tools 侧 Excel→JSON + 行类型生成；二级索引 / 范围查询 / 外键校验 / 热重载 diff 按需。engine 侧 JSON 加载 → register 接线已实现（见下）。

### engine 半适配（配表 JSON 经 IAssetLoader 加载，2026-07-28）

- **落地文件**：`packages/engine/src/config-loader.ts`——`loadTable<T>(name, path, opts?)`（经 `IAssetLoader` 加载配表 JSON 数组 → `getConfigTables().register`，依赖 AssetManager engine 半）；engine `index.ts` 导出。**无新 DI token**——ConfigTable 消费 AssetManager，不新增接缝。
- **实现**：`getAssetLoader().load<JsonAsset>(path,{type:'json'})` → `asset.json`（行数组）→ `register<T>(name, rows, tableOpts)`。JSON 内容应为行数组 `[{...}]`；Excel→JSON 由 tools 产出。
- **类型策略**：官方 `@cocos/creator-types@3.8.7`（ADR-0005）。
- **验证**：四门全绿；**真机 gameView 预览已验证**：`✅ ConfigTable loadTable via cc AssetLoader: size=2, get(2).name=Bob`（真加载 `resources/heroes.json` 数组 → 主键索引）。

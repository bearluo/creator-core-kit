---
模块: save-manager
所在包: packages/core（SaveManager + IStorage 接口 + 内存实现 + JSON 序列化，零 cc）；cc.sys.localStorage 存储适配走 engine（后续）
状态: 已实现          # 草案 → 评审中 → 已定稿 → 已实现
摘要: 存档管理 createSaveManager——按 slot 存/取 JSON 兼容对象，{_v,data} 信封 + 版本迁移链，经异步 IStorage 接缝落盘；save/load/has/delete/list。core 定义 IStorage（异步 string KV）+ 自带内存实现；engine 后续接 cc.sys.localStorage。
何时读: 需要读写存档/本地持久化数据、做存档版本迁移、或要为某平台接存储后端时。
日期: 2026-07-27
依赖: di（STORAGE/SAVE_MANAGER token + tryResolve）、logger（告警）。IStorage 的 cc.sys.localStorage 适配走 engine（ADR-0002，后续）。对标参照 godot-core-kit `systems/save_manager.gd` + `save_serializer.gd`。
---

# SaveManager 设计文档

## TL;DR

`createSaveManager({ storage?, serializer?, namespace?, version?, logger? })` 返回一个 `SaveManager`：`save(slot, data)` 把对象包成 `{_v, data}` 信封、序列化（默认 JSON）、经 **异步 `IStorage`** 写到 `<namespace>/<slot>`；`load(slot)` 反过来读、校验信封、按需跑**版本迁移链**（`registerMigration(fromV, fn)`）；`has/delete/list` 补齐。**core 零 cc**：定义 `IStorage`（异步 `get/set/remove/keys`）接缝 + 自带 `createMemoryStorage()`（默认/测试用）；engine 后续注册 `cc.sys.localStorage` 适配到 `STORAGE` token，`createSaveManager()` 自动拾取。所有错误（非法 slot / 序列化失败 / 损坏 / 迁移失败 / IO 抛错）都收敛成 `save→false`、`load→null`，不冒泡不崩。

## Purpose（目标与定位）

- **做什么**：本地存档的存/取/删/列 + **跨版本迁移**（游戏改版重构存档结构，老档按迁移链逐级升级），把散落的存储调用收敛为一个带版本信封的入口。
- **定位/取舍**：godot 版直接 `FileAccess` 原子写 `user://saves/*.json`。本框架守铁律，core 不碰 `cc.sys`/文件系统，故把存储抽象成 **`IStorage` 接缝**（异步 string KV）注入；core 只管信封/序列化/迁移/清洗这些**纯逻辑**。
- **为何异步 IStorage**（**定稿**）：一次把接缝定成异步，兼容异步后端——微信/抖音小游戏的异步 storage、IndexedDB、未来云存档；同步后端（`cc.sys.localStorage`/Web localStorage）包一层 `Promise.resolve` 即可。避免日后从同步改异步的破坏性 API 变更。
- **YAGNI（首版砍）**：加密；存档位元数据（缩略图/游戏时长）；自动存档调度；原子写 temp+rename（KV 后端本身覆盖写，非文件按字节写，无写一半窗口——真需要时在 IStorage 适配层做）；深度扫描不可序列化值（JS 的 `JSON.stringify` 已对循环引用/BigInt 抛错，够用，靠 try/catch 兜住）；存档事件广播（返回值 boolean/null 已足够表达，需要时项目侧转发 EventBus）。

## Public API（TypeScript 精确签名）

```ts
// —— 存储接缝（core 定义，engine/项目实现）——
export interface IStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  keys(): Promise<string[]>;
}
export const STORAGE: Token<IStorage>;                 // engine 注册 cc.sys.localStorage 适配
export function createMemoryStorage(initial?: Record<string, string>): IStorage;

// —— 序列化策略 ——
export interface SaveSerializer { readonly name: string; encode(v: unknown): string; decode(t: string): unknown; }
export function createJsonSerializer(): SaveSerializer; // 默认

// —— SaveManager ——
export type SaveData = Record<string, unknown>;
export type Migration = (data: SaveData) => SaveData;
export interface SaveManagerOptions {
  storage?: IStorage;      // 默认 DI STORAGE，未注册则内存
  serializer?: SaveSerializer;  // 默认 JSON
  namespace?: string;      // key 前缀，默认 'save'
  version?: number;        // 当前数据版本，须>=1，默认 1
  logger?: ILogger;
}
export interface SaveManager {
  readonly version: number;
  registerMigration(fromVersion: number, migrate: Migration): void;  // v(from)→v(from+1)
  save(slot: string, data: SaveData): Promise<boolean>;  // 非法slot/序列化失败/写入抛错→false
  load(slot: string): Promise<SaveData | null>;          // 不存在/损坏/迁移失败→null
  has(slot: string): Promise<boolean>;
  delete(slot: string): Promise<boolean>;                // 删掉true/不存在false
  list(): Promise<string[]>;                             // slot 名升序（仅本 namespace）
}
export function createSaveManager(opts?: SaveManagerOptions): SaveManager;

export const SAVE_MANAGER: Token<SaveManager>;
export function getSaveManager(): SaveManager;           // tryResolve(SAVE_MANAGER) ?? 进程默认
```

## Behavior & data flow（行为与数据流）

- **信封**：落盘的是 `{ _v: version, data }` 序列化后的字符串，存于 key `<namespace>/<slot>`。
- **slot 清洗**：白名单 `[A-Za-z0-9_-]`，其余字符剔除；清洗后为空（原始空/全非法）→ 拒绝（save→false、load/has→null/false、delete→false），不回退默认位。
- **save**：清洗 slot → 组信封 → `serializer.encode`（抛错=序列化失败→告警+false）→ `await storage.set`（抛错→告警+false）→ true。
- **load**：清洗 → `await storage.get`（抛错→告警+null）→ null（不存在）→ `serializer.decode`（抛错=损坏→告警+null）→ 信封校验（`_v` 为 number、`data` 为普通对象，否则损坏→null）→ `_v===version` 直接返回 `data`，否则跑迁移链。
- **迁移链 runMigrations(stored→version)**：`stored>version`（未来版本）→ 告警+null（不降级）；`for v in [stored, version)`：缺 `migrations.get(v)` → 告警+null；`migrate(cur)` 返回非普通对象 → 告警+null；否则 `cur=out`。全程成功返回升级后的 `data`。失败即返回 null，由调用方保底新档，不静默覆盖旧数据。
- **默认存储解析**：`opts.storage ?? getRootContainer().tryResolve(STORAGE) ?? createMemoryStorage()` —— engine 注册 `STORAGE` 后 `createSaveManager()` 自动用真实后端；否则退内存。
- **list**：`storage.keys()` → 按 `<namespace>/` 前缀筛 → 去前缀 → 升序。
- **与 cc 边界**：SaveManager/IStorage/内存实现/JSON 序列化全在 core（零 cc）。engine 侧仅需实现一个 `IStorage`（`cc.sys.localStorage.getItem/setItem/removeItem` + key 枚举）注册到 `STORAGE`——这属**有状态存储**，按 ADR-0002 不进 cc mock，走 apps/demo 集成验证（后续）。

## Key design decisions（决策表）

| # | 维度 | 选项 | 选定 | 理由 |
|---|---|---|---|---|
| 1 | 存储接缝 | core 直接 cc.sys/文件 / **IStorage 注入** | **IStorage 注入** | 守铁律 core 零 cc；测试用内存实现，engine 接 cc.sys.localStorage |
| 2 | 同异步 | 同步 / **异步 Promise** | **异步**（**定稿**） | 兼容 wx 异步存储/IndexedDB/云存档；同步后端包 Promise.resolve；避免日后破坏性改 API |
| 3 | 版本管理 | 无 / **信封 _v + 迁移链** | **迁移链** | 改版存档结构可平滑升级；未来版本拒绝加载、缺迁移即失败（对齐 godot）|
| 4 | 失败语义 | 抛异常 / **收敛 false/null + 告警** | **收敛** | 存档失败不该崩游戏；调用方按返回值保底新档 |
| 5 | 序列化 | 绑死 JSON / **SaveSerializer 可插拔** | **可插拔（默认 JSON）** | 后续可换二进制/加密；core 不锁死格式 |
| 6 | 命名空间 | 全局平铺 / **namespace 前缀** | **前缀** | 多存档域隔离（不同游戏/模块共用一个 storage 后端）|
| 7 | 不可序列化值 | 深度扫描拒绝 / **靠 encode 抛错兜** | **靠 encode** | JS JSON 已对循环/BigInt 抛错；深扫是 godot 因 Variant 句柄类型才需，YAGNI |
| 8 | DI 便捷 | 仅工厂 / **STORAGE + SAVE_MANAGER token + getSaveManager** | **都给** | 对齐 [[timer]]/[[logger]] 的 token+fallback 范式 |

## Platform considerations（全平台 / 小游戏兼容）

- core（SaveManager/内存实现/JSON）纯 TS，全平台无差异。
- 真实持久化由 engine 的 `IStorage` 适配按平台提供：原生/Web 用 `cc.sys.localStorage`（同步，包 Promise）；微信/抖音小游戏可接 `wx.getStorage`/`wx.setStorage`（异步，天然契合）；未来云存档接远端。
- 异步接缝对小游戏尤其关键（大数据量下小游戏建议异步 storage）。
- 与三种「热」：跨 bundle 共享 SaveManager 走全局 `SAVE_MANAGER` token（ADR-0001 全局根容器）。

## Testable seams + test plan（可测接缝 + vitest 用例）

- **可测性**：全纯 TS 零 cc；`createMemoryStorage()` 作 IStorage 替身，注入抛错的 fake IStorage 测 IO 失败，注入 fake logger 断言告警，自定义 serializer 断言可插拔。
- **用例**（22 条，见 `save-manager.test.ts`）：save/load 往返；load 不存在→null；覆盖写；has 有无；delete 有无；list 升序+命名空间隔离；slot 清洗（非法字符剔除、全非法拒绝）；版本信封（同版本直读、落盘带 _v）；迁移链逐级升级；缺迁移/未来版本/迁移返回非对象→null+告警；损坏字节（非法 JSON/信封非法）→null；循环引用→save false；storage.get/set 抛错→null/false 不冒泡；自定义序列化器；DI STORAGE 拾取；getSaveManager token 优先/回退；registerMigration fromVersion<1 告警；createMemoryStorage(initial)；version<1 收敛为 1。

## Open Questions（已决议 · 2026-07-27 定稿）

1. **IStorage 同异步**：✅ **异步 Promise**（兼容小游戏/IndexedDB/云存档）。
2. cc.sys.localStorage 的 IStorage 适配：engine 侧、走 apps/demo 集成验证（ADR-0002 有状态存储不进 cc mock）。
3. 加密/存档元数据/自动存档：缓做（YAGNI）。

---

## 实现记录

- **落地文件**：`packages/core/src/save/storage.ts`（`IStorage` + `STORAGE` token + `createMemoryStorage`）、`save-manager.ts`（`createSaveManager` + `SaveManager`/`SaveManagerOptions`/`SaveSerializer`/`Migration`/`SaveData` + `createJsonSerializer` + `SAVE_MANAGER` token + `getSaveManager`）、`index.ts`；由 core `index.ts` re-export。首次落地 **`IStorage`**（架构总纲/CLAUDE.md 列的 Core 接口之一）。
- **最终 API 与设计偏差**：完全按定稿，无偏差。
- **测试结果 / 覆盖率**：`storage.ts` 全 100%；`save-manager.ts` Stmts/Funcs/Lines **100%**、Branch 98.59%（剩余为 version<1 的 `>=1` 子分支这类防御分支）；22 条用例全绿。
- **commit / PR**：待提交。
- **遗留 Minors**：engine 侧 `cc.sys.localStorage` 的 `IStorage` 适配 + 注册到 `STORAGE`（随 apps/demo）；二进制/加密序列化器、存档元数据、自动存档调度留后续。

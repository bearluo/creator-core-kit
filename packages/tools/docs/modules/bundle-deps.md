---
状态: 已实现
摘要: 跨包依赖的三道闸 —— 资源边两道（源码期查「引用了外部资源却没钉」、产物期查「跨包依赖没指向共享仓」），代码边一道（`import` 只许指向优先级更高的包 ⇒ 不可能成环）。
何时读: 加了新的 Creator 内置资源引用、加了跨包 `import`、`check:pins`/`check:graph`/`--split` 报了问题、接入方要换共享仓名字或改 bundle 优先级时。
依赖: hot-update-manifest.md, ../../../apps/demo/docs/hotupdate-pipeline.md
---

# bundle-deps —— 跨包依赖的三道闸

## Purpose

Creator 把**被多个 bundle 引用的资源判给优先级最高的引用者**，其余包降级成 `cc.config` 的
`deps` + `redirect`（「去那个包拿」）。归属因此随引用关系漂移，而漂移是**静默**的：构建全绿、
manifest 正常、热更下发成功，直到运行时在 `redirect` 指向的包里找不到资源。

demo 的 2026-08-20 产物里两种漂法都出过：

| 漂法 | 实况 | 后果 |
|---|---|---|
| **漂进 AOT** | `boot`（→`main`，priority 7）与 6 个皮包共用 `default_btn_normal` → 图归 `main`，皮包 `deps:["main"]` | `main` 只随 APK 换。热更下去的皮包引用旧 APK 的 `main` 里没有的 uuid → 界面一开就挂。**改的还不是那个皮包，是 boot** |
| **跨马甲漂** | 两个马甲的地基皮包同为 priority 2、都引用它 → Creator 挑了 `skin-base-foundation` | `skin-vest-lobby`/`skin-vest-mail` 依赖 **base 马甲**的包，马甲隔离破掉 |

判据只能是二值的：**共享资源只有一个仓**。demo 用 `resources`（priority 8，工程里最高、谁也抢不走），
仓里放一个**钉子 prefab**，用到的每个外部资源在里面挂一个节点引用一次 —— 归属被仓吸走，
**工程各处照常引用 `db://internal`，一行都不用改**，也不产生副本字节。

**代码边是另一件事**。上面说的全是**资源**归属；跨包 `import` 不受这套管 —— Creator 的
`cc.config.deps` **不记脚本依赖**（demo 实测：`modules/lobby` import 了 4 处地基，产物里
`deps: []`）。它有自己的失败模式：循环依赖、以及「主包 import 地基的值」这类倒挂。判据同样二值：
**依赖只许指向优先级更高的包**，严格递增 ⇒ 拓扑序天然存在 ⇒ **成不了环**。

## Public API

```ts
// ── 源码期：扫 assets/，查「引用了外部资源却没钉」 ─────────────────────
export interface AssetRefs { owned: string[]; refs: { file: string; uuids: string[] }[] }
export interface UnpinnedRef { uuid: string; files: string[] }
export function scanAssetRefs(assetsRoot: string): AssetRefs;
export function findUnpinnedRefs(scan: AssetRefs, pinPrefix?: string): UnpinnedRef[];  // 默认 'resources/'

// ── 产物期：扫 cc.config，查「跨包依赖没指向共享仓」 ───────────────────
export interface BundleDeps { name: string; borrows: Record<string, string[]> }
export interface DepViolation { bundle: string; dep: string; uuids: string[] }
export const DEFAULT_SHARED_BUNDLES: readonly string[];   // ['resources']
export function collectBundleDeps(dataRoot: string): BundleDeps[];
export function findDepViolations(list: readonly BundleDeps[], shared?: readonly string[]): DepViolation[];

// ── 拓扑期：扫 assets/ 的 import，查「跨包代码边有没有倒挂 / 同级」 ────
export interface BundleNode { name: string; dir: string; priority: number }
export interface CodeEdge { from: string; to: string; file: string; target: string }
export interface EdgeViolation extends CodeEdge { fromPriority: number; toPriority: number }
export const MAIN_BUNDLE: BundleNode;                     // { name: 'main', dir: '', priority: 7 }
export function readBundles(assetsRoot: string): BundleNode[];
export function bundleOf(file: string, bundles: readonly BundleNode[]): BundleNode;
export function scanCodeEdges(assetsRoot: string, bundles?: readonly BundleNode[]): CodeEdge[];
export function findEdgeViolations(edges: readonly CodeEdge[], bundles: readonly BundleNode[]): EdgeViolation[];
export function toMermaid(bundles: readonly BundleNode[], edges: readonly CodeEdge[]): string;
```

## 三道闸各管什么，为什么缺一不可

| | 源码期（资源） | 产物期（资源） | 拓扑期（代码） |
|---|---|---|---|
| 入口 | `check-pins --assets <assets>`（本仓 `pnpm check:pins`） | `--split` 写 manifest **之前**自动跑 | `check-graph --assets <assets>`（本仓 `pnpm check:graph`） |
| 输入 | 工程 `assets/` 的 `.meta` 与资产文件 | 产物的 `assets/*/cc.config[.<md5>].json` | 工程 `assets/` 的目录 `.meta` 与 `.ts` |
| 判据 | 被引用却不属于本工程的 uuid，必须也被共享仓引用 | `deps`/`redirect` 的目标必须在共享仓白名单里 | 每条跨包 `import` 的目标包优先级必须**严格更高** |
| 拦住的 | 归属漂移的**前身** | 已经漂了的 | 循环依赖 · 倒挂 · 同级互引 |
| 要不要构建 | **不要** —— 适合挂提交前 | 要 | **不要** |
| 逃生口 | `--pin-dir` | `--allow-deps a,b` | 无 —— 要么下沉，要么改走事件/接口 |

**产物期这道会漏一类**：外部资源**只被一个包引用**时不产生 `deps`，当场看不出问题 ——
等哪天第二个包也用它，归属才漂。源码期那道要求「引用即钉」，把这类提前拦住。

反过来源码期也管不到产物期那类：工程自有资源在多个可热更包之间共用（比如两个马甲共用一张图），
uuid 属于本工程、不算「外部」，只有产物期能看见它落到了谁头上。

**前两道对代码边完全瞎**：Creator 只把**资源**依赖写进 `cc.config.deps`，脚本 `import` 一条都不记。
所以「地基反过来 import 某个模块」在产物里看不出任何异常 —— 直到那个模块被 `release` 掉、
地基去调它时才炸。第三道闸补的就是这个盲区。

## 第三道闸：代码边的拓扑单调

**排名不另立**：直接用 Creator 的 bundle 优先级（目录 `.meta` 的 `userData.priority`），
免得同一件事有两个真相源 —— 那个数字本来就在裁决资源归属，语义是「谁更底层」。
没被任何 bundle 目录圈住的脚本归主包（`MAIN_BUNDLE`，priority 7 是 Creator 的内置值）。

规则一句话：**边 `A → B` 合法 ⟺ `priority(B) > priority(A)`**。它一次拦三类：

| 拦住的 | 例 | 不拦会怎样 |
|---|---|---|
| **倒挂** | `main`(7) → `foundation`(6) | 地基那段代码被判给主包 → 地基进 AOT → 热更失效。就是 [[adr-0014]] 那条「主包不得 import 地基的任何值」，此前**没有任何门在守** |
| **同级互引** | `shop`(1) ↔ `mail`(1) | 两个包彼此拽住，谁都卸不干净；也正是跨马甲漂的代码版 |
| **循环** | 任意长的环 | 严格递增 ⇒ 拓扑序存在 ⇒ 环不可能出现，**不需要另跑环检测算法** |

只认相对路径的 `import`：`cc` / `@cck/*` / npm 包都在 AOT 里，不构成包间边。
**纯类型 `import type` 跳过** —— 编译期擦除，不是运行时依赖，demo 主包拿地基正是靠这条缝
（`boot/foundation-api.ts` 的 `import type` + `js.getClassByName`）。

`--mermaid` 直接打印拓扑图，**图由源码生成、不手工维护**，也就不会过期。

## Behavior & data flow

- **`scanAssetRefs`**：递归 `assetsRoot`。`.meta` → `uuid` 与 `subMetas[*].uuid` 进 `owned`
  （子资源 uuid 是 `<uuid>@f9941` 形态，**被引用的正是它**，只收主 uuid 会把自家资源误判成外部）；
  `.prefab`/`.scene`/`.material`/`.anim`/`.mtl`/`.plist` → 正则抠 `"__uuid__": "…"` 进 `refs`。
  其余后缀（`.ts`/`.json`/图片）不扫。`refs` 按文件名排序，`file` 一律 POSIX 相对路径。
- **`findUnpinnedRefs`**：外部 = 被引用且不在 `owned` 里；钉住 = `pinPrefix` 下的资产也引用了它。
  返回「外部 ∖ 钉住」，按 uuid 排序，`files` 去重排序。
- **`collectBundleDeps`**：`redirect` 是 `[uuid, depIndex, …]` 的扁平表，`depIndex` 索引进 `deps`；
  解回包名后按包归并。`deps` 里有、`redirect` 没提到的（纯脚本依赖）也算借，`uuids` 记空数组。
- 两个 collect 函数对脏输入**一律跳过而非抛**（不是目录 / 没有 `cc.config` / JSON 坏了 /
  `depIndex` 越界 / 文件读不动）—— 它们是发布前的守卫，不该被一个无关文件掀翻。

## Key decisions

| 决策 | 为什么 |
|---|---|
| 「外部」用**「工程里没有对应 `.meta`」**判定，而不是硬编码 `db://internal` | uuid 里看不出资源来自哪个库；按归属反推既准确又自动覆盖将来别的内置库 |
| 共享仓默认 `resources` 而不是 `shared`/`foundation` | `resources` priority 8 是工程内最高的，**抢不走**。抬高 `foundation`(6)/`shared`(5) 去压 `main`(7) 会把 AOT 框架拉进热更包，[[adr-0014]] 已否 |
| 钉子用 **prefab 引用**而不是复制副本 | 副本要多出字节、且全工程 29 处引用都得改指副本；钉子零副本、引用一行不动，加新图只是往钉子里加个节点 |
| 代价：钉住的资源跟 AOT 同寿命 | 它们归 `resources`（AOT 那一档）。要用钉子里没有的内置图 = 热更整个 base 并重启 —— 这正确，AOT 是什么代价它就是什么代价 |
| 代码边的排名复用 Creator 的 `priority`，不另立拓扑表 | 那个数字已经在裁决资源归属，语义就是「谁更底层」。另立一张表 = 两个真相源，早晚对不上；而且改优先级时**两件事必须一起想清楚**，本来就该是同一个旋钮 |
| 用「严格递增」而不是跑环检测 | 单调 ⇒ 无环，是更强的性质：环检测只在**已经成环**时报，单调把「同级互引」和「倒挂」也一起拦了，而这两类才是实际踩过的 |
| 产物期这道挂在 `--split` 里而不是单独命令 | `--split` 正是「要发热更包了」的时刻，且它已经在遍历产物 |

## Testable seams

`packages/tools/src/__tests__/bundle-deps.test.ts`（35 条）：产物侧 12 条（跨马甲、借 AOT、
带不带 md5 后缀的 `cc.config`、坏 JSON、`depIndex` 越界、纯脚本依赖、`shared` 传空数组），
源码侧 9 条（`subMetas` 归属、只扫指定后缀、**只被一个包引用也报**、钉一半、自定义 `pinPrefix`、
目录不存在、坏 `.meta`），拓扑侧 14 条（`bundleName` 覆盖目录名、最长前缀归属、同名前缀不误伤、
多行 `import`、`import type` 不算边、倒挂 / 同级 / 未知包、`toMermaid` 去重）。
fixture 全部写进 `mkdtempSync` 的临时目录，不碰真实产物。

真项目上的二值验证：往 `assets/` 扔一个 `import { MODULE_CATALOG } from './foundation/catalog'`
的文件 → `✗ main(7) → foundation(6)`、退出码 1；删掉 → `✅ 15 个包、7 条跨包代码边`。

## 已知行为与坑

- **`settings` 引用的内置资源钉不住**：`settings.physics.defaultMaterial`
  （`default-physics-material`）与 `rendering.renderPipeline`（`builtin-forward`）由工程设置引用、
  不经资产文件，两道资源闸都看不到，它们归 `main`。目前各只有一个引用者所以不漂；一旦某个 prefab 也
  引用它们，源码期那道会报出来（它们对工程而言就是外部 uuid）。
- **钉子 prefab 是手写的**：照 `LaunchOverlay.prefab` 的 `cc.PrefabInfo`/`cc.CompPrefabInfo`
  schema 逐字段对齐 —— 裸序列化 `Node` 缺 `PrefabInfo` 会让编辑器一打开就崩 `reading 'instance'`。
  改钉子时别用「重新序列化一个临时节点树」的路子。
- 源码期只扫 `assets/`。放在 `apps/<proj>/test/` 之类目录里的 fixture 不在扫描范围内 ——
  它们也不进包，符合预期。
- **`import { type A } from './x'` 仍算一条边**：TS 能不能整条擦掉取决于 `verbatimModuleSyntax`
  这类开关，判不准的一律当真边。要走「不产生运行时依赖」的缝就写成 `import type { A } from …`。
- **拓扑闸看不见动态加载**：`bundle.load('shop')` + `js.getClassByName` 这条路没有 `import`，
  也就不产生边 —— 它本来就是**故意**用来绕开静态依赖的（主包拿地基就靠它）。所以拓扑闸保证的是
  「静态依赖无环」，运行时的加载顺序仍归 `MODULE_CATALOG` 与 App 的启动阶段管。

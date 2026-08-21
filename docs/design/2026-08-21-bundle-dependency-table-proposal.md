---
状态: 已实施（2026-08-21）
日期: 2026-08-21
依赖: docs/adr/0009-bundle-layering-criterion.md, docs/adr/0014-foundation-bundle-and-priority-sharing.md, packages/core/docs/modules/bundle-manager.md, packages/tools/docs/modules/bundle-deps.md
---

# bundle 依赖表：加载顺序与资源边界都得有人声明

> 摘要：`check:graph` 的优先级单调只回答「**谁能依赖谁**」（合法性 + 防环），不回答「**什么时候装、
> 按什么顺序装、装了谁跟着装、卸了谁跟着卸**」，更管不到**动态加载** —— 那类引用在构建期
> 一条记录都不产生。本提案立一张业务层维护的 bundle 依赖表，一表三用：加载编排、资源边界白名单、
> 三处对账的基准。
> 何时读：加一个 bundle、排启动加载顺序、跨包动态取资源、`check:graph` 与实际行为对不上时。

## 动机

### 一、加载顺序今天散在四处，没有一处是「表」

| 在哪 | 表达了什么 | 形态 |
|---|---|---|
| `AppConfig.shared: ['shared', 'skin-<马甲>-foundation']` | 启动期装哪些 | 扁平数组，**串行 `await`** |
| `AppConfig.lobby.bundle` | 大厅那个 | 单个字符串 |
| `MODULE_CATALOG[].bundle` | 按需装哪些 | 清单里的一个字段 |
| `LobbyHost` 的 `skinned` 分支 | 皮包跟着模块装卸 | **硬编码特例**：`packs=[bundle, skin]` + 两次 `release` |

包少的时候压得住，因为 demo 的模块只依赖常驻的 `foundation`。包一多，三处当场失效：

- **串行**：`shared` 里 5 个互不相干的包也一个个等 —— 没有依赖信息就不敢并行。
- **跟随装卸**：第二个「A 装了要跟着装 B」的需求出现时，`skinned` 那种特例就得写第二份、第三份。
- **卸载**：`release(A)` 之后 B 还有没有别人用？`BundleManager` 有 refCount，但**依赖不会自动加引用**
  —— 因为没人声明依赖。今天靠大厅手写两次 `release` 兜着。

### 二、动态加载在构建期完全不可见

`check:graph` 扫的是 `import`，`--split` 扫的是 `cc.config.deps`。而这四类引用**两边都扫不到**：

| 形态 | 例 | 为什么扫不到 |
|---|---|---|
| 路径取资源 | `assets().load('cfg/shop', { bundle: 'shop' })` | 包名是字符串参数，不是模块引用 |
| 场景 | `loadScene('Dodge', { bundle: 'mini-dodge' })` | 同上 |
| UI 注册表 | `registerUI(id, { bundle: skinBundle(id), prefab })` | 包名是**运行时函数**，马甲值启动后才定 |
| 类表 | `js.getClassByName('DemoFoundation')` | 故意绕开静态依赖（主包拿地基的唯一缝） |

也就是说：**跨包引用里最容易出事的那一半，是静态分析看不见的。** 看不见就只能**声明**，
再拿声明去对账。

## 目标

一张表，业务层维护，同时是这三件事的唯一真相源：

1. **加载编排** —— 谁先谁后、谁跟着谁装卸、哪些能并行；
2. **资源边界白名单** —— 一个包能碰哪些包的资源（动态引用唯一能守住的方式）；
3. **对账基准** —— 静态扫出来的实际边必须是声明的子集，漏声明当场报。

一表三用是有意的：拆成两张表（一张管加载、一张管边界）必然对不上，而对不上时**没有任何信号**。

## 目标 API

业务层（demo 放 `foundation/bundles.ts` —— 跨模块契约，跟 `MODULE_CATALOG` 同层，随地基热更）：

```ts
export type BundleRef = string | (() => string);   // 皮包名依赖当前马甲 → 运行时才定
export interface BundleSpec {
  readonly name: string;
  /** 装它之前必须先装好的包，**也是它能碰的资源边界**。 */
  readonly needs?: readonly BundleRef[];
}

export const BUNDLE_GRAPH: readonly BundleSpec[] = [
  { name: 'shared' },
  { name: 'foundation', needs: ['shared', () => currentSkinBundle('foundation')] },
  { name: 'lobby', needs: ['foundation', () => currentSkinBundle('lobby')] },
  { name: 'mail', needs: ['foundation', () => currentSkinBundle('mail')] },
  { name: 'shop', needs: ['foundation'] },
  // …模块段按 MODULE_CATALOG 现推，手写的只有启动段那几行
];
```

kit（`packages/core`）：

```ts
export interface BundleGraph {
  has(name: string): boolean;
  names(): readonly string[];
  /** 直接依赖（resolver 已求值、去重）。 */
  needsOf(name: string): readonly string[];
  /** 装 name 要按顺序装的层，**最后一层是 name 自己**；层内可并行。成环抛。 */
  layersFor(name: string): readonly (readonly string[])[];
  /** a 能不能碰 b 的资源（= b 在 a 的依赖闭包里、或常驻豁免、或 a === b）。 */
  mayUse(a: string, b: string): boolean;
}
export function createBundleGraph(specs: readonly BundleSpec[], opts?: BundleGraphOptions): BundleGraph;
```

`BundleManager` 接一个可选 `graph`：

- `load(A)` → 先按拓扑序把 `needs` 装上（**同层并行**），每个 `refCount +1`，再装 A；
- `release(A)` → 对称 `-1`，归零才真卸 —— **复用现成的 refCount，不引第二套生命周期**；
- 表外的包被 `load`：`strict`（默认）抛，否则告警后照常装。

## 三处对账（一张表，三个地方查）

| 边的来源 | 什么时候查 | 已有的 | 新增的 |
|---|---|---|---|
| 代码 `import` | `pnpm check:graph`（不用构建） | `scanCodeEdges` | 实际边 **⊆** 声明的 `needs`，漏声明报 |
| 资源 `cc.config.deps` | `--split` 出 manifest 前 | `collectBundleDeps` | 同上 |
| **动态** load / 取资源 | **运行期** | `BundleScope.bundle`（知道调用方是谁） | 经 scope 的跨包访问不在 `needs` 里 → 越界 |

前两处把「声明得比实际多」（僵尸依赖）和「实际比声明多」（漏声明）都变成可见的；
第三处是动态引用唯一守得住的位置 —— 静态分析在那儿本来就没有信息。

## 决策

| 决策 | 为什么 |
|---|---|
| 表放**业务层**（`foundation/`），不放 kit | 加载顺序是业务的事，kit 只提供机制（`BundleGraph` + `BundleManager` 接线）。换一个接入方工程，表整个重写，kit 一个字不改 |
| `needs` **一表两用**（加载跟随 + 资源白名单） | 拆两张必然对不上，且对不上时没有信号。「装它之前要有 B」与「它能碰 B 的资源」本来就是同一句话 |
| `needs` 允许 **resolver** | 皮包名 `skin-<马甲>-<跟随者>` 依赖启动后才定的 `VEST`。写死就得一个马甲一张表 |
| 装卸走**现成 refCount**，不新建生命周期 | `BundleManager` 已经有计数与 inflight 合流；依赖只是「多按几次引用」，不是新概念 |
| 越界：**dev 抛、发布记日志** | 上线不该因为一条漏声明白屏；开发期不抛就等于没有门 |
| 优先级单调那道闸**保留**，不被这张表取代 | 两件事：`priority` 管「合不合法 / 会不会成环」，`needs` 管「什么时候装 / 能碰谁」。声明表能写出环，闸挡的就是那个 |

**不做**（YAGNI，等真有需求再说）：预热与下载优先级、LRU 自动卸载、按包配并发数、
「可选依赖」与懒加载依赖的区分。

## 测试计划

- `createBundleGraph`：拓扑分层（含并行层）、resolver 求值、`mayUse` 的闭包传递、**声明成环时抛**、
  未登记的包、自依赖。
- `BundleManager` + graph：`load` 递归装依赖且计数正确、并发同名合流、失败回滚不留计数、
  `release` 递归减到零才真卸、依赖被两个包共用时不误卸。
- 对账：实际边 ⊄ 声明 → 报；声明多于实际 → 报僵尸依赖。
- demo：`BUNDLE_GRAPH` 与现有四处配置行为等价（启动仍然装 `shared` + 地基皮包，开 mail 仍然带皮包）。

## 实施步骤

1. core：`BundleSpec` / `createBundleGraph` + 单测（纯逻辑、零 cc）。
2. core：`BundleManager` 接 `graph`，`load`/`release` 递归；`AppConfig.shared` → `bootLayers()`。
3. demo：写 `foundation/bundles.ts`，删掉 `LobbyHost` 的 `skinned` 特判与两次手写 `release`。
4. tools：`check:graph` 与 `--split` 加对账；越界的运行期闸（dev）。
5. 文档：`bundle-manager.md` 重写为新现状、`bundle-layout.md` 补「加载编排」节、本提案标「已实施」封存。

## 实施结果与偏差

三个待拍板项的落点：**② 收编**（皮包成为模块的一条 `needs`，`LobbyHost` 的
`packs=[bundle, skin]` 与两次 `release` 删掉）、**③ dev 抛、发布记日志**（`setGraph(g, { strict })`，
demo 传 `ctx.config.env !== 'prod'`）。**① 与提案倾向相反：`AppConfig.shared` 保留、不被取代。**

- **为什么 ① 反了**：表住在**地基包**里（跨模块契约、要能热更），而地基自己是被启动序列装上来的
  —— 表还不存在的时候，`shared` / 地基皮包 / `foundation` 已经要装了。取代不了。于是
  `stage: 'boot'` 与 `bootLayers()` **一并砍掉**（在 demo 里一个用户都没有）：表接管的是
  「地基起来之后」的一切，启动那一段仍归 `AppConfig.shared`。
- **`MODULE_CATALOG.skinned` 字段留着**：收编掉的是**装卸**那一半；`registerCatalogUIs` 仍要靠它
  决定「这个界面的脸从皮包取」。提案里说「少一个字段」是错的。
- **`needs` 的 resolver 签名简化成 `() => string`**（不传 `UIVariant`）：调用方自己调
  `currentSkinBundle()`，core 的 bundle 模块因此不依赖 ui 模块。
- **对账落在接入方的测试里**，不在 CLI：kit 的 CLI 拿不到工程 `assets/` 的 TS 表（要执行它）。
  `apps/demo/test/foundation/bundles.test.ts` 同时 import 声明表与 tools 的 `scanCodeEdges`，
  8 条断言；`pnpm test` 本来就是门，不必另开一道。
- **运行期越界闸只做了「表外的包不许 load」**：`mayUse` 的按主体校验需要「调用方是谁」，
  而 core 在 `load` 里拿不到干净的 bundle 归属。API 留着，等真有跨包动态取资源的场景再接。

**落地**：core `bundle-graph.ts`（17 测）+ `BundleManager.setGraph`（11 测）、
demo `foundation/bundles.ts` + `Foundation.boot` 装表 + `LobbyHost` 删特判、
对账测试 8 条。全仓 **822 passed**，core 覆盖率 99.46/97.41/98.68/99.46（门 99/97/98/99）。

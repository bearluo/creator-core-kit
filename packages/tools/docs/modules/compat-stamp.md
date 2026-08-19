---
模块: compat-stamp
所在包: packages/tools
状态: 已实现          # 草案 → 评审中 → 已定稿 → 已实现
摘要: 出包期「打戳/校验」——算 core 公共 API 表面 hash（coreApiHash）+ 造兼容戳 + 出包期主动 verifyCompat。是 hotupdate 版本闸的另一半：运行时闸只比对，coreApiHash/minAppVersion 的产生在这里，把 ADR-0001 的「AOT 缺代码跑一半才崩」提前到 CI。
何时读: 要给热更接版本兼容打戳、或在 CI 加「热更包 vs 已部署 app 兼容」门禁时。
日期: 2026-07-29
依赖: 无（纯 node stdlib：crypto/fs/path/util）。契约对接 [[hotupdate-service]] 的 core 版本闸（AppInfo/UpdateInfo 字段）+ [[adr-0001]]（AOT 缺代码 → 版本绑定）。同包姊妹 [[hot-update-manifest]]（同一 cck-manifest CLI 的另一组子命令）。
---

# compat-stamp（出包期打戳 / 兼容校验）设计文档

## TL;DR

`computeCoreApiHash(coreDist)` 读 core 的 rolled-up `dist/index.d.ts`、**按行首特征剥注释 + 去空白**后 md5 取前 12 位 → core 公共 **API 表面 hash**（纯实现改动/改注释不变、增删导出/改签名才变）。`writeStamp` 把兼容戳 `{version, minAppVersion?, coreApiHash}`（字段对齐 core `AppInfo`/`UpdateInfo`）落盘：出整包写 app 戳、出热更包写更新戳。`verifyCompat(app, update)` 是**出包期主动校验**——与运行时 `createSemverVersionGate` 同语义、shift-left 到 CI：coreApiHash 不一致或 app 版本 < `minAppVersion` 即判不兼容、CLI 退出非 0，把 [[adr-0001]] 那种「热更包引用了被 AOT 裁掉的 core 符号、跑一半才崩」的事故**在构建期拦下**。挂进现有 `cck-manifest` CLI 的 `stamp` / `verify-compat` 子命令。纯 node、零 cc。

## Purpose（目标与定位）

- **做什么**：补齐热更版本兼容闭环的**产生侧**。[[hotupdate-service]] 的 core 半已有版本闸（`createSemverVersionGate`：`minAppVersion` + `coreApiHash` 比对），但它只**执行**比对；被比对的两个值——app 自己的 `coreApiHash`、远程更新声明的 `minAppVersion`/`coreApiHash`——**产生在出包期**。本模块就是那个产生器（hotupdate-service.md Open Questions #2 明确记为 tools 后置交付物）。
- **为什么是 hash 表面而非版本号**：ADR-0001 实证——Cocos native AOT 下，主包构建时被 tree-shake 掉的 core 符号，热更包若引用到，运行时命中缺失符号才崩、线上难复现。`coreApiHash` 给「主包烘进 AOT 时的 core API 表面」按了指纹；热更包若在**不同的 API 表面**上构建（增删导出/改签名），hash 不同 → 闸拒 → 逼整包更新。**加导出也算变**（新符号不在旧主包 AOT 里，热更引用同样崩），故任何表面变动都变 hash 是正确的严格姿态。
- **定位/取舍**：出包期/CI 的 node 工具，零 cc。是 `packages/tools` 第三个模块（继 [[hot-update-manifest]]、config-excel）。
- **YAGNI（首版故意砍）**：
  - **符号级深校验**（doc Open Q#2 的另一层：diff 热更包实际 import 的符号集 vs 主包 AOT 保留集，精确到「引用了哪个被裁符号」）——需静态分析打包产物，成本高；**首版只做 hash 级**（表面变没变），运行时闸仍是最终兜底。深校验列为上限（决策表 #4）。
  - 不做戳的签名/加密（防篡改）——出包期产物，CI 内可信。
  - 不碰 Web/小游戏兼容（那套走 bundle 版本化，无 AOT 裁剪问题）。

## Public API（TypeScript 精确签名）

```ts
/** 兼容戳：出包期打进 app（app 戳）/ 写进远程更新描述（更新戳），喂运行时版本闸。字段对齐 core AppInfo/UpdateInfo。 */
export interface CompatStamp {
  version: string;         // app 戳=app 版本；更新戳=更新版本
  minAppVersion?: string;  // 更新戳可选：要求 app 版本 ≥ 此
  coreApiHash: string;     // core 公共 API 表面 hash
}
export interface CompatResult { ok: boolean; reason?: string; }

/** 归一化 d.ts（剥注释+去空白）后 md5 前 12 位 = API 表面 hash。 */
export function hashApiSurface(dts: string): string;
/** 读 core rolled-up d.ts（传文件或含 index.d.ts 的目录）算 coreApiHash。 */
export function computeCoreApiHash(dtsPathOrDir: string): string;
/** 造兼容戳并落盘（JSON）。 */
export function writeStamp(outPath: string, stamp: CompatStamp): CompatStamp;
/** 读回兼容戳。 */
export function readStamp(path: string): CompatStamp;
/** 出包期主动校验：更新戳能否安全应用到已部署 app 戳（同 core gate 语义，shift-left CI）。 */
export function verifyCompat(app: CompatStamp, update: CompatStamp): CompatResult;
```

CLI（挂现有 `cck-manifest` bin，与 manifest 子命令同一入口）：
```
cck-manifest stamp --core <core-dist-或-index.d.ts> --version <v> [--min-app-version <v>] --out <path>
cck-manifest verify-compat --app-stamp <path> (--core <dist> | --update-stamp <path>) [--min-app-version <v>]
```

## Behavior & data flow（行为与数据流）

1. **打戳**：出整包 → `stamp --core packages/core/dist --version <appVer> --out app-compat.json`（app 戳，随包内置，运行时读它填 `AppInfo`）。出热更包 → `stamp --core packages/core/dist --version <updVer> [--min-app-version <x>] --out update-compat.json`（更新戳，随远程 manifest 托管，check 时读它填 `UpdateInfo`）。两次同一命令、同一 `computeCoreApiHash`，只是 `version`/`minAppVersion` 不同。
2. **hashApiSurface**：`dts.split('\n')` 逐行 `trim`，滤掉空行与以 `//`、`*`、`/*` 开头的行（JSDoc 起始 `/**`、续行 `*`、闭合 `*/`、块 `/*`、行 `//` 全覆盖；core 的字符串字面量类型如 `'singleton'|'transient'` 在代码行、不以这些开头，不误伤）→ `join('\n')` → md5(hex) 前 12 位。**剥注释是关键**：让改 JSDoc/缩进不翻 hash，只有类型面变才翻。
3. **verifyCompat**：`update.minAppVersion` 存在且 `app.version < 它` → 拒；`app.coreApiHash !== update.coreApiHash` → 拒（需整包）；否则通过。CLI `verify-compat` 通过 → exit 0，拒 → exit 1（CI 门禁）。
4. **与 cc 边界**：全程零 cc、纯 node。产物（兼容戳 JSON）由**运行时** engine/app 侧读入喂 core 版本闸，二者只经「兼容戳字段」这一契约耦合——同 [[hot-update-manifest]] 的「只经 manifest 文件格式耦合」范式。

## Key design decisions（决策表）

| # | 维度 | 选项 | 选定 | 理由 |
|---|---|---|---|---|
| 1 | API 表面取自 | 建 JS / **rolled-up d.ts** / 导出名列表 | **d.ts 表面** | d.ts = 完整公共类型面（签名/类型全含），且**稳于纯实现改动**（impl-only 改不动 d.ts→不翻 hash）；hash JS 会因实现改动误翻，只列导出名会漏签名变化 |
| 2 | d.ts 归一化 | 原样 hash / **行级剥注释+去空白** / ts AST | **行级剥注释** | 原样 hash 会因改 JSDoc/缩进误翻（逼无谓整包更新）；AST 提取要引 ts、重。行级启发式对 core d.ts 的 JSDoc-独占行足够、不误伤含字符串字面量类型的代码行（ponytail 上限：误翻再上 AST） |
| 3 | 校验逻辑来源 | import core gate / **内联同语义** | **内联** | tools 保持零 core 依赖、CLI 自包含、免 core→tools 构建顺序耦合；gate 逻辑仅 ~12 行纯算术、稳定，内联 + 注释指回 core `createSemverVersionGate` 为准，漂移风险低 |
| 4 | 校验深度 | hash 级 / **hash 级（符号级留后）** | **hash 级** | 「表面变没变」够挡多数事故且便宜；符号级「精确到引用了哪个被裁符号」需静态分析打包产物、成本高，运行时闸仍兜底，YAGNI 留上限 |
| 5 | 出包期比运行时更严 | 对齐 gate 的缺一放行 / **两端恒在、无条件比 hash** | **无条件比** | 缺一放行是运行时对「旧包没打戳」的容错；出包期两端 coreApiHash 都由本工具产出、恒在，直接严格比对更早暴露问题 |
| 6 | CLI 形态 | 新 bin cck-stamp / **挂 cck-manifest 子命令** | **子命令** | 同属 native 热更出包期工具，一个 bin 内聚；省新 tsup entry + bin 声明（ponytail 少文件） |
| 7 | hash 长度 | 全 32 位 hex / **前 12 位** | **前 12** | 兼容戳/manifest 里够辨识、够熵（相等性判定用，非抗碰撞场景），短更可读 |

## Platform considerations（全平台 / 小游戏兼容）

- **仅 native**（iOS/Android/PC）：AOT + tree-shake 才有「热更引用被裁符号」风险，`coreApiHash` 为此而设。
- **Web / 小游戏**：解释执行 / bundle 版本化，无 AOT 裁剪问题；`hotupdate-service` 的 Web 后端（后续）走 bundle 版本，不必打 coreApiHash。工具不产小游戏戳。
- 与三种「热」：属**线上热更(hotfix)** 的出包期兼容保障，与运行时分包/开发期热重载无关。

## Testable seams + test plan（可测接缝 + vitest 用例）

- **可测性**：纯 node、零 cc。`hashApiSurface` 吃字符串（不依赖 core 构建）；`computeCoreApiHash` 指 tmpdir fixture d.ts；`verifyCompat` 纯逻辑。
- **用例清单**（10，全绿）：
  - `hashApiSurface`：只改注释/缩进→hash 不变；改签名（string→number）/改字符串字面量类型→hash 变；输出 12 位 hex。
  - `computeCoreApiHash`：传目录解析 index.d.ts、传文件直用、二者一致；路径不存在→抛。
  - `writeStamp`/`readStamp`：落盘+读回等值。
  - `verifyCompat`：hash 相等无 minAppVersion→通过；hash 不等→拒；app<minAppVersion→拒；满足+相等→通过。
- **真 bin 冒烟**（超出单测，端到端）：对**真实 core dist** `stamp` → `coreApiHash=fc033ce4c4a7`；同 core `verify-compat` 通过(exit 0)；`--min-app-version 2.0.0` 拒(exit 1)；改 core d.ts 一处签名重打戳 → hash `fc03…→1fcf…` → `verify-compat --update-stamp` 拒(exit 1)。

## Open Questions

1. **符号级深校验**（决策表 #4 上限）：需静态分析热更包实际 import 的 `@cck/core`/`cc` 符号集 vs 主包 AOT 保留集，精确报「引用了哪个被裁符号」。首版 hash 级 + 运行时闸兜底足够，用到再上。
2. **戳如何被运行时读入**：✅ **已落地并真机 e2e 验证**（2026-07-29 首验于 probes 路径；2026-08-18 正式启动路径 `boot/Bootstrap.ts` 补齐并复验，见下「正式路径接入」）。app 戳走 `resources/cck-app-compat.json` → `AssetLoader` 读 → `AppInfo`；更新戳走 sidecar `cck-update-compat.json` → engine native backend `check()` 经 `am.getRemoteManifest().getPackageUrl()+compatFilename` XHR 拉 → 并进 `UpdateInfo`（`CcHotUpdateOptions.compatFilename` opt-in；因 `native.AssetsManager` 的 Manifest 绑定不透传自定义字段，走旁挂 sidecar 而非塞 manifest）。模拟器同一 v1 APK 二分实证：远端戳 hash=app 侧 → update-available 放行下 v2；改成不同 hash → `rejected(needFullUpdate)` 不下载/不重启——coreApiHash 闸从休眠**真正激活**。

## 正式路径接入（2026-08-18）

戳的两端由 `apps/demo/scripts/build.mjs` 出，一次构建同时打两枚、hash 必然相等（不等就当场抛）：

| 戳 | 落点 | 时机 | 谁读 |
|---|---|---|---|
| **app 戳** `cck-app-compat.json` | `assets/resources/` → 打进包，归 base manifest | Creator 构建**之前**（要被导入才进得了包） | core `platform` 步 → `AppInfo` |
| **更新戳** `cck-update-compat.json` | `build/android/data/` 根 → 同步到 CDN 根 | 跟 manifest 一起 | engine 后端按 `packageUrl + compatFilename` 拉 → `UpdateInfo` |

- **app 戳为什么必须放 `resources`**：`main` 只收「被场景引用到」的资源，散落的 JSON 会被丢掉
  （`stampBundle` 默认 `'main'` 时的表现就是 `Bundle main doesn't contain cck-app-compat`）；
  `resources` 是 Cocos 内建包、整目录必打进包，且在 tools 的 `DEFAULT_AOT_BUNDLES` 里 → 归 base
  manifest，**跟 AOT 一起被 base 热更替换**，戳因此永远描述「当前生效的那份 AOT」。
  **不能放 `shared` / `foundation`**：那是热更包，模块级热更就能改掉 app 自称的 coreApiHash，
  闸自己就废了。
- **app 戳的 `version` 会覆盖 `AppConfig.version`**（core 是 `j.version ?? ctx.config.version`），
  所以它取构建配置里 `packages['cck-build'].version` 那一份，空着直接报错而不是猜——两边必须同源。
- **更新戳一份供所有包共用**：base 与每个分包的 `packageUrl` 同根，各自拼出来的是同一个 URL。
  它不进任何 asset 表（manifest 只遍历 `src|assets|jsb-adapter`），也不需要——它是按 URL 取的。

⚠️ **光有戳还不够，闸有两条路，得都喂到**。此前正式路径只给分包那条喂了 `AppInfo`
（`BUNDLE_UPDATER` 的 `app`），base 那条从没注册过 `HOTUPDATE_SERVICE` → `getHotUpdateService()`
兜底成无参构造 → 闸拿到 `{ appVersion: '0.0.0' }` 且无 coreApiHash → 整道闸对 base 是关的
（`coreApiHash` 单边缺失恒放行是设计上的容错，正好把漏装伪装成"通过"）。现在两处注册挨在一起，
在 `dispatch` 阶段的项目步骤里，APP_INFO 已就位且早于 core 的 `hotupdate` 步。

**真机双向 e2e PASS**（2026-08-18，真 x86_64 模拟器，干净安装，正式启动路径）：

```
装机 1.0.0，app 戳 coreApiHash=45057af6b2af（「app 戳未读到」那行 warn 归零）
CDN 发 base 1.0.1，更新戳 hash 改成 deadbeef0000
  → 启动失败：needFullUpdate —— core API 不兼容，需整包更新   ← 不下载、不重启
恢复更新戳 hash=45057af6b2af
  → 热更应用 → restart → kit 就绪【1.0.1】                    ← 放行
```

---

## 实现记录（2026-07-29 完成）

- **最终 API 与设计偏差**：与设计一致，无偏差。`hashApiSurface`/`computeCoreApiHash`/`writeStamp`/`readStamp`/`verifyCompat` + `CompatStamp`/`CompatResult` 全落地；CLI 挂 `cck-manifest` 的 `stamp`/`verify-compat` 子命令（`verify-compat` 支持 `--core` 现算或 `--update-stamp` 读文件两种更新戳来源）。`compareVersion` 内联（对齐 core，tools 零 core 依赖）。
- **落地文件**：`packages/tools/src/api-stamp.ts`、`src/__tests__/api-stamp.test.ts`；扩 `src/cli.ts`（+`stamp`/`verify-compat` 分支与 `core`/`min-app-version`/`app-stamp`/`update-stamp` 选项）、`src/index.ts`（导出）。node stdlib 一律 `node:` 前缀，零新第三方依赖。
- **测试结果**：`api-stamp.test.ts` **10 用例全绿**；全仓 **353 passed**（原 343 +10）。四门全绿：typecheck / lint / build（`dist/cli.cjs` 5.12→8.71 KB）/ test。真 bin 冒烟见上「测试计划」末条。
- **commit**：待提交。
- **遗留 Minors**：符号级深校验（Open Q1）留后续；脚手架模块 YAGNI 用到再写。
- **运行时读入已闭环**（2026-07-29，见 [[adr-0007]]）：Open Q2 落地——engine native backend 加 `compatFilename` 拉更新戳 sidecar 并进 `UpdateInfo`，demo 读 app 戳资源填 `AppInfo`；模拟器 e2e 兼容放行 + 不兼容拦截双向 PASS，coreApiHash 闸激活。

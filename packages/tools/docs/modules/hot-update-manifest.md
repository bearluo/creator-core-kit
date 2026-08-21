---
模块: hot-update-manifest
所在包: packages/tools
状态: 已实现          # 草案 → 评审中 → 已定稿 → 已实现
摘要: 出包期 node 工具——遍历 native 构建产物算 md5+size，生成 Cocos 标准 `project.manifest` + `version.manifest`，喂给 engine 的 native.AssetsManager 后端。
何时读: 要给原生热更产出/更新 manifest、或搭 CI 热更打包流水线时。
日期: 2026-07-28
依赖: 无（纯 node stdlib：fs/crypto/path/util）。下游消费方 = [[hotupdate-service]] 的 engine 半 native.AssetsManager 后端。
---

# hot-update-manifest 设计文档

## TL;DR

`buildManifest(opts)` 遍历 native 构建数据目录（`src/ assets/ jsb-adapter/`），对每个文件算 **md5(hex) + size**，产出 Cocos 标准 manifest 对象；`writeManifests(opts)` 派生 `version.manifest`（删 `assets`+`searchPaths`）并把两份落盘。附一个 `cck-manifest` CLI（`util.parseArgs`，零依赖）。**格式严格对齐 Cocos 官方 `version_generator.js`**（一手源见决策表），这样 [[hotupdate-service]] 的 native 后端 `native.AssetsManager.create(manifestUrl, storagePath)` 能直接消费。纯 node、零 cc、vitest 指向临时 fixture 目录即可测。

## Purpose（目标与定位）

- **做什么**：把「native 构建产物目录」变成一对热更清单文件——`project.manifest`（全量：URL 配置 + 每文件 md5/size + searchPaths，随包内置且托管到远程）与 `version.manifest`（精简：仅 URL + 版本，远程放着供廉价版本探测）。这是 HotUpdate native 后端唯一缺的**输入产物**（`hotupdate-service.md:135` 明确记为 tools 后置模块）。
- **定位/取舍**：**出包期/CI 的 node 工具**，跑在开发机或流水线，不进运行时、零 cc。是 `packages/tools` 的第一个模块（该包此前空缺）。
- **YAGNI（首版故意砍）**：
  - 只管 **native**（iOS/Android/PC）热更；Web/小游戏走 bundle 版本化（`assetManager.loadBundle({version})`，另一套机制），**不在本工具范围**。
  - 不做**差量/增量**清单、不做 zip 压缩打包（`compressed` 字段照官方仅按 `.zip` 扩展名标注，不主动压）。
  - 不做远程上传/CDN 推送；只产文件，推送交给流水线既有手段。
  - 不校验「远程 vs 本地」差异（那是运行时 `AssetsManager` 的活）；`verify` 首版只做**自校验**（读回自己产的 manifest，逐条重算 md5 比对），足够抓「产物被改动/漏文件」。

## Public API（TypeScript 精确签名）

```ts
/** manifest 里单个文件条目（对齐官方：size + md5(hex)，.zip 才带 compressed）。 */
export interface AssetEntry {
  size: number;
  md5: string;
  compressed?: boolean;
}

/** Cocos 标准 project.manifest 结构。 */
export interface Manifest {
  packageUrl: string;         // 远程资源根 URL（末尾带 /）
  remoteManifestUrl: string;  // packageUrl + manifestFilename
  remoteVersionUrl: string;   // packageUrl + versionFilename
  version: string;
  assets: Record<string, AssetEntry>;  // key = 相对 root 的 POSIX 路径（正斜杠、URI 编码）
  searchPaths: string[];
}

/** version.manifest = Manifest 去掉 assets + searchPaths。 */
export type VersionManifest = Omit<Manifest, 'assets' | 'searchPaths'>;

export interface ManifestOptions {
  root: string;                 // native 构建数据根目录（含 src/ assets/ [jsb-adapter/]）
  packageUrl: string;           // 远程根 URL；内部确保以 / 结尾
  version: string;
  dirs?: string[];              // 遍历子目录，默认 ['src','assets','jsb-adapter']（不存在的跳过）
  files?: readonly string[];    // 额外收的**散文件**（相对 root，不存在的跳过）；AOT 入口在产物根，靠它进表
  manifestFilename?: string;    // 默认 'project.manifest'
  versionFilename?: string;     // 默认 'version.manifest'
  searchPaths?: string[];       // 默认 []
}

/** 分包切分：base 一份 + 每个模块 bundle 一份。见 [[adr-0013]]。 */
export interface SplitManifestOptions extends ManifestOptions {
  /** 归入 base 的 assets 子目录名，默认 ['main','internal','resources']。 */
  aotBundles?: readonly string[];
  /** 上一次发布的 manifest 目录；内容未变的包沿用其 version（必须是**紧邻**的上一版，见下）。 */
  prevDir?: string;
  /** 产物开了 `md5Cache`（内容寻址）；base manifest 丢掉 `isEngineBound` 那几类，AOT 照发。见下。 */
  contentHashed?: boolean;
}

/** 与 `libcocos.so` 绑死、或名字被 `main.js` 写死的 asset key —— 一个都不下发。 */
export function isEngineBound(key: string): boolean;
export interface SplitManifests { base: Manifest; bundles: Record<string, Manifest> }
export interface SplitWriteResult { base: WriteResult; bundles: Record<string, WriteResult> }
export function buildSplitManifests(opts: SplitManifestOptions): SplitManifests;
export function writeSplitManifests(opts: SplitManifestOptions & { outDir?: string }): SplitWriteResult;

// —— 叠加式发布的两件配套（内容寻址下新旧文件天然共存）——
/** 把 CDN 根上当前这套 manifest 归档进 `<cdnDir>/releases/<version>/`，返回归档的文件名。 */
export function archiveManifests(cdnDir: string, version: string): string[];
/** 回滚：把 `releases/<release>/` 那版配上更大的 `version` 发回 CDN 根。内容文件不重传。 */
export function rollbackManifests(opts: { cdnDir: string; release: string; version: string }): {
  changed: string[];   // 真的退回去了的（内容与当前在发的不同）
  skipped: string[];   // 内容一致、原样不动的 —— **绝不能给它们涨号**，见下
  from: string;
};

/** 遍历 root/dirs 算 md5+size，产出完整 project manifest 对象（读 fs 但不落盘，便于测）。 */
export function buildManifest(opts: ManifestOptions): Manifest;

/** 派生精简版本清单（删 assets + searchPaths）。 */
export function toVersionManifest(m: Manifest): VersionManifest;

/** buildManifest + toVersionManifest 后把两份写到 outDir（默认 = root）。返回落盘路径。 */
export function writeManifests(opts: ManifestOptions & { outDir?: string }): {
  projectPath: string;
  versionPath: string;
  manifest: Manifest;
};

/** 自校验：读回一份 project.manifest，对 root 下每条 asset 重算 md5/size 比对，返回不符项。 */
export function verifyManifest(manifestPath: string, root: string): Array<{
  path: string;
  reason: 'missing' | 'size-mismatch' | 'md5-mismatch';
}>;
```

CLI（`bin: cck-manifest`）：
```
cck-manifest --root build/android/data --url http://host/remote-assets/ --version 1.0.0
             [--out build/android/data] [--dirs src,assets,jsb-adapter] [--search-paths ...]
             [--split] [--aot-bundles main,internal,resources] [--prev <上次发布目录>]
cck-manifest verify --root build/android/data --manifest build/android/data/project.manifest
```

`--split` 把一张全表切成 base + 每个模块 bundle 各一份（`<bundle>.manifest` / `<bundle>.version.manifest`），
供 native 分包热更用 —— 一 bundle 一个 `AssetsManager` 目标，玩家点进模块前才下它那份。
demo 实测：47 条全表 → base 22 条（`src/` 6 + `jsb-adapter/` 2 + `assets/{main,internal}` 14）+ 6 个模块包 25 条。

`--prev` 让**版本号由内容决定**：逐份与上一版比对，一模一样就沿用旧 `version`，只有真改了的包才用 `--version` 给的新号。
不给这个参数就是老行为（所有包一律盖新版本号），只发一个包时其余包客户端会各空跑一轮「NEW_VERSION_FOUND → 下载 0 个文件」。
一次真实发布的输出长这样：

```
✅ 生成 base manifest（22 个资源，version=1.0.1）
✅ 生成 bundle manifest 'lobby'（3 个资源，version=1.0.0）（内容未变，沿用旧版本）
✅ 生成 bundle manifest 'shop'（6 个资源，version=1.0.1）
```

⚠️ **`--prev` 必须指向紧邻的上一次发布**（通常就是 CDN 目录本身，`--out` 与它同一个即可，读在写之前）。
内容比对只看一版：指向两版之前、而本次内容恰好与那版相同的话，会发出一个比客户端手里更旧的版本号，
客户端判 up-to-date 而停在中间那版的内容上。

## Behavior & data flow（行为与数据流）

-1. `--prev` 的版本沿用（`buildSplitManifests` 内）：每份 manifest 落定前读 `<prevDir>/<同名文件>`，**只比资产表**（key + md5 + size + compressed），`packageUrl` / `searchPaths` 一概不看；一致就把 `version` 换成上一版的。读不到 / 坏 JSON 一律当"没有上一版"，用新版本号（宁可多发一次，不可少发）。**口径必须与引擎 `Manifest::genDiff` 一致，这是硬约束不是取舍**：凡是我们判「改了」而引擎判「没改」的字段，产出的都是「版本号涨了、diff 却是空表」—— 而客户端在那个状态下会 SIGSEGV（见上）。换 CDN 地址因此不涨版本，也不需要：客户端查更新用的是本地 manifest 里烘的地址（`AssetsManagerEx.cpp:580/623`），老地址死了涨版本救不回来；而本框架一律经 dispatcher 下发的 `cdn_url` 自取 remote manifest 并改写基址，包内烘的那个根本没人读。

2. `contentHashed`（`--md5`，Creator 开了 `md5Cache` 时）：base manifest **只丢 `isEngineBound` 那几类，AOT 整条链照发**（入口 `application.<md5>.js` + 指针 `src/cck-aot.json` + `src/settings.<md5>.json` + `src/chunks/**` + `assets/{main,resources,internal}`）。AOT 发得出去是因为 `main.js` 改读固定名指针拿入口名，而那段跑在搜索路径还原之后（[[adr-0017]]）。丢掉的两类各有理由：

   - **与 `.so` 绑死**：`src/cocos-js/**`、`src/effect.bin`、`jsb-adapter/**`。它们与 `libcocos.so` 里的 C++ 同属一次引擎构建，换引擎或改模块勾选时两边一起变、`.so` 必须重编——单独下发新 JS 配旧 `.so` 就是崩在绑定层，而它想修的东西本来也只能随包发。`cc.<md5>.js` 一个就好几 MB，下了还无人问津。
   - **名字被 `main.js` 写死**：`src/system.bundle.*.js`、`src/polyfills.*.js`、`src/import-map*.json`。`main.js` 里 `require` 的是字面量旧 md5 名，新文件下下来没人念。`import-map` 还兼任引擎身份凭据（`imports.cc` → `engineHash()`），能热更就等于版本闸可伪造，**故意不解**。

   `main.js` 自己两类都不占——它跑在搜索路径还原**之前**（还原本身就是它干的），天然不在 `dirs` 里，也**永远不许**出现在 `files` 里。模块 bundle 不受影响：它们的 `index.<md5>.js` 由客户端显式传 version 加载（版本从这张 manifest 自己反推，见 core 的 `bundleVersionFromAssetKeys` 与 [[adr-0016]]）。

-1.5 `archiveManifests` / `rollbackManifests`：内容寻址下发布改成**只叠加、绝不清空**，历史各版本的字节都留在 CDN 上，于是「回滚」退化成「把旧那版的 manifest 重新发一遍」。两条硬约束：**① 号只能更大**——引擎默认 `cmpVersion` 把「远端号更小」判成本地已最新、**静默跳过**；而改掉比较规则是陷阱（同一个 `setVersionCompareHandle` 还服务 `loadLocalManifest` 的 `versionGreater`，改了会让新装的 APK 被旧缓存盖住）。**② 只能动内容真变了的包**——归档目录里躺着全部 manifest，给没变的也涨号 = 客户端判 NEW_VERSION 而 `genDiff` 空表 → worker 线程 SIGSEGV（真机崩过）。所以逐份与**当前在发的那版**比资产表，一致就原样不动；`*.version.manifest` 没有资产表，跟随它对应的主 manifest 的决定。这与 `--prev` 是同一条不变式：**「版本号变了」必须蕴含「内容真变了」**。

0. `buildSplitManifests`（`--split`）：先跑一次 `buildManifest` 拿全表，再按 key 前缀分派——`assets/<name>/…` 且 `<name>` 不在 `aotBundles` 里的归该 bundle，其余（含 `assets/` 下的散文件）归 base。**只分派不重算**，所以 base ∪ bundles 恒等于不切时的全表，无重叠无遗漏（有测试守）。**各 manifest 的 asset key 一律相对 data 根**，bundle manifest 只是全表的子集——下载落盘后相对 storagePath 的结构必须与包内一致，搜索路径前缀一挂才解析得到（[[adr-0013]] 决策 2）。空目录不产出空 manifest。

1. `buildManifest`：先对 `dirs` 里每个存在的子目录，`fs.readdirSync(..,{recursive})`（或递归 walk）取全部文件；跳过**隐藏文件/目录**（basename 以 `.` 开头，对齐官方）。每文件：
   - `size = fs.statSync(f).size`；
   - `md5 = crypto.createHash('md5').update(fs.readFileSync(f)).digest('hex')`（**全文件字节**，对齐官方；构建期非热路径，不做流式）；
   - key = `path.relative(root, f)` → `.replace(/\\/g,'/')`（POSIX 正斜杠）→ `encodeURI`（对齐官方）；
   - `compressed: true` **仅当** `path.extname(f) === '.zip'`。

   再把 `files` 里点名的散文件按同一口径收进来（相对 root，不存在 / 不是文件的跳过）。它给产物**根上**那些不在任何子目录里、却必须随 base 更新的文件用 —— 目前只有 AOT 入口 `application.<md5>.js`。
2. 组装 `remoteManifestUrl = packageUrl + manifestFilename`、`remoteVersionUrl = packageUrl + versionFilename`；`packageUrl` 强制补 `/` 结尾。
3. `toVersionManifest`：浅拷贝后 `delete assets; delete searchPaths`。
4. `writeManifests`：两份 `JSON.stringify(m, null, 2)` 写到 `outDir`（默认 root，使 `project.manifest` 随包内置）。
5. `verifyManifest`：读回 manifest，对每个 `assets` 条目在 `root` 下重算，收集 `missing/size-mismatch/md5-mismatch`。
- **与 cc 边界**：全程零 cc、纯 node。产物由**运行时** engine 半 `native.AssetsManager` 消费（见 [[hotupdate-service]]），二者只经「manifest 文件格式」这一契约耦合。

## Key design decisions（决策表）

| # | 维度 | 选项 | 推荐默认 | 一句话理由 |
|---|---|---|---|---|
| 1 | 复用官方脚本 vs 自写 | 抠 `version_generator.js` / 自写 TS | **自写 ~60 行 TS** | 官方脚本不在本仓、是无类型无测试、需手改硬编码路径的独立 CJS；抠来适配 ≥ 自写，且自写能带类型+vitest。**格式一字不差对齐官方**（下行一手源） |
| 2 | manifest 格式来源 | 记忆 / 一手源 | **一手源** | 格式错则整条热更链静默崩；已核 Cocos 官方 `version_generator.js`：`crypto md5 hex` + `stat.size` + `.zip→compressed` + 遍历 `src/{src,assets,jsb-adapter}`、正斜杠+`encodeURI`+跳隐藏文件；`version.manifest`=删 `assets`+`searchPaths`。源：github `cocos-creator/tutorial-hot-update/version_generator.js` + docs.cocos.com/creator/3.8 hot-update 教程 |
| 3 | md5 全文件 vs 流式 | 全读 / stream | **全读** `readFileSync` | 构建期一次性、非热路径；对齐官方；文件超大再谈流式（ponytail 上限） |
| 4 | 遍历子目录 | 固定 / 可配 | **可配，默认 `['src','assets','jsb-adapter']`** | 3.8 native 产物布局可能无 `jsb-adapter`，不存在则跳过；平台差异用 `--dirs` 覆盖 |
| 5 | CLI 参数解析 | commander/yargs / stdlib | **`node:util.parseArgs`** | stdlib 够用，零新依赖（ponytail 铁律） |
| 6 | 打包形态 | tsup dist / tsx 直跑 | **tsup 出 CJS bin**（对齐 engine 既有 tsup 约定） | 是 node CLI 不进 cc，无需 external cc；`bin` 指向 dist |
| 7 | 校验范围 | 自校验 / 远程 diff | **首版仅自校验** | 抓「产物被改/漏文件」够用；远程 diff 是运行时 AssetsManager 的职责，不重复 |
| 9 | 逐包版本节奏 | 手工 `--bundle-version shop=1.0.1` / 内容派生 | **`--prev` 对账，内容未变则沿用旧版本号** | 手工覆盖把「哪个包改了」交回给人，忘了 bump 就是更新静默不发；对账由内容决定，这个问题消失。**不能直接拿内容 hash 当版本号**：引擎默认 `cmpVersion` 先 `sscanf("%d.%d.%d.%d")`，纯 hash 以数字开头（`03cb…`）会被吃成 `3`、与 `03aa…` 判等而永不更新；加前缀强制走 `strcmp` 则字典序不单调，约一半发版被判 up-to-date 静默丢失。一手源：`extensions/assets-manager/Manifest.cpp:57` |
| 8 | 本地 remote-assets 托管 | `python -m http.server` / 本机 filebrowser CDN | **本机 filebrowser 分享** | 复用本机常驻 Docker filebrowser（8081，见 skill `filebrowser-cdn`）：绑 `0.0.0.0`，局域网/Tailscale/真机都够得着（http.server 绑 127.0.0.1 真机拿不到），免起进程；分享 base URL 即 `packageUrl`，子目录支持故 `packageUrl + src/xxx.js` 可解析。姊妹项目 [[godot-core-kit-reference]] 同法微信小游戏/Android 实测通过 |

## Platform considerations（全平台 / 小游戏兼容）

- **仅 native**（iOS/Android/PC）：本工具产物服务于 `native.AssetsManager` 线上热更。
- **Web / 微信·抖音小游戏**：不产 manifest；走 Asset Bundle 版本化，`hotupdate-service` 的 Web 后端（后续）负责，与本工具无关。
- 与三种「热」：属**线上热更(hotfix)** 的出包期一环。运行时分包/开发期热重载无关。

## Testable seams + test plan（可测接缝 + vitest 用例）

- **可测性**：纯 node、零 cc。测试在 `os.tmpdir()`（或 vitest 临时目录）造 fixture：写几个已知内容的文件（含一个 `.zip`、一个 `.dotfile` 隐藏文件、一层子目录），指向 `buildManifest`/`verifyManifest`。
- **用例清单**：
  1. `buildManifest` 对固定内容文件产出的 `md5` 等于独立 `crypto` 重算值、`size` 等于字节数；
  2. assets 的 key 是**相对 root 的正斜杠路径**（Windows 上也不含 `\`）、经 `encodeURI`；
  3. `.zip` 文件 `compressed===true`，非 zip 无该字段；
  4. 隐藏文件（`.xxx`）被跳过、不进 assets；
  5. `dirs` 里不存在的子目录被静默跳过、不抛；
  6. `remoteManifestUrl/remoteVersionUrl` = `packageUrl`(补/) + 文件名；`packageUrl` 无尾斜杠时被补上；
  7. `toVersionManifest` 结果无 `assets`/`searchPaths`、其余字段与 project 一致；
  8. `writeManifests` 落两份文件、内容可 `JSON.parse` 回来且等值；
  9. `verifyManifest`：改动某文件内容→`md5-mismatch`；删文件→`missing`；未改→空数组。

## Open Questions（待用户拍板）

1. ~~`packageUrl` 是否必填~~ **已定**（2026-07-28）：**必填**，CLI 缺 `--url` 报错（无远程根的 manifest 没意义，官方那个 `http://localhost` 占位反而埋坑）。dev/test 的真值 = 本机 filebrowser 分享 base URL（决策表 #8），native 端到端热更时才建 share 并托管 `remote-assets/`。
2. **是否首版就带 Excel→JSON**：本文档只覆盖 manifest 这半（我推荐的最高杠杆项）。Excel→配表转换单独一份 `config-excel.md` 再开，避免一次摊太大。默认这么切，若要一起做说一声。

---

## 实现记录（2026-07-28 完成）

- **最终 API 与设计偏差**：与设计一致，无偏差。`buildManifest / toVersionManifest / writeManifests / verifyManifest` + CLI `cck-manifest`（默认生成 / `verify` 子命令）全部落地。`packageUrl` 必填（Open Q1 已定）；`toVersionManifest` 用显式 4 字段构造而非 destructure-delete（避开 `no-unused-vars` lint 噪声）。
- **落地文件**：`packages/tools/`——`package.json`（`bin.cck-manifest`→`dist/cli.cjs`）、`tsconfig.json`（`types:["node"]`、`emitDeclarationOnly`、只为满足 project-reference 的 composite）、`tsup.config.ts`（cjs bin + shebang，`dts:false` 绕开 engine 那套 composite/dts 折腾）、`src/hot-update-manifest.ts`、`src/cli.ts`、`src/index.ts`、`src/__tests__/hot-update-manifest.test.ts`；根 `tsconfig.json` references 加 `./packages/tools`。node stdlib 一律 `node:` 前缀（`crypto/fs/path/util`），零第三方依赖。
- **测试结果**：`hot-update-manifest.test.ts` **8 用例全绿**（md5/size 对齐独立重算、正斜杠子目录 key、`.zip`→compressed、隐藏文件跳过、缺目录不抛、packageUrl 补斜杠+remote 拼接、version 派生删字段、写回+自校验、md5-mismatch/missing）；全仓 **334 passed**（原 326 +8）。四门全绿：typecheck / lint / build（`dist/cli.cjs` 5.12 KB）/ test。
- **bin 冒烟**：`node dist/cli.cjs` 真跑——生成 3 资源（md5/size 正确、`.zip` 标 compressed、URL 拼接对、`version.manifest` 正确精简）→ verify 通过退出码 0 → 改文件后 `size-mismatch` 退出码 1。
- **commit**：待提交。
- **遗留 Minors**：Excel→配表转换（`config-excel.md`）、脚手架另开（YAGNI，用到再写）；native 端到端热更（remote-assets 托管到 filebrowser CDN + 原生构建真跑 `AssetsManager` 更新流程）待后续（决策表 #8 已备存储方案，`packageUrl` 即分享 base URL）。

## 发包前的归属检查（`--split` 自带）

`--split` 在写 manifest **之前**先扫一遍产物里各 bundle 的 `deps`/`redirect`，跨包依赖指向共享仓
以外的包一律 `exit 1`、不出 manifest —— 资源归属漂了的话热更会在运行时找不到资源。判据、两道闸的
分工与实况见 [[bundle-deps]]。

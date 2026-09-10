---
模块: source-maps
所在包: packages/tools
状态: 已实现          # 草案 → 评审中 → 已定稿 → 已实现
摘要: sourcemap 的两半——出包时把 `.map` 从产物里**搬走归档**（不然源码会随热更包 / APK / web 目录一起发出去），事后拿后台那条崩溃堆栈**还原回源码行**。挂在 `cck-manifest` 的 `stash-maps` / `symbolicate` 两个子命令上。
何时读: 要开 `sourceMaps`、要从崩溃平台的行号找回源码位置、或想知道为什么 `.map` 不能留在产物里时。
日期: 2026-09-10
依赖: `@jridgewell/trace-mapping`（devDep，tsup 打进 bin，运行时零依赖）。上游是 [[crash-reporting]] 报上去的堆栈，下游接 `apps/demo/docs/hotupdate-pipeline.md`「从崩溃堆栈回到代码」三步里的第 ③ 步。决策见 hlgit #54。
---

# source-maps（sourcemap 归档与还原）

## TL;DR

`stashSourceMaps(root, outDir)` 把产物里全部 `.map` 搬到 `outDir` 的**镜像路径**、搬完原地复扫、还剩就抛；
`symbolicate(stack, mapsDir)` 把一整段堆栈原文逐帧还原成 `源文件:行:列`，认不出的原样透出。
CLI 是 `cck-manifest stash-maps --root <产物根> --out <归档目录>` 与
`cck-manifest symbolicate --maps <归档目录> < 堆栈原文`。

## Purpose（目标与定位）

崩溃平台**都不还原 JS**（见 [[crash-reporting]]）：后台看到的是
`at deep (assets/main/index.f8c7f.js:339:21)` —— 产物里的行列号。要回到源码行只能靠 sourcemap，
而 sourcemap 一旦留在产物里就等于**把源码发给每个玩家**。这个模块就是这对矛盾的落点：
**开着 `sourceMaps` 构建，但 `.map` 一个都不出门。**

## Public API

```ts
/** 递归找出 root 下全部 .map，返回相对 root 的正斜杠路径。**不跳隐藏项**。 */
export function findSourceMaps(root: string): string[];

/** 把 root 下全部 .map 搬到 outDir 的镜像路径，返回搬走的相对路径。搬完复扫，还剩就抛。 */
export function stashSourceMaps(root: string, outDir: string): string[];

/** 逐行还原堆栈；认得出的帧后面多插一行 `↳ 源文件:行:列`。 */
export function symbolicate(stack: string, mapsDir: string): string[];
```

## Behavior & data flow

```
Creator 构建（sourceMaps: true）
      │   产物 data/ 里：index.8f281.js 与 index.js.map 并排躺着（⚠️ 只有 js 带指纹）
      ▼
stash-maps ──搬走+补指纹──▶ <mapsDir>/assets/main/index.8f281.js.map   （镜像相对路径，追加式）
      │
      ├─ 复扫：还剩 .map ⇒ 抛
      ▼
其余一切（base 指针 / manifest / deploy / web cpSync / gradle）—— 此时产物里已无 .map

…几个月后，后台来了一条崩溃…

crash.txt ──▶ symbolicate --maps <mapsDir> ──▶ assets/modules/mini-plane/PlaneVM.ts:42:13
```

## Key decisions（决策表）

| # | 决策 | 为什么 | 代价 |
|---|---|---|---|
| 1 | **release 也开 `sourceMaps`**，不是只给 debug 包开 | 后台收到的正是 release 的堆栈；只给 debug 开等于这套东西永远用不上 | 构建变慢、产物多一批文件、多一道必须不出错的搬运 |
| 2 | **搬运夹在 Creator 构建与其余一切之间** | `.map` 同时走**三条**路出去：热更包（manifest 无差别收集）、**APK**（gradle 把 `data/` 整个塞进 assets）、**web 目录**（`cpSync(DATA, webDir)` 全量拷）。⚠️ 最后一条**不经 `deployToCdn`** —— 闸放在部署那步挡不住它 | 出包流程多一步；漏了这步就是源码泄漏 |
| 3 | **闸跟搬运同居一处**（搬完原地复扫，还剩就抛） | 不指望下游哪个工具替它把关：manifest 侧的 `walkFiles` 跳隐藏项、gradle 与 `cpSync` 不跳，口径本就不一致 | 无 |
| 4 | 归档目录**必须在对外服务的目录之外** | 实测公司文件服务器那条分享链 `…/dl/<id>/releases/` **返回 200** —— CDN 根整个是公开的，`.map` 放 `releases/<v>/maps/` 就是公开源码 | 多一个 `mapsDir` 配置；没配就报错 |
| 5 | 索引 = **产物相对路径原样镜像，不分版本目录** | 后台堆栈里那条路径**拼上 `.map` 就是文件位置**：零索引表、零 version→map 映射，**且不必先知道是哪一版**（知道版本反而要先 grep `releases/`）。名里有 md5 ⇒ 同名即同内容 ⇒ 天然去重，没改的包不会每版存一份 | 没有「这一版用了哪几份」的边界，清理老 map 要按引用反查 |
| 5b | 归档时**把指纹补进 map 名** | ⚠️ 决策 5 的前提**实测只对了一半**：Creator 只给 `.js` 加指纹，`.map` 留的是加之前的名字（`index.8f281.js` 配 `index.js.map`）。照原名归档 → 各版本互相覆盖、且跟堆栈里的文件名对不上，决策 5 整条落空 | 认不出兄弟 js 时只能原名归档（见坑三） |
| 6 | 搬运用**拷贝 + 删除**而不是 `rename` | 归档目录常在另一个盘，跨设备 `rename` 会 EXDEV | 多一次读写；`.map` 就那么大，无所谓 |
| 7 | 解码用 `@jridgewell/trace-mapping`，不手搓 VLQ | 标准格式、有现成实现、**错了还不好发现**。它已在 lockfile 里（vitest/istanbul 带的），声明成 devDep 零下载，tsup 直接打进 bin | 多一个 devDep |
| 8 | 下发 js 末尾那行 `//# sourceMappingURL=…` **留着不动** | 抹它要重写每个 js，而产物名是 Creator 按内容算出来的 —— 改了字节，文件名就跟自己的内容对不上了 | 玩家照那个名字去 CDN 拿会得到 404 |
| 9 | 只有行号的帧**照样还原，但带 `⚠`** | Crashlytics 渲染的是重建的 `StackTraceElement`，四个字段里没有列。取该行第一个映射多半不是你要的那个函数 —— 但给个带警告的位置仍好过什么都不给 | 需要人自己判断可信度 |

## Platform

| | |
|---|---|
| **native（Android）** | 全套可用。堆栈原文从 Bugly 的 `stack` 字段拿 |
| **Crashlytics** | ⚠️ **要去 log 面板里 `fc.log` 附的那份原文**，不是它渲染的堆栈（那份没有列，见决策 9） |
| **web** | 产物同样开着 `sourceMaps`、同样被搬走。但 web 那条链**还没有崩溃上报**，所以现在只是「哪天接上时不用回头补一次构建」 |

## Testable seams + 测试计划

纯 node、零 cc，11 条单测全覆盖（`packages/tools/src/__tests__/source-maps.test.ts`）：

| 函数 | 钉住的行为 |
|---|---|
| `findSourceMaps` | 递归 · 正斜杠相对路径 · **隐藏目录里的也算**（gradle 和 `cpSync` 可不跳隐藏项）· 没有时是空表 |
| `stashSourceMaps` | 镜像路径就位 · 源目录一个不剩 · **js 一个字节没动** · 同名覆盖不报错 · **归档目录落在产物里 ⇒ 抛** · **按兄弟 js 补指纹**（没兄弟 / 不止一个 / 名里本来就有 ⇒ 原名） |
| `symbolicate` | 行+列 → 源文件:行:列（列按 1 基输出）· 只有行 → 该行第一个映射 + `⚠` · 查不到 map 原样透出 · 非帧行原样透出 · 多帧顺序不变 · **真产物那种拼了两遍的 `sources` 只留最后一段，并打出 `sourcesContent` 里的那行代码** |

> 测试用的那份手写 map 有**两处刻意的不对称**，各钉一个坑：第一个映射**不在第 0 列**（逼「只有行号」
> 那条路必须用 `LEAST_UPPER_BOUND`，否则找不到映射、那条帧会被静默透出），以及**两个相邻列**上各挂
> 一个映射（逼列的 1 基/0 基换算不能差一格）。两处都实测过：把实现改回错的写法，恰好对应的用例变红。

## 已知行为与坑

> 下面前三条都是**在真产物上撞出来的**（2026-09-10，demo 的 android 构建，25 份 `.map`），
> 不是推演。真跑一遍之前，这个模块看起来是「按文件名查表」那么简单。

- ⚠️ **`.map` 的名字不带 md5，`.js` 才带。** `assets/main/index.8f281.js` 配的是
  `assets/main/index.js.map`（`src/chunks/bundle.99d1f.js` 配 `src/chunks/bundle.js.map`）。归档时按
  **同目录的兄弟 js** 把指纹补回去，否则各版本互相覆盖、且跟堆栈里的文件名对不上。下发 js 末尾那行
  `//# sourceMappingURL=index.js.map` 指的也是不带指纹的名字 —— 反正没上传，指哪都是 404。
- ⚠️ **map 里的 `sources` 被 Creator 拼了两遍**：
  `../file:/E:/…/mini-plane/file:/E:/…/mini-plane/PlaneVM.ts`。不是解码库的锅，map 文件里就这么写的；
  显示时取最后一个 `file:/` 之后那截。
- ⭐ **map 里带 `sourcesContent`**（源码原文嵌在里面），所以还原时能**直接把那一行代码打出来**，
  不必把那个 commit 签出来。反过来说，这也是「`.map` 一份都不能出门」的最直白理由。
- ⚠️ **`application.<md5>.js` 没有 map。** base 入口是 Creator 从模板生成的，那一层的帧还不回去。
  业务代码都在 `assets/*/index.js` 与 `src/chunks/` 里，不影响主用途。
- ⚠️ **`trace-mapping` 吃 1 基行 / 0 基列，而堆栈给的列是 1 基。** 差这一格不会报错，只会静默指到旁边
  那个函数上 —— 测试里那份手写 map 就是为钉住它设计的。
- ⚠️ **归档是追加式的，没有过期策略。** 「几个月后收到一条老版本的崩溃」正是它要服务的场景，所以
  刻意不自动清理。真要清，按 `releases/<v>/` 里各 manifest 引用到的产物名反查。
- ⚠️ **只认路径完全一致的 map。** 后台若只给了文件名（没有 `assets/main/` 这段前缀），当前实现会当作
  「认不出」原样透出，不会去按 basename 搜。真遇到再加。

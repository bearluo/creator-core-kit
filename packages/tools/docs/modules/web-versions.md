---
模块: web-versions
所在包: packages/tools
状态: 已实现          # 草案 → 评审中 → 已定稿 → 已实现
摘要: 出包期 node 工具——从 web 构建产物的 `settings.<md5>.json` 抽 `bundleVers`，落成一张 core `RemoteVersions` 认的版本表 JSON，跟产物一起部署。
何时读: 要给 web / 小游戏发热更、或搭 web 出包流水线时。
日期: 2026-08-19
依赖: 同包 [[compat-stamp]]（`coreApiHash` 现算）与 [[hot-update-manifest]]（共用 `DEFAULT_AOT_BUNDLES`）。下游消费方 = core `App` 的 `hotupdate` 启动步。
---

# web-versions 设计文档

## TL;DR

`buildWebVersions(root, opts)` 读 web 构建产物的 `src/settings.<md5>.json`，取出 `assets.bundleVers`
（Creator 写的 bundle → 出包 md5），剔掉 AOT 包，盖上 `version` / `coreApiHash` / `minAppVersion`，
产出一张版本表；`writeWebVersions` 落盘。CLI 子命令 `cck-manifest web-versions`。

## Purpose（目标与定位）

- **做什么**：给 web 侧热更提供**唯一的输入产物**——一张 `{bundles: {名: md5}, version, coreApiHash?}` 的 JSON。
  客户端启动时拉它、过版本闸、`setVersions` 一盖，之后 `load` 到的就是新那份代码。
- **为什么这么小**：native 的 manifest 要带每个文件的 md5 与大小，因为**它要自己下载**；
  web 什么都不用下——引擎按 `assets/<bundle>/index.<md5>.js` 取，浏览器自己会拉。
  所以这里只需要「哪个包是哪一版」，其余全由文件名承载。

## Public API

```ts
interface WebVersions {
  readonly bundles: Record<string, string>;   // 不含 AOT 包
  readonly version: string;
  readonly coreApiHash?: string;
  readonly minAppVersion?: string;
}

interface WebVersionsOptions {
  readonly version: string;
  readonly core?: string;                     // core dist 或 index.d.ts，给了就现算 coreApiHash
  readonly minAppVersion?: string;
  readonly aotBundles?: readonly string[];    // 默认 DEFAULT_AOT_BUNDLES
}

function readBundleVers(root: string): Record<string, string>;
function buildWebVersions(root: string, opts: WebVersionsOptions): WebVersions;
function writeWebVersions(outPath: string, v: WebVersions): WebVersions;
```

CLI：

```bash
cck-manifest web-versions --root build/web-mobile --version 1.0.1 \
  --core packages/core/dist [--min-app-version 1.2.0] --out build/web-mobile/cck-versions.json
```

## Key decisions（决策表）

| # | 决策 | 为什么 |
|---|---|---|
| 1 | 数据源是产物的 `settings.*.json`，不自己扫目录算 md5 | 那串 md5 是 Creator **写进文件名**的，我们重算一遍只会算出不一样的值。它已经是真相，抄过来即可 |
| 2 | 按**前缀**找 settings 文件 | `md5Cache` 一开它就叫 `settings.<md5>.json`。盯死 `settings.json` 会永远找不到 |
| 3 | 找到多份 settings 就报错，不挑一个 | 上一次构建的残留会让「挑第一个」静默取到旧版本 → 表里全是旧 md5 → 客户端加载即 404 |
| 4 | `bundleVers` 为空直接报错并点名 `md5Cache` | 换文件名就是 web 的版本机制。关着它生成的是一张空表，客户端 `setVersions({})` 静默什么都不做 —— 查起来毫无线索 |
| 5 | **剔掉 `main` / `internal` / `resources`** | 它们的版本由页面自己的 `settings.json` 说了算。客户端换不动（换了只会去拉一个不存在的文件名），要换只能重新加载页面 |
| 6 | 没给 `--core` 就不写 `coreApiHash` 字段 | 版本闸对该字段**单边缺失恒放行**。塞个空串等于谎报「我声明了」 |

## Behavior & data flow

```
Creator web 构建（md5Cache: true）
  → build/web-mobile/src/settings.<md5>.json   assets.bundleVers = {lobby: 'ef2c3', …}
  → cck-manifest web-versions                  剔 AOT + 盖 version/coreApiHash
  → cck-versions.json                          跟产物一起部署（同源）
  → 客户端 hotupdate 步 loadRemote              过 compat 闸 → BundleManager.setVersions
  → 之后 load 的 bundle 都带新 md5
```

## 已知行为与坑

- ⚠️ **部署必须只叠加、不清空**。老页面还在引用上一版的 `index.<旧md5>.js`，删了它们等于把线上
  正在跑的会话打断。文件名带 md5、新旧天然共存，「免重启换代码」正是靠这个（[[adr-0010]]）。
  这一条和 native 相反 —— 那边 CDN 只需要最新一版。清历史版本是另一件事（按时间保留 N 版）。
- ⚠️ **版本表要和 bundle 同源**。它描述的就是页面这一侧的那批文件，跟着页面走；
  客户端那边写相对文件名，不去拼 dispatcher 下发的 `cdnUrl`（那是 native 的解法，见 core `app.ts` 注释）。
- **改任何一个 bundle 都会连带改掉 `index.html`**（bundleVers 变 → settings 的 md5 变 → application.js 变 →
  html 引用变）。所以版本表的价值不在「html 没变」，而在**绕过 html 的缓存**：玩家手里那份 html
  可能是 CDN / 浏览器缓存的旧版，版本表用 no-store 拉、永远最新，于是旧页面也能加载新 bundle。
  AOT 那层仍是旧的 —— 这正是 `coreApiHash` 闸要挡的情况（新 bundle 要新 AOT 时拒掉，让玩家刷新）。

## 验证（2026-08-19 · 浏览器双向 e2e PASS）

真构建产物 + 8082 静态托管 + Playwright，单变量：

```
A 版：入口 index.a05b3.js，自带 settings 说 shop=50149
B 版：只改 ShopView 一行 → shop=ee5da（lobby 仍 ef2c3 未动），版本表 1.0.1

用【A 版页面】启动 → 拉到 1.0.1 版本表 → 游客登录 → 进大厅 → 开商城
  → 加载 assets/shop/index.ee5da.js，打出改动后的日志
  → 0 error / 0 warning，整页未重载

版本表 coreApiHash 改 deadbeef0000 → 同一个 A 版页面停在
  「需要刷新页面 / core API 不兼容，需整包更新」，lobby 与 shop 一个都没加载
  → 恢复 hash 即放行
```

判据是「旧页面加载的 shop md5 到底是它自己 settings 里那个，还是版本表里那个」——
两者不同才有意义，所以 B 版只改了 shop、没碰 lobby。

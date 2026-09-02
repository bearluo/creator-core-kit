---
状态: 活文档
摘要: 热更新的架构图与流程图 —— 一次改动要付哪一档代价、内容从哪来、启动时按什么顺序更新。给第一次接触这套热更的人看。
何时读: 想弄明白「这个改动能不能热更 / 更新是怎么下来的」时。要动手发版、排查更新没生效，去 [[hotupdate-pipeline]]。
依赖: [`hotupdate-pipeline.md`](hotupdate-pipeline.md)（真名真路径真命令）· [[hotupdate-service]]（API 与状态机）
---

# 热更新一图看懂

## 三个层名（先记这个）

| 层 | 是谁 | 换它要 |
|---|---|---|
| **引擎层** | `libcocos.so` · 引擎 JS · 启动器 `main.js` | 发 APK。相当于 Unity 的 AOT dll：在包里，更新不了 |
| **base 层** | 全部业务代码 · `assets/boot` · `main` / `resources` | 热更，重启生效 |
| **分包层** | `foundation` · `shared` · `skin-*` · `modules/*` | 热更，免重启 |

> 代码里的 `cck-base.json` / `baseStamp` / `DEFAULT_BASE_BUNDLES` 指的都是 **base 层**；马甲是另一维度（`default` / `vest`）。

## 一句话

**改了什么，决定它怎么下去。** 三档，从贵到便宜：

| 代价 | 改到了什么 | 玩家侧表现 |
|---|---|---|
| **发 APK**（引擎层） | 引擎（`libcocos.so` + `cc.<md5>.js`）、启动器 `main.js` | 去商店重装 |
| **热更 · 重启生效**（base 层） | 全部业务代码、`assets/boot`、`main` / `resources` | 启动时下载，自动重启一次 |
| **热更 · 免重启**（分包） | `foundation`、业务模块、皮包 | 无感，下次 `load` 就是新的 |

分界线只有一条：**引擎指纹变了才必须发 APK**，其余都能热更下去。

## 架构图（native）

```mermaid
%%{init: {"flowchart": {"nodeSpacing": 100, "rankSpacing": 90}}}%%
flowchart TB
  subgraph build["① 出包机 · scripts/build.mjs"]
    B1["Creator 构建<br/>产物文件名带 md5"]
    B2["cck-manifest --split<br/>切 base + 每包一份 manifest"]
    B1 --> B2
  end

  subgraph cdn["② CDN（只叠加，绝不清空）"]
    C1["project.manifest<br/><i>base 层整条链</i>"]
    C2["&lt;bundle&gt;.manifest × N<br/><i>foundation · 模块 · 皮包</i>"]
  end

  DP["③ 服务端 dispatcher<br/>握手下发 cdn_url<br/><i>换 CDN 不用发新包</i>"]

  subgraph dev["④ 设备"]
    A["APK 内 · 只读 —— <b>引擎层</b><br/>libcocos.so · 引擎 JS · main.js · 包内 manifest"]
    R["cck-remote-asset/<br/><b>base</b> —— 重启生效"]
    U["cck-bundle-asset/&lt;bundle&gt;/<br/><b>分包</b> —— 免重启<br/><i>一包一目录</i>"]
  end

  B2 --> C1
  B2 --> C2
  DP -->|"cdn_url"| R
  DP -->|"cdn_url"| U
  C1 -->|"HotUpdateService"| R
  C2 -->|"BundleUpdater"| U
  A -->|"包内 manifest 作 diff 基准"| U

  classDef mk fill:#065f46,stroke:#34d399,color:#fff;
  classDef st fill:#1e293b,stroke:#64748b,color:#fff;
  classDef sv fill:#92400e,stroke:#fbbf24,color:#fff;
  classDef cl fill:#0e7490,stroke:#22d3ee,color:#fff;
  class B1,B2 mk
  class C1,C2 st
  class DP sv
  class A,R,U cl
```

**地址不烘在包里**：客户端拿握手下发的 `cdn_url` 改写 manifest 里的地址字段再灌回引擎。
唯一还烘死的是 `dispatcherUrl`（链条起点，绕不开）。

## 流程图（native 启动 → 更新 → 进游戏）

```mermaid
%%{init: {"flowchart": {"nodeSpacing": 90, "rankSpacing": 80}}}%%
flowchart TB
  S(["冷启动"]) --> H["握手 dispatcher<br/>拿 cdn_url · wsUrl"]
  H --> CK["base check<br/>取远端 project.manifest 比版本"]
  CK -->|"拉不到"| ERR["启动失败 · 可重试<br/><i>不静默降级</i>"]
  CK -->|"没新版"| BU
  CK -->|"有新版"| G{"版本闸<br/>coreApiHash + engineHash<br/>两端对得上？"}
  G -->|"对不上"| FULL["提示整包更新<br/><i>不下载，省几十 MB</i>"]
  G -->|"对得上"| DL["下载（驱动启动界面进度条）"]
  DL --> RT["game.restart()<br/>本轮启动到此为止"]
  RT --> S

  BU["分包按需更新<br/>BundleUpdater.ensureLatest"] --> LD["load shared → 皮包 → foundation<br/>协议 · 长连接 · 登录"]
  LD --> RUN(["进大厅"])
  RUN -->|"打开某模块"| BU2["load 前再 ensureLatest<br/><i>免重启，运行期也走这条</i>"]

  classDef gate fill:#5b21b6,stroke:#a78bfa,color:#fff;
  classDef bad  fill:#7f1d1d,stroke:#f87171,color:#fff;
  classDef ok   fill:#065f46,stroke:#34d399,color:#fff;
  class G gate
  class ERR,FULL bad
  class RUN ok
```

三个关键顺序，换了就出事：

- **闸在下载之前** —— 不兼容不白下。
- **地基（`foundation`）排在热更之后** —— 否则更新下来的要等下次启动才生效。
- **检查失败一律中止启动**（可重试），不退回包内版本 —— 静默降级会把发布事故伪装成正常。

## web 那条：一个文件都不用下

引擎按 `assets/<bundle>/index.<md5>.js` 取，浏览器自己会拉；整条流水线只剩一张版本表。

```mermaid
%%{init: {"flowchart": {"nodeSpacing": 90, "rankSpacing": 80}}}%%
flowchart TB
  W1["出包机<br/>构建（md5Cache 必须开）"] --> W2["cck-versions.json<br/>{ bundle → md5, coreApiHash }"]
  W2 --> W3["静态托管<br/><b>只叠加</b>，新旧 md5 共存"]
  W3 -->|"no-store 拉，永远最新"| W4["页面启动读版本表<br/><i>绕过 html 缓存</i>"]
  W4 --> W5{"coreApiHash 对得上？"}
  W5 -->|"不对"| W6["提示刷新页面"]
  W5 -->|"对"| W7["setVersions → load 带新 md5<br/>整页不重载，旧页面也能上新代码"]

  classDef gate fill:#5b21b6,stroke:#a78bfa,color:#fff;
  classDef bad  fill:#7f1d1d,stroke:#f87171,color:#fff;
  class W5 gate
  class W6 bad
```

| | native | web |
|---|---|---|
| 更新载体 | 每包一份 manifest（逐文件 md5） | 一张版本表 `cck-versions.json` |
| 谁下载 | 引擎 `AssetsManagerEx` | 浏览器（换文件名 = 换版本） |
| 基址 | dispatcher 下发，运行时注入 | 不需要，跟着页面走（同源） |
| 生效 | base 要重启，分包免重启 | 全部免重启 |
| 回滚 | 换 manifest（内容不重传） | 换版本表（旧 md5 还在） |

**两边共用同一道闸**：`coreApiHash` 不等就拒，防止「新代码配旧 base」跑到一半才崩。

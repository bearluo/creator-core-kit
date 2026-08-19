---
状态: 活文档
摘要: demo 的 `assets/` 怎么切成 bundle —— 纵向按「改它要付什么代价」分三层，横向按马甲收进 `skins/`；两个维度不许混层。含 bundle 全表、优先级阶梯、依赖方向与归位判据。
何时读: 往 `assets/` 加目录、加一个功能模块、决定某段代码放哪一层、改 bundle 优先级之前。
依赖: [[adr-0009]] 分层判据 · [[adr-0014]] 地基 bundle 与优先级共享 · [[bundle-manager]] · [`vest-and-skin.md`](vest-and-skin.md)
---

# demo 的分层与分包

## TL;DR

**纵向 = 改它要付什么代价**（AOT → 地基 → 模块），**横向 = 哪个马甲**（收进 `skins/`）。
两个维度正交，不许压在一层。`skins/` 与 `skins/<马甲>/` **不是** bundle，只做目录归类 ——
bundle 不能嵌套；真正的皮包是 `skins/<马甲>/<跟随者>/`，**一个跟随者一个皮包**。

## 架构图

```mermaid
flowchart TB
  boot["<b>① boot/ — AOT 主包</b><br/>Boot.scene · Bootstrap · app-config 含 VEST · foundation-api<br/><i>改它 = 发新包 + 玩家重装</i>"]
  foundation["<b>② foundation/ — 地基 bundle</b> · priority 6<br/>net · login · catalog<br/><i>改它 = 热更，不重启</i>"]
  modules["<b>③ modules/* — 功能 bundle</b> · priority 1~3<br/>lobby · shop · mail · mini-clicker · mini-dodge<br/><i>按需 load / release</i>"]
  shared["<b>shared — 共享资源</b> · priority 5<br/>i18n · 图集 · 音效"]
  skins["<b>skins/&lt;马甲&gt;/&lt;跟随者&gt;/ — 皮包</b> · priority 1~2<br/><i>只有 prefab 与图，没有脚本</i>"]

  boot -->|"js.getClassByName<br/><b>唯一接缝</b>"| foundation
  boot --> shared
  modules -->|"可以正常 import"| foundation
  modules --> shared
  modules -.->|"换皮的从皮包取 prefab"| skins
  foundation -.->|"登录界面的脸"| skins
```

**依赖方向单向向下**，两条铁律：

1. **主包不得 `import` 地基的任何值** —— 那段代码会被判给主包（优先级最高者赢）→ 地基进 AOT
   → 热更失效。唯一接缝是 `boot/foundation-api.ts`：`import type` + `js.getClassByName`。
2. **模块可以正常 `import` 地基的函数与常量** —— `foundation` 优先级（6）高于所有业务包，
   被多包引用的资源归属优先级最高者，同级才各复制一份。不必为了怕复制而全走 DI。
   改优先级前先读 [[adr-0014]]。

## bundle 全表

| bundle | 源目录 | priority | 什么时候装 | 什么时候卸 |
|---|---|---|---|---|
| `foundation` | `assets/foundation/` | **6** | 启动 `shared` 阶段，**在 `hotupdate` 之后** | 不卸，常驻 |
| `shared` | `assets/shared/` | 5 | 启动 `shared` 阶段 | 不卸，常驻 |
| `lobby` | `assets/modules/lobby/` | 3 | 启动 `lobby` 阶段 | 不卸，常驻 |
| `shop` | `assets/modules/shop/` | 1 | 打开商城时 | 关闭时 |
| `mail` | `assets/modules/mail/` | 1 | 打开邮件时 | 关闭时 |
| `mini-clicker` | `assets/modules/mini-clicker/` | 1 | 打开时 | 关闭时 |
| `mini-dodge` | `assets/modules/mini-dodge/` | 1 | 打开时（`kind:'game'`，自带场景） | 关闭时 |
| `skin-<马甲>-foundation` | `assets/skins/<马甲>/foundation/` | 2 | 启动 `shared` 阶段（在 `APP_CONFIG.shared` 里） | 不卸，常驻 |
| `skin-<马甲>-lobby` | `assets/skins/<马甲>/lobby/` | 1 | 进大厅时 | 不卸 |
| `skin-<马甲>-mail` | `assets/skins/<马甲>/mail/` | 1 | 打开邮件时，与 `mail` 并行 | 关闭时，与 `mail` 一起 |

包名靠目录 `.meta` 的 `bundleName` 覆盖（皮包目录本身不重复 `skin-` 前缀）。
内置的 `main`(7) / `resources`(8) 优先级都高于 `foundation`，所以地基**不会**反过来把 AOT
框架代码吸进热更包。

## 归位判据：新东西放哪一层

问自己一句话 —— **「改它，玩家要付什么代价？」**

| 答案 | 归属 | 例子 |
|---|---|---|
| 必须重装 App | ① `boot/` | 启动编排、`VEST`、dispatcher 地址、引擎模块裁剪 |
| 热更后重启一次 | ② `foundation/` | 协议映射、连接与重连、登录与认证、模块清单 |
| 打开这个功能时才需要 | ③ `modules/<id>/` | 商城的商品列表、邮件的读取逻辑 |
| 所有模块都要，且**没有逻辑** | `shared/` | i18n 表、公共图集、音效 |
| 只是「哪张脸」 | `skins/<马甲>/<跟随者>/` | 所有换皮界面的 prefab 与图 |

四条完整判据（含边界情况）见 [`2026-08-07-demo-assets-layout-v2-proposal.md`](../../../docs/design/2026-08-07-demo-assets-layout-v2-proposal.md)（已实施，封存）。

## 加一个功能模块

1. 新建 `assets/modules/<id>/`，目录 `.meta` 勾 **Asset Bundle**、priority `1`；
2. 逻辑写 VM（零 `cc`，可 node 直跑），View 只做取组件 / 建绑定 / 转发事件与生命周期；
3. 界面 prefab 放模块包内（不换皮）或 `skins/<每个马甲>/<id>/`（换皮，见 [`vest-and-skin.md`](vest-and-skin.md)）；
4. `foundation/catalog.ts` 的 `MODULE_CATALOG` **加一行** —— 大厅代码零改；
5. 单测放 `apps/demo/test/`，路径镜像 `assets/`（`assets/a/BVM.ts` → `test/a/BVM.test.ts`）。

**加模块不必发新包**：`MODULE_CATALOG` 在地基里，热更地基 + 那个模块就能上线一个新功能。

## 已知行为与坑

- **地基必须在 `hotupdate` 之后加载**（`shared` 阶段），否则更新下来的要等下次启动才生效。
  长连接与认证跟着后移到这一步，是这个排序的直接后果。
- **测试不进 `assets/`** —— Creator 会把 `.test.ts` 当游戏脚本打包并炸构建，单测放 `apps/demo/test/`。
- **禁模块级单例**（`export const x = new Foo()` / `static instance` / `getInstance()`）：
  bundle 卸载不卸脚本、编辑器 stop→play 保留 JS 上下文、单 bundle 出包依赖内联，三条都让它
  拿到脏的旧实例。要共享就注册进模块 DI scope。唯一豁免是 `getRootContainer()`。
- **`[...set]` 会被 Cocos 构建降级成 `[].concat(set)`**，集合被塞成单元素 —— 预览测不出、
  只在构建产物炸。一律用 `Array.from`（已有 lint 硬规则）。
- 业务侧 lint 规则要写进 `apps/demo/eslint.config.mjs`（`pnpm lint:demo`）；根
  `eslint.config.js` 把 `apps/**` 整个 ignore 了，加在那里**静默失效**。

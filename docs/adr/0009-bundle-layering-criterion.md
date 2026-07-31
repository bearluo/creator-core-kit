---
状态: 已接受
日期: 2026-07-31
依赖: packages/core/docs/modules/app.md, packages/core/docs/modules/bundle-manager.md, docs/adr/0001-cross-bundle-singleton-and-aot-hotupdate.md, docs/design/2026-07-31-app-layer-and-bundle-lifecycle-proposal.md
---

# ADR-0009：包分层判据是「启动期加载且被跨模块持有引用」，不是「哪个包」

## 背景

「什么能热更、什么必须重启」这个问题，直觉答案是按**包**回答：主包必须重启，分包可以热更。这个答案在真实工程里是错的，而且错得很隐蔽：

- `@cck/core` / `@cck/engine` 的代码经 AOT 打进主包 chunks，**不是**因为它们是 npm 包，而是因为启动第一行就要用；
- `shared` bundle 技术上完全可以配成远程包、独立版本、独立热更——但里面是 i18n 基表、公共图集、字体这类**被各处持有引用**的东西，运行中换掉，那些持有旧引用的界面拿到的还是旧对象；
- `lobby` 是个再普通不过的 Asset Bundle，但它在启动序列里 load，**下次启动天然带上新版本**，为它单独做「运行中换」纯属做功。

按包分层还会诱发一个更贵的错误：以为「是分包 ⇒ 换了就生效」。实测（[[adr-0010]]）证明分包换代码需要额外机制，而「启动期加载」的那些东西根本不需要机制。

## 决策

分层判据是「**启动期加载且被跨模块持有引用**」，据此分三层：

| 层 | 内容 | 更新怎么生效 |
|---|---|---|
| **重启层** | 引擎 + AOT chunks（`@cck/core` / `@cck/engine` 全部框架代码）、main 包（`Boot.scene` + `Bootstrap.ts` + `AppConfig`）、`settings.json` | 必须重启（native `game.restart()` / web `location.reload()`） |
| **启动期换** | `shared`、`lobby` | 启动序列里 load 时用的就是新版本 → **天然生效，不需要「运行中换」** |
| **运行期换** | 按需业务 bundle（shop / mini-clicker / mini-dodge …） | 免重启换代码，机制见 [[adr-0010]] |

推论（同期实施）：**main 包瘦身到只剩 `Boot.scene` + `Bootstrap.ts` + `AppConfig`**，大厅整体降为 `lobby` bundle，公共资源进新建的 `shared` bundle。

## 理由

- **判据直接对应「换了会不会出事」**：被跨模块持有引用的东西，运行中换会让持有方拿着旧对象继续跑——这是个正确性问题，与它在哪个包无关。
- **判据也直接对应「值不值得做机制」**：启动期就 load 的东西，更新在下次启动免费生效；为它做运行期热替换是零收益、非零风险。
- **迭代最频繁的东西不该锁在最难更新的层里**：改造前大厅在主包 → 大厅改一行 = 整包重发。这是把分层做反了的典型代价。
- **`shared` 归「启动期换」是判据的结果，不是例外**：它可远程、可独立热更（能力上属分包），但它被各处持有引用（判据上属启动期）——判据赢。

## 后果

- 新增一个 bundle 时，先回答判据问题再决定它归哪层；「它是分包所以能热更」不再是有效论证。
- `shared` 若将来体积成问题可拆 `shared-ui` / `shared-config`，**拆分不改变它的层**——拆的是体积，不是判据。
- 重启层的更新成本被显式承认：框架代码改动 = 整包重发。这也是 [[adr-0001]] 那条「AOT 缺代码」约束仍然必须存在的原因——热更下来的业务 bundle 与重启层的 API 表面必须对得上，靠 `coreApiHash` 闸守（[[adr-0007]]）。
- 闸的位置随之定死：compat 判定必须在**加载第一个业务 bundle 之前**，而不是在 `apply` 之前（web 路径没有 apply 这个时机）。见 [[app]] 决策 #8。

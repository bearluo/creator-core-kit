---
状态: 已接受
日期: 2026-08-07
依赖: docs/adr/0001-cross-bundle-singleton-and-aot-hotupdate.md, docs/adr/0009-bundle-layering-criterion.md, docs/adr/0011-server-framework-split-and-protocol-contract.md
---

# ADR-0014：业务地基单独成 bundle，跨 bundle 共享代码靠 bundle 优先级

> 摘要：AOT 与功能模块之间补一层 `foundation` bundle，承载协议 / 登录 / 认证 / 模块清单等业务地基；
> 它启动期加载、常驻不卸、**可热更不重启**。跨 bundle 共享代码不复制，靠优先级归属保证唯一。
> 何时读：往 demo 加「所有模块都要用」的东西时、决定某段代码放哪一层时、改 bundle 优先级前。

## 背景

[[adr-0009]] 定了三层分层判据，推论是「main 包瘦身到只剩 `Boot.scene` + `Bootstrap.ts` + `AppConfig`」。实践中这条推论**没有守住**：

- 协议接线（`PbSchema` + 契约基础段）躺在 `assets/scenes/kit-net.ts` → 进 main 包；
- 登录 / 首帧认证刚接进来时也放在 `assets/scenes/kit-auth.ts` → 同样进 main 包；
- 模块清单 `module-catalog.ts` 与模块契约 `ModuleContext.ts` 挂在 `lobby` bundle 里 → 每个功能模块都得反向 import 大厅。

后果很具体：**服务端契约升一个版本、加一个 cmd、换一种登录方式、上线一个新模块，客户端都要发新包**。而这恰恰是整个工程里变得最勤的一层——比玩法模块勤得多。

同时有个容易踩的认知陷阱：[[adr-0001]] 实测的是「**单 bundle 出包**依赖全内联 → 同一个类复制成多份」。这个结论很容易被推广成「跨 bundle import 值一定会复制」，进而得出「地基只能暴露 type 和常量、有行为的代码一律走 DI」这种过度设计的结论。实际规则是：**普通出包下，被多个 bundle 引用的资源归属优先级最高的那个 bundle；只有优先级相同才会各复制一份。**

## 决策

### 1. 新增 `foundation` bundle，承载业务地基

`assets/foundation/`：协议注册表与框架段、长连接、登录与首帧认证、网关退休搬家、模块清单、模块契约、跨模块事件。判据是「**所有模块都要用，且它自己不是玩法**」。

demo 的 `assets/` 因此变成三层，目录即分层：

| 层 | 目录 | 换它要 |
|---|---|---|
| ① AOT | `assets/boot/`（`Boot.scene` / `Bootstrap.ts` / `app-config.ts` / 启动界面 / `foundation-api.ts`） | 发新包、重启 |
| ② 地基 | `assets/foundation/` | **热更，不重启** |
| ③ 模块 | `assets/modules/*` | 按需 load / release |

### 2. 加载时机必须在 `hotupdate` **之后**

地基本身就是热更内容，先更新再加载，拿到的才是新版本。所以它排在 `shared` 阶段（`hotupdate` 与 `lobby` 之间），**长连接与认证跟着一起后移**。

留在 ① 的只剩「热更自己要用的东西」：dispatcher 地址、`protoVersion`、版本号、渠道、启动界面。dispatcher 地址躲不掉——要先握手才知道 `cdnUrl`（热更内容基址），鸡生蛋。其余服务端地址进 `foundation/server.ts`，换环境热更即可。

### 3. bundle 优先级阶梯：地基高于一切业务包

| bundle | priority |
|---|---|
| `foundation` | **6** |
| `shared` | 5 |
| `lobby` | 3 |
| 功能模块（shop / mail / mini-clicker / mini-dodge） | 1 |

`foundation` 高于所有引用它的包 → 它的代码归属它自己，模块引用的是**同一份**，热更地基对已装模块立即生效。同时低于内置的 `main`(7) / `resources`(8) → 不会反过来把 AOT 框架代码吸进热更包。

于是模块可以**正常 `import` 地基的函数与常量**，不必为了怕复制而全走 DI。

### 4. 主包只能通过 `import type` + `js.getClassByName` 桥接地基

主包 `import` 地基的任何**值**，都会让那段代码被判给主包（优先级最高者赢）→ 地基进 AOT → 热更失效。所以接缝定死为 `assets/boot/foundation-api.ts`：一个 `interface`（`import type`，编译期擦除）+ 两个主包自己的字符串常量（bundle 名、类名）。运行时 `js.getClassByName('DemoFoundation')` 取类——`@ccclass` 在 bundle 加载执行脚本时已把它注册进 cc 类表，这是引擎原生的跨 bundle 通道，不必自建 `globalThis` 注册表。

`@ccclass` 用在**非 `Component`** 类上同样会注册进类表（已实测），所以地基入口不必是组件、不必配一个只为承载它而存在的 prefab。

## 依据（真实构建产物，非推断）

`web-mobile` 构建（debug、不压缩）后 grep 产物：

- `schema` / `auth` / `connect` / `migration` / `catalog` / `ModuleContext` / `events` / `Foundation` 这 8 个模块，`System.register` **只出现在 `assets/foundation/index.js` 一处**，`mail` / `lobby` / `mini-dodge` 里一份副本都没有；
- `mail/index.js` 里 `MailVM.ts` 的依赖数组是 `[…, './schema.ts']`，`codeName` 只有调用点、没有函数体 → 引用式共享成立；
- `main/index.js` 里与地基相关的只有两个字符串（`'foundation'`、`'DemoFoundation'`），`foundation-api.ts` 的 `interface` 被完全擦除；
- 对照组：`ERROR_CODE_OK` 出现在 `foundation` 与 `mini-clicker` 两处——后者是 `clicker-proto.ts`（模块自带的契约段副本，[[adr-0012]] 的设计），不是内联复制。

## 后果

- 正面：契约升级 / 换登录方式 / 上线新模块，热更 `foundation` 即可，不发包；模块不再反向依赖 `lobby`；`assets/` 目录结构直接表达了「改它要付什么代价」。
- 负面：多一层加载步骤与一处 `js.getClassByName` 桥接；**主包不得 import 地基的值**这条约束靠人守（现只在 `foundation-api.ts` 与 Bootstrap 的注释里写明，无自动检查）；bundle 优先级成了架构约束的一部分，改动前必须回来读本条。
- 排序代价：长连接与认证后移到热更之后，启动路径上「dispatcher 握手 → 热更 → 连接 → 认证」的间隔变长；换来的是这几段代码可热更。

---
状态: 已实施
日期: 2026-08-07
依赖: docs/adr/0009-bundle-layering-criterion.md, docs/adr/0014-foundation-bundle-and-priority-sharing.md
---

# `apps/demo/assets/` 目录重整（v2）：分层与马甲是两个维度

> 摘要：皮肤（马甲）引入后，`skin-base/` `skin-vest/` 与 `boot/ foundation/ modules/` 平铺在同一层，
> 把「改它要付什么代价」和「哪个马甲」两个正交维度压在了一起。本次把马甲收进 `skins/<马甲>/`，
> **皮按跟随者拆包**（一个跟随者一个皮包），并定死四条归位判据。
> 何时读：往 `apps/demo/assets/` 加目录前、给一个新界面找位置时、加一个马甲时、给一个模块加换皮时。

## 动机

ADR-0009 / ADR-0014 定的是**纵向分层**：AOT → 地基 → 模块，判据「改它要付什么代价」。
马甲换皮加进来的是**横向维度**：同一份代码、同一个分层，按包分出 N 张脸。

两者平铺的后果很具体：

- `assets/` 根下 `skin-a/ skin-b/ … skin-n/` 会淹掉分层目录 —— 真实马甲是 5~20 个量级；
- 「一个界面的脸在哪」变成看情况：mail/shop 在模块里、login 在皮肤包里，没有判据只有先例；
- `foundation/ui/` 在脸搬走之后只剩两个 login 文件，再加公告 / 强更提示就是一锅粥。

还有一条更贵的：**一个马甲一个大皮包，等于把按需分包退回全量下载**。皮包随 `shared` 在启动期装，
里头却装着所有模块的脸 —— 玩家永远不点的商城、小游戏，它们的界面也算进首包体积和流量；
改一张脸要重下整包。分层这一维辛苦拆出来的按需装卸，被横向这一维一把抹平。

## 目标结构

```
apps/demo/assets/
├─ boot/              ① AOT —— 发新包、重启
│    Boot.scene · Bootstrap.ts · app-config.ts（含 VEST）· foundation-api.ts · LaunchOverlay.{ts,prefab}
├─ foundation/        ② 地基 bundle（priority 6）—— 热更、不重启；**只有逻辑，没有脸**
│    Foundation.ts · catalog.ts · ModuleContext.ts · events.ts · server.ts
│    net/{schema,connect,auth,migration}.ts
│    login/{LoginView.ts,LoginVM.ts}          ← 一个功能一个目录
├─ modules/           ③ 功能模块 —— 按需 load / release
│    lobby/ mail/ shop/ mini-clicker/ mini-dodge/     逻辑 + **不换皮**的资源
├─ shared/            跨模块共享资源（priority 5）—— **所有马甲都一样**的那些
├─ skins/             马甲维度（`skins/` 和 `skins/<马甲>/` 都**不是** bundle —— bundle 不能嵌套）
│    base/                                    demo 自己这个马甲
│      foundation/ → `skin-base-foundation`（priority 2）  login/Login.prefab
│      lobby/      → `skin-base-lobby`（priority 1）       LobbyPanel · LobbyItem
│      mail/       → `skin-base-mail`（priority 1）        Mail.prefab
│    vest/  → `skin-vest-*`（示例马甲）        同名同路径，各画各的
└─ probes/            运行时验证探针
```

**一个跟随者一个皮包，皮的分包边界 = 跟随者的分包边界** —— 于是加载时机自动对齐：

| 皮包 | 跟着谁 | 什么时候在内存里 |
|---|---|---|
| `skin-<马甲>-foundation` | 地基层（登录 / 以后的公告、强更提示） | 启动期随 `shared` 装，常驻 |
| `skin-<马甲>-lobby` | `modules/lobby` | 进大厅时装，常驻 |
| `skin-<马甲>-<模块>` | `modules/<模块>` | 打开该模块时装，关闭时卸 |

地基皮包装得下多个 feature（一目录一 bundle，两个目录做不成一个包），所以它里头再按 feature 分格
（`login/Login.prefab`，以后 `notice/`…）；模块皮包只服务一个模块，直接平铺。

目录名 `base` / `vest`，包名靠 meta 的 `userData.bundleName` 覆盖（**已实测生效**：运行时
`assetManager.bundles` 里就是 `skin-base-foundation`）。这样目录里不用把 `skin-` 前缀重复一遍。

**跨模块共用的图集 / 字体放地基皮包**（priority 2 高于模块皮包 1）：被多包引用的资源归属优先级
最高者，同级才各复制一份（ADR-0014 的同一条道理）。地基皮包常驻，所以模块皮包永远能拿到它。

## 四条归位判据

1. **纵向看「改它要付什么代价」**（ADR-0009）：发新包 → `boot/`；热更不重启 → `foundation/`；
   按需装卸 → `modules/<模块>/`。
2. **横向看「哪个马甲」**：同一个界面在不同马甲长得不一样 → 脸进 `skins/<马甲>/<跟随者>/`，
   逻辑留原层。**两个维度不许混在一个目录层级里**。
3. **皮按跟随者拆包**：这张脸跟着谁装卸，就进谁的皮包 —— 地基层的进 `foundation/`，
   模块的进 `<模块>/`。判据不是「长得像一类」，是「同时进内存、同时出内存」。
4. **各套皮同名同路径**（`skins/*/mail/Mail.prefab`）—— 缺没缺一眼可查，美术照着列表做就行。
   包内不按 uiId 平铺：大厅一个 feature 就是两份 prefab，「一个 uiId 一个 prefab」在它身上不成立。

## 决策

| # | 决策 | 为什么 |
|---|---|---|
| 1 | 马甲收进 `skins/<马甲>/`，`skins/` 与 `skins/<马甲>/` 都不是 bundle | bundle 不能嵌套在 bundle 里；父目录只做归类 |
| 2 | 包名用 `bundleName` 覆盖，目录不带 `skin-` 前缀 | 目录读作「哪个马甲的哪个跟随者」，包名读作「哪个皮包」，各自清爽 |
| 3 | **原层不留脸**（地基、模块都一样） | 地基是所有马甲共用的一层，混一张只有某个包用的脸进去 = 别的马甲白下载，改它还要热更整个地基包 |
| 4 | **一个跟随者一个皮包**，不是一个马甲一个 | 皮包的加载时机必须跟着它服务的那一层/那个模块。合成一个大包 = 启动期把所有模块的脸一起下，按需分包白拆了 |
| 5 | 模块换皮登记在 `MODULE_CATALOG` 的 `skinned: true` | 「这个模块换不换皮」是清单事实，写在清单里；`registerUI` 据此把 bundle 解析到皮包。不登记的（shop / mini-*）脸留模块包，所有马甲同一张 —— 换皮的代价是**每套皮都得补齐** |
| 6 | 皮包由**大厅**跟模块包一起装卸，不进 `APP_CONFIG.shared` | 谁按需装模块，谁就按需装模块的皮。`openModule` 并行 load 两个包；关闭时皮包挂进模块的 `BundleScope` 一起 dispose |
| 7 | `shared/` 只放所有马甲都一样的东西；马甲的公共图集进地基皮包 | 换皮的图集 / 字体 / BGM 属于某个马甲；地基皮包 priority 2 > 模块皮包 1，否则各模块皮包各复制一份 |
| 8 | 大厅骨架进皮包，但**不进 UI 注册表** | 它随 `Lobby.scene` 生死、挂场景自己的渲染根、不 open/close 也不分层；塞进注册表只会让 `listUIDefs()` 多两个永不被 open 的条目。它换皮要的只是「去哪个包取」→ `currentSkinBundle('lobby')` |

## 已知行为与坑

- **换皮界面的实例是被皮包那条回收链销毁的。** `BundleScope.dispose()` 的第一步
  `closeByBundle(bundle)` 按 `resolveUIDef` **解析后**的 bundle 比对，而 skinned 模块解析出来的是
  皮包名 → 传模块包名是 no-op。所以 `mountPanel` 里给皮包**另建一个 `BundleScope`** 挂进模块的
  回收链（且必须在 DI 子作用域之后 `add`，teardown 逆序执行 → 界面先销毁）。少这一条就是
  「包卸了、节点还在」的孤儿组件。
- **模块皮包必须和模块包一起 load。** `IAssetSource` 不会自动装 bundle（`requireBundle` 直接抛），
  UIManager 只按解析结果取 prefab、不管包在不在。脚本在模块包、脸在皮包，两个都得先到位。
- **prefab 生成描述别漏 `comp`。** 皮包里的 prefab 靠 classId 找脚本类，`build-prefab.js` 的
  `comp` 字段就是挂它的地方。漏了 → prefab 能加载、界面能显示，但没有任何行为
  （按钮不响应、`onShow` 不跑），且**不报错**。vest 的邮件皮就踩过一次。

## 未做（留给真需求）

- **启动界面换不了皮**：`LaunchOverlay.prefab` 序列化进主包（热更之前就要显示），只能发新包换 ——
  这与它在 ① 层的定位一致，不是缺陷。
- **马甲文案**：i18n 表在 `shared/shared-i18n.json`。马甲改文案的路子是皮包里带一份同名表、
  在 shared 之后加载覆盖；`I18n.addTable` 的合并语义要先确认，没需求前不动。拆包之后这件事也跟着
  拆：地基文案进地基皮包、模块文案进模块皮包（`BundleScope.i18n` 本来就是按 bundle 装卸的）。
- **shop / mini-\* 还没换皮**：`skinned` 留空，脸在模块包里、所有马甲同一张。要换就照 mail 的样子
  加一行 + 给每套皮补一份 prefab —— 机制已通，剩下的是美术工作量。
- **马甲换服**：见 `foundation/server.ts` 的注释（各马甲发各自的地基包 / 由 dispatcher 握手下发）。

## 迁移记录（本次已做）

1. `assets/skin-base/` → `assets/skins/base/`，`skin-vest/` → `skins/vest/`；两个 meta 加 `bundleName`。
2. `assets/foundation/ui/` → `assets/foundation/login/`，`test/foundation/ui/` 跟着镜像改名；
   皮肤包内 `ui/` → `login/`。**meta 一起搬**：脚本 uuid 变了两套皮的 prefab 组件引用会全断
   （已验证 uuid 未变、组件仍挂上）。
3. 大厅脸搬进皮肤包：`modules/lobby/{LobbyPanel,LobbyItem}.prefab` → `skins/base/lobby/`，
   并给 `skins/vest/lobby/` 生成一套（红金、「玩 什 么 / 挑一个开始」）—— 这就是「每套皮都得补齐」的实价。
4. `LobbyHost` 去掉两个 `@property(Prefab)`（**组件现在一个可配属性都没有**），改由
   `LobbyNav.enterLobby` 从 `currentSkinBundle()` 按 `lobby/LobbyPanel`、`lobby/LobbyItem` 取；
   `Lobby.scene` 里那两个已失效的序列化引用一并清掉。皮肤包在启动期随 `shared` 装好，这里是命中缓存。
5. **皮按跟随者拆包**：`skins/<马甲>/` 不再是一个 bundle，改成 `foundation/`（priority 2）
   + `lobby/` + `mail/`（priority 1）各自成包；`skinBundle()` → `skinBundle(owner)`；
   `APP_CONFIG.shared` 只留 `skin-<马甲>-foundation`。`CatalogEntry` 加 `skinned`，
   `registerCatalogUIs` 据此把 bundle 解析到皮包；`LobbyNav` 负责大厅皮包的加载与模块皮包的配对装卸。
   邮件拿来做实证：`modules/mail/Mail.prefab` → `skins/base/mail/`，另给 vest 生成一份（「信 箱」）。
   `scripts/prefab-gen/*.prefab.json` 一并按皮包改名 + 修掉早就过期的 `url`。
6. 验证：两套皮各跑一次完整启动 + 开关邮件（浏览器预览 0 error）——
   - **启动只装 `skin-<马甲>-foundation`**，lobby / mail 的皮都不在内存里；
   - 进大厅 → 多出 `skin-<马甲>-lobby`（`base`「大厅 · Lobby」/ `vest`「玩 什 么」）；
   - 开邮件 → 多出 `mail` + `skin-<马甲>-mail`，`MailView` 挂上、VM 跑起来（标题被改写成「邮件（空）」），
     文案各是各的（`base`「关闭 / 加载更多」，`vest`「收起 / 再翻几封」）；
   - 关邮件 → 两个包**都卸**、`Mail` 节点销毁（这一条正是在验皮包那条回收链）。

   五门齐过（636 测试）。

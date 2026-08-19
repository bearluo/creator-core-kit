---
状态: 已接受
日期: 2026-08-19
依赖: docs/adr/0001-cross-bundle-singleton-and-aot-hotupdate.md, docs/adr/0010-no-restart-bundle-code-swap.md, docs/adr/0013-native-per-bundle-hotupdate-layout.md
---

# ADR-0015：热更检查/下载失败一律中止，不再退回包内版本

> 摘要：三条更新路径（native base / native 分包 / web 版本表）统一为「更新不成就 reject」。
> **取代 [[adr-0013]] 决策 6 的「`ensureLatest` 永不 reject」**。版本闸拒绝单独分类为
> `needFullUpdate`，与网络错分开。
> 何时读：改 `BundleUpdater` / `BundleManager.load` 的错误处理时、排查「玩家在玩旧版」时。

## 背景

三条路径原本给出三种答案：

| 路径 | 原行为 |
|---|---|
| native base（`HotUpdateService.check`） | `throw` → 中止启动·可重试 |
| native 分包（`BundleUpdater.ensureLatest`） | warn → 用包内版本继续（ADR-0013 决策 6） |
| web 版本表（`App` 的 `hotupdate` 步） | warn → 用包内 `bundleVers` 继续 |

后两条的理由都是同一句：「热更失败让玩家进不去游戏，比不热更严重得多」。这句话看着稳妥，但**它成立的场景并不存在**：

1. **CDN 挂了根本走不到分包这一步**——base check 用的是同一个 CDN、同一个 base URL，它已经先把玩家挡住了。分包降级唯一能救的是「base 的 CDN 通、分包的 CDN 不通」，而两者是同一个地址。
2. **降级把发布事故伪装成正常**。CDN 少传了一个 bundle 的 manifest、版本表没部署上去——这些是发布事故，静默退回包内版本的结果是「线上玩家在玩旧版，没人察觉」，直到有人报「我怎么还是老界面」。
3. **包内那份未必存在**。从没随包发过的新模块 / 新马甲皮走种子 manifest 全量下载，本地没有旧版可退——降级只是把失败从 `ensureLatest` 推迟到 `loadBundle`，报错更难查。
4. **web 上前提更弱**：版本表与页面同源。页面 + 一堆 js 都拉下来了却少这一个 json，几乎只有一种解释——它没被部署上去。

而「客户端太旧、协议对不上」不归这条链管：那是 `dispatch` 步握手时服务端按 `appVersion` / `capabilityStamp` 判的（`action: update` → `needFullUpdate`），**排在所有更新之前**；包内 AOT 与包内 bundle 是同一次构建的产物，天然配套，不存在「新 AOT 配旧 bundle」的错配。

## 决策

### 1. 三条路径统一「失败即中止」

- `BundleUpdater.ensureLatest`：后端创建失败 / check 失败 / 下载失败 / 未就绪，一律 reject。
- `BundleManager.load`：**不再** try/catch 吞掉 updater 的异常，原样抛给调用方。
- `App` 的 `hotupdate` 步：版本表拉不到不再降级，直接抛。

落到玩家侧：启动期 → 启动失败页（`classify` 归 `network`·可重试，`retry()` 只重跑失败那一步）；运行期打开模块 → 打开失败（调用方自己接住并提示）。

### 2. 唯一的 no-op 是「平台没有热更后端」

`factory` 未注册（web / 编辑器）时 `ensureLatest` 原样返回。那不是失败，是这条路不存在。

### 3. 版本闸拒绝单独分类为 `needFullUpdate`

闸拒 = 「该发整包了」，跟网络错不是一回事。分包闸拒时抛的 Error 挂结构标记
`__cckLaunchFailure: { kind: 'needFullUpdate', reason }`（结构标记而非 Error 子类——跨 bundle
`instanceof` 不可靠，见 [[adr-0001]]），UI 才能引导去商店 / 刷新页面，而不是让玩家对着「重试」徒劳点。

### 4. 失败的那次不留缓存

`ensureLatest` 用 `Map<string, Promise<void>>` 去重并发。失败时必须把条目删掉——否则「重试」拿到的是同一个已 reject 的 promise，**重试永远不动**。

## 后果

- 发布事故会在第一时间以「玩家进不去 / 打不开模块」的形式暴露，而不是沉默半天。
- 弱网下玩家可能被挡在启动页——但这与 base 更新的既有行为一致，且有重试按钮。真要「离线可进游戏」是另一件事（把「检查失败」降级成「无更新」属启动序列的语义改动，见 `docs/progress.md` 的开放项），不能靠分包偷偷降级凑出来。
- 调用 `BundleManager.load` 的业务代码**必须**接住失败（demo 的 `LobbyHost.openModule` 已补 `.catch`），否则只剩「点了没反应」。

## 备选（否掉）

- **保留分包降级、只挡 base 与版本表**：三条路径三种语义，读代码的人得逐条记；而降级救不了任何真实场景（见背景 1）。
- **加一个「允许降级」开关**：把「这次发布是不是事故」的判断推给配置，没人会去调它，默认值决定一切。

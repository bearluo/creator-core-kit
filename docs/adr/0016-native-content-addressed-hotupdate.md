---
状态: 已接受
日期: 2026-08-20
依赖: docs/design/2026-08-20-native-md5-content-addressing-proposal.md, docs/adr/0013-native-per-bundle-hotupdate-layout.md, packages/core/docs/modules/hotupdate-service.md, packages/core/docs/modules/bundle-manager.md, apps/demo/docs/hotupdate-pipeline.md
---

# ADR-0016：native 热更走内容寻址 —— 版本从 bundle 自己的 manifest 反推

> **决策 4（base manifest 恒空）与「AOT 层只能整包更新」那条后果已被 [[adr-0017]] 取代**：
> `main.js` 是我们自己的模板，入口名改成运行时读固定名指针之后 AOT 可热更、重启生效。
> 其余决策全部有效。

## 背景

native 一直不开 `md5Cache`，所有文件同名不同内容。三个后果：CDN 只能 no-store（热更恰是「同一批
文件被大量设备同时拉」的场景，命中率结构性为 0）；发布是覆盖式的，上一版的字节在 CDN 上已不存在，
回滚必须重新出包；即使重新传上去也不生效——引擎默认 `cmpVersion` 把「远端号更小」判成本地已最新，
**静默跳过**。

web 侧没有这三个问题，因为它天然内容寻址（`index.<md5>.js`）。

2026-08-05 的 ADR-0013 当时**否决**了 native 开 md5，理由是引用链会把「改一个模块」传导成「必须发
整包」（`settings.bundleVers` 变 → `settings` md5 变 → `application.js` 变 → 不可热更的 `main.js` 变）。
2026-08-20 的实测推翻了这个前提的关键一环：**只要客户端不吃 `settings.bundleVers`、改吃显式版本，
模块改动就不再传导** —— 客户端手上那套 `main.js`/`application.js`/`settings.json` 保持自洽即可，
它们描述的是包内那份 AOT，本来就该跟 APK 走。

## 决策

1. **native 出包开 `md5Cache`**，与 web 同构。
2. **bundle 的加载版本从它自己的 manifest 反推**，不引入第二张版本表：`<bundle>.manifest` 的 asset
   key 里就写着 `assets/<b>/index.<md5>.js`，而 `AssetsManagerEx` 更新成功后
   `_localManifest = _remoteManifest` —— 更新刚跑完，manifest 就是这个 bundle 内容的权威描述。
   落地为 core 的纯函数 `bundleVersionFromAssetKeys` + 后端可选方法 `IHotUpdateBackend.assetKeys?()`。
3. **`BundleManager` 的版本解析挪到 `ensureLatest` 之后**，优先级
   `opts.version ?? updater.versionOf?.(name) ?? versions[name]`（显式 > native 反推 > web 版本表）。
4. **base manifest 的 asset 表恒空**（`cck-manifest --md5`）：`src/**` 与 AOT 包的引用者在产物根、
   结构性不可热更，下发也没人读；`jsb-adapter/` 读得到，但它与 `libcocos.so` 里的 C++ 绑定层是同一次
   引擎构建的两半，换它不换 `.so` 就崩在绑定层，只能随包发。**代价是 AOT 层（引擎 JS + `assets/boot`）
   从此只能整包更新。**
5. **CDN 改叠加式发布 + 每版归档 `releases/<version>/`**；回滚 = `cck-manifest rollback`
   把归档那版的 manifest 配一个**更大**的号发回根，内容文件不重传。
6. **不注入 `setVersionCompareHandle`**。看起来「不等即更新」能修回滚，实则同一个 handle 还服务
   `loadLocalManifest` 的 `versionGreater`（包内 manifest 比缓存新 → 清掉旧热更缓存），
   改了会让新装的 APK 永远被上一版热更缓存盖住。发布侧守「版本号只增」。
7. **回滚只改内容真变了的那几份 manifest**。与 `--prev` 同一条不变式：**「版本号变了」必须蕴含
   「内容真变了」**，否则客户端判 NEW_VERSION 而 `genDiff` 空表 → worker 线程 SIGSEGV。
8. **APK 换了就把热更缓存整个作废**（`resetCcHotUpdateOnAppChange()`，须早于 kit 装配），
   判据是主包 md5 `settings.bundleVers.main`；判不了（没开 `md5Cache`）就原样不动。

## 后果

**正面**

- CDN 可 immutable 长缓存；新旧版本天然共存，更新中的老客户端不会被新发布抽走文件。
- 回滚不必重新出包、不必重传内容 —— 换一份 manifest 即可（真机验证通过）。
- `--prev` 真正生效：base 不再每次发布必涨版本（实测改一行 foundation 代码，只有
  `foundation.manifest` 从 1.0.0 涨到 1.0.1，`project.manifest` 原地不动）。
- app 戳 `assets/resources/cck-app-compat.json` 落在 AOT 包里、已被排除出 base manifest →
  **不可能被热更改动**，严格等于「这个 APK 的身份」，版本闸的这一端不可伪造。
- **与 `libcocos.so` 绑定的东西一个都不再下发**（`cc.<md5>.js`、`jsb-adapter/*.js`）→「热更换了 JS 侧、
  与包内 `.so` 绑定签名不匹配」这条老风险面清零。它本就是 `coreApiHash` 闸够不着的一层。
  这条老风险随之消失。

**负面 / 风险**

- **AOT 层只能整包更新**，失去「紧急修 boot 层 bug 不发包」。缓解：要能热修的逻辑本就该放
  `foundation`（热更层），boot 只留「起进程 + 找到 foundation」。这与既有分层定义一致。
- CDN 会累积历史版本，需要一条「按时间保留 N 版」的清理策略（与 web 同题，尚未做）。
  设备侧不会无界增长——`updateSucceed` 按 diff 删旧文件。
- 决策 6/7/8 都是**发布纪律的形式化**：纪律被绕过时的失败模式分别是「新包被旧缓存盖住」、
  「worker 线程 SIGSEGV」、「装完新包启动报错」。三条都已落成代码里的守卫或注释，别再手工绕开。

## 验证

真机（Android 模拟器）四条 e2e 全过：① md5 包冷启动到 `LoginView` + 长连接；② 改一行 foundation
代码、**只传 CDN 不出 APK** → 重启后新代码真的生效（这是整条改造的判据，也正是改造前会静默失效的
那一点）；③ `rollback` 后回到旧代码、旧 md5 文件被 `genDiff` 删掉；④ 覆盖安装 AOT 不同的 APK →
热更缓存被作废，且第二次冷启动**不**误清。

决策 7 是③的第一版实现真机崩出来的（全部 manifest 无脑涨号 → 空 diff → SIGSEGV），已补回归测试。

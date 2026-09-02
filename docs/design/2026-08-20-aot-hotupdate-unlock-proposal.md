---
状态: 已实施（2026-08-20，真机 e2e 五条全过；决策沿革见 ADR-0017）
摘要: 解开 L1-A —— native 的 AOT 层（业务代码 + 主包资源 + settings）从「只能发 APK」变成「热更下发、重启生效」。手段是把 main.js 里写死的 `application.<md5>.js` 换成一个固定名指针，由热更下发；引擎绑定的那几类照旧一个都不发。
何时读: 想知道 AOT 为什么曾经不可热更 / 现在凭什么可以了；改 `index.ejs`、`hot-update-manifest` 的 base 集合、或 APK 换代判据之前。
依赖: docs/adr/0016-native-content-addressed-hotupdate.md · docs/adr/0006 · apps/demo/docs/hotupdate-pipeline.md · packages/core/docs/modules/hotupdate-service.md · packages/tools/docs/modules/hot-update-manifest.md
---

# 提案：解开 AOT 热更（L1-A）

## 动机

ADR-0016 开了内容寻址，代价写在决策 4 里：**base manifest 的 asset 表恒空，AOT 层只能整包更新**。
理由是「下发了也没人读」——引用 AOT 的是产物根上的 `main.js` / `application.<md5>.js`，客户端手上
那份写死的永远是出包那天的 md5 名。

这个理由只对了一半。`main.js` **确实**不可热更（它跑在搜索路径还原之前，还原本身就是它干的），
但**它是我们自己的模板**（`apps/demo/build-templates/native/index.ejs`，Creator 3.8 官方覆盖点）——
里面那句 `System.import('<%= applicationJs %>')` 是构建期插值，不是引擎硬编码。而它执行时，
搜索路径**已经还原完了**。

于是：只要入口名不在构建期写死、改成运行时从一个**固定名**文件里读，整条 AOT 链就活了。
这正好落在用户定的分界线上——**「AOT 改动重启就生效，引擎指纹变才要发 APK」**。

## 现状：锁在哪一环

```
main.js                       L0  搜索路径还原本身 → 永远只能随 APK
 ├─ require src/system.bundle.<md5>.js      L1-N  名字写死在 main.js
 ├─ read    src/import-map.<md5>.json       L1-N  + 兼任引擎身份凭据
 └─ System.import('./application.<md5>.js') L1-A  ← 唯一的锁
      └─ settingsPath = 'src/settings.<md5>.json'
           ├─ scripting.scriptPackages = ['../chunks/bundle.<md5>.js']   全部业务代码
           ├─ assets.bundleVers.{main,resources,internal,…}
           └─ rendering.effectSettingsPath = 'src/effect.bin'            L1-E
```

## 变更总览

| # | 变更 | 落点 |
|---|---|---|
| 1 | AOT 入口改成**运行时解析**：读固定名 `src/cck-aot.json`，读不到 / 坏了 / 指向的文件不存在 → 退回构建期烘的名字 | `apps/demo/build-templates/native/index.ejs` |
| 2 | 构建后生成 `src/cck-aot.json`，并把根上的 `application.<md5>.js` 显式喂给 manifest | `apps/demo/scripts/build.mjs` + `ManifestOptions.files` |
| 3 | `contentHashed` 语义翻转：base 从「恒空」变成「**只丢引擎绑定 / 名字写死那几类**」 | `packages/tools/src/hot-update-manifest.ts` |
| 4 | APK 换代判据换源：从**运行时** `settings.bundleVers`（现在可热更了，会自噬）换成 `main.js` 暴露的**构建期烘死的**入口名 | `packages/engine/src/hotupdate-backend.ts` + `index.ejs` |

重启那一段不用改：`app.ts` 的 `hotupdate` 步 apply 完就 `restart()` + `halt`，一直是这么写的，
只是 base manifest 恒空让它从没触发过。

## 目标：base manifest 里有什么

| 进 base（热更下发） | 不进 base | 为什么 |
|---|---|---|
| `application.<md5>.js`（根） | | AOT 入口，指针指向它 |
| `src/cck-aot.json` | | 指针本身，固定名 |
| `src/settings.<md5>.json` | | AOT 配置 |
| `src/chunks/**` | | 全部业务代码（core / engine / boot） |
| `assets/main/**` | | 启动场景与 AOT prefab |
| `assets/resources/**` | | 钉子仓 + app 戳，见决策 D3 |
| `assets/internal/**` | | 引擎内置资源，见决策 D4 |
| | `src/cocos-js/**` · `src/effect.bin` · `jsb-adapter/**` | L1-E：与 `libcocos.so` 是同一次引擎构建的两半 |
| | `src/system.bundle.*.js` · `src/import-map*.json` | L1-N：名字写死在 `main.js` 里，且 import-map 兼任引擎身份凭据 |
| | `assets/<模块包>/**` | L2：各自一份 manifest，免重启 |

## 决策

| # | 决策 | 理由 | 否掉的替代 |
|---|---|---|---|
| **D1** | 指针是**独立固定名文件** `src/cck-aot.json`，不复用 `project.manifest` | manifest 说「有哪些文件」，指针说「从哪进」，两件事。且 `manifestFilename` 是可配项，接入方改了名 `main.js` 就读不到；指针属**产物结构**，与热更协议解耦 | 从 base manifest 的 asset key 正则反推入口名（省一个文件，但把启动耦到热更协议的文件名上，且几百 KB 正则扫在冷启动路径上） |
| **D2** | 指针失效**一律退回包内烘的名字**，不抛 | 黑屏是最坏结果。指针坏 / 文件缺 → 退回包内 AOT 启动，下一轮 check 会重下 | 抛错让玩家看见（换来一块黑屏） |
| **D3** | `assets/resources` **进** base，app 戳因此变得可热更 | AOT 可热更之后这是**必须**的：热更换掉 `chunks/bundle.js` = 换掉了 core，戳若冻在 APK 身份上，`coreApiHash` 闸会开始拒绝本来正确的模块更新。戳描述的应当是「当前这套代码的身份」。引擎身份不受影响——`AppInfo.engineHash` 运行时取自 SystemJS import map（L1-N，热更够不着），伪造不了 | 把 resources 排除在 base 外（则 `settings.bundleVers.resources` 会指向本地不存在的目录 → 冷启动崩） |
| **D4** | `assets/internal` 也进 base | 成本为 0：它只随引擎模块开关变，而那时 `cc.<md5>.js` 一起变 → 引擎指纹闸把整个更新拒成「发 APK」，那份新 internal 永远不会被下发。放进去换来 `settings` 自洽 | 排除它（同 D3，`bundleVers.internal` 悬空） |
| **D5** | APK 换代判据从 `settings.bundleVers` 换成 `main.js` 暴露的构建期入口名 | **不换会自噬**：AOT 一热更，运行时 `settings` 就是更新下来的那份 → 指纹与 localStorage 里存的不同 → 把刚下好的缓存整个删掉 → 下轮重下 → 死循环。烘在 `main.js` 里的名字属 L0，热更改不了，正是「这个 APK 的身份」 | 读 APK 内那份 settings（要绕开搜索路径 + 猜 md5 文件名，脆） |
| **D6** | `system.bundle` / `import-map` **继续**写死，不给指针 | 它们只随 Creator 版本变，而那时引擎指纹闸已经把更新拦成整包了 —— 解开零收益；import-map 还兼任引擎身份凭据，能热更就等于闸可伪造 | 一并指针化 |

## 测试计划

| 层 | 用例 |
|---|---|
| tools 单测 | `files` 选项：收根上散文件 / 不存在的跳过 / key 相对 root；`contentHashed` 下 base **不再恒空**：留 `application.*.js` + `src/settings.*` + `src/chunks/**` + `assets/{main,internal,resources}/**`，丢 `src/cocos-js/**` + `src/effect.bin` + `src/system.bundle.*` + `src/import-map*` + `jsb-adapter/**`；`isEngineBound` 逐条边界 |
| engine 单测 | `aotStamp` 换源后：拿到烘名 → 稳定；换 APK（烘名变）→ 判换代；拿不到 → 休眠不动 |
| 产物验证 | 出一次 md5 包，`project.manifest` 里有 `application.*.js` / `src/cck-aot.json` / `src/chunks/**` / `assets/main/**`，且**没有** `src/cocos-js/**` / `jsb-adapter/**` |
| 真机 e2e | ① 装基线 APK 冷启动；② **只改 boot 层一行、只传 CDN 不出 APK** → 启动时下载 → 自动重启 → 新代码生效；③ 强杀再冷启动仍是新代码（幂等）；④ 换引擎的 APK → 指纹闸拒绝、不误清 |

## 实施步骤

1. tools：`ManifestOptions.files` + `isEngineBound` + `contentHashed` 语义翻转（先测后码）。
2. engine：`aotStamp` 换源（先测后码）。
3. `index.ejs`：指针解析 + 暴露烘名。
4. `build.mjs`：写 `src/cck-aot.json`、传 `--files`。
5. 文档：模块文档改写为现状 + 本提案标「已实施」+ ADR-0017 + `docs/progress.md`。
6. 真机 e2e。

## 风险

- **半更新**：`AssetsManagerEx` 先下到 `_temp/` 全部完成才 rename，`main.js` 顶部那段补 rename 中断，
  且 D2 的兜底盖住「指针在、文件不在」。
- **base 变大**：从恒空变成含 `assets/main` + `chunks`；首次更新的下载量上去了。这是解锁的必然代价。
- **`--prev` 更常命中不同**：AOT 一动 base 就涨版本，这正是想要的。

---

## 实施结果（2026-08-20）

全部按提案落地，无偏离。决策沿革封存进 [`ADR-0017`](../adr/0017-base-hotupdate-via-fixed-name-pointer.md)，
现状描述在 [`hotupdate-pipeline`](../../apps/demo/docs/hotupdate-pipeline.md) 与
[`hotupdate-service`](../../packages/core/docs/modules/hotupdate-service.md)。

**产物**：`project.manifest` 21 项（入口 + 指针 + settings + chunks + `assets/{main,resources,internal}`），
`cocos-js|effect.bin|jsb-adapter|system.bundle|import-map|main.js` 泄漏 0 条。

**真机 e2e（Android x86_64 模拟器，com.cck.demo）**：

| # | 场景 | 结果 |
|---|---|---|
| ① | 干净装 v1 APK 冷启动 | `BUILD_TAG=v1` → LoginView + 长连接；`APK 换了（AOT cfd3d）` 首次建戳 |
| ② | **改 boot 层一行、只传 CDN 不出 APK**（1.0.0→1.0.1） | 下载 → `AOT 入口取热更版本: ./application.b827c.js` → 重启 → `BUILD_TAG=v2`。**这就是整条改造的判据** |
| ③ | 强杀后冷启动 | 新 PID 仍 `v2`，且**没有**「热更缓存作废」—— 换源后的 `aotStamp` 不自噬 |
| ④ | 覆盖装 v2 APK | 作废一次（`AOT b827c`，两个存储根都删）；第二次冷启动**不**再作废 |
| ⑤ | 连续第二轮 AOT 热更（1.0.1→1.0.2，把标记那行删掉） | 重启后 `BUILD_TAG` 不再打印 —— 热更能删代码，不只是加 |

全程无 FATAL / native signal。③ 是 D5 的直接验证：不换源的话这一步会打出作废日志、把刚下好的
缓存删掉，然后每次冷启动重下再删。

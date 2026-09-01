---
状态: 已接受
日期: 2026-08-20
依赖: docs/adr/0016-native-content-addressed-hotupdate.md, docs/adr/0006-native-android-build-and-hotupdate-e2e.md, docs/design/2026-08-20-aot-hotupdate-unlock-proposal.md, apps/demo/docs/hotupdate-pipeline.md, packages/core/docs/modules/hotupdate-service.md
---

# ADR-0017：base 层走固定名指针，从此可热更（重启生效）

**取代 [[adr-0016]] 的决策 4 与它「base 层只能整包更新」那条后果。** 0016 的其余决策全部有效。

## 背景

ADR-0016 判定 base manifest 的 asset 表恒空，理由是「下发了也没人读」：引用 base 的是产物根上的
`main.js` / `application.<md5>.js`，而客户端手上那份 `main.js` 里写死的永远是出包那天的 md5 名。

这个理由只对了一半。`main.js` **确实**不可热更（它跑在搜索路径还原之前，还原本身就是它干的），
但**它是我们自己的模板**（`build-templates/native/index.ejs`，Creator 3.8 官方覆盖点）——里面那句
`System.import('<%= applicationJs %>')` 是构建期插值，不是引擎硬编码。而它执行时，搜索路径**已经
还原完了**。名字写死是我们自己接受下来的，不是结构性的。

用户对边界的要求也正好落在这里：**base 改动重启就该生效，只有引擎指纹变才必须发 APK。**

## 决策

1. **base 入口运行时解析**。`main.js` 读固定名 `src/cck-base.json` 的 `application` 字段拿入口名；
   读不到 / 不是合法 JSON / 指向的文件不存在（半更新）→ **一律退回构建期烘的名字**，不抛。
   黑屏是最坏结果，退回还能起来、下一轮 check 会重下。
2. **指针是独立文件，不复用 `project.manifest` 反推**。manifest 说「有哪些文件」，指针说「从哪进」，
   两件事；且 `manifestFilename` 是可配项，接入方改了名启动就断，而指针属产物结构、与热更协议解耦。
3. **base manifest 装 base 整条链**：`application.<md5>.js`（经 `ManifestOptions.files` 收，它在产物
   根、子目录遍历够不着）+ `src/cck-base.json` + `src/settings.<md5>.json` + `src/chunks/**` +
   `assets/{main,resources,internal}`。**丢掉的只有 `isEngineBound` 那几类**：`src/cocos-js/**`、
   `src/effect.bin`、`jsb-adapter/**`（与 `.so` 同一次引擎构建的两半）与 `src/system.bundle.*.js`、
   `src/polyfills.*.js`、`src/import-map*.json`（名字写死在 `main.js` 里；`import-map` 还兼任引擎
   身份凭据，能热更就等于版本闸可伪造，**故意不解**）。
4. **`assets/resources` 进 base，app 戳因此随 base 一起更新**。这是必须的：热更换掉
   `chunks/bundle.js` 就是换掉了 core，戳若冻在 APK 身份上，`coreApiHash` 闸会开始拒绝本来正确的
   模块更新。戳描述的应当是「当前跑的这套代码的身份」。真正不可伪造的那一端是**引擎指纹** ——
   `AppInfo.engineHash` 运行时取自 SystemJS import map（决策 3 里故意不解的那一层）。
5. **`assets/internal` 也进 base，成本为零**。引擎没变时它逐字节相同、不产生 diff；引擎变了整个
   更新已被指纹闸拒成「发 APK」。留着它只为让 `settings.bundleVers.internal` 指向的目录一定在本地。
6. **「APK 换没换」的判据换源**：从运行时 `settings.bundleVers.main` 换成 `main.js` 烘进来的
   `window.__cckBaseEntry`（`packagedBaseEntry()` → `baseStamp()`）。不换会**自噬**：`settings` 现在
   随热更走，每成功更新一次 base 判据就翻一次 → 缓存被当成「上一版 APK 攒的」整个删掉 → 下轮重下
   再删，死循环。`main.js` 属 L0，烘在里面的名字是唯一不可伪造的 APK 身份。
7. **出包侧硬闸**：`project.manifest` 里没有 base 入口或没有指针 → 构建失败。少了它，「base 热更
   静默失效」——构建全绿、下发成功、玩家跑的还是包内旧代码，与本仓一贯要消灭的失败模式同类。

## 后果

**正面**

- **紧急修 boot 层 bug 不必发包**了（0016 记为负面后果的那一条）。分层定义随之改写：
  `assets/boot` 从「发新包、重启」变成「**热更、重启**」，`foundation` 仍是「热更、**免重启**」。
  两层的分工没变，只是 boot 那一层的代价从「等应用商店」降到「等玩家重启」。
- **加一张 Creator 内置图不用发 APK**了：钉子仓 `resources` 在 base 里，钉子 prefab 改动随热更走。
- 边界与用户要的完全对齐：**base 重启生效，引擎指纹变才发 APK**。
- `src/effect.bin` 那条老风险（固定名无 md5、下发会破坏 immutable 缓存）由 `isEngineBound` 硬挡，
  不再依赖「反正 base 是空的」这个副作用。

**负面 / 风险**

- **base 从恒空变成 21 项**（本次产物实测），首次更新的下载量上去了；base 一动 base 就涨版本。
  这是解锁的必然代价，不是退化。
- **app 戳可被热更改动**（决策 4）。它不再是「这个 APK 的身份」，任何按那个语义读它的代码都错了。
  版本闸的不可伪造性现在只由引擎指纹担保。
- **指针是固定名文件**，与 `project.manifest` / `*.version.manifest` / `cck-update-compat.json` 同属
  「不可 immutable 缓存」那一类。CDN 给它长缓存的话，玩家会拿到指向旧入口的指针 —— 但失败是**响的**
  （manifest 里的 md5 对不上 → 更新失败），不是静默跑旧代码。
- 决策 6 换源之后，判据比以前**更敏感**（入口名随 `settings` md5 走，而 `settings` 含全部
  `bundleVers`）：新出的 APK 只改了个日志文案也会让老缓存整个作废。换来的是不会出现「新 base 配旧模块」。

## 验证

- tools 单测：`isEngineBound` 逐条边界（含「前缀相近不误伤」）、`files` 收散文件、`contentHashed`
  下 base 的进出清单、`main.js` 永不进表。engine 单测：`baseStamp` 换源后的取值与休眠、`packagedBaseEntry`。
- 产物：`node scripts/build.mjs boot --manifest` 出 md5 包，`project.manifest` 21 项，入口与指针都在，
  `cocos-js|effect.bin|jsb-adapter|system.bundle|import-map|main.js` 泄漏 0 条；渲染出的 `main.js`
  指针段与兜底分支齐全。
- 真机 e2e：见 `docs/progress.md` 对应条目。

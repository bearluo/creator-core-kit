---
状态: 已接受
日期: 2026-08-20
依赖: docs/adr/0017-base-hotupdate-via-fixed-name-pointer.md, apps/demo/docs/hotupdate-pipeline.md, packages/core/docs/modules/hotupdate-service.md
---

# ADR-0018：base 启动看门狗 —— 热更来的 base 起不来时退回包内并隔离那一版

**补 [[adr-0017]] 的一个洞，不改它的任何决策。**

## 背景

0017 把 base 交给热更之后，多出一种**玩家自己救不回来**的失败：下发的 base 起不来（引用了这个
引擎没有的符号、文件半损、某类机型上崩），`main.js` 里 `System.import(...).catch()` 打一行日志
就完事，而作废缓存的 `resetCcHotUpdateOnAppChange()` 在 Bootstrap 里 —— **永远轮不到**。

模拟器实测（把缓存里 `application.<md5>.js` 引用的一个引擎成员改成不存在的名字，等价于
「base 引用了这个引擎没有的符号」）：

- 进程活着、JS 侧什么都没起来 —— 黑屏；
- 连续 3 次冷启动逐字相同；
- **覆盖装另一个 APK 也救不了**（坏文件在应用数据里，不随 APK 走）；
- 只有清应用数据才恢复。

触发条件比「降级安装」宽得多：**APK 一行没换**，CDN 发了个在某类机型上起不来的 base，同样是
永久黑屏。0016 时代 base 不可热更，这个失败模式不存在；它是 base 解锁热更引进来的，且是目前唯一
一个玩家侧无法自救的。

（顺带记录另一场已实测**会自愈**、不需要新机制的：降级安装两个都带指针的包时，缓存里更新的
base 会接管第一次启动，但 Bootstrap 起得来 → `resetCcHotUpdateOnAppChange()` 用包内入口名识破
→ 删缓存 → 同一次启动里重新收敛到 CDN 最新版。代价是一次全量 base 重下。）

## 决策

1. **`main.js` 计数，连续 2 次没起来就隔离**。每次「决定用热更 base」就把 `cck.baseTry` +1，
   **在 `System.import` 之前落盘**（之后再抛就来不及了）。阈值 2 = 给一次重试：半写入、OOM
   这类偶发不该直接判死。
2. **「起来了」的握手 = `resetCcHotUpdateOnAppChange()` 被调到**。它跑在 Bootstrap 早期，
   跑到那儿就证明这套 base 加载成功、cc 初始化完、场景在跑。之后的失败（网络、登录、服务端）
   **不算 base 的账** —— 把握手放得更晚会让一次断网变成「回滚 base」，得不偿失。
3. **隔离态 = 这一次完全当作全新安装**：不还原搜索路径、不认指针、跑包内 base。缓存目录的删除
   交给 `resetCcHotUpdateOnAppChange()`（它知道两个存储根）—— 必须真删，因为
   `AssetsManagerEx.create()` 会把 storagePath 重新前插回搜索链，不删就是包内 base 配缓存里的新模块。
4. **记下被隔离的版本号 `cck.baseBadVersion`，base 的 `check()` 见到同号直接当 up-to-date**。
   不记就会「隔离 → 重下同一版 → 又隔离」三步一轮地振荡，玩家每三次启动只能玩一次。
   **读版本号这一步放在 `resetCcHotUpdateOnAppChange()` 里（删目录之前），不在 `main.js`**：
   版本号写在缓存那份 `project.manifest` 里，而它的位置是 `storagePath` —— 一个可配项
   （`CcHotUpdateOptions.storagePath`）。`main.js` 只够得着硬编码的键，接入方改过路径就会读空，
   于是「记不下 → 拦不住重下 → 照样振荡」，而日志只说一句「版本号读不到」。
5. **只挡 base，不挡分包；判据是 `persistKey` 而不是 `seed`**。分包与 base 共用同一个
   `--version`（`buildSplitManifests` 一次写全部），`--prev` 下内容没变的分包还会沿用旧号 ——
   拿 base 的隔离结论去挡，会把一批分包永久钉死在包内版本，而 `coreApiHash` 闸救不了（它在
   这个分支之前就 return 了）。**「有没有 seed」不是 base 的判据**：随包发 `<bundle>.manifest`
   的分包同样没有 seed，那是常态。只有 base 需要把搜索路径写进 localStorage 供冷启动还原，
   所以 `persistKey !== undefined` 才是。判定抽成纯函数 `baseQuarantineVerdict` 单测。
6. **`cck.baseBadVersion` 在 APK 换了、或远端版本号已经翻篇时清**。新包是一整套新东西，旧结论
   跟着作废；发布方发了新号则标记已无对象，留着只会在某天与另一个复用号的产物撞上。
7. **`cck.baseTry` 的字面量在 `index.ejs` 与 `hotupdate-backend.ts` 里各写一份，`build.mjs` 出包时对一次**。
   `main.js` 跑在 SystemJS 之前，import 不到 TS 侧的常量 —— 与 `HotUpdateSearchPaths` 同属「两处
   必须一致」的既有形态。差别是漏改一处**六道门全绿**、只在真机上几个版本后才发作（握手永不成立
   → 每套热更 base 跑两次就被隔离），所以给了硬闸而不是只留注释。`cck.baseBadVersion` 不再重复
   —— 它现在只由 engine 一侧读写。

## 后果

**正面**

- **没有任何一条路会把玩家卡死**：最坏是退回包内 base（能玩、只是没更新），发布方发新号即恢复。
- 看门狗兜的是**结果**（起不来）而不是成因，所以引擎不匹配、文件半损、机型专属崩溃一律覆盖，
  不需要预先枚举。
- 隔离是**持久且可自愈**的：不振荡、不重复下载，发新号自动放行。

**负面 / 风险**

- **握手点定在 Bootstrap 早期**，此后崩溃看门狗管不着（例如 base 能加载但 `bootCoreKit` 里炸）。
  那种情况仍会卡住 —— 但它同时也是普通 APK 就会有的失败，与 base 热更无关。
- **坏 base 仍要死两次**才隔离。给重试留余量的代价，接受。
- **计数分不清「base 崩了」和「进程在 Bootstrap 之前就没了」**：玩家在加载页切后台被系统回收、
  低内存杀，连着两次正好都落在这个窗口，一版健康的 base 也会被隔离。代价是一次包内回退 + 一次
  全量重下，并且要等发布方发新号才回到热更版本。窗口只有「`System.import` → Bootstrap 早期」
  那一两秒，接受；真要收窄得引入「上次是不是干净退出」的标记，为这个概率不值。
- `cck.baseTry` 的字面量重复，改一处必须改两处 —— 有 `build.mjs` 的闸兜着（决策 7）。
- **握手挂在一个接入方必须自己调的函数上**（`resetCcHotUpdateOnAppChange()`，本来就是 native
  集成的必做项）。忘了调 = 每套热更 base 跑两次就被隔离。没法由 kit 代劳：它必须早于
  `AssetsManagerEx.create()`，而那发生在模块装配期。文档里已是必做项，这里只是把漏掉的代价抬高了。
- 计数写在 localStorage，玩家清数据即复位 —— 这正是想要的（清数据本来就是重来一遍）。

## 验证

模拟器 e2e 六条全过（`com.cck.demo`）：干净装 → 热更到 1.2.1 → 弄坏缓存 base → 冷启动 1/2 死
→ 冷启动 3 `热更 base 连续 2 次没能起来` + 跑包内 + 删两个缓存根 + `1.2.1 起不来被隔离过 →
跳过这一版` + 进登录页 → 冷启动 4 稳态不振荡 → 发布 1.2.2 后自动恢复。
详见 `docs/progress.md` 对应条目。

单测：`baseQuarantined` 逐条边界（含「truthy 字符串不算」）、`baseQuarantineVerdict` 的
skip/clear/proceed（含**分包一律 proceed**）、`manifestVersion` 的坏输入。
`resetCcHotUpdateOnAppChange` 与 backend 的 `check()` 本体走真机 e2e —— 它们依赖
`native.fileUtils` / `sys.localStorage`，按 [[adr-0002]] 不进 cc mock；**能算清的判定都抽成了
`hotupdate-paths` 里的纯函数**，决策 5 那条判据搞错就是被这种抽法挡下来的。

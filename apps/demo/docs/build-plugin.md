# demo · 出包参数注入（`cck-build` 构建插件）

> **状态**：已实现（2026-08-17，命令行 web-mobile 构建实测注入生效）
> **摘要**：把 `VEST` / `appId` / `version` / `channel` / `env` / `dispatcherUrl` 这六个「一个包一个值」的常量从源码里解出来 —— 出包时在构建面板填或命令行传，经 `settings.json` 落到运行时，不填就用源码默认值。
> **何时读**：要出第二个马甲的包、要给 CI 接出包流水线、要往面板上加新的出包参数时。
> **依赖**：`assets/boot/app-config.ts`（值的消费方）、`docs/research/2026-08-17-creator-build-custom-options.md`（五条通道横评与选型）

---

## 为什么需要它

`app-config.ts` 里那六个值躲不掉 AOT 层：`VEST` 要在 `app.launch()` 之前定（第一个界面就要
按它解析皮包），`dispatcher.url` 要在握手前就有，而 `cdnUrl` 正是握手才下发的 —— 鸡生蛋。
但它们又恰恰是**一个包一个值**的东西：出十个马甲的包，改十次源码、构建十次、每次都可能改错一处。

## 三条路

```
① 构建面板       项目里打开「构建发布」→ 面板下方「CCK 出包参数」→ 填 → 构建
② 命令行         --build "platform=android;packages={\"cck-build\":{\"vest\":\"vest\"}}"
③ 什么都不填     跑 app-config.ts 里的源码默认值（= 改造之前的行为）
```

无论哪条，值都经同一条链路落地：

```
options.packages['cck-build']        构建插件读到（extensions/cck-build/builder.js 定义表单）
  → result.settings.cck              onBeforeCompressSettings 钩子写进去（hooks.js）
  → settings.json                    产物
  → settings.querySettings('cck', k) 运行时读（assets/boot/build-config.ts）
  → app-config.ts                    消费
```

**编辑器预览不走构建流程**，`querySettings` 那时必然返回 `null` —— 所以源码里的默认值不是
冗余，它就是开发期用的那一套。

## 字段

| 字段 | 面板控件 | 源码默认值 | 作用 |
|---|---|---|---|
| `vest` | 下拉（base / vest） | `base` | 决定 `skin-<马甲>-<跟随者>` 皮包从哪取 |
| `appId` | 输入框 | `cck-demo` | 本机存储隔离前缀 —— 两个马甲同机装，它不同才不共用游客号 |
| `version` | 输入框 | `1.3.0` | dispatcher 版本闸的输入（低于闸值回 `ACTION_UPDATE`） |
| `channel` | 输入框 | `dev` | 渠道标识，随握手上报 |
| `env` | 下拉（dev / staging / prod） | `dev` | 决定版本表 / manifest 地址怎么拼 |
| `dispatcherUrl` | 输入框 | `http://172.25.50.20:9100/api/Handshake` | 启动握手地址 |

**面板上留空 = 跟随源码默认值。** 这是有意的：默认值只有一处真相（源码），面板不必抄一遍
—— 抄一遍就会漂移，而漂移的表现是「出的包连错了服」，没有任何报错。

## 命令行出多马甲

```bash
CC="C:/ProgramData/cocos/editors/Creator/3.8.7/CocosCreator.exe"

# 马甲 base，正式环境
"$CC" --project apps/demo --build "platform=android;packages={\"cck-build\":{\"env\":\"prod\"}}"

# 马甲 vest，连另一个 dispatcher
"$CC" --project apps/demo --build "platform=android;packages={\"cck-build\":{\"vest\":\"vest\",\"appId\":\"cck-vest\",\"dispatcherUrl\":\"http://another:9100/api/Handshake\"}}"
```

参数多了以后 `packages=` 那串 JSON 很难读，改用 `configPath=<导出的 json>`：从构建面板
「导出配置」拿一份完整的，一个马甲存一份。**冲突时以 `configPath` 里的为准**。

退出码：`36` 成功 / `32` 参数非法 / `34` 构建失败。

## 与热更的关系：能热更，但会重启

`settings.json` 落在 native 产物的 `src/` 下，而 `src/` 整个在 **base manifest**（`project.manifest`）
里 —— 和 `assets/{main,internal,resources}` 同属「换了要重启」那一层。所以这六个值**可以随热更改**，
只是启动序列的 `hotupdate` 步 apply 完会直接 `restart()` 并 halt 掉本轮启动。

真机实测（2026-08-17，Android x86_64 模拟器，全新安装）：

```
07:58:39  马甲皮 → skin='base'        ← 包内 v1，settings.json 无 cck 段 → 落源码默认值
07:58:40  启动阶段 → dispatch          ← 握手放行
07:58:42  启动阶段 → hotupdate 25%…100%   ← 下载 CDN 上的 v2（只有 settings.json 变了）
07:58:45  【restart】马甲皮 → skin='vest'  ← 热更后的值当场生效
07:59:36  【强杀冷启动】马甲皮 → skin='vest'  ← 新进程仍是新值
```

CDN 上 15 个包只有 `project.manifest` 从 1.0.0 涨到 1.0.1（`--prev` 让没改的包沿用旧版本），
所以「值变了」只可能来自那一个文件。冷启动那一程靠 `build-templates/native/index.ejs` 顶部的
搜索路径还原兜住 —— 少了它，进程重开会安静地读回包内的旧 `settings.json`。

**翻 `vest` 时新马甲的皮包会自己下下来**（2026-08-17 实证）：`skin-<马甲>-foundation` 在 `APP_CONFIG.shared` 里，
重启回来那一程 `BundleManager.load` 会先把它更到最新；就算这个皮包**从没随包发过**（包内连它的 manifest
都没有），也会现造一份种子 manifest 全量下下来。

**内容从哪下也不由出包决定**：base 与每个分包检查更新时都自取 remote manifest、把基址改成 dispatcher
握手下发的 `cdn_url` 再灌回引擎（2026-08-18 实证：APK 与 CDN 上的 manifest 全烘死地址，照样更新成功）。
所以换 CDN、灰度分流、把内容挪去另一个域名都只改服务端配置。见
[`ADR-0013` 补充](../../../docs/adr/0013-native-per-bundle-hotupdate-layout.md)。

**但有两个仍然只能发新包**：

- **`dispatcherUrl` 改错 = 砖头包。** 启动序列是 `dispatch` → `hotupdate`，握手失败会
  `abortLaunch`，**根本走不到热更那一步**。想靠热更修一个连不上的握手地址是死循环。
  内容基址改走服务端下发之后，**它是整条热更链路上唯一还烘死在包里的地址** —— 也救不了，
  它是链条起点，没人能告诉你「去哪问」。
- **`appId` 改了丢存档。** 它是本机存储 key 的前缀，换一个等于换一个玩家（游客号、设置全丢）。

其余四个（`vest` / `version` / `channel` / `env`）热更改是安全的。

> ⚠️ 正式启动路径的热更后端是 `Bootstrap.ts` 里的 `ccHotUpdateModule` —— **它在 native 上会让
> 「热更服务器不可达」变成启动失败**（`ERROR_DOWNLOAD_MANIFEST` → `hotupdate` 步 throw →
> LaunchFailure，可重试）。离线要能进游戏的话得把「检查失败」降级成「无更新」，那是 core 启动
> 序列的语义改动。

## 加一个新字段要改三处

1. `extensions/cck-build/builder.js` 的 `options` —— 加表单项，`default` 留 `''`；
2. `assets/boot/build-config.ts` 的 `BuildKey` —— 加进联合类型；
3. `assets/boot/app-config.ts` —— 用 `buildValue('新键', '默认值')` 消费。

再去 `test/boot/build-config.test.ts` 的「六个可注入字段」那条断言里补一个键。

## 已知行为与坑

- **插件是 JS，两边对不上没有编译期报错。** 编辑器扩展跑在 Creator 的 Node 进程里，走不到本仓
  TS 编译链。`builder.js` 的 options 键与 `BuildKey` 不一致时，表现是「面板上填了但不生效」
  —— 那条测试断言是这份契约的唯一守卫。
- **段名 `cck` 写在两处**（`hooks.js` 的 `CATEGORY` 与 `build-config.ts` 的 `CATEGORY`），
  改一处不改另一处 = 静默失效。
- **空字符串一律当「没配」。** 现在六个字段都是字符串且都不需要空值；真出现需要空值的字段，
  给它单独开一条路，别改这条通用规则。
- **`env` 非法值会落回 `dev` 并 `console.error`。** 面板用下拉框限制了，但 `settings.json`
  在产物里是可以手改的，所以运行时再兜一道。
- **改的是 settings，不是编译期常量** —— 死代码剔除不掉。这六个字段是纯数据、不产生分支，
  无所谓；真要按马甲裁代码得走自定义宏（`cc/userland/macro`），见调研文档 §④。
- **`ACCOUNT_LOGIN_URL` 不在这里**，也不该进来：它在地基层（`foundation/server.ts`），换环境
  热更即可 —— 塞进打包期常量等于把一个本来免费的改动变成发包。

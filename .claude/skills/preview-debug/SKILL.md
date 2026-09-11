---
name: preview-debug
description: Use when debugging the demo in Cocos Creator preview — editor Game View or browser preview. Covers the SSH tunnel that makes the server reachable, reloading the preview webview after editing assets/ scripts, the EDITOR-vs-PREVIEW constants that differ between Game View and browser, and where runtime logs can and cannot be read.
---

# 预览调试（Game View / 浏览器预览）

预览**不走构建流程**，所以它跑的是另一套值、另一套加载路径。下面每条都是踩过的，不是推测。

## 开工三件事

```bash
pnpm tunnel                    # ① 服务在别的机器上 → 先转发端口（前台跑，Ctrl+C 停）
pnpm build                     # ② 改过 packages/* → 先出 dist，否则预览跑的是旧 engine/core
```

①**也可以在编辑器里点**：菜单 **开发者 → 开启 / 停止 / SSH 隧道状态**（扩展
`extensions/cck-dev`）。它自己握着 ssh 句柄，关菜单、关 Creator、重载扩展都会顺手 kill 掉，
不留孤儿。两边只能开一条 —— 端口就那两个，第二条会撞 `Address already in use`。

③ **在 Creator 里打开 `Boot.scene`** —— 预览从**当前打开的场景**启动，不是构建配置里的
`startScene`。想验完整启动链路（dispatch → hotupdate → shared → 地基 → 大厅）就必须开它。

### 为什么必须先起隧道

`app-config.ts` 的 `dispatcherUrl` 与 `foundation/server.ts` 的 `ACCOUNT_LOGIN_URL` 源码默认值
都是 `127.0.0.1`（真地址只住 gitignored 的 `local.json`，见
[`build-configs/README.md`](../../../apps/demo/build-configs/README.md#预览怎么连远端服务器转发端口别改源码)）。
而 `local.json` → 构建插件 → `settings.json` 那条注入链**对预览无效**，预览拿到的就是
`127.0.0.1`。服务不在本机时 `dispatch` 步握手失败 → `abortLaunch` → **预览直接打不开**，
而报错指向握手，不会告诉你"你没起隧道"。

**别改源码默认值来绕过**：改了迟早误提交，而那个默认值同时是别人 clone 下来的默认值。

## 改了脚本？重新打开场景

Game View **stop → play 不重载 JS 上下文**。改了 `assets/` 下的脚本后直接重播，跑的仍是旧的
import map —— 你会对着昨天的代码调今天的 bug。

**改完必须 `open_scene` 重新打开场景**（MCP 或编辑器里手动关掉重开），确认预览环境重新初始化
之后再播放。仅仅 stop→play、或者看到构建产物更新了，都**不是**新脚本已加载的证据。

同一条上下文存活特性还带来：`Bootstrap` 里有一段 `if (EDITOR)` 的重播守卫，检测到上一轮 kit
就先 `shutdown` 再重启（场景已重置，容器里留的常驻节点句柄全是失效引用）。这也是
**CLAUDE.md 硬规则 2「禁模块级单例」**的三个理由之一。

## Game View ≠ 浏览器预览（最容易栽的地方）

| | Game View（编辑器内） | 浏览器预览 | 构建产物 |
|---|---|---|---|
| `EDITOR` | **true** | false | false |
| `PREVIEW` | **false** | true | false |

⚠️ **预览引擎包里 `PREVIEW = !EDITOR`** —— 所以 `PREVIEW` 在 Game View 下是 **false**。
想表达「正跑在 Creator 里预览」，判据必须是 **`EDITOR || PREVIEW`**，只写一个就漏掉一半环境，
而且**只在另一半里现形**：本机习惯用哪种预览，另一种的 bug 就一辈子测不出来。

这条已经坑过两次，都在 `app-config.ts` 的 `versionUrl`：

```ts
// web 的热更版本表，只有正式 web 产物才该配
versionUrl: sys.isNative || PREVIEW || EDITOR ? undefined : 'cck-versions.json',
```

`cck-versions.json` 是 `cck-manifest web-versions` 从**产物**抽出来的，预览服务器上根本没有
这个文件 → 404 → core 的 `hotupdate` 步**拉不到就中止启动**（归类 network·可重试）。
症状是启动界面报一个更新/网络失败，而指向的文件只有出包才存在，很难往这儿想。

## 预览下哪些东西是关的

- **热更后端**：`ccHotUpdateModule` 里 `if (!sys.isNative) return;` → 预览不注册后端 →
  `hotupdate` 步走空后端恒 up-to-date，`BundleUpdater` 恒 no-op。**这不是失败，是这条路不存在。**
- **`buildValue` 恒走 fallback**：`settings.json` 里没有 `cck` 段，`querySettings` 必然是 `null`。
  所以源码里那些默认值不是冗余，**它就是预览用的那一套**。
- bundle 直接从预览服务器取，没有热更这回事。

这两条配错的症状都是**启动失败**，不是"少个功能"——因为它们都在启动序列上。

## 日志：能读什么，不能读什么

**Game View 的运行时 console 读不到**，这是实测边界，别浪费时间：

| 路子 | 实际拿到的 |
|---|---|
| `search_project_logs` | 编辑器日志，**没有**游戏 console（搜 `CCK-BOOT` 得 0 条） |
| `get_recent_logs` 的 `runtimeLogs` | **MCP server 自己的 RPC 记录**，不是游戏日志 |
| `temp/logs/project.log` | 被 Creator **独占锁住**，外部进程读不了（Permission denied） |
| `execute_javascript` `context=scene` | **编辑器的场景编辑视图**（节点树里有 `Editor Scene Foreground`），不是运行时 |
| `capture_game_screenshot` | 常常只截到 Game View 的工具栏，截不到画面 |

所以：

- **人工看** → Creator 自己的 Console 面板，一眼就够。
- **要自动化 / 要 AI 读日志** → 改用**浏览器预览**（`get_preview_mode` 会给出 URL），
  那条有真正的浏览器上下文，可以接 CDP。
- **要验证纯逻辑** → 根本别开预览，`vitest --watch` 秒级反馈（VM 零 `cc`，node 直跑）。

`cc/env` 是**构建期虚拟模块**，scene 进程里 `require('cc/env')` 会报
`Can not load engine module` —— 想实测 `EDITOR`/`PREVIEW` 的值只能在真正的运行时里打日志。

## 收工

隧道是前台进程，Ctrl+C 停。**如果是在后台起的，注意杀任务只杀掉 bash 包装进程、`ssh` 会变成
孤儿继续占着 9100/9103**，下次 `pnpm tunnel` 会因 `ExitOnForwardFailure` 失败并报一个跟真实
原因对不上的错。确认干净：

```bash
pnpm tunnel --dry-run    # 只打印将要执行的命令，不连
```

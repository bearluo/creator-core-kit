---
状态: 已实施（2026-08-17，`extensions/cck-build` 落地；用法见 `apps/demo/docs/build-plugin.md`）
摘要: Creator 3.8 有五条「构建期定值」的通道，横评它们能不能承载 VEST / version / dispatcher.url 这类打包期常量，并给出多马甲出包的推荐路径。
何时读: 要做多马甲/多环境自动出包、要给构建面板加自定义选项、想把 app-config.ts 的手改流程自动化时。
日期: 2026-08-17
依赖: apps/demo/assets/boot/app-config.ts、docs/design/2026-08-07-demo-assets-layout-v2-proposal.md
---

# Creator 3.8 构建自定义参数横评

## 目的

`apps/demo/assets/boot/app-config.ts` 里有 5 个**必须在打包期定死**的值（`VEST` / `appId` /
`version` / `channel`·`env` / `dispatcher.url`），它们躲不掉 AOT 层：`VEST` 要在 `app.launch()`
之前定（第一个界面就要按它解析皮包），`dispatcher.url` 要在握手前就有，而 `cdnUrl`（热更内容基址）
正是握手才下发的。目前的做法是**手改这个 TS 文件再构建**，本文调研有没有更好的通道。

结论先行：**自定义构建插件的 `options` + `onBeforeCompressSettings` 注入 settings.json** 是唯一
既能进构建面板、又能进命令行、还能被运行时读到的通道。**已按这条实施**（`extensions/cck-build`，
2026-08-17），用法与字段清单见 `apps/demo/docs/build-plugin.md`。

调研基于本机 Creator **3.8.8** 的内置类型定义与官方插件模板（`resources/app.asar.unpacked/
builtin/builder/`），非文档转述。

---

## 五条通道

| 通道 | 值在哪定 | 运行时怎么拿 | 能否命令行传 | 能否死代码剔除 |
|---|---|---|---|---|
| ① 构建插件 options | 构建面板 / 命令行 | 经 ③ 落到 settings | ✅ | ❌ |
| ② 构建钩子改源码 | 钩子里 `fs.writeFile` | 正常 `import` | ✅ | ✅ |
| ③ settings.json 注入 | `onBeforeCompressSettings` | `settings.querySettings()` | — | ❌ |
| ④ 自定义宏 `cc/userland/macro` | 项目设置 → Macro Config | `import { X } from 'cc/userland/macro'` | ❌（项目级，非任务级） | ✅ |
| ⑤ build-templates/ | 目录里放模板文件 | 只能覆盖产物文件 | — | — |

### ① 自定义构建插件的 options

`extensions/<name>/package.json` 声明入口：

```json
{ "name": "cck-build", "package_version": 2,
  "contributions": { "builder": "./dist/builder.js" } }
```

`builder.ts` 导出 `configs`，key 是平台名（`'android'`）或 `'*'`（所有平台）：

```ts
export const configs: BuildPlugin.Configs = {
  '*': {
    hooks: './hooks',
    options: {
      vest: {
        label: '马甲',
        default: 'base',
        render: { ui: 'ui-select-pro', items: [
          { label: 'base', value: 'base' }, { label: 'vest', value: 'vest' } ] },
        verifyRules: ['required'],
      },
      dispatcherUrl: { default: 'http://172.25.50.20:9100/api/Handshake',
        render: { ui: 'ui-input' } },
    },
  },
};
```

面板上自动渲染成表单。可用的 `render.ui`：`ui-input` / `ui-checkbox` / `ui-num-input` /
`ui-select-pro`（完整清单在编辑器「开发者 → UI 组件」）。`type: 'object' | 'array'` +
`itemConfigs` 可以做嵌套结构。`verifyRules` 配 `verifyRuleMap` 做校验，`verifyLevel: 'error'`
时校验不过**构建按钮点不动**（默认就是 error，只想提示要显式写 `'warn'`）。

值持久化在 `apps/demo/profiles/v2/packages/builder.json`，按平台分开存。

### ② 构建钩子

`hooks.ts` 导出这些（签名 `(options: IBuildTaskOption, result: IBuildResult) => void | Promise<void>`）：

| 钩子 | 时机 | 典型用途 |
|---|---|---|
| `onBeforeBuild` | 构建开始前 | 改写源码文件、准备资源 |
| `onBeforeCompressSettings` | settings 序列化前 | **往 `result.settings` 注入自定义数据** |
| `onAfterCompressSettings` | settings 压缩后 | — |
| `onAfterBuild` | 构建完成 | 查产物路径（`result.getAssetPathInfo(uuid)` 等） |
| `onError` | 构建中断 | 只是事件通知，**劫持不了错误** |
| `onBeforeMake` / `onAfterMake` | 原生工程生成前后（签名是 `(root, options)`） | 改 gradle / Xcode 工程 |

两个要点：

- 导出 `export const throwError = true` 才会让钩子里的异常中断构建，否则只打日志。
- 钩子跑在**独立 worker 进程**里，`Editor.Message.request` 可用，但拿不到编辑器主进程的内存状态。

传进来的 `options` 是**只读副本**，改它不生效 —— 要改构建参数得在 `configs` 的 `options`
里配默认值。读自定义参数的路径是固定的：

```ts
export const onBeforeCompressSettings: BuildHook.onBeforeCompressSettings =
  async function (options, result) {
    const my = options.packages[PACKAGE_NAME];   // ← 自己那一份
    result.settings.cck = { vest: my.vest, dispatcherUrl: my.dispatcherUrl };
  };
```

### ③ settings.json 注入 + 运行时读取

引擎侧签名（`engine/cocos/core/settings.ts`）：

```ts
querySettings<T = any>(category: SettingsCategory | string, name: string): T | null
overrideSettings<T = any>(category: SettingsCategory | string, name: string, value: T): void
```

**`category` 接受任意字符串**，所以自定义 category 是官方支持的用法，不是钻空子。内置的 13 个是
`path` / `engine` / `assets` / `scripting` / `physics` / `rendering` / `launch` / `screen` /
`splashScreen` / `animation` / `profiling` / `plugins` / `xr`。

读取时机：`game.onPostBaseInitDelegate` 之后才安全 —— 对我们没有约束，`Bootstrap.start()`
远在其后。

另有两条运行时通道：`game.init({ settingsPath })` 换配置文件路径、`game.init({ overrideSettings })`
或 `settings.overrideSettings()` 覆盖字段。都属于「不改构建产物也能换配置」的路子，但要接管
`game.init`，与我们的 `Boot.scene` 启动方式冲突，不采纳。

### ④ 自定义宏 `cc/userland/macro`

项目设置 → Macro Config 里加的宏会生成到 `temp/declarations/cc.custom-macro.d.ts`
（本项目当前是空的 `declare module "cc/userland/macro" {}`），构建时**内联成常量**，所以是五条里
唯一能触发死代码剔除的 —— `if (VEST === 'base')` 那种分支能整段消掉。

但它是**项目级**配置，一个项目一套值；构建任务级要换值只能改项目设置再构建，命令行传不了。
用来做「这个包要不要编进调试面板」这类开关合适，用来做马甲标识不合适。

### ⑤ build-templates/

按平台放模板文件覆盖产物（本项目 `apps/demo/build-templates/native/index.ejs` 就是这么改原生启动
搜索路径的）。它只能**覆盖或追加产物文件**，碰不到已编译的 TS 常量 —— 不是这个问题的解。

---

## 命令行

```bash
CocosCreator --project <项目路径> --build "platform=android;debug=false;buildPath=./build"
```

- `configPath=<json>`：指向构建面板导出的配置文件；**与其他参数冲突时以 configPath 为准**。
- `packages`：各扩展的参数，需要存**序列化后的字符串**。手拼容易错，官方建议从构建面板导出。
- 退出码：`32` 参数非法 / `34` 构建失败 / `36` 成功。

多马甲出包因此是一个马甲一份 json：

```bash
CocosCreator --project apps/demo --build "platform=android;configPath=./build-configs/vest.json"
```

---

## 对本项目的推荐

**做法**：写一个 `extensions/cck-build` 插件，`options` 出 5 个字段，`onBeforeCompressSettings`
把它们塞进 `settings.cck`；`app-config.ts` 改成从 settings 读、读不到回退到源码里的默认值。

```ts
const cfg = <T>(k: string, fallback: T): T =>
  settings.querySettings<T>('cck', k) ?? fallback;

export const VEST = cfg('vest', 'base');
```

回退分支不是冗余 —— **编辑器预览不走构建流程**，`querySettings` 那时必然是 `null`，源码里的默认值
正好是开发期用的那一套。

**代价与边界**：

- settings 里的值是运行时读的，不是编译期常量 → 死代码剔除不掉。对这 5 个字段无所谓，它们是纯数据、
  不产生分支。真要按马甲裁代码得走 ④。
- 插件本体约 100 行（package.json + builder.ts + hooks.ts），一次性成本。
- `ACCOUNT_LOGIN_URL` **不该**进来：它在地基层（`foundation/server.ts`），换环境热更即可，
  塞进打包期常量等于把一个本来免费的改动变成发包。

**实施结果**（2026-08-17）：按上述方案落地为 `apps/demo/extensions/cck-build`，六个字段全部可注入。
调研时的判断是「等真要同时出多个马甲的包再做」，实际取舍改为**现在就补齐** —— demo 是给人看
框架能力的，一条链路缺了就等于没有。命令行 web-mobile 构建实测：传入的
`vest` / `cli-test:9100` / `staging` 三项全部穿透到运行时（源码默认值分别是 `base` 与 dev139）。

沿用调研结论的两条边界：`ACCOUNT_LOGIN_URL` 没有进来（它在地基层，热更即可）；按马甲裁代码
仍然只能走 ④，settings 这条剔不掉死代码。

## 参考

- 本机权威定义：`C:\ProgramData\cocos\editors\Creator\3.8.8\resources\app.asar.unpacked\builtin\builder\`
  （`@types/public/{build-plugin,options,build-result}.d.ts` + `build-plugin-template/source/`）
- 引擎 settings：`resources\resources\3d\engine\cocos\core\settings.ts`
- [自定义构建流程](https://docs.cocos.com/creator/3.8/manual/zh/editor/publish/custom-build-plugin.html)
- [命令行发布项目](https://docs.cocos.com/creator/3.8/manual/zh/editor/publish/publish-in-command-line.html)
- [settings.json 升级指南](https://docs.cocos.com/creator/3.8/manual/zh/release-notes/build-template-settings-upgrade-guide-v3.6.html)

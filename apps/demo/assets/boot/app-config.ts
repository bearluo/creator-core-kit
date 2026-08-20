import { sys } from 'cc';
import type { AppConfig } from '@cck/core';
import { loadScene } from '@cck/engine';
import { buildValue } from './build-config';

/**
 * 应用配置 —— 版本 / 渠道 / 环境 / 包分层集中在这一处。**留在 AOT 层的东西全在这个文件里**。
 *
 * 三层包分层（判据是「改了它要付什么代价」）：
 *
 * | 层 | 内容 | 换它要 |
 * |---|---|---|
 * | ① **AOT** | 引擎 + `@cck/core` + `@cck/engine` + `assets/boot/`（本文件 + Bootstrap + Boot.scene + 启动界面） | **热更、重启**（引擎指纹变才发包） |
 * | ② **地基** | `assets/foundation/`：协议 / 登录 / 认证 / 网关搬家 / 模块清单 / 模块契约 / 跨模块事件 | 热更，不重启 |
 * | ③ **模块** | `assets/modules/*`：lobby / mail / shop / mini-clicker / mini-dodge | 按需 load / release |
 *
 * 为什么 dispatcher 地址躲不掉 ①：客户端要先握手才知道 `cdnUrl`（热更内容基址），
 * 而热更内容里才有地基。鸡生蛋，只能钉死在包里。其余服务端地址都在
 * `foundation/server.ts`，换环境热更即可。
 *
 * ## 下面的值哪来的
 *
 * 每个 `buildValue(...)` 都是「**出包时可以被构建面板覆盖**，没覆盖就用这个默认值」。
 * 覆盖链路与为什么不用宏见 `build-config.ts`；面板上那几个输入框在
 * `extensions/cck-build`。写在这里的字面量是**开发期默认值** —— 编辑器预览不走构建流程，
 * 跑的一直是它们。
 */

/**
 * 马甲标识 —— 「这个包是哪一张脸」。**打包期常量**：一个马甲一个包。
 *
 * 登记了换皮的界面从 `skin-<VEST>-<跟随者>` 包取 prefab（接缝见 `foundation/catalog.ts` 的
 * `skinBundle()`）——**一个跟随者一个皮包**，跟着它装卸。**没有「原皮」这一档**：demo 自己
 * 也是一个马甲，它的地基皮就是 `skin-base-foundation`；加一个马甲 = 照着复制一套皮包 +
 * 出包时在构建面板选它，地基与模块一个字不动。
 *
 * ⚠️ 它必须在 `app.launch()` **之前**定死（第一个界面就要按它解析皮包），所以只能是打包期
 * 的东西 —— 运行时切马甲需要把已装的皮包全卸了重装，不是这套设计要解决的问题。
 */
export const VEST = buildValue('vest', 'base');

/** `AppConfig.env` 的合法值。构建面板用下拉框限制，这里再兜一道 —— settings.json 是可以手改的。 */
const ENVS = ['dev', 'staging', 'prod'] as const;
type Env = (typeof ENVS)[number];

function envValue(): Env {
  const v = buildValue('env', 'dev');
  if ((ENVS as readonly string[]).includes(v)) return v as Env;
  console.error(`[CCK-BOOT] env='${v}' 不是合法值（${ENVS.join(' / ')}）→ 按 'dev' 跑`);
  return 'dev';
}

export const APP_CONFIG: AppConfig = {
  // 也是本机存储的隔离前缀：马甲装在同一台机器上，Web / 小游戏同域名共用一份 localStorage，
  // 不隔离两个马甲会拿到同一个游客账号。Android 各马甲独立包名，沙箱本来就隔离。
  appId: buildValue('appId', 'cck-demo'),
  // 1.3.0 起才被本机 dispatcher 放行（低于它会拿到 ACTION_UPDATE —— 想看版本闸生效就把这里调到 1.2.0）
  version: buildValue('version', '1.3.0'),
  channel: buildValue('channel', 'dev'),
  env: envValue(),
  // app 兼容戳所在包。默认 'main'，但 main 只收「被场景引用到」的资源，散落的 JSON 会被丢掉；
  // `resources` 是 Cocos 内建包、整目录必打进包，且在 tools 的 DEFAULT_AOT_BUNDLES 里 → 归 base
  // manifest，跟 AOT 一起被 base 热更替换。**不能放 shared / foundation**：那是热更包，模块级热更
  // 就能改掉 app 自称的 coreApiHash，闸自己就废了。戳的内容由 scripts/build.mjs 每次构建前重写。
  stampBundle: 'resources',
  // 共享**资源** bundle（i18n / 图集 / 音效）。地基不列在这里 —— 它要在 hotupdate 之后
  // 按自己的节奏加载并跑 boot，见 Bootstrap 的 `demo-foundation` 步。
  //
  // 马甲的**地基皮**跟着进来：`shared` 步在 `demo-foundation` 之前跑完，登录界面（启动路径上的
  // 第一张脸）解析皮包时它已经在手上，不必第一屏现下。
  //
  // 这里**只有地基那一个皮包**：模块的脸各在各的 `skin-<马甲>-<模块>` 包里，由大厅在开模块时
  // 顺带装、关模块时顺带卸（`foundation/catalog.ts` 的 `skinBundle`）。一个马甲一个大皮包的话，
  // 启动就得把玩家永远不点的那些模块的脸也下下来。
  shared: ['shared', `skin-${VEST}-foundation`],
  lobby: {
    bundle: 'lobby',
    // core 不持场景接缝（切场景是 engine 直接行为）→ 进大厅这一下由这里给。
    enter: () => loadScene('Lobby', { bundle: 'lobby' }),
  },
  dispatcher: {
    // 局域网测试机 dev139（server-core-kit 仓 `docker compose up -d`；2026-08-05 从开发本机迁来）。
    // ⚠️ 写局域网 IP 而不是 127.0.0.1：真机 / 模拟器打开时 localhost 指的是它自己。
    // ⚠️ 那台机的 IP 从 .139 改到了 **.20**（别名仍叫 dev139）—— 2026-08-17 实测 .139 已不可达。
    // 这类会过期的地址正是构建插件存在的理由：换服现在不必改源码，出包时填一下即可。
    url: buildValue('dispatcherUrl', 'http://172.25.50.20:9100/api/Handshake'),
    // 契约版本来自 kit-proto，**由项目提供** —— kit 里不出现任何协议常量（ADR-0011）。
    protoVersion: 1,
    platform: sys.isNative ? String(sys.os).toLowerCase() : 'web',
  },
  // web 的热更入口：一张 bundle→md5 的表，出包时由 `cck-manifest web-versions` 从产物的
  // settings.json 抽出来，跟产物一起部署。**写相对文件名**：它和 bundle 同源（都在页面这一侧），
  // 按页面 base 解析，换部署地址天然跟着走，不必也不该去拼 dispatcher 下发的 cdnUrl。
  //
  // **native 明确不配**：那条走 AssetsManager + manifest，压根没有 bundleVers 这回事。配了
  // 每次启动都会去拉一个 CDN 上不存在的文件，而拉不到是**启动失败**——等于自己把 native 锁死。
  versionUrl: sys.isNative ? undefined : 'cck-versions.json',
};

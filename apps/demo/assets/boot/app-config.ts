import { sys } from 'cc';
import type { AppConfig } from '@cck/core';
import { loadScene } from '@cck/engine';

/**
 * 应用配置 —— 版本 / 渠道 / 环境 / 包分层集中在这一处。**留在 AOT 层的东西全在这个文件里**。
 *
 * 三层包分层（判据是「改了它要付什么代价」）：
 *
 * | 层 | 内容 | 换它要 |
 * |---|---|---|
 * | ① **AOT** | 引擎 + `@cck/core` + `@cck/engine` + `assets/boot/`（本文件 + Bootstrap + Boot.scene + 启动界面） | **发新包、重启** |
 * | ② **地基** | `assets/foundation/`：协议 / 登录 / 认证 / 网关搬家 / 模块清单 / 模块契约 / 跨模块事件 | 热更，不重启 |
 * | ③ **模块** | `assets/modules/*`：lobby / mail / shop / mini-clicker / mini-dodge | 按需 load / release |
 *
 * 为什么 dispatcher 地址躲不掉 ①：客户端要先握手才知道 `cdnUrl`（热更内容基址），
 * 而热更内容里才有地基。鸡生蛋，只能钉死在包里。其余服务端地址都在
 * `foundation/server.ts`，换环境热更即可。
 */
/**
 * 马甲标识 —— 「这个包是哪一张脸」。**打包期常量**：一个马甲一个包，换它要发新包，所以它在 ①。
 *
 * 登记了换皮的界面从 `skin-<VEST>-<跟随者>` 包取 prefab（接缝见 `foundation/catalog.ts` 的
 * `skinBundle()`）——**一个跟随者一个皮包**，跟着它装卸。**没有「原皮」这一档**：demo 自己
 * 也是一个马甲，它的地基皮就是 `skin-base-foundation`；加一个马甲 = 照着复制一套皮包 +
 * 改这一行，地基与模块一个字不动。
 *
 * 马甲还有两处**不在这里**但同样跟着包走：`appId`（存储隔离的依据，见 `net/auth.ts`）
 * 与 `dispatcher.url`（各马甲可以连各自的服）。
 */
export const VEST = 'base';

export const APP_CONFIG: AppConfig = {
  // 也是本机存储的隔离前缀：马甲装在同一台机器上，Web / 小游戏同域名共用一份 localStorage，
  // 不隔离两个马甲会拿到同一个游客账号。Android 各马甲独立包名，沙箱本来就隔离。
  appId: 'cck-demo',
  // 1.3.0 起才被本机 dispatcher 放行（低于它会拿到 ACTION_UPDATE —— 想看版本闸生效就把这里调到 1.2.0）
  version: '1.3.0',
  channel: 'dev',
  env: 'dev',
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
    url: 'http://172.25.50.139:9100/api/Handshake',
    // 契约版本来自 kit-proto，**由项目提供** —— kit 里不出现任何协议常量（ADR-0011）。
    protoVersion: 1,
    platform: sys.isNative ? String(sys.os).toLowerCase() : 'web',
  },
  // versionUrl 不配：demo 的热更走 native AssetsManager 那条已 e2e 验证的路径（ADR-0006）。
  // web 版本表要真 CDN 才有意义，接入方按 env 拼自己的地址（dispatcher 下发的 cdnUrl 就是它的基址）。
};

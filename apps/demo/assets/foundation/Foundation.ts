import { _decorator } from 'cc';
import { createBundleGraph, getBundleManager, type LaunchContext } from '@cck/core';
import { BUNDLE_GRAPH } from './bundles';
import { registerCatalogUIs } from './catalog';
import { authenticate } from './net/auth';
import { connectNetwork } from './net/connect';
import { ACCOUNT_LOGIN_URL } from './server';

const { ccclass } = _decorator;

/**
 * 地基层入口 —— 整个游戏业务的地基，**跟主包同生共死但可以热更**。
 *
 * ## 它在哪一层
 *
 * | 层 | 内容 | 换它要 |
 * |---|---|---|
 * | ① AOT | 引擎 + `@cck/core` + `@cck/engine` + `assets/boot/` | **热更、重启**（引擎指纹变才发包） |
 * | ② 地基（本 bundle） | 协议 / 登录 / 认证 / 网关搬家 / 模块清单 / 模块契约 / 跨模块事件 | **热更，不重启** |
 * | ③ 模块 | `assets/modules/*` | 按需 load / release |
 *
 * 「跟包走」= 启动期加载、**常驻不卸载**，生命周期和主包一样长；但它是 Asset Bundle，
 * 所以走已经跑通的分包热更。加载时机是 `shared` 阶段 —— 必须在 `hotupdate` **之后**，
 * 否则更新下来的要等下次启动才生效，这一层就白分了。代价是长连接与认证也跟着后移到热更之后。
 *
 * ## 主包怎么拿到它
 *
 * 主包**不能 `import` 本文件**（那会把整个地基拽进 AOT）。走的是：`@ccclass` 已把本类
 * 注册进 cc 类表 → 主包 `js.getClassByName('DemoFoundation')` 取到 → `new` 出来调 `boot`。
 * 类型靠 `boot/foundation-api.ts` 的 `import type`，TS 编译期擦除，不产生运行时依赖。
 *
 * ## 模块怎么用它
 *
 * 模块 bundle 可以正常 `import` 本 bundle 的函数与常量：本 bundle 的**优先级（6）高于
 * 所有模块（1）**，被多个 bundle 引用的资源归属优先级最高的那个，同级才各复制一份。
 * 所以模块拿到的是这里的**同一份**，热更地基对已装的模块立即生效。改优先级前先读 ADR-0013。
 */
@ccclass('DemoFoundation')
export class DemoFoundation {
  /**
   * 按序把地基立起来。抛错就交给 App 分类成 LaunchFailure，主包那一步不吞。
   *
   * 顺序有意义：模块清单要在大厅建 UI 之前登记好；连接要在认证之前；认证要在任何
   * 业务 cmd 之前（网关在认证前只放行 `AuthRequest` / `Ping`）。
   */
  async boot(ctx: LaunchContext): Promise<void> {
    // 依赖表**第一个装**：此后任何 load 都按它跟随装卸（模块带着自己的皮包一起进出），
    // 表外的包在非 prod 直接抛 —— 漏登记要在开发期炸，不能等到玩家点开那个功能。
    getBundleManager().setGraph(createBundleGraph(BUNDLE_GRAPH), {
      strict: ctx.config.env !== 'prod',
    });
    registerCatalogUIs(); // 模块清单 → UIManager 注册表（加一个模块 = 改 catalog.ts 一行）
    await connectNetwork(ctx); // 协议注册表 + 长连接 + 网关搬家器 → DI
    await authenticate(ACCOUNT_LOGIN_URL); // 登录 + 首帧 AuthRequest；重连后自动重认
    console.log('[CCK-FOUNDATION] 地基就绪：依赖表 / 协议 / 连接 / 认证 / 模块清单');
  }
}

import type { LaunchContext } from '@cck/core';

/**
 * 主包 ↔ 地基 bundle 的**唯一接缝**。
 *
 * 主包不能 `import` 地基里的任何**值** —— 那会让 Creator 把被引用的代码判给主包
 * （被多个包引用的资源归属优先级最高的那个，而 main 恒为最高），地基就跟着进了 AOT，
 * 热更立刻失效。所以这里只有 `interface` 与字符串常量：
 *
 * - `interface` 走 `import type`，TS 编译期擦除，产物里一个字节都不剩；
 * - 下面两个常量是主包自己的（bundle 名、类名），**不是**从地基 import 过来的。
 *
 * 运行时靠 `js.getClassByName(FOUNDATION_CLASS)` 桥接：`@ccclass` 在 bundle 加载执行
 * 脚本时已把类注册进 cc 类表，这是引擎原生的跨 bundle 通道，不必自建 globalThis 注册表。
 */
export interface FoundationApi {
  /** 把地基立起来（协议 / 连接 / 认证 / 模块清单）。抛错 = 启动失败，由 App 分类。 */
  boot(ctx: LaunchContext): Promise<void>;
}

/** 地基 bundle 名（= `assets/foundation` 目录名）。 */
export const FOUNDATION_BUNDLE = 'foundation';

/** 地基入口类在 cc 类表里的名字。改这个名字要同步改 `foundation/Foundation.ts` 的 `@ccclass`。 */
export const FOUNDATION_CLASS = 'DemoFoundation';

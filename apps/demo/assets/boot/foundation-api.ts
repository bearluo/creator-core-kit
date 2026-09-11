import { js } from 'cc';
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

/**
 * 地基入口类的**静态**面 —— 主包**随时**能问的那些事（不必先有实例）。
 *
 * 为什么是静态而不是实例方法：`boot()` 的那个实例活在 `launchSteps` 的闭包里，要拿出来得
 * 一路 plumbing；而且地基热更换了类之后，存下来的实例是**上一份**。按类名现问，
 * 拿到的永远是当前那份。读的状态本就在 DI 根容器里，静态方法不持有任何东西。
 */
export interface FoundationStatics {
  /** 当前玩家 ID；地基还没装 / 还没登录 → 空串。 */
  playerId(): string;
}

/**
 * 当前玩家 ID，**给崩溃上报的上下文现取用**。取不到就是空串，不抛。
 *
 * 三种「取不到」都是**正常状态**，不是故障：地基 bundle 还没加载（启动早期）、玩家还没登录、
 * 重连后正在重认证。早于登录的崩溃**照样要报得出去**，只是少这一块。
 *
 * ⚠️ 别改成「登录成功时推一次」——那种 `setUser()` 式 API 忘了调就静默少一块（见 hlgit #47）。
 */
export function foundationPlayerId(): string {
  const C = js.getClassByName(FOUNDATION_CLASS) as Partial<FoundationStatics> | undefined;
  return C?.playerId?.() ?? '';
}

/** 地基 bundle 名（= `assets/foundation` 目录名）。 */
export const FOUNDATION_BUNDLE = 'foundation';

/** 地基入口类在 cc 类表里的名字。改这个名字要同步改 `foundation/Foundation.ts` 的 `@ccclass`。 */
export const FOUNDATION_CLASS = 'DemoFoundation';

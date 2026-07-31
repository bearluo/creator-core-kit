import type { Node } from 'cc';
import type { Container } from '@cck/core';
import type { ModuleResourceScope } from './ModuleResourceScope';

/**
 * 大厅框架样例 · 可分包功能模块契约（type-only，编译期擦除）。
 *
 * 「一切功能皆可分包」：商城/背包/子游戏等各是一个 Asset Bundle，按需 load/mount/release。
 * 本文件只定义 panel 类模块（挂常驻框架根的 UI 面板）的统一契约 + 自登记注册表；
 * game 类（全屏自带场景）不走 FeatureModule，由 host 直接 loadScene 承载（见 LobbyHost）。
 */

/** 框架注入给模块的运行上下文。 */
export interface ModuleContext {
  /** 模块挂载根：常驻框架「模块挂载层」下、本次打开新建的容器节点。unmount 后由 host 销毁。 */
  readonly root: Node;
  /** 模块专属 DI 子作用域：隔离模块单例，unmount 即 dispose（级联释放本层 Disposable）。 */
  readonly container: Container;
  /** 本模块 bundle 名：模块经 {bundle} 从自己 bundle 加载 i18n/配表/prefab（模块作用域资源）。 */
  readonly bundle: string;
  /** 模块作用域资源登记器（已绑定 bundle）：mount 里 load*、unmount 一行 dispose 全撤（host 注入）。 */
  readonly scope: ModuleResourceScope;
  /** 打开传参。 */
  readonly args?: unknown;
  /** 模块请求关闭自己 → host 走 unmount + 释放。 */
  close(): void;
}

/** 一切 panel 类可分包功能模块的统一契约。mount/unmount 对称，可 async。 */
export interface FeatureModule {
  /** 挂载：加载自带资源（{bundle} 作用域）、在 ctx.root 上建 UI、订阅事件。 */
  mount(ctx: ModuleContext): void | Promise<void>;
  /** 卸载：与 mount 对称回收——撤 i18n 表/配表、销毁 UI、解绑（多数经 ModuleResourceScope 一键做）。 */
  unmount(): void | Promise<void>;
}

/** 模块工厂：每次打开造一个新实例（不共享跨次打开的状态）。 */
export type ModuleFactory = () => FeatureModule;

// —— 自登记注册表（设计 Q1）——
// 模块脚本顶层 `registerModule(id, factory)`；模块 bundle 加载即执行脚本 → 工厂写进注册表 →
// host 加载 bundle 后按 id 取工厂。无 cc 类名反射、AOT 友好。
// 挂 globalThis（对齐 DI 根容器跨 bundle 唯一策略）：主包与模块 bundle 不共享模块作用域，须用全局表桥接。
const REGISTRY_KEY = Symbol.for('cck.demo.lobby.moduleRegistry');

function registry(): Map<string, ModuleFactory> {
  const store = globalThis as unknown as Record<symbol, Map<string, ModuleFactory> | undefined>;
  return (store[REGISTRY_KEY] ??= new Map<string, ModuleFactory>());
}

/** 模块自登记：在模块脚本顶层调用（bundle 加载执行脚本时写入）。同 id 重复登记覆盖。 */
export function registerModule(id: string, factory: ModuleFactory): void {
  registry().set(id, factory);
}

/** host 取模块工厂（bundle 已加载 → 脚本已执行 → 应已登记）。未登记返回 undefined。 */
export function getModuleFactory(id: string): ModuleFactory | undefined {
  return registry().get(id);
}

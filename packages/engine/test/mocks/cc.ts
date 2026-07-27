/**
 * cc 测试替身（单一真源）—— 同时服务：
 *  - tsc 类型：engine tsconfig `paths: { cc → 本文件 }`；
 *  - vitest 运行时：根 vitest.config `resolve.alias: { cc → 本文件 }`。
 * 真机上 Creator 编译 engine 源码时 `cc` 是 external（真 cc），本文件不参与。
 *
 * ⚠️ 防 mock creep 硬规矩（见 ADR-0002）：本文件**只准**放三类 cc 符号——
 *   (1) 常量（如 Director.EVENT_AFTER_UPDATE）；
 *   (2) 无副作用的纯函数（如 log/warn/error/debug）；
 *   (3) 事件 on/off/emit。
 * 任何**需要真实引擎行为**的 cc API（渲染 Node/Widget/Layout、assetManager 加载、
 * AudioSource 播放……）**禁止**进本文件；对应 engine 模块改走 apps/demo 集成测，
 * 不靠 mock。否则 mock 会膨胀到「把整个 cc 搬过来」。
 *
 * 签名逐字对齐 Creator 3.8.7 真 cc.d.ts（标注来源行），降低漂移；权威一致性由
 * 下游 apps/demo（真 cc 编译 + 预览）把关。
 */

/** 测试观测：记录 log/warn/error/debug 的调用。 */
export interface CcCall {
  fn: 'log' | 'warn' | 'error' | 'debug';
  args: unknown[];
}
export const ccCalls: CcCall[] = [];

// cc.d.ts:21772/21778/21788/21798 —— export function debug/log/error/warn(...data: unknown[]): void
export function debug(...data: unknown[]): void {
  ccCalls.push({ fn: 'debug', args: data });
}
export function log(...data: unknown[]): void {
  ccCalls.push({ fn: 'log', args: data });
}
export function error(...data: unknown[]): void {
  ccCalls.push({ fn: 'error', args: data });
}
export function warn(...data: unknown[]): void {
  ccCalls.push({ fn: 'warn', args: data });
}

type Handler = (...args: unknown[]) => void;

// cc.d.ts:6338/6348 —— EventTarget.on/off(type: string, callback, target?)；emit(type, ...args)
export class EventTarget {
  private readonly _listeners = new Map<string, Handler[]>();
  on(type: string, callback: Handler): void {
    const arr = this._listeners.get(type) ?? [];
    arr.push(callback);
    this._listeners.set(type, arr);
  }
  off(type: string, callback: Handler): void {
    const arr = this._listeners.get(type);
    if (!arr) return;
    const i = arr.indexOf(callback);
    if (i >= 0) arr.splice(i, 1);
  }
  emit(type: string, ...args: unknown[]): void {
    for (const cb of [...(this._listeners.get(type) ?? [])]) cb(...args);
  }
  /** 测试辅助：清空全部监听（非 cc API）。 */
  __clear(): void {
    this._listeners.clear();
  }
}

// cc.d.ts:27533 —— export class Director extends EventTarget；下列为其静态事件常量
export class Director extends EventTarget {
  static readonly EVENT_BEFORE_UPDATE = 'director_before_update';
  static readonly EVENT_AFTER_UPDATE = 'director_after_update';
}
// cc.d.ts:27860 —— export const director: Director
export const director: Director = new Director();

// cc.d.ts:27991/28195 —— export class Game extends EventTarget；get deltaTime(): number
export class Game extends EventTarget {
  deltaTime = 0;
}
// cc.d.ts:28424 —— export const game: Game
export const game: Game = new Game();

/** 测试复位：清 log 记录、帧 dt、director 监听。afterEach 调。 */
export function resetCcMock(): void {
  ccCalls.length = 0;
  game.deltaTime = 0;
  director.__clear();
}

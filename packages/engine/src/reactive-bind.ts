import type { Label, EditBox, Toggle } from 'cc';
import { effect } from '@cck/core';
import type { Dispose, Signal } from '@cck/core';

/**
 * reactive 的「引擎半」：把 core 的响应式值接到 cc 节点属性 —— MVVM 数据绑定的落地胶水。
 * 每个 bind* 本体就是一个 effect(() => 目标属性 = get())，首帧刷一次、依赖变即刷；
 * 双向绑定再挂一个 cc 事件把用户输入写回 signal（signal 幂等 setter 挡回环）。
 * 响应式逻辑全在 core（reactive.ts），engine 不重写、只做属性赋值 + 生命周期清理。
 * 设计见 packages/core/docs/modules/reactive.md §engine 半。
 *
 * 按 ADR-0002：engine 薄壳不单测，走 apps/demo 真机 gameView 预览验证。
 */

/** 单向：label.string = String(get())。首帧刷一次，依赖变即刷。 */
export function bindText(label: Label, get: () => unknown): Dispose {
  return effect(() => {
    label.string = String(get());
  });
}

/**
 * 单向泛型：obj[key] = get()。覆盖 Sprite.spriteFrame / ProgressBar.progress / Node.active 等
 * 一切「响应式值 → cc 属性」赋值，免为每个控件写专用 helper。
 */
export function bindProp<O extends object, K extends keyof O>(
  obj: O,
  key: K,
  get: () => O[K],
): Dispose {
  return effect(() => {
    obj[key] = get();
  });
}

/**
 * 双向：sig → box.string（effect），box 'text-changed' → sig.value。
 * 编程置 box.string 若回抛 'text-changed'，写回的是同值 → signal 幂等 setter 不再通知，无回环。
 */
export function bindEditBox(box: EditBox, sig: Signal<string>): Dispose {
  const stop = effect(() => {
    box.string = sig.value;
  });
  const onInput = (): void => {
    sig.value = box.string;
  };
  box.node.on('text-changed', onInput, box);
  return () => {
    stop();
    box.node.off('text-changed', onInput, box);
  };
}

/** 双向：sig → toggle.isChecked（effect），toggle 'toggle' 事件 → sig.value。 */
export function bindToggle(toggle: Toggle, sig: Signal<boolean>): Dispose {
  const stop = effect(() => {
    toggle.isChecked = sig.value;
  });
  const onToggle = (): void => {
    sig.value = toggle.isChecked;
  };
  toggle.node.on('toggle', onToggle, toggle);
  return () => {
    stop();
    toggle.node.off('toggle', onToggle, toggle);
  };
}

/**
 * 生命周期收纳：一个 View 的所有绑定装一处，cc.Component.onDestroy 里一次性 dispose。
 * 范式照抄 EventBus 的 offAll(owner)——薄壳无需逐个记 disposer。
 */
export class BindingScope {
  private _disposers: Dispose[] = [];
  /** 收一个 disposer，原样返回便于链式（s.add(bindText(...))）。 */
  add<D extends Dispose>(d: D): D {
    this._disposers.push(d);
    return d;
  }
  /** 依次跑所有 disposer 并清空（幂等，可重复调）。 */
  dispose(): void {
    const ds = this._disposers;
    this._disposers = [];
    for (const d of ds) d();
  }
}

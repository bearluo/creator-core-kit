import { describe, expect, it } from 'vitest';
import { CounterVM } from '../../../assets/modules/mini-clicker/CounterVM';

/**
 * 业务 VM 单测样板：零 `cc`、在 node 直跑，不用开 Creator。
 * 目录镜像 assets（见 test/README.md）；View 侧（ClickerView）不测，由启动 smoke 兜底。
 */
describe('CounterVM', () => {
  it('初始为 0，display 跟着 count 走', () => {
    const vm = new CounterVM();
    expect(vm.count.value).toBe(0);
    expect(vm.display.value).toBe('点击次数：0');
  });

  it('increment 累加并驱动 display 重算', () => {
    const vm = new CounterVM();
    vm.increment();
    vm.increment();
    expect(vm.count.value).toBe(2);
    expect(vm.display.value).toBe('点击次数：2');
  });

  it('reset 归零', () => {
    const vm = new CounterVM();
    vm.increment();
    vm.reset();
    expect(vm.count.value).toBe(0);
    expect(vm.display.value).toBe('点击次数：0');
  });

  // 转屏 / 换皮重建走 saveState → restore。判类型在 VM 里，所以这条分支测得到；
  // 留在 View 里的话（旧写法 `if (typeof state === 'number')`）就只能靠真机撞。
  it.each([
    ['正常数值', 7, 7],
    ['undefined（首次打开）', undefined, 0],
    ['类型不对', '7', 0],
    ['NaN', Number.NaN, 0],
    ['Infinity', Number.POSITIVE_INFINITY, 0],
  ])('restore：%s → %s', (_name, input, expected) => {
    const vm = new CounterVM();
    vm.restore(input);
    expect(vm.count.value).toBe(expected);
  });

  it('saveState → restore 往返保住计数', () => {
    const a = new CounterVM();
    a.increment();
    a.increment();
    a.increment();
    const b = new CounterVM();
    b.restore(a.count.value); // ClickerView.saveState() 吐的就是这个值
    expect(b.display.value).toBe('点击次数：3');
  });

  // 规则 C 的回归闸：VM 不是单例，一个界面实例一份，互不串台。
  it('实例之间互不影响（不是模块级单例）', () => {
    const a = new CounterVM();
    const b = new CounterVM();
    a.increment();
    expect(a.count.value).toBe(1);
    expect(b.count.value).toBe(0);
  });
});

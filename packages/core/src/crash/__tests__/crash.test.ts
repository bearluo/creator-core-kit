import { describe, expect, it } from 'vitest';
import { crashPayload, createCrashFilter, parseJsFrames, type RawCrash } from '../crash';

/**
 * 崩溃上报的**全部判定逻辑**都在这里——engine 那半按 ADR-0002 薄到没有逻辑可测
 * （`native.reflection` 是 JNI，禁止进 cc mock）。所以这份测试的覆盖面就是接缝的覆盖面。
 */

function raw(over: Partial<RawCrash> = {}): RawCrash {
  return {
    location: 'src/foo/Bar.ts:42',
    linenum: 42,
    message: 'TypeError: x is undefined',
    stack: 'at Bar.update (bundle.fa0b0.js:1:52341)\nat director.tick (cc.js:1:9)',
    ...over,
  };
}

describe('createCrashFilter — 去重', () => {
  it('1. 同一指纹喂 100 次，只有第一次过', () => {
    const f = createCrashFilter();
    const passed = Array.from({ length: 100 }, () => f.accept(raw())).filter((e) => e !== null);
    expect(passed).toHaveLength(1);
  });

  it('2. message 相同但 stack 首帧不同 → 算两种', () => {
    const f = createCrashFilter();
    expect(f.accept(raw({ stack: 'at A (a.js:1:1)\nat tick (cc.js:1:9)' }))).not.toBeNull();
    expect(f.accept(raw({ stack: 'at B (b.js:2:2)\nat tick (cc.js:1:9)' }))).not.toBeNull();
  });

  it('3. stack 首帧相同但后续帧不同 → 算一种', () => {
    const f = createCrashFilter();
    expect(f.accept(raw({ stack: 'at A (a.js:1:1)\nat X (x.js:1:1)' }))).not.toBeNull();
    expect(f.accept(raw({ stack: 'at A (a.js:1:1)\nat Y (y.js:9:9)' }))).toBeNull();
  });

  it('4. stack 首帧相同但 message 不同 → 算两种', () => {
    const f = createCrashFilter();
    expect(f.accept(raw({ message: 'boom' }))).not.toBeNull();
    expect(f.accept(raw({ message: 'bang' }))).not.toBeNull();
  });

  it('5. 每次 createCrashFilter 都是新实例，状态不串（硬规则二）', () => {
    expect(createCrashFilter().accept(raw())).not.toBeNull();
    expect(createCrashFilter().accept(raw())).not.toBeNull();
  });
});

describe('createCrashFilter — 种类上限', () => {
  it('6. 默认 8 种：喂 9 种只过前 8 种', () => {
    const f = createCrashFilter();
    const passed = Array.from({ length: 9 }, (_, i) => f.accept(raw({ message: `e${i}` }))).filter(
      (e) => e !== null,
    );
    expect(passed.map((e) => e.message)).toEqual(['e0', 'e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7']);
  });

  it('7. maxKinds 可配：传 2 就只过 2 种', () => {
    const f = createCrashFilter({ maxKinds: 2 });
    expect(f.accept(raw({ message: 'a' }))).not.toBeNull();
    expect(f.accept(raw({ message: 'b' }))).not.toBeNull();
    expect(f.accept(raw({ message: 'c' }))).toBeNull();
  });

  it('8. 达到上限后，已报过的那种也不再重复上报', () => {
    const f = createCrashFilter({ maxKinds: 1 });
    expect(f.accept(raw({ message: 'a' }))).not.toBeNull();
    expect(f.accept(raw({ message: 'b' }))).toBeNull();
    expect(f.accept(raw({ message: 'a' }))).toBeNull();
  });
});

describe('createCrashFilter — 规整', () => {
  it('9. location 只留首行（引擎会把出错那行源码连同等长空格附在后面）', () => {
    const bloated = `src/foo/Bar.ts:42\n${'const x='.repeat(6000)}\n${' '.repeat(48000)}^`;
    const e = createCrashFilter().accept(raw({ location: bloated }));
    expect(e?.location).toBe('src/foo/Bar.ts:42');
  });

  it('10. 首行末尾的 \\r 与空白一并去掉（CRLF 产物）', () => {
    const e = createCrashFilter().accept(raw({ location: 'src/a.ts:1  \r\nsource line' }));
    expect(e?.location).toBe('src/a.ts:1');
  });

  it('11. stack 原样保留（截断会毁掉后续帧的定位价值）', () => {
    const e = createCrashFilter().accept(raw());
    expect(e?.stack).toBe(raw().stack);
    expect(e?.linenum).toBe(42);
    expect(e?.message).toBe(raw().message);
  });
});

describe('crashPayload', () => {
  it('12. 指纹不进上报载荷（它只供调试与单测断言）', () => {
    const e = createCrashFilter().accept(raw())!;
    const p = JSON.parse(crashPayload(e, () => ({})));
    expect(e.fingerprint).toBeTruthy();
    expect(p).not.toHaveProperty('fingerprint');
    expect(Object.keys(p).sort()).toEqual(['ctx', 'frames', 'linenum', 'location', 'message', 'stack']);
  });

  it('13. ctx 是**上报那一刻**现取的，不是装钩子那一刻', () => {
    const e = createCrashFilter().accept(raw())!;
    let scene = 'Boot';
    const get = (): Record<string, string> => ({ scene });
    scene = 'Lobby';
    expect(JSON.parse(crashPayload(e, get)).ctx).toEqual({ scene: 'Lobby' });
  });

  it('14. getter 自己抛也不打断上报，ctx 退化成空表', () => {
    const e = createCrashFilter().accept(raw())!;
    const p = JSON.parse(
      crashPayload(e, () => {
        throw new Error('登录态还没就绪');
      }),
    );
    expect(p.ctx).toEqual({});
    expect(p.message).toBe(raw().message);
  });

  it('15. getter 返回 undefined 也不炸', () => {
    const e = createCrashFilter().accept(raw())!;
    const get = (): Record<string, string> => undefined as unknown as Record<string, string>;
    expect(JSON.parse(crashPayload(e, get)).ctx).toEqual({});
  });
});

/**
 * 堆栈解析。它存在的唯一理由是 **Crashlytics 的 Android SDK 没有「上报一段自定义堆栈文本」
 * 这个 API**（iOS 有 `ExceptionModel`，Android 没有对应物）——只能造一个 `Throwable` 再
 * `setStackTrace(StackTraceElement[])`。那就得先把 V8 的堆栈字符串拆成帧。
 *
 * 拆在这边而不是 Java 侧，因为它是**有分支的逻辑**：格式有好几种、还有畸形行要跳过。
 * 写进 `cap-report-firebase/` 的话，一行都测不到（硬规则一）。
 */
describe('parseJsFrames', () => {
  it('16. 具名帧：函数名 / 文件 / 行号各就各位', () => {
    expect(parseJsFrames('    at Foo.bar (assets/main/Foo.js:12:5)')).toEqual([
      { fn: 'Foo.bar', file: 'assets/main/Foo.js', line: 12 },
    ]);
  });

  it('17. 匿名帧（没有函数名那对括号）', () => {
    expect(parseJsFrames('    at assets/main/Foo.js:3:1')).toEqual([
      { fn: '<anonymous>', file: 'assets/main/Foo.js', line: 3 },
    ]);
  });

  it('18. 首行是消息不是帧，跳过', () => {
    const stack = 'Error: boom\n    at a.js:1:1';
    expect(parseJsFrames(stack)).toEqual([{ fn: '<anonymous>', file: 'a.js', line: 1 }]);
  });

  it('19. 多帧保序', () => {
    const stack = ['    at a (x.js:1:1)', '    at b (y.js:2:2)', '    at c (z.js:3:3)'].join('\n');
    expect(parseJsFrames(stack).map((f) => f.fn)).toEqual(['a', 'b', 'c']);
  });

  it('20. 文件路径里带冒号（file:/// 与盘符）时，认最后两段数字', () => {
    expect(parseJsFrames('    at boot (file:///D:/proj/main.js:42:7)')).toEqual([
      { fn: 'boot', file: 'file:///D:/proj/main.js', line: 42 },
    ]);
  });

  it('21. 畸形行安静跳过，不炸也不产生垃圾帧', () => {
    const stack = ['    at [native code]', '', '   at ', '    at ok (a.js:9:1)'].join('\n');
    expect(parseJsFrames(stack)).toEqual([{ fn: 'ok', file: 'a.js', line: 9 }]);
  });

  it('22. 空堆栈是空数组，不是抛', () => {
    expect(parseJsFrames('')).toEqual([]);
  });

  it('23. 截到上限（Crashlytics 对帧数没明说，但载荷不该无界）', () => {
    const stack = Array.from({ length: 50 }, (_, i) => `    at f${i} (a.js:${i + 1}:1)`).join('\n');
    expect(parseJsFrames(stack, 30)).toHaveLength(30);
    expect(parseJsFrames(stack, 30)[29].fn).toBe('f29');
  });

  it('24. crashPayload 顺带带上 frames —— Bugly 用 stack、Firebase 用 frames，各取所需', () => {
    const e = createCrashFilter().accept({
      location: 'a.js',
      linenum: 1,
      message: 'boom',
      stack: 'Error: boom\n    at f (a.js:7:2)',
    })!;
    const p = JSON.parse(crashPayload(e, () => ({})));
    expect(p.frames).toEqual([{ fn: 'f', file: 'a.js', line: 7 }]);
    expect(p.stack).toContain('at f (a.js:7:2)');
  });
});

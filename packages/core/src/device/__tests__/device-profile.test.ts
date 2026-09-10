import { describe, expect, it } from 'vitest';

import {
  BRIDGE_FAILURE,
  exitReasonName,
  mergeDeviceProfile,
  parseBridgeProfile,
  parseWebProfile,
} from '../device-profile';

describe('exitReasonName', () => {
  it('17 个 REASON_* 逐个映射（值取自 javap 读 android.jar，不是凭记忆）', () => {
    expect([...Array(17).keys()].map(exitReasonName)).toEqual([
      'unknown',
      'exitSelf',
      'signaled',
      'lowMemory',
      'crash',
      'crashNative',
      'anr',
      'initializationFailure',
      'permissionChange',
      'excessiveResourceUsage',
      'userRequested',
      'userStopped',
      'dependencyDied',
      'other',
      'freezer',
      'packageStateChange',
      'packageUpdated',
    ]);
  });

  it('不认识的码带上码，**不并进 other** —— REASON_OTHER(13) 是个有确切含义的取值', () => {
    expect(exitReasonName(17)).toBe('unknown-17');
    expect(exitReasonName(99)).toBe('unknown-99');
    expect(exitReasonName(13)).toBe('other'); // 真正的 other 不受影响
  });
});

describe('parseBridgeProfile · 桥不在 vs 桥坏了', () => {
  it.each([undefined, null, ''])('没有桥（%s）→ 空结果，**不记失败**：缺席不是故障', (input) => {
    expect(parseBridgeProfile(input)).toEqual({ fields: {}, readFailures: [] });
  });

  it('非法 JSON → 记一条 bridge：桥在，但坏了', () => {
    expect(parseBridgeProfile('{ not json')).toEqual({
      fields: {},
      readFailures: [BRIDGE_FAILURE],
    });
  });

  it.each(['[]', '42', '"hi"', 'null'])('顶层不是对象（%s）→ 同样算桥坏了', (input) => {
    expect(parseBridgeProfile(input)).toEqual({ fields: {}, readFailures: [BRIDGE_FAILURE] });
  });
});

describe('parseBridgeProfile · 字段守卫', () => {
  it('正常载荷：各类字段各就各位，退出码翻成名字', () => {
    const { fields, readFailures } = parseBridgeProfile(
      JSON.stringify({
        processMemoryLimitBytes: 268435456,
        deviceTotalMemoryBytes: 3958374400,
        availableMemoryBytes: 1200000000,
        lowRamDevice: false,
        cpuCores: 8,
        densityDpi: 420,
        brand: 'Xiaomi',
        model: 'Redmi Note 8',
        abis: 'arm64-v8a,armeabi-v7a',
        lastExitReasonCode: 3,
      }),
    );

    expect(readFailures).toEqual([]);
    expect(fields).toEqual({
      processMemoryLimitBytes: 268435456,
      deviceTotalMemoryBytes: 3958374400,
      availableMemoryBytes: 1200000000,
      lowRamDevice: false,
      cpuCores: 8,
      densityDpi: 420,
      brand: 'Xiaomi',
      model: 'Redmi Note 8',
      abis: 'arm64-v8a,armeabi-v7a',
      lastExitReason: 'lowMemory',
    });
  });

  it('字段**缺席**不记失败 —— 那是「这个平台没这能力」，不是「读失败」', () => {
    const { fields, readFailures } = parseBridgeProfile(JSON.stringify({ cpuCores: 4 }));
    expect(fields).toEqual({ cpuCores: 4 });
    expect(readFailures).toEqual([]);
  });

  it('⚠️ 负数被拒并记名 —— JNI 那头出错最常见的就是 -1，放进来会被打分当成一台极小内存的机器', () => {
    const { fields, readFailures } = parseBridgeProfile(
      JSON.stringify({ processMemoryLimitBytes: -1, cpuCores: 8 }),
    );
    expect(fields).toEqual({ cpuCores: 8 });
    expect(readFailures).toEqual(['processMemoryLimitBytes']);
  });

  it.each([
    ['NaN 走 JSON 会变 null', { cpuCores: null }],
    ['字符串塞进数字位', { cpuCores: '8' }],
    ['对象塞进数字位', { cpuCores: {} }],
  ])('数字位给了垃圾（%s）→ 跳过并记名', (_label, payload) => {
    const { fields, readFailures } = parseBridgeProfile(JSON.stringify(payload));
    expect(fields).toEqual({});
    expect(readFailures).toEqual(['cpuCores']);
  });

  it('空字符串算没读到（桥拿不到时最常见的返回）', () => {
    const { fields, readFailures } = parseBridgeProfile(JSON.stringify({ socModel: '', brand: 'v' }));
    expect(fields).toEqual({ brand: 'v' });
    expect(readFailures).toEqual(['socModel']);
  });

  it('布尔位只认真布尔', () => {
    const { fields, readFailures } = parseBridgeProfile(
      JSON.stringify({ lowRamDevice: 1, supportsAstc: true }),
    );
    expect(fields).toEqual({ supportsAstc: true });
    expect(readFailures).toEqual(['lowRamDevice']);
  });

  it('lastExitReasonCode 不是整数 → 记名，不瞎猜', () => {
    expect(parseBridgeProfile(JSON.stringify({ lastExitReasonCode: 'crash' })).readFailures).toEqual(
      ['lastExitReasonCode'],
    );
    expect(parseBridgeProfile(JSON.stringify({ lastExitReasonCode: 3.5 })).readFailures).toEqual([
      'lastExitReasonCode',
    ]);
  });
});

describe('parseBridgeProfile · readFailures 合并', () => {
  it('Java 自己报的失败一并合入（它才知道 /sys 节点在不在、SOC_MODEL 反射不到）', () => {
    const { readFailures } = parseBridgeProfile(
      JSON.stringify({ readFailures: ['cpuMaxFreqKHz', 'socModel'], cpuCores: 8 }),
    );
    expect(readFailures).toEqual(['cpuMaxFreqKHz', 'socModel']);
  });

  it('Java 报的清单里的非字符串 / 空串被滤掉', () => {
    const { readFailures } = parseBridgeProfile(
      JSON.stringify({ readFailures: ['ok', '', 42, null, { a: 1 }] }),
    );
    expect(readFailures).toEqual(['ok']);
  });

  it('同一字段既被 Java 报了、类型又不对，只记一次', () => {
    const { readFailures } = parseBridgeProfile(
      JSON.stringify({ readFailures: ['cpuCores'], cpuCores: -1 }),
    );
    expect(readFailures).toEqual(['cpuCores']);
  });

  it('readFailures 不是数组时忽略它，不当成桥坏了', () => {
    const { fields, readFailures } = parseBridgeProfile(
      JSON.stringify({ readFailures: 'oops', cpuCores: 8 }),
    );
    expect(fields).toEqual({ cpuCores: 8 });
    expect(readFailures).toEqual([]);
  });
});

describe('mergeDeviceProfile', () => {
  it('后面的覆盖前面的 —— 引擎直接问到的比反射回来的权威', () => {
    const p = mergeDeviceProfile(
      { fields: { model: 'from-bridge', cpuCores: 8 } },
      { fields: { model: 'from-engine' } },
    );
    expect(p.model).toBe('from-engine');
    expect(p.cpuCores).toBe(8);
  });

  it('undefined 不覆盖已有值（engine 那半读不到某项时不该把桥的结果抹掉）', () => {
    const p = mergeDeviceProfile(
      { fields: { gpuRenderer: 'Adreno 610' } },
      { fields: { gpuRenderer: undefined } },
    );
    expect(p.gpuRenderer).toBe('Adreno 610');
  });

  it('readFailures 取并集并去重', () => {
    const p = mergeDeviceProfile(
      { readFailures: ['a', 'b'] },
      { readFailures: ['b', 'c'] },
      { fields: {} },
    );
    expect(p.readFailures).toEqual(['a', 'b', 'c']);
  });

  it('什么都不给也是一份合法画像（web 上就长这样）', () => {
    expect(mergeDeviceProfile()).toEqual({ readFailures: [] });
  });
});

describe('parseWebProfile · 浏览器那三项', () => {
  it('全都读到：GB 换成字节、dpr 换成 densityDpi（× 160，对齐 Android 口径）', () => {
    expect(
      parseWebProfile({ deviceMemoryGB: 4, hardwareConcurrency: 8, devicePixelRatio: 3 }),
    ).toEqual({
      fields: {
        deviceTotalMemoryBytes: 4 * 1024 ** 3,
        cpuCores: 8,
        densityDpi: 480,
      },
      readFailures: [],
    });
  });

  it('⚠️ deviceMemory 缺席**不记失败** —— http 下浏览器就是不给（安全上下文才有），这不是故障', () => {
    const r = parseWebProfile({ hardwareConcurrency: 14, devicePixelRatio: 1 });
    expect(r.fields.deviceTotalMemoryBytes).toBeUndefined();
    expect(r.readFailures).toEqual([]);
  });

  it('hardwareConcurrency / devicePixelRatio 缺席**要记失败** —— 它们是 web 的标配能力', () => {
    expect(parseWebProfile({}).readFailures.sort()).toEqual(['cpuCores', 'densityDpi']);
  });

  it('给了垃圾值（0 / 负数 / NaN / 字符串）一律拒收并记名', () => {
    const r = parseWebProfile({
      deviceMemoryGB: -1,
      hardwareConcurrency: 0,
      devicePixelRatio: NaN,
    });
    expect(r.fields).toEqual({});
    expect(r.readFailures.sort()).toEqual(['cpuCores', 'densityDpi', 'deviceTotalMemoryBytes']);
    expect(parseWebProfile({ hardwareConcurrency: '8', devicePixelRatio: 1 }).readFailures).toContain(
      'cpuCores',
    );
  });

  it('dpr 是小数也照算（2.75 的机器很多），四舍五入到整数 dpi', () => {
    expect(parseWebProfile({ devicePixelRatio: 2.75, hardwareConcurrency: 8 }).fields.densityDpi).toBe(440);
  });

  it('deviceMemory 的量化与封顶不在这里补救 —— 原样换算，8 就是 8', () => {
    // 规范要求量化成 2 的幂且**封顶 8**：一台 16GB 的机器也只报 8。
    // 这里不去猜真实值（猜错比缺失更糟），封顶的语义写进文档由打分函数自己知情。
    expect(parseWebProfile({ deviceMemoryGB: 8 }).fields.deviceTotalMemoryBytes).toBe(8 * 1024 ** 3);
    expect(parseWebProfile({ deviceMemoryGB: 0.25 }).fields.deviceTotalMemoryBytes).toBe(0.25 * 1024 ** 3);
  });
});

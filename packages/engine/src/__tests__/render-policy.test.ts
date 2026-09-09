import { describe, expect, it } from 'vitest';
import {
  CAMERA_PRIORITY,
  CCK_LAYERS,
  computeCameraCenter,
  computeOrthoHeight,
  computeSafeAreaInsets,
  createClearOwnership,
  pickDesignResolution,
} from '../render-policy';

/**
 * render-policy 是相机组/分辨率适配的**纯决策逻辑**（零 cc import），故可 node 单测。
 * 真节点/相机/Widget 的行为按 ADR-0002 决策 3 不进 cc mock，走 apps/demo 预览验证。
 */

describe('pickDesignResolution（锁短边，随横竖屏切换）', () => {
  it('1. 竖屏 → 设计 1080x1920、锁宽', () => {
    expect(pickDesignResolution(1080, 2400)).toEqual({
      orientation: 'portrait',
      width: 1080,
      height: 1920,
      lockAxis: 'width',
    });
  });

  it('2. 横屏 → 设计换成 1920x1080、锁高', () => {
    expect(pickDesignResolution(2400, 1080)).toEqual({
      orientation: 'landscape',
      width: 1920,
      height: 1080,
      lockAxis: 'height',
    });
  });

  it('3. 正方形按竖屏处理（w <= h → portrait）', () => {
    expect(pickDesignResolution(1000, 1000).orientation).toBe('portrait');
  });

  it('4. 极端宽屏仍是横屏那套（短边恒 1080 不裁切）', () => {
    const r = pickDesignResolution(3200, 1000);
    expect(r).toEqual({ orientation: 'landscape', width: 1920, height: 1080, lockAxis: 'height' });
  });

  it('5. 自定义短/长边生效', () => {
    expect(pickDesignResolution(750, 1334, 750, 1334)).toEqual({
      orientation: 'portrait',
      width: 750,
      height: 1334,
      lockAxis: 'width',
    });
  });

  it('6. 短/长边传反了也归一化（内部取 min/max）', () => {
    expect(pickDesignResolution(1080, 2400, 1920, 1080)).toEqual({
      orientation: 'portrait',
      width: 1080,
      height: 1920,
      lockAxis: 'width',
    });
  });

  it('7. 非法窗口尺寸退化为竖屏，不抛错', () => {
    expect(pickDesignResolution(0, 0).orientation).toBe('portrait');
    expect(pickDesignResolution(Number.NaN, Number.NaN).orientation).toBe('portrait');
  });
});

describe('computeOrthoHeight（照抄 canvas.ts::_onResizeCamera）', () => {
  it('8. 无 targetTexture：windowHeight / scaleY / 2', () => {
    expect(
      computeOrthoHeight({
        windowHeight: 2400,
        scaleY: 1.25,
        hasTargetTexture: false,
        visibleRectHeight: 1920,
      }),
    ).toBe(960);
  });

  it('9. 有 targetTexture：visibleRect.height / 2（分支不可省）', () => {
    expect(
      computeOrthoHeight({
        windowHeight: 2400,
        scaleY: 1.25,
        hasTargetTexture: true,
        visibleRectHeight: 1920,
      }),
    ).toBe(960);
  });

  it('10. scaleY <= 0 / NaN 时回退，不把 Infinity/NaN 灌进渲染管线', () => {
    for (const scaleY of [0, -1, Number.NaN]) {
      const h = computeOrthoHeight({
        windowHeight: 2400,
        scaleY,
        hasTargetTexture: false,
        visibleRectHeight: 1920,
      });
      expect(h).toBe(960);
      expect(Number.isFinite(h)).toBe(true);
    }
  });
});

describe('computeCameraCenter（UI 坐标系原点在可视区左下角，相机不能留在世界原点）', () => {
  // 回归用例：相机曾放在 (0,0)，视野 [-w/2,w/2]×[-h/2,h/2] 与 Widget 拉满屏的
  // [0,w]×[0,h] 整整错开半屏 —— 表现为界面挤到右上角、大半不可见。
  it('18. 竖屏 1080x1920 → 相机落 (540, 960)，与编辑器 Canvas 的落点一致', () => {
    expect(computeCameraCenter(1080, 1920)).toEqual({ x: 540, y: 960 });
  });

  it('19. 横屏 1920x1080 → 相机落 (960, 540)（转屏后跟着走）', () => {
    expect(computeCameraCenter(1920, 1080)).toEqual({ x: 960, y: 540 });
  });

  it('20. 绝不是世界原点（防回归）', () => {
    const c = computeCameraCenter(1080, 1920);
    expect(c.x).not.toBe(0);
    expect(c.y).not.toBe(0);
  });
});

describe('createClearOwnership（清色职责移交，守「最低活动相机必须 SOLID_COLOR」）', () => {
  const SOLID = 7; // cc Camera.ClearFlag.SOLID_COLOR = ClearFlagBit.ALL
  const DEPTH = 6; // cc Camera.ClearFlag.DEPTH_ONLY  = ClearFlagBit.DEPTH_STENCIL

  const setup = (): {
    bg: { node: { active: boolean } };
    own: ReturnType<typeof createClearOwnership>;
  } => {
    const bg = { node: { active: true } };
    return { bg, own: createClearOwnership({ background: bg, solidColor: SOLID, depthOnly: DEPTH }) };
  };

  it('11. claim：借用方转 SOLID_COLOR + 背景相机关掉', () => {
    const { bg, own } = setup();
    const cam = { clearFlags: DEPTH };
    own.claim(cam);
    expect(cam.clearFlags).toBe(SOLID);
    expect(bg.node.active).toBe(false);
    expect(own.owner()).toBe(cam);
  });

  it('12. release：借用方恢复 DEPTH_ONLY + 背景相机开回', () => {
    const { bg, own } = setup();
    const cam = { clearFlags: DEPTH };
    own.claim(cam);
    own.release();
    expect(cam.clearFlags).toBe(DEPTH);
    expect(bg.node.active).toBe(true);
    expect(own.owner()).toBeUndefined();
  });

  it('13. 重复 claim 同一台是幂等的', () => {
    const { bg, own } = setup();
    const cam = { clearFlags: DEPTH };
    own.claim(cam);
    own.claim(cam);
    expect(cam.clearFlags).toBe(SOLID);
    expect(bg.node.active).toBe(false);
    expect(own.owner()).toBe(cam);
  });

  it('14. claim(A) 后 claim(B)：A 归还 DEPTH_ONLY、B 接手、背景仍关（不变式不破）', () => {
    const { bg, own } = setup();
    const a = { clearFlags: DEPTH };
    const b = { clearFlags: DEPTH };
    own.claim(a);
    own.claim(b);
    expect(a.clearFlags).toBe(DEPTH);
    expect(b.clearFlags).toBe(SOLID);
    expect(bg.node.active).toBe(false);
    expect(own.owner()).toBe(b);
  });

  it('15. 未 claim 就 release / 重复 release 都是 no-op，不抛错', () => {
    const { bg, own } = setup();
    expect(() => own.release()).not.toThrow();
    expect(bg.node.active).toBe(true);
    const cam = { clearFlags: DEPTH };
    own.claim(cam);
    own.release();
    expect(() => own.release()).not.toThrow();
    expect(cam.clearFlags).toBe(DEPTH);
    expect(bg.node.active).toBe(true);
  });
});

describe('常量阶梯', () => {
  it('16. priority 递增且给 3D 世界留出 1..99 空档', () => {
    expect(CAMERA_PRIORITY.bg).toBe(0);
    expect(CAMERA_PRIORITY.uiBack).toBe(100);
    expect(CAMERA_PRIORITY.ui).toBe(200);
    expect(CAMERA_PRIORITY.uiFront).toBe(300);
    // 背景与最低 UI 层之间必须有可插入空间（3D world / 特效相机）
    expect(CAMERA_PRIORITY.uiBack - CAMERA_PRIORITY.bg).toBeGreaterThan(1);
  });

  it('17. 自定义层 bit 落在引擎允许的 0..19 且互不重叠', () => {
    const bits = Object.values(CCK_LAYERS).map((l) => l.bit);
    expect(new Set(bits).size).toBe(bits.length);
    for (const bit of bits) {
      expect(bit).toBeGreaterThanOrEqual(0);
      expect(bit).toBeLessThanOrEqual(19);
    }
  });
});

describe('computeSafeAreaInsets（刘海 / 挖孔 / 圆角：安全矩形 → 四边内缩）', () => {
  const full = { x: 0, y: 0, width: 1080, height: 1920 };

  it('21. 非异形屏：安全矩形就是整个可视区 → 四边全 0', () => {
    expect(computeSafeAreaInsets(1080, 1920, full)).toEqual({
      top: 0,
      bottom: 0,
      left: 0,
      right: 0,
    });
  });

  it('22. 竖屏顶部挖孔：只缩上边（y 是下边距，不是上边距——UI 坐标系 y 轴向上）', () => {
    expect(
      computeSafeAreaInsets(1080, 1920, {
        x: 0,
        y: 0,
        width: 1080,
        height: 1820,
      }),
    ).toEqual({
      top: 100,
      bottom: 0,
      left: 0,
      right: 0,
    });
  });

  it('23. 底部圆角 / home 条：y 抬起来 → 缩下边', () => {
    expect(
      computeSafeAreaInsets(1080, 1920, {
        x: 0,
        y: 60,
        width: 1080,
        height: 1860,
      }),
    ).toEqual({
      top: 0,
      bottom: 60,
      left: 0,
      right: 0,
    });
  });

  it('24. 横屏刘海在侧：左右各缩（symmetric 下引擎已把两侧取大者对齐）', () => {
    expect(
      computeSafeAreaInsets(1920, 1080, {
        x: 90,
        y: 0,
        width: 1740,
        height: 1080,
      }),
    ).toEqual({
      top: 0,
      bottom: 0,
      left: 90,
      right: 90,
    });
  });

  it('25. 安全矩形比可视区还大（平台返回脏数据）→ 内缩不许为负', () => {
    const i = computeSafeAreaInsets(1080, 1920, {
      x: -10,
      y: -10,
      width: 1200,
      height: 2000,
    });
    expect(i).toEqual({ top: 0, bottom: 0, left: 0, right: 0 });
  });

  it('26. 尺寸非法（headless / 窗口最小化，取到 0 或 NaN）→ 全 0，不抛错也不外泄 NaN', () => {
    expect(computeSafeAreaInsets(0, 0, { x: 0, y: 0, width: 0, height: 0 })).toEqual({
      top: 0,
      bottom: 0,
      left: 0,
      right: 0,
    });
    expect(
      computeSafeAreaInsets(NaN, NaN, {
        x: NaN,
        y: NaN,
        width: NaN,
        height: NaN,
      }),
    ).toEqual({
      top: 0,
      bottom: 0,
      left: 0,
      right: 0,
    });
  });
});

describe('转屏：同一块硬件，安全区换到另一根轴（pickDesignResolution × computeSafeAreaInsets）', () => {
  // 一台 1080×2400 的挖孔机，挖孔在**物理顶边** 136px。两个方向都锁短边 1080：
  // 竖屏 FIXED_WIDTH → scaleX = 1080/1080 = 1，横屏 FIXED_HEIGHT → scaleY = 1080/1080 = 1，
  // 所以两边的「设计单位」都恰好等于物理像素，数能直接对上（也正是 2026-09-09 模拟器实测那台）。
  // safe rect 按引擎 symmetric=true 的口径给：挖孔那根轴上两头取大者对齐。
  const CUT = 136;

  it('27. 竖屏：挖孔在短边(上) → 缩上下，左右不动', () => {
    const r = pickDesignResolution(1080, 2400);
    expect(r).toMatchObject({ orientation: 'portrait', lockAxis: 'width' });
    // 可视区 = 1080 × 2400（锁宽后长边随屏幕比例延展，不是 1920）
    expect(
      computeSafeAreaInsets(1080, 2400, {
        x: 0,
        y: CUT,
        width: 1080,
        height: 2400 - 2 * CUT,
      }),
    ).toEqual({
      top: CUT,
      bottom: CUT,
      left: 0,
      right: 0,
    });
  });

  it('28. 横屏：同一个挖孔转到短边(侧) → 缩左右，上下不动', () => {
    const r = pickDesignResolution(2400, 1080);
    expect(r).toMatchObject({ orientation: 'landscape', lockAxis: 'height' });
    expect(
      computeSafeAreaInsets(2400, 1080, {
        x: CUT,
        y: 0,
        width: 2400 - 2 * CUT,
        height: 1080,
      }),
    ).toEqual({
      top: 0,
      bottom: 0,
      left: CUT,
      right: CUT,
    });
  });

  it('29. 拿转屏**前**的可视尺寸去算转屏后的安全区 → 荒唐值（钉住「先换设计分辨率、再读安全区」的顺序）', () => {
    // resolutionModule 是先 setDesignResolutionSize 再回调 onOrientationChange 的；
    // 万一有人把读安全区挪到换分辨率之前，拿到的就是这个：
    const stale = computeSafeAreaInsets(1080, 2400, {
      x: CUT,
      y: 0,
      width: 2400 - 2 * CUT,
      height: 1080,
    });
    expect(stale).not.toEqual({ top: 0, bottom: 0, left: CUT, right: CUT });
    // 具体错成什么样：上边被算出整整 1320 —— 界面会被推到屏幕中间往下一大截
    expect(stale.top).toBe(2400 - 1080);
    // 而右边算出负数、被 nonNeg 压成 0 —— 该缩的那条边反而一点没缩
    expect(stale.right).toBe(0);
  });
});

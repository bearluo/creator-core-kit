import { describe, expect, it } from 'vitest';
import {
  CAMERA_PRIORITY,
  CCK_LAYERS,
  computeCameraCenter,
  computeOrthoHeight,
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

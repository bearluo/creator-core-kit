import { describe, expect, it } from 'vitest';
import { FISH_KINDS, fishKind } from '../../../assets/modules/mini-fish/content/fish-kinds';
import { FIELD } from '../../../assets/modules/mini-fish/content/paths';
import {
  ART_FPS,
  fieldScale,
  fishFacing,
  fishFrame,
  visibleField,
} from '../../../assets/modules/mini-fish/render-map';

/**
 * 这个模块存在的理由是「游戏和编辑器看到的是同一条规则」。所以这里钉的不是实现，
 * 是**三条会被人各写一份的规则**：帧号怎么走、朝左怎么翻、场地怎么裁。
 */
describe('render-map · 帧号', () => {
  const red = fishKind(0); // fish_red，4 帧
  const shark = fishKind(9); // fish_shayu，8 帧

  it('按 12fps 走，到头回绕 —— 每种鱼按自己的帧数回绕', () => {
    expect(fishFrame(red, 0)).toBe('fish_red_run_0');
    expect(fishFrame(red, 1 / ART_FPS)).toBe('fish_red_run_1');
    expect(fishFrame(red, 3 / ART_FPS)).toBe('fish_red_run_3');
    expect(fishFrame(red, 4 / ART_FPS)).toBe('fish_red_run_0'); // 4 帧的回绕了
    expect(fishFrame(shark, 4 / ART_FPS)).toBe('fish_shayu_run_4'); // 8 帧的还没
    expect(fishFrame(shark, 8 / ART_FPS)).toBe('fish_shayu_run_0');
  });

  it('12fps 是钉死的数 —— 用秒数直接问，别拿 ART_FPS 当单位（那样改了常量测试也跟着变）', () => {
    expect(ART_FPS).toBe(12);
    expect(fishFrame(red, 0.5)).toBe('fish_red_run_2'); // 0.5s → 第 6 帧 → 4 帧回绕成 2
    expect(fishFrame(shark, 0.5)).toBe('fish_shayu_run_6');
    expect(fishFrame(red, 1)).toBe('fish_red_run_0'); // 整 1 秒 = 12 帧，4 和 12 都整除
  });

  it('一帧之内不跳 —— 时间在 [n, n+1)/12 之间取到的都是第 n 帧', () => {
    expect(fishFrame(red, 1 / ART_FPS + 0.0001)).toBe('fish_red_run_1');
    expect(fishFrame(red, 2 / ART_FPS - 0.0001)).toBe('fish_red_run_1');
  });

  it('每种鱼的帧名都落在它自己声明的帧数内 —— 图集里没有的帧名会渲染成空白', () => {
    for (const kind of FISH_KINDS) {
      const seen = new Set<string>();
      for (let i = 0; i < kind.frames * 3; i++) seen.add(fishFrame(kind, i / ART_FPS));
      expect(seen.size, kind.id).toBe(kind.frames);
    }
  });
});

describe('render-map · 朝向', () => {
  it('鱼头朝 +x：切线方向直接当旋转角', () => {
    expect(fishFacing(0)).toEqual({ deg: 0, flipY: false });
    expect(fishFacing(Math.PI / 4).deg).toBeCloseTo(45, 9);
  });

  it('转过 90° 之后上下翻而不是继续转 —— 否则鱼肚皮朝天', () => {
    expect(fishFacing(Math.PI).flipY).toBe(true);
    expect(fishFacing(-Math.PI).flipY).toBe(true);
    expect(fishFacing(Math.PI / 2 + 0.001).flipY).toBe(true);
  });

  it('正 90°（垂直向上）不翻 —— 边界归「不翻」那一侧', () => {
    expect(fishFacing(Math.PI / 2).flipY).toBe(false);
    expect(fishFacing(-Math.PI / 2).flipY).toBe(false);
  });
});

describe('render-map · 场地缩放是 cover 不是 contain', () => {
  it('16:9 正好铺满，不缩不裁', () => {
    expect(fieldScale(1920, 1080)).toBe(1);
    expect(visibleField(1920, 1080)).toEqual({ width: FIELD.width, height: FIELD.height });
  });

  it('比 16:9 更宽的屏：宽度铺满，**上下被裁**', () => {
    // 20:9 的手机（2400×1080）
    const v = visibleField(2400, 1080);
    expect(v.width).toBe(FIELD.width); // 宽边顶满
    expect(v.height).toBeCloseTo(FIELD.height * (1920 / 2400), 9); // 864，裁掉 216
    expect(v.height).toBeLessThan(FIELD.height);
  });

  it('比 16:9 更高的屏：高度铺满，**左右被裁**', () => {
    const v = visibleField(1440, 1080); // 4:3
    expect(v.height).toBe(FIELD.height);
    expect(v.width).toBeCloseTo(FIELD.width * (1440 / 1920), 9); // 1440，裁掉 480
  });

  it('取的是较大者（cover）而不是较小者（contain）—— 差一个 Math.min 就变留黑边', () => {
    const contain = Math.min(2400 / FIELD.width, 1080 / FIELD.height);
    expect(fieldScale(2400, 1080)).toBeGreaterThan(contain);
    expect(fieldScale(2400, 1080)).toBe(2400 / FIELD.width);
  });
});

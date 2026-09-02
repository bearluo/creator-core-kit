import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FISH_KINDS } from '@game/content/fish-kinds';
import { ART_FPS, fishFrame } from '@game/render-map';
import { parseAtlasPlist } from '../src/atlas';

/**
 * 读的是**游戏真的在用的那张图集**。这条测试其实是在问一件事：
 * 「`render-map.fishFrame()` 吐出来的每个名字，图集里都真有那一帧吗」——
 * 有一个对不上，编辑器里那条鱼就是空白，而且不报错。
 */
const XML = readFileSync(
  fileURLToPath(new URL('../../demo/assets/modules/mini-fish/art/textures.plist', import.meta.url)),
  'utf8',
);
const frames = parseAtlasPlist(XML);

describe('图集 plist', () => {
  it('解出全部 167 帧，键名不带 .png（跟 Cocos 侧同名）', () => {
    expect(frames.size).toBe(167);
    expect(frames.has('fish_yellow_run_0')).toBe(true);
    expect(frames.has('fish_yellow_run_0.png')).toBe(false);
  });

  it('矩形 / 尺寸 / 旋转位都解对了', () => {
    // 直接对着 plist 里的原文抄的两帧，一转一不转
    expect(frames.get('fish_yellow_run_0')).toEqual({
      x: 825,
      y: 1921,
      w: 52,
      h: 34,
      ox: 0,
      oy: 0,
      rotated: true,
    });
    expect(frames.get('fish_yellow_run_1')).toEqual({
      x: 1728,
      y: 559,
      w: 51,
      h: 32,
      ox: 0,
      oy: 0,
      rotated: false,
    });
  });

  it('旋转帧真的存在且占比不小 —— 当成「都没转」处理会看到一堆侧躺的鱼', () => {
    const rotated = Array.from(frames.values()).filter((f) => f.rotated);
    expect(rotated.length).toBeGreaterThan(50);
  });

  it('每种鱼的每一帧图集里都有 —— 缺一帧就是一条画不出来的鱼', () => {
    const missing: string[] = [];
    for (const kind of FISH_KINDS) {
      for (let i = 0; i < kind.frames; i++) {
        const name = fishFrame(kind, i / ART_FPS);
        if (!frames.has(name)) missing.push(name);
      }
    }
    expect(missing).toEqual([]);
  });
});

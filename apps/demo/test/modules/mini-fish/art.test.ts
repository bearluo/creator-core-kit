import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MAX_LEVEL, MIN_LEVEL } from '../../../assets/modules/mini-fish/seams/economy';
import { DEAD_FRAMES, FISH_KINDS } from '../../../assets/modules/mini-fish/content/fish-kinds';

/**
 * 图集与代码对得上 —— **`mini-plane` 的 `check:masks` 在这里的对应物**。
 *
 * 判据是同一条：生成物 / 外部素材要不要配闸，看的是「源在不在仓里」。`textures.plist` 就在
 * `assets/modules/mini-fish/art/` 下，所以拿它当真源、在 vitest 里现读现比，不必再配一个
 * `--check` 脚本。挡的是这类事故：改了鱼种表的 `frames` 却没对着图集数一遍、
 * 加了第 8 级炮台却没有对应的 `weapon_level_8_*`、`r` 调得比画出来的鱼还大。
 *
 * ⚠️ 这些帧名在运行时是**字符串拼出来的**（`${kind.id}_run_${i}`），TypeScript 一个都看不见。
 * 拼错了不会红，只会在真机上少一张图 —— 所以只能靠这一份对账。
 */

const PLIST = 'apps/demo/assets/modules/mini-fish/art/textures.plist';

/** 从 plist 里取每一帧的**未旋转**显示尺寸（`textureRect` 的宽高即是，旋转只影响图集里怎么存）。 */
function readFrames(): Map<string, { w: number; h: number }> {
  const xml = readFileSync(PLIST, 'utf8');
  const out = new Map<string, { w: number; h: number }>();
  const re = /<key>([^<]+)\.png<\/key>\s*<dict>([\s\S]*?)<\/dict>/g;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    const size = /<key>spriteSize<\/key>\s*<string>\{(\d+),(\d+)\}<\/string>/.exec(m[2]);
    if (size) out.set(m[1], { w: Number(size[1]), h: Number(size[2]) });
  }
  return out;
}

const FRAMES = readFrames();

describe('图集与鱼种表对账', () => {
  it('plist 读得出来（167 帧）—— 读不出来下面全部无效，先钉死这一条', () => {
    expect(FRAMES.size).toBe(167);
  });

  it('每种鱼的游动帧**不多不少**正好 frames 张', () => {
    for (const k of FISH_KINDS) {
      for (let i = 0; i < k.frames; i++) {
        expect(FRAMES.has(`${k.id}_run_${i}`), `缺 ${k.id}_run_${i}`).toBe(true);
      }
      expect(FRAMES.has(`${k.id}_run_${k.frames}`), `${k.id} 的帧数比表里多`).toBe(false);
    }
  });

  it(`每种鱼的死亡帧正好 ${DEAD_FRAMES} 张（全表一致，所以是常量不是表列）`, () => {
    for (const k of FISH_KINDS) {
      for (let i = 0; i < DEAD_FRAMES; i++) {
        expect(FRAMES.has(`${k.id}_dead_${i}`), `缺 ${k.id}_dead_${i}`).toBe(true);
      }
      expect(FRAMES.has(`${k.id}_dead_${DEAD_FRAMES}`), `${k.id} 死亡帧比常量多`).toBe(false);
    }
  });

  it('判定半径 = 首帧短边的一半 —— 判定圈不许比画出来的鱼大', () => {
    for (const k of FISH_KINDS) {
      const f = FRAMES.get(`${k.id}_run_0`)!;
      expect(k.r * 2, `${k.id} 的 r 超过贴图短边`).toBeLessThanOrEqual(Math.min(f.w, f.h));
    }
  });
});

describe('图集与档位对账', () => {
  const levels = Array.from({ length: MAX_LEVEL - MIN_LEVEL + 1 }, (_, i) => MIN_LEVEL + i);

  it('每一档都有子弹、有网', () => {
    for (const l of levels) {
      expect(FRAMES.has(`bullet${l}`), `缺 bullet${l}`).toBe(true);
      expect(FRAMES.has(`net_${l}`), `缺 net_${l}`).toBe(true);
    }
  });

  it('每一档炮台都有待机 + 4 帧开火（View 按 `_0.._4` 播）', () => {
    for (const l of levels) {
      for (let i = 0; i <= 4; i++) {
        expect(FRAMES.has(`weapon_level_${l}_${i}`), `缺 weapon_level_${l}_${i}`).toBe(true);
      }
    }
  });

  it('没有第 MAX_LEVEL+1 档 —— 档位上限就是图集给到的上限', () => {
    expect(FRAMES.has(`bullet${MAX_LEVEL + 1}`)).toBe(false);
    expect(FRAMES.has(`net_${MAX_LEVEL + 1}`)).toBe(false);
  });
});

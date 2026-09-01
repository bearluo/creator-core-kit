// @ts-check
/**
 * 编辑器界面的**九宫格底图**生成器：一张 16×16 RGBA PNG，圆角 6px、1px 描边。
 *
 *   pnpm gen:ui-slice
 *
 * 为什么要一张图：Cocos 的 `Graphics` 画不了参与布局的背景（它是即时模式，尺寸得自己算），
 * 而 `Sprite.Type.SLICED` 拉伸九宫格是引擎原生的事。一张图配一个节点就够。
 *
 * **一张图为什么能同时给出「深底 + 亮边」**：`Sprite.color` 是**乘算**的 —— 底 180、边 255，
 * 染上任何一个颜色之后边永远比底亮 43%（255/180）。于是同一张 PNG 换个 `color` 就是另一档
 * 面板（主面板 / 内嵌卡片 / 选中态），不必为每档烘一张。⚠️ 反过来说**只能调暗不能调亮**，
 * 想要比 255 更亮的边只能重烘。
 *
 * 尺寸与半径跟原型（`apps/demo/docs/mockups/fish-editor-v2-prototype.html`）的
 * `border-radius: 6px; border: 1px` 对死 —— 那份原型是验收单，两边对不上就等于没照着做。
 * 九宫格切边取 7（= 半径 6 + 描边 1），中间留 2×2 参与拉伸：切在半径之内的话圆角会被拉变形。
 *
 * 4×4 超采样做抗锯齿：圆角不抗锯齿在深色底上是肉眼可见的锯齿。
 * 不配 `--check` 闸：源（本脚本）就在仓里、没有仓外美术要同步，判据同 `gen-noise.mjs`。
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SIZE = 16;
const RADIUS = 6;
const STROKE = 1;
const FILL = 180;
const EDGE = 255;
const SS = 4; // 每像素 4×4 超采样
const OUT = join(
  dirname(fileURLToPath(import.meta.url)),
  '../assets/modules/mini-fish-editor/art/panel.png',
);

/** 点 `(x, y)` 是否落在左下角为 `(x0, y0)`、边长 `w×h`、圆角 `r` 的圆角矩形内。 */
function inside(x, y, x0, y0, w, h, r) {
  if (x < x0 || y < y0 || x > x0 + w || y > y0 + h) return false;
  // 只有四个角的方形区域里才要量到圆心的距离，其余是直边
  const cx = x < x0 + r ? x0 + r : x > x0 + w - r ? x0 + w - r : x;
  const cy = y < y0 + r ? y0 + r : y > y0 + h - r ? y0 + h - r : y;
  return Math.hypot(x - cx, y - cy) <= r;
}

/** 一个像素里落在圆角矩形内的比例。 */
function coverage(px, py, x0, y0, w, h, r) {
  let hit = 0;
  for (let sy = 0; sy < SS; sy++) {
    for (let sx = 0; sx < SS; sx++) {
      if (inside(px + (sx + 0.5) / SS, py + (sy + 0.5) / SS, x0, y0, w, h, r)) hit++;
    }
  }
  return hit / (SS * SS);
}

// —— 编码 PNG（8bit RGBA、非隔行、每行 filter 0）——————————————————————
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = t[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
})();

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(CRC(body));
  return Buffer.concat([len, body, crc]);
}

const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  let p = y * (SIZE * 4 + 1);
  raw[p++] = 0; // filter: none
  for (let x = 0; x < SIZE; x++) {
    const out = coverage(x, y, 0, 0, SIZE, SIZE, RADIUS);
    const inn = coverage(x, y, STROKE, STROKE, SIZE - 2 * STROKE, SIZE - 2 * STROKE, RADIUS - STROKE);
    // 描边 = 外圆角减内圆角那一圈。按覆盖率混色，再除回 alpha（PNG 存的是非预乘）
    const lum = out < 1e-6 ? 0 : Math.round((FILL * inn + EDGE * (out - inn)) / out);
    raw[p++] = lum;
    raw[p++] = lum;
    raw[p++] = lum;
    raw[p++] = Math.round(out * 255);
  }
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // color type RGBA
writeFileSync(
  OUT,
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]),
);
console.log(`✓ ${OUT}  ${SIZE}×${SIZE}  圆角 ${RADIUS} · 描边 ${STROKE} · 底 ${FILL} 边 ${EDGE} · 九宫格切边 ${RADIUS + STROKE}`);

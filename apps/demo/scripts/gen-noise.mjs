// @ts-check
/**
 * 捕鱼水面的**噪声图**生成器：三层不同频率的 tileable value noise → 一张 64×64 RGBA PNG。
 *
 *   pnpm gen:noise
 *
 * 为什么烘成图而不在 shader 里现算：一次纹理采样比四五次 `fract(sin(...))` 便宜得多，
 * 而水波纹每帧每像素要采两次。64×64 是 2 的幂 —— WebGL1 只有 POT 贴图能开 REPEAT，
 * 而无缝平铺正是水面滚动的前提。
 *
 * 三个通道装三层频率（R 4×4 低频 / G 8×8 中频 / B 16×16 高频），一次采样拿三层：
 * 低频推大浪、中频做细纹、高频给焦散加碎光。**无缝**靠格点下标取模，天然首尾相接。
 *
 * 确定性：固定种子的 LCG，不用 `Math.random` —— 重跑一定得到同一张图，diff 才有意义。
 * 不配 `--check` 闸：源（本脚本）就在仓里、没有仓外美术要同步，重烘一次比对即可。
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SIZE = 64;
const OUT = join(dirname(fileURLToPath(import.meta.url)), '../assets/modules/mini-fish/art/noise.png');
/** 三个通道的格点密度。 */
const LAYERS = [4, 8, 16];

/** 固定种子 LCG（数值来自 Numerical Recipes），只为可重现。 */
function lcg(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

/** 五次平滑（Perlin 的 fade），比 smoothstep 少一道二阶不连续，放大了不起棱。 */
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

/** 一层 tileable value noise：`grid × grid` 个随机格点，双线性 + fade 插值到 SIZE×SIZE。 */
function layer(grid, rand) {
  const pts = new Float64Array(grid * grid);
  for (let i = 0; i < pts.length; i++) pts[i] = rand();
  const at = (x, y) => pts[(y % grid) * grid + (x % grid)]; // 取模 = 无缝
  const out = new Float64Array(SIZE * SIZE);
  const step = grid / SIZE;
  for (let y = 0; y < SIZE; y++) {
    const gy = y * step;
    const y0 = Math.floor(gy);
    const fy = fade(gy - y0);
    for (let x = 0; x < SIZE; x++) {
      const gx = x * step;
      const x0 = Math.floor(gx);
      const fx = fade(gx - x0);
      const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * fx;
      const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * fx;
      out[y * SIZE + x] = a + (b - a) * fy;
    }
  }
  return out;
}

const rand = lcg(20260828);
const channels = LAYERS.map((g) => layer(g, rand));

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
    const i = y * SIZE + x;
    raw[p++] = Math.round(channels[0][i] * 255);
    raw[p++] = Math.round(channels[1][i] * 255);
    raw[p++] = Math.round(channels[2][i] * 255);
    raw[p++] = 255;
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
console.log(`✓ ${OUT}  ${SIZE}×${SIZE}  三层格点 ${LAYERS.join(' / ')}`);

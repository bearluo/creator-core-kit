// @ts-check
/**
 * mini-plane 的**像素级碰撞掩码**生成器：PNG 的 alpha 通道 → 纯数据 TS 模块。
 *
 * 为什么要有构建期这一步：`PlaneVM` 是零 `cc` 的（铁律），拿不到 `Texture2D` / `readPixels`，
 * 也不能在 node 单测里去 decode PNG。所以把「形状」这件事在**源码期**一次性烘成普通数字数组，
 * 运行时和测试读的是同一份数据 —— 判定于是跨平台一致、可在 node 里逐像素复现。
 *
 *   pnpm gen:masks     重烘（改了美术之后）
 *   pnpm check:masks   校验（CI / 提交前：美术改了没重烘就报错）
 *
 * 只吃 8 位 RGBA、非隔行的 PNG —— Kenney 那批就是。别的格式直接抛，不猜。
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ART = join(HERE, '../assets/modules/mini-plane/art');
const OUT = join(HERE, '../assets/modules/mini-plane/collision-masks.ts');

/**
 * 「实心」的门槛。取 128 而不是 >0：贴图边缘那圈半透明抗锯齿像素不该要人命，
 * 而它同时让**飞机变小、岩石也变小** —— 两个方向都偏向玩家，不会出现"擦边判死"。
 */
const ALPHA_SOLID = 128;

/** 要烘的贴图 → 生成的常量名。螺旋桨三帧里 plane1/plane2 的实心像素是 plane0 的真子集，
 *  所以只烘 plane0：动画换帧不会让判定跟着抖。 */
const TARGETS = [
  { art: 'plane0', name: 'PLANE_MASK', note: '机身（螺旋桨三帧的并集 = plane0，故只烘这一张）' },
  { art: 'rock-top', name: 'ROCK_TOP_MASK', note: '上方岩石，尖端在**贴图底部**' },
  { art: 'rock-bottom', name: 'ROCK_BOTTOM_MASK', note: '下方岩石，尖端在**贴图顶部**' },
];

/** 解 PNG。只认 8bit RGBA / 非隔行，其余抛错。 */
function decodePng(file) {
  const buf = readFileSync(file);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error(`${file}: 不是 PNG`);
  let p = 8;
  let width = 0;
  let height = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 6 || data[12] !== 0)
        throw new Error(`${file}: 只支持 8bit RGBA 非隔行（实为 depth=${data[8]} color=${data[9]} interlace=${data[12]}）`);
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += len + 12;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const px = Buffer.alloc(height * stride);
  // 逐行反过滤（PNG filter 0..4），上一行取已解出的结果。
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = px.subarray(y * stride, (y + 1) * stride);
    const prev = y ? px.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? cur[x - 4] : 0;
      const b = prev[x];
      const c = x >= 4 ? prev[x - 4] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const q = a + b - c;
        const pa = Math.abs(q - a);
        const pb = Math.abs(q - b);
        const pc = Math.abs(q - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new Error(`${file}: 未知 filter ${filter}`);
      cur[x] = v & 0xff;
    }
  }
  return { width, height, px };
}

/** 位打包：一行 `ceil(width/32)` 个 32 位字，第 x 位放在 `bits[row*stride + (x>>>5)]` 的第 `x&31` 位。 */
function pack({ width, height, px }) {
  const stride = Math.ceil(width / 32);
  const bits = new Array(stride * height).fill(0);
  let solid = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (px[(y * width + x) * 4 + 3] < ALPHA_SOLID) continue;
      bits[y * stride + (x >>> 5)] |= 1 << (x & 31);
      solid++;
    }
  // `|=` 出来可能是负数（第 31 位），统一成无符号，生成的字面量才好读。
  return { width, height, stride, bits: bits.map((w) => w >>> 0), solid };
}

function emit() {
  const masks = TARGETS.map((t) => ({ ...t, mask: pack(decodePng(join(ART, `${t.art}.png`))) }));
  const lines = [
    '// 由 apps/demo/scripts/gen-collision-mask.mjs 生成，**勿手改**。',
    '// 重烘：pnpm gen:masks    校验：pnpm check:masks',
    '//',
    '// mini-plane 的像素级碰撞掩码 —— 贴图 alpha 通道逐像素烘成的位图。零 `cc`、零运行时解码：',
    `// \`PlaneVM\` 与 node 单测读的是同一份数据，判定跨平台逐位一致。实心门槛 alpha >= ${ALPHA_SOLID}`,
    '// （边缘那圈抗锯齿像素不要人命；它让飞机和岩石同时变小一圈，两个方向都偏向玩家）。',
    '',
    '/** 一张贴图的实心位图。`bits` 行主序，行内每 32 像素一个字，低位在左。 */',
    'export interface CollisionMask {',
    '  /** 贴图宽（像素）。 */',
    '  readonly width: number;',
    '  /** 贴图高（像素）。 */',
    '  readonly height: number;',
    '  /** 每行几个 32 位字 = `ceil(width / 32)`。 */',
    '  readonly stride: number;',
    '  /** 位图本体，长度 `stride * height`。 */',
    '  readonly bits: readonly number[];',
    '}',
    '',
    `/** 生成时用的实心门槛，记在这里便于对账。 */`,
    `export const MASK_ALPHA_SOLID = ${ALPHA_SOLID};`,
  ];
  for (const { name, note, art, mask } of masks) {
    const pct = ((mask.solid / (mask.width * mask.height)) * 100).toFixed(1);
    lines.push(
      '',
      `/** ${note}。源图 \`art/${art}.png\`，${mask.width}×${mask.height}，实心 ${mask.solid} 像素（${pct}%）。 */`,
      `export const ${name}: CollisionMask = {`,
      `  width: ${mask.width},`,
      `  height: ${mask.height},`,
      `  stride: ${mask.stride},`,
      '  bits: [',
    );
    // 一行一个贴图行：diff 看得出是哪几行变了。
    for (let y = 0; y < mask.height; y++)
      lines.push(`    ${mask.bits.slice(y * mask.stride, (y + 1) * mask.stride).join(', ')},`);
    lines.push('  ],', '};');
  }
  return lines.join('\n') + '\n';
}

const next = emit();
if (process.argv.includes('--check')) {
  let cur = '';
  try {
    cur = readFileSync(OUT, 'utf8');
  } catch {
    /* 文件不存在 = 没生成过，按不一致处理 */
  }
  if (cur !== next) {
    console.error('✗ collision-masks.ts 与 art/*.png 不同步 —— 改过贴图就得重烘：pnpm gen:masks');
    process.exit(1);
  }
  console.log('✓ collision-masks.ts 与 art/*.png 一致');
} else {
  writeFileSync(OUT, next);
  console.log(`✓ 已烘 ${TARGETS.length} 张掩码 → ${OUT}`);
}

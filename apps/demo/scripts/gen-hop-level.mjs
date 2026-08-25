#!/usr/bin/env node
/**
 * 把 Kenney 的 Construct 2 模板 `platformer.capx` 里那张手摆的关卡烘成纯数据
 * （`assets/modules/mini-hop/level.ts`）。
 *
 *   node scripts/gen-hop-level.mjs <解开的 platformer.capx 目录>
 *
 * ## 为什么要烘
 *
 * 跟 `gen-collision-mask.mjs` 同一个理由：**HopVM 零 `cc`、要在 node 里直跑**，它不能去读
 * scene、也不能有 108 个 `Node`。关卡在这里被解析成一串数字，VM 与单测读同一份 —— 于是
 * 「跳得上去吗」「这块砖挡不挡人」在 vitest 里就能问。
 *
 * ## 跟掩码那条流水线不一样的地方：**没有 `--check` 闸**
 *
 * `.capx` 不在本仓里（它是 Downloads 里的第三方素材包），CI 拿不到源就没法比对。所以这份
 * 生成物是**一次性烘出来、之后当手写文件维护**的；本脚本留着只为记清出处与换算规则。
 * 要改关卡就直接改 `level.ts`，别指望重跑本脚本能覆盖回去。
 *
 * ## 坐标换算
 *
 * C2：原点在布局左上、+Y **向下**、瓦片 `hotspot(0,0)` 即左上角。
 * Cocos：原点放在关卡左下、+Y 向上。于是 `cocosY = LEVEL_HEIGHT - c2Y - 高`（取左下角）。
 * 布局高 480 不是 70 的整数倍，瓦片是贴着**顶**排的，所以别去凑「行号」——直接存左下角坐标。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const src = process.argv[2];
if (!src) {
  console.error('用法: node scripts/gen-hop-level.mjs <解开的 platformer.capx 目录>');
  process.exit(1);
}

const LEVEL_WIDTH = 2000;
const LEVEL_HEIGHT = 480;
const TILE = 70;

/** C2 对象名 → 本模块的贴图名 / 用途。没列的对象直接丢掉。 */
const SOLID = { ground: 'ground', groundTop: 'ground-top', brick: 'brick', qBlock: 'qblock' };
const DECOR = { grass: 'grass', sign: 'sign', cloud: 'cloud', flag: 'flag' };

const xml = readFileSync(join(src, 'Layouts', 'Game.xml'), 'utf8');
const re = /<instance type="([^"]*)"[\s\S]*?<world>([\s\S]*?)<\/world>/g;
const num = (s, tag) => {
  const m = s.match(new RegExp('<' + tag + '>([^<]+)</' + tag + '>'));
  return m ? Number(m[1]) : 0;
};

const solids = [];
const decors = [];
const coins = [];
const hazards = [];
let spawn = null;
let goal = null;

let m;
while ((m = re.exec(xml))) {
  const type = m[1];
  const w = m[2];
  const x = num(w, 'x');
  const y = num(w, 'y');
  const width = num(w, 'width');
  const height = num(w, 'height');
  const hotX = num(w, 'hotspotX');
  const hotY = num(w, 'hotspotY');
  // C2 的 (x,y) 是 hotspot 所在处 → 先还原成左上角，再翻成 Cocos 的左下角。
  const left = x - hotX * width;
  const bottom = LEVEL_HEIGHT - (y - hotY * height) - height;

  if (SOLID[type]) solids.push({ x: left, y: bottom, art: SOLID[type] });
  else if (type === 'coin') coins.push({ x: left + width / 2, y: bottom + height / 2 });
  else if (type === 'barnacle') hazards.push({ x: left + width / 2, y: bottom, w: width, h: height });
  else if (type === 'alien') spawn = { x: left + width / 2, y: bottom };
  else if (DECOR[type]) decors.push({ x: left, y: bottom, w: width, h: height, art: DECOR[type] });
}

// 终点不是旗子 —— 原版那面旗插在出生点旁边（x=70，比 alien 的 210 还靠左），是**起点标记**，
// 而且没有绑任何事件。关卡真正的尽头是最右边那堵通天的实心墙，撞上它就算跑完。
// 取墙的左沿再退一个身位，玩家贴上去就判赢。
// 「墙」= 全关最高的那一列（它就是关卡右端那堵通天的）。先找最高的一块砖，再取同高度里最左的 x。
const wallTop = solids.reduce((max, s) => Math.max(max, s.y), 0);
const wallX = solids.reduce((min, s) => (s.y === wallTop ? Math.min(min, s.x) : min), LEVEL_WIDTH);
goal = { x: wallX - TILE / 2, y: 60 };

const list = (rows, fmt) => rows.map((r) => `  ${fmt(r)},`).join('\n');
const n = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(2));

const out = `// 本文件由 scripts/gen-hop-level.mjs 从 Kenney 的 platformer.capx 烘出（CC0，www.kenney.nl）。
// 源 .capx 不在本仓，**没有 --check 闸**：此后当手写文件维护，改关卡直接改这里。
// 坐标：原点在关卡左下、+Y 向上；瓦片存**左下角**，硬币/敌人存**底边中点**。

/** 一块 ${TILE}×${TILE} 的瓦片（实心或纯装饰），存左下角。 */
export interface LevelTile {
  readonly x: number;
  readonly y: number;
  readonly art: string;
}

/** 非瓦片尺寸的装饰（云、旗、草……），额外带自己的宽高。 */
export interface LevelDecor extends LevelTile {
  readonly w: number;
  readonly h: number;
}

/** 一个点（硬币是中心，出生点 / 敌人是底边中点）。 */
export interface LevelPoint {
  readonly x: number;
  readonly y: number;
}

/** 一个会要命的东西，存底边中点 + 尺寸。 */
export interface LevelHazard extends LevelPoint {
  readonly w: number;
  readonly h: number;
}

export const LEVEL_WIDTH = ${LEVEL_WIDTH};
export const LEVEL_HEIGHT = ${LEVEL_HEIGHT};
export const TILE_SIZE = ${TILE};

/** 踩得住、撞得停的瓦片。${solids.length} 块。 */
export const SOLIDS: readonly LevelTile[] = [
${list(solids, (r) => `{ x: ${n(r.x)}, y: ${n(r.y)}, art: '${r.art}' }`)}
];

/** 纯装饰，不进判定。${decors.length} 个。 */
export const DECORS: readonly LevelDecor[] = [
${list(decors, (r) => `{ x: ${n(r.x)}, y: ${n(r.y)}, w: ${n(r.w)}, h: ${n(r.h)}, art: '${r.art}' }`)}
];

/** 硬币（中心点）。${coins.length} 枚。 */
export const COINS: readonly LevelPoint[] = [
${list(coins, (r) => `{ x: ${n(r.x)}, y: ${n(r.y)} }`)}
];

/** 藤壶（碰到就死），底边中点 + 尺寸。${hazards.length} 只。 */
export const HAZARDS: readonly LevelHazard[] = [
${list(hazards, (r) => `{ x: ${n(r.x)}, y: ${n(r.y)}, w: ${n(r.w)}, h: ${n(r.h)} }`)}
];

/** 出生点（脚下）。 */
export const SPAWN: LevelPoint = { x: ${n(spawn.x)}, y: ${n(spawn.y)} };

/** 终点：最右边那堵墙前一个身位（推导见脚本）。跑到这儿就算通关。 */
export const GOAL: LevelPoint = { x: ${n(goal.x)}, y: ${n(goal.y)} };
`;

const dest = join('assets', 'modules', 'mini-hop', 'level.ts');
writeFileSync(dest, out);
console.log(
  `✓ ${dest}：实心 ${solids.length} · 装饰 ${decors.length} · 硬币 ${coins.length} · 藤壶 ${hazards.length}`,
);

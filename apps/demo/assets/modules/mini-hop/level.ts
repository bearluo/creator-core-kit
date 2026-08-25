// 本文件由 scripts/gen-hop-level.mjs 从 Kenney 的 platformer.capx 烘出（CC0，www.kenney.nl）。
// 源 .capx 不在本仓，**没有 --check 闸**：此后当手写文件维护，改关卡直接改这里。
// 坐标：原点在关卡左下、+Y 向上；瓦片存**左下角**，硬币/敌人存**底边中点**。

/** 一块 70×70 的瓦片（实心或纯装饰），存左下角。 */
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

export const LEVEL_WIDTH = 2000;
export const LEVEL_HEIGHT = 480;
export const TILE_SIZE = 70;

/** 踩得住、撞得停的瓦片。87 块。 */
export const SOLIDS: readonly LevelTile[] = [
  { x: 0, y: 60, art: 'ground-top' },
  { x: 70, y: 60, art: 'ground-top' },
  { x: 140, y: 60, art: 'ground-top' },
  { x: 210, y: 60, art: 'ground-top' },
  { x: 280, y: 60, art: 'ground-top' },
  { x: 0, y: -10, art: 'ground' },
  { x: 70, y: -10, art: 'ground' },
  { x: 140, y: -10, art: 'ground' },
  { x: 210, y: -10, art: 'ground' },
  { x: 280, y: -10, art: 'ground' },
  { x: 350, y: 130, art: 'ground-top' },
  { x: 420, y: 130, art: 'ground-top' },
  { x: 490, y: 130, art: 'ground-top' },
  { x: 560, y: 130, art: 'ground-top' },
  { x: 350, y: 60, art: 'ground' },
  { x: 420, y: 60, art: 'ground' },
  { x: 490, y: 60, art: 'ground' },
  { x: 560, y: 60, art: 'ground' },
  { x: 630, y: 60, art: 'ground' },
  { x: 350, y: -10, art: 'ground' },
  { x: 420, y: -10, art: 'ground' },
  { x: 490, y: -10, art: 'ground' },
  { x: 560, y: -10, art: 'ground' },
  { x: 630, y: -10, art: 'ground' },
  { x: 630, y: 200, art: 'ground-top' },
  { x: 630, y: 130, art: 'ground' },
  { x: 700, y: 60, art: 'ground' },
  { x: 700, y: -10, art: 'ground' },
  { x: 700, y: 200, art: 'ground-top' },
  { x: 700, y: 130, art: 'ground' },
  { x: 770, y: 130, art: 'ground-top' },
  { x: 840, y: 130, art: 'ground-top' },
  { x: 770, y: 60, art: 'ground' },
  { x: 840, y: 60, art: 'ground' },
  { x: 770, y: -10, art: 'ground' },
  { x: 840, y: -10, art: 'ground' },
  { x: 910, y: 60, art: 'ground-top' },
  { x: 980, y: 60, art: 'ground-top' },
  { x: 910, y: -10, art: 'ground' },
  { x: 980, y: -10, art: 'ground' },
  { x: 1050, y: 60, art: 'ground-top' },
  { x: 1120, y: 60, art: 'ground-top' },
  { x: 1050, y: -10, art: 'ground' },
  { x: 1120, y: -10, art: 'ground' },
  { x: 1190, y: 60, art: 'ground-top' },
  { x: 1260, y: 60, art: 'ground-top' },
  { x: 1190, y: -10, art: 'ground' },
  { x: 1260, y: -10, art: 'ground' },
  { x: 1330, y: 60, art: 'ground-top' },
  { x: 1400, y: 60, art: 'ground-top' },
  { x: 1330, y: -10, art: 'ground' },
  { x: 1400, y: -10, art: 'ground' },
  { x: 1470, y: 130, art: 'ground-top' },
  { x: 1540, y: 130, art: 'ground-top' },
  { x: 1470, y: 60, art: 'ground' },
  { x: 1540, y: 60, art: 'ground' },
  { x: 1610, y: 130, art: 'ground-top' },
  { x: 1680, y: 130, art: 'ground-top' },
  { x: 1610, y: 60, art: 'ground' },
  { x: 1680, y: 60, art: 'ground' },
  { x: 1890, y: 200, art: 'ground' },
  { x: 1960, y: 200, art: 'ground' },
  { x: 1890, y: 130, art: 'ground' },
  { x: 1960, y: 130, art: 'ground' },
  { x: 1890, y: 60, art: 'ground' },
  { x: 1960, y: 60, art: 'ground' },
  { x: 1890, y: -10, art: 'ground' },
  { x: 1960, y: -10, art: 'ground' },
  { x: 1470, y: -10, art: 'ground' },
  { x: 1540, y: -10, art: 'ground' },
  { x: 1610, y: -10, art: 'ground' },
  { x: 1680, y: -10, art: 'ground' },
  { x: 1890, y: 410, art: 'ground' },
  { x: 1960, y: 410, art: 'ground' },
  { x: 1890, y: 340, art: 'ground' },
  { x: 1960, y: 340, art: 'ground' },
  { x: 1890, y: 270, art: 'ground' },
  { x: 1960, y: 270, art: 'ground' },
  { x: 1890, y: 550, art: 'ground' },
  { x: 1960, y: 550, art: 'ground' },
  { x: 1890, y: 480, art: 'ground' },
  { x: 1960, y: 480, art: 'ground' },
  { x: 1190, y: 270, art: 'qblock' },
  { x: 1260, y: 270, art: 'brick' },
  { x: 1120, y: 270, art: 'brick' },
  { x: 1750, y: -10, art: 'ground-top' },
  { x: 1820, y: -10, art: 'ground-top' },
];

/** 纯装饰，不进判定。12 个。 */
export const DECORS: readonly LevelDecor[] = [
  { x: 76, y: 305.00, w: 128, h: 71, art: 'cloud' },
  { x: 216, y: 95.00, w: 128, h: 71, art: 'cloud' },
  { x: 706, y: 235.00, w: 128, h: 71, art: 'cloud' },
  { x: 916, y: 165.00, w: 128, h: 71, art: 'cloud' },
  { x: 1266, y: 305.00, w: 128, h: 71, art: 'cloud' },
  { x: 1686, y: 165.00, w: 128, h: 71, art: 'cloud' },
  { x: 490, y: 200, w: 70, h: 70, art: 'grass' },
  { x: 980, y: 130, w: 70, h: 70, art: 'grass' },
  { x: 1610, y: 200, w: 70, h: 70, art: 'grass' },
  { x: 630, y: 270, w: 70, h: 70, art: 'sign' },
  { x: 1330, y: 130, w: 70, h: 70, art: 'sign' },
  { x: 70, y: 130, w: 70, h: 70, art: 'flag' },
];

/** 硬币（中心点）。6 枚。 */
export const COINS: readonly LevelPoint[] = [
  { x: 420, y: 270 },
  { x: 560, y: 270 },
  { x: 910, y: 340 },
  { x: 980, y: 270 },
  { x: 1540, y: 270 },
  { x: 1680, y: 270 },
];

/** 藤壶（碰到就死），底边中点 + 尺寸。2 只。 */
export const HAZARDS: readonly LevelHazard[] = [
  { x: 840.50, y: 200, w: 51, h: 57 },
  { x: 1820.50, y: 60, w: 51, h: 57 },
];

/** 出生点（脚下）。 */
export const SPAWN: LevelPoint = { x: 210, y: 130 };

/** 终点：最右边那堵墙前一个身位（推导见脚本）。跑到这儿就算通关。 */
export const GOAL: LevelPoint = { x: 1855, y: 60 };

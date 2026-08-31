/**
 * 大厅入口的网格排布 —— **纯函数、零 `cc`**，所以「12 个模块横屏排几列」在 node 里问得死。
 *
 * 为什么不用 `cc.Layout`：条目位置本来就是代码算的（清单驱动、条目数不定，prefab 里一个都没有），
 * 而 `Layout` 的 GRID 要在编辑器里配 `startAxis` / `constraint` / `constraintNum` 三件套 ——
 * 配错了只有真机上看得出来，还得两个马甲各配一遍。算式挪到这里之后，闸就是一份单测。
 *
 * 坐标系：相对 content 的**左上角**（content 锚点 `(0, 1)`），x 向右为正、y 向下为负。
 * 这是 ScrollView 的惯例——内容从左上角长出去，滚动就是把 content 往回拽。
 */

/** 一个条目的**中心**位置。 */
export interface GridSlot {
  readonly x: number;
  readonly y: number;
}

export interface GridInput {
  readonly count: number;
  /** 条目尺寸。由 `LobbyItem.prefab` 说了算（读实例的 `UITransform`），不写死在代码里。 */
  readonly itemW: number;
  readonly itemH: number;
  readonly gapX: number;
  readonly gapY: number;
  /** 可用区 —— 视口最多能占这么大。 */
  readonly availW: number;
  readonly availH: number;
  /** `true` = 左右滚（横屏）：先填满一列再往右；`false` = 上下滚（竖屏）：先填满一行再往下。 */
  readonly horizontal: boolean;
}

export interface GridResult {
  readonly cols: number;
  readonly rows: number;
  /**
   * 视口尺寸 = 可用区与内容的**较小者** —— 装得下就贴着内容收窄（不留一大片空白），
   * 装不下才被可用区截断、于是滚得起来。
   */
  readonly viewW: number;
  readonly viewH: number;
  /** 内容尺寸。恒 `>=` 视口，ScrollView 靠这个差值决定能滚多远。 */
  readonly contentW: number;
  readonly contentH: number;
  readonly slots: readonly GridSlot[];
}

/** 另一条轴上排得下几个。至少 1 —— 可用区比一个条目还窄时也得排下去（那条轴跟着滚）。 */
function fit(avail: number, gap: number, step: number): number {
  return Math.max(1, Math.floor((avail - gap) / step));
}

export function gridLayout(input: GridInput): GridResult {
  const { count, itemW, itemH, gapX, gapY, availW, availH, horizontal } = input;
  const stepX = itemW + gapX;
  const stepY = itemH + gapY;
  if (count <= 0) {
    return { cols: 0, rows: 0, viewW: 0, viewH: 0, contentW: 0, contentH: 0, slots: [] };
  }
  // 定「不滚的那条轴」上排几个：排得下多少排多少，但**不超过条目总数** ——
  // 否则超高屏上 rows 会算成 20，content 跟着虚高一截、视口白留一片空。
  // 另一条轴（滚动轴）由总数除出来，多出去的部分就是能滚的距离。
  let nCols: number;
  let nRows: number;
  if (horizontal) {
    nRows = Math.min(count, fit(availH, gapY, stepY));
    nCols = Math.ceil(count / nRows);
  } else {
    nCols = Math.min(count, fit(availW, gapX, stepX));
    nRows = Math.ceil(count / nCols);
  }

  const slots: GridSlot[] = [];
  for (let i = 0; i < count; i++) {
    // 滚动轴上的那一维才是「换行」的方向：横滚先填满一列，竖滚先填满一行。
    const c = horizontal ? Math.floor(i / nRows) : i % nCols;
    const r = horizontal ? i % nRows : Math.floor(i / nCols);
    slots.push({ x: gapX + c * stepX + itemW / 2, y: -(gapY + r * stepY + itemH / 2) });
  }

  const contentW = gapX + nCols * stepX;
  const contentH = gapY + nRows * stepY;
  return {
    cols: nCols,
    rows: nRows,
    viewW: Math.min(availW, contentW),
    viewH: Math.min(availH, contentH),
    contentW,
    contentH,
    slots,
  };
}

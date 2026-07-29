/**
 * 流场（vector field）:目标唯一 → 从目标格 BFS 洪泛出整张向量场,全 agent 共享 O(1) 采样,
 * 比逐 agent 各跑 A* 省几个量级。纯结构、不依赖 bitECS。见 docs/modules/spatial.md 决策 #1/#9。
 */
export interface FlowField {
  readonly cols: number;
  readonly rows: number;
  /**
   * 从 targets 格做 BFS 洪泛生成整数距离场,再逐格取「距离更小的邻居」方向 → 单位向量场。
   * blocked(cx,cy)=true 的格视为墙（不参与洪泛、不可通行）。玩家跨格/每 N 帧重建一次即可（宿主调）。
   */
  build(
    targets: ReadonlyArray<readonly [number, number]>,
    blocked?: (cx: number, cy: number) => boolean,
  ): void;
  /** 采样世界坐标 (x,y) 的流向单位向量写入 out=[dx,dy];墙/不可达/目标格/越界 → [0,0]。 */
  dirAt(x: number, y: number, out: [number, number]): void;
}

/** cols×rows 网格,格边 cellSize;世界原点 (originX,originY) 对齐格 (0,0) 角。 */
export function createFlowField(
  cols: number,
  rows: number,
  cellSize: number,
  originX = 0,
  originY = 0,
): FlowField {
  const dist = new Int32Array(cols * rows); // BFS 距离场,-1 = 墙 / 不可达
  const dirX = new Float32Array(cols * rows);
  const dirY = new Float32Array(cols * rows);
  const idx = (cx: number, cy: number): number => cy * cols + cx;
  const inBounds = (cx: number, cy: number): boolean =>
    cx >= 0 && cx < cols && cy >= 0 && cy < rows;
  // 4-邻 BFS 生成距离场（不穿墙角）；8-邻取最小距离邻居生成向量场（更平滑）。
  const N4: ReadonlyArray<readonly [number, number]> = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];

  return {
    cols,
    rows,
    build(targets, blocked) {
      dist.fill(-1);
      dirX.fill(0);
      dirY.fill(0);
      const queue: number[] = [];
      for (const [tx, ty] of targets) {
        if (inBounds(tx, ty) && !blocked?.(tx, ty) && dist[idx(tx, ty)] === -1) {
          dist[idx(tx, ty)] = 0;
          queue.push(idx(tx, ty));
        }
      }
      for (let head = 0; head < queue.length; head++) {
        const cur = queue[head];
        const cx = cur % cols;
        const cy = (cur / cols) | 0;
        const d = dist[cur];
        for (let n = 0; n < N4.length; n++) {
          const nx = cx + N4[n][0];
          const ny = cy + N4[n][1];
          if (!inBounds(nx, ny) || blocked?.(nx, ny)) continue;
          const ni = idx(nx, ny);
          if (dist[ni] === -1) {
            dist[ni] = d + 1;
            queue.push(ni);
          }
        }
      }
      // 向量场:每格指向 8-邻里距离最小者（ponytail: 未防对角穿墙角,首版够用）。
      for (let cy = 0; cy < rows; cy++) {
        for (let cx = 0; cx < cols; cx++) {
          const i = idx(cx, cy);
          if (dist[i] <= 0) continue; // 墙(-1) / 目标(0) → [0,0]
          let best = dist[i];
          let bx = 0;
          let by = 0;
          for (let ox = -1; ox <= 1; ox++) {
            for (let oy = -1; oy <= 1; oy++) {
              if (ox === 0 && oy === 0) continue;
              const nx = cx + ox;
              const ny = cy + oy;
              if (!inBounds(nx, ny)) continue;
              const nd = dist[idx(nx, ny)];
              if (nd !== -1 && nd < best) {
                best = nd;
                bx = ox;
                by = oy;
              }
            }
          }
          if (bx !== 0 || by !== 0) {
            const len = Math.hypot(bx, by);
            dirX[i] = bx / len;
            dirY[i] = by / len;
          }
        }
      }
    },
    dirAt(x, y, out) {
      const cx = Math.floor((x - originX) / cellSize);
      const cy = Math.floor((y - originY) / cellSize);
      if (!inBounds(cx, cy)) {
        out[0] = 0;
        out[1] = 0;
        return;
      }
      const i = idx(cx, cy);
      out[0] = dirX[i];
      out[1] = dirY[i];
    },
  };
}

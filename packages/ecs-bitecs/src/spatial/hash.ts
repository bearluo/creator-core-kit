/**
 * 均匀网格空间哈希:碰撞/分离的 broad-phase 基座。
 * 纯结构、不依赖 bitECS,可脱 ECS 复用、独立单测。见 docs/modules/spatial.md 决策 #2/#6。
 */
export interface SpatialHash {
  /** 清空所有桶（每帧重建前调）。 */
  clear(): void;
  /** 实体 id 按世界坐标 (x,y) 落桶。 */
  insert(id: number, x: number, y: number): void;
  /**
   * 回调 (x,y) 半径 r 覆盖到的桶内所有 id（自身格 + 邻格,扫 ceil(r/cellSize) 圈）。
   * 粗筛:回调可能含圈外 id 或自身 id,narrow-phase 再精判 / 调用方自行跳过。
   */
  queryNeighbors(x: number, y: number, r: number, cb: (id: number) => void): void;
}

/** cellSize 建议 ≈ 2× 实体半径（均匀分布下每格常数个实体 → O(n)）。 */
export function createSpatialHash(cellSize: number): SpatialHash {
  // ponytail: Map<number,number[]> 每帧重建 + 整数哈希(不同格可能碰撞→多筛,narrow-phase 精判滤掉,不漏真邻)。
  //           真上千再换连续 TypedArray 桶 + 无碰撞编码。
  const buckets = new Map<number, number[]>();
  const cellKey = (cx: number, cy: number): number => ((cx * 73856093) ^ (cy * 19349663)) | 0;
  return {
    clear() {
      buckets.clear();
    },
    insert(id, x, y) {
      const k = cellKey(Math.floor(x / cellSize), Math.floor(y / cellSize));
      let b = buckets.get(k);
      if (b === undefined) buckets.set(k, (b = []));
      b.push(id);
    },
    queryNeighbors(x, y, r, cb) {
      const cx = Math.floor(x / cellSize);
      const cy = Math.floor(y / cellSize);
      const rings = Math.max(1, Math.ceil(r / cellSize));
      for (let dx = -rings; dx <= rings; dx++) {
        for (let dy = -rings; dy <= rings; dy++) {
          const b = buckets.get(cellKey(cx + dx, cy + dy));
          if (b !== undefined) for (let i = 0; i < b.length; i++) cb(b[i]);
        }
      }
    },
  };
}

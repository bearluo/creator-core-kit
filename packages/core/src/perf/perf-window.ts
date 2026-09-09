/**
 * PerfWindow —— 性能采集器。零依赖、零 `cc`、node 里逐帧可复现。
 *
 * 设计立场见 `docs/design/device-tiering-overview.md` §4，三条决定了它长这样：
 *
 * 1. **只有一个类，三个接口一个都不做。** 采样源不是接口（谁拿到数谁 push —— 帧时间天然是
 *    push，只有引擎跑到那一帧才知道 dt）；上报通道也不是接口（端点与字段名是项目协议，
 *    `drain()` 的返回值就是接缝）。⇒ **数据只有一个方向：全部 push 进来，一份
 *    `PerfReport[]` 出去。** 这也是它能在 node 里逐帧复现的原因。
 * 2. **内存读数看着像 pull，也不 pull。** 让采集器主动读内存，它就得认识「内存」是什么、
 *    多久读一次、读不到怎么办 —— 那是 `device-profile` 的活。改成引擎按自己的慢频率
 *    `peak()` 进来，采集器一个平台细节都不认识。
 * 3. **`frame()` 零分配**：一次数组下标自增 + 几次标量比较。它每帧在低端机上跑。
 *
 * ⚠️ **两个「挂错时钟」的坑，都是静默的**（engine 侧的 `drivePerfWindow` 就是为了堵它们）：
 * - `frame()` 要喂**真实 dt**，不能挂 `ITimer.onFrame` —— 那里拿到的是 `dt * timeScale`，
 *   且 `paused` 时**根本不触发**：游戏一暂停性能数据就断，而暂停可能正是卡出来的。
 *   真实 dt 在 `packages/engine/src/bootstrap.ts:26`（`driver.tick(game.deltaTime)`）。
 * - `drain()` 的节拍同理不能用 `ITimer.interval`（暂停时永不触发，攒着的报告发不出去），
 *   要用平台真实时钟。**但节拍归项目** —— 「攒够 30 秒」是策略，kit 不内置定时器。
 *
 * ⭐ **别把 P95 当卡顿指标。** 30 秒窗口里三次卡顿只占 0.17% 的帧，分位数完全看不见它
 * （见 `__tests__` 里那条反例）。**分位数量的是稳态帧率**（这台机器能不能稳住 60/30），
 * **卡顿靠计数 + 累计毫秒**。两个都要报，但主角不是 P95。
 */

/** 1ms/桶：0..254 精确，>=255 进溢出桶。定长 1KB，跟窗口多长无关。 */
const BUCKETS = 256;

const DEFAULT_STALL_THRESHOLDS_MS = [100, 200];
const DEFAULT_MAX_PENDING = 8;

/** 一档卡顿阈值的统计。超出部分可精确反推：`totalMs - frames * thresholdMs`。 */
export interface StallBucket {
  /** 门槛（ms）。**严格大于**才算卡顿。 */
  readonly thresholdMs: number;
  /** 超过该阈值的帧数。 */
  readonly frames: number;
  /** 这些帧的**总耗时**（不是超出部分）——「这段里有 530ms 花在卡顿帧上」，直接可读。 */
  readonly totalMs: number;
}

/** 一次性耗时事件的聚合（加载一个包、开一个界面）。 */
export interface SpanStat {
  readonly n: number;
  readonly totalMs: number;
  readonly maxMs: number;
}

/** 一段（一个 tag）的聚合结果。纯数据，可直接 JSON 化发走。 */
export interface PerfReport {
  /** 段标签，由 `mark()` 打。`''` = 还没打过标签。 */
  readonly tag: string;
  /** 本段覆盖的渲染时长（= 各帧 dt 之和，切后台不计）。 */
  readonly durationMs: number;
  readonly frames: number;
  /** 分位数，1ms 精度。落在溢出桶时返回实测 max，**不谎报成 255**。 */
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly maxFrameMs: number;
  /** 各档卡顿。**分位数量的是稳态帧率，卡顿只在这里。** */
  readonly stalls: readonly StallBucket[];
  readonly spans: Readonly<Record<string, SpanStat>>;
  /** 取最大值的量：内存峰值。 */
  readonly peaks: Readonly<Record<string, number>>;
  /** 取累加的量：GC 次数、丢帧次数。 */
  readonly counts: Readonly<Record<string, number>>;
}

export interface PerfWindowOptions {
  /**
   * 卡顿阈值（ms），可多档。**门槛是策略、归项目**，kit 只给个能跑的默认 `[100, 200]`。
   * 空数组 = 完全不统计卡顿。传入顺序不限，内部按升序存。
   */
  readonly stallThresholdsMs?: readonly number[];
  /**
   * 未被取走的报告上限，默认 8。满了丢**最老的**并计数 ——
   * 上报方挂了不能把内存吃穿，而丢了几份要让数据自己说（`drain()` 的 `dropped`）。
   */
  readonly maxPending?: number;
}

export class PerfWindow {
  private readonly _thresholds: readonly number[];
  private readonly _stallFrames: Uint32Array;
  private readonly _stallMs: Float64Array;
  private readonly _maxPending: number;

  // —— 当前段。全是标量 / 复用的定长数组，所以 frame() 不分配 ——
  private readonly _hist = new Uint32Array(BUCKETS);
  private _tag = '';
  private _frames = 0;
  private _durationMs = 0;
  private _maxFrameMs = 0;
  private _spans: Record<string, { n: number; totalMs: number; maxMs: number }> = {};
  private _peaks: Record<string, number> = {};
  private _counts: Record<string, number> = {};
  /**
   * 本段收到过任何数据没有。**不能用 `_frames > 0` 代替**：一段可能一帧都没渲染却有
   * `span`（加载），那份数据既不该丢、也不该在下一次 `mark()` 时漂到下一个 tag 名下。
   */
  private _dirty = false;

  private _pending: PerfReport[] = [];
  private _dropped = 0;

  constructor(opts: PerfWindowOptions = {}) {
    // Array.from 而不是 `[...x]`：后者被 Cocos 的 babel loose spread 降级成 `[].concat(x)`，
    // 且只在构建产物里炸、预览测不出来（见 eslint no-restricted-syntax）。这里也顺手做了拷贝，
    // 免得 sort() 就地改掉调用方传进来的数组。
    this._thresholds = Array.from(opts.stallThresholdsMs ?? DEFAULT_STALL_THRESHOLDS_MS).sort(
      (a, b) => a - b,
    );
    this._stallFrames = new Uint32Array(this._thresholds.length);
    this._stallMs = new Float64Array(this._thresholds.length);
    this._maxPending = opts.maxPending ?? DEFAULT_MAX_PENDING;
  }

  /** 引擎每帧推**真实 dt**（不是 `ITimer` 那个被 `timeScale` 缩过的，见文件头）。 */
  frame(dtMs: number): void {
    if (!(dtMs > 0)) return; // NaN / 负 / 0：丢掉，别污染直方图
    this._dirty = true;
    this._frames++;
    this._durationMs += dtMs;
    if (dtMs > this._maxFrameMs) this._maxFrameMs = dtMs;
    // 阈值升序存，遇到第一个不超的就停 —— 仍然零分配
    for (let i = 0; i < this._thresholds.length; i++) {
      if (dtMs <= this._thresholds[i]) break;
      this._stallFrames[i]++;
      this._stallMs[i] += dtMs;
    }
    this._hist[dtMs >= BUCKETS - 1 ? BUCKETS - 1 : Math.round(dtMs)]++;
  }

  /** 一次性耗时事件（加载一个包、开一个界面）。 */
  span(name: string, ms: number): void {
    this._dirty = true;
    const s = (this._spans[name] ??= { n: 0, totalMs: 0, maxMs: 0 });
    s.n++;
    s.totalMs += ms;
    if (ms > s.maxMs) s.maxMs = ms;
  }

  /** 取最大值的量：内存峰值。**引擎按自己的慢频率喂进来**，采集器不主动读。 */
  peak(name: string, value: number): void {
    this._dirty = true;
    const cur = this._peaks[name];
    if (cur === undefined || value > cur) this._peaks[name] = value;
  }

  /** 取累加的量：GC 次数、丢帧次数。 */
  count(name: string, n = 1): void {
    this._dirty = true;
    this._counts[name] = (this._counts[name] ?? 0) + n;
  }

  /**
   * 换段：封上当前这份、开一份新的。**业务显式调，采集器不认识 `SceneFlow`** ——
   * 挂上去会漏掉最该量的那段（`panel` 类界面一次场景转换都不产生）。
   *
   * **同名 tag 是 no-op**：否则自转 / pop 回同一态会连着触发，攒出一串一两帧的碎报告，
   * 上报量炸掉而信息为零。要故意切段有 `drain()`。
   */
  mark(tag: string): void {
    if (tag === this._tag) return;
    this._seal();
    this._tag = tag;
  }

  /** 上报方来取：封上当前段，交出全部攒着的报告并清零。 */
  drain(): { reports: PerfReport[]; dropped: number } {
    this._seal();
    const reports = this._pending;
    const dropped = this._dropped;
    this._pending = [];
    this._dropped = 0;
    return { reports, dropped };
  }

  // —— 内部 ——

  private _seal(): void {
    if (!this._dirty) return; // 一点数据都没有的段不产报告
    this._pending.push({
      tag: this._tag,
      durationMs: this._durationMs,
      frames: this._frames,
      p50Ms: this._quantile(0.5),
      p95Ms: this._quantile(0.95),
      p99Ms: this._quantile(0.99),
      maxFrameMs: this._maxFrameMs,
      stalls: this._thresholds.map((thresholdMs, i) => ({
        thresholdMs,
        frames: this._stallFrames[i],
        totalMs: this._stallMs[i],
      })),
      // 三个容器整个交出去，随即换新的 —— 报告与内部状态从此不共享引用
      spans: this._spans,
      peaks: this._peaks,
      counts: this._counts,
    });
    while (this._pending.length > this._maxPending) {
      this._pending.shift();
      this._dropped++;
    }
    this._hist.fill(0);
    this._stallFrames.fill(0);
    this._stallMs.fill(0);
    this._frames = 0;
    this._durationMs = 0;
    this._maxFrameMs = 0;
    this._spans = {};
    this._peaks = {};
    this._counts = {};
    this._dirty = false;
  }

  /** 只扫精确桶（0..254）。**掉出循环 = 分位数落在溢出桶**，此时报实测 max，别谎报成 255。 */
  private _quantile(q: number): number {
    const need = Math.ceil(q * this._frames);
    let acc = 0;
    for (let i = 0; i < BUCKETS - 1; i++) {
      acc += this._hist[i];
      if (acc >= need) return i;
    }
    return this._maxFrameMs;
  }
}

---
模块: audio-service
所在包: packages/core（AudioService 纯逻辑 + IAudioPlayer 接缝 + IAudioService 接口 + 空播放器 fake，零 cc）；cc.AudioSource 播放适配走 engine（后续）
状态: 已实现          # 草案 → 评审中 → 已定稿 → 已实现
摘要: 音频服务 createAudioService——BGM 单轨播放 + 音效（fire-and-forget 的 playOneShot + 可停句柄的 playEffect）+ 三档音量（master/music/sfx）与静音，实时折算最终音量下发到在播源。core 定义 IAudioService（消费接口）+ IAudioPlayer（原子播放接缝，engine 用 cc.AudioSource 实现）+ 空播放器 fake；cc 类型不进 core。
何时读: 需要播/停 BGM、放音效、调分类音量或静音、切后台暂停音频，或为某平台接音频后端时。
日期: 2026-07-27
依赖: di（AUDIO_PLAYER/AUDIO_SERVICE token + tryResolve）。IAudioPlayer 的 cc 适配走 engine（ADR-0002，后续；内部用 [[asset-manager]] 加载 AudioClip）。横评见 docs/research/2026-07-27-ui-and-audio-survey.md。对标 oops-framework AudioManager（AudioMusic + AudioEffect）。
---

# AudioService（IAudioService）设计文档

## TL;DR

`createAudioService({ player? })` 返回 `IAudioService`：`playMusic(name, {loop?,volume?})` 播 BGM（**单轨**：先停当前再播）；音效两路——`playOneShot(name, scale?)` fire-and-forget 便捷、`playEffect(name, {loop?,volume?})` 返回 `AudioHandle` 可 `stopEffect` 停（循环/可打断音效）；音量三档 `AudioCategory = 'master'|'music'|'sfx'` + 静音，`setVolume/setMute` **实时重算最终音量下发到在播源**（有效音量 = master×通道，任一静音则 0）；`pauseAll/resumeAll` 供切后台。**core 零 cc**：定义消费接口 `IAudioService` + 引擎原子播放接缝 `IAudioPlayer`（`play/stop/setVolume/pause/resume/playOneShot`，`play` 返 engine handle）+ 空播放器 fake。engine 后续注册 cc 适配到 `AUDIO_PLAYER`，`createAudioService()` 自动拾取。

## Purpose（目标与定位）

- **做什么**：把散落的 `AudioSource.play/playOneShot/volume` 收敛为一个带**分类音量 + 静音 + BGM 单轨 + 可停音效句柄**的入口。
- **定位/取舍**：**account-in-core / IO-in-engine**——core 持音量/静音状态、BGM 当前句柄、活跃音效句柄表，算有效音量并实时下发（**可 node 单测**）；engine `IAudioPlayer` 只做「真播一条 / 真停 / 真调音量」原子 IO（cc.AudioSource：BGM 单条 + 音效池），并负责 AudioClip 加载、Web autoplay 解锁、切后台。
- **为何双音效路径 + 三档音量**（用户定 2026-07-27）：`playOneShot` 覆盖 90% 一次性音效（省句柄）；`playEffect` 返句柄支持循环/可打断音效（脚步、语音）。三档 master/music/sfx 够绝大多数游戏，voice 档 YAGNI（需要再加）。
- **YAGNI（首版砍）**：淡入淡出/crossfade（需 ITimer 逐帧插值，engine 事，需要再加）；音量持久化（core 不自持 IStorage——上层 boot 时从 [[save-manager]] 读回并 `setVolume` 即可，见 Open Questions）；voice 档；3D 空间音频；音效优先级/限流。

## Public API（TypeScript 精确签名）

```ts
// —— 播放接缝（core 定义，engine 实现）：只做原子播放/停止/调量。volume 为 core 已算好的最终音量 ——
export type AudioChannel = 'music' | 'sfx';
export interface AudioPlaySpec { name: string; channel: AudioChannel; loop: boolean; volume: number; }
export interface IAudioPlayer {
  play(spec: AudioPlaySpec): number;                    // 返 engine handle(>0)
  stop(handle: number): void;
  setVolume(handle: number, volume: number): void;      // 改在播源最终音量
  pause(handle: number): void;
  resume(handle: number): void;
  playOneShot(name: string, volume: number): void;      // fire-and-forget，无句柄
}
export const AUDIO_PLAYER: Token<IAudioPlayer>;         // engine 注册 cc.AudioSource 适配
export function createMemoryAudioPlayer(): IAudioPlayer; // 空实现（无声、只发号），默认 + 测试

// —— 消费接口（core 实现）——
export type AudioCategory = 'master' | 'music' | 'sfx';
export type AudioHandle = number;                        // 0 = 无效
export interface IAudioService {
  playMusic(name: string, opts?: { loop?: boolean; volume?: number }): void;  // BGM 单轨
  stopMusic(): void; pauseMusic(): void; resumeMusic(): void;
  playOneShot(name: string, volumeScale?: number): void;                      // 便捷、不可停
  playEffect(name: string, opts?: { loop?: boolean; volume?: number }): AudioHandle;  // 可停
  stopEffect(handle: AudioHandle): void; stopAllEffects(): void;
  setVolume(category: AudioCategory, v: number): void;   // 0..1 自动 clamp，实时作用在播源
  getVolume(category: AudioCategory): number;
  setMute(category: AudioCategory, muted: boolean): void; isMuted(category: AudioCategory): boolean;
  pauseAll(): void; resumeAll(): void;                   // 切后台
}
export const AUDIO_SERVICE: Token<IAudioService>;
export function getAudioService(): IAudioService;         // tryResolve(AUDIO_SERVICE) ?? 进程默认
export function createAudioService(opts?: { player?: IAudioPlayer }): IAudioService;
```

## Behavior & data flow（行为与数据流）

- **音量模型**：`volume: {master,music,sfx}` 各 [0,1]（默认 1）+ `mute: {master,music,sfx}`（默认 false）。**通道有效音量** `effective(ch) = mute.master || mute[ch] ? 0 : volume.master × volume[ch]`；**某源最终音量** `final(ch, base) = clamp01(base) × effective(ch)`（base = 本次播放的基准音量）。
- **活跃源账本（core）**：`Map<AudioHandle, {player, channel, base}>`；`musicHandle` 单独记当前 BGM 的 AudioHandle（0=无）。`nextHandle` 自增发号。
- **playMusic**：先 `stopMusic()`（单轨不变式）→ `player.play({name, channel:'music', loop: loop??true, volume: final('music', volume??1)})` → 记账、置 musicHandle。
- **stopMusic/pause/resumeMusic**：查 musicHandle 对应源 → `player.stop/pause/resume`；无 BGM（musicHandle=0，`active.get(0)=undefined`）为 no-op。
- **playOneShot**：`player.playOneShot(name, final('sfx', scale??1))`，**不记账**（一次性、不可后续调量/停——可接受的取舍）。
- **playEffect**：`player.play({channel:'sfx', loop: loop??false, volume: final('sfx', volume??1)})` → 记账、返 AudioHandle。
- **stopEffect(h)**：查账；不存在或**通道非 sfx**（守卫：不误停 BGM）→ no-op；否则 `player.stop` + 删账。`stopAllEffects` 遍历账本停所有 sfx。
- **setVolume(cat, v)**：`volume[cat]=clamp01(v)` → `reapply(cat)`：遍历在播源，对**受影响**者（cat='master' 影响全部；否则同通道）重算 `final` 下发 `player.setVolume`。`setMute` 同理（有效音量 0/恢复）。
- **pauseAll/resumeAll**：遍历账本 `player.pause/resume` 每个源（oneShot 无句柄、不受控——切后台由 engine 侧 game hide 兜底）。
- **默认 player 解析**：`opts.player ?? tryResolve(AUDIO_PLAYER) ?? createMemoryAudioPlayer()`。
- **与 cc 边界**：IAudioService/IAudioPlayer/账本/空 fake 全在 core（零 cc）。engine 实现 `IAudioPlayer`：BGM 用单个持久 `AudioSource`（loop）、音效用 `AudioSource` 池（`playOneShot` 或 `play`），内部经 [[asset-manager]] 加载 `AudioClip`，处理 Web autoplay（首次 touch resume）、`game.on(EVENT_HIDE/SHOW)`。属**有状态引擎行为**，ADR-0002 不进 cc mock，走 apps/demo 集成验证。

## Key design decisions（决策表）

| # | 维度 | 选项 | 选定 | 理由 |
|---|---|---|---|---|
| 1 | 音量归属 | 全靠 AudioSource.volume / **core 建账本折算 + engine 原子播放** | **account-in-core** | 音量数学/单轨/静音传播脱 cc 可 node 单测 |
| 2 | 音效句柄 | 只 oneShot / 只句柄 / **两者都给** | **oneShot + playEffect 返句柄**（用户定 2026-07-27） | oneShot 覆盖多数、playEffect 支持循环/可打断 |
| 3 | 音量分类 | 三档 master/music/sfx / 四档加 voice | **三档**（用户定 2026-07-27） | 够绝大多数游戏；voice YAGNI |
| 4 | BGM 轨数 | 多轨 / **单轨（播新停旧）** | **单轨** | BGM 天然单条（对齐 oops AudioMusic）|
| 5 | 最终音量算在哪 | engine 叠加 / **core 算好传最终值** | **core 算最终值** | engine 播放器无状态、只认最终音量；分类变动 core 统一重算下发 |
| 6 | 音量持久化 | core 自持 IStorage / **交上层用 SaveManager** | **交上层** | 避免异步 load-on-construct 摩擦；上层 boot 时 setVolume 回填即可（YAGNI）|
| 7 | 切后台 | core 监听 game / **pauseAll/resumeAll + engine 兜底** | **给 API，engine 兜底** | game 事件是 cc；core 只暴露批量暂停/恢复 |
| 8 | DI 便捷 | 仅工厂 / **AUDIO_PLAYER + AUDIO_SERVICE token + getAudioService** | **都给** | 对齐姊妹模块 token+fallback 范式 |

## Platform considerations（全平台 / 小游戏兼容）

- core（AudioService/账本/空 fake）纯 TS，全平台无差异。
- engine `IAudioPlayer` 适配：Web/小游戏受 **autoplay 策略**——BGM 需用户手势后起播，engine 侧首次 touch 时 resume（对 core 透明，core 只管「已请求播放」）。
- 切后台：`game.on(Game.EVENT_HIDE/SHOW)` → engine 调 `pauseAll/resumeAll`（或播放器内部处理）。
- 跨 bundle 共享 AudioService 走全局 `AUDIO_SERVICE` token（[[adr-0001]]）。

## Testable seams + test plan（可测接缝 + vitest 用例）

- **可测性**：全纯 TS 零 cc；spy `IAudioPlayer` 记录 play/stop/setVolume/pause/resume/playOneShot 调用 + 返自增 handle，断言最终音量数值与调用序列。
- **用例清单**（已实现，24 用例）：BGM 走 music 通道/默认 loop/尊重 opts、再播先停（单轨）、stop/pause/resumeMusic 无 BGM no-op；playOneShot 折算 scale×分类、playEffect 返句柄/尊重 opts、stopEffect 停指定/未知 no-op/不误停 BGM、stopAllEffects 不动 BGM；音量默认 1/clamp 上下界、setVolume(master) 重算全部 / (music)(sfx) 只重算对应通道、基准×分类相乘、setMute 归 0 与恢复、master 静音令全通道 0；pauseAll/resumeAll 全源；DI 回退空播放器 / getAudioService 单例 / register 覆盖 / tryResolve(AUDIO_PLAYER)。

## Open Questions（已决议 · 2026-07-27）

1. **音效句柄双给 / 三档音量**：✅（用户定）。
2. 音量持久化：首版不进 core；上层 boot 读 [[save-manager]] 后 `setVolume` 回填。需要「改音量即存」时，可在 engine 适配层或上层包一层 setVolume→SaveManager，不污染 core。
3. 淡入淡出：留后续；engine 播放器可自带 fade 参数（core 传 base，engine 内 tween），或 core 引 ITimer 逐帧——需要时再定。
4. 与 [[ui-manager]] 无耦合；与 [[asset-manager]] 的耦合在 engine 侧（加载 AudioClip），core 层零依赖。

---

## 实现记录

- **落地文件**：`packages/core/src/audio/audio-player.ts`（`AudioChannel` + `AudioPlaySpec` + `IAudioPlayer` + `AUDIO_PLAYER` + `createMemoryAudioPlayer`）、`audio-service.ts`（`createAudioService` + `IAudioService`/`AudioCategory`/`AudioHandle`/`PlayMusicOptions`/`PlayEffectOptions` + `AUDIO_SERVICE` + `getAudioService`）、`index.ts`；core `index.ts` re-export（`export * from './audio'`）。
- **最终 API 与设计偏差**：
  1. 无偏差；API 与定稿一致。
  2. 内部去掉了共享 `stop(handle)` 助手，改为在 stopMusic/stopEffect/stopAllEffects 各处内联 `player.stop + active.delete`——因共享助手的 `if (!a) return` 守卫对所有调用方恒真（dead branch）；内联后各处守卫可达（尤其 `active.get(musicHandle)` 在 musicHandle=0 时走 undefined 分支，正是「无 BGM no-op」路径），换来 100% 分支覆盖。
  3. core 首版不注入 logger（当前无失败告警路径，空播放器不抛）；出现失败路径再加，对齐 [[save-manager]] 的 logger 用法。
- **测试结果 / 覆盖率**：`audio-service.test.ts` **24 用例全绿**；`audio-player.ts`、`audio-service.ts`、`index.ts` 均 **100% Stmts/Branch/Funcs/Lines**（全量 271 passed，含 [[ui-manager]]）。
- **commit / PR**：待提交（与 [[ui-manager]] 同批）。
- **遗留 Minors**：engine 侧 `IAudioPlayer` 的 cc 适配（BGM 单 AudioSource + 音效池 + AudioClip 加载 + autoplay 解锁 + 切后台）+ 注册 `AUDIO_PLAYER`（随 apps/demo 集成）；淡入淡出、音量持久化、voice 档留后续（YAGNI）。

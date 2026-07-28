import { createToken, type Token } from '../di';

/** 播放通道：BGM（单轨）/ 音效（可并发）。用于让 engine 播放器区分挂哪种 AudioSource。 */
export type AudioChannel = 'music' | 'sfx';

/** 一次播放的规格。volume 是 core 已算好的**最终音量**（master×分类×静音），engine 直接用不再叠加。 */
export interface AudioPlaySpec {
  /** 资源名/路径，engine 侧经 IAssetLoader 加载 AudioClip。 */
  name: string;
  channel: AudioChannel;
  loop: boolean;
  /** 最终音量 0..1（core 已折算）。 */
  volume: number;
}

/**
 * 播放接缝：core 只认本接口（守零 cc 铁律）。engine 用 cc.AudioSource（BGM 单条 + 音效池）实现，
 * 负责实际出声、AudioClip 加载、Web autoplay 解锁、切后台 pause/resume。
 * handle 是 engine 分配的不透明正整数；core 用它 stop/setVolume/pause/resume 指定的在播源。
 */
export interface IAudioPlayer {
  /** 起播一条可控源，返回 handle(>0)。 */
  play(spec: AudioPlaySpec): number;
  /** 停止并回收 handle。未知 handle 为 no-op。 */
  stop(handle: number): void;
  /** 改在播源的最终音量。 */
  setVolume(handle: number, volume: number): void;
  pause(handle: number): void;
  resume(handle: number): void;
  /** fire-and-forget 一次性音效（无句柄、不可停）。volume 为最终音量。 */
  playOneShot(name: string, volume: number): void;
}

/** DI token：engine Bootstrap register cc.AudioSource 适配；未注册时 AudioService 回退空实现（无声）。 */
export const AUDIO_PLAYER: Token<IAudioPlayer> = createToken<IAudioPlayer>('cck.audioPlayer');

/**
 * 空播放器（null object）：不出声，只发号。默认实现（无 engine 时）+ 单测背书。
 * 让 AudioService 的音量/单轨/句柄逻辑在 node 环境可脱引擎跑。
 */
export function createMemoryAudioPlayer(): IAudioPlayer {
  let next = 1;
  return {
    play: () => next++,
    stop: () => {},
    setVolume: () => {},
    pause: () => {},
    resume: () => {},
    playOneShot: () => {},
  };
}

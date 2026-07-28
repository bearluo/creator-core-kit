import { createToken, getRootContainer, type Token } from '../di';
import {
  AUDIO_PLAYER,
  createMemoryAudioPlayer,
  type AudioChannel,
  type IAudioPlayer,
} from './audio-player';

/** 音量/静音分类：master 为总闸，music/sfx 为通道。有效音量 = master × 通道（任一静音则 0）。 */
export type AudioCategory = 'master' | 'music' | 'sfx';

/** 可停止音效句柄（不透明正整数；0 表示无效/未跟踪）。 */
export type AudioHandle = number;

export interface PlayMusicOptions {
  /** 默认 true（BGM 循环）。 */
  loop?: boolean;
  /** 本曲基准音量 0..1，默认 1（再乘 music 有效音量得最终值）。 */
  volume?: number;
}

export interface PlayEffectOptions {
  /** 默认 false。循环音效（如脚步声）设 true，用返回句柄停。 */
  loop?: boolean;
  /** 本音效基准音量 0..1，默认 1。 */
  volume?: number;
}

export interface IAudioService {
  /** 播 BGM（单轨：先停当前再播）。 */
  playMusic(name: string, opts?: PlayMusicOptions): void;
  stopMusic(): void;
  pauseMusic(): void;
  resumeMusic(): void;
  /** fire-and-forget 音效：便捷、不可停。volumeScale 默认 1。 */
  playOneShot(name: string, volumeScale?: number): void;
  /** 可停止音效：返回句柄，用 stopEffect 停。 */
  playEffect(name: string, opts?: PlayEffectOptions): AudioHandle;
  /** 停指定音效句柄（非音效句柄/未知句柄为 no-op）。 */
  stopEffect(handle: AudioHandle): void;
  stopAllEffects(): void;
  /** 设分类音量 0..1（越界自动 clamp），实时作用到该分类在播源。 */
  setVolume(category: AudioCategory, v: number): void;
  getVolume(category: AudioCategory): number;
  /** 设分类静音，实时作用到在播源。 */
  setMute(category: AudioCategory, muted: boolean): void;
  isMuted(category: AudioCategory): boolean;
  /** 暂停/恢复全部在播源（切后台用；oneShot 不受控）。 */
  pauseAll(): void;
  resumeAll(): void;
}

export interface AudioServiceOptions {
  /** 播放后端。默认：DI AUDIO_PLAYER，未注册则空实现（无声）。 */
  player?: IAudioPlayer;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

interface ActiveSource {
  /** engine 播放器句柄。 */
  readonly player: number;
  readonly channel: AudioChannel;
  /** 本次播放的基准音量（用于分类音量变动时重算最终值）。 */
  readonly base: number;
}

/** 造 AudioService（纯逻辑、零 cc；播放经 IAudioPlayer 接缝注入）。 */
export function createAudioService(opts?: AudioServiceOptions): IAudioService {
  const player = opts?.player ?? getRootContainer().tryResolve(AUDIO_PLAYER) ?? createMemoryAudioPlayer();

  const volume: Record<AudioCategory, number> = { master: 1, music: 1, sfx: 1 };
  const mute: Record<AudioCategory, boolean> = { master: false, music: false, sfx: false };

  /** 通道有效音量 = master×通道（任一静音则 0）。 */
  const effective = (channel: AudioChannel): number =>
    mute.master || mute[channel] ? 0 : volume.master * volume[channel];
  const finalOf = (channel: AudioChannel, base: number): number => clamp01(base) * effective(channel);

  const active = new Map<AudioHandle, ActiveSource>();
  let nextHandle: AudioHandle = 1;
  let musicHandle: AudioHandle = 0;

  const start = (name: string, channel: AudioChannel, base: number, loop: boolean): AudioHandle => {
    const ph = player.play({ name, channel, loop, volume: finalOf(channel, base) });
    const h = nextHandle++;
    active.set(h, { player: ph, channel, base });
    return h;
  };
  const stopMusic = (): void => {
    const a = active.get(musicHandle); // musicHandle=0 时 undefined → 无 BGM 的 no-op
    if (a) {
      player.stop(a.player);
      active.delete(musicHandle);
    }
    musicHandle = 0;
  };
  /** 分类音量/静音变动后，把最终音量重新下发到受影响的在播源。 */
  const reapply = (category: AudioCategory): void => {
    for (const a of active.values()) {
      if (category === 'master' || a.channel === category) {
        player.setVolume(a.player, finalOf(a.channel, a.base));
      }
    }
  };

  return {
    playMusic(name: string, o?: PlayMusicOptions): void {
      stopMusic();
      musicHandle = start(name, 'music', o?.volume ?? 1, o?.loop ?? true);
    },
    stopMusic,
    pauseMusic(): void {
      const a = active.get(musicHandle);
      if (a) player.pause(a.player);
    },
    resumeMusic(): void {
      const a = active.get(musicHandle);
      if (a) player.resume(a.player);
    },

    playOneShot(name: string, volumeScale = 1): void {
      player.playOneShot(name, finalOf('sfx', volumeScale));
    },
    playEffect(name: string, o?: PlayEffectOptions): AudioHandle {
      return start(name, 'sfx', o?.volume ?? 1, o?.loop ?? false);
    },
    stopEffect(handle: AudioHandle): void {
      const a = active.get(handle);
      if (!a || a.channel !== 'sfx') return;
      player.stop(a.player);
      active.delete(handle);
    },
    stopAllEffects(): void {
      for (const [h, a] of [...active]) {
        if (a.channel === 'sfx') {
          player.stop(a.player);
          active.delete(h);
        }
      }
    },

    setVolume(category: AudioCategory, v: number): void {
      volume[category] = clamp01(v);
      reapply(category);
    },
    getVolume(category: AudioCategory): number {
      return volume[category];
    },
    setMute(category: AudioCategory, muted: boolean): void {
      mute[category] = muted;
      reapply(category);
    },
    isMuted(category: AudioCategory): boolean {
      return mute[category];
    },

    pauseAll(): void {
      for (const a of active.values()) player.pause(a.player);
    },
    resumeAll(): void {
      for (const a of active.values()) player.resume(a.player);
    },
  };
}

/** DI token：项目可 register 自己的 AudioService 覆盖默认。 */
export const AUDIO_SERVICE: Token<IAudioService> = createToken<IAudioService>('cck.audioService');

let _default: IAudioService | undefined;

/** 便捷取用：优先 tryResolve(AUDIO_SERVICE)；未注册则进程级默认（空播放器背书，无声但逻辑可跑）。 */
export function getAudioService(): IAudioService {
  return getRootContainer().tryResolve(AUDIO_SERVICE) ?? (_default ??= createAudioService());
}

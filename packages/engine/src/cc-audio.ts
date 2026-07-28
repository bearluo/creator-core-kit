import { AudioSource, Node, director } from 'cc';
import type { AudioClip } from 'cc';
import { AUDIO_PLAYER, getAssetLoader } from '@cck/core';
import type { IAudioPlayer, AudioPlaySpec, KitModule } from '@cck/core';

/**
 * IAudioPlayer 的 cc 实现 —— AudioService 的「引擎半」：cc.AudioSource 出声 + 经 IAssetLoader 加载 AudioClip。
 * 音量/单轨/静音/句柄逻辑全在 core（audio-service.ts），这里只负责真播放：
 *  - 每个可停句柄占一条 voice（宿主节点下的子节点 + AudioSource），停后 busy=false 复用；
 *  - playOneShot 走共享 AudioSource.playOneShot，一次性、不可停；
 *  - 宿主节点 addPersistRootNode 跨场景常驻。
 * 注：play(spec) 须同步返回 handle，而 AudioClip 加载是异步——先发号，加载落地后若未被 stop 再真播。
 */
interface Voice {
  readonly src: AudioSource;
  busy: boolean;
  stopped: boolean;
}

export function createCcAudioPlayer(): IAudioPlayer {
  let host: Node | undefined;
  const voices: Voice[] = [];
  const byHandle = new Map<number, Voice>();
  let nextHandle = 1;
  let shared: AudioSource | undefined;

  const ensureHost = (): Node => {
    if (host && host.isValid) return host;
    host = new Node('CCK_Audio');
    const scene = director.getScene();
    if (scene) {
      scene.addChild(host);
      director.addPersistRootNode(host);
    }
    return host;
  };

  const newSource = (label: string): AudioSource => {
    const n = new Node(label);
    ensureHost().addChild(n);
    return n.addComponent(AudioSource);
  };

  // ponytail: voice 池只增不减（复用 busy=false 的），稳定在峰值并发数；需回收再补 shrink。
  const acquireVoice = (): Voice => {
    let v = voices.find((x) => !x.busy);
    if (!v) {
      v = { src: newSource(`voice_${voices.length}`), busy: false, stopped: false };
      voices.push(v);
    }
    v.busy = true;
    v.stopped = false;
    return v;
  };

  const loadClip = (name: string): Promise<AudioClip> =>
    getAssetLoader().load<AudioClip>(name, { type: 'audioClip' });

  return {
    play(spec: AudioPlaySpec): number {
      const v = acquireVoice();
      const h = nextHandle++;
      byHandle.set(h, v);
      void loadClip(spec.name).then(
        (clip) => {
          if (v.stopped) return; // 加载期间被 stop：丢弃
          v.src.clip = clip;
          v.src.loop = spec.loop;
          v.src.volume = spec.volume;
          v.src.play();
        },
        () => {
          v.busy = false; // 加载失败：回收 voice、注销句柄
          byHandle.delete(h);
        },
      );
      return h;
    },

    stop(handle: number): void {
      const v = byHandle.get(handle);
      if (!v) return;
      byHandle.delete(handle);
      v.stopped = true;
      v.src.stop();
      v.src.clip = null;
      v.busy = false;
    },

    setVolume(handle: number, volume: number): void {
      const v = byHandle.get(handle);
      if (v) v.src.volume = volume;
    },

    pause(handle: number): void {
      byHandle.get(handle)?.src.pause();
    },

    resume(handle: number): void {
      // AudioSource.play()：暂停态则续播（见 cc.d.ts「Resume if paused」）。
      byHandle.get(handle)?.src.play();
    },

    playOneShot(name: string, volume: number): void {
      void loadClip(name).then(
        (clip) => {
          if (!shared || !shared.isValid) shared = newSource('oneShot');
          shared.playOneShot(clip, volume);
        },
        () => {
          /* 加载失败：一次性音效静默丢弃 */
        },
      );
    },
  };
}

/** KitModule：注册 `AUDIO_PLAYER → cc.AudioSource 实现`（本层未注册时）。放模块数组里，AudioService 自动拾取。 */
export function ccAudioModule(): KitModule {
  return {
    name: 'audio-player',
    install(ctx) {
      if (!ctx.container.hasLocal(AUDIO_PLAYER)) {
        ctx.container.register(AUDIO_PLAYER, { useValue: createCcAudioPlayer() });
      }
    },
  };
}

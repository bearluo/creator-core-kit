import { afterEach, describe, expect, it } from 'vitest';
import {
  createAudioService,
  getAudioService,
  AUDIO_SERVICE,
} from '../audio-service';
import { AUDIO_PLAYER, type AudioPlaySpec, type IAudioPlayer } from '../audio-player';
import { getRootContainer } from '../../di';

/** 可控 spy IAudioPlayer：记录每次调用；play 返回自增 handle（从 100 起，便于与 core 内部 AudioHandle 区分）。 */
function makePlayer() {
  const plays: AudioPlaySpec[] = [];
  const oneShots: Array<{ name: string; volume: number }> = [];
  const stops: number[] = [];
  const setVolumes: Array<{ handle: number; volume: number }> = [];
  const pauses: number[] = [];
  const resumes: number[] = [];
  let next = 100;
  const player: IAudioPlayer = {
    play(spec: AudioPlaySpec): number {
      plays.push(spec);
      return next++;
    },
    stop: (h: number) => void stops.push(h),
    setVolume: (h: number, v: number) => void setVolumes.push({ handle: h, volume: v }),
    pause: (h: number) => void pauses.push(h),
    resume: (h: number) => void resumes.push(h),
    playOneShot: (name: string, volume: number) => void oneShots.push({ name, volume }),
  };
  return { player, plays, oneShots, stops, setVolumes, pauses, resumes };
}

afterEach(() => {
  getRootContainer().unregister(AUDIO_SERVICE);
  getRootContainer().unregister(AUDIO_PLAYER);
});

describe('AudioService · BGM 单轨', () => {
  it('1. playMusic 走 music 通道，默认 loop=true、最终音量=1', () => {
    const p = makePlayer();
    const audio = createAudioService({ player: p.player });
    audio.playMusic('bgm/title');
    expect(p.plays).toEqual([{ name: 'bgm/title', channel: 'music', loop: true, volume: 1 }]);
  });

  it('2. playMusic 尊重 loop/volume opts', () => {
    const p = makePlayer();
    const audio = createAudioService({ player: p.player });
    audio.playMusic('bgm/fight', { loop: false, volume: 0.5 });
    expect(p.plays[0]).toMatchObject({ loop: false, volume: 0.5 });
  });

  it('3. 再播 BGM 先停当前（单轨不变式）', () => {
    const p = makePlayer();
    const audio = createAudioService({ player: p.player });
    audio.playMusic('a'); // player handle 100
    audio.playMusic('b'); // 停 100 再播
    expect(p.stops).toEqual([100]);
    expect(p.plays).toHaveLength(2);
  });

  it('4. stopMusic 停当前；无 BGM 时 no-op', () => {
    const p = makePlayer();
    const audio = createAudioService({ player: p.player });
    audio.stopMusic(); // 无 BGM
    expect(p.stops).toEqual([]);
    audio.playMusic('a');
    audio.stopMusic();
    expect(p.stops).toEqual([100]);
  });

  it('5. pause/resumeMusic 作用于 BGM 播放器句柄；无 BGM 时 no-op', () => {
    const p = makePlayer();
    const audio = createAudioService({ player: p.player });
    audio.pauseMusic(); // 无 BGM
    audio.resumeMusic();
    expect(p.pauses).toEqual([]);
    audio.playMusic('a'); // handle 100
    audio.pauseMusic();
    audio.resumeMusic();
    expect(p.pauses).toEqual([100]);
    expect(p.resumes).toEqual([100]);
  });
});

describe('AudioService · 音效', () => {
  it('6. playOneShot 走 fire-and-forget，最终音量=scale×sfx有效', () => {
    const p = makePlayer();
    const audio = createAudioService({ player: p.player });
    audio.playOneShot('sfx/click');
    expect(p.oneShots).toEqual([{ name: 'sfx/click', volume: 1 }]);
  });

  it('7. playOneShot 折算 scale 与分类音量', () => {
    const p = makePlayer();
    const audio = createAudioService({ player: p.player });
    audio.setVolume('sfx', 0.5);
    audio.playOneShot('sfx/hit', 0.5);
    expect(p.oneShots[0].volume).toBeCloseTo(0.25);
  });

  it('8. playEffect 返回句柄，走 sfx 通道，默认 loop=false', () => {
    const p = makePlayer();
    const audio = createAudioService({ player: p.player });
    const h = audio.playEffect('sfx/loop');
    expect(h).toBeGreaterThan(0);
    expect(p.plays[0]).toMatchObject({ channel: 'sfx', loop: false, volume: 1 });
  });

  it('9. playEffect 尊重 loop/volume', () => {
    const p = makePlayer();
    const audio = createAudioService({ player: p.player });
    audio.playEffect('sfx/step', { loop: true, volume: 0.8 });
    expect(p.plays[0]).toMatchObject({ loop: true, volume: 0.8 });
  });

  it('10. stopEffect 停指定音效句柄；未知句柄 no-op', () => {
    const p = makePlayer();
    const audio = createAudioService({ player: p.player });
    const h = audio.playEffect('sfx/loop'); // player handle 100
    audio.stopEffect(9999); // 未知 → no-op
    expect(p.stops).toEqual([]);
    audio.stopEffect(h);
    expect(p.stops).toEqual([100]);
  });

  it('11. stopEffect 不误停 BGM（通道守卫）', () => {
    const p = makePlayer();
    const audio = createAudioService({ player: p.player });
    audio.playMusic('a'); // AudioHandle 1（music），player handle 100
    audio.stopEffect(1); // 传入 music 句柄 → 通道非 sfx，no-op
    expect(p.stops).toEqual([]);
  });

  it('12. stopAllEffects 停全部音效但不动 BGM', () => {
    const p = makePlayer();
    const audio = createAudioService({ player: p.player });
    audio.playMusic('a'); // player 100
    audio.playEffect('e1'); // player 101
    audio.playEffect('e2'); // player 102
    audio.stopAllEffects();
    expect(p.stops.sort()).toEqual([101, 102]);
    audio.pauseMusic(); // BGM 仍在
    expect(p.pauses).toEqual([100]);
  });
});

describe('AudioService · 音量/静音', () => {
  it('13. 分类音量默认 1，setVolume/getVolume 往返 + clamp', () => {
    const audio = createAudioService({ player: makePlayer().player });
    expect(audio.getVolume('master')).toBe(1);
    audio.setVolume('music', 0.3);
    expect(audio.getVolume('music')).toBe(0.3);
    audio.setVolume('master', 2); // clamp 上界
    expect(audio.getVolume('master')).toBe(1);
    audio.setVolume('master', -1); // clamp 下界
    expect(audio.getVolume('master')).toBe(0);
  });

  it('14. setVolume(master) 重算全部在播源（music + sfx）', () => {
    const p = makePlayer();
    const audio = createAudioService({ player: p.player });
    audio.playMusic('a'); // player 100
    audio.playEffect('e'); // player 101
    p.setVolumes.length = 0;
    audio.setVolume('master', 0.5);
    expect(p.setVolumes).toEqual([
      { handle: 100, volume: 0.5 },
      { handle: 101, volume: 0.5 },
    ]);
  });

  it('15. setVolume(music) 只重算 music 源，跳过 sfx', () => {
    const p = makePlayer();
    const audio = createAudioService({ player: p.player });
    audio.playMusic('a'); // player 100
    audio.playEffect('e'); // player 101
    p.setVolumes.length = 0;
    audio.setVolume('music', 0.5);
    expect(p.setVolumes).toEqual([{ handle: 100, volume: 0.5 }]);
  });

  it('16. setVolume(sfx) 只重算 sfx 源，跳过 music', () => {
    const p = makePlayer();
    const audio = createAudioService({ player: p.player });
    audio.playMusic('a'); // player 100
    audio.playEffect('e'); // player 101
    p.setVolumes.length = 0;
    audio.setVolume('sfx', 0.25);
    expect(p.setVolumes).toEqual([{ handle: 101, volume: 0.25 }]);
  });

  it('17. 基准音量与分类音量相乘', () => {
    const p = makePlayer();
    const audio = createAudioService({ player: p.player });
    audio.setVolume('music', 0.5);
    audio.playMusic('a', { volume: 0.5 });
    expect(p.plays[0].volume).toBeCloseTo(0.25);
  });

  it('18. setMute 默认 false；静音后有效音量归 0，取消恢复', () => {
    const p = makePlayer();
    const audio = createAudioService({ player: p.player });
    expect(audio.isMuted('master')).toBe(false);
    audio.playMusic('a'); // player 100, 音量 1
    p.setVolumes.length = 0;
    audio.setMute('music', true);
    expect(audio.isMuted('music')).toBe(true);
    expect(p.setVolumes).toEqual([{ handle: 100, volume: 0 }]);
    audio.setMute('music', false);
    expect(p.setVolumes).toEqual([
      { handle: 100, volume: 0 },
      { handle: 100, volume: 1 },
    ]);
  });

  it('19. master 静音令所有通道归 0', () => {
    const p = makePlayer();
    const audio = createAudioService({ player: p.player });
    audio.setMute('master', true);
    audio.playEffect('e'); // 起播时即最终音量 0
    expect(p.plays[0].volume).toBe(0);
  });

  it('20. 基准音量 clamp（越界 base）', () => {
    const p = makePlayer();
    const audio = createAudioService({ player: p.player });
    audio.playEffect('e', { volume: 2 }); // clamp01(2)=1
    expect(p.plays[0].volume).toBe(1);
  });
});

describe('AudioService · 全局暂停/恢复 + DI', () => {
  it('21. pauseAll/resumeAll 作用于全部在播源', () => {
    const p = makePlayer();
    const audio = createAudioService({ player: p.player });
    audio.playMusic('a'); // 100
    audio.playEffect('e'); // 101
    audio.pauseAll();
    expect(p.pauses.sort()).toEqual([100, 101]);
    audio.resumeAll();
    expect(p.resumes.sort()).toEqual([100, 101]);
  });

  it('22. 无 AUDIO_PLAYER 注册时回退空播放器，全 API 可跑', () => {
    const audio = createAudioService();
    expect(() => {
      audio.playMusic('a');
      audio.pauseMusic();
      audio.resumeMusic();
      audio.playOneShot('click');
      const h = audio.playEffect('e');
      audio.setVolume('master', 0.5);
      audio.stopEffect(h);
      audio.pauseAll();
      audio.resumeAll();
      audio.stopAllEffects();
      audio.stopMusic();
    }).not.toThrow();
  });

  it('23. getAudioService 单例；register AUDIO_SERVICE 可覆盖', () => {
    const a1 = getAudioService();
    const a2 = getAudioService();
    expect(a1).toBe(a2);
    const custom = createAudioService({ player: makePlayer().player });
    getRootContainer().register(AUDIO_SERVICE, { useValue: custom });
    expect(getAudioService()).toBe(custom);
  });

  it('24. 空播放器 tryResolve(AUDIO_PLAYER) 生效路径', () => {
    const p = makePlayer();
    getRootContainer().register(AUDIO_PLAYER, { useValue: p.player });
    const audio = createAudioService(); // 不传 player → 走 DI
    audio.playMusic('a');
    expect(p.plays).toHaveLength(1);
  });
});

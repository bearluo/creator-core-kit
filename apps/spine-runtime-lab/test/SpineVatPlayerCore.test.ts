import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  packSpineVatInstanceColor,
  resolveSpineVatFrame,
  SpineVatPlaybackState,
} from '../assets/scripts/SpineVatPlayerCore';
import type { SpineVatManifestV2 } from '../assets/scripts/SpineVatTypes';

const clips: SpineVatManifestV2['clips'] = [
  {
    name: 'idle',
    variant: 'default',
    fps: 30,
    duration: 2,
    frameOffset: 0,
    frameCount: 60,
    layout: 'layout-0',
  },
  {
    name: 'win',
    variant: 'default',
    fps: 20,
    duration: 2,
    frameOffset: 60,
    frameCount: 40,
    layout: 'layout-0',
  },
];

describe('SpineVatPlaybackState', () => {
  it('循环播放支持正向跨尾帧和负速回绕', () => {
    expect(resolveSpineVatFrame(61.2, 60, true)).toBe(1);
    expect(resolveSpineVatFrame(-1, 60, true)).toBe(59);
    expect(resolveSpineVatFrame(61.2, 60, false)).toBe(59);
    expect(resolveSpineVatFrame(-1, 60, false)).toBe(0);
  });

  it('多动画循环边界只在当前 clip 内回绕，不会串到下一动画首帧', () => {
    const textureFrame = (clip: SpineVatManifestV2['clips'][number], rawFrame: number): number => (
      clip.frameOffset + resolveSpineVatFrame(rawFrame, clip.frameCount, true)
    );

    expect(textureFrame(clips[0], 59.999)).toBe(59);
    expect(textureFrame(clips[0], 60)).toBe(0);
    expect(textureFrame(clips[0], 60.999)).toBe(0);
    expect(textureFrame(clips[1], 39.999)).toBe(99);
    expect(textureFrame(clips[1], 40)).toBe(60);

    const shader = readFileSync(resolve(
      import.meta.dirname,
      '../extensions/spine-vat-importer/assets/spine-vat-v2.effect',
    ), 'utf8');
    expect(shader).toContain('float globalFrame = a_vatAnim0.x + localFrame;');
    expect(shader).toContain('float linearIndex = globalFrame * vatLayout.x + a_position.x;');
  });

  it('切换动画后上传独立 frameOffset、frameCount 和 fps', () => {
    const state = new SpineVatPlaybackState(clips, 'straight', 10, 'idle');
    state.play('win', { loop: false, speed: 1.5, startTime: 0.25 }, 12);

    expect(state.gpuAttributes()).toEqual({
      anim0: [60, 40, 20, 12],
      anim1: [5, 1.5, 0, -1],
      color: [1, 1, 1, 1],
    });
    expect(state.frame(13)).toBe(35);
    expect(state.frame(20)).toBe(39);
  });

  it('pause 和 resume 保留亚帧位置，不发生跳帧', () => {
    const state = new SpineVatPlaybackState(clips, 'straight', 0, 'idle');
    state.pause(0.55);
    expect(state.frameFloat(5)).toBeCloseTo(16.5);
    expect(state.gpuAttributes().anim1[1]).toBe(0);

    state.resume(5);
    expect(state.frameFloat(5)).toBeCloseTo(16.5);
    expect(state.frameFloat(5.5)).toBeCloseTo(31.5);
  });

  it('seek 和改速都重设时间锚点且改速瞬间不跳帧', () => {
    const state = new SpineVatPlaybackState(clips, 'straight', 0, 'idle');
    state.seek(1, 2);
    expect(state.frameFloat(2)).toBe(30);

    state.setSpeed(2, 2.25);
    expect(state.frameFloat(2.25)).toBeCloseTo(37.5);
    expect(state.frameFloat(2.75)).toBeCloseTo(67.5);
  });

  it('运行中切换 loop 会立即改变帧解析但不重启动画', () => {
    const state = new SpineVatPlaybackState(clips, 'straight', 0, 'idle');
    expect(state.frame(2.1)).toBe(3);
    state.setLoop(false);
    expect(state.frame(2.1)).toBe(59);
    expect(state.gpuAttributes().anim1[2]).toBe(0);
  });

  it('manual frame 会裁剪，解除后从固定帧继续', () => {
    const state = new SpineVatPlaybackState(clips, 'straight', 0, 'idle');
    state.setManualFrame(999, 1);
    expect(state.frame(20)).toBe(59);
    expect(state.gpuAttributes().anim1[3]).toBe(59);

    state.setManualFrame(null, 20);
    expect(state.frameFloat(20)).toBe(59);
    expect(state.frameFloat(20.1)).toBeCloseTo(62);
  });

  it('Straight 和 PMA 使用不同的实例颜色打包', () => {
    expect(packSpineVatInstanceColor([0.8, 0.5, 0.25, 0.5], 'straight'))
      .toEqual([0.8, 0.5, 0.25, 0.5]);
    expect(packSpineVatInstanceColor([0.8, 0.5, 0.25, 0.5], 'premultiplied'))
      .toEqual([0.4, 0.25, 0.125, 0.5]);
  });

  it('实例颜色限制在归一化范围', () => {
    const state = new SpineVatPlaybackState(clips, 'straight', 0, 'idle');
    state.setColor([2, -1, 0.5, 0.75]);
    expect(state.gpuAttributes().color).toEqual([1, 0, 0.5, 0.75]);
  });

  it('事件轨道按跨越顺序派发并正确跨循环', () => {
    const state = new SpineVatPlaybackState([{
      ...clips[0],
      fps: 10,
      duration: 1,
      frameCount: 10,
      events: [
        { time: 0.2, name: 'step' },
        { time: 0.8, name: 'reward', intValue: 3 },
      ],
    }], 'straight', 0);

    expect(state.drainEvents(0.25).map((event) => event.name)).toEqual(['step']);
    const crossed = state.drainEvents(1.85);
    expect(crossed.map((event) => `${event.name}:${event.loop}`))
      .toEqual(['reward:0', 'step:1', 'reward:1']);
  });

  it('事件轨道支持倒放，seek 不补发跳过区间', () => {
    const state = new SpineVatPlaybackState([{
      ...clips[0],
      fps: 10,
      duration: 1,
      frameCount: 10,
      events: [
        { time: 0.2, name: 'early' },
        { time: 0.8, name: 'late' },
      ],
    }], 'straight', 0);
    state.seek(0.9, 0);
    expect(state.drainEvents(0)).toEqual([]);
    state.setSpeed(-1, 0);
    expect(state.drainEvents(0.7).map((event) => `${event.name}:${event.direction}`))
      .toEqual(['late:-1', 'early:-1']);
  });

  it('socket 返回与 GPU 当前离散帧一致的仿射矩阵', () => {
    const state = new SpineVatPlaybackState([{
      ...clips[0],
      fps: 1,
      duration: 3,
      frameCount: 3,
      sockets: [{
        name: 'fx',
        frames: [
          [1, 0, 0, 1, 0, 0],
          [0, -1, 1, 0, 10, 20],
          [-1, 0, 0, -1, 30, 40],
        ],
      }],
    }], 'straight', 0);

    expect(state.socket('fx', 1.2)).toEqual([0, -1, 1, 0, 10, 20]);
    expect(state.socket('missing', 1.2)).toBeNull();
  });
});

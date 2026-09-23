import type {
  SpineVatAlphaMode,
  SpineVatEventKey,
  SpineVatManifestV2,
  SpineVatSocketMatrix,
} from './SpineVatTypes';

export type SpineVatPlayableClip = SpineVatManifestV2['clips'][number];
export type SpineVatInstanceColor = readonly [number, number, number, number];

export interface SpineVatPlayOptions {
  loop?: boolean;
  speed?: number;
  startTime?: number;
}

export interface SpineVatInstanceSnapshot {
  clip: string;
  frame: number;
  frameFloat: number;
  loop: boolean;
  speed: number;
  paused: boolean;
  manualFrame: number | null;
  color: SpineVatInstanceColor;
}

export interface SpineVatGpuAttributes {
  anim0: readonly [number, number, number, number];
  anim1: readonly [number, number, number, number];
  color: SpineVatInstanceColor;
}

export interface SpineVatRuntimeEvent extends SpineVatEventKey {
  clip: string;
  direction: 1 | -1;
  loop: number;
}

interface EventOccurrence {
  event: SpineVatEventKey;
  rawFrame: number;
  loop: number;
}

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
  return value;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, finite(value, 'color channel')));
}

export function resolveSpineVatFrame(rawFrame: number, frameCount: number, loop: boolean): number {
  if (frameCount <= 0) return 0;
  const frame = Math.floor(rawFrame);
  if (!loop) return Math.max(0, Math.min(frameCount - 1, frame));
  return ((frame % frameCount) + frameCount) % frameCount;
}

export function packSpineVatInstanceColor(
  color: SpineVatInstanceColor,
  alphaMode: Exclude<SpineVatAlphaMode, 'unknown'>,
): SpineVatInstanceColor {
  const red = clamp01(color[0]);
  const green = clamp01(color[1]);
  const blue = clamp01(color[2]);
  const alpha = clamp01(color[3]);
  return alphaMode === 'premultiplied'
    ? [red * alpha, green * alpha, blue * alpha, alpha]
    : [red, green, blue, alpha];
}

function collectEventOccurrences(
  clip: SpineVatPlayableClip,
  fromFrame: number,
  toFrame: number,
  loop: boolean,
): SpineVatRuntimeEvent[] {
  const events = clip.events ?? [];
  if (events.length === 0 || fromFrame === toFrame) return [];
  const direction: 1 | -1 = toFrame > fromFrame ? 1 : -1;
  const occurrences: EventOccurrence[] = [];

  if (!loop) {
    const endFrame = Math.max(0, clip.duration * clip.fps);
    const from = Math.max(0, Math.min(endFrame, fromFrame));
    const to = Math.max(0, Math.min(endFrame, toFrame));
    for (const event of events) {
      const rawFrame = event.time * clip.fps;
      if ((direction > 0 && from < rawFrame && rawFrame <= to)
        || (direction < 0 && to <= rawFrame && rawFrame < from)) {
        occurrences.push({ event, rawFrame, loop: 0 });
      }
    }
  } else {
    const period = clip.frameCount;
    if (period <= 0) return [];
    for (const event of events) {
      const eventFrame = event.time * clip.fps;
      const firstLoop = direction > 0
        ? Math.floor((fromFrame - eventFrame) / period) + 1
        : Math.ceil((toFrame - eventFrame) / period);
      const lastLoop = direction > 0
        ? Math.floor((toFrame - eventFrame) / period)
        : Math.ceil((fromFrame - eventFrame) / period) - 1;
      for (let cycle = firstLoop; cycle <= lastLoop; cycle += 1) {
        const rawFrame = eventFrame + cycle * period;
        if ((direction > 0 && fromFrame < rawFrame && rawFrame <= toFrame)
          || (direction < 0 && toFrame <= rawFrame && rawFrame < fromFrame)) {
          occurrences.push({ event, rawFrame, loop: cycle });
          if (occurrences.length > 4096) throw new Error('VAT event dispatch exceeded 4096 events in one update');
        }
      }
    }
  }

  occurrences.sort((left, right) => direction * (left.rawFrame - right.rawFrame));
  return occurrences.map(({ event, loop: cycle }) => ({
    ...event,
    clip: clip.name,
    direction,
    loop: cycle,
  }));
}

export class SpineVatPlaybackState {
  private clipIndex = 0;
  private anchorTime: number;
  private anchorFrame = 0;
  private playbackSpeed = 1;
  private shouldLoop = true;
  private isPaused = false;
  private fixedFrame: number | null = null;
  private instanceColor: SpineVatInstanceColor = [1, 1, 1, 1];
  private eventCursor = 0;

  constructor(
    private readonly clips: readonly SpineVatPlayableClip[],
    private readonly alphaMode: Exclude<SpineVatAlphaMode, 'unknown'>,
    now: number,
    initialClip?: string,
  ) {
    if (clips.length === 0) throw new Error('VAT player needs at least one clip');
    this.anchorTime = finite(now, 'engine time');
    this.play(initialClip ?? clips[0].name, {}, now);
  }

  get currentClip(): SpineVatPlayableClip {
    return this.clips[this.clipIndex];
  }

  play(animation: string, options: SpineVatPlayOptions = {}, now: number): void {
    const index = this.clips.findIndex((clip) => clip.name === animation);
    if (index < 0) throw new Error(`VAT clip not found: ${animation}`);
    this.clipIndex = index;
    this.shouldLoop = options.loop ?? true;
    this.playbackSpeed = finite(options.speed ?? 1, 'playback speed');
    this.anchorFrame = Math.max(0, finite(options.startTime ?? 0, 'start time')) * this.currentClip.fps;
    this.anchorTime = finite(now, 'engine time');
    this.isPaused = false;
    this.fixedFrame = null;
    this.eventCursor = this.anchorFrame;
  }

  pause(now: number): void {
    if (this.isPaused) return;
    this.anchorFrame = this.rawFrame(now);
    this.anchorTime = finite(now, 'engine time');
    this.isPaused = true;
  }

  resume(now: number): void {
    if (!this.isPaused) return;
    this.anchorTime = finite(now, 'engine time');
    this.isPaused = false;
  }

  seek(seconds: number, now: number): void {
    this.anchorFrame = Math.max(0, finite(seconds, 'seek time')) * this.currentClip.fps;
    this.anchorTime = finite(now, 'engine time');
    this.fixedFrame = null;
    this.eventCursor = this.anchorFrame;
  }

  setSpeed(speed: number, now: number): void {
    if (!this.isPaused && this.fixedFrame === null) this.anchorFrame = this.rawFrame(now);
    this.anchorTime = finite(now, 'engine time');
    this.playbackSpeed = finite(speed, 'playback speed');
  }

  setLoop(loop: boolean): void {
    this.shouldLoop = loop;
  }

  setManualFrame(frame: number | null, now: number): void {
    const engineTime = finite(now, 'engine time');
    if (frame === null) {
      if (this.fixedFrame !== null) this.anchorFrame = this.fixedFrame;
      this.anchorTime = engineTime;
      this.fixedFrame = null;
      this.eventCursor = this.anchorFrame;
      return;
    }
    this.fixedFrame = resolveSpineVatFrame(finite(frame, 'manual frame'), this.currentClip.frameCount, false);
    this.eventCursor = this.fixedFrame;
  }

  setColor(color: SpineVatInstanceColor): void {
    this.instanceColor = [
      clamp01(color[0]),
      clamp01(color[1]),
      clamp01(color[2]),
      clamp01(color[3]),
    ];
  }

  frameFloat(now: number): number {
    return this.fixedFrame ?? this.rawFrame(now);
  }

  frame(now: number): number {
    return resolveSpineVatFrame(this.frameFloat(now), this.currentClip.frameCount, this.shouldLoop);
  }

  drainEvents(now: number): SpineVatRuntimeEvent[] {
    const currentFrame = this.frameFloat(now);
    const events = collectEventOccurrences(this.currentClip, this.eventCursor, currentFrame, this.shouldLoop);
    this.eventCursor = currentFrame;
    return events;
  }

  socket(name: string, now: number): SpineVatSocketMatrix | null {
    const track = this.currentClip.sockets?.find((candidate) => candidate.name === name);
    if (!track || track.frames.length === 0) return null;
    const frame = Math.min(this.frame(now), track.frames.length - 1);
    return track.frames[frame] ?? null;
  }

  gpuAttributes(): SpineVatGpuAttributes {
    const clip = this.currentClip;
    return {
      anim0: [clip.frameOffset, clip.frameCount, clip.fps, this.anchorTime],
      anim1: [this.anchorFrame, this.isPaused ? 0 : this.playbackSpeed, this.shouldLoop ? 1 : 0, this.fixedFrame ?? -1],
      color: packSpineVatInstanceColor(this.instanceColor, this.alphaMode),
    };
  }

  snapshot(now: number): SpineVatInstanceSnapshot {
    return {
      clip: this.currentClip.name,
      frame: this.frame(now),
      frameFloat: this.frameFloat(now),
      loop: this.shouldLoop,
      speed: this.playbackSpeed,
      paused: this.isPaused,
      manualFrame: this.fixedFrame,
      color: this.instanceColor,
    };
  }

  private rawFrame(now: number): number {
    if (this.isPaused) return this.anchorFrame;
    return this.anchorFrame
      + (finite(now, 'engine time') - this.anchorTime) * this.currentClip.fps * this.playbackSpeed;
  }
}

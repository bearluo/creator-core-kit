import { afterEach, describe, expect, it, vi } from 'vitest';
import { director, game, Director, ccCalls, resetCcMock } from 'cc';
import { bootCoreKit, driveWithDirector, loggerModule } from '../bootstrap';
import { createCcLogger } from '../cc-logger';
import {
  boot,
  getLogger,
  getRootContainer,
  getTimer,
  EVENT_BUS,
  KIT,
  LOGGER,
  TIMER,
  type ITimerDriver,
  type ILogger,
} from '@cck/core';

describe('engine Bootstrap', () => {
  afterEach(async () => {
    const root = getRootContainer();
    if (root.hasLocal(KIT)) {
      await root.resolve(KIT).shutdown();
    }
    root.unregister(EVENT_BUS);
    root.unregister(TIMER);
    root.unregister(LOGGER);
    root.unregister(KIT);
    resetCcMock();
  });

  it('1. driveWithDirector：EVENT_AFTER_UPDATE 触发 → tick(game.deltaTime)；解绑后停', () => {
    const ticks: number[] = [];
    const driver: ITimerDriver = { tick: (dt) => void ticks.push(dt) };
    const dispose = driveWithDirector(driver);
    game.deltaTime = 0.016;
    director.emit(Director.EVENT_AFTER_UPDATE);
    game.deltaTime = 0.033;
    director.emit(Director.EVENT_AFTER_UPDATE);
    expect(ticks).toEqual([0.016, 0.033]);
    dispose();
    director.emit(Director.EVENT_AFTER_UPDATE);
    expect(ticks).toEqual([0.016, 0.033]);
  });

  it('2. loggerModule：注册 LOGGER→CcLogger，getLogger 输出走 cc', async () => {
    await boot({ modules: [loggerModule()] });
    getLogger().info('viaCc');
    expect(ccCalls).toContainEqual({ fn: 'log', args: ['viaCc'] });
  });

  it('3. loggerModule 尊重预注册：已有 LOGGER 不覆盖', async () => {
    const root = getRootContainer();
    const custom = createCcLogger();
    root.register(LOGGER, { useValue: custom });
    await boot({ modules: [loggerModule()] });
    expect(root.resolve(LOGGER)).toBe(custom);
  });

  it('4. bootCoreKit：一键注册 LOGGER/EVENT_BUS/TIMER/KIT + 帧驱动生效', async () => {
    await bootCoreKit();
    const root = getRootContainer();
    expect(root.hasLocal(LOGGER)).toBe(true);
    expect(root.hasLocal(EVENT_BUS)).toBe(true);
    expect(root.hasLocal(TIMER)).toBe(true);
    expect(root.hasLocal(KIT)).toBe(true);
    const frames: number[] = [];
    getTimer().onFrame((dt) => void frames.push(dt));
    game.deltaTime = 0.02;
    director.emit(Director.EVENT_AFTER_UPDATE);
    expect(frames).toEqual([0.02]);
  });

  it('5. bootCoreKit shutdown：解绑 director 帧驱动', async () => {
    const kit = await bootCoreKit();
    const frames: number[] = [];
    getTimer().onFrame((dt) => void frames.push(dt));
    await kit.shutdown();
    game.deltaTime = 0.02;
    director.emit(Director.EVENT_AFTER_UPDATE);
    expect(frames).toEqual([]);
  });

  it('6. bootCoreKit：透传自定义 modules 一并装配', async () => {
    const installed = vi.fn();
    await bootCoreKit({ modules: [{ name: 'game', install: installed }] });
    expect(installed).toHaveBeenCalledOnce();
  });

  it('7. bootCoreKit：透传自定义 logger 作为 LOGGER', async () => {
    const custom = createCcLogger() as ILogger;
    await bootCoreKit({ logger: custom });
    expect(getRootContainer().resolve(LOGGER)).toBe(custom);
  });
});

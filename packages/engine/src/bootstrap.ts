import {
  boot,
  coreModule,
  createTimer,
  LOGGER,
  type Disposer,
  type ILogger,
  type ITimerDriver,
  type Kit,
  type KitModule,
} from '@cck/core';
import { director, game, Director } from 'cc';
import { createCcLogger } from './cc-logger';

/**
 * engine 半 Bootstrap —— cc 适配：把 core 组合根接上 cc 的日志与帧循环。
 * 设计见 docs/design/modules/bootstrap.md（engine 半）。
 */

/**
 * 把 ITimer 的 driver 接到 cc.director 帧循环：订阅 `EVENT_AFTER_UPDATE`（引擎与组件
 * update 之后），每帧读 `game.deltaTime` 调 `driver.tick(dt)`。返回解绑 Disposer。
 */
export function driveWithDirector(driver: ITimerDriver): Disposer {
  const onFrame = (): void => {
    driver.tick(game.deltaTime);
  };
  director.on(Director.EVENT_AFTER_UPDATE, onFrame);
  return () => {
    director.off(Director.EVENT_AFTER_UPDATE, onFrame);
  };
}

/** KitModule：注册 `LOGGER → CcLogger`（本层未注册时）。放模块数组首位，后续模块日志走 cc。 */
export function loggerModule(logger?: ILogger): KitModule {
  return {
    name: 'logger',
    install(ctx) {
      if (!ctx.container.hasLocal(LOGGER)) {
        ctx.container.register(LOGGER, { useValue: logger ?? createCcLogger() });
      }
    },
  };
}

/** KitModule：start 时接 director 帧驱动，stop 时解绑（纳入 Kit 生命周期）。 */
function directorDriveModule(driver: ITimerDriver): KitModule {
  let dispose: Disposer | undefined;
  return {
    name: 'director-drive',
    start() {
      dispose = driveWithDirector(driver);
    },
    stop() {
      dispose?.();
      dispose = undefined;
    },
  };
}

/**
 * engine 启动入口：造 timer → boot([logger, core, director-drive, ...user]) → 返回 Kit。
 * 一键打通「日志→cc / 事件总线+定时器 / cc.director 帧驱动」。帧逻辑经 getTimer().onFrame 订阅。
 * shutdown() 时自动解绑帧驱动。
 */
export async function bootCoreKit(opts?: {
  modules?: KitModule[];
  logger?: ILogger;
}): Promise<Kit> {
  const timer = createTimer();
  const logger = opts?.logger ?? createCcLogger();
  return boot({
    logger,
    modules: [loggerModule(logger), coreModule({ timer }), directorDriveModule(timer)].concat(
      opts?.modules ?? [],
    ),
  });
}

import { afterEach, describe, expect, it } from 'vitest';
import { ccCalls, resetCcMock } from 'cc';
import { createCcLogger } from '../cc-logger';
import { LogLevel } from '@cck/core';

describe('CcLogger', () => {
  afterEach(() => resetCcMock());

  it('1. 级别映射：debug→cc.debug / info→cc.log / warn→cc.warn / error→cc.error', () => {
    const logger = createCcLogger({ level: LogLevel.Debug });
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');
    expect(ccCalls).toEqual([
      { fn: 'debug', args: ['d'] },
      { fn: 'log', args: ['i'] },
      { fn: 'warn', args: ['w'] },
      { fn: 'error', args: ['e'] },
    ]);
  });

  it('2. 复用 core 级别过滤：低于 level 丢弃', () => {
    const logger = createCcLogger({ level: LogLevel.Warn });
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    expect(ccCalls).toEqual([{ fn: 'warn', args: ['w'] }]);
  });

  it('3. 复用 core child(tag)：输出带 [tag] 前缀', () => {
    const logger = createCcLogger({ level: LogLevel.Info }).child('Net');
    logger.info('hi');
    expect(ccCalls).toEqual([{ fn: 'log', args: ['[Net]', 'hi'] }]);
  });

  it('4. 默认级别 Info：debug 被丢、info 通过', () => {
    const logger = createCcLogger();
    logger.debug('d');
    logger.info('i');
    expect(ccCalls).toEqual([{ fn: 'log', args: ['i'] }]);
  });
});

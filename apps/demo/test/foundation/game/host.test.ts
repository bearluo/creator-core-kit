import { describe, expect, it, vi } from 'vitest';
import { createGameHost, scoreboardFor } from '../../../assets/foundation/game/host';
import { memoryScoreboard } from '../../../assets/foundation/game/scoreboard';

/**
 * 子游戏 ↔ 大厅那份契约的判据。
 *
 * `createGameHost` 是纯的（玩家身份、成绩表、落盘、退出全靠注入），所以整条规则在 node 里
 * 就能问死 —— 不必有 DI 容器、不必有 `IStorage`、不必登录、不必开 Creator。
 */

const host = (best: Record<string, number> = {}, persist = vi.fn(), exit = vi.fn()) => ({
  instance: createGameHost({ player: { id: 'p1', name: '阿罗' }, best, persist, exit }),
  persist,
  exit,
});

describe('GameHost · 成绩', () => {
  it('没打过就是 0', () => {
    expect(host().instance.best('mini-brick')).toBe(0);
  });

  it('破纪录才落盘，返回值就是「破没破」', () => {
    const h = host();
    expect(h.instance.submit('mini-brick', 7)).toBe(true);
    expect(h.instance.best('mini-brick')).toBe(7);
    expect(h.persist).toHaveBeenCalledTimes(1);

    expect(h.instance.submit('mini-brick', 5)).toBe(false);
    expect(h.instance.submit('mini-brick', 7)).toBe(false); // 打平不算破
    expect(h.instance.best('mini-brick')).toBe(7);
    expect(h.persist).toHaveBeenCalledTimes(1); // 没再写盘
  });

  it('各游戏各算各的 —— 一张表按 id 分格', () => {
    const h = host();
    h.instance.submit('mini-brick', 7);
    h.instance.submit('mini-hop', 110);
    expect(h.instance.best('mini-brick')).toBe(7);
    expect(h.instance.best('mini-hop')).toBe(110);
  });

  it('分数落盘前取整 —— 别让「最好 12.000000001」显示出来', () => {
    const h = host();
    expect(h.instance.submit('mini-plane', 12.9)).toBe(true);
    expect(h.instance.best('mini-plane')).toBe(12);
  });

  it('exit 就是转发出去，host 自己不知道「大厅」是什么', () => {
    const h = host();
    h.instance.exit();
    expect(h.exit).toHaveBeenCalledTimes(1);
  });

  it('玩家身份是只读快照，不给 token 也不给连接', () => {
    expect(host().instance.player).toEqual({ id: 'p1', name: '阿罗' });
  });
});

describe('GameScoreboard · VM 眼里的那两件事', () => {
  it('scoreboardFor 把 gameId 绑死 —— VM 拿到手就不必再管自己叫什么', () => {
    const h = host();
    const board = scoreboardFor('mini-shooter', h.instance);
    expect(board.best()).toBe(0);
    expect(board.submit(9)).toBe(true);
    expect(h.instance.best('mini-shooter')).toBe(9);
    expect(h.instance.best('mini-brick')).toBe(0);
  });

  it('memoryScoreboard 语义跟落盘那份一致 —— 单测才换得动', () => {
    const board = memoryScoreboard(50);
    expect(board.best()).toBe(50);
    expect(board.submit(20)).toBe(false);
    expect(board.submit(51)).toBe(true);
    expect(board.best()).toBe(51);
  });
});

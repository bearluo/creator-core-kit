import { describe, expect, it } from 'vitest';
import { createSceneFlow, ANY_STATE, type FlowState, type SceneFlow } from '../sceneflow';
import { LogLevel, type ILogger } from '../../logging';

function fakeLogger(): { logger: ILogger; warns: unknown[][]; errors: unknown[][] } {
  const warns: unknown[][] = [];
  const errors: unknown[][] = [];
  const logger: ILogger = {
    level: LogLevel.Debug,
    setLevel: () => {},
    debug: () => {},
    info: () => {},
    warn: (...a: unknown[]) => void warns.push(a),
    error: (...a: unknown[]) => void errors.push(a),
    child: () => logger,
  };
  return { logger, warns, errors };
}

/** 记录钩子调用序列的状态工厂。 */
function recState(name: string, log: string[], extra?: Partial<FlowState>): FlowState {
  return {
    name,
    onEnter: (from) => void log.push(`${name}.enter(${from})`),
    onExit: (to) => void log.push(`${name}.exit(${to})`),
    onUpdate: (dt) => void log.push(`${name}.update(${dt})`),
    onPause: () => void log.push(`${name}.pause`),
    onResume: () => void log.push(`${name}.resume`),
    ...extra,
  };
}

describe('SceneFlow', () => {
  it('1. start：进入初始态，current/onChange 正确', () => {
    const log: string[] = [];
    const changes: string[] = [];
    const flow = createSceneFlow({
      logger: fakeLogger().logger,
      onChange: (f, t) => void changes.push(`${f}->${t}`),
    });
    flow.add(recState('boot', log));
    flow.start('boot');
    expect(flow.current).toBe('boot');
    expect(flow.started).toBe(true);
    expect(log).toEqual(['boot.enter()']);
    expect(changes).toEqual(['->boot']);
  });

  it('2. transitionTo：exit(cur)→enter(new)，from/to 传名正确', () => {
    const log: string[] = [];
    const flow = createSceneFlow({ logger: fakeLogger().logger });
    flow.add(recState('a', log)).add(recState('b', log));
    flow.start('a');
    flow.transitionTo('b');
    expect(log).toEqual(['a.enter()', 'a.exit(b)', 'b.enter(a)']);
    expect(flow.current).toBe('b');
  });

  it('3. transitionTo 未知态：告警 no-op', () => {
    const log: string[] = [];
    const { logger, warns } = fakeLogger();
    const flow = createSceneFlow({ logger });
    flow.add(recState('a', log));
    flow.start('a');
    flow.transitionTo('ghost');
    expect(warns.length).toBe(1);
    expect(flow.current).toBe('a');
  });

  it('4. 重入：onEnter 里 transitionTo 入队，当前转换后按序连转', () => {
    const log: string[] = [];
    const flow = createSceneFlow({ logger: fakeLogger().logger });
    flow
      .add(recState('a', log))
      .add(
        recState('decide', log, {
          onEnter: (from, f) => {
            log.push(`decide.enter(${from})`);
            f.transitionTo('b'); // 决策态：进入即转走
          },
        }),
      )
      .add(recState('b', log));
    flow.start('a');
    flow.transitionTo('decide');
    // a.exit(decide) → decide.enter(a) → decide.exit(b) → b.enter(decide)
    expect(log).toEqual([
      'a.enter()',
      'a.exit(decide)',
      'decide.enter(a)',
      'decide.exit(b)',
      'b.enter(decide)',
    ]);
    expect(flow.current).toBe('b');
  });

  it('5. MAX_CHAIN：连转死循环被拦截 + 告警 error，不无限循环', () => {
    const { logger, errors } = fakeLogger();
    const flow = createSceneFlow({ logger });
    flow.add({
      name: 'loop',
      onEnter: (_from, f) => f.transitionTo('loop'), // 无限自转
    });
    flow.start('loop');
    expect(errors.length).toBe(1);
    expect(flow.current).toBe('loop');
  });

  it('6. dispatch：命中 (cur,event) 转移返回 true，未命中返回 false', () => {
    const log: string[] = [];
    const flow = createSceneFlow({ logger: fakeLogger().logger });
    flow.add(recState('idle', log)).add(recState('run', log));
    flow.start('idle');
    flow.addTransition('idle', 'go', 'run');
    expect(flow.dispatch('go')).toBe(true);
    expect(flow.current).toBe('run');
    expect(flow.dispatch('nope')).toBe(false);
  });

  it('6b. dispatch：无当前态（未 start）返回 false', () => {
    const flow = createSceneFlow({ logger: fakeLogger().logger });
    flow.add({ name: 'a' });
    expect(flow.dispatch('go')).toBe(false);
  });

  it('7. dispatch：ANY_STATE 通配兜底', () => {
    const log: string[] = [];
    const flow = createSceneFlow({ logger: fakeLogger().logger });
    flow.add(recState('idle', log)).add(recState('run', log)).add(recState('menu', log));
    flow.start('run');
    flow.addTransition(ANY_STATE, 'esc', 'menu');
    expect(flow.dispatch('esc')).toBe(true);
    expect(flow.current).toBe('menu');
  });

  it('8. addTransition 目标未注册：告警忽略；重复登记：覆盖 + 告警', () => {
    const { logger, warns } = fakeLogger();
    const flow = createSceneFlow({ logger });
    flow.add({ name: 'a' }).add({ name: 'b' });
    flow.addTransition('a', 'x', 'ghost'); // 目标未注册
    expect(warns.length).toBe(1);
    flow.addTransition('a', 'x', 'b');
    flow.addTransition('a', 'x', 'b'); // 重复
    expect(warns.length).toBe(2);
  });

  it('9. update：仅当前态收到 onUpdate', () => {
    const log: string[] = [];
    const flow = createSceneFlow({ logger: fakeLogger().logger });
    flow.add(recState('a', log)).add(recState('b', log));
    flow.start('a');
    flow.update(0.016);
    flow.transitionTo('b');
    flow.update(0.033);
    expect(log).toContain('a.update(0.016)');
    expect(log).toContain('b.update(0.033)');
    expect(log).not.toContain('b.update(0.016)');
    expect(log).not.toContain('a.update(0.033)');
  });

  it('10. push/pop：pushdown 暂停/恢复语义', () => {
    const log: string[] = [];
    const changes: string[] = [];
    const flow = createSceneFlow({
      logger: fakeLogger().logger,
      onChange: (f, t) => void changes.push(`${f}->${t}`),
    });
    flow.add(recState('game', log)).add(recState('pause', log));
    flow.start('game');
    flow.push('pause');
    expect(flow.current).toBe('pause');
    expect(flow.stackDepth).toBe(1);
    expect(changes).toContain('game->pause');
    expect(log).toEqual(['game.enter()', 'game.pause', 'pause.enter(game)']);
    flow.pop();
    expect(flow.current).toBe('game');
    expect(flow.stackDepth).toBe(0);
    expect(changes).toContain('pause->game');
    expect(log).toEqual([
      'game.enter()',
      'game.pause',
      'pause.enter(game)',
      'pause.exit(game)',
      'game.resume',
    ]);
  });

  it('11. push 无当前态 / pop 栈空：告警 no-op', () => {
    const { logger, warns } = fakeLogger();
    const flow = createSceneFlow({ logger });
    flow.add({ name: 'a' });
    flow.push('a'); // 未 start，无当前态
    expect(warns.length).toBe(1);
    flow.start('a');
    flow.pop(); // 栈空
    expect(warns.length).toBe(2);
  });

  it('12. MAX_STACK：栈满拒绝 push + 告警 error', () => {
    const { logger, errors } = fakeLogger();
    const flow = createSceneFlow({ logger });
    flow.add({ name: 'root' }).add({ name: 'a' });
    flow.start('root');
    for (let i = 0; i < 40; i++) flow.push('a');
    expect(flow.stackDepth).toBe(32);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('13. stop：exit 当前态、清栈、started 归 false', () => {
    const log: string[] = [];
    const flow = createSceneFlow({ logger: fakeLogger().logger });
    flow.add(recState('a', log)).add(recState('b', log));
    flow.start('a');
    flow.push('b');
    flow.stop();
    expect(flow.current).toBe('');
    expect(flow.started).toBe(false);
    expect(flow.stackDepth).toBe(0);
    expect(log).toContain('b.exit()');
  });

  it('14. add：重复名 / 通配保留名告警忽略', () => {
    const { logger, warns } = fakeLogger();
    const flow = createSceneFlow({ logger });
    flow.add({ name: 'a' });
    flow.add({ name: 'a' }); // 重复
    flow.add({ name: ANY_STATE }); // 保留名
    expect(warns.length).toBe(2);
    expect(flow.has('a')).toBe(true);
    expect(flow.has(ANY_STATE)).toBe(false);
  });

  it('15. start 已启动 / 未知初始态：告警 no-op', () => {
    const { logger, warns } = fakeLogger();
    const flow = createSceneFlow({ logger });
    flow.add({ name: 'a' });
    flow.start('ghost'); // 未知
    expect(warns.length).toBe(1);
    expect(flow.started).toBe(false);
    flow.start('a');
    flow.start('a'); // 已启动
    expect(warns.length).toBe(2);
  });

  it('17. push 在转换进行中被拒绝（onEnter 里调）', () => {
    const { logger, warns } = fakeLogger();
    const flow = createSceneFlow({ logger });
    flow.add({ name: 'x', onEnter: (_from, f) => f.push('y') }).add({ name: 'y' });
    flow.start('x'); // x.onEnter 里 push('y') 处于转换中 → 拒绝
    expect(flow.current).toBe('x');
    expect(flow.stackDepth).toBe(0);
    expect(warns.some((w) => String(w[0]).includes('push'))).toBe(true);
  });

  it('18. pop 在转换进行中被拒绝（onEnter 里调，栈非空）', () => {
    const { logger, warns } = fakeLogger();
    const flow = createSceneFlow({ logger });
    flow
      .add({ name: 'game' })
      .add({ name: 'pause' })
      .add({ name: 'hud', onEnter: (_from, f) => f.pop() });
    flow.start('game');
    flow.push('pause'); // stack=[game]
    flow.transitionTo('hud'); // hud.onEnter 里 pop() 处于转换中 → 拒绝
    expect(flow.current).toBe('hud');
    expect(flow.stackDepth).toBe(1);
    expect(warns.some((w) => String(w[0]).includes('pop'))).toBe(true);
  });

  it('19. dispatch 在转换进行中入队，当前转换后处理', () => {
    const flow = createSceneFlow({ logger: fakeLogger().logger });
    flow.add({ name: 'a', onEnter: (_from, f) => f.dispatch('go') }).add({ name: 'b' });
    flow.addTransition('a', 'go', 'b');
    flow.start('a'); // a.onEnter 里 dispatch('go') 转换中 → 入队 → 随后转到 b
    expect(flow.current).toBe('b');
  });

  it('20. push 未知态：告警 no-op', () => {
    const { logger, warns } = fakeLogger();
    const flow = createSceneFlow({ logger });
    flow.add({ name: 'a' });
    flow.start('a');
    flow.push('ghost');
    expect(warns.some((w) => String(w[0]).includes('push'))).toBe(true);
    expect(flow.stackDepth).toBe(0);
    expect(flow.current).toBe('a');
  });

  it('16. isIn / has / opts.states 批量注册', () => {
    const states: FlowState[] = [{ name: 'x' }, { name: 'y' }];
    const flow: SceneFlow = createSceneFlow({ states, logger: fakeLogger().logger });
    expect(flow.has('x')).toBe(true);
    expect(flow.has('y')).toBe(true);
    flow.start('x');
    expect(flow.isIn('x')).toBe(true);
    expect(flow.isIn('y')).toBe(false);
  });
});

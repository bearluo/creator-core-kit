import { getLogger, type ILogger } from '../logging';

/** 事件转移表的通配 from 状态名（保留名；状态不得取此名）。 */
export const ANY_STATE = '*';

const MAX_CHAIN = 8; // 单次外部触发内的连锁转换上限（防死循环）
const MAX_STACK = 32; // pushdown 栈深上限（防无限 push）

/** 单个流程状态。全部钩子按需实现；纯数据对象（非 cc.Component），可脱离引擎单测。 */
export interface FlowState {
  readonly name: string;
  /** 进入本态。from = 上一态名（初始进入为 ''）。flow 便于在钩子里自转 / 派发。 */
  onEnter?(from: string, flow: SceneFlow): void;
  /** 离开本态。to = 将进入的态名（stop 收尾为 ''）。 */
  onExit?(to: string): void;
  /** 每帧驱动（仅当前态收到），dt 秒。由 ITimer.onFrame / engine 每帧转发 update()。 */
  onUpdate?(dt: number): void;
  /** 被 push 压栈、让位给新态时（暂停语义，现场保留）。 */
  onPause?(): void;
  /** 经 pop 从栈顶弹回、重新成为活动态时。 */
  onResume?(): void;
}

/** 流程状态机（纯逻辑、零 cc）。真实场景 / bundle 加载等副作用由状态自身在钩子里发起。 */
export interface SceneFlow {
  /** 当前态名；未启动 / 无当前态为 ''。 */
  readonly current: string;
  /** pushdown 栈深。 */
  readonly stackDepth: number;
  /** 是否已 start。 */
  readonly started: boolean;

  /** 注册状态。名字重复 / 为通配保留名 → 告警忽略。返回自身便于链式。 */
  add(state: FlowState): SceneFlow;
  /** 启动：进入 initial 态。未注册名 / 已启动 → 告警 no-op。 */
  start(initial: string): void;
  /** 转换到 name：exit(cur) → 切 → enter(new)。未知名 → 告警 no-op；转换中调 → 入队，当前转换后按序处理。 */
  transitionTo(name: string): void;
  /** 登记事件转移 (from,event)→to。from 可为 ANY_STATE。to 未注册 → 告警忽略；重复 → 覆盖 + 告警。 */
  addTransition(from: string, event: string, to: string): void;
  /** 按当前态派发事件：先查 (cur,event) 再查 (ANY_STATE,event)，命中转移返回 true，无匹配返回 false。 */
  dispatch(event: string): boolean;
  /** 压栈进入（暂停语义）：cur.onPause → 入栈 → new.onEnter。未知 / 转换中 / 无当前态 / 栈满 → 告警 no-op。 */
  push(name: string): void;
  /** 弹栈恢复：cur.onExit → 弹栈顶 → 切回 → onResume。栈空 / 转换中 → 告警 no-op。 */
  pop(): void;
  /** 驱动当前态 onUpdate（每帧转发）。 */
  update(dt: number): void;
  /** 当前是否处于 name。 */
  isIn(name: string): boolean;
  /** name 是否已注册。 */
  has(name: string): boolean;
  /** 停机：exit 当前态、清空栈与待处理队列（保留状态注册），started 归 false。 */
  stop(): void;
}

export interface SceneFlowOptions {
  /** 初始注册的状态集（等价逐个 add）。 */
  states?: FlowState[];
  /** 每次完成一次转换后回调 (from, to)（含初始进入，from 为 ''）。 */
  onChange?: (from: string, to: string) => void;
  logger?: ILogger;
}

/** 造一个流程状态机。 */
export function createSceneFlow(opts?: SceneFlowOptions): SceneFlow {
  const logger = opts?.logger ?? getLogger('SceneFlow');
  const onChange = opts?.onChange;
  const states = new Map<string, FlowState>();
  const transitions = new Map<string, string>(); // "from|event" -> to
  const stack: string[] = [];
  const pending: string[] = [];
  let current: FlowState | undefined;
  let transitioning = false;
  let started = false;

  function runTransition(fromName: string, toState: FlowState): void {
    transitioning = true;
    let chain = 0;
    let prevName = fromName;
    let next: FlowState | undefined = toState;
    while (next !== undefined) {
      if (chain >= MAX_CHAIN) {
        logger.error(`transition: 单次触发内连转超过 ${MAX_CHAIN} 次，疑似死循环，丢弃剩余转换`);
        pending.length = 0;
        break;
      }
      chain++;
      if (current) current.onExit?.(next.name);
      const oldName = prevName;
      current = next;
      current.onEnter?.(oldName, flow);
      onChange?.(oldName, current.name);
      prevName = current.name;
      next = undefined;
      if (pending.length > 0) {
        const pendingName = pending.shift() as string;
        next = states.get(pendingName);
      }
    }
    transitioning = false;
  }

  const flow: SceneFlow = {
    get current(): string {
      return current ? current.name : '';
    },
    get stackDepth(): number {
      return stack.length;
    },
    get started(): boolean {
      return started;
    },

    add(state: FlowState): SceneFlow {
      if (state.name === ANY_STATE) {
        logger.warn(`add: 状态名与通配保留名 '${ANY_STATE}' 冲突，忽略`);
        return flow;
      }
      if (states.has(state.name)) {
        logger.warn(`add: 状态 '${state.name}' 重复注册，忽略`);
        return flow;
      }
      states.set(state.name, state);
      return flow;
    },

    start(initial: string): void {
      if (started) {
        logger.warn('start: 已启动，忽略');
        return;
      }
      const s = states.get(initial);
      if (!s) {
        logger.warn(`start: 未知初始状态 '${initial}'，忽略`);
        return;
      }
      started = true;
      runTransition('', s);
    },

    transitionTo(name: string): void {
      const s = states.get(name);
      if (!s) {
        logger.warn(`transitionTo: 未知状态 '${name}'，忽略`);
        return;
      }
      if (transitioning) {
        pending.push(name);
        return;
      }
      runTransition(current ? current.name : '', s);
    },

    addTransition(from: string, event: string, to: string): void {
      if (!states.has(to)) {
        logger.warn(`addTransition: 目标态 '${to}' 未注册，忽略`);
        return;
      }
      const key = `${from}|${event}`;
      if (transitions.has(key)) {
        logger.warn(`addTransition: 转移 (${from}, ${event}) 重复登记，覆盖旧目标`);
      }
      transitions.set(key, to);
    },

    dispatch(event: string): boolean {
      if (!current) return false;
      let to = transitions.get(`${current.name}|${event}`);
      if (to === undefined) to = transitions.get(`${ANY_STATE}|${event}`);
      if (to === undefined) return false;
      if (transitioning) {
        pending.push(to);
        return true;
      }
      runTransition(current.name, states.get(to) as FlowState);
      return true;
    },

    push(name: string): void {
      const s = states.get(name);
      if (!s) {
        logger.warn(`push: 未知状态 '${name}'，忽略`);
        return;
      }
      if (transitioning) {
        logger.warn(`push: 转换进行中，拒绝 push('${name}')`);
        return;
      }
      if (!current) {
        logger.warn(`push: 无当前态，忽略 push('${name}')`);
        return;
      }
      if (stack.length >= MAX_STACK) {
        logger.error(`push: 栈深达上限 ${MAX_STACK}，拒绝 push('${name}')`);
        return;
      }
      const pausedName = current.name;
      current.onPause?.();
      stack.push(pausedName);
      current = s;
      current.onEnter?.(pausedName, flow);
      onChange?.(pausedName, name);
    },

    pop(): void {
      if (stack.length === 0) {
        logger.warn('pop: 栈空，忽略');
        return;
      }
      if (transitioning) {
        logger.warn('pop: 转换进行中，拒绝 pop');
        return;
      }
      const activeName = current ? current.name : '';
      const restoredName = stack.pop() as string;
      const restored = states.get(restoredName) as FlowState;
      current?.onExit?.(restoredName);
      current = restored;
      current.onResume?.();
      onChange?.(activeName, restoredName);
    },

    update(dt: number): void {
      current?.onUpdate?.(dt);
    },

    isIn(name: string): boolean {
      return current !== undefined && current.name === name;
    },

    has(name: string): boolean {
      return states.has(name);
    },

    stop(): void {
      pending.length = 0;
      stack.length = 0;
      if (current) {
        current.onExit?.('');
        current = undefined;
      }
      started = false;
    },
  };

  if (opts?.states) {
    for (const s of opts.states) flow.add(s);
  }

  return flow;
}

import { Color, Label, Node, Sprite, instantiate } from 'cc';
import type { Prefab } from 'cc';
import type { App, LaunchFailure, LaunchPhase, LaunchProgress } from '@cck/core';
import { getCameraRig } from '@cck/engine';

/**
 * 启动期热更界面 —— 订阅 `App.onProgress/onFailure`，把启动序列（读戳 → 热更 → shared → lobby）
 * 画成「一句状态 + 一条进度条」，失败时给出对应的出路（重试 / 去商店 / 重启）。
 *
 * **界面在 `LaunchOverlay.prefab`，本文件只是薄壳**：填文案、推进度、切失败按钮。字号 / 颜色 / 布局
 * 全在 prefab 上，美术策划直接在编辑器里改，不用碰 TS。
 * prefab 由 `scripts/prefab-gen/launch-overlay.prefab.json` 生成（首次创建走脚本，改它走编辑器/MCP）。
 *
 * **为什么在 demo 而不在 kit**：kit 只出进度事件，样式是项目的事（`packages/core/docs/modules/app.md`
 * 决策表 #7）。
 *
 * **prefab 为什么能在这个阶段用**：它随 Boot.scene 一起被 `@property` 序列化进 **main 包**，
 * 启动第一帧就在手上——受限的只是 `shared` / `lobby` 这些还没加载的 bundle。
 *
 * **挂在哪**：常驻相机组的 `ui` 层 root（已配好 RenderRoot2D + 满屏 Widget，原点在屏幕中心），
 * 因此跨场景存活 —— 正合启动语义：`lobby` 步切完场景后本界面还得在，直到 `running` 才自毁。
 */

const TAG = '[CCK-BOOT-UI]';

/** prefab 上的节点契约。改 prefab 时**别改这些名字**，否则这里静默取不到。 */
const N_STATUS = 'Status';
const N_HINT = 'Hint';
const N_FILL = 'Bar/Fill';
const N_ACTION = 'Action';
const N_ACTION_LABEL = 'Action/Label';

/**
 * 阶段 → 文案 + 粗粒度进度。热更真实下载比例细分在 `hotupdate`..`shared` 之间（0.30→0.60），
 * 这样进度条全程单调前进，不会「下载完 100% 又跳回 60%」。
 *
 * demo 直接写中文：i18n 表本身在 `shared` bundle 里、启动早期还没加载。真实项目要么把启动文案
 * 放进主包（跟着 `LaunchProgress.messageKey` 译），要么就像这里硬编码。
 */
const PHASE: Readonly<Record<LaunchPhase, { readonly text: string; readonly ratio: number }>> = {
  idle: { text: '准备中…', ratio: 0 },
  platform: { text: '初始化…', ratio: 0.1 },
  hotupdate: { text: '检查更新…', ratio: 0.3 },
  shared: { text: '加载公共资源…', ratio: 0.6 },
  lobby: { text: '进入大厅…', ratio: 0.85 },
  running: { text: '', ratio: 1 },
  failed: { text: '', ratio: 0 },
};

/**
 * 唯一留在代码里的两个样式值——**状态色由状态驱动**，放 prefab 上表达不了「失败时变红」。
 * 其余字号 / 布局 / 底色一律在 prefab。
 */
const C_TEXT = new Color(210, 220, 235);
const C_ERR = new Color(255, 120, 110);

export interface LaunchOverlay {
  onProgress(p: LaunchProgress): void;
  onFailure(f: LaunchFailure): void;
  /** 幂等；`running` 时自动调用。 */
  destroy(): void;
}

/** prefab 没绑时的兜底：启动界面缺了不该阻断启动，warn 一行说清怎么修就行。 */
function noop(): LaunchOverlay {
  console.warn(`${TAG} 未绑定 LaunchOverlay.prefab（Boot.scene → Bootstrap 组件的 launchOverlay 属性）→ 无启动界面`);
  return { onProgress: () => {}, onFailure: () => {}, destroy: () => {} };
}

/**
 * 建启动界面。须在 `app.launch()` **之前**调用并把两个回调挂上去（订阅晚了会漏掉前几个阶段）。
 */
export function createLaunchOverlay(app: App, prefab: Prefab | null): LaunchOverlay {
  if (!prefab) return noop();

  const rig = getCameraRig();
  const root = instantiate(prefab);
  rig.layerRoot('ui').addChild(root);

  const status = root.getChildByPath(N_STATUS)?.getComponent(Label);
  const hint = root.getChildByPath(N_HINT)?.getComponent(Label);
  const fill = root.getChildByPath(N_FILL)?.getComponent(Sprite);
  const action = root.getChildByPath(N_ACTION);
  const actionLabel = root.getChildByPath(N_ACTION_LABEL)?.getComponent(Label);

  const setText = (label: Label | null | undefined, s: string): void => {
    if (label) label.string = s;
  };
  const setRatio = (r: number): void => {
    if (fill) fill.fillRange = Math.max(0, Math.min(1, r));
  };

  const hideAction = (): void => {
    if (!action) return;
    action.off(Node.EventType.TOUCH_END); // 不解绑就会随重试次数叠加同一回调
    action.active = false;
  };

  /** 失败态的唯一出口按钮。文案 + 行为由失败分类决定。 */
  const showAction = (text: string, onClick: () => void): void => {
    if (!action) return;
    hideAction();
    setText(actionLabel, text);
    action.active = true;
    action.on(Node.EventType.TOUCH_END, onClick);
  };

  const destroy = (): void => {
    if (root.isValid) root.destroy();
  };

  setRatio(0);

  // 方法体内一律用局部函数、不用 `this`——调用方多半是 `app.onProgress(overlay.onProgress)` 这样
  // 直接传方法引用，`this` 到那时已经丢了。
  return {
    onProgress(p: LaunchProgress): void {
      if (p.phase === 'running') {
        destroy();
        return;
      }
      if (status) status.color = C_TEXT;
      hideAction();
      if (p.phase === 'hotupdate' && p.ratio !== undefined) {
        // 下载完成到 restart 之间还有 apply 的一小段，别停在「99%」让人以为卡死
        setText(status, p.ratio >= 1 ? '更新完成，即将重启…' : `下载更新 ${Math.round(p.ratio * 100)}%`);
        setText(hint, '更新期间请保持网络畅通');
        setRatio(PHASE.hotupdate.ratio + (PHASE.shared.ratio - PHASE.hotupdate.ratio) * p.ratio);
        return;
      }
      setText(status, PHASE[p.phase].text);
      setText(hint, '');
      setRatio(PHASE[p.phase].ratio);
    },

    onFailure(f: LaunchFailure): void {
      if (status) status.color = C_ERR;
      switch (f.kind) {
        case 'network':
          setText(status, '网络异常，启动失败');
          setText(hint, '请检查网络后重试');
          // retry 从**失败那一步**继续，前面跑过的不重跑
          showAction('重试', () => void app.retry());
          break;
        case 'needFullUpdate':
          // 热更换不动的东西（引擎 / AOT chunks / 主包）变了 —— 只能整包更新，重试没有意义
          setText(status, '需要下载完整安装包');
          setText(hint, f.reason);
          showAction('前往应用商店', () => console.log(`${TAG} 引导整包更新（demo 只打日志）`));
          break;
        default:
          setText(status, '启动失败');
          setText(hint, String((f.error as Error)?.message ?? f.error));
          showAction('重启应用', () => app.restart());
      }
    },

    destroy,
  };
}

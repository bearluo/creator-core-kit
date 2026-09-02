import { getAssetLoader, type IAssetLoader } from '../asset';
import { getBundleManager, type BundleManager } from '../bundle';
import { createToken, getRootContainer, type Token } from '../di';
import type { Disposer } from '../eventbus';
import {
  createSemverVersionGate,
  getHotUpdateService,
  type AppInfo,
  type HotUpdateService,
  type VersionGate,
} from '../hotupdate';
import { getLogger, type ILogger } from '../logging';
import { getHttp, postJson, type IHttp } from '../network';

/**
 * App —— 启动编排层：把「读戳 → 热更 → 装共享包 → 进大厅」串成一条可插拔、可上报、可重试的序列。
 *
 * 零件（HotUpdateService / BundleManager / compat 闸 / UIManager）本就齐备，缺的是把它们按序装起来
 * 并对失败分类的这一层。纯逻辑、零 cc：切场景这类副作用由 {@link AppConfig.lobby}`.enter` 回调交还
 * 给 engine 侧（对齐 engine/scene-loader「切场景是 engine 直接行为，core 不持其接缝」的既有决策）。
 */

/** 启动阶段，也是进度上报的粒度。 */
export type LaunchPhase =
  | 'idle'
  | 'platform'
  | 'dispatch'
  | 'hotupdate'
  | 'shared'
  | 'lobby'
  | 'running'
  | 'failed';

export interface AppConfig {
  readonly appId: string;
  /** 客户端版本；app 戳缺失时作 compat 闸的 appVersion 兜底。 */
  readonly version: string;
  /** 渠道 / 分发标识。 */
  readonly channel: string;
  /** 环境：决定版本表 / manifest 地址由项目怎么拼。 */
  readonly env: 'dev' | 'staging' | 'prod';
  /** 启动期必须加载的共享 bundle（按序），默认 `['shared']`。 */
  readonly shared?: readonly string[];
  readonly lobby: {
    readonly bundle: string;
    /** 进入大厅。engine 侧通常就是一行 `loadScene(scene, { bundle })`。 */
    readonly enter: () => Promise<void>;
  };
  /**
   * web：bundle 版本表 JSON 地址（形状见 {@link RemoteVersions}）。
   * 不配则跳过该步——native 靠 searchPaths 读新文件，不需要版本表。
   *
   * **推荐写相对文件名**（如 `cck-versions.json`）：按页面 base 解析，跟 bundle 同源，
   * 换部署地址天然生效。资源真放独立 CDN 时才写绝对 URL。
   *
   * **拉不到 = 启动失败（可重试）**：表与页面同源，拉不到基本等于它没部署上去；退回包内
   * bundleVers 会把发布事故伪装成「玩家在玩旧版」。native 因此更不该配这一项。
   */
  readonly versionUrl?: string;
  /** app 戳所在 bundle，默认 `'main'`（Cocos 主包）。 */
  readonly stampBundle?: string;
  /** app 戳资源路径，默认 `'cck-app-compat'`（tools 的 `cck-manifest stamp` 出包期生成）。 */
  readonly stampPath?: string;
  /** 启动握手。不配则跳过该步（单机 / 尚未接服务端）。 */
  readonly dispatcher?: DispatcherConfig;
}

/** dispatcher 的判定结论。 */
export type DispatchAction = 'play' | 'update' | 'maintenance';

/**
 * dispatcher 下发的内容。字段是服务端 `HandshakeResponse` 的归一形状。
 *
 * `cdnUrl` **就是个 URL** —— 服务端不认识 Cocos 的 manifest 也不认识 Godot 的 pck，
 * 各客户端框架自己解释（ADR-0011）。
 */
export interface DispatchResult {
  readonly action: DispatchAction;
  /** `'play'` 时有效：按客户端版本路由到的那个部署单元。 */
  readonly wsUrl: string;
  readonly cdnUrl: string;
  readonly notice: string;
  readonly storeUrl: string;
  /** 服务器权威时间（Unix 毫秒）。本地时钟玩家可改，体力恢复 / 日常重置 / 限时活动一律以此为准。 */
  readonly serverTimeMs: number;
}

export interface DispatcherConfig {
  /** 完整地址，如 `https://dispatch.example.com/api/Handshake`。 */
  readonly url: string;
  /** 协议契约版本。**由项目传入** —— core 不含任何协议常量（ADR-0011）。 */
  readonly protoVersion: number;
  /** `android` / `ios` / `web` / `wechat` …（engine 侧按 `cc.sys` 填）。 */
  readonly platform: string;
  readonly deviceId?: string;
  readonly timeoutSec?: number;
}

/** 远程版本表：web 热更的全部输入。 */
export interface RemoteVersions {
  /** bundle 名 → 版本（出包 md5）。 */
  readonly bundles?: Readonly<Record<string, string>>;
  /** 本次内容版本号，喂 compat 闸。 */
  readonly version?: string;
  readonly minAppVersion?: string;
  readonly coreApiHash?: string;
}

export interface LaunchProgress {
  readonly phase: LaunchPhase;
  /** 0..1，仅下载阶段有。 */
  readonly ratio?: number;
  /** i18n key —— kit 不出面向用户的文案，UI 自己译。 */
  readonly messageKey?: string;
}

/** 失败分类：给用户看的东西完全不同（重试 / 去商店 / 等公告 / 兜底），不能糊成一个 Error。 */
export type LaunchFailure =
  | { kind: 'network'; retryable: true; error: unknown }
  | { kind: 'needFullUpdate'; reason: string; storeUrl?: string }
  | { kind: 'maintenance'; notice: string; retryable: true }
  | { kind: 'fatal'; error: unknown };

export interface LaunchContext {
  readonly config: AppConfig;
  /** 步骤间传值（{@link APP_INFO}、登录态、服务器下发的配置…）。 */
  readonly bag: Map<string, unknown>;
  report(p: LaunchProgress): void;
}

export interface LaunchStep {
  readonly name: string;
  readonly phase: LaunchPhase;
  /** 返回 `'halt'` = 到此为止（如 native 热更已 restart，等进程重来）。 */
  run(ctx: LaunchContext): Promise<void | 'halt'>;
}

export interface App {
  readonly config: AppConfig;
  readonly phase: LaunchPhase;
  /** 从当前游标跑到底。重复调用不会重跑已完成的步骤。 */
  launch(): Promise<void>;
  /** 从**失败那一步**继续，前面的不重跑。 */
  retry(): Promise<void>;
  restart(): void;
  onProgress(cb: (p: LaunchProgress) => void): Disposer;
  onFailure(cb: (f: LaunchFailure) => void): Disposer;
}

/** 依赖注入口（仅为可测；生产不传，各服务从全局取）。 */
export interface AppDeps {
  bundles?: Pick<BundleManager, 'load' | 'setVersions'>;
  assets?: Pick<IAssetLoader, 'load' | 'loadRemote' | 'release'>;
  hotUpdate?: Pick<HotUpdateService, 'check' | 'update' | 'restart'>;
  gate?: VersionGate;
  http?: IHttp;
  logger?: ILogger;
  /**
   * 重启应用。默认走 `HotUpdateService.restart()`（native 的 `game.restart`）。
   * engine 侧按平台注入——**web 必须 `location.reload()`**：只有整页重来才会重新拉 `index.<md5>.js`。
   */
  restart?: () => void;
  /**
   * 取**引擎内容指纹**，喂 platform 步组装的 {@link AppInfo}。core 零 cc，拿不到这个值，
   * 由 engine 的 `appModule` 注入（native 走 `engineHash()`）。返回 `undefined` = 判不了，
   * 闸对单边缺失恒放行。
   */
  engineHash?: () => string | undefined;
}

/** `ctx.bag` 里 AppInfo 的键——platform 步写入，compat 闸与项目自定义步骤读取。 */
export const APP_INFO = 'cck.app.info';

/** `ctx.bag` 里 {@link DispatchResult} 的键——dispatch 步写入，业务读 wsUrl / cdnUrl / 服务器时间。 */
export const DISPATCH = 'cck.app.dispatch';

const DEFAULT_SHARED = ['shared'] as const;
const DEFAULT_STAMP_BUNDLE = 'main';
const DEFAULT_STAMP_PATH = 'cck-app-compat';

/** JSON 资源的最小形状（`cc.JsonAsset` 的 `.json`）——core 不 import cc，只认这个结构。 */
interface JsonLike {
  readonly json?: unknown;
}

/**
 * 步骤主动中止启动并指定失败分类。
 * 用**结构标记**而非自定义 Error 子类——跨 bundle `instanceof` 不可靠（ADR-0001）。
 */
export function abortLaunch(failure: LaunchFailure): never {
  throw Object.assign(new Error(`启动中止：${failure.kind}`), { __cckLaunchFailure: failure });
}

function classify(e: unknown): LaunchFailure {
  const marked = (e as { __cckLaunchFailure?: LaunchFailure } | null)?.__cckLaunchFailure;
  if (marked) return marked;
  // ponytail: 启动期偶发失败绝大多数是网络/IO（下载、加载资源、切场景）→ 默认判可重试。
  // 真是代码 bug 时重试也只是再失败一次，代价小于把可恢复的失败判成 fatal 让用户无路可走。
  return { kind: 'network', retryable: true, error: e };
}

/**
 * 服务端枚举归一。proto3 JSON 默认发**枚举名**，但打开 `useEnumNumbers` 就变数字——
 * 两种都收，免得服务端换个序列化选项客户端就集体启动失败。
 */
const ACTIONS: Readonly<Record<string, DispatchAction>> = {
  ACTION_PLAY: 'play',
  '1': 'play',
  ACTION_UPDATE: 'update',
  '2': 'update',
  ACTION_MAINTENANCE: 'maintenance',
  '3': 'maintenance',
};

/** 取第一个是 string 的字段。proto3 JSON 的字段名可能是 snake_case 也可能是 camelCase，两种都认。 */
function pickStr(o: Readonly<Record<string, unknown>>, ...keys: readonly string[]): string {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string') return v;
  }
  return '';
}

function parseDispatch(payload: unknown): DispatchResult {
  const env = (payload ?? {}) as { code?: unknown; msg?: unknown; data?: unknown };
  const code = String(env.code ?? '');
  // 业务错误一律 HTTP 200 + body 带 code（CDN / 渠道代理会吞 4xx/5xx）→ 判定看 code 不看状态码。
  if (code !== 'ERROR_CODE_OK' && code !== '1') {
    throw new Error(`dispatcher 拒绝握手：${code} ${String(env.msg ?? '')}`);
  }
  const d = (env.data ?? {}) as Readonly<Record<string, unknown>>;
  const action = ACTIONS[String(d['action'] ?? '')];
  if (!action) throw new Error(`dispatcher 返回未知 action：${String(d['action'])}`);
  const t = d['server_time_ms'] ?? d['serverTimeMs'];
  return {
    action,
    wsUrl: pickStr(d, 'ws_url', 'wsUrl'),
    cdnUrl: pickStr(d, 'cdn_url', 'cdnUrl'),
    notice: pickStr(d, 'notice'),
    storeUrl: pickStr(d, 'store_url', 'storeUrl'),
    serverTimeMs: typeof t === 'number' ? t : 0,
  };
}

/** kit 的默认启动序列。项目可整体替换，或取本函数结果再插队自己的步骤（登录 / SDK / 公告）。 */
export function defaultLaunchSteps(deps?: AppDeps): readonly LaunchStep[] {
  const logger = deps?.logger ?? getLogger('App');
  const assets = (): Pick<IAssetLoader, 'load' | 'loadRemote' | 'release'> =>
    deps?.assets ?? getAssetLoader();
  const bundles = (): Pick<BundleManager, 'load' | 'setVersions'> =>
    deps?.bundles ?? getBundleManager();
  const hot = (): Pick<HotUpdateService, 'check' | 'update' | 'restart'> =>
    deps?.hotUpdate ?? getHotUpdateService();
  const gate = (): VersionGate => deps?.gate ?? createSemverVersionGate();

  return [
    {
      name: 'platform',
      phase: 'platform',
      async run(ctx: LaunchContext): Promise<void> {
        const bundle = ctx.config.stampBundle ?? DEFAULT_STAMP_BUNDLE;
        const path = ctx.config.stampPath ?? DEFAULT_STAMP_PATH;
        let info: AppInfo = { appVersion: ctx.config.version };
        try {
          const stamp = await assets().load<JsonLike>(path, { bundle, type: 'json' });
          const j = (stamp?.json ?? {}) as { version?: string; coreApiHash?: string };
          info = { appVersion: j.version ?? ctx.config.version, coreApiHash: j.coreApiHash };
          assets().release(path, { bundle, type: 'json' }); // 值已取出，资源可放
        } catch (e) {
          // 缺戳**不阻断启动**：闸对 coreApiHash 单边缺失恒放行（休眠），只是失去 主包裁剪缺代码的保护。
          // 只取 message 不带堆栈——没打戳的项目每次启动都会走到这，堆栈纯噪音。
          logger.warn(
            `app 戳未读到（${bundle}/${path}）→ coreApiHash 闸休眠：${(e as Error)?.message ?? String(e)}`,
          );
        }
        // 引擎指纹不在戳里（app 戳生成于 Creator 构建之前、拿不到本次产物），运行时现取；
        // 读戳失败那条路也要带上它——引擎闸与 coreApiHash 闸互不依赖。
        const eng = deps?.engineHash?.();
        ctx.bag.set(APP_INFO, eng === undefined ? info : { ...info, engineHash: eng });
      },
    },

    {
      name: 'dispatch',
      phase: 'dispatch',
      async run(ctx: LaunchContext): Promise<void> {
        const cfg = ctx.config.dispatcher;
        if (!cfg) return;
        const info = ctx.bag.get(APP_INFO) as AppInfo | undefined;
        // 请求体是契约里 HandshakeRequest 的 proto3 JSON。**排在 platform 之后**：
        // capabilityStamp 就是那一步读出来的 coreApiHash——服务端不解释它怎么算出来的，
        // 只做等值比对，这是「同一套服务端能接 Godot 客户端」的关键（ADR-0011）。
        const payload = await postJson(
          deps?.http ?? getHttp(),
          cfg.url,
          {
            protoVersion: cfg.protoVersion,
            appVersion: info?.appVersion ?? ctx.config.version,
            platform: cfg.platform,
            channel: ctx.config.channel,
            capabilityStamp: info?.coreApiHash ?? '',
            deviceId: cfg.deviceId ?? '',
          },
          cfg.timeoutSec,
        );
        const r = parseDispatch(payload);
        ctx.bag.set(DISPATCH, r); // 先落 bag 再判 —— 失败态的 UI 也要拿 notice / storeUrl
        if (r.action === 'update') {
          abortLaunch({
            kind: 'needFullUpdate',
            reason: r.notice || '当前客户端版本已停止服务',
            storeUrl: r.storeUrl,
          });
        }
        if (r.action === 'maintenance') {
          abortLaunch({ kind: 'maintenance', notice: r.notice, retryable: true });
        }
      },
    },

    {
      name: 'hotupdate',
      phase: 'hotupdate',
      async run(ctx: LaunchContext): Promise<void | 'halt'> {
        // native：backend 注册了才真检查。web 上是空后端 → 恒 up-to-date，本段自然 no-op。
        const r = await hot().check();
        if (r.kind === 'rejected') abortLaunch({ kind: 'needFullUpdate', reason: r.reason });
        if (r.kind === 'error') throw r.error;
        if (r.kind === 'update-available') {
          const u = await hot().update((p) =>
            ctx.report({
              phase: 'hotupdate',
              ratio: p.bytesTotal > 0 ? p.bytesDone / p.bytesTotal : undefined,
              messageKey: 'cck.launch.downloading',
            }),
          );
          if (u.kind === 'failed') throw u.error;
          if (u.kind === 'ready') {
            hot().restart();
            return 'halt'; // 进程即将重来，别再往下走
          }
          // 'skipped'：当前状态不允许 update，按无更新继续
        }

        // web：拉 bundle 版本表（native 靠 searchPaths 读新文件，通常不配 versionUrl → 跳过）
        const url = ctx.config.versionUrl;
        if (!url) return;
        // 相对文件名交给引擎按页面 base 解析 —— web 的 bundle 本来就从页面同源加载
        // (`assets/<bundle>/index.<md5>.js`)，版本表描述的正是这批文件，跟页面放在一起才对。
        //
        // **不拿 dispatcher 下发的 cdnUrl 当基址**：那是 native 的解法（APK 里烘死的地址改不了，
        // 只能运行时注入），web 上不存在这个问题——页面自己就是从某个地址加载的，相对路径永远
        // 跟着页面走，换部署地址天然生效。硬拼过去只会拿到跨域拒绝或 404。
        // 资源真放独立 CDN 的项目写绝对 URL（那时 bundle 也得配 Cocos 的 remote server）。
        // **拉不到就中止启动**（classify 归 network·可重试，UI 出重试按钮），不退回包内 bundleVers：
        // 版本表与页面同源，页面都跑起来了却少这一个 json，几乎只有一种解释——它没被部署上去，
        // 属发布事故；静默降级会把事故伪装成「玩家在玩旧版」，线上没人察觉。且叠加部署一旦清过历史
        // 版本，包内 bundleVers 指向的 md5 可能已 404，降级只是把失败推迟到 load，报错更难查。
        // 语义对齐 native 的 base check 失败（那边同样 throw）；「失败就用包内」是分包 BundleUpdater
        // 的取舍——那是单个包的增量更新，这张表是「这一版整体该用哪些包」的权威，不同量级。
        const remote = await assets().loadRemote<JsonLike>(url, { type: 'json' });
        const j = (remote?.json ?? {}) as RemoteVersions;
        // ⚠️ web 路径没有 AssetsManager 的 apply，compat 闸只能摆在这里 —— 少了它，热更下来的新
        // bundle 引用主包 base 里已被裁掉的符号时，会跑到那一行才崩（ADR-0001，隐蔽）。
        const local = (ctx.bag.get(APP_INFO) as AppInfo | undefined) ?? {
          appVersion: ctx.config.version,
        };
        const g = gate().canApply(
          {
            version: j.version ?? ctx.config.version,
            minAppVersion: j.minAppVersion,
            coreApiHash: j.coreApiHash,
          },
          local,
        );
        if (!g.ok) {
          abortLaunch({ kind: 'needFullUpdate', reason: g.reason ?? '版本表与当前客户端不兼容' });
        }
        bundles().setVersions(j.bundles ?? {});
      },
    },

    {
      name: 'shared',
      phase: 'shared',
      async run(ctx: LaunchContext): Promise<void> {
        for (const b of ctx.config.shared ?? DEFAULT_SHARED) {
          await bundles().load(b);
        }
      },
    },

    {
      name: 'lobby',
      phase: 'lobby',
      async run(ctx: LaunchContext): Promise<void> {
        await bundles().load(ctx.config.lobby.bundle);
        await ctx.config.lobby.enter();
      },
    },
  ];
}

export function createApp(
  config: AppConfig,
  opts?: { steps?: readonly LaunchStep[]; deps?: AppDeps },
): App {
  const logger = opts?.deps?.logger ?? getLogger('App');
  const steps = opts?.steps ?? defaultLaunchSteps(opts?.deps);
  const progressCbs = new Set<(p: LaunchProgress) => void>();
  const failureCbs = new Set<(f: LaunchFailure) => void>();
  const bag = new Map<string, unknown>();
  let phase: LaunchPhase = 'idle';
  let cursor = 0;

  const report = (p: LaunchProgress): void => {
    for (const cb of Array.from(progressCbs)) cb(p);
  };

  const ctx: LaunchContext = { config, bag, report };

  const run = async (): Promise<void> => {
    while (cursor < steps.length) {
      const step = steps[cursor];
      if (!step) break;
      phase = step.phase;
      report({ phase: step.phase });
      let r: void | 'halt';
      try {
        r = await step.run(ctx);
      } catch (e) {
        phase = 'failed';
        const f = classify(e);
        logger.warn(`启动步骤 '${step.name}' 失败（${f.kind}）`, e);
        for (const cb of Array.from(failureCbs)) cb(f);
        return;
      }
      // 'halt'：本步已把控制权交出去（如已 restart）。cursor 不推进 —— 万一没真重启，retry 重跑这步。
      if (r === 'halt') return;
      cursor++;
    }
    phase = 'running';
    report({ phase: 'running' });
  };

  return {
    config,
    get phase(): LaunchPhase {
      return phase;
    },
    launch: run,
    retry: run,
    restart(): void {
      const r = opts?.deps?.restart;
      if (r) r();
      else (opts?.deps?.hotUpdate ?? getHotUpdateService()).restart();
    },
    onProgress(cb: (p: LaunchProgress) => void): Disposer {
      progressCbs.add(cb);
      return () => void progressCbs.delete(cb);
    },
    onFailure(cb: (f: LaunchFailure) => void): Disposer {
      failureCbs.add(cb);
      return () => void failureCbs.delete(cb);
    },
  };
}

/** DI token：App 有必需配置、造不出无参默认，所以只有注册后才能 {@link getApp}。 */
export const APP: Token<App> = createToken<App>('cck.app');

export function getApp(): App {
  const app = getRootContainer().tryResolve(APP);
  if (!app) {
    throw new Error(
      'getApp: App 未注册 —— 先在启动处 createApp(config) 并 getRootContainer().register(APP, { useValue: app })',
    );
  }
  return app;
}

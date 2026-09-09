---
模块: device-tier
所在包: packages/core（**全部** —— engine 半为零）
状态: 已实现（25 测试，`device-tier.ts` 语句/函数/行 100%、分支 90.3%）
跟踪: hlgit #21（wayfinder 图）· 运行时降档见 #23 · 策略注入见 #25 · UIVariant 见 #24 · 模块划分见 #27 · 总纲 `docs/design/device-tiering-overview.md` §3
摘要: 启动期一次性定下画质档位，会话内不可变。kit 只管编排（缓存优先 + 短超时赛跑 + 写缓存），打分与服务器通道全由项目注入 —— kit 一行经验值都不送。
何时读: 要给项目接分档、要改判档时序、或想知道「为什么没有 setTier()」时。
日期: 2026-09-09
依赖: device-profile · save-manager · di-container · app（启动步）
---

# 档位状态 device-tier

## TL;DR

```ts
// 装（boot 期）
await boot({
  modules: [
    deviceProfileModule(),                       // engine，必须在前
    deviceTierModule({
      scoreTier: (p) => (p.processMemoryLimitBytes! < 256e6 ? 'low' : 'high'),
      fetchTier: async (p) => (await postTier(p)) ?? 'none',
    }),
  ],
});

// 用（判档由启动序列的 `tier` 步自动跑，业务不必调）
const t = getRootContainer().resolve(DEVICE_TIER);
registerUI('shop', { prefab: 'Shop', bundle: (v) => `shop-${v.tier}` });
```

**没上分档的项目什么都不用做** —— 不注册模块，`tier` 步问不到 token 就整步跳过，
`UIVariant.tier` 恒 `'default'`，UI 解析行为跟今天逐字相同。

## Purpose

回答「**这台机器该吃哪一档资源**」，并且**只在启动时回答一次**。

**不在范围内**：打分权重与门槛值（策略归项目）、运行中换档（见「为什么没有 setTier」）、
渲染参数降级（kit 只给等级，旋钮业务自己转）、上报（`drain()` 那套归 `perf-window`）。

## Public API

```ts
export interface TierVerdict {
  readonly tier: string;    // 不透明 string，kit 不知道有哪几档
  readonly source: string;  // 来源标记，开放 string，埋点读它
}

export type ScoreTier = (profile: DeviceProfile) => string;
export type FetchTier = (profile: DeviceProfile) => Promise<TierVerdict | 'none'>;
export type ServerOutcome = 'ok' | 'none' | 'timeout' | 'error' | 'skipped';

export interface DeviceTier {
  readonly tier: string;
  readonly source: string;
  readonly serverOutcome: ServerOutcome;   // 只喂埋点
  resolveAtStartup(): Promise<void>;
  setPreferred(tier: string | undefined): Promise<void>;  // 下次启动生效
}

export interface DeviceTierOptions {
  readonly profile?: DeviceProfile;   // 默认 DI 的 DEVICE_PROFILE
  readonly scoreTier?: ScoreTier;
  readonly fetchTier?: FetchTier;
  readonly budgetMs?: number;         // 默认 1500
  readonly save?: SaveManager;        // 默认 getSaveManager()
  readonly logger?: ILogger;
}

export const DEVICE_TIER: Token<DeviceTier>;
export const TIER_DEFAULT: 'default';
export const TIER_SOURCE: { player; cache; local; default };

export function createDeviceTier(opts?: DeviceTierOptions): DeviceTierHandle;
export function deviceTierModule(opts?: DeviceTierOptions): KitModule;
```

### 为什么没有 `setTier()`

**资源档一次会话内定死、运行中不换包。** 三条理由，任一条单独成立：

1. **低清包大概率不在本地**（安装包里只放主游戏那一套）。降档触发的第一次 `open` 就变成
   一次下载 —— 而且是在内存吃紧、网络还慢的时候。
2. **重建路径会先冲高峰值**：`destroy 旧 view → load 新 prefab → 建新 view`，中间新旧两份
   同时在内存里。为了少占几 MB 先多占几 MB。
3. **降档在弱网下根本降不下去**（它自己要先下载）。

于是这些复杂度一条都不用做：重建时机判定、下载编排、切换进度条、失败回滚、并发合并。
把它做成 **API 形状上的缺席**，「运行中切档」在类型层面就写不出来。

⚠️ 唯一的门是既有的通用 `setUIVariant({ tier })` —— 项目真要自己调，技术上切得动。
**kit 不提供、不背书、也不拦**，上面三条风险自担。留这道门是刻意的。

## Behavior & data flow

**判档顺序**（高 → 低）：

| 优先级 | 来源 | `source` |
|---|---|---|
| 1 | 玩家在画质设置里自己选的 | `player` |
| 2 | 服务器结论（赶上预算的话） | `fetchTier` 自己给 |
| 3 | 上次生效的档位缓存 | `cache` |
| 4 | 本地打分 | `local` |
| 5 | 什么都没有 | `default` |

> 「玩家自选压过自动判定」是从 #23「玩家手动改画质 = 提示下次启动生效」推出来的 ——
> 那句话只有在下次启动真 honor 它时才成立。**选了就不再问服务器**，启动还快一步。

**不阻塞启动：缓存优先 + 短超时的机会主义等待、不重试。**

```
读玩家自选 ──有──▶ 用它，收工（不发请求）
    │无
读缓存 / 本地打分 ──▶ 先拿到一个**能立刻用的** fallback
    │
发 fetchTier ──┬─ 预算内回来 ──▶ 用服务器的，写缓存
               ├─ 'none' ──┐
               ├─ reject ──┤──▶ 用 fallback，写缓存；差别只进 serverOutcome
               └─ 超时 ────┘        └─ 迟到的那趟回来仍写缓存给**下次**用
```

这一条设计一次解决三个问题：超时不用纠结（有预算、不重试）；接口失败不用特殊处理
（跟超时同一条路）；**「服务器明说没有」与「网络挂了」在启动路径上行为相同**，差别只体现在
`serverOutcome` 里 —— 那正是该有差别的地方（一个是覆盖率问题，一个是可用性问题）。

**两个存档 key，语义不同、优先级也不同，不能合并：**

| slot | 是什么 |
|---|---|
| `cck_tier` | 上次生效的档位 —— 「**机器该是哪档**」 |
| `cck_tier_preferred` | 玩家自选 —— 「**玩家想要哪档**」 |

## 启动时序

```
platform → dispatch → hotupdate → 【tier】 → shared → lobby → running
```

**硬约束只有一条半**：必须在 `dispatch` 之后（判档要服务器地址），**必须在 `shared` 之前**
（`shared` 那一步要装**按档取的常驻地基皮包**）。放在 `hotupdate` 之后是取舍：热更可能
`halt` 掉整条序列去重启，排在它后面就不会白判一次。

**`AppConfig` 不加字段。** 档位模块自己带着 `scoreTier` / `fetchTier` 在 boot 期注册，
配置再抄一份到 `AppConfig` 就是两个真源。`tier` 步只问「容器里注册了没有」——
没注册就是没上分档，整步跳过。

`LaunchPhase` 因此多了一个 `'tier'` 成员。它是**封闭联合**，加成员会让所有 `switch` 在
编译期报出来（实测：改完当场点名了 demo 的 `LaunchOverlay`）。这也正是否决「让项目自己
splice 一个 `tierStep()` 进去」的硬理由 —— 外部扩不了这个联合，项目插的步骤**给不了自己
准确的 phase**，只能借一个不相干的（借 `'dispatch'`，那 1.5 秒会被启动界面显示成
「连接服务器」，排查直接指错方向）。

## Key design decisions

| # | 决策 | 为什么 |
|---|---|---|
| 1 | **没有 `setTier()`** | 见上。不变式靠 API 形状保证，不靠约定 |
| 2 | **`scoreTier` / `fetchTier` 都由项目注入，kit 不出默认打分** | 跨平台的默认打分必然要把三个语义不同的内存字段挑一个用，那正是 `DeviceProfile` 拆分要禁掉的事；而且它会变成「第二套算法」，跟服务器算不一致时没人发现 |
| 3 | **`fetchTier` 归项目，而 `dispatcher` 的响应能进 kit** | 同一条判据两个结论：`dispatcher` 跨框架（同一套服务端要能接 Godot 客户端），档位的不跨 —— 它里面还带资源清单 |
| 4 | **超时用 `setTimeout`，不能用 `ITimer`** | 后者被 `timeScale` 缩过、且 `paused` 时**根本不触发**，而判档就发生在启动那段最容易被暂停的时间里 |
| 5 | **迟到的服务器结论仍写缓存** | 这次没赶上，下次启动就有权威值了。⚠️ 这条继续跑在启动之后，写之前必须再判一次宿主还在不在 |
| 6 | **`serverOutcome` 是个独立字段，不塞进 `source`** | `source` 说的是「用了谁的结论」，`serverOutcome` 说的是「服务器那趟怎么了」。合并会让埋点没法分开统计覆盖率与可用性 |
| 7 | **`deps: ['device-profile']`** | 不只是 fail-fast，是排序的正确性前提：`install()` 里就要把画像捞出来（没有画像就打不了分，没有合理的缺省可退） |

## Testable seams + test plan

**全部 node 可测**（25 条，语句/函数/行 100%）：注入假画像、假 `scoreTier`/`fetchTier`、
内存 `SaveManager`；超时用 `vi.useFakeTimers()`，`fetchTier` 用手动兑现的 promise 精确控时。

| 组 | 覆盖 |
|---|---|
| 判档前 | 恒 `default` / `skipped` |
| 优先级链 | 玩家自选压过一切且**不发请求** · 缓存垫底 · 本地打分 · 全空落 default · **`scoreTier` 抛了不许掀翻启动** · 空串当没打分 |
| 缺省与坏数据 | 零 option 全走默认 · 缓存里 `tier` 不是字符串 / 是空串 → 当没有 |
| 服务器 | 及时返回盖过本地并写缓存 · `'none'` · reject · 本地结果也写缓存 |
| 超时 | 超预算就走 · ⭐ **迟到的仍写缓存** · 迟到的自己炸了不污染日志 |
| **「await 回来先确认自己还在」** | dispose 后回来不改状态 · dispose 后迟到的不写缓存 |
| 会话内只判一次 | 并发共用同一趟（`fetchTier` 只调一次）· 跑完再调不重判 |
| 玩家自选 | `setPreferred` 不动本次会话 · 清除后回到自动判定 |
| `KitModule` | install 注册 / stop 注销 · **漏注册画像 → `boot()` 当场抛** · 画像从容器里捞 |

`app` 侧另有 4 条（`packages/core/src/app/__tests__/app.test.ts`）：位置在 `hotupdate` 后
`shared` 前 · 没注册模块整步空跑 · 注册了调一次 · 判档抛错会中断启动。

## 已知行为与坑

1. ⚠️ **`SaveManager` 的 slot 名会被静默剔字符**（`SLOT_RE = /[^A-Za-z0-9_-]/g`）——
   写 `cck.tier` 会变成 `ccktier`。本模块的两个 key 因此用下划线。
2. ⚠️ **`UIVariant` 的早退判据必须逐字段比。** `setVariant` 里原本是
   `next.orientation === … && next.skin === …` 的列举式判据，加 `tier` 时不改这行，
   `setUIVariant({ tier })` 就是**彻底的静默 no-op**（连 variant 本身都不更新）。已改成
   `Object.keys(next).every(...)`，将来加第四个维度不会再踩。
3. **`LaunchOverlay` 的 `ORDER` 数组不受类型保护。** 那张 `PHASE` 表是
   `Record<LaunchPhase, …>`，加成员会被穷举检查出来；`ORDER` 是 `LaunchPhase[]`，
   少一个成员完全合法，漏了的后果是进度条在那一段不动。
4. **`scoreTier` 抛异常被吞掉并降级成 default**，只打一条 warn。它是项目代码、同步调用，
   抛出来会掀翻整条启动序列 —— 而分档是可选功能，不该有这个能力。
5. **判档本身抛错会中断启动**（`LaunchStep` 的既有行为）。正常路径抛不出来：
   `SaveManager` 内部吞错、`fetchTier` 的 reject 被 `race` 接住、`scoreTier` 见上。
   真抛了就是 kit 的 bug，该炸。
6. **`tier` 在 `resolveAtStartup()` 跑完之前是 `'default'`。** 任何在启动步之前读它的代码
   都会拿到默认值 —— 这是设计，不是竞态：那一刻档位本来就还没定。

# 测试与可测性规则（业务开发）

**状态**：已实现（2026-08-03）
**摘要**：单测覆盖到 VM 为止，View + prefab + 装配由启动 smoke 兜底；配套「禁模块级单例」「View 只许做四件事」两条硬规则，让 View 层**没有值得测的东西**，而不是有逻辑却不测。
**何时读**：新增或修改任何业务功能之前（人和 AI 都是）；配置测试/lint/CI 门槛之前。
**依赖**：[ADR-0001](../adr/0001-cross-bundle-singleton-and-aot-hotupdate.md)（跨 bundle 单例）、[ADR-0002](../adr/0002-engine-test-strategy-capped-cc-mock.md)（core/engine 测试策略）、[ADR-0010](../adr/0010-no-restart-bundle-code-swap.md)（免重启换 bundle 代码）

> 本文是 ADR-0001 / ADR-0002 在**业务代码（`apps/*`）**一侧的延伸，不重复它们已定的内容。
> kit 内部（`packages/core`、`packages/engine`）的测试策略以 ADR-0002 为准。

---

## 1. 分层测试矩阵

| 层 | 测什么 | 怎么测 | 门槛 | 谁兜底 |
|---|---|---|---|---|
| `packages/core` | 全部逻辑 | vitest（node，零 `cc`） | **覆盖率硬门槛** | — |
| `packages/engine` | 薄壳转发 | vitest + 封顶 cc mock（ADR-0002 决策 3） | 有测即可，不计覆盖率 | apps 集成 |
| **业务 VM**（`apps/*/assets/**/*VM.ts`） | 全部业务逻辑 | vitest（node，零 `cc`） | **每个 VM 必须有对应测试文件** | — |
| **View 薄壳**（`extends cc.Component`） | 不测 | — | 靠规则 B 保证它没逻辑 | 启动 smoke |
| prefab / 场景 | 测不了 | — | — | 预览 / 真机 |
| Bootstrap 装配（module 列表与顺序） | 测不了 | — | — | 启动 smoke |
| 真 cc 运行时行为 | 单测测不到 | — | — | 预览 / 真机 |

**一句话**：未测区不止 View，还有 prefab、装配、真 cc 行为三块。别对外说成「只有 View 没测试」。

---

## 2. 规则 A —— 业务逻辑一律进 VM

**判据**：这段代码需要 `Node` / `Component` / `Label` / `assetManager` 之类的引擎对象才能跑吗？

- **不需要** → 必须写在 `XxxVM.ts` 里，零 `cc` import，可在 node 直跑。
- **需要** → 只能是「取组件、绑值、转发」，见规则 B。

状态、分支、校验、数值计算、格式化、状态机、请求编排——全部属于前者。

---

## 3. 规则 B —— View 只许做四件事

1. 取节点与组件（`getChildByName().getComponent()`）
2. 建绑定（`bindText(label, () => vm.xxx.value)`）
3. 转发交互事件（`btn.on(TOUCH_END, () => vm.increment())`）
4. 转发生命周期钩子（`onShow / onHide / saveState` → VM 的方法）

**出现第五件事，就把它下沉到 VM。** 不是「View 不测」，是「View 里没有可测的东西」——这条塌了，整个矩阵就塌了。

现存反例，`apps/demo/assets/modules/mini-clicker/ClickerView.ts:26`：

```ts
if (typeof state === 'number') this.vm.count.value = state;   // ❌ 类型判断 + 默认值是逻辑
```

应为：

```ts
this.vm.restore(state);   // ✅ 判类型、给默认值归 VM，顺带可测
```

---

## 4. 规则 C —— 禁模块级单例

**禁止**：`export const x = new Foo()`、`static instance`、`static getInstance()`。

在 Cocos 里这不是风格问题，是三个已实测的故障源：

| 机制 | 后果 | 出处 |
|---|---|---|
| bundle 卸载不卸脚本（SystemJS registry 仍在） | 热更换了代码，模块单例还是旧实例、旧状态 | ADR-0010 |
| 编辑器 stop→play 保留 JS 上下文 | 第二次预览拿到第一次的脏状态 | `Bootstrap` 的 `EDITOR` 守卫只护住了 kit 实例，护不到业务单例 |
| 单 bundle 出包时依赖内联复制 | 同一个类被打成多份，「单例」分裂 | ADR-0001 |

**替代**：要共享就注册进模块的 DI scope。

```ts
// 注册（模块装配处）
scope.register(SHOP_VM, { useFactory: () => new ShopVM(), lifetime: 'containerScoped' });

// 测试：作用域即隔离，无需 vi.resetModules()
const scope = getRootContainer().createScope('test');
scope.register(SHOP_VM, { useFactory: () => new ShopVM(), lifetime: 'containerScoped' });
expect(scope.resolve(SHOP_VM)).toBe(scope.resolve(SHOP_VM));  // 同作用域同一份
scope.dispose();                                              // 用完即净
```

生命周期绑**作用域**而不是**模块加载**：bundle 重载、预览重播自然重来，测试隔离白送。

> **唯一豁免**：`getRootContainer()` 用 `globalThis[Symbol.for('cck.di.root')]` 承载根容器，这是 ADR-0001 指定的跨 bundle 唯一性机制，**不是**要被「修正」的单例。

**信号**：如果一个测试需要 `vi.resetModules()` 才能隔离，不要去修测试——那是设计错了。测试痛的地方，bundle 重载和预览重播一定同样痛。

---

## 5. 测试目录结构

### 5.1 绝不能放进 `assets/`

Cocos Creator 编译 `assets/` 下所有 `.ts` 并打进游戏包；`.test.ts` 会被当作游戏脚本，且 `import vitest` 直接炸构建。

正确位置：**`apps/<project>/test/`**（`assets/` 之外，Creator 完全不看，与已有的 `apps/demo/scripts/` 同一套路）。

> **`test` 这个名字全仓只有一处**，就是 `apps/<project>/test/`（单测）。`assets/` 下曾有个同名的 `assets/test/`，2026-08-03 已改名为 **`assets/probes/`**——里面是运行时验证探针（`Demo.scene` + `DemoBoot.ts` + `fixtures-bundle/`，狂打 `[CCK-DEMO]` 日志，Creator 打包后在预览 / 真机跑），一个测试用例都没有，叫 test 名不副实且和单测目录撞名。
>
> | 路径 | 是什么 | 谁跑 |
> |---|---|---|
> | `apps/demo/assets/probes/` | 运行时验证探针 | Creator 打包，预览 / 真机 |
> | `apps/demo/test/` | vitest 单测 | node，CI |

### 5.2 目录按模块镜像 `assets/`

**规则**：`assets/<路径>/<Name>.ts` → `test/<路径>/<Name>.test.ts`，路径原样照抄。

```
apps/demo/
├─ assets/
│  ├─ modules/mini-clicker/CounterVM.ts
│  ├─ modules/lobby/module-catalog.ts
│  └─ shared/…
└─ test/
   ├─ README.md                              ← 本节约定的一屏摘要
   ├─ _helpers/                              ← 跨模块共享的 fake / fixture
   │  └─ scope.ts                            （不匹配 *.test.ts，不会被当用例跑）
   ├─ modules/
   │  ├─ mini-clicker/CounterVM.test.ts
   │  ├─ mini-dodge/…
   │  └─ lobby/module-catalog.test.ts
   └─ shared/…
```

这么定的三个理由：

- **零决策**——测试该放哪不用想，把 `assets/` 换成 `test/`、补 `.test` 后缀即可。AI 和人都不会放错。
- **门槛脚本是纯路径变换**——§6 的「每个 VM 有对应测试」检查因此只有十行，不需要任何配置或映射表。
- **模块随 bundle 增删时测试跟着走**——一个模块一个目录，删模块连测试目录一起删，不会残留孤儿用例。

**约定**：

- 一个源文件一个测试文件，**不合并**。跨模块的公共 fake 放 `_helpers/`（下划线前缀，排在最前且明显不是模块）。
- 现在**不分** `unit/` `integration/` 子层——业务侧目前只有单测，真出现别的种类再分。
- 模块内的测试数据 fixture 就近放该模块目录下，别集中到一个全局 `fixtures/`（会变成谁都不敢删的垃圾场）。

### 5.3 接进 vitest

根 `vitest.config.ts` 需要扩一条 include：

```ts
include: [
  'packages/*/src/**/*.{test,spec}.ts',
  'apps/*/test/**/*.{test,spec}.ts',   // 新增
],
```

`coverage.include` **保持只有 `packages/core/src/**`**——业务测试进 CI，但不进覆盖率门槛。

> **已知空白**：根 `pnpm typecheck`（`tsc -b`）走 project references，`apps/demo` 是 Cocos 工程不在其中，所以 `apps/demo/test/` **目前无人做类型检查**，只有 vitest 运行时能发现问题。别把「typecheck 通过」说成覆盖了业务测试。真出现类型漂移再补一份 `apps/demo/test/tsconfig.json`。

---

## 6. CI 门槛

| 门槛 | 命令 | 拦什么 |
|---|---|---|
| `packages/core` 覆盖率 | `pnpm coverage` | CLAUDE.md 铁律 |
| 每个 `*VM.ts` 有对应测试文件 | `pnpm check:vm-tests` | `scripts/check-vm-tests.mjs` |
| 禁模块级单例（规则 C） | `pnpm lint:demo` | `export const x = new`、`static _inst(ance)`、`static instance()/getInstance()` |
| 禁数组字面量展开 | `pnpm lint:demo` | `[...x]` —— assets 同样被 Cocos 构建，与根对 `packages/*/src` 的同名规则一致 |

`pnpm lint` = `lint:pkgs`（根契约）+ `lint:demo`（业务契约）。

> 本仓当前**没有 CI runner**（无 remote、无 `.github/workflows/`）。上面四条是本地 / 未来 CI 的同一组命令，接 CI 时直接串这四个 script。

**为什么用存在性而不是覆盖率百分比**：百分比高但没断言行为的 VM 一样没用，还容易变成刷数字的扯皮。「每个 VM 至少一个测试文件」十行脚本能查，判定明确。

### ⚠️ 业务侧 lint 规则不能加在根 `eslint.config.js`

`eslint.config.js:20` 把 `apps/**` **整个 ignore 了**（根 lint 只管 `packages/core+engine` 的铁律与风格，Cocos 工程自带编译基线与第三方编辑器扩展不进根契约）。

**规则加进根配置会静默失效——不报错，也不生效。** 业务侧规则在 **`apps/demo/eslint.config.mjs`** 自配一份，从仓库根用 `pnpm lint:demo` 调用。

两个实现细节，改动时别踩：

- **扩展名必须 `.mjs`**。`apps/demo/package.json` 是 Cocos 工程清单，不能给它加 `"type": "module"`（会改变 Creator 眼里整个目录的模块语义），所以配置文件自己声明 ESM。
- **`files` / `ignores` 写仓库根相对路径**（`apps/demo/assets/**/*.ts`），因为它总是从仓库根被调用——这样 `@eslint/js` 和 `typescript-eslint` 也能从根 `node_modules` 解析（demo 自己没装 eslint）。

### 规则 B（View 只做四件事）不做 lint

试过 `files: ['**/*View.ts']` + 禁 import `@cck/core`，**放弃了**：它抓不到真正要抓的东西（业务逻辑滞留在 View），却会误伤合理的取值——`ShopView.ts` 用 `getI18n().t('shop.title')` 填 Label，那是「绑值」，正是规则 B 允许的四件事之一。

为一条抓不准的规则去改写合规代码，是让 lint 反过来指挥架构。**规则 B 保留为审查条款 + §7 自检清单项，不假装能自动化。**

### 已知债

`apps/demo/assets/modules/lobby/LobbyHost.ts` 的 `LobbyNav` 是 module-level 单例，违反规则 C，已用 `eslint-disable-next-line` **显式标注**（不是默认放行）。

它同时是 §4 那张表的**实况样本**：类注释里写着「JS 模块不随 loadScene 重载，所以单例活着」，而 `navKit` 字段就是为「预览重播 shutdown→reboot 后 kit 换了、单例还活着」打的手工补丁。正解是注册进 kit 的容器作用域，`navKit` 随之删除。改动落在大厅导航主干、需真机复验，另开一单。

---

## 7. 新增业务功能时的动作清单

> **这一节是给 AI 和新人照着做的。做新需求前逐条走，别凭印象。**

1. **先分逻辑与表现**——把功能的状态和行为写进 `XxxVM.ts`，零 `cc` import。
2. **先写测试**（TDD）——路径 = 源文件路径把 `assets/` 换成 `test/`、补 `.test` 后缀（§5.2）。
3. **再写 `XxxView.ts`**——只做规则 B 的四件事。写到第五件就停下回第 1 步。
4. **要共享状态？**——不写 `export const` / `static instance`，注册进模块 DI scope（规则 C）。
5. **界面走 prefab**——首次创建用 `apps/demo/scripts/prefab-gen/`，改已有 prefab 走编辑器 / MCP（CLAUDE.md §多人协作）。
6. **跑门槛**——`pnpm test`、`pnpm lint`、`pnpm typecheck`。
7. **跑 smoke**——预览或真机，看 `[CCK-*]` 日志断言，覆盖 View + prefab + 装配这三块单测够不着的地方。
8. **回写文档**——更新 `docs/progress.md`；新模块按 CLAUDE.md 的新模块流程出模块文档。

### 提交前自检

- [ ] 有没有 `.test.ts` 落在 `assets/` 下？（会被打进游戏包并炸构建）
- [ ] 测试路径是否严格镜像源文件路径？（§5.2，否则门槛脚本查不到）
- [ ] VM 里有没有 `import 'cc'`？
- [ ] 有没有 `export const x = new …` / `static instance` / `getInstance()`？
- [ ] View 里有没有承载业务判断的 `if` / `switch` / 数值计算？
- [ ] 每个新增的 `*VM.ts` 是否都有同名测试文件？
- [ ] 新加的 lint 规则是否落在 `apps/<project>/eslint.config.js`，而不是被 ignore 的根配置？
- [ ] 有没有把 typecheck 通过 / 构建成功 / 预览起来了，说成「运行行为已验证」？

---

## 8. 证据边界（别声称测过没测过的东西）

写结论时按事实分级，这几条踩过：

- **typecheck 通过、构建成功、core 单测全绿** ≠ cc 薄壳运行时通过。
- **cc mock 下测试通过** ≠ 真 cc 行为正确（ADR-0002 决策 3 明确不 mock 引擎行为）。
- **编辑器 Game View 预览通过** ≠ Android 真机通过。
- **改了 `assets/` 脚本后 stop→play** ≠ 新代码已加载——预览 webview 可能仍持旧 import map，须先 `open_scene` 重开场景，并从**本次运行**的日志确认。
- **改了 `packages/engine` 后没 `pnpm build` + 切一次 browser 预览** → 预览跑的还是旧 dist（Creator 不监视 `node_modules/`）。

日志里没有本次运行的明确 PASS 证据，就不写「已验证」。

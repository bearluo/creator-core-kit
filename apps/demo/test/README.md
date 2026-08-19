# apps/demo 单测

**这里是 vitest 单测**，`assets/` 之外——Creator 编译 `assets/` 下所有 `.ts` 并打进游戏包，
`.test.ts` 放进去会被当游戏脚本，且 `import vitest` 直接炸构建。


## 放哪

**路径镜像 `assets/`**：`assets/<路径>/<Name>.ts` → `test/<路径>/<Name>.test.ts`，路径原样照抄。

```
assets/modules/mini-clicker/CounterVM.ts
  → test/modules/mini-clicker/CounterVM.test.ts
```

不用做决策，也让门槛脚本（`scripts/check-vm-tests.mjs`）退化成纯路径变换。

- 一个源文件一个测试文件，**不合并**。
- 跨模块公用的 fake / fixture 放 `_helpers/`（不匹配 `*.test.ts`，不会被当用例跑）。
- 模块自己的 fixture 就近放该模块目录下，别集中到全局 `fixtures/`。
- 现在**不分** `unit/` `integration/`——只有单测，真出现别的种类再分。

## 测什么

**测 VM，不测 View。** 业务逻辑按规则全在 VM（零 `cc`，node 直跑）；View 是薄壳，
只做「取组件 / 建绑定 / 转发事件 / 转发生命周期钩子」四件事，没有值得测的东西。

View + prefab + 装配由启动 smoke（预览 / 真机看 `[CCK-*]` 日志）兜底，不在这里。

## 跑

```bash
pnpm test                 # 全仓（packages + apps）
pnpm test:watch
pnpm check:vm-tests       # 每个 *VM.ts 是否都有对应测试
```

`@cck/core` 在 vitest 里被 alias 到 `packages/core/src`（源码直跑，改完 core 不用先 build）。

> 规则全文：[`docs/design/testing-strategy-overview.md`](../../../docs/design/testing-strategy-overview.md)
> ⚠️ 本目录目前**没有 typecheck**（`tsc -b` 走 project references，Cocos 工程不在其中），
> 只有 vitest 运行时能发现问题。

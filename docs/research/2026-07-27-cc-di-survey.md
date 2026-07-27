---
状态: 已定稿
摘要: 市面 Cocos/TS DI 方案横评（godot-core-kit / tsyringe / InversifyJS / oops-framework / typescript-ioc）+ 对 cck DI 设计的启示。
何时读: 评审/修订 di-container 设计、质疑 DI 技术选型时。
日期: 2026-07-27
依赖: packages/core/docs/modules/di-container.md；ADR-0001
---

# Cocos / TS 依赖注入方案横评

## 目的

DI 容器是第 1 批地基第一块、跨 bundle 健壮性基石。定稿前横向调研市面成熟方案，验证「层级作用域 + globalThis 根 + Symbol.for token + 显式无装饰器」的方向，吸收可借鉴处。

## 横评

| 方案 | 层级作用域 | token/key | 注入方式 | 生命周期 scope | 跨 bundle | 备注 |
|---|---|---|---|---|---|---|
| **godot-core-kit KitContext** | ✅ 沿**场景树**祖先链 | string | pull（`service(key)`） | singleton / transient | godot 无此问题 | 节点绑定、`subscribe` 时序、`provide_child` 管 Node 生命周期 |
| **tsyringe（微软）** | ✅ `createChildContainer` 父回退、子可覆盖 | class / string / **symbol** | 装饰器构造注入 + factory | transient / singleton / **resolution** / **container** | N/A | `clearInstances()`（清实例留注册）、`dispose()` 清 `Disposable`（含 async）、`delay()` 解循环依赖、Token Provider(alias) |
| **InversifyJS** | ✅ 容器层级 | **Symbol**（推荐） | 装饰器 + `reflect-metadata` | 多种 | N/A | 功能全但重，适合大型复杂依赖图 |
| **oops-framework**（主流 cc 框架） | ❌ **全局门面单例**（`oops.res/gui/audio/message`…） | 属性名/直接访问 | 直接全局访问 | 全局单例 | 未特殊处理 | 便利、上手快，但无作用域隔离、耦合全局 |
| **typescript-ioc** | 部分 | 装饰器 | `@Inject` + metadata | singleton 等 | N/A | 轻量注解式 |
| **Cocos 官方建议** | — | — | — | — | ✅ **暴露到全局命名空间** | 不同 bundle 脚本不应直接互引；共享须走全局 |

## 关键发现

1. **层级作用域是成熟范式，被 tsyringe/InversifyJS 背书**：`createChildContainer` = 子容器独立注册 + 未命中回退父 + 子层可 shadow —— 与本项目 `createScope` + 沿链 resolve 设计一致。godot-core-kit 同样走层级（但绑场景树）。→ **父子容器方向正确**。
2. **装饰器 / reflect-metadata 自动注入在 Cocos 有坑**：Cocos 3.3.x 曾报构造函数 `@` 装饰器 SyntaxError；且依赖 `reflect-metadata`、对 tree-shake 不友好。开发者用 inversify 需 `inversify-inject-decorators` + lazy inject 才能进 `cc.Component`。→ **本项目砍装饰器、用显式 `register/resolve` + factory 是对的**。
3. **token 用 symbol 是共识**：tsyringe/inversify 都推荐 symbol（避免 string 撞名、接口无运行时类型）。本项目用 `Symbol.for(name)` 在此之上**额外解决跨 bundle key 一致**（ADR-0001），更强。
4. **tsyringe 多两个 scope 值得记**：`ResolutionScoped`（单次解析链内同一实例）、`ContainerScoped`（每容器一实例，子容器拿新实例）——层级场景下 `ContainerScoped` 有用（如"每关卡一份"）。本项目首版 singleton/transient 够，列为 Open Question。
5. **Disposable + clearInstances 是标配**：tsyringe `dispose()` 清 `Disposable` 实例、`clearInstances()` 清实例留注册（测试用）。本项目已有 `dispose()`+`Disposable`、`reset()`（≈clearInstances），一致。
6. **主流框架偏全局门面单例（oops）**：便利但无作用域隔离、全局强耦合。本项目「全局根 + 层级作用域」是更进一步的设计；但门面访问的便利性受欢迎（godot `CoreKit.service`、oops `oops.audio`）→ 可为全局根提供便捷访问入口。
7. **跨 bundle 全局命名空间：官方 + 实证一致**（Cocos 文档 + ADR-0001）→ `globalThis` 根方向被官方背书。

## 对 cck DI 设计的启示

- **保持**：层级作用域（对标 tsyringe childContainer）✓；显式无装饰器 + factory ✓；`Symbol.for` typed token ✓；`Disposable` dispose + reset ✓；globalThis 根 ✓。方向与微软成熟库吻合，且针对 Cocos 跨 bundle 做了强化。
- **可补（列 Open Question，非首版必须）**：① `ContainerScoped` scope（每作用域一实例）；② Token Provider(alias，token→token 重定向)；③ 全局根便捷门面访问（如 `cck.resolve(token)` 糖）。
- **明确不做**：装饰器/reflect-metadata 自动装配（Cocos 坑 + tree-shake）；循环依赖 `delay()` 代理（YAGNI，需要再加）。

## Sources

- [microsoft/tsyringe](https://github.com/microsoft/tsyringe)
- [dgflash/oops-framework](https://github.com/dgflash/oops-framework)
- [Cocos Creator 3.8 Asset Bundle Manual](https://docs.cocos.com/creator/3.8/manual/en/asset/bundle.html)
- [awilix vs inversify vs tsyringe vs typedi](https://npm-compare.com/awilix,inversify,tsyringe,typedi)
- [thiagobustamante/typescript-ioc](https://github.com/thiagobustamante/typescript-ioc)
- [Cocos forum: inversify constructor injection SyntaxError](https://forum.cocosengine.org/t/need-help-on-using-inversifyjs-constructor-injection-syntaxerror/55391)

---
状态: 已接受
日期: 2026-07-31
依赖: packages/core/docs/modules/bundle-manager.md, packages/core/docs/modules/ui-manager.md, packages/core/docs/modules/app.md, docs/adr/0009-bundle-layering-criterion.md, docs/design/2026-07-31-app-layer-and-bundle-lifecycle-proposal.md
---

# ADR-0010：免重启换 bundle 代码 —— 清模块缓存 + 注销类，且只在版本真的变了时清

## 背景

**换代码 ≠ 换资源。** `bundle.releaseAll()` + `assetManager.removeBundle()` 把资源（prefab / json / 图集 / i18n）放得干干净净，再进模块时资源确实是新的——但**脚本模块和已注册的 cc 类都还在缓存里**，跑的仍是旧代码，**且没有任何报错**。

这个坑贵在它的伪装：改了 prefab 或配置会看到变化，于是判定「热更生效了」；改了脚本不会，而没有任何日志告诉你为什么。

本决策在真构建产物上实证：Cocos 3.8.7 web-mobile 构建（勾 MD5 Cache），v1 / v2 两份产物只差 `ShopView` 一行代码 → shop 的 md5 变了；把 v2 的 shop 目录拷进 v1 产物（文件名带 md5，新旧天然共存），挂本机静态服务，在**跑着的 v1 页面**上换版本重开商城。

## 决策

1. **让脚本失效必须同时清两处，缺一不可**：
   - 该 bundle 的**全部 module 记录**，从 `System[REGISTRY]`（唯一的 symbol 键）**和** `System.registerRegistry`（普通实例属性）**两张表**里 `delete`；
   - 该 bundle 注册的 **cc 类**，`js.unregisterClass(...)`。
2. **module id 的枚举方式**：入口 chunk 是 `chunks:///_virtual/<bundle>`，它的 `.d`（依赖 load 记录）就是本 bundle 的全部脚本模块；待注销的类从每个 dep 的 **namespace** 里取导出的函数。`virtual:///prerequisite-imports/<bundle>` 是 cc 实际 import 的入口，但依赖方向是「它 → 入口 chunk」，顺 `.d` 到不了 → **按名字单独删**。
3. **只在版本真的变了时清**。web 由 `IBundleSource.loadBundle` 比对上次版本自动触发；native 由调用方热更落盘后显式调 `IBundleReloader.invalidate(bundle)`。
4. **销毁存活实例是正确性要求**，落成 `BundleScope.dispose()` 的第一步 `UIManager.closeByBundle(bundle)`。
5. **取不到内部结构就返回 `false`**（退化成「需重启」），逐层 feature-detect，不抛异常。

## 理由

### 为什么两张表缺一不可

| 只清哪个 | 症状 |
|---|---|
| 只清 module 记录，不注销类 | 新模块求值了，但 `js.setClassName` 撞名**不覆盖** `_registeredClassIds`，而 prefab 是按 **classId** 反序列化的 → 拿到旧类，表现为「类换了、界面没换」 |
| 只注销类，不清 module 记录 | `System.import` 命中缓存的 load 记录，declare 不再执行，类**永远回不来** → prefab 反序列化报 `Can not find class`，组件被**静默丢弃**（比不清更糟） |

`registerRegistry` 的条目被 `instantiate` 用过后会置 `null`，残留的 `null` 仍满足 `in` 判断 → 必须 `delete`，不能置空。

### 为什么「版本没变时绝不能清」

cc 的 `downloadScript` 按 **URL** 缓存已下载脚本（引擎内模块私有的 `downloaded[url]`，外部够不到），同 URL 再加载**连 `<script>` 都不再插**。所以版本没变就清缓存 = 那段代码再也执行不到，下次 `System.import` 两张表全落空、加载直接失败。native 没有这层 DOM 脚本缓存，可以无条件清。

→ md5 的作用有三个：让新旧版本文件共存、绕开 HTTP 缓存、**给「版本变了」一个可判断的信号**。

### 为什么 web 自动、native 显式

| | web / H5 | native |
|---|---|---|
| 新代码怎么到达 | `index.<新md5>.js`，**换了 URL** | 路径不变，靠 `searchPaths` 前置 |
| 自动判定可行吗 | 可行——版本变了就是信号 | **不可行**：原地覆盖同名文件，版本号看不出变化 |

这正是 `IBundleReloader` 存在的唯一理由。web 路径用不上它（`loadBundle` 自动清），删掉它 native 就没有出路。

### 为什么销毁实例是正确性问题

两条独立理由指向同一个契约：换代码后旧类的实例成孤儿，`getComponent(新类)` 找不到；且就算完全不换代码，`release(bundle)` 卸掉 prefab / 纹理之后，还挂在场景里的界面就在用已卸资源。

## 实测结果（web-mobile 真构建产物，2026-07-31）

| 做法 | 结果 |
|---|---|
| 退出模块 → 换 version → 再进（什么都不清） | 新 `index.<md5>.js` **下载并执行了**，但 `getClassByName` 仍是同一个类对象，界面还是旧文案 ❌ |
| 同上 + 只删 module id | 类对象换了，界面**还是旧文案**（classId 仍被旧类占着）❌ |
| 同上 + `unregisterClass(旧类)` | 新文案出现，0 报错，**整页未重载** ✅ |
| 接线后：只调 `setVersions()`，清缓存由 `loadBundle` 自动做 | 新文案出现、`classSwapped: true`、0 报错 ✅ |
| 版本不变、连续进出两轮 | 每次都正常打开（没有误清缓存）✅ |

## 后果

- **勾 MD5 Cache 是 web 侧的前置构建约束**。不勾则文件名恒为 `index.js`，新旧无法共存、缓存拦不住、也判断不出「版本变了」；踩了**没有任何报错**，只是拿到旧代码。
- 实现踩的是 SystemJS 与 CCClass 的**私有内部结构**，升引擎版本时属重点回归项。namespace 字段就已知在版本间漂移过（3.8.7 web 产物是 `.n`，另一些版本在 `.C`）——实现按**形状**挑（排除 thenable），不按字段名赌，否则会**静默**拿到空导出、一个类都注销不掉。
- 类表撞 uuid（复制 prefab / 脚本忘改 meta）时，后加载的会**无声覆盖**先加载的，没有任何警告。本机制放大了这个已有风险的可见后果。
- 小游戏平台未验证；`invalidate` 取不到结构会返回 `false`，调用方按「需重启」处理。
- 旧 md5 那份 `<script>` 文本留在引擎私有的 URL 缓存里（够不到），但无引用可达、不构成泄漏，本版不处理。

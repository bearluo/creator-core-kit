# apps/fish-editor —— 鱼阵编辑器

**状态**：已实现（2026-09-02）
**摘要**：捕鱼的路径与鱼阵内容工具。纯 web 内部工具，**不进任何游戏包**；跟游戏共用的是逻辑，不是宿主。
**何时读**：要改鱼阵 / 路径内容，或要改这个工具本身之前。
**依赖**：[`ADR-0020`](../../docs/adr/0020-internal-tools-in-html.md)（为什么用 HTML 不用 Cocos）、[`2026-08-31-mini-fish-content-editor.md`](../../docs/design/2026-08-31-mini-fish-content-editor.md)（编辑器设计）

---

## 跑

```bash
pnpm editor          # http://localhost:5174
```

不用 `pnpm install`，也不用先 build kit —— 别名直接指向源码。

## 用

1. **路径页**：拖控制点改形状。拖锚点两侧手柄跟着走；拖手柄对面自动镜像，按住 `Alt` 打断（故意折角）。
   折角会画成红方块并在右栏点名度数。空格 / 中键拖 = 平移，滚轮 = 缩放（光标底下那点不动）。
2. **鱼阵页**：编一阵里有几队、每队走哪条路、什么鱼、几条、间隔、速度。走带能播能拖能单步 ——
   **跑的是游戏本体的 `FishVM`**，不是仿的。
3. **导出**：点「⧉ 复制 content.ts 全文」→ 覆盖
   `apps/demo/assets/modules/mini-fish/content/content.ts` → `git diff` 看改了什么。
   剪贴板在非安全上下文用不了时，页面底部那个只读框里是同一份全文，全选手动复制。
4. **草稿**：`localStorage`。有草稿只**提示**不自动恢复 —— 怕拿旧草稿盖掉别人贴回 `content.ts` 的内容。

`rev` 只在**导出**时 +1，编辑过程不动它。

## 它跟游戏共用什么

| 要什么 | 从哪来 |
|---|---|
| 编的是什么（草稿 / 拖点 / 分段 / 导出 / 落盘） | `src/EditorVM.ts`（零 `cc`，node 直跑，32 条测试） |
| 路径求值、真弧长恒速 | `@game/content/paths` |
| 鱼阵怎么放、鱼怎么走、什么时候离场 | `@game/FishVM` —— **游戏本体那个** |
| 帧号、朝向、场地怎么裁 | `@game/render-map` —— 游戏 View 读的是同一份 |
| 鱼长什么样 | `@game/art/textures.{png,plist}` —— 同一张图集、同一帧、同一尺寸 |

`@game` = `apps/demo/assets/modules/mini-fish`。**能这么直接吃是因为那些模块零 `cc`** ——
整棵树里 `import 'cc'` 的只有 `FishGame.ts` 一个（游戏 View）。

**别在这儿重写上表里的任何一行。** 恒速 / 朝向 / 离场各有两份实现的话迟早漂，而漂的那天
你信的是编辑器、错的是游戏。

进不了 DOM 的只有渲染管线本身：水面后处理、海底、命中闪白 —— 这三样编辑器本来就不显示
（它们妨碍看控制点）。

## 「可见区」那个按钮

游戏的场地缩放是 **cover**（`Math.max`），窄屏会把 `FIELD` 上下裁掉。点「▣ 可见区」叠一圈虚线：
**1440 × 864**，4:3 ~ 20:9 都看得见。摆在它外面的鱼，在某些比例的手机上进不了画面。

## 目录

```
index.html        外壳（DOM 结构就是原来那份可交互原型）
src/style.css     单一深色主题（内部工具，不跟 demo 的明亮卡通基线）
src/main.ts       View：DOM + canvas，逻辑一行都不在这儿
src/EditorVM.ts   逻辑层，零 cc
src/atlas.ts      TexturePacker plist 解析 + 画一帧（DOM 侧唯一要补的东西）
test/             镜像测试，跟仓库根 `pnpm test` 一起跑
```

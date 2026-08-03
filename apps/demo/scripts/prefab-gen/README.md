# prefab-gen —— 描述 JSON → `.prefab`

约定是「UI 一律走 prefab」，但**首次创建**手点效率低、也不可复现。于是：描述用 JSON 版本化，
建树 + 落盘交给 `build-prefab.js`。**改已有 prefab 走编辑器 / MCP**，别重跑脚本覆盖别人的编辑。

## 三步

1. **出描述** —— 手写，或把下面的提示词丢给 ChatGPT / 别的模型让它出（见「让模型出界面」）。存成 `<名字>.prefab.json`。
2. **生成** —— funplay MCP：
   ```
   execute_scene_script({ code: <build-prefab.js 全文>, args: <描述 JSON> })
   ```
   多个一起生成：`args = { specs: [描述1, 描述2] }`。
   ⚠️ 跑完**别保存当前场景**（`create-prefab` 留的临时节点要下一帧才销毁，此时 save 会把它写进场景文件）。保险做法是重新 `open_scene` 丢掉内存改动。
3. **绑上去** —— 在场景里把 prefab 拖到对应组件的 `@property(Prefab)` 上。手改场景 JSON 时引用必须是
   `{"__uuid__": "…", "__expectedType__": "cc.Prefab"}`；写成 `{"uuid": "…"}` 会反序列化成普通对象，
   运行时报 `child.setParent is not a function`。

## 让模型出界面

模型对本仓一无所知，所以提示词必须自带 schema + 可用资源 + 坐标系 + 节点契约。整段复制下面的内容，
**只改「本次需求」一节**，其余原样：

````markdown
你是 Cocos Creator 3.8 的 UI 设计师。请输出一份 JSON 界面描述，我会用它生成 `.prefab`。

## 输出要求
只输出**一个 JSON 对象**，用 ```json 代码块包住，不要任何解释文字。

## Schema（只支持这些字段，多余字段会被忽略）
```
{ url: string, root: Node }

Node = {
  name: string,                       // 必填
  pos?: [x, y],                       // 相对父节点，默认 [0,0]
  size?: [w, h],
  anchor?: [x, y],                    // 默认 [0.5, 0.5]
  active?: boolean,                   // 默认 true
  label?: {
    string?: string, fontSize?: number, lineHeight?: number,
    color?: [r, g, b, a?],            // 0..255，a 默认 255
    align?: "left" | "center" | "right"
  },
  sprite?: {
    frame: string,                    // 只能用下面「可用贴图」里的 uuid
    type?: "simple" | "sliced" | "filled",
    fill?: "horizontal" | "vertical", // 仅 filled
    fillStart?: 0..1, fillRange?: 0..1,
    color?: [r, g, b, a?],
    sizeMode?: "custom" | "trimmed" | "raw"   // 默认 custom（尺寸听 size 的）
  },
  children?: Node[]
}
```

## 可用贴图（只有这两个，**不要发明 uuid**）
| 用途 | uuid | 说明 |
|---|---|---|
| 纯色矩形 | `7d8f9b89-4fd1-4c9f-a3ab-38ec7cded7ca@f9941` | 内置纯白图，配 `color` 染成任意颜色；`color` 第四位是 alpha，可做半透明 |
| 圆角底板 / 按钮底 | `20835ba4-6145-4fbc-a58a-051ce700aa3e@f9941` | 内置九宫格圆角图，**必须 `type: "sliced"`**，可染色 |

## 硬约束
- **没有**：位图 / 图标 / 渐变 / 阴影 / 描边 / 自定义字体 / 动画 / 遮罩，也**没有** `Layout` `Widget` `Button` `Mask` 组件。能用的只有 `Label` + `Sprite` + 尺寸锚点。想要层次感就用多个半透明色块叠。
- 坐标系：**原点在屏幕中心，y 轴向上**。设计分辨率 **1080 × 1920（竖屏）**，内容请控制在 x ∈ [-480, 480]、y ∈ [-820, 820]。
- 渲染顺序 = `children` 数组顺序，**后面的盖前面的**。底板要放在同级第一个。
- 子节点可以超出父节点尺寸，不会被裁剪。
- 中文文案直接写中文。

## 节点契约（**名字和层级路径一个字都不能改**，代码按路径取组件）
| 路径 | 要求 |
|---|---|
| `Status` | 有 `label`。运行时被改写成「初始化…」「下载更新 87%」「网络异常，启动失败」等，**文字颜色运行时会被覆盖**（正常灰蓝 / 失败红），所以配色别依赖它 |
| `Hint` | 有 `label`。副提示，常态为空串，失败时填一行说明 |
| `Bar/Fill` | 必须 `sprite.type = "filled"`、`fill = "horizontal"`、`fillStart = 0`、`fillRange = 0`（代码推进度），并且 `anchor = [0, 0.5]` 且 `pos` 落在进度条左端，让它从左往右长 |
| `Action` | 必须 `active: false`（只在失败时显形） |
| `Action/Label` | 有 `label`。文案运行时按失败类型改成「重试」/「前往应用商店」/「重启应用」 |

除以上五个，其余节点随便加、随便命名，但**只能是静态装饰**——代码不会碰它们。
根节点固定叫 `LaunchOverlay`，`url` 固定 `"db://assets/scenes/LaunchOverlay.prefab"`。

## 本次需求
这是一个手游的**启动 / 热更界面**，全屏常驻，用户在这儿等着下载更新和加载资源。要有：
应用标题、一句状态文案、一行副提示、一条进度条、一个失败时才出现的操作按钮。
风格与配色照 `apps/demo/docs/ui-style-guide.md`（明亮休闲卡通，蓝天草地基调）。

## 自检（输出前逐条核对）
1. 五个契约路径全在，名字层级完全一致？
2. 所有 `sprite.frame` 都是上表两个 uuid 之一？
3. `Bar/Fill` 的 `type` / `fill` / `fillRange:0` / `anchor:[0,0.5]` / 左端 `pos` 都对？
4. `Action` 是 `active: false`？
5. 只有 JSON，没有多余文字？
````

拿到 JSON 后存进本目录，走上面第 2、3 步。生成完记得看一眼预览：层没设对（脚本已统一置 `UI_2D`）
或者尺寸算错，表现都是**整个界面不可见且无报错**。

# Spine VAT Analyzer

状态：已实现（正文待按现状修订）
摘要：Analyzer：Spine 资源静态分析与逐帧 dry-run，输出兼容性、Render Lane 与 GPU 数据量估算。
何时读：改 Analyzer 或排查资源为什么不适合 VAT 时。
依赖：[工具设计](spine-vat-tool-design.md)

> 待更新：正文部分内容（三角形汤、V1 渲染器、旧入口与路径）仍是早期实现，尚未按现状修订；数据格式与两个组件的现状以 [spine-vat-overview.md](spine-vat-overview.md) 为准。

> 目标：在正式烘焙前，用 Cocos Creator 3.8.7 内置 Spine 4.2 Runtime 对资源做静态分析和逐帧 dry-run，输出是否适合 VAT、预计 Render Lane 和 GPU 数据量。

## 已实现

- 解析 Spine JSON、atlas page 和 `pma` 声明；
- 统计 bone、slot、skin、animation、attachment、weighted mesh、sequence 和四类 constraint；
- 检测 deform、attachment、draw order、event、two-color timeline 和 slot blend mode；
- 使用原始 SkeletonData 创建 REALTIME `sp.Skeleton`，固定步长调用 Runtime；
- 从 `updateRenderData()` 读取裁剪后的最终顶点、索引、有序纹理和 blend segment；
- 检测顶点布局、索引和材质序列是否稳定；
- 为变化拓扑生成公共 Render Lane 超序列和每 lane 最大容量；
- 检测 UV 是否静态、light 是否恒白、dark 是否全零；
- 估算 `indexed-stable` / `triangle-soup-dynamic` 的纹理、静态 mesh、纹理分页和 Draw Call；
- 输出 `LOSSLESS_VAT`、`BAKED_VARIANT`、`HYBRID` 或 `RUNTIME_FALLBACK`；
- 对 alpha mode、Spine worker、Lane 数和 GPU 字节预算执行硬阻断。

核心文件：

- `assets/scripts/SpineVatTypes.ts`：`spine-vat-2` 和 Analyzer 数据契约；
- `assets/scripts/SpineVatAnalyzerCore.ts`：可脱离 Creator 单测的静态分析、Render Lane 和预算算法；
- `assets/scripts/SpineVatAnalyzer.ts`：Creator Web/WASM Runtime dry-run；
- `test/SpineVatAnalyzerCore.test.ts`：真实资源与 Render Lane 算法测试。

## Web 使用

先构建并启动静态服务器：

```powershell
node tools/static-server.mjs build/web-tuan42 18088 assets/reports/tuan42
```

打开：

```text
http://127.0.0.1:18088/?vatAnalyze=1&pma=straight&analyzeFps=30&vatProfile=balanced
```

参数：

| 参数 | 含义 |
| --- | --- |
| `vatAnalyze=1` | 启动全动画分析，不进入正常压力测试 |
| `pma=straight` | 明确使用非预乘；也支持 `premultiplied`、`0`、`1` |
| `analyzeFps=30` | dry-run 采样率，默认 60 |
| `vatProfile=balanced` | `exact`、`balanced` 或 `compact` |

结果发布到：

```js
window.__SPINE_VAT_ANALYSIS__
```

如果静态服务器配置了第四个输出目录，可调用：

```js
await window.__SPINE_VAT_ANALYSIS_EXPORT__();
```

生成 `analysis.json`。报告含源数据 hash、recipe、静态特征、逐动画拓扑、Lane、字节估算、兼容等级和具体警告。

## 当前资源实测

以下结果来自 Creator 3.8.7 Web/WASM，均显式指定 `straight`、30 FPS、`balanced`：

| 资源 | 动画 | 拓扑 | Lane | 预计 GPU 数据 | 结论 |
| --- | ---: | --- | ---: | ---: | --- |
| `tuan42` | 1 | dynamic triangle soup | 2 | 971,082 B | `LOSSLESS_VAT` |
| 水果机男舞者 | 3 | dynamic triangle soup | 每动画 4 | 6,544,344 B | `LOSSLESS_VAT` |

`tuan42` 的 clipping 让 60 个采样帧中 59 帧相对首帧发生拓扑变化，但最终只需要 normal/additive 两个 Lane。水果机原始 SkeletonData 也包含 clipping；三个动画各为 60 帧，预计纹理分别为 1,851,120、2,278,800、2,289,600 字节，dark 通道全零，可以省略。

这里的 `LOSSLESS_VAT` 表示“原始 Runtime 最终几何可以在当前 recipe 和预算内编译”，不代表已经完成像素差验收。M2 仍必须生成产物并与官方 Runtime 做同帧截图、透明边缘和四种 blend 对照。

## M1 边界

- 仅 4.2 worker 允许进入 VAT；3.8 会明确输出 `RUNTIME_FALLBACK`，等待独立 worker；
- 静态分析目前要求 JSON SkeletonData，binary 反射未实现；
- dry-run 只运行在 Creator Web/WASM，Native 负责加载结果，不负责烘焙；
- 多 skin 目前只列出并标记 `BAKED_VARIANT`，尚未逐 skin 组合采样；
- event 只标记为 `HYBRID`，事件表和 socket 轨道在 M3 实现；
- Physics warm-up、预定义多轨 mix 和 transition recipe 尚未接入；
- `estimatedGpuBytes` 是构建前保守估算，最终值以 M2 分页、量化和 layout 去重后的 manifest 为准。

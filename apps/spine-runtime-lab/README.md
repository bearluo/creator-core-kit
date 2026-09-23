# Spine Runtime Lab（Cocos Creator 3.8.7）

该工程用于验证 Cocos Creator 3.8.7 中 Spine 的运行时内存、缓存模式、2D 合批，以及受限功能集下的 VAT + GPU Instancing 方案。目标场景是水果机大厅同屏约 20 个入口。

## 场景

- `assets/scenes/main.scene`：Spine 3.8 `spineboy-pro` 基线。
- `assets/scenes/main42.scene`：用户提供的 Spine 4.2.43 `tuan` 复杂资源，测试官方 `REALTIME` / `SHARED_CACHE`。
- `assets/scenes/fruit-machine-vat.scene`：水果机通用 VAT v2/M3，验证 20 个实例的独立动画、相位、速度、暂停、颜色和 GPU Instancing。

`cacheMode`：`0=REALTIME`、`1=SHARED_CACHE`、`2=PRIVATE_CACHE`。多个实例共享同一份 `SkeletonData`。

## 运行与构建

1. 使用 Cocos Creator 3.8.7 打开本目录。
2. 选择对应场景预览，或使用 `build-configs` 下的配置构建。
3. Android AVD、构建和采集脚本位于 `tools/`。

Web 构建后可启动本地服务：

```powershell
node tools/static-server.mjs build/web-tuan42 18088
```

独立 Spine VAT 转换工作台：

```powershell
powershell -ExecutionPolicy Bypass -File tools/build-vat-workbench.ps1
node tools/static-server.mjs build/web-vat-workbench 18120
```

打开 `http://127.0.0.1:18120/`，拖入 Spine 4.2 JSON、atlas 和全部纹理页即可分析、双预览并下载可拖入 Creator `assets/resources/` 的资源包。完整说明见 [Spine VAT Web 转换工作台](docs/spine-vat-workbench.md)。

页面中的“下载 CC 组件”会提供 `spine-vat-runtime.zip`，其中包含完整的 `spine-vat-importer` 扩展。安装扩展后使用新的 `spinevat.SkeletonData` 和 `spinevat.Skeleton`；不再向项目复制旧 `SpineVatComponent`，也不提供旧类兼容层。

浏览器参数示例：

```text
/?count=20&mode=realtime&batch=1
/?count=20&mode=shared&batch=1
/?vat=1&count=20
/?vatAnalyze=1&pma=straight&analyzeFps=30&vatProfile=balanced
/?vat2=1&count=20&pma=straight&analyzeFps=30
/?vat2=1&count=20&pma=straight&analyzeFps=30&independent=1
/?vat2=1&count=1&compare=1&pma=straight&analyzeFps=30
```

Analyzer 完成后可从 `window.__SPINE_VAT_ANALYSIS__` 读取报告；静态服务器配置输出目录后，调用 `window.__SPINE_VAT_ANALYSIS_EXPORT__()` 可写出 `analysis.json`。

VAT v2 完成后可使用：

```js
window.__SPINE_VAT_V2__                 // manifest 与纹理页内存数据
window.__SPINE_VAT_V2_READY__           // clip、Lane、字节和实例数摘要
window.__SPINE_VAT_V2_SET_CLIP__(name)  // 切换已烘焙动画
window.__SPINE_VAT_V2_SET_FRAME__(15)   // 固定到第 15 帧，null 恢复自动播放
window.__SPINE_VAT_V2_STATES__()        // 读取全部实例当前播放状态
window.__SPINE_VAT_V2_PLAY__(0, name, { loop: true, speed: 1.2, startTime: 0.5 })
window.__SPINE_VAT_V2_PAUSE__(0)
window.__SPINE_VAT_V2_RESUME__(0)
window.__SPINE_VAT_V2_SEEK__(0, 0.8)
window.__SPINE_VAT_V2_LOOP__(0, false)
window.__SPINE_VAT_V2_COLOR__(0, 1, 0.8, 0.7, 1)
window.__SPINE_VAT_V2_ON_EVENT__(0, event => console.log(event))
window.__SPINE_VAT_V2_SOCKET__(0, 'r1_lian')
window.__SPINE_VAT_V2_EXPORT__()        // 导出 manifest.spinevat 与各语义 bin
```

通用 VAT v2/M3 x86_64 验证包：

```powershell
powershell -File tools/build-android.ps1 -Profile low -Asset fruitvat42 -Abi x86_64 -AllowExistingEditor
```

## 当前结论

- 官方 `SHARED_CACHE + enableBatch=true` 是约 20 个大厅入口的默认方案。
- `SHARED_CACHE` 按动画名、按实际采样帧懒创建缓存，不会在启动时按“全部动画中的最大帧”一次性为每个实例预分配。
- 官方 `sp.Skeleton` 的 `enableBatch` 是 2D middleware 合批，不是 GPU Instancing。
- Native VAT 必须使用 Web/WASM 离线烘焙数据；Android Native 的 `updateRenderData()` 不返回 Web 烘焙所依赖的 WASM 顶点指针。
- 通用 VAT v2/M3 已在 Web 和 Android Native 模拟器跑通：20 个逻辑实例、3 个动画、4 个 Lane 保持 80 GPU Instances 和 8 Draw Call，暂停实例保持原帧、其余实例独立推进。模拟器为 SwiftShader，只证明 JSB/GLES 功能链路，不代表 ARM64 真机性能。
- HYBRID event/socket 已进入播放器：事件表不保留 Spine Runtime，指定 socket 按 VAT 帧读取完整 2D 仿射矩阵；`r1_lian` 已通过 Web 和 Native 动态变化回归，且不增加 Draw Call。当前 socket 放在 manifest JSON，正式多挂点版本仍需二进制压缩。
- 两台 OPPO 实体机均证明：VAT 可将 20 个复杂实例从 `SHARED_CACHE` 的约 54-55 FPS 提到稳定 60 FPS，30 实例时缓存路径约 39-42 FPS、VAT 仍约 60 FPS；平均 Draw Call 从约 23/32 降至固定 6。CPU 收益依设备不同，K9x 约下降 58%，CPH2823 约下降 14%，不能跨设备外推。VAT 已具备复杂固定拓扑资源的专项立项依据，但仍需用真实大厅资源验证功能、纹理总量、功耗和温升后再决定上线。

详细资料：

- [Spine Runtime 与 VAT 验证汇总报告（建议先读）](docs/spine-runtime-vat-summary-report.md)
- [Spine 播放与缓存的源码级内存流程](docs/spine-runtime-memory-flow.md)
- [Android 模拟器与实体机完整测试](docs/android-test-results.md)
- [Web 对照测试](docs/spine-vat-web-results.md)
- [VAT 上线决策](docs/spine-vat-decision.md)
- [通用 Spine 转 VAT 工具设计](docs/general-spine-vat-tool-design.md)
- [Spine VAT Web 转换工作台](docs/spine-vat-workbench.md)
- [Spine VAT Analyzer M1 使用与实测](docs/spine-vat-analyzer-m1.md)
- [Spine VAT Compiler/Renderer M2 使用与实测](docs/spine-vat-compiler-m2.md)
- [Spine VAT Player M3 每实例播放与 Web 实测](docs/spine-vat-player-m3.md)
- [测试配置与采集口径](docs/performance-test-plan.md)

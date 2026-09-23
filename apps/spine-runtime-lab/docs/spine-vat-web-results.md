# Cocos Creator 3.8.7 Spine VAT Web 对照结果

## 1. 环境与口径

- 构建：Creator 3.8.7 `web-mobile`，最终重建包 `build/web-tuan42`。
- 浏览器：Docker Headless Chromium 149。
- GPU：软件渲染环境，不代表桌面浏览器或手机 GPU 的绝对性能。
- 资源：Spine 4.2.43 `tuan`，同一份 SkeletonData、同一段 2 秒动画。
- 参数：`enableBatch=true`；VAT 为两个渲染组。
- 指标：引擎 5 秒滚动窗口 FPS、P50/P95、峰值 Draw Call、GPU Instances。

Web 软件 GPU 的绝对 FPS 很低，只能用于确认路径是否工作和观察相对趋势。

## 2. 最终重建包结果

| 实例数 | 模式 | FPS | P50 | P95 | 峰值 Draw Call | GPU Instances |
| ---: | --- | ---: | ---: | ---: | ---: | ---: |
| 20 | `REALTIME` | 4.72 | 200.5 ms | 297.0 ms | 44 | 0 |
| 20 | `SHARED_CACHE` | 4.85 | 200.4 ms | 294.5 ms | 44 | 0 |
| 20 | VAT | 9.09 | 101.2 ms | 192.3 ms | 6 | 40 |
| 30 | `REALTIME` | 3.55 | 297.8 ms | 393.8 ms | 64 | 0 |
| 30 | `SHARED_CACHE` | 3.45 | 298.4 ms | 386.2 ms | 64 | 0 |
| 30 | VAT | 6.72 | 112.0 ms | 200.1 ms | 6 | 60 |

## 3. 解释

- VAT 在该软件渲染环境中约为官方路径的 1.9 倍 FPS，并把 Draw Call 固定在 6。
- `REALTIME` 与 `SHARED_CACHE` 接近，说明该环境主要受软件光栅化/提交限制，不能据此否定缓存对真实 CPU 的作用。
- Web 结果证明离线烘焙、VAT 纹理、两个 blend 组和 GPU Instancing 路径可运行；它不能证明 Android 真机一定更快。
- Web 与 Android 必须分开决策：Web 可把 VAT 作为特定渠道的降级/加速路径，Android 仍以目标真机结果为准。

## 4. 复现

```powershell
node tools/static-server.mjs build/web-tuan42 18088
```

```text
http://127.0.0.1:18088/?count=20&mode=realtime&batch=1
http://127.0.0.1:18088/?count=20&mode=shared&batch=1
http://127.0.0.1:18088/?vat=1&count=20
```

若浏览器运行在 Docker 中，可把第五个参数设为 `0.0.0.0`，再通过 `host.docker.internal` 访问；默认仍只监听 `127.0.0.1`。


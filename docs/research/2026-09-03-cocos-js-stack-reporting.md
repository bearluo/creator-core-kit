---
状态: 已定稿（纯调研，未改任何代码）
摘要: 查清 Cocos Creator 3.8.7 原生包把 JS 未捕获异常送出去时，那个 `stack` 到底长什么样、release 下还读不读得懂、两家崩溃平台会不会帮你还原、以及热更之后怎么把堆栈对回某一版产物。结论：**平台一家都不还原 JS**；可读性只能由我们自己在上报前或事后拿归档产物解决，而本仓 `md5Cache: true` 让每一帧的文件名自带内容指纹，恰好把「对哪一版」这件事变成零成本。
何时读: 要接崩溃上报（Bugly / CrashSight / Firebase Crashlytics）、要决定 release 包开不开 `debug` / `sourceMaps`、或者后台已经收到一堆看不懂的 JS 堆栈时。
日期: 2026-09-03
依赖: docs/research/2026-09-03-cocos-native-android-template.md（改哪些原生文件不会被吃掉 · JS↔Java 三条路）、apps/demo/docs/hotupdate-pipeline.md（三档更新代价与两枚版本戳）、apps/demo/build-configs/README.md（固化构建配置）、docs/adr/0017-base-hotupdate-via-fixed-name-pointer.md
---

# Cocos 3.8 原生包上报 JS 异常：那条 stack 人看得懂吗

## 结论先行

| 问题 | 答案 | 可信度 |
|---|---|---|
| `handleException` 的 `stack` 是什么 | V8 的 `error.stack` 原文（`TypeError: …\n at fn (src/chunks/bundle.<md5>.js:8123:15)`），**不是**引擎自己那套 ` - [0]fn@…` 格式 | 引擎源码实证 |
| 覆盖哪些异常 | 未捕获异常 **+ 未处理的 Promise rejection**（每帧结算一次）。**不覆盖** V8 fatal / OOM —— 那两条的 `stack` 恒为字面量 `"(no stack information)"` | 引擎源码实证 |
| 帧数上限 | `error.stack` 受 JS 侧 `Error.stackTraceLimit` 管（V8 默认 **10** 帧，引擎与本仓都没改过）。C++ 那个 `JSB_STACK_FRAME_LIMIT = 20` 管的是另一条路，管不到这里 | 引擎源码实证 |
| `debug: true` 的产物（**本仓当前两份构建配置都是这个**） | 不压缩、不混淆、标识符原样。堆栈里的 `bundle.<md5>.js:8123:15` **拿归档产物一开就能读** | 仓内实测 |
| `debug: false` 的产物 | 压缩混淆。整份 chunk 塌成 10 行、单行 5 万字符，函数名变 `ze`/`je`。堆栈退化成「文件 + 行 + 列」，**没有 sourcemap 就是天书** | 仓内实测 |
| Firebase Crashlytics 能不能还原 JS | **不能**。deobfuscation 只吃 ProGuard 兼容的 mapping（ProGuard / R8 / DexGuard）与 NDK 符号表，JS sourcemap 没有任何上传入口 | 官方文档明确 |
| Bugly / CrashSight 能不能还原 JS | **不能**。`postException(5, …)` 的 category 5 就是「Cocos JS」，但后台只把 `stack` 当字符串存；符号表配置只有 Android mapping 与 native so，没有 sourcemap | 官方文档明确 |
| 那还原发生在哪 | 只有两个位置：**上报之前**（客户端/网关自己查 sourcemap，不现实，见 §3.3）或**上报之后**（拿归档 `.map` 离线还原）。中间没有第三种 | 文档推断 |
| 热更之后怎么对上版本 | **不用额外字段** —— 堆栈每一帧的文件名自带 md5（`md5Cache: true`），逐帧自证是哪一份产物。反过来讲，「一个全局 release 号」在本仓是**错的**：base 与分包各自独立更新，同一条堆栈的不同帧完全可能来自不同版次 | 引擎源码实证 + 仓内实测 |
| 终点要不要改 | **不推翻，但必须加限定并补一个环节**。见 §7 | — |

---

## 零、这次的证据等级

沿用上一份的标注：**官方文档明确** / **引擎源码实证** / **仓内实测** / **文档推断** / **待实测**。

「引擎源码实证」这一档的出处（本机 `<Creator>` = `C:/ProgramData/cocos/editors/Creator/3.8.7/resources`）：

```
<Creator>/resources/3d/engine/native/cocos/application/CocosApplication.{h,cpp}
<Creator>/resources/3d/engine/native/cocos/bindings/jswrapper/v8/ScriptEngine.cpp   ← Android 走这一份
<Creator>/resources/3d/engine/native/cocos/engine/Engine.cpp
```

「仓内实测」的出处是主 worktree 里已有的三份真产物（`native/` 与 `build/` 都不入库，各 worktree 各一份）：

```
E:/work/creator-core-kit/apps/demo/build/android/data/   debug:true  · md5Cache:true · 2026-08-31
E:/work/creator-core-kit/apps/demo/build/web-mobile/     debug:true  · md5Cache:true
E:/work/creator-core-kit/apps/demo/build/v1/             debug:false（压缩混淆）· 2026-07-31 的老 web 产物
```

最后那份是这次调研的关键标本：**仓里恰好留着一份 release 模式的产物**，不用真跑一次构建就能看到压缩后的堆栈会变成什么样。

---

## 一、`stack` 从哪来、长什么样

### 1.1 调用链（引擎源码实证）

```
V8 未捕获异常  ──> Isolate::AddMessageListener
                     └─ ScriptEngine::onMessageCallback                ScriptEngine.cpp:319
未处理 rejection ──> Isolate::SetPromiseRejectCallback → 攒进 _unhandledPromises
                     └─ Engine::tick 每帧 handlePromiseExceptions()    Engine.cpp:316
                          └─ handleUnhandledPromiseRejections          ScriptEngine.cpp:1202
                                          ↓ 两条都汇到
                     ScriptEngine::reportException(isolate, message, exceptionObj)   ScriptEngine.cpp:1078
                                          ↓
                     ├─ callExceptionCallback(location, message, stack)   ScriptEngine.cpp:273
                     │    ├─ _nativeExceptionCallback → CocosApplication::handleException   ← C++ 出口
                     │    └─ _jsExceptionCallback（引擎自己没用）
                     └─ globalThis.__errorHandler(location, linenum, message, stack)  ScriptEngine.cpp:1159  ← JS 出口
```

绑定在 `CocosApplication.cpp:86`：

```cpp
se->setExceptionCallback(
    std::bind(&CocosApplication::handleException, this,
              std::placeholders::_1, std::placeholders::_2, std::placeholders::_3));
```

默认实现（`CocosApplication.cpp:171`，注释是官方留的）：

```cpp
void CocosApplication::handleException(const char *location, const char *message, const char *stack) {
    // Send exception information to server like Tencent Bugly.
    CC_LOG_ERROR("\nUncaught Exception:\n - location :  %s\n - msg : %s\n - detail : \n      %s\n", location, message, stack);
}
```

`CocosApplication.h:138` 声明为 `virtual`，本仓的 `Game : cc::BaseGame : CocosApplication`
（`apps/demo/native/engine/common/Classes/Game.{h,cpp}`）可以直接 override。

### 1.2 三个参数分别是什么（引擎源码实证，`ScriptEngine.cpp:1078-1152`）

| 参数 | 内容 | 备注 |
|---|---|---|
| `message` | `String(exceptionObj)` + 一个换行，例如 `"TypeError: t.foo is not a function\n"` | 干净、短、可直接当标题 |
| `stack` | `v8::TryCatch::StackTrace(context, exceptionObj)` = **JS 侧的 `error.stack` 原文** | 见下 |
| `location` | `"<文件>:<行>:<列>: \n" + 出错那一行的源码 + "\n" + 空格若干 + "^^^^" + "\n"` | ⚠️ **体积炸弹**，见 1.4 |

⚠️ 引擎里另有一个 `stackTraceToString()`（`ScriptEngine.cpp:89`），产出 ` - [0]fn@file:line:col` 那种格式——
**它服务的是 `getCurrentStackTrace()`，跟 `handleException` 无关**。别照着那个格式写解析器。

### 1.3 帧数上限：真正管事的是 JS 侧那个（引擎源码实证）

`ScriptEngine.cpp:365` 有

```cpp
_isolate->SetCaptureStackTraceForUncaughtExceptions(true, JSB_STACK_FRAME_LIMIT /* =20 */, v8::StackTrace::kOverview);
```

但它决定的是 `v8::Message::GetStackTrace()` 的深度，而 `stack` 走的是 `TryCatch::StackTrace`
（等价于读 `error.stack`），受 **`Error.stackTraceLimit`** 管。全仓 + 引擎 JS 里
`stackTraceLimit` 出现 **0 次**（`grep` 过 `bundle.beb47.js` 与 `cc.25e81.js`）⇒ 用的是 V8 默认值 **10**。

⇒ **想要更深的堆栈，在 JS 里加一行 `Error.stackTraceLimit = 30;` 就行**，不必动 C++。
Cocos 引擎的调用栈很容易吃掉前几帧（`Component.update` → `Scheduler` → `Director`），10 帧偏紧。

### 1.4 ⚠️ `location` 在 release 下会膨胀到几十 KB —— 必须截断

`reportException` 拼 `location` 的时候干了两件在压缩产物下很危险的事（`ScriptEngine.cpp:1119-1139`）：

```cpp
if (message->GetSourceLine(context).ToLocal(&sourceline)) {
    ss << sourcelineString << '\n';              // ← 出错那一「行」的全部源码
    int start = message->GetStartColumn(context).FromJust();
    for (int i = 0; i < start; i++) ss << ' ';   // ← 打 column 个空格
    int end = message->GetEndColumn(context).FromJust();
    for (int i = start; i < end; i++) ss << '^';
    ss << '\n';
}
```

`debug: true` 时一行几十个字符，无所谓。`debug: false` 时——**仓内实测** `build/v1/src/chunks/bundle.fa0b0.js`
整份文件只有 10 行，**第 2 行长 51075 字符**。于是一次异常的 `location` ≈
「5 万字符源码 + 最多 5 万个空格 + 若干 `^`」≈ **100 KB**。

Crashlytics 单个 custom key 上限 1 KB、log 总量 64 KB（官方文档明确）；Bugly/CrashSight 的
`errorMsg` 同样有长度限制。**照原样往上塞必被截断或丢弃，还白白在崩溃现场分配 100 KB。**

⇒ 硬规矩：**`location` 只取第一行（`\n` 之前那段，就是 `file:line:col`），后面的源码回显整段丢掉。**
真要看源码上下文，事后拿归档产物看，比塞进上报有用得多。

### 1.5 两个出口：C++ override 还是 `globalThis.__errorHandler`

`reportException` 除了回调 C++，还会去全局对象上找 `__errorHandler` 并调它
（`ScriptEngine.cpp:1155-1172`，v8 与 sm 两个后端都有；Android 走 v8）：

```cpp
Value errorHandler;
if (_globalObj && _globalObj->getProperty("__errorHandler", &errorHandler) && ... isFunction()) {
    ValueArray args;
    args.emplace_back(location);          // string
    args.emplace_back(linenum);           // int
    args.emplace_back(exceptionMessage);  // string
    args.emplace_back(stack);             // string
    errorHandler.toObject()->call(args, _globalObj);
}
```

即 JS 侧写一句就接上了：

```ts
(globalThis as any).__errorHandler = (location: string, line: number, message: string, stack: string) => { /* … */ };
```

两条路的取舍：

| | C++ override `Game::handleException` | JS `globalThis.__errorHandler` |
|---|---|---|
| 要不要动原生工程 | 要（改 `native/engine/common/Classes/Game.{h,cpp}`，**不会被构建吃掉**，见上一份研究 §1.3） | **不要** |
| 能不能热更 | 不能（跟 `libcocos.so` 一起发 APK） | **能**（就是普通业务代码，随 base 或地基包热更） |
| 覆盖 fatal / OOM | **能**（`onFatalErrorCallback` / `onOOMErrorCallback` 也走 `callExceptionCallback`，但那两条的 `stack` 恒为 `"(no stack information)"`，只有 `location`/`message` 有料） | **不能**（那两条不经 `reportException`，不碰 `__errorHandler`） |
| 拿业务上下文（玩家 id / 当前模块 / 各 bundle 版本） | 要再回 JS 取一趟 | **手边就是** |
| 截断 / 打包 / 补字段 | 写 C++ | 写 TS，可单测 |
| VM 已经病了的时候 | 还能跑 | 可能跑不动（重入时引擎打 `ERROR: __errorHandler has exception` 后放弃） |

⇒ **建议主路走 JS `__errorHandler`，C++ 那条只留给 fatal/OOM 兜底。**
理由是本仓的分层铁律正好对上：格式化 / 截断 / 附版本戳这些是逻辑，该在 TS 里（可 node 单测）；
C++ 与 Java 那一段只当哑管道。而且主路可热更——上报格式改一次不必发 APK。

真正落到平台 SDK 那一步仍然要过 Java（Bugly / Crashlytics 的 API 都在 Java 侧），走上一份研究
§6.4 的选型：**JS 主动发起用 `native.reflection.callStaticMethod`，Java 侧一个 `public static` 桥**，
并且**桥类必须在 `proguard-rules.pro` 里显式 `-keep`**（R8 看不见反射调用点，release 包里会被删掉/改名）。

---

## 二、release 产物里堆栈实际长什么样

### 2.1 `debug: true` vs `debug: false`（仓内实测）

| 产物 | `debug` | chunk 文件 | 行数 | 字节 | 最长行 |
|---|---|---|---|---|---|
| `build/android/data` | `true` | `src/chunks/bundle.beb47.js` | 15704 | 644 154 | 正常 |
| `build/web-mobile` | `true` | `src/chunks/bundle.3aa10.js` | 17548 | 739 117 | 正常 |
| `build/v1`（老产物） | `false` | `src/chunks/bundle.fa0b0.js` | **10** | 86 391 | **51 075** |

`debug: true` 的产物长这样（保留缩进、注释、类名、方法名）：

```js
System.register("chunks:///_virtual/cjs-loader.mjs", [], function (exports) {
  return { execute: function () {
      class CjsLoader {
        /**
         * Requires a CommonJS module.
         */
        require(id) { return this._require(id); }
```

`debug: false` 的产物长这样（局部标识符被 mangle 成 `e`/`n`/`ze`/`je`，只有导出名与对象字面量的 key 留着）：

```js
System.register("chunks:///_virtual/index.js",["./rollupPluginModLoBabelHelpers.js"],(function(e){var n,r,t,a,o,u,i;return{setters:[...],execute:function(){e({abortLaunch:ze,boot:function(e){return C.apply(this,arguments)},compareVersion:je,…
```

官方对这两个开关的原话（**官方文档明确**，[通用构建选项](https://docs.cocos.com/creator/3.8/manual/zh/editor/publish/build-options.html)）：

- **调试模式**：「若不勾选该项，则处于发布（release）模式，会对资源的 UUID、构建出来的引擎脚本和项目脚本进行**压缩和混淆**……」
- **Source Maps**：「如果需要生成 sourcemap，请勾选该项。构建时便会**默认压缩引擎文件和项目脚本**。」

注意第二条的坑：**勾了 Source Maps 就会压缩**，哪怕你以为自己在出 debug 包。
「不压缩」与「有 sourcemap」是互斥的两种可读性方案，不能既要又要。

⇒ 一条 release 堆栈实际会是这个样子（`debug:false`）：

```
TypeError: e.foo is not a function
    at ze (src/chunks/bundle.fa0b0.js:2:41276)
    at je (assets/foundation/index.8a39d.js:2:9013)
    at Object.C (src/cocos-js/cc.25e81.js:14:882301)
```

**行列号是准的**（V8 按编译时的物理位置算），所以 sourcemap 查得回去；**函数名是废的**。

### 2.2 帧里的文件名是从哪来的：`require` 的相对路径（引擎源码实证）

`ScriptEngine::runScript`（`ScriptEngine.cpp:919`）把**传进来的相对路径原样**当作 script origin：

```cpp
ccstd::string const scriptBuffer = _fileOperationDelegate.onGetStringFromFile(path);
return evalString(scriptBuffer.c_str(), scriptBuffer.length(), ret, path.c_str());   // ← fileName = path
```

`evalString`（`:672`）再拿它建 `v8::ScriptOrigin origin(_isolate, originStr)`。而 `path` 来自
`build-templates/native/index.ejs` 里那句 `defaultHandler: (urlNoSchema) => require(urlNoSchema…)`，
是 `src/chunks/bundle.<md5>.js` / `assets/<bundle>/index.<md5>.js` 这种**相对 data 根的路径**。

两个直接后果：

1. **文件名不受热更影响**。同一个 `src/chunks/bundle.beb47.js`，无论这次是从 APK 的 `assets/` 读的
   还是从 `cck-remote-asset/` 读的，堆栈里都是这一串（搜索路径的解析在 `FileUtils` 内部，不影响 origin）。
   ⇒ 后台看到的路径干净、可比对，不会混进 `/data/data/com.cck.demo/files/…` 这种设备路径。
2. **文件名里的 md5 就是内容指纹**。见 §5。

### 2.3 开 `sourceMaps` 要付什么

**官方文档明确 + 文档推断**：勾上之后引擎脚本与项目脚本各生成对应的 `.map`。本仓三份产物
`sourceMaps` 都是 `false`，所以 `find build -name '*.map'` **一个都没有**（仓内实测），
下面几条**全部是 `待实测`**：

- `.map` 落在哪（大概率是 `src/chunks/bundle.<md5>.js.map`、`assets/<bundle>/index.<md5>.js.map`、
  `src/cocos-js/cc.<md5>.js.map`）；
- 体积。经验值是压缩后 JS 的 3~10 倍，引擎那份最吓人（`cc.25e81.js` 本身就是 MB 级）；
- native 平台会不会把 `.map` 一起塞进 `build/android/data`。

⚠️ **而这三条在本仓有连带伤害，必须先想清楚再勾**：

1. **`.map` 会被打进 APK**。gradle 的 `assets.srcDir "${RES_PATH}/data"` 把 `build/android/data`
   整个塞进 APK（上一份研究 §2 实测）——`.map` 只要落在 data 下，就跟着进包。
2. **`.map` 会被 manifest 发给玩家**。`packages/tools/src/hot-update-manifest.ts` 的
   `walkFiles()`（`:74`）无差别收集 data 下所有文件，`ENGINE_BOUND`（`:171`）那张排除表里
   **没有** `.map`。⇒ 每个玩家的每次热更都会去 CDN 下几 MB 的 sourcemap。
3. sourcemap 等于把源码交出去了，公开 CDN 上放一份 = 客户端代码开源。

⇒ 真要走这条路，**必须在 Creator 构建之后、`cck-manifest` 之前把 `.map` 从 `data/` 里搬走**
（搬进 `releases/<version>/sourcemaps/`），一步都不能省。这是 `scripts/build.mjs` 里加一个
`mv` 的量级，但它是**正确性要求**，不是优化。

---

## 三、两家平台能不能还原 JS 堆栈

### 3.1 Firebase Crashlytics：不能（官方文档明确）

[Get readable crash reports (Android)](https://firebase.google.com/docs/crashlytics/android/get-deobfuscated-reports)
的支持列表只有：**ProGuard / R8 / DexGuard 的 mapping 文件**，以及 NDK 的符号表。
全文没有 JavaScript / source map 任何字样。社区侧的印证：

- [firebase-js-sdk#9273](https://github.com/firebase/firebase-js-sdk/discussions/9273) 是一张
  「Web Observability with Crashlytics」的 **RFC**（还在提案阶段），前提陈述就是「Web 生产堆栈是压缩的，
  没有 source-map 还原就没法用」；
- [react-native-firebase#2327](https://github.com/invertase/react-native-firebase/issues/2327)
  「Sourcemaps support in Crashlytics dashboard」至今是 feature request。

Crashlytics 上唯一能塞 JS 堆栈的方式是**非致命事件**：把它伪装成一个 Java `Throwable`
（`Throwable.setStackTrace(StackTraceElement[])` 造合成帧）再 `recordException`。iOS/Unity 有官方的
`ExceptionModel` + `StackFrame` 干这件事，**Android 侧没有对应 API**（官方文档明确），只能用合成
`Throwable`。⇒ **待实测**，且有两个已知风险：

- Crashlytics 会拿 R8 mapping 去 deobfuscate 上报的帧，合成帧的「类名」（我们会填成 JS 文件名）
  可能被误映射或被当成噪音；
- 配额硬：**只保留最近 8 条非致命异常**、custom key 最多 64 对 / 每对 ≤1 KB、log 总量 ≤64 KB
  （官方文档明确）。一个每帧抛异常的 bug 会瞬间打满。

### 3.2 Bugly / CrashSight：能收，不能还原（官方文档明确）

- API 是 `CrashReport.postException(int category, String errorType, String errorMsg, String stack, Map extraInfo)`，
  **`category = 5` 就是 JS**（CrashSight 文档原文列的是 `C#: 4, js: 5, lua: 6`）。
  ⚠️ **与同日的 `bugly-android.md` 冲突**：那份查的是 Bugly **免费版**，官方文档 + aar `javap` 给的是
  `u3d c#: 4 ｜ js: 8 ｜ cocos2d lua: 6`。两家产品的常量表可能本就不同 —— **以真正接入的那条线（免费版 Bugly）为准，后台实测**。
  ⇒ 上报这一步是一等公民，后台会按 JS 异常归类聚合。
- **但符号表配置只有两种**：Android Java 的 mapping、native so 的符号文件。
  **没有 sourcemap 上传入口**（CrashSight 文档、Bugly 文档均无）。JS 的 `stack` 就是一坨字符串。
- Bugly 那个官方 **Cocos 插件已停止维护**（文档页首原文：「本插件已停止维护，不再提供新增服务」），
  而且它是 cocos2d-x / Creator 2.x 时代的产物（`BuglyJSAgent::registerJSExceptionHandler(JSContext*)`
  这种签名在 Creator 3.x 的 v8 后端根本对不上）。⇒ **3.8 上不要指望那个插件，走
  Android 原生 SDK + 自己的桥。**
- 另外 Bugly 国内版正在往腾讯云 **CrashSight** 迁；两边的 `postException` 签名与 category 编码一致。
  选型时按 CrashSight 的文档走更稳。

### 3.3 所以还原只能发生在两个地方

| 位置 | 做法 | 评价 |
|---|---|---|
| **上报之前**（客户端内） | 把 `.map` 也发到设备上，崩的时候当场查 | ❌ 否掉。`.map` 比代码还大、等于把源码发给玩家、崩溃现场做重活 |
| **上报之前**（网关内） | 客户端把原始堆栈发给我们自己的服务，服务查归档 `.map` 还原后再转投 Bugly/Crashlytics | 可行但要多一个服务；好处是后台里直接是可读堆栈 |
| **上报之后**（离线） | 后台照旧存压缩堆栈；排查时用一个脚本拿 `stack` + 归档 `.map` 还原 | ✅ **最省**。一个 node 脚本 + `source-map` 库 + `releases/<version>/sourcemaps/` |
| **压根不压缩** | release 也出 `debug: true` 的包 | ✅ **最省中的最省**（本仓当下就是这样），代价见 §6 |

### 3.4 对照：唯一原生支持的是 Sentry

Sentry 的 JS 侧是把 sourcemap 当一等公民的：`sentry-cli releases files upload-sourcemaps`
上传 artifact，后台按 **文件 URL + release 名 + dist** 三元组匹配、服务端做符号化
（[官方文档](https://docs.sentry.io/platforms/javascript/sourcemaps/)）。
「后台点开就是源码行号」这种体验，两家目标平台都给不了，**只有换平台才有**。
本次不建议换（Bugly/Crashlytics 的选型是为了拿 native 崩溃与 ANR，那才是大头），
但要知道差距在哪：我们是拿「离线还原脚本」补上了平台缺的那一环。

---

## 四、有没有别人趟过

有，但**只趟到「上报」，没趟到「可读」**。

- 中文社区里 Creator 3.6+ 接 Bugly 的做法高度一致（多篇 CSDN 教程）：**override `Game.cpp` 的
  `handleException`** → JNI 调 Java → `CrashReport.postException(5, "JSError", message, stack, extra)`。
  和本文 §1 推出来的是同一条路，可以照抄。
- **没有任何一篇讨论 release 下堆栈可读性**。全部示例都是 debug 包截图，所以「看起来能用」——
  这正是这张票要防的坑。
- Cocos 官方侧：Creator 3.8.7 编辑器**不带**任何崩溃分析服务集成
  （`grep -a` 全 `app.asar`，`bugly` / `crashsight` / `crashlytics` 命中 **0 次**，仓内实测）。
  2.x 时代那个「服务」面板里的 Bugly 集成没有 3.x 版本。
- 论坛上跟 sourcemap 相关的活跃话题全是**代码混淆插件**（`javascript-obfuscator` 那一路），
  方向相反——它们是要让堆栈更不可读。

⇒ 结论：**上报这一段照抄现成的；「可读」这一段没有现成的，是我们自己要造的那一小块。**

---

## 五、热更之后，这条堆栈对应哪一版

### 5.1 先看清楚：本仓根本没有「一个版本」这种东西

按 `apps/demo/docs/hotupdate-pipeline.md`，一台设备上同时跑着**三个各自独立更新**的层：

| 层 | 谁 | 更新方式 |
|---|---|---|
| 引擎层 | `src/cocos-js/cc.<md5>.js` + `libcocos.so` | 只能发 APK |
| base 层 | `application.<md5>.js` / `src/chunks/bundle.<md5>.js` / `assets/{main,resources,internal}` | 热更 + 重启 |
| 分包层 | `assets/foundation/index.<md5>.js`、各模块、各皮包 | 热更、免重启，**各包各自的版本号** |

⇒ 一条堆栈的三帧完全可能分别来自 base 的 1.3.5、`foundation` 的 1.3.6、引擎的出厂版。
**「给上报打一个 release 号」这个直觉在这里是错的**——它会把三层压成一个数，压完就对不回去了。

### 5.2 好消息：文件名自己就是答案

`md5Cache: true` 是本仓的硬约定（`build-configs/README.md`：「内容寻址是热更的地基，不是可选优化」），
于是 §2.2 那条结论直接给出了正确的键：

```
at ze (src/chunks/bundle.fa0b0.js:2:41276)      →  base 那一版的 chunk，指纹 fa0b0
at je (assets/foundation/index.8a39d.js:2:9013)  →  foundation 那一版，指纹 8a39d
at C  (src/cocos-js/cc.25e81.js:14:882301)       →  引擎，指纹 25e81（= engineHash）
```

**每一帧自证身份，逐帧精确，跨层也不会串。** 要还原只需要一个按文件名索引的 sourcemap 池：

```
releases/sourcemaps/bundle.fa0b0.js.map
releases/sourcemaps/index.8a39d.js.map
…
```

内容寻址保证**同名必同内容**，所以这个池可以是**扁平的、只叠加不清空的**，跟 CDN 的策略一致，
永远不会撞名，也不需要按版本号分目录。这是 md5Cache 白送的性质。

⚠️ 前提：`md5Cache: true`。关掉就退化成 `bundle.js`，同名不同内容 → 池子塌掉 → 只能回去靠版本号。
（本仓两份构建配置都开着，且文档写死了不许关。）

### 5.3 还是要带的几个字段（作为交叉校验与聚合维度）

文件名解决「查哪份 map」，但后台聚合、灰度定位还需要几个粗粒度的戳。手边现成的（`packages/core/src/app/app.ts`）：

| 字段 | 来源 | 含义 |
|---|---|---|
| `appVersion` | app 戳 `cck-app-compat.json` 的 `version` | **当前跑的这套代码**的版本（随 base 热更翻，不是 APK 的） |
| `coreApiHash` | 同上 | core 的公开 API 指纹 |
| `engineHash` | 运行时读 SystemJS import map（`imports.cc` 的 md5） | 引擎身份，**热更够不着 ⇒ 严格等于这个 APK** |
| `__cckBaseEntry` | `main.js` 挂上来的包内 base 入口 md5 | 这个 APK 自带的 base 是哪一版 |
| 当前 base 入口 | `src/cck-base.json` 的 `application` | **实际在跑**的 base 是哪一版（与上一条不等 ⇒ 打过热更） |
| 各 bundle version | `BundleManager` 显式传的 version | 分包层各自的版次 |

Crashlytics 的 custom key 上限 64 对 / 每对 1 KB，Bugly 的 `extraInfo` 也有限额，
**别把 20 个 bundle 的版本一条条塞**——塞前 6 个就够，剩下的靠帧里的 md5。

### 5.4 ⚠️ 一个必须提前想到的坑：隔离态与「起不来的 base」

ADR-0018 那条看门狗（连续 2 次没跑到 Bootstrap 就隔离、退回包内 base）说明**最值钱的那类崩溃
恰恰发生在上报还没初始化的时候**。上报要是挂在 Bootstrap 之后才装，这类事故一条都收不到。
⇒ 上报的注册点应尽量早（`__errorHandler` 是纯 JS 一行，可以放在 `boot` 最前面，甚至在
`main.js` 里就挂），并且把 `window.__cckAotQuarantined` / `cck.baseTry` 一并当字段带上。
**待实测**：这一段具体放哪一层最早又不至于自己把启动搞挂。

---

## 六、可行路径（两条，都不发明新东西）

### A. 什么都不改，release 也出 `debug: true` 的包

**现状即成立**：`build-configs/{android,web-mobile}-boot.json` 都是 `debug: true`。
堆栈里的 `bundle.<md5>.js:8123:15` 拿 `releases/` 里归档的同名产物一开就能读，标识符全在。
要做的只有：**把每次发布的 `src/chunks/*.js` 与 `assets/*/index.*.js` 一起归档**
（`build.mjs` 已经在归档 manifest 到 `releases/<version>/`，扩一下范围即可）。

- ✅ 零新增机制、零新增工具、无 sourcemap 泄漏源码的风险
- ❌ 包体更大、`CC_DEBUG` 断言与 `DebugMode.INFO` 日志全开、性能有损、代码等于明文
- 判据：**先量一次差值再决定**。如果 debug/release 的包体与帧率差在可接受范围内，这就是最省的答案。

### B. `debug: false` + `sourceMaps: true` + 离线还原脚本

- 构建配置改两个字段；
- `build.mjs` 在 Creator 构建之后、`cck-manifest` **之前**，把 `data/**/*.map` 搬到
  `releases/sourcemaps/`（**不搬 = 打进 APK + 发给每个玩家 + 源码泄漏**，见 §2.3）；
- 加一个 `packages/tools` 的子命令，输入一段 `stack`、输出还原后的堆栈：按每帧的
  `文件名:行:列` 去 `releases/sourcemaps/<文件名>.map` 里查（`source-map` 库的
  `originalPositionFor`）。**因为文件名带 md5，这个脚本不需要知道版本号。**

- ✅ 包小、代码不明文、后台字段短
- ❌ 多一个生成物要归档、多一个工具要维护、排查多一步

### 两条路共用的部分（无论选哪条都要做）

1. JS 侧 `globalThis.__errorHandler` 兜主路，C++ `Game::handleException` 兜 fatal/OOM；
2. **`location` 只取第一行**（§1.4）；`stack` 整体截到几 KB 再上报；
3. `Error.stackTraceLimit = 30`（§1.3）；
4. Java 桥类 `-keep`（否则 release 包必崩在反射上，debug 包永远测不出来）；
5. 带上 §5.3 那几个戳；
6. **去重/限流**：Crashlytics 只留最近 8 条非致命；每帧抛的 bug 会打满配额。同一 `message + stack`
   前 N 帧的 hash 相同就只报一次。

---

## 七、终点要不要改

**不推翻，但必须加限定，并且承认它比图上多一个环节。**

- 终点如果写的是「**在 Bugly / Crashlytics 后台看到可读的 JS 堆栈**」——❌ **这条要改**。
  两家平台都不会还原 JS，后台里永远是 `bundle.<md5>.js:2:41276`。指望「接上 SDK 就能看懂」是错的。
- 终点如果写的是「**上报带可读的 JS 堆栈**」——✅ **成立**，但要挂条件：可读性由**我们**提供，
  路径 A（不压缩，现状即成立）或路径 B（压缩 + 归档 map + 还原脚本）二选一，
  **而且图上要多出「归档产物 / sourcemap」和「还原」两个格子**。少了这两格，等于没有可读堆栈。

没有出现「根本不可读、无可行还原路径」这种结果——**行列号在 release 下是准的**（引擎源码实证），
**文件名自带内容指纹**（仓内实测），两个前提都成立，还原在数学上就是通的。
所以这张票的风险点不在「能不能」，在「**别忘了做那两格**」：只接 SDK 不管归档，
上线三个月后回头看，后台里全是对不上任何一份产物的天书。

**没查实、不许当成已知的：** §2.3 那三条（`.map` 落在哪 / 多大 / 会不会进 native 产物）、
Crashlytics 合成 `Throwable` 的实际显示效果、以及路径 A 里 debug 包的包体与性能代价。
这几条都要一次真构建才能定，见下。

---

## 八、待实测清单

| # | 要验的 | 配方 |
|---|---|---|
| A | `debug:false` + `sourceMaps:true` 的产物里 `.map` 落在哪、多大、native 平台会不会带 | 复制一份构建配置改这两个字段，`node scripts/build.mjs <名字>`，`find build/<out>/data -name '*.map' \| xargs ls -la` |
| B | 路径 A 的代价：debug vs release 的 APK 体积、启动耗时、帧率 | 同一份工程各出一次包对比 |
| C | 一条真堆栈到底长什么样 | 在某个 View 里故意 `undefined.foo()`，装 release 包，`adb logcat \| grep "Uncaught Exception"`，把 `location`/`message`/`stack` 三段原样贴回本文 |
| D | `location` 在 release 下的真实长度（§1.4 的 100 KB 是推算） | 同 C，量 `location` 的字节数 |
| E | `globalThis.__errorHandler` 在 3.8.7 Android 上确实会被调用、四个参数顺序如上 | 同 C，挂一个 handler 打日志 |
| F | Crashlytics 收合成 `Throwable` 之后后台显示成什么样（会不会被 R8 mapping 误映射） | 造一个 `StackTraceElement("src/chunks/bundle.fa0b0.js", "ze", "bundle.fa0b0.js", 2)` 的合成栈 `recordException` |
| G | 上报注册点能放多早（隔离态/base 起不来时还能不能收到），见 §5.4 | 人为发一版起不来的 base，看有没有上报 |

---

## 参考

- 官方文档
  - [通用构建选项介绍（debug / Source Maps / MD5 Cache）](https://docs.cocos.com/creator/3.8/manual/zh/editor/publish/build-options.html)
  - [Crashlytics · Get readable crash reports (Android)](https://firebase.google.com/docs/crashlytics/android/get-deobfuscated-reports)
  - [Crashlytics · Customize crash reports (Android)](https://firebase.google.com/docs/crashlytics/android/customize-crash-reports)
  - [Tencent CrashSight · Mobile Platform Integration Guidelines](https://crashsight.wetest.net/documents/en/crashsight/sdkDocuments/mobile-sdk/)
  - [Bugly · Cocos Plugin 使用指南](https://bugly.qq.com/docs/user-guide/instruction-manual-plugin-cocos/)（页首注明已停止维护）
  - [Sentry · JavaScript Source Maps](https://docs.sentry.io/platforms/javascript/sourcemaps/)（对照组：唯一原生还原 JS 的平台）
- 社区
  - [firebase-js-sdk#9273 · RFC: Web Observability with Crashlytics](https://github.com/firebase/firebase-js-sdk/discussions/9273)
  - [react-native-firebase#2327 · Sourcemaps support in Crashlytics dashboard](https://github.com/invertase/react-native-firebase/issues/2327)
- 本机明文引擎源（比文档权威）
  - `<Creator>/resources/3d/engine/native/cocos/application/CocosApplication.cpp:86,171` · `CocosApplication.h:138`
  - `<Creator>/resources/3d/engine/native/cocos/bindings/jswrapper/v8/ScriptEngine.cpp:53,273,282,293,319,365,672,919,1078,1144,1159,1202`
  - `<Creator>/resources/3d/engine/native/cocos/engine/Engine.cpp:316`
- 仓内
  - `docs/research/2026-09-03-cocos-native-android-template.md`（原生工程改哪里不会被吃掉 · `-keep` · JS↔Java）
  - `apps/demo/docs/hotupdate-pipeline.md`（三档更新代价 · 两枚版本戳 · 内容寻址）
  - `apps/demo/build-configs/README.md` · `apps/demo/build-configs/android-boot.json`
  - `packages/tools/src/hot-update-manifest.ts:74,171`（`walkFiles` 无差别收集 · `ENGINE_BOUND` 排除表里没有 `.map`）
  - `apps/demo/build-templates/native/index.ejs`（`defaultHandler` → `require(相对路径)`，决定了堆栈里的文件名）
  - `apps/demo/native/engine/common/Classes/Game.{h,cpp}`（C++ override 落点）

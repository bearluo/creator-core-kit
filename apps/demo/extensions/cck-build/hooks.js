'use strict';

/**
 * 把构建面板上填的参数写进 `settings.json` 的 `cck` 段。
 *
 * 挂在 `onBeforeCompressSettings` 上是因为它是**唯一**能改 settings 的时机：再晚一步
 * （`onAfterCompressSettings`）settings 已经序列化压缩完了，写进去不会进产物。
 *
 * 运行时那一半在 `assets/boot/build-config.ts`（`settings.querySettings('cck', key)`）。
 */

const PACKAGE_NAME = 'cck-build';
/** settings.json 里的段名。改它要同步改 `assets/boot/build-config.ts` 的 `CATEGORY`。 */
const CATEGORY = 'cck';

/** 钩子里抛错就中断构建 —— 配错了要当场知道，而不是拿到一个连错服的包。 */
exports.throwError = true;

exports.onBeforeCompressSettings = async function (options, result) {
  // packages 在插件未启用等异常情况下可能没有本项；那时什么都不注入，运行时全部落回
  // 源码默认值 —— 与改造之前的行为一致，不该报错。
  const my = (options.packages && options.packages[PACKAGE_NAME]) || {};

  // 只注入**填了的**项：空字符串在运行时等价于「没配」，与其写一堆空串进产物，不如不写。
  const injected = {};
  for (const key of Object.keys(my)) {
    const v = my[key];
    if (typeof v === 'string' && v !== '') injected[key] = v;
  }

  if (Object.keys(injected).length === 0) {
    console.log(`[${PACKAGE_NAME}] 面板未配任何项 → 全部跟随 app-config.ts 的源码默认值`);
    return;
  }

  if (!result.settings) {
    // 走到这里说明构建流程变了（settings 还没建好就跑了本钩子）。静默跳过 = 出一个
    // 参数没生效的包，比直接失败更难查，所以让它响亮。
    throw new Error(`[${PACKAGE_NAME}] result.settings 不存在，无法注入 —— Creator 版本行为有变？`);
  }

  result.settings[CATEGORY] = Object.assign({}, result.settings[CATEGORY], injected);
  // 这条日志是出包后回查「这个包到底是哪个马甲」的第一现场，别删。
  console.log(`[${PACKAGE_NAME}] 注入 settings.${CATEGORY} = ${JSON.stringify(injected)}`);
};

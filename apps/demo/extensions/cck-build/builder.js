'use strict';

/**
 * 构建面板上的「CCK 出包参数」表单。
 *
 * ## 为什么每一项的 default 都是空字符串
 *
 * 空 = **跟随源码默认值**。`assets/boot/build-config.ts` 的 `buildValue()` 把空串当作
 * 「这一项我不配」，于是落回 `app-config.ts` 里写死的那个值。这样：
 *
 * - 什么都不填构建出来的包 = 改造之前的行为，**零风险**；
 * - 默认值只有一处真相（源码），面板不必抄一遍 —— 抄一遍就会漂移，而漂移的表现是
 *   「出的包连错了服」，没有任何报错。
 *
 * placeholder 里写的是源码当前的默认值，只作提示。**改了源码默认值记得同步这里的 placeholder**，
 * 它不影响行为，但看着不对会让人怀疑面板。
 *
 * ## 为什么这个扩展是 JS 不是 TS
 *
 * 编辑器扩展跑在 Creator 的 Node 进程里，走不到本仓的 TS 编译链（`pnpm typecheck` 覆盖的是
 * `packages/*` 与 demo 的 `assets/`）。官方模板用 tsc 编译到 `dist/`，为这不到一百行的东西
 * 挂一条构建链不值当 —— 代价是这里的 key 和 `build-config.ts` 的 `BuildKey` 对不上时没有
 * 编译期报错，所以那边留了注释、这边留了这句。
 *
 * 字段清单见 `apps/demo/docs/build-plugin.md`。
 */

const PACKAGE_NAME = 'cck-build';

/** 文本输入项：占位符提示源码默认值，留空即跟随。 */
function input(label, description, placeholder) {
  return {
    label,
    description,
    default: '',
    render: { ui: 'ui-input', attributes: { placeholder: `留空 = ${placeholder}` } },
  };
}

exports.configs = {
  // '*' = 所有平台共用这一份。马甲 / 版本这些跟平台无关，分平台配只会让人在 android 上
  // 填了、在 web 上忘了填。
  '*': {
    hooks: './hooks',
    options: {
      vest: {
        label: '马甲',
        description: '决定 skin-<马甲>-<跟随者> 皮包从哪取。加新马甲时在这里补一项。',
        default: '',
        render: {
          ui: 'ui-select-pro',
          items: [
            { label: '跟随源码默认（base）', value: '' },
            { label: 'base', value: 'base' },
            { label: 'vest', value: 'vest' },
          ],
        },
      },
      appId: input(
        '应用 ID',
        '本机存储的隔离前缀。两个马甲装在同一台机器上，它不同才不会共用同一个游客号。',
        'cck-demo',
      ),
      version: input('客户端版本', 'dispatcher 版本闸拿它判要不要强更。', '1.3.0'),
      channel: input('渠道', '渠道 / 分发标识，随握手上报。', 'dev'),
      env: {
        label: '环境',
        description: '决定版本表 / manifest 地址由项目怎么拼。',
        default: '',
        render: {
          ui: 'ui-select-pro',
          items: [
            { label: '跟随源码默认（dev）', value: '' },
            { label: 'dev', value: 'dev' },
            { label: 'staging', value: 'staging' },
            { label: 'prod', value: 'prod' },
          ],
        },
      },
      dispatcherUrl: input(
        'Dispatcher 地址',
        '启动握手的 HTTP 地址。⚠️ 真机 / 模拟器请写局域网 IP，别写 127.0.0.1。',
        'http://172.25.50.139:9100/api/Handshake',
      ),
    },
  },
};

exports.load = function () {
  console.debug(`[${PACKAGE_NAME}] loaded`);
};

exports.unload = function () {
  console.debug(`[${PACKAGE_NAME}] unloaded`);
};

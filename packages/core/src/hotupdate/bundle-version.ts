/**
 * 从 bundle 自己的 manifest 反推「该加载哪个版本」—— native 内容寻址热更的那半个接缝，纯字符串处理。
 *
 * ## 为什么版本来自 manifest 而不是另一张表
 *
 * Creator 开 `md5Cache` 后 bundle 入口叫 `assets/<bundle>/index.<md5>.js`，引擎按
 * `options.version || settings.bundleVers[name]` 拼这个名字。热更下来的是**新** md5 的文件，
 * 而包内 `settings.bundleVers` 写死的是**出包那天**的 md5 —— 不显式传 version，引擎就去拿旧名字，
 * 找不到便**静默回落包内那份**：日志报「更新成功」、代码却从没执行过，且不报错。
 *
 * 答案其实已经躺在 `<bundle>.manifest` 的 asset key 里，而 `AssetsManagerEx` 更新成功后
 * `_localManifest = _remoteManifest`，所以**更新刚跑完，manifest 就是这个 bundle 内容的权威描述**。
 * 从它反推的版本与刚落盘的字节严格同步 —— 不像「另拉一张版本表」那样存在表与内容不同步的失配面。
 * web 那边同名的活由 `cck-versions.json` 干，是因为 web 压根没有 manifest 这个东西。
 */

/**
 * 从 asset key 列表里认出该 bundle 的内容版本 = `assets/<bundle>/index.<v>.js` 里的 `<v>`。
 *
 * 认不出就返回 `undefined`（**不是错误**）：产物没开 `md5Cache` 时入口就叫 `index.js`，
 * 此时引擎按不带版本的名字取，正是我们要的行为 —— 调用方回落到下一个版本来源即可。
 *
 * bundle 名按字面匹配、不当正则用（`mini-clicker`、`skin-base-lobby` 这类名字里的 `-` 无害，
 * 但名字来自配置，别给它解释元字符的机会）。
 */
export function bundleVersionFromAssetKeys(
  bundle: string,
  keys: readonly string[],
): string | undefined {
  const prefix = `assets/${bundle}/index.`;
  for (const k of keys) {
    if (!k.startsWith(prefix) || !k.endsWith('.js')) continue;
    const v = k.slice(prefix.length, -'.js'.length);
    // `index.js`（没开 md5）切出空串；`index.a.b.js` 这种多段的不是 Creator 的产物形态，一并不认。
    if (v !== '' && !v.includes('.') && !v.includes('/')) return v;
  }
  return undefined;
}

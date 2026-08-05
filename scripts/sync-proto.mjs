// 把契约仓的**模块段**产物拷进各模块 bundle 的 assets 目录。
//
// 为什么要拷而不是 import：Cocos 把所有 npm 依赖统一打进 `src/chunks/bundle.js`
// ——那是需整包更新的 AOT 层。模块协议走 npm import 就等于钉死在 AOT，加一个子游戏
// 的协议要用户重装。只有作为 `assets/` 下的项目脚本，它才会进那个 bundle 的 chunk、
// 随 bundle 热更。（`.ts` 不能是 `.js`：Creator 把 assets 下的 `.js` 一律当 CJS。）
//
// 漏拷是**静默**的（旧协议还在，编译照过，线上错发），所以 CI 跑完这个脚本会检查
// 工作树有没有变——同 `pnpm docs:api` 的套路。基础段不在此列，它走 npm exports。
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/** [契约仓 gen/ts 下的模块段, 本仓落点]。加模块在这里加一行。 */
const SEGMENTS = [
  ['game/clicker.ts', 'apps/demo/assets/modules/mini-clicker/clicker-proto.ts'],
];

const SRC_ROOT = 'node_modules/@kit/proto/gen/ts';

for (const [from, to] of SEGMENTS) {
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(`${SRC_ROOT}/${from}`, to);
  console.log(`${from} → ${to}`);
}

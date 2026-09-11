import { buildValue } from '../boot/build-config';

/**
 * 服务端地址 —— 除 dispatcher 之外的都在这里。
 *
 * 为什么 dispatcher 的地址**不在**这里而在 `boot/app-config.ts`：它是鸡生蛋的那一个 ——
 * 客户端要先握手拿到 `cdnUrl` 才知道去哪拉热更内容，而本文件本身就是热更内容。
 * 其余地址没有这个约束，摆在地基层 → 换机器 / 换环境**热更即可，不用发新包**。
 *
 * ⚠️ 这里 `import` 主包（`boot/`）的 `buildValue` 是**合法方向**：跨包 import 只许指向
 * 优先级更高的包，`main`(7) > `foundation`(6)，反过来才是禁的（见根 `CLAUDE.md`）。
 * 闸是 `pnpm check:graph`。
 */

/**
 * 账号服的**对外面**（只有 `POST /api/Login`）。
 *
 * 服务端刻意把它和只给网关用的 `/frame` 拆成两个监听：后者无条件相信网关注入的身份头，
 * 暴露出去 = 任意账号接管。所以这里只会有登录这一个地址，别往上面加别的路径。
 *
 * **源码里只留 `127.0.0.1`**：任何人 clone 下来在本机起一份 server-core-kit 就是对的。
 * 具体环境的地址走构建参数 —— `build-configs/local.json` 的
 * `packages.cck-build.accountLoginUrl`（已 gitignored）或构建面板，**不进库**。
 * ⚠️ 真机 / 模拟器上 `127.0.0.1` 指的是设备自己，连本机服务必须填局域网 IP。
 *
 * **代价是它因此住在 base 层**（`buildValue` 读 `settings.json`）：改它要热更 base 并**重启**，
 * 而本文件其余内容热更即生效、不重启。认这笔账是因为**地址不进包就出不了一个能登录的包**，
 * 而它几乎不变。配错**不是砖头**：认证排在 `hotupdate` 之后，热更那一步照样跑得到。
 * 正解是下面 ② 那条（由 dispatcher 握手下发），要动 kit-proto 契约与服务端。
 *
 * **多马甲连不同的服**时这里是个常数、不够用，两条路（都还没做，等真出现再挑）：
 * ① 各马甲发各自的地基热更包（改这一行即可，代价是热更包按马甲分叉）；
 * ② 跟 `wsUrl` / `cdnUrl` 一样由 dispatcher 握手下发（要动 kit-proto 契约与服务端，一处真相）。
 * 只换皮不换服的马甲不受影响 —— 皮在 `skin-<马甲>` 包里，跟本文件无关。
 */
export const ACCOUNT_LOGIN_URL = buildValue('accountLoginUrl', 'http://127.0.0.1:9103/api/Login');

import {
  createToken,
  getHttp,
  getRootContainer,
  getUIManager,
  postJson,
  APP,
  NETWORK,
  STORAGE,
  type IHttp,
  type INetwork,
  type IStorage,
  type Token,
} from '@cck/core';
import { LOGIN_UI } from '../catalog';

/**
 * 会话认证 —— 长连接上的**身份**那一层。
 *
 * 为什么单独一层：网关对连接只有两种态度 —— 认证前除 `AuthRequest` / `Ping` 外一律回
 * `Error{NOT_HANDSHAKED}`，认证后所有业务 cmd 才通。**每条连接各认各的**，
 * 所以这不是启动期做一次的事：重连、网关搬家之后拿到的都是全新连接，都得重认。
 *
 * 三步（契约 `account.proto` / `session.proto`）：
 *   ① 登录界面选一个账号（游客 / 自有账号），见 {@link pickAccount}；
 *   ② `POST /api/Login` 拿 token —— 唯一免认证接口，走 HTTP 而不是 socket，
 *      因为「能不能连上网关」这件事本身就要先有身份；
 *   ③ 连上后首帧 `AuthRequest{token}` → `AuthResponse{playerId, serverTimeMs}`。
 *
 * token **不进 URL**（会被反代 / CDN 完整记进 access log），只在帧 body 里。
 */

const TAG = '[CCK-AUTH]';

/** 设备号存这个键。换掉它就是换一个玩家 —— 邮件、背包全跟着变。 */
const DEVICE_KEY = 'cck.deviceId';

/**
 * 存储键的**马甲隔离**前缀。
 *
 * Android 各马甲独立包名，沙箱天然隔离；但 **Web / 小游戏同域名下共用一份 localStorage** ——
 * 不加前缀，两个马甲会读到同一个 `deviceId`，也就是同一个游客玩家（各自连的还可能是不同的服，
 * 于是「同一个号在 A 里有邮件、在 B 里是新号」这种查不明白的现象）。用 `appId`：马甲的包身份就是它。
 *
 * 取不到 App（单测直接调这几个函数）就不加前缀 —— 隔离是运行期的事，测试里没有第二个马甲。
 */
export function scopedKey(key: string): string {
  const appId = getRootContainer().tryResolve(APP)?.config.appId;
  return appId ? `${appId}.${key}` : key;
}

/**
 * 上次登录用的账号名，**只用来预填输入框**。
 *
 * 存名字不存整个 credential：`custom` 的 credential 里带密码，落本地存储等于把密码
 * 明文写在玩家能翻到的地方。密码每次现输 —— 常用的游客登录本来就一键，不受影响。
 */
const LAST_NAME_KEY = 'cck.lastLogin';

/** 游客：credential 是设备号。 */
export const PROVIDER_DEVICE = 'device';
/** 自有账号：credential 是 `账号:密码`。 */
export const PROVIDER_CUSTOM = 'custom';

/**
 * `custom` 凭据的分隔符。服务端按**第一个**冒号切，所以账号里不能带冒号
 * （密码可以：切一次之后剩下的全是密码）。
 */
export const CREDENTIAL_SEP = ':';

/** 服务端的密码下限（实测：5 位被拒、6 位通过）。客户端先拦一道，省一次白跑的往返。 */
export const PASSWORD_MIN = 6;

/** 一份登录凭据。`credential` 由 provider 自解释，契约不规定内容（`account.proto`）。 */
export interface LoginAccount {
  readonly provider: string;
  readonly credential: string;
}

/** `POST /api/Login` 的结果。 */
export interface LoginResult {
  readonly token: string;
  readonly playerId: string;
  /** 这次登录**新建**了玩家 —— 真实项目据此决定走不走新手引导。 */
  readonly isNewPlayer: boolean;
}

/** 登录界面拿到的入参（由 {@link pickAccount} 传进 `onShow`）。 */
export interface LoginArgs {
  /** 登录成功：把选中的账号交回闸门，界面随即被关掉。 */
  done(account: LoginAccount): void;
}

export interface AuthSession {
  /** 已认证玩家 id；还没认证成功时是空串。 */
  readonly playerId: string;
  /** 等认证完成（没在认证就发起一次）。重连后会自动重认，本 promise 只代表最近一次。 */
  ready(): Promise<string>;
  dispose(): void;
}

/**
 * 本机设备号 —— 游客登录的凭据。落 `IStorage` 持久化：不存的话每次启动都是新玩家，
 * 上一次的邮件、背包全看不见，连「重登拿回同一个 player」都验不了。
 *
 * 真实项目这里换成渠道 SDK 的账号体系（`provider` 换成 wechat / apple …），
 * 契约不解释 credential 的内容，所以换 provider 不改这条链路的任何一环。
 */
export async function deviceId(storage?: IStorage): Promise<string> {
  const st = storage ?? getRootContainer().tryResolve(STORAGE);
  const got = await st?.get(scopedKey(DEVICE_KEY));
  if (got) return got;
  const id = `cck-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  await st?.set(scopedKey(DEVICE_KEY), id);
  return id;
}

/** 游客账号 —— 一键登录用的那份凭据。 */
export async function deviceAccount(storage?: IStorage): Promise<LoginAccount> {
  return { provider: PROVIDER_DEVICE, credential: await deviceId(storage) };
}

/** 自有账号 —— 账号 + 密码拼成契约要的那一个 credential 串。 */
export function customAccount(name: string, password: string): LoginAccount {
  return { provider: PROVIDER_CUSTOM, credential: `${name}${CREDENTIAL_SEP}${password}` };
}

/** 上次登录的账号名（没有就空串）。只用于预填输入框。 */
export async function lastLoginName(storage?: IStorage): Promise<string> {
  const st = storage ?? getRootContainer().tryResolve(STORAGE);
  return (await st?.get(scopedKey(LAST_NAME_KEY))) ?? '';
}

/** 记住账号名。密码不记 —— 见 {@link LAST_NAME_KEY}。 */
export async function rememberLoginName(name: string, storage?: IStorage): Promise<void> {
  const st = storage ?? getRootContainer().tryResolve(STORAGE);
  await st?.set(scopedKey(LAST_NAME_KEY), name);
}

/**
 * `POST /api/Login` —— 用一份凭据换 token。
 *
 * **不缓存 token**：每条新连接都重登一次。缓存要配一整套失效处理（token 会过期、
 * 会被顶号撤销、被运营踢掉），而重连本来就罕见 —— 一次 HTTP 换掉「缓存 → 用旧 token
 * 认证失败 → 判断该不该重登 → 重登」这整条会写错的分支。
 *
 * `http` 只为测试留的接缝，运行时不传（走 DI 里的 XHR 实现）。
 */
export async function login(
  loginUrl: string,
  account: LoginAccount,
  http?: IHttp,
): Promise<LoginResult> {
  const payload = (await postJson(http ?? getHttp(), loginUrl, account, 10)) as {
    code?: unknown;
    msg?: unknown;
    data?: { token?: unknown; player_id?: unknown; is_new_player?: unknown };
  };
  const code = String(payload?.code ?? '');
  // 业务错误一律 HTTP 200 + body 带 code（CDN / 渠道代理会吞 4xx/5xx）→ 判定看 code 不看状态码。
  if (code !== 'ERROR_CODE_OK' && code !== '1') {
    // 认证失败要给玩家能看懂的话（登录界面直接显示这句）；其余码原样带出去给日志。
    throw new Error(
      code === 'ERROR_CODE_UNAUTHENTICATED'
        ? '账号或密码不对'
        : `登录被拒：${code} ${String(payload?.msg ?? '')}`,
    );
  }
  const token = String(payload?.data?.token ?? '');
  if (!token) throw new Error('登录响应里没有 token');
  return {
    token,
    playerId: String(payload?.data?.player_id ?? ''),
    isNewPlayer: payload?.data?.is_new_player === true,
  };
}

/**
 * 建认证会话。`login` 是「换一个 token」这个动作的接缝 —— 生产由 {@link login}
 * 绑上闸门选中的账号后提供（真打 HTTP），测试注入假的。
 */
export function createAuthSession(net: INetwork, login: () => Promise<string>): AuthSession {
  let playerId = '';
  let inflight: Promise<string> | undefined;

  const doAuth = async (): Promise<string> => {
    const token = await login();
    const res = await net.request('AuthRequest', { token }, { timeoutSec: 10 });
    playerId = String((res.body as { playerId?: string } | undefined)?.playerId ?? '');
    console.log(`${TAG} 已认证 player=${playerId}`);
    return playerId;
  };

  // 认证中再进来的一律并到同一次上：`ready()` 与 onState 可能同时发起，
  // 认两次会让服务端把第一条连接当顶号踢掉。
  const authenticate = (): Promise<string> => {
    if (!inflight) {
      inflight = doAuth().finally(() => {
        inflight = undefined;
      });
    }
    return inflight;
  };

  // 每条**新连接**都要重新认证 —— 网关只认这条连接上发过的 AuthRequest。启动那一次不走
  // 这里（那时连接已经 open，回调不会触发），由 authStep 的 `ready()` 发起；重连与网关
  // 搬家走这里。失败不抛：老路径（core 的退避重连）照常，下一次 open 再认一遍。
  const off = net.onState((s) => {
    if (s !== 'open') return;
    playerId = '';
    void authenticate().catch((e) => console.warn(`${TAG} 重连后认证失败：${String(e)}`));
  });

  return {
    get playerId(): string {
      return playerId;
    },
    ready: authenticate,
    dispose: off,
  };
}

/** DI token：当前 kit 的认证会话。业务侧要 playerId 从这里取，别自己存一份。 */
export const AUTH_SESSION: Token<AuthSession> = createToken<AuthSession>('demo.authSession');

/**
 * 登录闸门 —— 开登录界面，等玩家选一个账号。**每次启动都问**。
 *
 * 为什么不「记住了就自动登录、只有首次才问」：那条路要配套「怎么退出登录」「退出后
 * 怎么重新认证已经建好的连接」，而认证是**连接级**的，换账号等于要把连接拆了重连。
 * 每次问一遍：游客一键就进，换账号也只是换个输入 —— 没有任何要维护的状态。
 *
 * 界面是 `ui/Login.prefab`，挂 `system` 层（必须盖住 `ui` 层的启动界面）；从哪个包取
 * 由马甲皮决定 —— 原皮在本 bundle，马甲在 `skin-<马甲>`（见 `catalog.ts` 的 `skinned()`）。
 * **这里只认 uiId**，换皮换不到这条逻辑上。
 */
export async function pickAccount(): Promise<LoginAccount> {
  const ui = getUIManager();
  return new Promise<LoginAccount>((resolve) => {
    const args: LoginArgs = {
      done: (account) => {
        ui.close(LOGIN_UI);
        resolve(account);
      },
    };
    void ui.open(LOGIN_UI, args).then((ok) => {
      if (ok) return;
      // 界面缺失（prefab 没打进包 / 忘了注册）不该把启动卡死在一个看不见的等待上。
      console.warn(`${TAG} 登录界面 '${LOGIN_UI}' 打不开 → 回退游客登录`);
      void deviceAccount().then(resolve);
    });
  });
}

/**
 * 地基启动的第二步：选账号 → 登录 → 首帧认证，排在 {@link connectNetwork} 之后（要先有连接）。
 *
 * 失败不吞：抛出去由 App 判成 `network`（可重试），LaunchOverlay 给重试按钮 ——
 * 没认证的连接上业务 cmd 全是 `NOT_HANDSHAKED`，放行进大厅只会把错误推迟到玩家点开某个界面时。
 * 重试**不再问一遍账号**：会话建好就留在 DI 里，retry 拿着同一个账号重认。
 */
export async function authenticate(
  loginUrl: string,
  pick: () => Promise<LoginAccount> = pickAccount,
): Promise<void> {
  const root = getRootContainer();
  const net = root.tryResolve(NETWORK);
  if (!net) return; // 单机跑（没配 dispatcher）→ 没有连接可认证
  let session = root.tryResolve(AUTH_SESSION);
  if (!session) {
    const account = await pick();
    if (account.provider === PROVIDER_CUSTOM) {
      await rememberLoginName(account.credential.split(CREDENTIAL_SEP)[0] ?? '');
    }
    // 界面那次登录只为当场验密码；连接要的 token 从这里现取 —— 每条新连接一份，不复用。
    session = createAuthSession(net, async () => (await login(loginUrl, account)).token);
    root.register(AUTH_SESSION, { useValue: session });
  }
  await session.ready();
}

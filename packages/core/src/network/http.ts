import { createToken, getRootContainer, type Token } from '../di';

/**
 * HTTP 短请求接缝。长连接之外还需要它：启动握手（dispatcher）、版本表、公告这类
 * 一问一答的东西架在 socket 上要先连上才能问，而「能不能连」正是握手要回答的。
 *
 * core 只定义形状，真实 IO 在 engine（`createXhrHttp`）。**不返回解析后的对象**：
 * 适配层只负责搬字节，content-type 嗅探 / JSON 解析留在 core 侧（可 node 单测）。
 */

export interface HttpRequest {
  readonly url: string;
  /** 默认 `'GET'`。 */
  readonly method?: 'GET' | 'POST';
  /** 已序列化的请求体。 */
  readonly body?: string;
  readonly headers?: Readonly<Record<string, string>>;
  /** 默认由适配层定（engine 侧 10s）。 */
  readonly timeoutSec?: number;
}

export interface HttpResponse {
  readonly status: number;
  readonly text: string;
}

export interface IHttp {
  /** 传输层出错（DNS / 连不上 / 超时）reject；服务器有回应即 resolve，状态码由调用方判。 */
  request(req: HttpRequest): Promise<HttpResponse>;
}

/** DI token：engine 的 `ccHttpModule()` 注册 XHR 实现。 */
export const HTTP: Token<IHttp> = createToken<IHttp>('cck.http');

/** 取全局 IHttp。core 做不了 IO，所以没有默认实现——没注册就是装配漏了，响亮地说。 */
export function getHttp(): IHttp {
  const http = getRootContainer().tryResolve(HTTP);
  if (!http) {
    throw new Error(
      'getHttp: IHttp 未注册 —— engine 侧把 ccHttpModule() 放进 bootCoreKit 的模块数组',
    );
  }
  return http;
}

/**
 * POST 一个 JSON 并解析回来。服务端契约是 **POST-only RPC**（`POST /api/<Method>`），
 * 且**业务错误一律 HTTP 200** + body 里带 code——CDN / 渠道 SDK 代理 / 企业网关会篡改
 * 甚至吞掉 4xx/5xx，产生无法归因的报错。所以这里只把非 200 当传输层出事。
 */
export async function postJson(
  http: IHttp,
  url: string,
  body: unknown,
  timeoutSec?: number,
): Promise<unknown> {
  const res = await http.request({
    url,
    method: 'POST',
    body: JSON.stringify(body ?? {}),
    headers: { 'Content-Type': 'application/json' },
    timeoutSec,
  });
  if (res.status !== 200) throw new Error(`HTTP ${res.status} @ ${url}`);
  try {
    return JSON.parse(res.text) as unknown;
  } catch {
    throw new Error(`HTTP 响应不是 JSON @ ${url}：${res.text.slice(0, 120)}`);
  }
}

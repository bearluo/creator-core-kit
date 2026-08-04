import { HTTP } from '@cck/core';
import type { HttpRequest, HttpResponse, IHttp, KitModule } from '@cck/core';

/**
 * IHttp 的 XMLHttpRequest 实现 —— HTTP 短请求的「引擎半」。
 *
 * 用 XHR 而不是 `fetch`：Web、native jsb、小游戏适配层**三边都提供** XHR
 * （Cocos 自己的资源下载器就走它），而 `fetch` 在 jsb 上不保证存在。一个壳覆盖全平台，
 * 比按平台写三份好。
 */
export function createXhrHttp(): IHttp {
  return {
    request(req: HttpRequest): Promise<HttpResponse> {
      return new Promise<HttpResponse>((resolve, reject) => {
        if (typeof XMLHttpRequest === 'undefined') {
          reject(new Error('XMLHttpRequest 不可用（该平台需另写 IHttp 适配）'));
          return;
        }
        const xhr = new XMLHttpRequest();
        xhr.open(req.method ?? 'GET', req.url, true);
        for (const [k, v] of Object.entries(req.headers ?? {})) xhr.setRequestHeader(k, v);
        xhr.timeout = Math.max(0, (req.timeoutSec ?? 10) * 1000);
        xhr.onload = (): void => resolve({ status: xhr.status, text: xhr.responseText });
        // XHR 出于同源安全**不告诉你**失败原因（DNS / 拒连 / CORS 全是同一个空事件），
        // 所以错误信息只能给到 url 这一层；要细分得看浏览器控制台。
        xhr.onerror = (): void => reject(new Error(`网络错误 @ ${req.url}`));
        xhr.ontimeout = (): void => reject(new Error(`请求超时 @ ${req.url}`));
        xhr.send(req.body);
      });
    },
  };
}

/** KitModule：注册 `HTTP → XHR 实现`（本层未注册时）。放模块数组里，dispatch 启动步自动拾取。 */
export function ccHttpModule(): KitModule {
  return {
    name: 'http',
    install(ctx) {
      if (!ctx.container.hasLocal(HTTP)) {
        ctx.container.register(HTTP, { useValue: createXhrHttp() });
      }
    },
  };
}

import { afterEach, describe, expect, it } from 'vitest';
import { getHttp, postJson, HTTP, type HttpRequest, type IHttp } from '../http';
import { getRootContainer } from '../../di';

/** 记录请求、按预置回应的 fake IHttp。 */
function fakeHttp(res: { status: number; text: string } | Error) {
  const seen: HttpRequest[] = [];
  const http: IHttp = {
    request(req) {
      seen.push(req);
      return res instanceof Error ? Promise.reject(res) : Promise.resolve(res);
    },
  };
  return { http, seen };
}

describe('IHttp 接缝', () => {
  afterEach(() => getRootContainer().unregister(HTTP));

  it('1. getHttp 未注册 → 抛，且指出装配漏在哪', () => {
    expect(() => getHttp()).toThrow(/ccHttpModule/);
  });

  it('2. getHttp 取注册的实现', () => {
    const { http } = fakeHttp({ status: 200, text: '{}' });
    getRootContainer().register(HTTP, { useValue: http });
    expect(getHttp()).toBe(http);
  });

  it('3. postJson 发 POST + JSON 头 + 序列化体，回解析后的对象', async () => {
    const { http, seen } = fakeHttp({ status: 200, text: '{"code":"OK","data":{"n":1}}' });
    const out = await postJson(http, 'http://x/api/Foo', { a: 1 }, 3);
    expect(out).toEqual({ code: 'OK', data: { n: 1 } });
    expect(seen[0]).toMatchObject({
      url: 'http://x/api/Foo',
      method: 'POST',
      body: '{"a":1}',
      headers: { 'Content-Type': 'application/json' },
      timeoutSec: 3,
    });
  });

  it('4. postJson 体缺省序列化成 {}', async () => {
    const { http, seen } = fakeHttp({ status: 200, text: '{}' });
    await postJson(http, 'http://x/api/Foo', undefined);
    expect(seen[0]?.body).toBe('{}');
  });

  it('5. 非 200 → 抛（业务错误走 200+code，非 200 就是传输层出事）', async () => {
    const { http } = fakeHttp({ status: 405, text: 'POST only' });
    await expect(postJson(http, 'http://x/api/Foo', {})).rejects.toThrow(/HTTP 405/);
  });

  it('6. 回的不是 JSON → 抛，且带上前 120 字符便于认出是网关的错误页', async () => {
    const { http } = fakeHttp({ status: 200, text: '<html>502 Bad Gateway</html>' });
    await expect(postJson(http, 'http://x/api/Foo', {})).rejects.toThrow(/502 Bad Gateway/);
  });

  it('7. 传输层 reject 原样传播', async () => {
    const { http } = fakeHttp(new Error('网络错误 @ http://x/api/Foo'));
    await expect(postJson(http, 'http://x/api/Foo', {})).rejects.toThrow(/网络错误/);
  });
});

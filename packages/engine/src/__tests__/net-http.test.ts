import { afterEach, describe, expect, it } from 'vitest';
import { createXhrHttp } from '../net-http';

/**
 * `createXhrHttp` 的薄壳测试。假的是 **DOM 的 `XMLHttpRequest` 全局**（平台 API），不是 `cc`。
 * 断言的全是本壳自己的接线（方法/头/超时换算/三种结局），不是「真 XHR 会怎样」——
 * 真实往返由 e2e-server.test.ts 打真服务器兜底。
 */

class FakeXhr {
  static made: FakeXhr[] = [];
  method = '';
  url = '';
  timeout = 0;
  status = 0;
  responseText = '';
  readonly headers: Record<string, string> = {};
  sent: unknown;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  constructor() {
    FakeXhr.made.push(this);
  }
  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(k: string, v: string): void {
    this.headers[k] = v;
  }
  send(body: unknown): void {
    this.sent = body;
  }
}

function installFake(): FakeXhr[] {
  FakeXhr.made = [];
  (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest = FakeXhr;
  return FakeXhr.made;
}

afterEach(() => {
  delete (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest;
});

describe('createXhrHttp', () => {
  it('1. POST：方法 / url / 头 / 体全部透传，超时按秒换算成毫秒', async () => {
    const made = installFake();
    const p = createXhrHttp().request({
      url: 'http://x/api/Foo',
      method: 'POST',
      body: '{"a":1}',
      headers: { 'Content-Type': 'application/json' },
      timeoutSec: 3,
    });
    const xhr = made[0]!;
    expect(xhr).toMatchObject({
      method: 'POST',
      url: 'http://x/api/Foo',
      timeout: 3000,
      sent: '{"a":1}',
      headers: { 'Content-Type': 'application/json' },
    });
    xhr.status = 200;
    xhr.responseText = 'ok';
    xhr.onload?.();
    await expect(p).resolves.toEqual({ status: 200, text: 'ok' });
  });

  it('2. 缺省是 GET + 10s 超时', () => {
    const made = installFake();
    void createXhrHttp().request({ url: 'http://x/v.json' });
    expect(made[0]).toMatchObject({ method: 'GET', timeout: 10000, sent: undefined });
  });

  it('3. 非 200 也 resolve —— 状态码交给调用方判（业务错误本就走 200+code）', async () => {
    const made = installFake();
    const p = createXhrHttp().request({ url: 'http://x/' });
    made[0]!.status = 405;
    made[0]!.responseText = 'POST only';
    made[0]!.onload?.();
    await expect(p).resolves.toEqual({ status: 405, text: 'POST only' });
  });

  it('4. onerror → reject，信息带上 url', async () => {
    const made = installFake();
    const p = createXhrHttp().request({ url: 'http://x/api/Foo' });
    made[0]!.onerror?.();
    await expect(p).rejects.toThrow(/网络错误 @ http:\/\/x\/api\/Foo/);
  });

  it('5. ontimeout → reject', async () => {
    const made = installFake();
    const p = createXhrHttp().request({ url: 'http://x/api/Foo' });
    made[0]!.ontimeout?.();
    await expect(p).rejects.toThrow(/超时/);
  });

  it('6. 平台没有 XMLHttpRequest → reject 而不是崩', async () => {
    await expect(createXhrHttp().request({ url: 'http://x/' })).rejects.toThrow(
      /XMLHttpRequest 不可用/,
    );
  });
});

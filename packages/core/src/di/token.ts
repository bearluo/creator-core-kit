/**
 * 类型安全 token。泛型 T 是 phantom（仅编译期携带类型），运行时只有 key/name。
 * key = Symbol.for(...)：同名 token 在任何 bundle 得到同一个 symbol，
 * 即使 token 定义被复制进多个 bundle 也指向容器里同一条注册（见 ADR-0001）。
 */
export interface Token<T> {
  readonly key: symbol;
  readonly name: string;
  /** phantom：仅用于让 T 参与结构、令 resolve 推断出返回类型；运行时永远是 undefined。 */
  readonly __type__?: T;
}

const PREFIX = 'cck.token.';

/** 造 token。同名 name 跨 bundle key 一致（Symbol.for 全局注册表）。 */
export function createToken<T>(name: string): Token<T> {
  return { key: Symbol.for(PREFIX + name), name };
}

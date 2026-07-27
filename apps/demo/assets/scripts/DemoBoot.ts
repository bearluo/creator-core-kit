import { _decorator, Component } from 'cc';
import { CCK_CORE_VERSION, createI18n, createTable, createPool } from '@cck/core';

const { ccclass } = _decorator;

/**
 * demo 集成验证薄壳：在真实 Cocos Creator 运行时里消费 @cck/core（纯 TS、零 cc），
 * 证明「Creator 能从 workspace symlink 的 node_modules 解析并编译 core」+「core 逻辑在真 cc 下可跑」。
 * 只做 console 输出，不含业务逻辑（符合 engine 薄壳约定）。
 */
@ccclass('DemoBoot')
export class DemoBoot extends Component {
  start() {
    const tag = '[CCK-DEMO]';
    console.log(`${tag} core version = ${CCK_CORE_VERSION}`);

    // i18n：查表 + {name} 插值 + 语言切换
    const i18n = createI18n({
      locale: 'zh',
      tables: { zh: { 'demo.hi': '你好 {name}' }, en: { 'demo.hi': 'Hi {name}' } },
    });
    console.log(`${tag} i18n(zh) = ${i18n.t('demo.hi', { name: 'Cocos' })}`);
    i18n.setLocale('en');
    console.log(`${tag} i18n(en) = ${i18n.t('demo.hi', { name: 'Cocos' })}`);

    // ConfigTable：按主键索引 + 查询
    const heroes = createTable('hero', [
      { id: 1, name: 'A', hp: 100 },
      { id: 2, name: 'B', hp: 200 },
    ]);
    console.log(`${tag} table.get(2).hp = ${heroes.get(2)?.hp} / size = ${heroes.size}`);

    // ObjectPool：LIFO 复用
    const pool = createPool<{ n: number }>({ factory: () => ({ n: 0 }) });
    const a = pool.acquire();
    a.n = 42;
    pool.release(a);
    const b = pool.acquire();
    console.log(`${tag} pool LIFO reuse = ${b === a && b.n === 42 ? 'OK' : 'FAIL'}`);

    console.log(`${tag} ✅ core consumed & running under real cc`);
  }
}

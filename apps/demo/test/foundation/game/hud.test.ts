import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MODULE_CATALOG } from '../../../assets/foundation/catalog';

/**
 * View ↔ `Hud.prefab` 的**接缝闸**。
 *
 * 七个 `kind:'game'` 子游戏的界面层住各自 bundle 的 `Hud.prefab`，View 全靠**名字**去取节点
 *（`hudLabel(hud, 'Score')`）。名字对不上的后果是**静默**的：prefab 照样显示、什么都不报，
 * 只是那个读数永远不动 —— 而这一层没有单测能碰到（View 不进单测，靠冒烟兜底）。
 * 所以在这儿把两边的名字对一次账：源码里出现的每个名字，prefab 里都得真有那个节点。
 *
 * 运行时那道守卫在 `foundation/game/stage.ts`（{@link hudNode} 取不到就抛），这里是它的
 * 源码期版本 —— 不必等把游戏点开才发现。
 */

const ASSETS = resolve(__dirname, '../../../assets');

/** 七款子游戏：模块 id → View 文件名。 */
const GAMES: readonly (readonly [string, string])[] = [
  ['mini-dodge', 'DodgeGame'],
  ['mini-plane', 'PlaneGame'],
  ['mini-brick', 'BrickGame'],
  ['mini-shooter', 'ShooterGame'],
  ['mini-hop', 'HopGame'],
  ['mini-cards', 'CardsGame'],
  ['mini-fish', 'FishGame'],
];

/** prefab 里所有节点的路径（`A` 与 `A/B` 都算，View 两种写法都可能用）。 */
function prefabPaths(module: string): Set<string> {
  const raw: unknown[] = JSON.parse(
    readFileSync(resolve(ASSETS, 'modules', module, 'Hud.prefab'), 'utf8'),
  );
  const isNode = (o: unknown): o is { _name: string; _children: { __id__: number }[] } =>
    typeof o === 'object' && o !== null && (o as { __type__?: string }).__type__ === 'cc.Node';

  const out = new Set<string>();
  // 根节点是第一个 cc.Node；它自己不算路径（View 拿到的就是它）
  const rootId = raw.findIndex(isNode);
  const walk = (id: number, prefix: string): void => {
    const node = raw[id];
    if (!isNode(node)) return;
    for (const ref of node._children ?? []) {
      const child = raw[ref.__id__];
      if (!isNode(child)) continue;
      const path = prefix ? `${prefix}/${child._name}` : child._name;
      out.add(path);
      walk(ref.__id__, path);
    }
  };
  walk(rootId, '');
  return out;
}

/** View 源码里按名字取的那些节点。 */
function referencedPaths(module: string, view: string): string[] {
  const src = readFileSync(resolve(ASSETS, 'modules', module, `${view}.ts`), 'utf8');
  const names = new Set<string>();
  for (const m of src.matchAll(/\bhud(?:Label|Node)\(hud, '([^']+)'\)/g)) names.add(m[1]);
  // `wireHud(hud)` 不带路径时默认取 'Back'
  for (const m of src.matchAll(/\bwireHud\(hud(?:, '([^']+)')?\)/g)) names.add(m[1] ?? 'Back');
  return Array.from(names);
}

describe('子游戏的 Hud.prefab', () => {
  it('七个 kind:game 模块一个不少 —— 加了新子游戏就得跟着补一张，别再走代码建 UI 的老路', () => {
    const games = MODULE_CATALOG.filter((e) => e.kind === 'game').map((e) => e.id);
    expect(Array.from(games).sort()).toEqual(GAMES.map(([id]) => id).sort());
  });

  for (const [module, view] of GAMES) {
    it(`${module}：View 按名字取的节点，prefab 里都真有`, () => {
      const have = prefabPaths(module);
      const want = referencedPaths(module, view);
      // 一个都没取到 = 正则失配或 View 又改回代码建 UI，两种都得当场红
      expect(want.length, `${view}.ts 里一个 hudLabel / hudNode / wireHud 都没有`).toBeGreaterThan(0);
      const missing = want.filter((p) => !have.has(p));
      expect(missing, `${module}/Hud.prefab 里没有：${missing.join('、')}（有的是 ${Array.from(have).join('、')}）`).toEqual([]);
    });
  }
});

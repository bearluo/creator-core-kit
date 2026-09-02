import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * View 与 prefab 的**接缝**测试。
 *
 * `FishEditor` 只做四件事，其中「取组件」全靠**按名字找节点**（`at(root, 'Body/Stage/Board')`
 * 这样九十来处）。改 prefab 描述时挪个层级、改个名字，编译照过、运行照跑，只是**那个绑定
 * 静默消失** —— 按钮点了没反应、标签永远不刷新，而且不抛任何错。这种 bug 从现象反推极难。
 *
 * 所以这里把两边对一遍：源码里每一处查找，都得在它**该在的那张** prefab 里真有这个节点。
 * 读的是仓库里的 `.prefab` 文件（纯 JSON），零 `cc`、node 直跑。
 */
const DIR = fileURLToPath(new URL('../../../assets/modules/mini-fish-editor/', import.meta.url));
const PREFABS = ['EditorPanel', 'PathPage', 'WavePage', 'PathItem', 'GroupItem'] as const;

/** 一张 prefab 里所有节点的路径（相对根，不含根自己）。 */
function nodePaths(name: string): Set<string> {
  const j = JSON.parse(readFileSync(DIR + name + '.prefab', 'utf8')) as Record<string, unknown>[];
  const out = new Set<string>();
  const walk = (id: number, prefix: string | null): void => {
    const n = j[id] as { __type__?: string; _name?: string; _children?: { __id__: number }[] };
    if (!n || n.__type__ !== 'cc.Node') return;
    const here = prefix === null ? '' : prefix ? `${prefix}/${n._name}` : String(n._name);
    if (here) out.add(here);
    for (const c of n._children ?? []) walk(c.__id__, prefix === null ? '' : here);
  };
  walk(1, null);
  return out;
}

/** 每处查找的**上下文变量**决定它该落在哪张 prefab 上。 */
const RULES: readonly [RegExp, readonly string[]][] = [
  [/\bat\((?:this\.)?root, '([^']+)'\)/g, ['EditorPanel']],
  [/\bsetText\('([^']+)'/g, ['EditorPanel']],
  [/\bat\(page, '([^']+)'\)/g, ['PathPage', 'WavePage']],
  [/\bsetLabel\(page, '([^']+)'/g, ['PathPage', 'WavePage']],
  [/\bbindNum\(page, '([^']+)'/g, ['PathPage', 'WavePage']],
  [/\bat\(item, '([^']+)'\)/g, ['PathItem', 'GroupItem']],
  [/\bsetLabel\(item, '([^']+)'/g, ['PathItem', 'GroupItem']],
  [/\bbindNum\(item, '([^']+)'/g, ['GroupItem']],
];

describe('FishEditor 与 prefab 的接缝', () => {
  const trees = new Map(PREFABS.map((n) => [n as string, nodePaths(n)]));
  const src = readFileSync(DIR + 'FishEditor.ts', 'utf8');

  it('源码里每一处按名字取节点，都在对应的 prefab 里真有那个节点', () => {
    const missing: string[] = [];
    let checked = 0;
    for (const [re, where] of RULES) {
      for (const m of src.matchAll(re)) {
        checked++;
        if (!where.some((w) => trees.get(w)!.has(m[1]))) {
          missing.push(`${m[1]} —— 在 ${where.join(' / ')} 里都找不到`);
        }
      }
    }
    expect(checked).toBeGreaterThan(40); // 正则一失效就退化成空跑，先钉住规模
    expect(missing).toEqual([]);
  });

  it('`◀ 输入框 ▶` 每一组的三个子节点齐全 —— 少一个就是那个方向按不动', () => {
    const missing: string[] = [];
    for (const m of src.matchAll(/\bbindNum\((?:page|item), '([^']+)'/g)) {
      for (const leaf of ['Dec', 'Value', 'Inc']) {
        const path = `${m[1]}/${leaf}`;
        const found = PREFABS.some((n) => trees.get(n)!.has(path));
        if (!found) missing.push(path);
      }
    }
    expect(missing).toEqual([]);
  });

  it('五张 prefab 都在，且各自的根节点名字跟文件名一致', () => {
    for (const name of PREFABS) {
      const j = JSON.parse(readFileSync(DIR + name + '.prefab', 'utf8')) as { __type__?: string; _name?: string }[];
      expect(j[1]?._name, name).toBe(name);
    }
  });
});

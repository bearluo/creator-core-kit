import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 全工程的 prefab 闸：**序列化结构自洽**。
 *
 * `.prefab` 是一个按下标互相引用的对象数组，手改（或脚本生成）时最容易出的四类错，
 * 共同点是**没有一处会当场报错**：
 *
 * 1. `__id__` 指向不存在的下标 → 运行时 `undefined`，表现成「界面少了一块」；
 * 2. 组件的 `node` 与节点的 `_components` 对不上 → 组件孤儿，逻辑不跑；
 * 3. **组件缺 `__prefab`（`cc.CompPrefabInfo`）或节点缺 `_prefab`（`cc.PrefabInfo`）**
 *    → 运行时 `instantiate` 得出来，**编辑器一打开就崩** `reading 'instance'`
 *    （CLAUDE.md「多人协作」里点名的那个坑）；
 * 4. `fileId` 在同一文件里撞车 → 编辑器把两个组件当同一个，改一个动两个。
 *
 * 这几条是「能不能安全地用脚本改 prefab」的前提，所以单独立一道闸，而不是塞进业务测试。
 */
const ASSETS = fileURLToPath(new URL('../assets/', import.meta.url));

interface Obj {
  __type__?: string;
  _name?: string;
  _children?: { __id__: number }[];
  _components?: { __id__: number }[];
  _parent?: { __id__: number } | null;
  _prefab?: { __id__: number };
  __prefab?: { __id__: number };
  node?: { __id__: number };
  fileId?: string;
}

function prefabs(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) prefabs(p, out);
    else if (e.name.endsWith('.prefab')) out.push(p);
  }
  return out;
}

/** 返回人能读的问题列表，空数组 = 结构自洽。 */
export function checkPrefab(objs: Obj[]): string[] {
  const bad: string[] = [];
  const at = (id: number | undefined): Obj | undefined => (id === undefined ? undefined : objs[id]);
  const isNode = (o: Obj | undefined): boolean => o?.__type__ === 'cc.Node';
  const isComp = (o: Obj): boolean =>
    typeof o.__type__ === 'string' && o.node !== undefined && !isNode(o);

  // ① 所有 __id__ 引用都落在数组内
  const scan = (v: unknown, where: string): void => {
    if (v === null || typeof v !== 'object') return;
    const o = v as Record<string, unknown>;
    if (typeof o.__id__ === 'number') {
      if (!(o.__id__ >= 0 && o.__id__ < objs.length))
        bad.push(`${where} 引用了不存在的 __id__ ${o.__id__}`);
      return;
    }
    for (const [k, val] of Object.entries(o)) scan(val, `${where}.${k}`);
  };
  objs.forEach((o, i) => scan(o, `[${i}]${o?.__type__ ?? ''}`));
  if (bad.length) return bad; // 引用都不对，后面的检查没意义

  objs.forEach((o, i) => {
    if (!o || typeof o.__type__ !== 'string') return;
    const tag = `[${i}]${o.__type__}`;

    // ② 组件 ↔ 节点双向对得上
    if (isComp(o)) {
      const n = at(o.node?.__id__);
      if (!isNode(n)) bad.push(`${tag} 的 node 不是 cc.Node`);
      else if (!(n?._components ?? []).some((c) => c.__id__ === i))
        bad.push(`${tag} 挂在 ${n?._name} 上，但对方的 _components 里没有它（孤儿组件）`);

      // ③ 组件必须有 CompPrefabInfo
      const pi = at(o.__prefab?.__id__);
      if (pi?.__type__ !== 'cc.CompPrefabInfo')
        bad.push(`${tag}（${n?._name}）缺 cc.CompPrefabInfo —— 编辑器打开会崩`);
    }

    if (isNode(o)) {
      // ③ 节点必须有 PrefabInfo
      const pi = at(o._prefab?.__id__);
      if (pi?.__type__ !== 'cc.PrefabInfo')
        bad.push(`${tag} ${o._name} 缺 cc.PrefabInfo —— 编辑器打开会崩`);
      // ② 父子双向对得上
      for (const c of o._children ?? []) {
        const kid = at(c.__id__);
        if (!isNode(kid)) bad.push(`${tag} ${o._name} 的子节点 ${c.__id__} 不是 cc.Node`);
        else if (kid?._parent?.__id__ !== i)
          bad.push(`${tag} ${o._name} 认 ${kid?._name} 当儿子，但对方的 _parent 指向别处`);
      }
    }
  });

  // ④ fileId 不许撞车
  const seen = new Map<string, number>();
  objs.forEach((o, i) => {
    if (typeof o?.fileId !== 'string') return;
    const prev = seen.get(o.fileId);
    if (prev !== undefined) bad.push(`fileId ${o.fileId} 在 [${prev}] 和 [${i}] 上重复`);
    seen.set(o.fileId, i);
  });

  return bad;
}

describe('checkPrefab（判据本身）', () => {
  const ok: Obj[] = [
    { __type__: 'cc.Prefab' },
    {
      __type__: 'cc.Node',
      _name: 'Root',
      _parent: null,
      _children: [],
      _components: [{ __id__: 2 }],
      _prefab: { __id__: 4 },
    },
    {
      __type__: 'cc.UITransform',
      node: { __id__: 1 },
      __prefab: { __id__: 3 },
    },
    { __type__: 'cc.CompPrefabInfo', fileId: 'aaaaaaaaaaaaaaaaaaaaaa' },
    { __type__: 'cc.PrefabInfo', fileId: 'bbbbbbbbbbbbbbbbbbbbbb' },
  ];

  it('1. 结构自洽的 prefab 什么都不报', () => {
    expect(checkPrefab(ok)).toEqual([]);
  });

  it('2. 组件缺 CompPrefabInfo → 报出来（这条就是「编辑器一打开就崩」）', () => {
    const broken = structuredClone(ok);
    delete broken[2].__prefab;
    expect(checkPrefab(broken).join()).toContain('缺 cc.CompPrefabInfo');
  });

  it('3. 组件没被节点认领 → 报孤儿', () => {
    const broken = structuredClone(ok);
    broken[1]._components = [];
    expect(checkPrefab(broken).join()).toContain('孤儿组件');
  });

  it('4. __id__ 指向数组外 → 报出来', () => {
    const broken = structuredClone(ok);
    broken[1]._components = [{ __id__: 99 }];
    expect(checkPrefab(broken).join()).toContain('不存在的 __id__ 99');
  });

  it('5. fileId 撞车 → 报出来', () => {
    const broken = structuredClone(ok);
    broken[4].fileId = 'aaaaaaaaaaaaaaaaaaaaaa';
    expect(checkPrefab(broken).join()).toContain('重复');
  });
});

describe('全工程 prefab', () => {
  it('6. 序列化结构全部自洽', () => {
    const bad: string[] = [];
    for (const file of prefabs(ASSETS)) {
      const rel = file.slice(ASSETS.length).replace(/\\/g, '/');
      for (const line of checkPrefab(JSON.parse(readFileSync(file, 'utf8')) as Obj[]))
        bad.push(`${rel} :: ${line}`);
    }
    expect(bad).toEqual([]);
  });
});

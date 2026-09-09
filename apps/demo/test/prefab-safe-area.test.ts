import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 全工程的 prefab 闸：**贴着屏幕边排的界面，必须待在安全区里**。
 *
 * 异形屏把顶上一条（挖孔 / 刘海）和底下一条（圆角 / home 条）从可用区域里挖走了，
 * 而这件事**在本机预览和大多数机器上都看不出来**——它只在特定机型上、只在那一条上显形：
 * 按钮画在挖孔底下，看得见一半、点不着。等到测出来时通常已经上线。
 *
 * 判据用 `Widget` 的对齐位（`cocos/ui/widget.ts`：TOP=1 MID=2 BOT=4 LEFT=8 CENTER=16 RIGHT=32）：
 *
 * - **一根轴上只锚一边** = 「我贴着这条边排」 → 这条边是屏幕边还是安全区边，必须表态；
 * - **一根轴上两边都锚**（拉伸）= 容器 / 满屏底 → 放行，它本来就该铺满（背景、遮罩、转屏提示）。
 *
 * 表态的方式只有一个：自己或某个祖先挂引擎内置的 `cc.SafeArea`（它把
 * `sys.getSafeAreaRect()` 换算成 `Widget` 的四边 margin，并自己跟着转屏重算）。
 * **不接受**「把 top 从 45 改成 180」这类手写补偿——换台机器就错，见
 * `packages/engine/docs/modules/camera-rig.md` 的「安全区」一节。
 *
 * ⚠️ `cc.SafeArea` 把内缩量当**相对父节点**的 margin 写下去，所以它自己的父必须正好是整个可视区。
 * kit 里这条天然成立：UIManager 的层容器不带 `UITransform`，子节点的 Widget 走 `isRoot` 分支
 * 对齐 `visibleRect`。因此**挂在界面根上**就是对的，往下挂到某个小容器上反而会错。
 */
const ASSETS = fileURLToPath(new URL('../assets/', import.meta.url));

const TOP = 1;
const BOT = 4;
const LEFT = 8;
const RIGHT = 32;

interface Obj {
  __type__?: string;
  _name?: string;
  _children?: { __id__: number }[];
  _components?: { __id__: number }[];
  _alignFlags?: number;
  node?: { __id__: number };
}

/** 一根轴上只锚一边 = 贴边；两边都锚（拉伸）或都不锚 = 不贴边。 */
function pinnedEdges(flags: number): string[] {
  const out: string[] = [];
  if (Boolean(flags & TOP) !== Boolean(flags & BOT)) out.push(flags & TOP ? '上' : '下');
  if (Boolean(flags & LEFT) !== Boolean(flags & RIGHT)) out.push(flags & LEFT ? '左' : '右');
  return out;
}

/**
 * 找出「贴边却没进安全区」的节点。返回人能读的一行行描述，空数组 = 干净。
 * 纯函数，喂 prefab 反序列化出来的那个对象数组即可（下面既拿 fixture 测它、也拿它扫全工程）。
 */
export function findUnsafePins(objs: Obj[]): string[] {
  const bad: string[] = [];
  const compsOf = (n: Obj): Obj[] => (n._components ?? []).map((c) => objs[c.__id__]);

  const walk = (id: number, path: string, safeAbove: boolean): void => {
    const n = objs[id];
    if (!n || n.__type__ !== 'cc.Node') return;
    const here = path ? `${path}/${n._name}` : String(n._name);
    const comps = compsOf(n);
    // 自己挂了 SafeArea 就把整棵子树罩住了——它把自己缩进安全区，子孙的 margin 都相对它算。
    const safe = safeAbove || comps.some((c) => c?.__type__ === 'cc.SafeArea');
    for (const c of comps) {
      if (c?.__type__ !== 'cc.Widget') continue;
      const edges = pinnedEdges(c._alignFlags ?? 0);
      if (edges.length > 0 && !safe) bad.push(`${here} 贴${edges.join('/')}边，却没有 SafeArea`);
    }
    for (const c of n._children ?? []) walk(c.__id__, here, safe);
  };

  walk(1, '', false); // prefab 的根恒在 index 1
  return bad;
}

function prefabs(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) prefabs(p, out);
    else if (e.name.endsWith('.prefab')) out.push(p);
  }
  return out;
}

/** 造一份最小 prefab 形状的对象数组：index 0 占位（真 prefab 是 cc.Prefab），index 1 是根。 */
function fixture(nodes: Obj[]): Obj[] {
  return [{ __type__: 'cc.Prefab' } as Obj].concat(nodes);
}

describe('findUnsafePins（判据本身）', () => {
  it('1. 四边都锚的拉伸容器放行 —— 那是满屏底/遮罩，本来就该铺满', () => {
    expect(
      findUnsafePins(
        fixture([
          { __type__: 'cc.Node', _name: 'Root', _components: [{ __id__: 2 }] },
          {
            __type__: 'cc.Widget',
            _alignFlags: TOP | BOT | LEFT | RIGHT,
            node: { __id__: 1 },
          },
        ]),
      ),
    ).toEqual([]);
  });

  it('2. 只锚上边、没有 SafeArea → 报出来（挖孔底下的返回键就是这样来的）', () => {
    expect(
      findUnsafePins(
        fixture([
          { __type__: 'cc.Node', _name: 'Hud', _children: [{ __id__: 2 }] },
          { __type__: 'cc.Node', _name: 'Back', _components: [{ __id__: 3 }] },
          { __type__: 'cc.Widget', _alignFlags: TOP, node: { __id__: 2 } },
        ]),
      ),
    ).toEqual(['Hud/Back 贴上边，却没有 SafeArea']);
  });

  it('3. 祖先挂了 SafeArea → 整棵子树放行', () => {
    expect(
      findUnsafePins(
        fixture([
          {
            __type__: 'cc.Node',
            _name: 'Hud',
            _components: [{ __id__: 4 }],
            _children: [{ __id__: 2 }],
          },
          { __type__: 'cc.Node', _name: 'Back', _components: [{ __id__: 3 }] },
          { __type__: 'cc.Widget', _alignFlags: TOP, node: { __id__: 2 } },
          { __type__: 'cc.SafeArea', node: { __id__: 1 } },
        ]),
      ),
    ).toEqual([]);
  });

  it('4. 只锚下边、只锚左右也一样算贴边（横屏时挖孔落在侧边）', () => {
    const one = (flags: number): string[] =>
      findUnsafePins(
        fixture([
          { __type__: 'cc.Node', _name: 'N', _components: [{ __id__: 2 }] },
          { __type__: 'cc.Widget', _alignFlags: flags, node: { __id__: 1 } },
        ]),
      );
    expect(one(BOT)).toEqual(['N 贴下边，却没有 SafeArea']);
    expect(one(LEFT)).toEqual(['N 贴左边，却没有 SafeArea']);
    expect(one(RIGHT)).toEqual(['N 贴右边，却没有 SafeArea']);
    expect(one(TOP | RIGHT)).toEqual(['N 贴上/右边，却没有 SafeArea']);
  });

  it('5. 一个 Widget 都不挂 = 靠坐标摆在中间，与安全区无关，放行', () => {
    expect(
      findUnsafePins(
        fixture([
          { __type__: 'cc.Node', _name: 'Card', _children: [{ __id__: 2 }] },
          { __type__: 'cc.Node', _name: 'Title' },
        ]),
      ),
    ).toEqual([]);
  });
});

describe('全工程 prefab', () => {
  const files = prefabs(ASSETS);

  it('6. 扫到了 prefab —— 目录挪走后闸会退化成空跑，先钉住规模', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it('7. 贴边的界面都在安全区里', () => {
    const bad: string[] = [];
    for (const file of files) {
      const objs = JSON.parse(readFileSync(file, 'utf8')) as Obj[];
      const rel = file.slice(ASSETS.length).replace(/\\/g, '/');
      for (const line of findUnsafePins(objs)) bad.push(`${rel} :: ${line}`);
    }
    expect(bad).toEqual([]);
  });
});

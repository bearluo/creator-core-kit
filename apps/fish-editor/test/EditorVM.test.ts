import { describe, expect, it } from 'vitest';
import {
  EditorVM,
  memoryEditorStorage,
} from '../src/EditorVM';
import type { FishContent } from '@game/content/content-types';
import { waveFeeder } from '@game/seams/feeder';
import { MIN_HANDLE } from '@game/content/paths';

const SRC: FishContent = {
  rev: 3,
  paths: [
    { id: 'a', p: [-1160, 0, -400, 0, 400, 0, 1160, 0] },
    { id: 'b', p: [1160, 260, 400, 260, -400, 260, -1160, 260] },
  ],
  waves: [
    {
      id: 'w',
      groups: [
        { at: 0, path: 'a', kind: 'fish_yellow', count: 2, gap: 0.5, speed: 100 },
        { at: 1, path: 'b', kind: 'fish_red', count: 1, speed: 90 },
      ],
    },
  ],
};

describe('EditorVM · 载入', () => {
  it('载入即深拷贝 —— 编辑器改草稿不许动到源码那份对象', () => {
    const vm = new EditorVM(SRC);
    vm.dragPoint(0, 5, 5);
    expect(SRC.paths[0].p[0]).toBe(-1160);
    expect(vm.draft.paths[0].p[0]).toBe(5);
  });

  it('gap 省略的 group 补成 0 —— 草稿里字段齐全，View 不必到处 ?? 0', () => {
    const vm = new EditorVM(SRC);
    expect(vm.draft.waves[0].groups[1].gap).toBe(0);
  });
});

describe('EditorVM · 路径', () => {
  it('新路径从选中那条复制起手，id 自动去重并选中新的', () => {
    const vm = new EditorVM(SRC);
    vm.copyPath();
    expect(vm.draft.paths).toHaveLength(3);
    expect(vm.draft.paths[2].id).toBe('a-2');
    expect(vm.draft.paths[2].p).toEqual(SRC.paths[0].p);
    expect(vm.selectedPath).toBe(2);
  });

  it('删掉被引用的路径 ⇒ 那个 group 进**未解析态**，不静默改指别处', () => {
    const vm = new EditorVM(SRC);
    vm.removePath(); // 选中的是第 0 条 'a'
    expect(vm.draft.paths.map((p) => p.id)).toEqual(['b']);
    // 引用 'a' 的那个 group 仍然写着 'a' —— 它现在解析不到，View 据此标红
    expect(vm.unresolved()).toEqual([{ wave: 0, group: 0, path: 'a' }]);
    // 换成下标的话这里会静默变成「指向 b」，鱼照游、只是走错路 —— 那正是选稳定 id 要避免的
    expect(vm.draft.waves[0].groups[0].path).toBe('a');
  });

  it('最后一条路径删不掉 —— 没有路径的内容没法编', () => {
    const vm = new EditorVM({ rev: 1, paths: [{ id: 'a', p: [0, 0, 1, 0, 2, 0, 3, 0] }], waves: [] });
    vm.removePath();
    expect(vm.draft.paths).toHaveLength(1);
  });
});

describe('EditorVM · 控制点', () => {
  it('命中判定按世界坐标 + 容差，返回控制点下标', () => {
    const vm = new EditorVM(SRC); // 选中 'a'：(-1160,0) (-400,0) (400,0) (1160,0)
    expect(vm.hitTest(-1155, 3, 12)).toBe(0);
    expect(vm.hitTest(400, 0, 12)).toBe(2);
    expect(vm.hitTest(0, 0, 12)).toBeNull(); // 曲线上，但不是控制点
  });

  it('拖拽落点写进选中路径的那个控制点', () => {
    const vm = new EditorVM(SRC);
    vm.dragPoint(3, 900, -120);
    expect(vm.draft.paths[0].p.slice(6)).toEqual([900, -120]);
  });
});

describe('EditorVM · 鱼阵', () => {
  it('加 / 删 group，以及改一个 group 的旋钮', () => {
    const vm = new EditorVM(SRC);
    vm.addGroup();
    expect(vm.draft.waves[0].groups).toHaveLength(3);
    vm.patchGroup(2, { count: 7, speed: 150 });
    expect(vm.draft.waves[0].groups[2].count).toBe(7);
    expect(vm.draft.waves[0].groups[2].speed).toBe(150);
    vm.removeGroup(2);
    expect(vm.draft.waves[0].groups).toHaveLength(2);
  });

  it('新阵 id 去重，且选中切到新阵', () => {
    const vm = new EditorVM(SRC);
    vm.addWave();
    expect(vm.draft.waves[1].id).toBe('wave');
    vm.addWave(); // 再来一个才撞名
    expect(vm.draft.waves[2].id).toBe('wave-2');
    expect(vm.selectedWave).toBe(2);
  });
});

describe('EditorVM · 导出', () => {
  it('rev 只在导出时 +1 —— 编辑过程中一动不动', () => {
    const vm = new EditorVM(SRC);
    vm.dragPoint(0, 1, 1);
    vm.addGroup();
    expect(vm.draft.rev).toBe(3);
    const text = vm.exportText();
    expect(vm.draft.rev).toBe(4);
    expect(text).toContain('rev: 4');
  });

  it('导出的内容游戏吃得下 —— 直接喂 waveFeeder 能跑出鱼', () => {
    const vm = new EditorVM(SRC);
    const content = vm.toContent();
    const out = waveFeeder(content, { order: ['w'] }).next(2);
    expect(out).toHaveLength(3); // 2 条 + 1 条
  });

  it('导出文本是 content.ts 的全文：带头部注释、import 与 as const satisfies', () => {
    const text = new EditorVM(SRC).exportText();
    expect(text).toContain("import type { FishContent } from './content-types'");
    expect(text).toContain('export const CONTENT = {');
    expect(text).toContain('} as const satisfies FishContent;');
    expect(text.endsWith('\n')).toBe(true);
  });

  it('省略 gap 的 group 导出时不写这个字段 —— 默认值不该占一行 diff', () => {
    const text = new EditorVM(SRC).exportText();
    expect(text).toContain("{ at: 1, path: 'b', kind: 'fish_red', count: 1, speed: 90 }");
  });
});

describe('EditorVM · 草稿', () => {
  const key = 'test.draft';

  it('默认显示源码那份，**不自动恢复**草稿 —— 自动恢复会拿旧草稿盖掉别人贴回的内容', () => {
    const storage = memoryEditorStorage();
    const a = new EditorVM(SRC, { storage, storageKey: key, now: () => 1000 });
    a.dragPoint(0, 42, 42);
    a.saveDraft();

    const b = new EditorVM(SRC, { storage, storageKey: key, now: () => 2000 });
    expect(b.draft.paths[0].p[0]).toBe(-1160); // 还是源码那份
    expect(b.draftInfo()).toEqual({ rev: 3, savedAt: 1000 });

    b.restoreDraft();
    expect(b.draft.paths[0].p[0]).toBe(42);
  });

  it('草稿记的是**基线** rev（源码那个），不是导出后的新值', () => {
    const storage = memoryEditorStorage();
    const vm = new EditorVM(SRC, { storage, storageKey: key, now: () => 5 });
    vm.exportText(); // rev 3 → 4
    vm.saveDraft();
    expect(new EditorVM(SRC, { storage, storageKey: key }).draftInfo()?.rev).toBe(4);
  });

  it('丢弃后就没有了；存坏了也当没有 —— 一行脏数据不许把编辑器卡死', () => {
    const storage = memoryEditorStorage();
    const vm = new EditorVM(SRC, { storage, storageKey: key });
    vm.saveDraft();
    vm.discardDraft();
    expect(vm.draftInfo()).toBeNull();

    storage.write(key, '{ 这不是 JSON');
    expect(new EditorVM(SRC, { storage, storageKey: key }).draftInfo()).toBeNull();
  });

  it('没给 storage 就整个不落盘（node 单测 / 没有 localStorage 的宿主）', () => {
    const vm = new EditorVM(SRC);
    vm.saveDraft();
    expect(vm.draftInfo()).toBeNull();
  });
});

describe('EditorVM · 变更通知', () => {
  it('每次改动 changed +1，View 订阅它整体重画', () => {
    const vm = new EditorVM(SRC);
    const before = vm.changed.value;
    vm.addGroup();
    vm.dragPoint(0, 1, 1);
    expect(vm.changed.value).toBe(before + 2);
  });
});

/**
 * 多段编辑。一条路径是 `6n+2` 的分段贝塞尔链，编辑器要能加段、删段、拖任意一个控制点，
 * 并且**拖的时候不许把形状拽坏** —— 三条规矩：
 *
 * - 拖**锚点**：两侧手柄刚性跟随（否则挪一下整段就变形了）。
 * - 拖**手柄**：接点对面那个只对齐方向、**保留原长**（拖这一段不该把另一段也拉变形）。
 * - 手柄离锚点不许近于 `MIN_HANDLE`：贴上去导数退化成 0 ⇒ 鱼**突然朝右**，不崩不报错。
 */
describe('EditorVM · 多段路径', () => {
  /** 两段共 7 个点，全部共线：接点是第 3 个点 (600,0)，两侧手柄各离它 200。 */
  const TWO_SEG: FishContent = {
    rev: 1,
    paths: [{ id: 'two', p: [0, 0, 200, 0, 400, 0, 600, 0, 800, 0, 1000, 0, 1200, 0] }],
    waves: [],
  };
  const two = (): EditorVM => new EditorVM(TWO_SEG);

  it('段数按 6n+2 数出来，加一段 +6 个数、删一段 -6 个数', () => {
    const vm = new EditorVM(SRC); // 单段：8 个数
    expect(vm.segments()).toBe(1);
    vm.addSegment();
    expect(vm.segments()).toBe(2);
    expect(vm.draft.paths[0].p).toHaveLength(14);
    vm.removeSegment();
    expect(vm.segments()).toBe(1);
    expect(vm.draft.paths[0].p).toHaveLength(8);
  });

  it('新段顺着末端切线接出去 ⇒ 天然平滑，不产生折角', () => {
    const vm = new EditorVM(SRC); // 'a' 是一条向右的直线
    vm.addSegment();
    expect(vm.corners()).toEqual([]);
    expect(vm.selectedSegment).toBe(1); // 加完就选中新那段
    const p = vm.draft.paths[0].p;
    expect(p[8]).toBeGreaterThan(p[6]); // 确实往前接，不是往回折
  });

  it('只剩一段不许删 —— 删空了就没有路径可言了', () => {
    const vm = new EditorVM(SRC);
    vm.removeSegment();
    expect(vm.segments()).toBe(1);
    expect(vm.draft.paths[0].p).toHaveLength(8);
  });

  it('命中判定扫全部控制点，不是写死的前 4 个', () => {
    const vm = two(); // 7 个点
    expect(vm.hitTest(1200, 0, 12)).toBe(6);
    expect(vm.hitTest(800, 0, 12)).toBe(4);
  });

  it('控制点归段：第 k 段吃下标 3k..3k+3，末锚点夹回最后一段', () => {
    const vm = two();
    expect(vm.segmentOf(0)).toBe(0);
    expect(vm.segmentOf(2)).toBe(0);
    expect(vm.segmentOf(3)).toBe(1); // 接点算后一段的起点
    expect(vm.segmentOf(6)).toBe(1); // floor(6/3)=2 越界，夹回
  });

  it('换路径后段号自愈 —— 从 3 段那条切到单段那条不会留个越界的段号', () => {
    const vm = new EditorVM({
      rev: 1,
      paths: [TWO_SEG.paths[0], { id: 'one', p: [0, 0, 1, 0, 2, 0, 3, 0] }],
      waves: [],
    });
    vm.selectedSegment = 1;
    vm.selectedPath = 1;
    expect(vm.selectedSegment).toBe(0);
  });

  it('拖锚点：两侧手柄刚性跟随，形状不变', () => {
    const vm = two();
    vm.dragPoint(3, 600, 500); // 接点往上抬 500
    const p = vm.draft.paths[0].p;
    expect(p.slice(4, 10)).toEqual([400, 500, 600, 500, 800, 500]);
  });

  it('拖手柄：对面镜像方向、**保留原长**', () => {
    const vm = two();
    vm.dragPoint(4, 600, 300); // 出向手柄扳成朝上，离锚点 300
    const p = vm.draft.paths[0].p;
    expect(p.slice(8, 10)).toEqual([600, 300]);
    expect(p.slice(4, 6)).toEqual([600, -200]); // 对面转到反方向，长度仍是 200
  });

  it('按住不镜像（Alt）就只动这一个 ⇒ 故意折出一个角', () => {
    const vm = two();
    vm.dragPoint(4, 600, 300, { mirror: false });
    expect(vm.draft.paths[0].p.slice(4, 6)).toEqual([400, 0]); // 对面纹丝不动
    expect(vm.corners()).toEqual([{ seg: 1, deg: 90 }]);
  });

  it('手柄拖到锚点上：夹到 MIN_HANDLE、方向沿用原来那条，对面保持原长', () => {
    const vm = two();
    vm.dragPoint(4, 600, 0); // 正好压在接点上 ⇒ 方向未定义
    const p = vm.draft.paths[0].p;
    expect(p.slice(8, 10)).toEqual([600 + MIN_HANDLE, 0]); // 沿用原方向（+x）推出去
    expect(Math.hypot(p[4] - 600, p[5] - 0)).toBeCloseTo(200, 6); // 对面没被一起塌掉
  });

  it('塌到最小值之后还拽得回来 —— 这是「对面保留原长」必须带下限的原因', () => {
    const vm = two();
    vm.dragPoint(2, 600, 0); // 进向手柄压到接点上 ⇒ 夹成 60
    expect(Math.hypot(vm.draft.paths[0].p[4] - 600, vm.draft.paths[0].p[5])).toBeCloseTo(60, 6);
    vm.dragPoint(2, 258, 0); // 再拖远
    expect(Math.hypot(vm.draft.paths[0].p[4] - 600, vm.draft.paths[0].p[5])).toBeCloseTo(342, 6);
  });

  it('对面那个已经塌在锚点上时，拖这一边把它救回来 —— 用户报的「后面变成一个点」就是这个', () => {
    // 一条**接点出向手柄压在锚点上**的路径（手编的旧数据，或没有下限时镜像塌出来的）。
    // 没有下限的话 `len` 恒为 0，镜像每次都把它算回锚点 ⇒ 那个点永远回不来。
    const vm = new EditorVM({
      rev: 1,
      paths: [{ id: 'flat', p: [0, 0, 200, 0, 400, 0, 600, 0, 600, 0, 1000, 0, 1200, 0] }],
      waves: [],
    });
    vm.dragPoint(2, 300, 0); // 拖进向手柄，出向手柄跟着被镜像
    const p = vm.draft.paths[0].p;
    expect(Math.hypot(p[8] - 600, p[9] - 0)).toBeCloseTo(MIN_HANDLE, 6);
  });

  it('首尾锚点没有对面，镜像时不越界', () => {
    const vm = two();
    expect(() => vm.dragPoint(1, 200, 400)).not.toThrow();
    expect(vm.draft.paths[0].p.slice(0, 2)).toEqual([0, 0]); // 起点锚点没被动过
  });

  it('折角报得出段号与度数，给 View 标红', () => {
    const vm = two();
    expect(vm.corners()).toEqual([]); // 共线 = 不是折角
    vm.dragPoint(4, 600, 300, { mirror: false });
    expect(vm.corners()).toEqual([{ seg: 1, deg: 90 }]);
  });
});

/**
 * **往返闸**：拿仓库里那份 `content.ts` 原样导出一遍，除 `rev` 那一行外必须**逐字节相同**。
 *
 * 它挡的是一类特别阴的漂：导出文本的**头注释在两处**（这份文件里的字符串 + `content.ts` 本身），
 * 改了其中一处，下一次导出会把另一处**静默盖掉** —— 而人只会看 `git diff` 里那几行数据，
 * 不会注意到头注释被换了。顺带也钉住字段顺序、缩进、`gap` 省略规则这些格式约定。
 */
describe('EditorVM · 导出与 content.ts 往返一致', () => {
  it('原样导出仓库里的 content.ts，除 rev 外逐字节相同', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { CONTENT } = await import('@game/content/content');

    const file = fileURLToPath(
      new URL('../../demo/assets/modules/mini-fish/content/content.ts', import.meta.url),
    );
    const onDisk = readFileSync(file, 'utf8').split('\r\n').join('\n').trimEnd();
    const exported = new EditorVM(CONTENT).exportText().trimEnd();

    // `rev` 只在导出时 +1，那一行本来就该不同；其余必须一模一样
    const strip = (s: string): string => s.replace(/^ {2}rev: \d+,$/m, '  rev: <REV>,');
    expect(strip(exported)).toBe(strip(onDisk));
    expect(exported).toContain(`  rev: ${CONTENT.rev + 1},`);
  });
});
